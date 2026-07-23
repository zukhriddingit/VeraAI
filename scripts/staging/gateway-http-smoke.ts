import { pathToFileURL } from "node:url";

export const GATEWAY_HTTP_CHECKS = [
  { id: "control_ui_disabled", method: "GET", path: "/", expectedStatuses: [404] },
  {
    id: "chat_api_disabled",
    method: "POST",
    path: "/v1/chat/completions",
    expectedStatuses: [401, 404]
  },
  {
    id: "responses_api_disabled",
    method: "POST",
    path: "/v1/responses",
    expectedStatuses: [401, 404]
  },
  {
    id: "tools_unauthorized",
    method: "POST",
    path: "/tools/invoke",
    expectedStatuses: [401, 403]
  },
  {
    id: "canvas_absent",
    method: "GET",
    path: "/__openclaw__/canvas/",
    expectedStatuses: [404]
  },
  {
    id: "a2ui_absent",
    method: "GET",
    path: "/__openclaw__/a2ui/",
    expectedStatuses: [404]
  }
] as const;

export type GatewayHttpCheckId = (typeof GATEWAY_HTTP_CHECKS)[number]["id"];
export type GatewayFetch = (input: string | URL, init: RequestInit) => Promise<Response>;

export interface GatewayHttpSmokeEnvironment {
  readonly enabled: true;
  readonly gatewayUrl: string;
}

export interface GatewayHttpCheckResult {
  readonly id: GatewayHttpCheckId;
  readonly status: "passed" | "failed";
  readonly code:
    | "expected_denial"
    | "unexpected_success"
    | "unexpected_redirect"
    | "unexpected_status"
    | "request_timed_out"
    | "request_failed";
  readonly observedStatus?: number;
}

export interface GatewayHttpSmokeResult {
  readonly outcome: "passed" | "failed";
  readonly checks: readonly GatewayHttpCheckResult[];
}

function cleanHttpsOrigin(rawValue: string | undefined, name: string): string {
  const value = rawValue?.trim() ?? "";
  if (!value) throw new Error(`${name} is required.`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS or WSS.`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials.`);
  if (url.search || url.hash) throw new Error(`${name} must not contain a query or fragment.`);
  if (url.pathname !== "/") throw new Error(`${name} must be an origin without a path.`);
  return url.href;
}

export function parseGatewayHttpSmokeEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>
): GatewayHttpSmokeEnvironment {
  if (environment.VERA_GATEWAY_HTTP_SMOKE !== "1") {
    throw new Error("VERA_GATEWAY_HTTP_SMOKE must be exactly 1.");
  }
  return {
    enabled: true,
    gatewayUrl: cleanHttpsOrigin(environment.OPENCLAW_GATEWAY_URL, "OPENCLAW_GATEWAY_URL")
  };
}

function requestBody(id: GatewayHttpCheckId): string {
  const body = JSON.stringify({ probe: "vera_unauthenticated_gateway_smoke", check: id });
  if (new TextEncoder().encode(body).byteLength > 1024) {
    throw new Error("Gateway smoke request body exceeds 1 KiB.");
  }
  return body;
}

function classifyStatus(
  check: (typeof GATEWAY_HTTP_CHECKS)[number],
  status: number
): GatewayHttpCheckResult {
  if ((check.expectedStatuses as readonly number[]).includes(status)) {
    return { id: check.id, status: "passed", code: "expected_denial", observedStatus: status };
  }
  if (status >= 200 && status < 300) {
    return { id: check.id, status: "failed", code: "unexpected_success", observedStatus: status };
  }
  if (status >= 300 && status < 400) {
    return {
      id: check.id,
      status: "failed",
      code: "unexpected_redirect",
      observedStatus: status
    };
  }
  return { id: check.id, status: "failed", code: "unexpected_status", observedStatus: status };
}

async function runCheck(input: {
  readonly gatewayUrl: string;
  readonly check: (typeof GATEWAY_HTTP_CHECKS)[number];
  readonly fetchImplementation: GatewayFetch;
  readonly timeoutMilliseconds: number;
}): Promise<GatewayHttpCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMilliseconds);
  const headers = new Headers({ accept: "application/json" });
  const init: RequestInit = {
    method: input.check.method,
    headers,
    redirect: "error",
    signal: controller.signal
  };
  if (input.check.method === "POST") {
    headers.set("content-type", "application/json");
    init.body = requestBody(input.check.id);
  }

  try {
    const url = new URL(input.check.path, input.gatewayUrl);
    const response = await input.fetchImplementation(url, init);
    return classifyStatus(input.check, response.status);
  } catch {
    return {
      id: input.check.id,
      status: "failed",
      code: controller.signal.aborted ? "request_timed_out" : "request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runGatewayHttpSmoke(input: {
  readonly gatewayUrl: string;
  readonly fetchImplementation?: GatewayFetch;
  readonly timeoutMilliseconds?: number;
}): Promise<GatewayHttpSmokeResult> {
  const gatewayUrl = cleanHttpsOrigin(input.gatewayUrl, "gatewayUrl");
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 5000;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 5000
  ) {
    throw new Error("Gateway smoke timeout must be between 1 and 5000 milliseconds.");
  }
  const fetchImplementation = input.fetchImplementation ?? (fetch as GatewayFetch);
  const checks: GatewayHttpCheckResult[] = [];
  for (const check of GATEWAY_HTTP_CHECKS) {
    checks.push(await runCheck({ gatewayUrl, check, fetchImplementation, timeoutMilliseconds }));
  }
  return {
    outcome: checks.every(({ status }) => status === "passed") ? "passed" : "failed",
    checks
  };
}

async function main(): Promise<void> {
  if (process.env.VERA_GATEWAY_HTTP_SMOKE !== "1") {
    process.stdout.write("Gateway HTTP smoke skipped: explicit live flag absent.\n");
    return;
  }
  const environment = parseGatewayHttpSmokeEnvironment(process.env);
  const report = await runGatewayHttpSmoke({ gatewayUrl: environment.gatewayUrl });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
