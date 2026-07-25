import { pathToFileURL } from "node:url";

const RELAY_PROTOCOL = "openclaw-extension-relay";
const TOKEN_PROTOCOL_PREFIX = "openclaw-extension-token.";
const EXTENSION_ROUTE = "/browser/extension";
const MARITIME_EXTENSION_ROUTE = new RegExp(
  String.raw`^/a/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${EXTENSION_ROUTE}$`,
  "u"
);
const UNRELATED_ROUTE = "/__vera_remote_extension_unrelated__";

export interface RemoteExtensionProxySmokeEnvironment {
  readonly enabled: true;
  readonly extensionUrl: string;
  readonly pairingSecret: string;
  readonly stabilityMilliseconds: number;
}

export type SmokeSocketEvent = "open" | "close" | "error";

export interface SmokeSocket {
  readonly protocol: string;
  addEventListener(
    type: SmokeSocketEvent,
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  close(code?: number, reason?: string): void;
}

export type SmokeSocketFactory = (url: string, protocols: readonly string[]) => SmokeSocket;

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
  readonly observations: {
    readonly route: "/browser/extension";
    readonly transport: "wss";
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
    pairingSecret: parsePairingSecret(environment.OPENCLAW_EXTENSION_PAIRING_SECRET),
    stabilityMilliseconds: parseStabilityMilliseconds(
      environment.VERA_REMOTE_EXTENSION_STABILITY_MS
    )
  };
}

function invalidPairingSecret(secret: string): string {
  return `${secret[0] === "A" ? "B" : "A"}${secret.slice(1)}`;
}

interface SocketObservation {
  readonly state: "opened" | "denied" | "error" | "timed_out";
  readonly selectedProtocol: string;
  readonly stable: boolean;
  readonly clientClosed: boolean;
}

async function observeSocket(input: {
  readonly factory: SmokeSocketFactory;
  readonly url: string;
  readonly protocols: readonly string[];
  readonly expectOpen: boolean;
  readonly stabilityMilliseconds: number;
  readonly timeoutMilliseconds: number;
}): Promise<SocketObservation> {
  return await new Promise<SocketObservation>((resolve) => {
    let settled = false;
    let opened = false;
    let stabilityTimer: ReturnType<typeof setTimeout> | undefined;
    const socket = input.factory(input.url, input.protocols);

    const finish = (observation: SocketObservation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      resolve(observation);
    };
    const timeoutTimer = setTimeout(() => {
      socket.close(1000, "bounded-smoke-timeout");
      finish({
        state: "timed_out",
        selectedProtocol: socket.protocol,
        stable: false,
        clientClosed: true
      });
    }, input.timeoutMilliseconds);

    socket.addEventListener(
      "open",
      () => {
        opened = true;
        if (!input.expectOpen) {
          socket.close(1000, "unexpected-open");
          finish({
            state: "opened",
            selectedProtocol: socket.protocol,
            stable: false,
            clientClosed: true
          });
          return;
        }
        stabilityTimer = setTimeout(() => {
          socket.close(1000, "bounded-smoke-complete");
          finish({
            state: "opened",
            selectedProtocol: socket.protocol,
            stable: true,
            clientClosed: true
          });
        }, input.stabilityMilliseconds);
      },
      { once: true }
    );
    socket.addEventListener(
      "close",
      () => {
        if (!opened && !input.expectOpen) {
          finish({
            state: "denied",
            selectedProtocol: socket.protocol,
            stable: false,
            clientClosed: false
          });
        } else if (!settled) {
          finish({
            state: "error",
            selectedProtocol: socket.protocol,
            stable: false,
            clientClosed: false
          });
        }
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        if (!opened && !input.expectOpen) {
          finish({
            state: "denied",
            selectedProtocol: socket.protocol,
            stable: false,
            clientClosed: false
          });
        } else if (!settled) {
          finish({
            state: "error",
            selectedProtocol: socket.protocol,
            stable: false,
            clientClosed: false
          });
        }
      },
      { once: true }
    );
  });
}

function nativeSocketFactory(url: string, protocols: readonly string[]): SmokeSocket {
  const socket = new WebSocket(url, [...protocols]);
  return {
    get protocol() {
      return socket.protocol;
    },
    addEventListener(type, listener, options) {
      socket.addEventListener(type, listener, options);
    },
    close(code, reason) {
      socket.close(code, reason);
    }
  };
}

export async function runRemoteExtensionProxySmoke(input: {
  readonly extensionUrl: string;
  readonly pairingSecret: string;
  readonly stabilityMilliseconds?: number;
  readonly timeoutMilliseconds?: number;
  readonly socketFactory?: SmokeSocketFactory;
}): Promise<RemoteExtensionProxySmokeResult> {
  const extensionUrl = parseExtensionUrl(input.extensionUrl);
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
  const factory = input.socketFactory ?? nativeSocketFactory;
  const unrelatedUrl = unrelatedRouteFor(extensionUrl);
  const unrelated = await observeSocket({
    factory,
    url: unrelatedUrl,
    protocols: [],
    expectOpen: false,
    stabilityMilliseconds,
    timeoutMilliseconds
  });
  const wrongSecret = await observeSocket({
    factory,
    url: extensionUrl,
    protocols: [RELAY_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${invalidPairingSecret(pairingSecret)}`],
    expectOpen: false,
    stabilityMilliseconds,
    timeoutMilliseconds
  });
  const valid = await observeSocket({
    factory,
    url: extensionUrl,
    protocols: [RELAY_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${pairingSecret}`],
    expectOpen: true,
    stabilityMilliseconds,
    timeoutMilliseconds
  });

  const checks: RemoteExtensionProxyCheck[] = [
    {
      id: "unrelated_websocket_route_denied",
      status: unrelated.state === "denied" ? "passed" : "failed",
      code:
        unrelated.state === "denied"
          ? "expected_denial"
          : unrelated.state === "opened"
            ? "unexpected_open"
            : unrelated.state === "timed_out"
              ? "timed_out"
              : "connection_error"
    },
    {
      id: "wrong_pairing_secret_denied",
      status: wrongSecret.state === "denied" ? "passed" : "failed",
      code:
        wrongSecret.state === "denied"
          ? "expected_denial"
          : wrongSecret.state === "opened"
            ? "unexpected_open"
            : wrongSecret.state === "timed_out"
              ? "timed_out"
              : "connection_error"
    },
    {
      id: "extension_wss_upgrade",
      status: valid.state === "opened" ? "passed" : "failed",
      code:
        valid.state === "opened"
          ? "opened"
          : valid.state === "timed_out"
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
      status: valid.stable ? "passed" : "failed",
      code: valid.stable ? "stable_for_bounded_window" : "closed_early"
    },
    {
      id: "client_close_completed",
      status: valid.clientClosed ? "passed" : "failed",
      code: valid.clientClosed ? "closed_by_client" : "closed_early"
    }
  ];
  return {
    outcome: checks.every(({ status }) => status === "passed") ? "passed" : "failed",
    checks,
    observations: {
      route: EXTENSION_ROUTE,
      transport: "wss",
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
