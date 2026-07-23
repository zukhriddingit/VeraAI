import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import JSON5 from "json5";

import {
  findOpenClawConfigViolations,
  verifyOpenClawConfigurationFiles
} from "./verify-openclaw-config.ts";

export const MARITIME_API_ORIGIN = "https://api.maritime.sh";
export const OPENCLAW_CONFIG_SOURCE = resolve(
  import.meta.dirname,
  "../infra/maritime/openclaw/openclaw.json5"
);
export const OPENCLAW_NODE_CONFIG_SOURCE = resolve(
  import.meta.dirname,
  "../infra/maritime/openclaw/node.openclaw.json5"
);
export const OPENCLAW_CONFIG_TARGET_DIRECTORY = "/data/.openclaw";
export const OPENCLAW_CONFIG_TARGET_NAME = "openclaw.json";

const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const API_KEY = /^mk_[A-Za-z0-9_-]{16,256}$/u;
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
const MAX_TIMEOUT_MILLISECONDS = 10_000;
const INLINE_SECRET =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|xox[baprs])-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|(?:postgres(?:ql)?|mysql):\/\/[^\s:@/]+:[^\s@/]+@)/iu;

export type MaritimeConfigUploadCode =
  | "maritime_config_authentication_failed"
  | "maritime_config_rate_limited"
  | "maritime_config_unavailable"
  | "maritime_config_rejected";

const SAFE_MESSAGES: Readonly<Record<MaritimeConfigUploadCode, string>> = {
  maritime_config_authentication_failed: "Maritime configuration authentication failed.",
  maritime_config_rate_limited: "Maritime configuration upload was rate limited.",
  maritime_config_unavailable: "Maritime configuration upload is temporarily unavailable.",
  maritime_config_rejected: "Maritime configuration upload was rejected."
};

export class MaritimeConfigUploadError extends Error {
  readonly code: MaritimeConfigUploadCode;
  readonly retryable: boolean;

  constructor(code: MaritimeConfigUploadCode, retryable: boolean) {
    super(SAFE_MESSAGES[code]);
    this.name = "MaritimeConfigUploadError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type MaritimeFetch = (input: string | URL, init: RequestInit) => Promise<Response>;

export interface MaritimeConfigUploadResult {
  readonly correlationId: string;
  readonly configSha256: string;
  readonly gatewayAgentIdHash: string;
}

export interface MaritimeConfigUploadInput {
  readonly apiUrl?: string;
  readonly apiKey: string;
  readonly gatewayAgentId: string;
  readonly configText: string;
  readonly nodeConfigText: string;
  readonly correlationId?: string;
  readonly fetchImplementation?: MaritimeFetch;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
}

interface ParsedUploadInput {
  readonly apiOrigin: typeof MARITIME_API_ORIGIN;
  readonly apiKey: string;
  readonly gatewayAgentId: string;
  readonly configText: string;
  readonly correlationId: string;
  readonly timeoutMilliseconds: number;
}

function safeError(code: MaritimeConfigUploadCode, retryable: boolean): MaritimeConfigUploadError {
  return new MaritimeConfigUploadError(code, retryable);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isCanonicalNonPlaceholderUuid(value: string): boolean {
  return AGENT_UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000";
}

function parseApiOrigin(rawValue: string | undefined): typeof MARITIME_API_ORIGIN {
  if (rawValue !== undefined && rawValue !== rawValue.trim()) {
    throw safeError("maritime_config_rejected", false);
  }
  const value = rawValue || MARITIME_API_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw safeError("maritime_config_rejected", false);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname !== "api.maritime.sh" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== MARITIME_API_ORIGIN
  ) {
    throw safeError("maritime_config_rejected", false);
  }
  return MARITIME_API_ORIGIN;
}

function parseTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MILLISECONDS) {
    throw safeError("maritime_config_rejected", false);
  }
  return timeout;
}

function parseConfiguration(gatewayText: string, nodeText: string): void {
  const encodedSize = Buffer.byteLength(gatewayText, "utf8");
  if (encodedSize === 0 || encodedSize > MAX_CONFIG_BYTES || INLINE_SECRET.test(gatewayText)) {
    throw safeError("maritime_config_rejected", false);
  }

  let gateway: unknown;
  let node: unknown;
  try {
    gateway = JSON5.parse(gatewayText) as unknown;
    node = JSON5.parse(nodeText) as unknown;
  } catch {
    throw safeError("maritime_config_rejected", false);
  }
  if (findOpenClawConfigViolations({ gateway, node }).length > 0) {
    throw safeError("maritime_config_rejected", false);
  }
}

function parseUploadInput(input: MaritimeConfigUploadInput): ParsedUploadInput {
  if (!API_KEY.test(input.apiKey) || input.apiKey.trim() !== input.apiKey) {
    throw safeError("maritime_config_authentication_failed", false);
  }
  if (!isCanonicalNonPlaceholderUuid(input.gatewayAgentId)) {
    throw safeError("maritime_config_rejected", false);
  }
  const correlationId = input.correlationId ?? randomUUID();
  if (!isCanonicalNonPlaceholderUuid(correlationId)) {
    throw safeError("maritime_config_rejected", false);
  }
  parseConfiguration(input.configText, input.nodeConfigText);
  return {
    apiOrigin: parseApiOrigin(input.apiUrl),
    apiKey: input.apiKey,
    gatewayAgentId: input.gatewayAgentId,
    configText: input.configText,
    correlationId,
    timeoutMilliseconds: parseTimeout(input.timeoutMilliseconds)
  };
}

