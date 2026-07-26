import { pathToFileURL } from "node:url";

import {
  runWebSocketTransportCase,
  type SanitizedWebSocketObservation,
  type WebSocketTransportCase
} from "./websocket-transport-probe.ts";

const RELAY_PROTOCOL = "openclaw-extension-relay";
const TOKEN_PROTOCOL_PREFIX = "openclaw-extension-token.";
const EXTENSION_ROUTE = "/browser/extension";
const MARITIME_EXTENSION_ROUTE = new RegExp(
  String.raw`^/a/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${EXTENSION_ROUTE}$`,
  "u"
);
const CHROME_EXTENSION_ID = /^[a-p]{32}$/u;
const UNRELATED_ROUTE = "/__vera_remote_extension_unrelated__";

export interface RemoteExtensionProxySmokeEnvironment {
  readonly enabled: true;
  readonly extensionUrl: string;
  readonly extensionOrigin: string;
  readonly pairingSecret: string;
  readonly stabilityMilliseconds: number;
}

export type WebSocketTransportRunner = (
  input: WebSocketTransportCase
) => Promise<SanitizedWebSocketObservation>;

export interface RemoteExtensionProxyCheck {
  readonly id:
    | "unrelated_websocket_route_denied"
    | "wrong_pairing_secret_denied"
    | "extension_wss_upgrade"
    | "subprotocol_preserved"
    | "bounded_connection_stable"
    | "client_close_completed";
  readonly status: "passed" | "failed";
  readonly code:
    | "expected_denial"
    | "opened"
    | "selected_expected_protocol"
    | "stable_for_bounded_window"
    | "closed_by_client"
    | "unexpected_open"
    | "unexpected_protocol"
    | "closed_early"
    | "connection_error"
    | "timed_out";
}

export interface RemoteExtensionProxySmokeResult {
  readonly outcome: "passed" | "failed";
  readonly checks: readonly RemoteExtensionProxyCheck[];
  readonly caseResults: readonly SanitizedWebSocketObservation[];
  readonly observations: {
    readonly route: "/browser/extension";
    readonly transport: "wss";
    readonly originScheme: "chrome-extension";
    readonly openClawRelayFrameLimitBytes: 67_108_864;
    readonly stabilityWindowMilliseconds: number;
    readonly maritimePayloadLimit: "requires_private_provider_evidence";
    readonly maritimeIdleTimeout: "requires_private_provider_evidence";
  };
}

function parseExtensionUrl(rawValue: string | undefined): string {
  const value = rawValue?.trim() ?? "";
  if (!value) throw new Error("OPENCLAW_EXTENSION_GATEWAY_URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OPENCLAW_EXTENSION_GATEWAY_URL must be a valid URL.");
  }
  if (url.protocol !== "wss:") {
    throw new Error("OPENCLAW_EXTENSION_GATEWAY_URL must use WSS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "OPENCLAW_EXTENSION_GATEWAY_URL must not contain credentials, query, or fragment."
    );
  }
  if (url.pathname !== EXTENSION_ROUTE && !MARITIME_EXTENSION_ROUTE.test(url.pathname)) {
    throw new Error(
      `OPENCLAW_EXTENSION_GATEWAY_URL must use ${EXTENSION_ROUTE} directly or behind one exact Maritime agent UUID prefix.`
    );
  }
  return url.href;
}

function parseExtensionOrigin(rawValue: string | undefined): string {
  const value = rawValue?.trim() ?? "";
  if (!value) throw new Error("OPENCLAW_EXTENSION_ORIGIN is required.");
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("OPENCLAW_EXTENSION_ORIGIN must be a valid Chrome extension origin.");
  }
  if (
    origin.protocol !== "chrome-extension:" ||
    !CHROME_EXTENSION_ID.test(origin.hostname) ||
    origin.port ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "" && origin.pathname !== "/")
  ) {
    throw new Error(
      "OPENCLAW_EXTENSION_ORIGIN must be one exact chrome-extension origin with a 32-character extension ID."
    );
  }
  return `chrome-extension://${origin.hostname}`;
}

function unrelatedRouteFor(extensionUrl: string): string {
  const url = new URL(extensionUrl);
  url.pathname = `${url.pathname.slice(0, -EXTENSION_ROUTE.length)}${UNRELATED_ROUTE}`;
  return url.href;
}

function parsePairingSecret(rawValue: string | undefined): string {
  const value = rawValue?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(
      "OPENCLAW_EXTENSION_PAIRING_SECRET must be the 64-character lowercase hexadecimal token emitted by pinned OpenClaw 2026.7.1."
    );
  }
  return value;
}

function parseStabilityMilliseconds(rawValue: string | undefined): number {
  const value = rawValue?.trim();
  const milliseconds = value ? Number(value) : 5_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1_000 || milliseconds > 30_000) {
    throw new Error(
      "VERA_REMOTE_EXTENSION_STABILITY_MS must be an integer from 1000 through 30000."
    );
  }
  return milliseconds;
}

export function parseRemoteExtensionProxySmokeEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>
): RemoteExtensionProxySmokeEnvironment {
  if (environment.VERA_REMOTE_EXTENSION_PROXY_SMOKE !== "1") {
    throw new Error("VERA_REMOTE_EXTENSION_PROXY_SMOKE must be exactly 1.");
  }
  return {
    enabled: true,
    extensionUrl: parseExtensionUrl(environment.OPENCLAW_EXTENSION_GATEWAY_URL),
    extensionOrigin: parseExtensionOrigin(environment.OPENCLAW_EXTENSION_ORIGIN),
    pairingSecret: parsePairingSecret(environment.OPENCLAW_EXTENSION_PAIRING_SECRET),
    stabilityMilliseconds: parseStabilityMilliseconds(
      environment.VERA_REMOTE_EXTENSION_STABILITY_MS
    )
  };
}

