import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const adapter = read("packages/connectors/src/openclaw-browser-execution.ts");
const runner = read("packages/connectors/src/openclaw-cli.ts");
const connectorPackage = read("packages/connectors/package.json");
const worker = read("apps/worker/src/acquisition-worker.ts");
const demo = read("packages/db/src/demo/index.ts");
const remotePlugin = read("infra/maritime/openclaw/vera-read-shared-tab/index.mjs");
const remoteConfig = read("infra/maritime/openclaw/remote-extension.openclaw.json5");
const remoteImage = read("infra/maritime/openclaw/remote-extension-image.json");
const remoteRouteFilter = read("infra/maritime/openclaw/remote-extension-route-filter.mjs");
const remoteClient = read("packages/connectors/src/maritime-remote-extension-client.ts");
const remoteService = read("apps/web/lib/remote-extension-snapshot-service.ts");
const remoteRoute = read("apps/web/app/api/integrations/remote-browser/snapshot/route.ts");
const environmentExample = read(".env.example");
const routes = [
  "apps/web/app/api/integrations/browser-agent/status/route.ts",
  "apps/web/app/api/integrations/browser-agent/controls/route.ts",
  "apps/web/app/api/integrations/browser-agent/captures/route.ts"
]
  .map(read)
  .join("\n");

const failures: string[] = [];
function requireText(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) failures.push(message);
}
function rejectText(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) failures.push(message);
}

requireText(
  adapter,
  /OPENCLAW_TESTED_VERSION\s*=\s*"2026\.6\.33"/u,
  "OpenClaw must remain pinned to the reviewed patched 2026.6.33 release."
);
rejectText(
  connectorPackage,
  /"openclaw"\s*:/u,
  "OpenClaw must remain outside the connector library; only the server-side worker may ship it."
);
requireText(
  adapter,
  /"browser\.proxy"/u,
  "The adapter must use the native browser.proxy node capability."
);
requireText(
  adapter,
  /path:\s*"\/tabs"/u,
  "The adapter must inspect the current tab through /tabs."
);
requireText(adapter, /path:\s*"\/snapshot"/u, "The adapter must capture through /snapshot.");
requireText(
  adapter,
  /method:\s*"GET",\s*path:\s*"\/tabs"/u,
  "The tab request must remain an exact GET /tabs operation."
);
requireText(
  adapter,
  /method:\s*"GET",\s*path:\s*"\/snapshot"/u,
  "The snapshot request must remain an exact GET /snapshot operation."
);
rejectText(
  adapter,
  /method:\s*"(?:POST|PUT|PATCH|DELETE)"/u,
  "The adapter contains a mutating HTTP proxy method."
);
rejectText(
  adapter,
  /path:\s*"\/(?:navigate|open|click|type|evaluate|cookies?|storage|upload|download)/iu,
  "The current-tab adapter contains a forbidden browser operation."
);
rejectText(worker, /\.navigate\s*\(/u, "The acquisition worker must never navigate.");
rejectText(
  worker,
  /\.(?:send|apply|pay|compose|contact)\s*\(/iu,
  "The acquisition worker contains a forbidden side-effect call."
);
rejectText(
  routes,
  /(?:gatewayToken|OPENCLAW_GATEWAY_TOKEN|cookie|password|authorizationCode)/u,
  "A browser-agent route references secret browser material."
);
rejectText(
  demo,
  /OpenClawBrowserExecutionProvider|OPENCLAW_GATEWAY/u,
  "The deterministic demo must not compose the real OpenClaw provider."
);
requireText(runner, /shell:\s*false/u, "OpenClaw process execution must never use a shell.");
requireText(
  remoteImage,
  /"openclawVersion":\s*"2026\.7\.1"/u,
  "The direct remote extension must remain pinned to OpenClaw 2026.7.1."
);
requireText(
  remoteImage,
  /ghcr\.io\/openclaw\/openclaw@sha256:[a-f0-9]{64}/u,
  "The direct remote extension image must remain immutable."
);
requireText(
  remoteImage,
  /"publicationState":\s*"published"[\s\S]*"releaseIndex":\s*"ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4"[\s\S]*"runtimeManifest":\s*"ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a"[\s\S]*"runtimeSelectionState":\s*"diagnostic_pending"[\s\S]*"deployableBeforeLiveProxyAcceptance":\s*false/u,
  "The published route-isolation index and child must remain blocked pending live acceptance."
);
requireText(
  remoteConfig,
  /controlUi:\s*\{[\s\S]*?enabled:\s*false/iu,
  "The direct remote Gateway Control UI must remain disabled."
);
requireText(
  remoteConfig,
  /gateway:\s*\{[\s\S]*?port:\s*18790[\s\S]*?bind:\s*"loopback"/iu,
  "The general OpenClaw Gateway must remain loopback-only on port 18790."
);
requireText(
  remoteConfig,
  /browser:\s*\{[\s\S]*?evaluateEnabled:\s*false/iu,
  "The direct remote Gateway must keep browser evaluation disabled."
);
requireText(
  remotePlugin,
  /method:\s*"GET"[\s\S]*?\/tabs\?profile=/u,
  "The consent-tab tool must inspect shared tabs with GET /tabs."
);
requireText(
  remotePlugin,
  /method:\s*"GET"[\s\S]*?\/snapshot\?/u,
  "The consent-tab tool must read the snapshot with GET /snapshot."
);
rejectText(
  remotePlugin,
  /method:\s*"(?:POST|PUT|PATCH|DELETE)"/u,
  "The consent-tab tool contains a mutating loopback method."
);
requireText(
  remoteRouteFilter,
  /request\.url\s*!==\s*EXTENSION_ROUTE/u,
  "The public browser Gateway filter must require the exact extension route."
);
requireText(
  remoteRouteFilter,
  /request\.rawHeaders/u,
  "The public browser Gateway filter must preserve raw upgrade headers."
);
rejectText(
  remoteRouteFilter,
  /request\.url\.(?:startsWith|includes|endsWith)\(/u,
  "The public browser Gateway filter must not use partial route matching."
);
requireText(
  remoteClient,
  /MARITIME_BROWSER_GATEWAY_API_KEY/u,
  "The remote browser client must use a dedicated browser-Gateway API key."
);
requireText(
  remoteClient,
  /MARITIME_BROWSER_GATEWAY_AGENT_ID/u,
  "The remote browser client must use a dedicated browser-Gateway agent ID."
);
rejectText(
  remoteClient,
  /environment\.MARITIME_API_KEY|environment\.MARITIME_OPENCLAW_AGENT_ID/u,
  "The remote browser client must not reuse live-search credentials."
);
requireText(
  remoteService,
  /VERA_BROWSER_GATEWAY_FOUNDER_USER_ID/u,
  "The remote browser service must bind one exact founder to the dedicated Gateway."
);
requireText(
  environmentExample,
  /MARITIME_BROWSER_GATEWAY_API_KEY=[\r\n]/u,
  "The environment example must declare the server-only browser-Gateway API key."
);
rejectText(
  environmentExample,
  /NEXT_PUBLIC_(?:MARITIME_BROWSER_GATEWAY|VERA_REMOTE_EXTENSION|OPENCLAW_EXTENSION)/u,
  "Remote browser credentials must never use a public environment prefix."
);
requireText(
  remoteRoute,
  /requireVeraSession[\s\S]*assertSameOriginMutation[\s\S]*readBoundedJson/u,
  "The remote browser route must authenticate, enforce same origin, and bound input."
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Browser security boundaries verified.\n");
}
