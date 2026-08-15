import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";

import { WebSocket, WebSocketServer } from "ws";

export const ENROLLMENT_PROTOCOL = "vera-browser-enrollment.v1";
export const RELAY_CREDENTIAL_PATH = "/data/.openclaw/credentials/browser-extension-relay.secret";
const EXTENSION_ROUTE = "/browser/extension";
const CHECKPOINT_PATH = "/api/internal/browser-connector/enrollment/checkpoint";
const MAX_FRAME_BYTES = 4_096;
const ENROLLMENT_TIMEOUT_MILLISECONDS = 10_000;
const CHECKPOINT_TIMEOUT_MILLISECONDS = 5_000;
const HEX_64 = /^[a-f0-9]{64}$/u;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DENIAL_REASONS = new Set([
  "disabled",
  "assignment_unavailable",
  "ticket_invalid",
  "ticket_expired",
  "ticket_replayed",
  "binding_mismatch",
  "version_incompatible",
  "device_conflict"
]);

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactHttpsOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== value ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function exactCheckpointUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.pathname !== CHECKPOINT_PATH ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      parsed.toString() !== value
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveEnrollmentConfiguration(environment) {
  if (environment.VERA_BROWSER_ENROLLMENT_ENABLED !== "1") return null;
  const checkpointUrl = exactCheckpointUrl(environment.VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL);
  const publicGatewayOrigin = exactHttpsOrigin(environment.VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN);
  const checkpointToken = environment.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN;
  if (!checkpointUrl || !publicGatewayOrigin || !HEX_64.test(checkpointToken ?? "")) {
    return null;
  }
  return { checkpointUrl, publicGatewayOrigin, checkpointToken };
}

export function parseEnrollmentFrame(value) {
  if (
    !exactObject(value, [
      "ticket",
      "extensionVersion",
      "protocolVersion",
      "installationId",
      "requestedAt"
    ]) ||
    typeof value.ticket !== "string" ||
    !TICKET_PATTERN.test(value.ticket) ||
    value.extensionVersion !== "2.2.0" ||
    value.protocolVersion !== "1" ||
    typeof value.installationId !== "string" ||
    !HEX_64.test(value.installationId) ||
    typeof value.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(value.requestedAt)) ||
    new Date(Date.parse(value.requestedAt)).toISOString() !== value.requestedAt
  ) {
    throw new Error("Invalid Browser Connector enrollment frame.");
  }
  return {
    ticket: value.ticket,
    extensionVersion: value.extensionVersion,
    protocolVersion: value.protocolVersion,
    installationId: value.installationId,
    requestedAt: value.requestedAt
  };
}

export function parseCheckpointDecision(value) {
  if (
    exactObject(value, ["allowed", "assignmentId"]) &&
    value.allowed === true &&
    typeof value.assignmentId === "string" &&
    UUID_PATTERN.test(value.assignmentId)
  ) {
    return { allowed: true, assignmentId: value.assignmentId };
  }
  if (
    exactObject(value, ["allowed", "reason"]) &&
    value.allowed === false &&
    typeof value.reason === "string" &&
    DENIAL_REASONS.has(value.reason)
  ) {
    return { allowed: false, reason: value.reason };
  }
  throw new Error("Invalid Browser Connector enrollment checkpoint response.");
}

export function readRelayCredential(path = RELAY_CREDENTIAL_PATH) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size !== 64) {
      throw new Error("Invalid Browser Connector relay credential boundary.");
    }
    const value = readFileSync(descriptor, "utf8");
    if (!HEX_64.test(value)) {
      throw new Error("Invalid Browser Connector relay credential boundary.");
    }
    return value;
  } catch {
    throw new Error("Browser Connector relay credential is unavailable.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function readBoundedJsonResponse(response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_FRAME_BYTES)
  ) {
    throw new Error("Enrollment checkpoint response exceeded the bound.");
  }
  if (!response.body) throw new Error("Enrollment checkpoint response was empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.byteLength;
    if (length > MAX_FRAME_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Enrollment checkpoint response exceeded the bound.");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Enrollment checkpoint response was malformed.");
  }
}

function requestedProtocols(request) {
  const header = request.headers["sec-websocket-protocol"];
  if (typeof header !== "string") return [];
  return header
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function denyUpgrade(socket, statusLine) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
}