function invalidPairingSecret(secret: string): string {
  return `${secret[0] === "A" ? "B" : "A"}${secret.slice(1)}`;
}

function isExpectedHttpDenial(observation: SanitizedWebSocketObservation): boolean {
  return (
    observation.reachedOpen === false &&
    observation.httpStatus !== null &&
    observation.httpStatus >= 400 &&
    observation.httpStatus < 500
  );
}

function denialCode(observation: SanitizedWebSocketObservation): RemoteExtensionProxyCheck["code"] {
  if (observation.reachedOpen) return "unexpected_open";
  if (observation.errorCode === "timeout") return "timed_out";
  return isExpectedHttpDenial(observation) ? "expected_denial" : "connection_error";
}

export async function runRemoteExtensionProxySmoke(input: {
  readonly extensionUrl: string;
  readonly extensionOrigin: string;
  readonly pairingSecret: string;
  readonly stabilityMilliseconds?: number;
  readonly timeoutMilliseconds?: number;
  readonly transportRunner?: WebSocketTransportRunner;
}): Promise<RemoteExtensionProxySmokeResult> {
  const extensionUrl = parseExtensionUrl(input.extensionUrl);
  const extensionOrigin = parseExtensionOrigin(input.extensionOrigin);
  const pairingSecret = parsePairingSecret(input.pairingSecret);
  const stabilityMilliseconds = parseStabilityMilliseconds(input.stabilityMilliseconds?.toString());
  const timeoutMilliseconds = input.timeoutMilliseconds ?? stabilityMilliseconds + 5_000;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= stabilityMilliseconds ||
    timeoutMilliseconds > 40_000
  ) {
    throw new Error(
      "Remote extension smoke timeout must exceed the stability window and be at most 40000."
    );
  }
  const runner = input.transportRunner ?? runWebSocketTransportCase;
  const protocol = `${TOKEN_PROTOCOL_PREFIX}${pairingSecret}`;
  const wrongProtocol = `${TOKEN_PROTOCOL_PREFIX}${invalidPairingSecret(pairingSecret)}`;
  const common = {
    origin: extensionOrigin,
    stabilityMilliseconds,
    timeoutMilliseconds,
    payload: null
  } as const;

  const unrelated = await runner({
    ...common,
    caseId: "unrelated_route",
    url: unrelatedRouteFor(extensionUrl),
    protocols: [],
    credentialProtocolIndexes: []
  });
  const wrongSecret = await runner({
    ...common,
    caseId: "wrong_pairing_secret",
    url: extensionUrl,
    protocols: [RELAY_PROTOCOL, wrongProtocol],
    credentialProtocolIndexes: [1]
  });
  const valid = await runner({
    ...common,
    caseId: "correct_pairing_secret",
    url: extensionUrl,
    protocols: [RELAY_PROTOCOL, protocol],
    credentialProtocolIndexes: [1]
  });

  const checks: RemoteExtensionProxyCheck[] = [
    {
      id: "unrelated_websocket_route_denied",
      status: isExpectedHttpDenial(unrelated) ? "passed" : "failed",
      code: denialCode(unrelated)
    },
    {
      id: "wrong_pairing_secret_denied",
      status: isExpectedHttpDenial(wrongSecret) ? "passed" : "failed",
      code: denialCode(wrongSecret)
    },
    {
      id: "extension_wss_upgrade",
      status: valid.reachedOpen ? "passed" : "failed",
      code: valid.reachedOpen
        ? "opened"
        : valid.errorCode === "timeout"
          ? "timed_out"
          : "connection_error"
    },
    {
      id: "subprotocol_preserved",
      status: valid.selectedProtocol === RELAY_PROTOCOL ? "passed" : "failed",
      code:
        valid.selectedProtocol === RELAY_PROTOCOL
          ? "selected_expected_protocol"
          : "unexpected_protocol"
    },
    {
      id: "bounded_connection_stable",
      status:
        valid.reachedOpen &&
        valid.lifetimeMilliseconds >= stabilityMilliseconds &&
        valid.errorCode === "none"
          ? "passed"
          : "failed",
      code:
        valid.reachedOpen &&
        valid.lifetimeMilliseconds >= stabilityMilliseconds &&
        valid.errorCode === "none"
          ? "stable_for_bounded_window"
          : "closed_early"
    },
    {
      id: "client_close_completed",
      status: valid.closeCode === 1000 ? "passed" : "failed",
      code: valid.closeCode === 1000 ? "closed_by_client" : "closed_early"
    }
  ];
  return {
    outcome: checks.every(({ status }) => status === "passed") ? "passed" : "failed",
    checks,
    caseResults: [unrelated, wrongSecret, valid],
    observations: {
      route: EXTENSION_ROUTE,
      transport: "wss",
      originScheme: "chrome-extension",
      openClawRelayFrameLimitBytes: 67_108_864,
      stabilityWindowMilliseconds: stabilityMilliseconds,
      maritimePayloadLimit: "requires_private_provider_evidence",
      maritimeIdleTimeout: "requires_private_provider_evidence"
    }
  };
}

async function main(): Promise<void> {
  if (process.env.VERA_REMOTE_EXTENSION_PROXY_SMOKE !== "1") {
    process.stdout.write("Remote extension proxy smoke skipped: explicit live flag absent.\n");
    return;
  }
  const environment = parseRemoteExtensionProxySmokeEnvironment(process.env);
  const report = await runRemoteExtensionProxySmoke(environment);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
