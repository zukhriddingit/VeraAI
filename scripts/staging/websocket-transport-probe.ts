import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import WebSocket from "ws";

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/u;
const MAX_PROTOCOLS = 8;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_TIMEOUT_MILLISECONDS = 40_000;

export interface WebSocketTransportCase {
  readonly caseId: string;
  readonly url: string;
  readonly origin: string | null;
  readonly protocols: readonly string[];
  readonly credentialProtocolIndexes: readonly number[];
  readonly stabilityMilliseconds: number;
  readonly timeoutMilliseconds: number;
  readonly payload: Uint8Array | null;
  readonly tlsPolicy?: "system" | "allow_ephemeral_self_signed";
}

export interface SanitizedWebSocketObservation {
  readonly caseId: string;
  readonly reachedOpen: boolean;
  readonly httpStatus: number | null;
  readonly selectedProtocol: string | "credential_protocol" | null;
  readonly offeredProtocolCount: number;
  readonly nonSecretProtocols: readonly string[];
  readonly credentialProtocolSha256: readonly string[];
  readonly originPresent: boolean;
  readonly originScheme: "chrome-extension" | "https" | "http" | "other" | null;
  readonly lifetimeMilliseconds: number;
  readonly closeCode: number | null;
  readonly pingPong: "passed" | "failed" | "not_run";
  readonly boundedEcho: "passed" | "failed" | "not_run";
  readonly errorCode:
    | "none"
    | "http_rejection"
    | "network_error"
    | "timeout"
    | "closed_early"
    | "unexpected_protocol";
}

interface ProtocolSummary {
  readonly protocolCount: number;
  readonly nonSecretProtocols: readonly string[];
  readonly credentialProtocolSha256: readonly string[];
}

export function credentialProtocolSha256(protocol: string): string {
  return createHash("sha256").update(protocol, "utf8").digest("hex");
}

function validatedCredentialIndexes(
  protocols: readonly string[],
  credentialIndexes: readonly number[]
): Set<number> {
  const indexes = new Set<number>();
  for (const index of credentialIndexes) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= protocols.length) {
      throw new Error("Credential protocol indexes must reference offered protocols.");
    }
    if (indexes.has(index)) {
      throw new Error("Credential protocol indexes must be unique.");
    }
    indexes.add(index);
  }
  return indexes;
}

export function sanitizeProtocols(
  protocols: readonly string[],
  credentialIndexes: readonly number[]
): ProtocolSummary {
  if (protocols.length > MAX_PROTOCOLS) {
    throw new Error(`WebSocket probes accept at most ${MAX_PROTOCOLS} protocols.`);
  }
  const credentialIndexSet = validatedCredentialIndexes(protocols, credentialIndexes);
  return {
    protocolCount: protocols.length,
    nonSecretProtocols: protocols.filter((_protocol, index) => !credentialIndexSet.has(index)),
    credentialProtocolSha256: protocols.flatMap((protocol, index) =>
      credentialIndexSet.has(index) ? [credentialProtocolSha256(protocol)] : []
    )
  };
}

function parseOriginScheme(origin: string | null): SanitizedWebSocketObservation["originScheme"] {
  if (origin === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "other";
  }
  if (parsed.protocol === "chrome-extension:") return "chrome-extension";
  if (parsed.protocol === "https:") return "https";
  if (parsed.protocol === "http:") return "http";
  return "other";
}

function validateInput(input: WebSocketTransportCase): {
  readonly url: string;
  readonly protocolSummary: ProtocolSummary;
  readonly credentialProtocols: ReadonlySet<string>;
} {
  if (!CASE_ID.test(input.caseId)) {
    throw new Error("WebSocket caseId must be an opaque safe identifier.");
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("WebSocket probe URL must be valid.");
  }
  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("WebSocket probe URL must be credential-free WS or WSS.");
  }
  if (
    !Number.isSafeInteger(input.stabilityMilliseconds) ||
    input.stabilityMilliseconds < 1 ||
    !Number.isSafeInteger(input.timeoutMilliseconds) ||
    input.timeoutMilliseconds <= input.stabilityMilliseconds ||
    input.timeoutMilliseconds > MAX_TIMEOUT_MILLISECONDS
  ) {
    throw new Error(
      "WebSocket probe timeout must exceed a positive stability window and be at most 40000."
    );
  }
  if (input.payload !== null && input.payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(`WebSocket probe payload must not exceed ${MAX_PAYLOAD_BYTES} bytes.`);
  }
  const credentialIndexSet = validatedCredentialIndexes(
    input.protocols,
    input.credentialProtocolIndexes
  );
  return {
    url: url.href,
    protocolSummary: sanitizeProtocols(input.protocols, input.credentialProtocolIndexes),
    credentialProtocols: new Set(
      input.protocols.filter((_protocol, index) => credentialIndexSet.has(index))
    )
  };
}

