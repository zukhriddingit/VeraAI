export const ENROLLMENT_PROTOCOL = "vera-browser-enrollment.v1";
export const ENROLLMENT_PROTOCOL_VERSION = "1";
export const EXTENSION_VERSION = "2.2.0";

const MAX_FRAME_BYTES = 4_096;
const ENROLLMENT_TIMEOUT_MS = 10_000;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
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

export class EnrollmentError extends Error {
  constructor(code) {
    super("Browser Connector enrollment stopped safely.");
    this.name = "EnrollmentError";
    this.code = code;
  }
}

function isExactObject(value, keys) {
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

function exactIsoInstant(value) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return value;
}

export function enrollmentRelayUrl(gatewayOrigin) {
  const origin = exactHttpsOrigin(gatewayOrigin);
  if (!origin) throw new EnrollmentError("invalid_request");
  const relay = new URL(origin);
  relay.protocol = "wss:";
  relay.pathname = "/browser/extension";
  return relay.toString();
}

export function parseEnrollmentRequest(value) {
  if (
    !isExactObject(value, [
      "source",
      "type",
      "version",
      "requestId",
      "confirmation",
      "ticket",
      "expiresAt",
      "gatewayOrigin",
      "protocolVersion"
    ]) ||
    value.source !== "vera-web" ||
    value.type !== "connect-browser" ||
    value.version !== "1" ||
    typeof value.requestId !== "string" ||
    !UUID_PATTERN.test(value.requestId) ||
    value.confirmation !== "connect_read_only_browser" ||
    typeof value.ticket !== "string" ||
    !TICKET_PATTERN.test(value.ticket) ||
    !exactIsoInstant(value.expiresAt) ||
    !exactHttpsOrigin(value.gatewayOrigin) ||
    value.protocolVersion !== ENROLLMENT_PROTOCOL_VERSION
  ) {
    throw new EnrollmentError("invalid_request");
  }
  return {
    source: value.source,
    type: value.type,
    version: value.version,
    requestId: value.requestId,
    confirmation: value.confirmation,
    ticket: value.ticket,
    expiresAt: value.expiresAt,
    gatewayOrigin: value.gatewayOrigin,
    protocolVersion: value.protocolVersion
  };
}

export function parseEnrollmentResponse(value) {
  if (
    isExactObject(value, ["protocol", "token"]) &&
    value.protocol === ENROLLMENT_PROTOCOL &&
    typeof value.token === "string" &&
    SHA256_PATTERN.test(value.token)
  ) {
    return { protocol: value.protocol, token: value.token };
  }
  if (
    isExactObject(value, ["protocol", "error"]) &&
    value.protocol === ENROLLMENT_PROTOCOL &&
    typeof value.error === "string" &&
    DENIAL_REASONS.has(value.error)
  ) {
    return { protocol: value.protocol, error: value.error };
  }
  throw new EnrollmentError("invalid_response");
}

export function createInstallationId(randomValues = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = randomValues(new Uint8Array(32));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new EnrollmentError("entropy_unavailable");
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestInstallationId(
  installationId,
  digest = (bytes) => crypto.subtle.digest("SHA-256", bytes)
) {
  if (typeof installationId !== "string" || !SHA256_PATTERN.test(installationId)) {
    throw new EnrollmentError("invalid_installation_id");
  }
  const result = new Uint8Array(await digest(new TextEncoder().encode(installationId)));
  if (result.byteLength !== 32) throw new EnrollmentError("digest_unavailable");
  return [...result].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function responseErrorState(reason) {
  if (reason === "ticket_expired") return "expired";
  if (reason === "version_incompatible") return "version_incompatible";
  return "denied";
}

export async function enrollWithGateway(inputRaw, dependencies = {}) {
  const input = parseEnrollmentRequest(inputRaw);
  const now = dependencies.now ? dependencies.now() : new Date();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Date.parse(input.expiresAt) <= nowDate.getTime()) throw new EnrollmentError("expired");
  const relayUrl = enrollmentRelayUrl(input.gatewayOrigin);
  const createSocket =
    dependencies.createSocket ?? ((url, protocol) => new WebSocket(url, protocol));
  const scheduleTimeout = dependencies.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout;
  const requestedAt = nowDate.toISOString();
  const frame = JSON.stringify({
    ticket: input.ticket,
    extensionVersion: EXTENSION_VERSION,
    protocolVersion: ENROLLMENT_PROTOCOL_VERSION,
    installationId: dependencies.installationId,
    requestedAt
  });
  if (
    typeof dependencies.installationId !== "string" ||
    !SHA256_PATTERN.test(dependencies.installationId) ||
    new TextEncoder().encode(frame).byteLength > MAX_FRAME_BYTES
  ) {
    throw new EnrollmentError("invalid_request");
  }

  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    let frameSent = false;
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      cancelTimeout(timeoutId);
      try {
        socket?.close(1000, "enrollment_complete");
      } catch {
        // The transport may already be closed.
      }
      if (error) reject(error);
      else resolve(result);
    };
    const timeoutId = scheduleTimeout(
      () => finish(null, new EnrollmentError("unavailable")),
      ENROLLMENT_TIMEOUT_MS
    );
    try {
      socket = createSocket(relayUrl, ENROLLMENT_PROTOCOL);
      socket.addEventListener("open", () => {
        if (socket.protocol !== ENROLLMENT_PROTOCOL || frameSent) {
          finish(null, new EnrollmentError("invalid_response"));
          return;
        }
        frameSent = true;
        socket.send(frame);
      });
      socket.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string") throw new EnrollmentError("invalid_response");
          if (new TextEncoder().encode(event.data).byteLength > MAX_FRAME_BYTES) {
            throw new EnrollmentError("invalid_response");
          }
          const response = parseEnrollmentResponse(JSON.parse(event.data));
          if ("error" in response) {
            throw new EnrollmentError(responseErrorState(response.error));
          }
          finish({ relayUrl, token: response.token }, null);
        } catch (error) {
          finish(
            null,
            error instanceof EnrollmentError ? error : new EnrollmentError("invalid_response")
          );
        }
      });
      socket.addEventListener("error", () => finish(null, new EnrollmentError("unavailable")));
      socket.addEventListener("close", () => {
        if (!settled) finish(null, new EnrollmentError("unavailable"));
      });
    } catch {
      finish(null, new EnrollmentError("unavailable"));
    }
  });
}
