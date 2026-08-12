import {
  BrowserResearchOutputSchema,
  BrowserResearchPlanSchema,
  type BrowserResearchOutput,
  type BrowserResearchPlan
} from "@vera/domain";

import { MaritimeBrowserResearchError } from "./maritime-browser-research-client.ts";

export interface LoopbackBrowserResearchClientOptions {
  readonly url: string;
  readonly token: string;
  readonly timeoutMilliseconds?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
}

function parseLoopbackUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_URL must be a valid loopback URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/research" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_URL must be the exact loopback /research endpoint."
    );
  }
  return url;
}

async function readBoundedJson(response: Response, maximum: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new MaritimeBrowserResearchError("research_invalid_response", false);
  }
  if (!response.body) throw new MaritimeBrowserResearchError("research_invalid_response", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new MaritimeBrowserResearchError("research_invalid_response", false);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new MaritimeBrowserResearchError("research_invalid_response", false);
  }
}

export class LoopbackBrowserResearchClient {
  readonly #url: URL;
  readonly #token: string;
  readonly #timeoutMilliseconds: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(options: LoopbackBrowserResearchClientOptions) {
    this.#url = parseLoopbackUrl(options.url);
    this.#token = options.token.trim();
    if (this.#token.length < 32 || this.#token.length > 256) {
      throw new Error(
        "VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_TOKEN must contain 32 to 256 characters."
      );
    }
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 100_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 750_000;
    if (this.#timeoutMilliseconds < 5_000 || this.#timeoutMilliseconds > 120_000) {
      throw new Error(
        "Loopback browser-research timeout must be from 5000 through 120000 milliseconds."
      );
    }
    if (this.#maxResponseBytes < 20_000 || this.#maxResponseBytes > 1_000_000) {
      throw new Error(
        "Loopback browser-research response limit must be from 20000 through 1000000 bytes."
      );
    }
    this.#fetch = options.fetch ?? fetch;
  }

  async run(
    planInput: BrowserResearchPlan,
    options: { readonly signal: AbortSignal }
  ): Promise<BrowserResearchOutput> {
    const plan = BrowserResearchPlanSchema.parse(planInput);
    const timeout = AbortSignal.timeout(this.#timeoutMilliseconds);
    try {
      const response = await this.#fetch(this.#url, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          Origin: this.#url.origin
        },
        body: JSON.stringify(plan),
        signal: AbortSignal.any([options.signal, timeout])
      });
      if (response.status === 401 || response.status === 403) {
        throw new MaritimeBrowserResearchError("maritime_auth_failed", false);
      }
      if (!response.ok) {
        throw new MaritimeBrowserResearchError(
          "gateway_unavailable",
          response.status === 409 || response.status >= 500
        );
      }
      const output = BrowserResearchOutputSchema.safeParse(
        await readBoundedJson(response, this.#maxResponseBytes)
      );
      if (
        !output.success ||
        output.data.veraRunId !== plan.veraRunId ||
        output.data.source !== plan.source
      ) {
        throw new MaritimeBrowserResearchError("research_invalid_response", false);
      }
      return output.data;
    } catch (error: unknown) {
      if (error instanceof MaritimeBrowserResearchError) throw error;
      if (options.signal.aborted) {
        throw new MaritimeBrowserResearchError("research_cancelled", false);
      }
      if (timeout.aborted) throw new MaritimeBrowserResearchError("research_timed_out", true);
      throw new MaritimeBrowserResearchError("gateway_unavailable", true);
    }
  }
}

export function createLoopbackBrowserResearchClient(environment: NodeJS.ProcessEnv) {
  return new LoopbackBrowserResearchClient({
    url: environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_URL ?? "",
    token: environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_TOKEN ?? "",
    timeoutMilliseconds: Number(environment.VERA_BROWSER_RESEARCH_TIMEOUT_MS ?? 100_000),
    maxResponseBytes: Number(environment.VERA_BROWSER_RESEARCH_MAX_RESPONSE_BYTES ?? 750_000)
  });
}