function boundedLifetime(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export async function runWebSocketTransportCase(
  input: WebSocketTransportCase
): Promise<SanitizedWebSocketObservation> {
  const validated = validateInput(input);
  const startedAt = performance.now();

  return await new Promise<SanitizedWebSocketObservation>((resolve) => {
    let settled = false;
    let opened = false;
    let expectedClientClose = false;
    let receivedPong = false;
    let echoState: SanitizedWebSocketObservation["boundedEcho"] =
      input.payload === null ? "not_run" : "failed";
    let stabilityTimer: ReturnType<typeof setTimeout> | undefined;

    const socket = new WebSocket(validated.url, [...input.protocols], {
      followRedirects: false,
      handshakeTimeout: input.timeoutMilliseconds,
      headers: input.origin === null ? undefined : { Origin: input.origin },
      maxPayload: 128 * 1024,
      rejectUnauthorized: input.tlsPolicy !== "allow_ephemeral_self_signed"
    });

    const finish = (
      observation: Pick<
        SanitizedWebSocketObservation,
        | "reachedOpen"
        | "httpStatus"
        | "selectedProtocol"
        | "closeCode"
        | "pingPong"
        | "boundedEcho"
        | "errorCode"
      >
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      resolve({
        caseId: input.caseId,
        ...observation,
        offeredProtocolCount: validated.protocolSummary.protocolCount,
        nonSecretProtocols: validated.protocolSummary.nonSecretProtocols,
        credentialProtocolSha256: validated.protocolSummary.credentialProtocolSha256,
        originPresent: input.origin !== null,
        originScheme: parseOriginScheme(input.origin),
        lifetimeMilliseconds: boundedLifetime(startedAt)
      });
    };

    const timeoutTimer = setTimeout(() => {
      socket.terminate();
      finish({
        reachedOpen: opened,
        httpStatus: opened ? 101 : null,
        selectedProtocol: null,
        closeCode: null,
        pingPong: opened ? (receivedPong ? "passed" : "failed") : "not_run",
        boundedEcho: echoState,
        errorCode: "timeout"
      });
    }, input.timeoutMilliseconds);

    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      finish({
        reachedOpen: false,
        httpStatus: response.statusCode ?? null,
        selectedProtocol: null,
        closeCode: null,
        pingPong: "not_run",
        boundedEcho: "not_run",
        errorCode: "http_rejection"
      });
    });

    socket.once("open", () => {
      opened = true;
      socket.ping();
      if (input.payload !== null) socket.send(input.payload);
      stabilityTimer = setTimeout(() => {
        expectedClientClose = true;
        socket.close(1000, "bounded-stability-complete");
      }, input.stabilityMilliseconds);
    });

    socket.on("pong", () => {
      receivedPong = true;
    });

    socket.on("message", (value) => {
      if (input.payload === null) return;
      const received =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(
              Array.isArray(value)
                ? Buffer.concat(value)
                : value instanceof ArrayBuffer
                  ? Buffer.from(value)
                  : value
            );
      echoState =
        received.byteLength === input.payload.byteLength &&
        received.every((byte, index) => byte === input.payload?.[index])
          ? "passed"
          : "failed";
    });

    socket.once("close", (code) => {
      if (!opened) {
        finish({
          reachedOpen: false,
          httpStatus: null,
          selectedProtocol: null,
          closeCode: code,
          pingPong: "not_run",
          boundedEcho: "not_run",
          errorCode: "network_error"
        });
        return;
      }
      const selectedProtocol = validated.credentialProtocols.has(socket.protocol)
        ? "credential_protocol"
        : socket.protocol || null;
      finish({
        reachedOpen: true,
        httpStatus: 101,
        selectedProtocol,
        closeCode: code,
        pingPong: receivedPong ? "passed" : "failed",
        boundedEcho: echoState,
        errorCode:
          selectedProtocol === "credential_protocol"
            ? "unexpected_protocol"
            : expectedClientClose && code === 1000
              ? "none"
              : "closed_early"
      });
    });

    socket.once("error", () => {
      if (settled) return;
      if (opened) {
        finish({
          reachedOpen: true,
          httpStatus: 101,
          selectedProtocol: null,
          closeCode: null,
          pingPong: receivedPong ? "passed" : "failed",
          boundedEcho: echoState,
          errorCode: "network_error"
        });
      }
    });
  });
}