function sendGenericDenial(webSocket) {
  if (webSocket.readyState !== WebSocket.OPEN) return;
  webSocket.send(JSON.stringify({ protocol: ENROLLMENT_PROTOCOL, error: "ticket_invalid" }), () =>
    webSocket.close(1000, "enrollment_denied")
  );
}

export async function handleEnrollmentUpgrade(request, socket, head, dependencies = {}) {
  const configuration =
    dependencies.configuration ??
    resolveEnrollmentConfiguration(dependencies.environment ?? process.env);
  if (
    !configuration ||
    request.method !== "GET" ||
    request.url !== EXTENSION_ROUTE ||
    head.byteLength > MAX_FRAME_BYTES ||
    requestedProtocols(request).length !== 1 ||
    requestedProtocols(request)[0] !== ENROLLMENT_PROTOCOL
  ) {
    denyUpgrade(socket, configuration ? "400 Bad Request" : "503 Service Unavailable");
    return;
  }

  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const readCredentialImplementation =
    dependencies.readCredentialImplementation ?? readRelayCredential;
  const enrollmentTimeout =
    dependencies.enrollmentTimeoutMilliseconds ?? ENROLLMENT_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(enrollmentTimeout) ||
    enrollmentTimeout < 1 ||
    enrollmentTimeout > ENROLLMENT_TIMEOUT_MILLISECONDS
  ) {
    denyUpgrade(socket, "503 Service Unavailable");
    return;
  }
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.size === 1 && protocols.has(ENROLLMENT_PROTOCOL)
        ? ENROLLMENT_PROTOCOL
        : false;
    }
  });

  try {
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const abortController = new AbortController();
      let frameReceived = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        abortController.abort();
      };
      const timeout = setTimeout(() => {
        finish();
        if (webSocket.readyState === WebSocket.OPEN) {
          webSocket.close(1008, "enrollment_timeout");
        } else {
          webSocket.terminate();
        }
      }, enrollmentTimeout);
      timeout.unref?.();
      webSocket.once("close", finish);
      webSocket.once("error", finish);
      webSocket.on("message", (data, isBinary) => {
        if (frameReceived || isBinary || data.byteLength > MAX_FRAME_BYTES) {
          finish();
          webSocket.close(1008, "invalid_enrollment_frame");
          return;
        }
        frameReceived = true;
        void (async () => {
          try {
            const frame = parseEnrollmentFrame(JSON.parse(data.toString("utf8")));
            const checkpointAbort = AbortSignal.timeout(CHECKPOINT_TIMEOUT_MILLISECONDS);
            const combinedSignal = AbortSignal.any([abortController.signal, checkpointAbort]);
            const response = await fetchImplementation(configuration.checkpointUrl, {
              method: "POST",
              headers: {
                authorization: `Bearer ${configuration.checkpointToken}`,
                "content-type": "application/json",
                origin: configuration.publicGatewayOrigin
              },
              body: JSON.stringify(frame),
              cache: "no-store",
              redirect: "error",
              signal: combinedSignal
            });
            if (!response.ok || response.status !== 200) {
              throw new Error("Enrollment checkpoint denied the request.");
            }
            const decision = parseCheckpointDecision(await readBoundedJsonResponse(response));
            if (!decision.allowed) {
              finish();
              sendGenericDenial(webSocket);
              return;
            }
            if (webSocket.readyState !== WebSocket.OPEN || finished) return;
            let relayCredential = readCredentialImplementation();
            if (!HEX_64.test(relayCredential)) {
              relayCredential = undefined;
              throw new Error("Browser Connector relay credential is unavailable.");
            }
            const output = JSON.stringify({
              protocol: ENROLLMENT_PROTOCOL,
              token: relayCredential
            });
            relayCredential = undefined;
            finish();
            if (webSocket.readyState === WebSocket.OPEN) {
              webSocket.send(output, () => webSocket.close(1000, "enrollment_complete"));
            }
          } catch {
            finish();
            if (webSocket.readyState === WebSocket.OPEN) {
              webSocket.close(1011, "enrollment_unavailable");
            }
          }
        })();
      });
    });
  } catch {
    denyUpgrade(socket, "400 Bad Request");
  }
}
