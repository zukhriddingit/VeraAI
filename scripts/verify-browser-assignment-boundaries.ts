import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BrowserAssignmentBoundarySources {
  readonly activeServices: string;
  readonly dispatchRoutes: readonly string[];
  readonly checkpointRoute: string;
  readonly assignmentMigration: string;
  readonly runtimeResolver: string;
  readonly gatewayRuntimeManifest: string;
}

const GLOBAL_FALLBACK =
  /VERA_BROWSER_GATEWAY_FOUNDER_USER_ID|MARITIME_BROWSER_GATEWAY_(?:AGENT_ID|API_KEY)|VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN|VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_(?:URL|TOKEN)/u;
const DEPENDENCY_CREATION =
  /create(?:RentalResearch|ListingEnrichment|RemoteExtensionSnapshot)Dependencies\s*\(/gu;
const ACCEPTED_GATEWAY_DIGEST =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde";

export function findBrowserAssignmentViolations(
  sources: BrowserAssignmentBoundarySources
): readonly string[] {
  const violations: string[] = [];
  if (GLOBAL_FALLBACK.test(sources.activeServices)) {
    violations.push("Browser services must not select a global Gateway fallback.");
  }
  for (const route of sources.dispatchRoutes) {
    for (const match of route.matchAll(DEPENDENCY_CREATION)) {
      const creation = match.index;
      const resolution = route.lastIndexOf("browserGatewayRuntime?.resolveForUser", creation);
      if (resolution < 0 || resolution > creation) {
        violations.push("Browser dispatch must resolve the authenticated user's assignment first.");
        break;
      }
    }
  }
  const postHandler = sources.checkpointRoute.slice(
    sources.checkpointRoute.indexOf("export async function POST")
  );
  const resolverAuthentication = sources.checkpointRoute.indexOf("authenticateCheckpoint(");
  const assignedCheckpoint = postHandler.indexOf("requireAssignedCheckpoint(");
  const bodyRead = postHandler.indexOf("readBoundedJson(");
  const tenantLookup = postHandler.indexOf("repositoryProvider.forUser(resolved.userId)");
  if (
    resolverAuthentication < 0 ||
    assignedCheckpoint < 0 ||
    bodyRead < 0 ||
    tenantLookup < 0 ||
    assignedCheckpoint > bodyRead ||
    bodyRead > tenantLookup
  ) {
    violations.push("Checkpoint owner must resolve before body parsing and tenant repositories.");
  }

  const assignmentTable =
    /CREATE TABLE "browser_gateway_assignments" \(([\s\S]*?)\n\);/u.exec(
      sources.assignmentMigration
    )?.[1] ?? "";
  if (!assignmentTable) {
    violations.push("Browser assignment persistence must remain explicit and reviewable.");
  } else {
    const columnNames = [...assignmentTable.matchAll(/^\s*"([a-z0-9_]+)"\s/gmu)].map(
      (match) => match[1]!
    );
    const unsafe = columnNames.filter(
      (name) =>
        /secret|token|api_key|signing_key/u.test(name) &&
        name !== "secret_reference" &&
        !name.endsWith("_digest")
    );
    if (unsafe.length > 0) {
      violations.push("Browser assignment persistence must not contain raw secret columns.");
    }
  }

  for (const required of [
    "VERA_BETA_ACCESS_GATE_ENABLED",
    "VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED",
    "VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION",
    "VERA_BROWSER_BETA_USER_IDS",
    "isActiveUser(",
    "getActiveForUser(",
    "userBrowserEnabled",
    'pairingState !== "paired"',
    'capabilityApprovalState !== "approved"',
    "heartbeatExpiresAt",
    "browserProfileControls.get(",
    "listEnabledConnectorIdsForUser(",
    "secretStore.resolve("
  ]) {
    if (!sources.runtimeResolver.includes(required)) {
      violations.push(`Browser runtime resolver is missing required gate: ${required}`);
    }
  }
  if (!sources.gatewayRuntimeManifest.includes(ACCEPTED_GATEWAY_DIGEST)) {
    violations.push("Browser beta runtime must pin the accepted immutable Gateway digest.");
  }
  if (/gatewayImage"\s*:\s*"[^"]+:(?:latest|main|stable)"/u.test(sources.gatewayRuntimeManifest)) {
    violations.push("Browser beta runtime must not use a mutable Gateway image tag.");
  }
  return [...new Set(violations)];
}

function loadSources(root: string): BrowserAssignmentBoundarySources {
  const read = (path: string) => readFileSync(resolve(root, path), "utf8");
  return {
    activeServices: [
      "apps/web/lib/rental-research-service.ts",
      "apps/web/lib/listing-enrichment-service.ts",
      "apps/web/lib/remote-extension-snapshot-service.ts",
      "apps/web/lib/browser-research-checkpoint-service.ts",
      "apps/web/lib/zillow-research-checkpoint-service.ts",
      "apps/web/app/api/internal/browser-research/checkpoint/route.ts"
    ]
      .map(read)
      .join("\n"),
    dispatchRoutes: [
      "apps/web/app/api/live-search/route.ts",
      "apps/web/app/api/live-search/[id]/stop/route.ts",
      "apps/web/app/api/listings/[id]/route.ts",
      "apps/web/app/api/listings/[id]/enrichment/route.ts",
      "apps/web/app/api/listings/[id]/shortlist/route.ts",
      "apps/web/app/api/listings/enrichment/top/route.ts",
      "apps/web/app/api/integrations/remote-browser/snapshot/route.ts"
    ].map(read),
    checkpointRoute: read("apps/web/app/api/internal/browser-research/checkpoint/route.ts"),
    assignmentMigration: read("packages/db/drizzle/0008_browser_gateway_assignments.sql"),
    runtimeResolver: read("apps/web/lib/server/browser-gateway-runtime-resolver.ts"),
    gatewayRuntimeManifest: read("infra/maritime/browser-beta/runtime.json")
  };
}

function main(): void {
  const root = resolve(import.meta.dirname, "..");
  const violations = findBrowserAssignmentViolations(loadSources(root));
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Browser assignment boundaries verified.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
