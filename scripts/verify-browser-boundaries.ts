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
const zillowResearchPlugin = read("infra/maritime/openclaw/vera-zillow-rental-research/index.mjs");
const zillowResearchContract = read(
  "infra/maritime/openclaw/vera-zillow-rental-research/contract.mjs"
);
const zillowResearchSnapshot = read(
  "infra/maritime/openclaw/vera-zillow-rental-research/zillow-snapshot.mjs"
);
const browserResearchPlugin = read("infra/maritime/openclaw/vera-browser-research/index.mjs");
const browserResearchContract = read("infra/maritime/openclaw/vera-browser-research/contract.mjs");
const browserResearchSnapshot = read(
  "infra/maritime/openclaw/vera-browser-research/source-snapshot.mjs"
);
const remoteConfig = read("infra/maritime/openclaw/remote-extension.openclaw.json5");
const remoteImage = read("infra/maritime/openclaw/remote-extension-image.json");
const remoteRouteFilter = read("infra/maritime/openclaw/remote-extension-route-filter.mjs");
const remoteEnrollment = read("infra/maritime/openclaw/remote-extension-enrollment.mjs");
const remoteClient = read("packages/connectors/src/maritime-remote-extension-client.ts");
const remoteService = read("apps/web/lib/remote-extension-snapshot-service.ts");
const rentalResearchService = read("apps/web/lib/rental-research-service.ts");
const listingEnrichmentService = read("apps/web/lib/listing-enrichment-service.ts");
const remoteRoute = read("apps/web/app/api/integrations/remote-browser/snapshot/route.ts");
const zillowCheckpointRoute = read(
  "apps/web/app/api/internal/browser-research/checkpoint/route.ts"
);
const enrollmentCheckpointRoute = read(
  "apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.ts"
);
const enrollmentService = read("apps/web/lib/browser-connector-enrollment-service.ts");
const extensionEnrollment = read("infra/chrome/vera-openclaw-extension/modules/enrollment.js");
const extensionBridge = read("infra/chrome/vera-openclaw-extension/readiness-bridge.js");
const zillowCheckpointService = read("apps/web/lib/zillow-research-checkpoint-service.ts");
const browserResearchCheckpointService = read(
  "apps/web/lib/browser-research-checkpoint-service.ts"
);
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
  /"publicationState":\s*"published"[\s\S]*"releaseIndex":\s*"ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec"[\s\S]*"runtimeManifest":\s*"ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8"[\s\S]*"runtimeSelectionState":\s*"diagnostic_pending"[\s\S]*"deployableBeforeLiveProxyAcceptance":\s*false/u,
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
  zillowResearchContract,
  /TOOL_NAME\s*=\s*"vera_zillow_rental_research_v1"/u,
  "The bounded Zillow tool must keep its reviewed versioned name."
);
requireText(
  zillowResearchContract,
  /MAX_RESULTS\s*=\s*10[\s\S]*MAX_DETAIL_PAGES\s*=\s*5[\s\S]*MAX_RESULT_EXPANSIONS\s*=\s*2[\s\S]*MAX_DURATION_MS\s*=\s*90_000/u,
  "The bounded Zillow tool must keep its 10/5/2/90-second limits."
);
requireText(
  zillowResearchPlugin,
  /authorizeAction\("verify_shared_tab"[\s\S]*browserGet\([\s\S]*\/tabs\?profile=[\s\S]*authorizeAction\(action/u,
  "Every Zillow browser action must be surrounded by the Vera checkpoint and exact-tab recheck."
);
requireText(
  zillowResearchPlugin,
  /path !== "\/navigate" && path !== "\/act"/u,
  "The bounded tool may mutate only through the fixed navigate and act loopback routes."
);
requireText(
  zillowResearchPlugin,
  /new Set\(\["click", "type"\]\)[\s\S]*kind: "scrollIntoView"/u,
  "The bounded tool may act only through reviewed semantic click, type, and scroll operations."
);
requireText(
  zillowResearchSnapshot,
  /hostname\.toLowerCase\(\) !== "www\.zillow\.com"[\s\S]*RESULT_PATH_PATTERNS[\s\S]*DETAIL_PATH_PATTERN/u,
  "The bounded tool must enforce the exact reviewed Zillow rental and detail surfaces."
);
rejectText(
  [zillowResearchPlugin, zillowResearchContract, zillowResearchSnapshot].join("\n"),
  /["'`]\/(?:screenshot|download|upload|cookies?|storage|pdf|dialog)(?:[/?'"`])/iu,
  "The bounded Zillow tool contains a forbidden browser-control route."
);
rejectText(
  [zillowResearchPlugin, zillowResearchContract, zillowResearchSnapshot].join("\n"),
  /\b(?:eval|Function)\s*\(|\b(?:selector|javascript|clickCoords)\s*:/u,
  "The bounded Zillow tool contains arbitrary evaluation, selector, script, or coordinate input."
);
requireText(
  browserResearchContract,
  /TOOL_NAME\s*=\s*"vera_browser_research_v1"[\s\S]*MAX_RESULTS\s*=\s*10[\s\S]*MAX_DETAIL_PAGES\s*=\s*5[\s\S]*MAX_ACTIONS\s*=\s*50[\s\S]*MAX_DURATION_MS\s*=\s*90_000/u,
  "The generic browser tool must keep its reviewed signed 10/5/50/90-second contract."
);
requireText(
  browserResearchContract,
  /createHmac[\s\S]*timingSafeEqual[\s\S]*plan_signature_invalid/u,
  "The generic browser tool must verify the server-signed plan before any browser action."
);
requireText(
  browserResearchPlugin,
  /authorize\("inspect_shared_tabs"[\s\S]*browserGet\([\s\S]*\/tabs\?profile=[\s\S]*authorize\(action/u,
  "Every generic browser action must be surrounded by a checkpoint and exact shared-tab recheck."
);
requireText(
  browserResearchPlugin,
  /path !== "\/navigate" && path !== "\/act"[\s\S]*\["click", "type", "scrollIntoView"\]/u,
  "The generic tool may use only fixed navigation and semantic click, fill, and scroll operations."
);
requireText(
  browserResearchSnapshot,
  /FORBIDDEN_CONTROL[\s\S]*seller\\s\+profile/u,
  "The source observers must reject lead, messaging, account, and seller-profile controls."
);
rejectText(
  [browserResearchPlugin, browserResearchContract, browserResearchSnapshot].join("\n"),
  /["'`]\/(?:screenshot|download|upload|cookies?|storage|pdf|dialog)(?:[/?'"`])/iu,
  "The generic browser tool contains a forbidden browser-control route."
);
rejectText(
  [browserResearchPlugin, browserResearchContract, browserResearchSnapshot].join("\n"),
  /\b(?:eval|Function)\s*\(|\b(?:selector|javascript|clickCoords)\s*:/u,
  "The generic browser tool contains arbitrary evaluation, selector, script, or coordinate input."
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
  remoteRouteFilter,
  /protocols\.includes\(ENROLLMENT_PROTOCOL\)[\s\S]*handleEnrollmentUpgrade\([\s\S]*return;[\s\S]*const upstream = connect\(/u,
  "Enrollment upgrades must terminate locally before the normal OpenClaw relay path."
);
requireText(
  remoteEnrollment,
  /ENROLLMENT_PROTOCOL\s*=\s*"vera-browser-enrollment\.v1"[\s\S]*EXTENSION_ROUTE\s*=\s*"\/browser\/extension"[\s\S]*MAX_FRAME_BYTES\s*=\s*4_096[\s\S]*ENROLLMENT_TIMEOUT_MILLISECONDS\s*=\s*10_000/u,
  "Browser enrollment must keep its exact protocol, route, payload, and timeout bounds."
);
requireText(
  remoteEnrollment,
  /new WebSocketServer\(\{[\s\S]*noServer:\s*true[\s\S]*maxPayload:\s*MAX_FRAME_BYTES[\s\S]*perMessageDeflate:\s*false/u,
  "Browser enrollment WebSocket handling must remain bounded and compression-free."
);
requireText(
  remoteEnrollment,
  /await fetchImplementation\([\s\S]*parseCheckpointDecision\([\s\S]*readCredentialImplementation\(\)/u,
  "The Gateway must authorize enrollment before reading the relay credential."
);
requireText(
  remoteEnrollment,
  /constants\.O_RDONLY\s*\|\s*constants\.O_NOFOLLOW[\s\S]*\(stat\.mode & 0o777\) !== 0o600/u,
  "The Gateway must read the fixed relay credential without following symlinks and require mode 0600."
);
rejectText(
  remoteEnrollment,
  /(?:console\.(?:debug|info|log|warn|error)|process\.(?:stdout|stderr)\.write)\s*\([\s\S]{0,300}(?:ticket|token|credential|headers|frame)/iu,
  "Browser enrollment must not log tickets, tokens, credentials, headers, or frames."
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
rejectText(
  [
    rentalResearchService,
    listingEnrichmentService,
    remoteService,
    zillowCheckpointRoute,
    zillowCheckpointService,
    browserResearchCheckpointService
  ].join("\n"),
  /VERA_BROWSER_GATEWAY_FOUNDER_USER_ID|MARITIME_BROWSER_GATEWAY_(?:AGENT_ID|API_KEY)|VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN|VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_(?:URL|TOKEN)/u,
  "Active browser services must not reference a global founder, Gateway, checkpoint, or local-bridge fallback."
);
requireText(
  remoteService,
  /browserRuntime\?\.assignment\.userId === userId[\s\S]*MaritimeRemoteExtensionClient/u,
  "The remote browser service must construct its client from the exact user's assignment."
);
requireText(
  environmentExample,
  /MARITIME_BROWSER_GATEWAY_API_KEY=[\r\n]/u,
  "The environment example must declare the server-only browser-Gateway API key."
);
requireText(
  environmentExample,
  /VERA_ZILLOW_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_BROWSER_RESEARCH_CHECKPOINT_URL=[\r\n]+(?:#[^\r\n]*[\r\n]+)?VERA_BROWSER_RESEARCH_CHECKPOINT_ORIGIN=[\r\n]+VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN=/u,
  "The bounded Zillow tool must remain disabled by default with server-only checkpoint configuration."
);
requireText(
  environmentExample,
  /VERA_APARTMENTS_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_FACEBOOK_MARKETPLACE_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_BU_OFF_CAMPUS_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_GENERIC_HOUSING_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_CRAIGSLIST_BROWSER_RESEARCH_ENABLED=0[\s\S]*VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY=/u,
  "The additional browser sources must remain disabled by default and require a server-only signing key."
);
requireText(
  environmentExample,
  /VERA_BROWSER_ENROLLMENT_ENABLED=0[\s\S]*VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL=[\r\n]+VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN=/u,
  "One-click Browser Connector enrollment must stay disabled by default with server-only endpoints."
);
rejectText(
  environmentExample,
  /NEXT_PUBLIC_(?:MARITIME_BROWSER_GATEWAY|VERA_REMOTE_EXTENSION|OPENCLAW_EXTENSION|VERA_BROWSER_ENROLLMENT)/u,
  "Remote browser credentials must never use a public environment prefix."
);
requireText(
  remoteRoute,
  /requireVeraSession[\s\S]*assertSameOriginMutation[\s\S]*readBoundedJson/u,
  "The remote browser route must authenticate, enforce same origin, and bound input."
);
requireText(
  zillowCheckpointRoute,
  /authenticateCheckpoint[\s\S]*readBoundedJson[\s\S]*repositoryProvider\.forUser\(resolved\.userId\)/u,
  "The Gateway checkpoint route must resolve a credential owner before bounded input and tenant repository selection."
);
requireText(
  enrollmentCheckpointRoute,
  /requireEnrollmentCheckpoint[\s\S]*authenticateEnrollmentCheckpoint[\s\S]*export async function POST[\s\S]*requireEnrollmentCheckpoint\([\s\S]*readBoundedJson[\s\S]*repositoryProvider\.forUser\(resolved\.userId\)/u,
  "The enrollment checkpoint must authenticate the assignment before bounded input and tenant selection."
);
requireText(
  enrollmentService,
  /randomBytes\(32\)[\s\S]*digestEnrollmentSecret\(ticket\)[\s\S]*60_000/u,
  "The web enrollment service must issue a 256-bit, digest-only, 60-second ticket."
);
rejectText(
  enrollmentService,
  /secretStore\.resolve|OPENCLAW_EXTENSION_PAIRING_SEED|browser-extension-relay\.secret/u,
  "The web enrollment service must not resolve the durable relay credential."
);
requireText(
  extensionEnrollment,
  /new WebSocket\(url, protocol\)[\s\S]*socket\.send\(frame\)[\s\S]*parseEnrollmentResponse/u,
  "The extension must send the one-time ticket only in the bounded first WebSocket frame."
);
rejectText(
  extensionEnrollment,
  /[?&](?:ticket|token)=|document\.cookie|localStorage|sessionStorage|fetch\s*\(/u,
  "The extension enrollment transport must not put secrets in URLs, web storage, cookies, or fetch headers."
);
requireText(
  extensionBridge,
  /event\.source !== window \|\| event\.origin !== window\.location\.origin/u,
  "The Vera page bridge must accept enrollment only from the same window and exact origin."
);
requireText(
  zillowCheckpointService,
  /assignmentAuthorized[\s\S]*sourceEnabled[\s\S]*browserKillSwitchActive[\s\S]*runActive[\s\S]*cancelled/u,
  "The checkpoint service must re-evaluate assignment, source, kill-switch, run, and cancellation state."
);
rejectText(
  zillowCheckpointService,
  /rawPageContent|snapshot\s*:|cookie|password/u,
  "The checkpoint service must not accept or persist raw browser or credential material."
);
requireText(
  browserResearchCheckpointService,
  /assignmentAuthorized[\s\S]*sourceEnabled[\s\S]*browserKillSwitchActive[\s\S]*runActive[\s\S]*cancelled[\s\S]*planSignatureValid/u,
  "The generic checkpoint must re-evaluate assignment, source, kill switch, run, cancellation, and plan signature."
);
rejectText(
  browserResearchCheckpointService,
  /rawPageContent|snapshot\s*:|cookie|password/u,
  "The generic checkpoint must not accept or persist raw browser or credential material."
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Browser security boundaries verified.\n");
}
