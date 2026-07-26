import {
  MinimizedRemoteExtensionSnapshotSchema,
  type MinimizedRemoteExtensionSnapshot
} from "@vera/domain";
import { z } from "zod";

export const REMOTE_EXTENSION_MARITIME_API_ORIGIN = "https://api.maritime.sh";
export const REMOTE_EXTENSION_PROMPT_VERSION = "vera-remote-extension-snapshot.v1";

const AgentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const MaritimeChatResponseSchema = z.object({ response: z.string().min(1) }).strict();

export type MaritimeRemoteExtensionFailureCode =
  | "maritime_auth_failed"
  | "gateway_unavailable"
  | "snapshot_timed_out"
  | "snapshot_invalid_response";

export class MaritimeRemoteExtensionError extends Error {
  constructor(
    readonly code: MaritimeRemoteExtensionFailureCode,
    readonly retryable: boolean
  ) {
    super(`Remote extension snapshot failed: ${code}.`);
    this.name = "MaritimeRemoteExtensionError";
  }
}

export interface MaritimeRemoteExtensionClientOptions {
  readonly apiKey: string;
  readonly agentId: string;
  readonly timeoutMilliseconds?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

function fixedSnapshotTask(): string {
  return [
    `Protocol ${REMOTE_EXTENSION_PROMPT_VERSION}.`,
    "This is a connectivity check, not a browsing task.",
    "Call vera_read_shared_tab_snapshot exactly once with an empty object.",
    "Do not call any other tool.",
    "Do not navigate, click, type, submit, message, upload, download, apply, pay, or retry.",
    "Return only the exact JSON object from that tool with no Markdown or additional text."
  ].join(" ");
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
  }
  if (!response.body) {
    throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseSnapshot(raw: string, now: Date): MinimizedRemoteExtensionSnapshot {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
  }
  const parsed = MinimizedRemoteExtensionSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
  }
  const capturedAt = new Date(parsed.data.capturedAt).getTime();
  const age = now.getTime() - capturedAt;
  if (age < -30_000 || age > 5 * 60_000) {
    throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
  }
  return parsed.data;
}

export class MaritimeRemoteExtensionClient {
  readonly #apiKey: string;
  readonly #agentId: string;
  readonly #timeoutMilliseconds: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: MaritimeRemoteExtensionClientOptions) {
    if (options.apiKey.trim().length < 8) {
      throw new Error("MARITIME_BROWSER_GATEWAY_API_KEY is missing or invalid.");
    }
    this.#apiKey = options.apiKey;
    this.#agentId = AgentIdSchema.parse(options.agentId);
    const timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1_000 ||
      timeoutMilliseconds > 30_000
    ) {
      throw new Error(
        "VERA_REMOTE_EXTENSION_SNAPSHOT_TIMEOUT_MS must be an integer from 1000 through 30000."
      );
    }
    const maxResponseBytes = options.maxResponseBytes ?? 20_000;
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 1_024 ||
      maxResponseBytes > 20_000
    ) {
      throw new Error(
        "VERA_REMOTE_EXTENSION_SNAPSHOT_MAX_RESPONSE_BYTES must be an integer from 1024 through 20000."
      );
    }
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#maxResponseBytes = maxResponseBytes;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async snapshot(requestId: string): Promise<MinimizedRemoteExtensionSnapshot> {
    const conversationId = z.uuid().parse(requestId);
    const url = new URL(
      `/api/agents/${encodeURIComponent(this.#agentId)}/chat`,
      REMOTE_EXTENSION_MARITIME_API_ORIGIN
    );
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: fixedSnapshotTask(),
          conversation_id: conversationId
        }),
        signal: AbortSignal.timeout(this.#timeoutMilliseconds)
      });
      if (response.status === 401 || response.status === 403) {
        throw new MaritimeRemoteExtensionError("maritime_auth_failed", false);
      }
      if (!response.ok) {
        throw new MaritimeRemoteExtensionError(
          "gateway_unavailable",
          response.status === 429 || response.status >= 500
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(await readBoundedText(response, this.#maxResponseBytes)) as unknown;
      } catch (error) {
        if (error instanceof MaritimeRemoteExtensionError) throw error;
        throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
      }
      const chat = MaritimeChatResponseSchema.safeParse(payload);
      if (!chat.success) {
        throw new MaritimeRemoteExtensionError("snapshot_invalid_response", false);
      }
      return parseSnapshot(chat.data.response, this.#now());
    } catch (error) {
      if (error instanceof MaritimeRemoteExtensionError) throw error;
      const timedOut =
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MaritimeRemoteExtensionError(
        timedOut ? "snapshot_timed_out" : "gateway_unavailable",
        !timedOut
      );
    }
  }
}

export function createMaritimeRemoteExtensionClient(
  environment: Readonly<Record<string, string | undefined>>
): MaritimeRemoteExtensionClient {
  return new MaritimeRemoteExtensionClient({
    apiKey: environment.MARITIME_BROWSER_GATEWAY_API_KEY ?? "",
    agentId: environment.MARITIME_BROWSER_GATEWAY_AGENT_ID ?? "",
    timeoutMilliseconds: Number(environment.VERA_REMOTE_EXTENSION_SNAPSHOT_TIMEOUT_MS ?? 15_000),
    maxResponseBytes: Number(
      environment.VERA_REMOTE_EXTENSION_SNAPSHOT_MAX_RESPONSE_BYTES ?? 20_000
    )
  });
}