async function consumeBoundedResponse(response: Response): Promise<void> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw safeError("maritime_config_unavailable", true);
    }
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw safeError("maritime_config_unavailable", true);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) return;

  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw safeError("maritime_config_unavailable", true);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function errorForStatus(status: number): MaritimeConfigUploadError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) {
    return safeError("maritime_config_authentication_failed", false);
  }
  if (status === 429) return safeError("maritime_config_rate_limited", true);
  if (status >= 500 && status <= 599) return safeError("maritime_config_unavailable", true);
  return safeError("maritime_config_rejected", false);
}

export async function uploadOpenClawConfig(
  input: MaritimeConfigUploadInput
): Promise<MaritimeConfigUploadResult> {
  const parsed = parseUploadInput(input);
  if (input.signal?.aborted) throw safeError("maritime_config_unavailable", true);

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), parsed.timeoutMilliseconds);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutController.signal])
    : timeoutController.signal;
  const fetchImplementation = input.fetchImplementation ?? (fetch as MaritimeFetch);
  const requestBody = JSON.stringify({
    files: [
      {
        path: OPENCLAW_CONFIG_TARGET_NAME,
        content: parsed.configText,
        executable: false,
        run_on_deploy: false,
        target_dir: OPENCLAW_CONFIG_TARGET_DIRECTORY
      }
    ]
  });

  try {
    const response = await fetchImplementation(
      `${parsed.apiOrigin}/api/v1/agents/${parsed.gatewayAgentId}/files`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": parsed.apiKey,
          "X-Correlation-ID": parsed.correlationId
        },
        body: requestBody,
        redirect: "error",
        signal
      }
    );
    await consumeBoundedResponse(response);
    const mappedError = errorForStatus(response.status);
    if (mappedError) throw mappedError;
    return {
      correlationId: parsed.correlationId,
      configSha256: sha256(parsed.configText),
      gatewayAgentIdHash: sha256(`vera-maritime-agent:${parsed.gatewayAgentId}`)
    };
  } catch (error) {
    if (error instanceof MaritimeConfigUploadError) throw error;
    throw safeError("maritime_config_unavailable", true);
  } finally {
    clearTimeout(timeout);
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
type TextSink = (value: string) => void;
type ConfigFileVerifier = (gatewayPath?: string, nodePath?: string) => Promise<string[]>;

export interface MaritimeConfigUploadCliOptions {
  readonly argv?: readonly string[];
  readonly environment?: Environment;
  readonly fetchImplementation?: MaritimeFetch;
  readonly verifyConfigFiles?: ConfigFileVerifier;
  readonly correlationIdFactory?: () => string;
  readonly stdout?: TextSink;
  readonly stderr?: TextSink;
}

function cliFailure(stderr: TextSink, error: MaritimeConfigUploadError): number {
  stderr(
    `${JSON.stringify({
      event: "openclaw_config_upload_failed",
      code: error.code,
      retryable: error.retryable
    })}\n`
  );
  return 1;
}

function parseCliConfirmation(argv: readonly string[], agentId: string): void {
  if (argv.length !== 2 || argv[0] !== "--confirm" || argv[1] !== agentId) {
    throw safeError("maritime_config_rejected", false);
  }
}

export async function runMaritimeOpenClawConfigUploadCli(
  options: MaritimeConfigUploadCliOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const stdout = options.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
  const gatewayAgentId = environment.VERA_MARITIME_GATEWAY_AGENT_ID?.trim() ?? "";

  try {
    // Confirmation is checked before reading files, validating with a subprocess, or constructing
    // a transport. A bare/default invocation therefore cannot contact Maritime.
    parseCliConfirmation(argv, gatewayAgentId);
    if (!isCanonicalNonPlaceholderUuid(gatewayAgentId)) {
      throw safeError("maritime_config_rejected", false);
    }
    const apiKey = environment.MARITIME_API_KEY ?? "";
    if (!API_KEY.test(apiKey) || apiKey.trim() !== apiKey) {
      throw safeError("maritime_config_authentication_failed", false);
    }

    const verifyConfigFiles = options.verifyConfigFiles ?? verifyOpenClawConfigurationFiles;
    let violations: string[];
    try {
      violations = await verifyConfigFiles(OPENCLAW_CONFIG_SOURCE, OPENCLAW_NODE_CONFIG_SOURCE);
    } catch {
      throw safeError("maritime_config_rejected", false);
    }
    if (violations.length > 0) throw safeError("maritime_config_rejected", false);

    const [configText, nodeConfigText] = await Promise.all([
      readFile(OPENCLAW_CONFIG_SOURCE, "utf8"),
      readFile(OPENCLAW_NODE_CONFIG_SOURCE, "utf8")
    ]);
    const result = await uploadOpenClawConfig({
      ...(environment.MARITIME_API_URL === undefined
        ? {}
        : { apiUrl: environment.MARITIME_API_URL }),
      apiKey,
      gatewayAgentId,
      configText,
      nodeConfigText,
      correlationId: options.correlationIdFactory?.() ?? randomUUID(),
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation })
    });
    stdout(
      `${JSON.stringify({
        event: "openclaw_config_uploaded",
        correlationId: result.correlationId,
        gatewayAgentIdHash: result.gatewayAgentIdHash,
        configSha256: result.configSha256
      })}\n`
    );
    return 0;
  } catch (error) {
    return cliFailure(
      stderr,
      error instanceof MaritimeConfigUploadError
        ? error
        : safeError("maritime_config_unavailable", true)
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exitCode = await runMaritimeOpenClawConfigUploadCli();
}
