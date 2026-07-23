import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runGatewayHttpSmoke } from "./gateway-http-smoke.ts";

export const FOUNDER_RELEASE_PHASES = [
  { id: "release_manifest", label: "Release manifest verification", mandatory: true },
  { id: "maritime_identity_status", label: "Maritime identity and status", mandatory: true },
  { id: "deployed_image_digest", label: "Deployed image digest equality", mandatory: true },
  { id: "worker_readiness", label: "Private worker readiness", mandatory: true },
  { id: "openclaw_diagnostics", label: "OpenClaw diagnostics", mandatory: true },
  { id: "gateway_unauthorized", label: "Gateway unauthenticated routes", mandatory: true },
  { id: "paired_node", label: "Paired node and profile", mandatory: true },
  { id: "founder_policy", label: "Founder allowlist and policy", mandatory: true },
  {
    id: "policy_disabled_cancellation",
    label: "Disabled-policy cancellation",
    mandatory: true
  },
  { id: "offline_node", label: "Offline-node deferral", mandatory: true },
  { id: "manual_blocker", label: "Manual blocker", mandatory: true },
  { id: "exact_current_tab_capture", label: "Exact current-tab capture", mandatory: true },
  { id: "capture_replay_idempotency", label: "Capture replay idempotency", mandatory: true },
  { id: "off_allowlist_denial", label: "Off-allowlist denial", mandatory: true },
  { id: "result_integrity_denial", label: "Result integrity denial", mandatory: true },
  { id: "gmail_ingestion", label: "Readonly Gmail ingestion", mandatory: true },
  { id: "web_push_delivery", label: "Idempotent Web Push delivery", mandatory: true },
  { id: "gateway_unavailable", label: "Gateway unavailable behavior", mandatory: true },
  { id: "source_kill_switch", label: "Source kill switch", mandatory: true },
  { id: "rollback_validation", label: "Rollback identity validation", mandatory: true }
] as const;

export type FounderReleasePhaseId = (typeof FOUNDER_RELEASE_PHASES)[number]["id"];
export type SmokePhaseStatus = "passed" | "failed" | "skipped_with_blocker" | "not_applicable";

export interface FounderStagingEnvironment {
  readonly enabled: true;
  readonly releaseManifestPath: string;
  readonly maritimeToken: string;
  readonly maritimeWorkerAgentId: string;
  readonly maritimeGatewayAgentId: string;
  readonly stagingBaseUrl: string;
  readonly playwrightStorageStatePath: string;
  readonly founderUserId: string;
  readonly approvedZillowUrl: string;
  readonly openClawNodeId: string;
  readonly openClawProfileId: string;
  readonly gatewayWebSocketUrl: string;
  readonly gatewayUrl: string;
  readonly gatewayToken: string;
  readonly gmailConfigured: boolean;
  readonly webPushConfigured: boolean;
  readonly sensitiveValues: readonly string[];
}

export interface SmokePhaseRunnerResult {
  readonly status: SmokePhaseStatus;
  readonly code: string;
}

export interface SmokePhaseContext {
  readonly phaseId: FounderReleasePhaseId;
  readonly environment?: FounderStagingEnvironment;
}

export type SmokePhaseRunner = (context: SmokePhaseContext) => Promise<SmokePhaseRunnerResult>;

export interface SmokePhaseReport extends SmokePhaseRunnerResult {
  readonly id: FounderReleasePhaseId;
  readonly label: string;
  readonly mandatory: boolean;
}

export interface FounderReleaseSmokeReport {
  readonly schemaVersion: 1;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "passed" | "failed";
  readonly phases: readonly SmokePhaseReport[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,95}$/u;
const SENSITIVE_KEY_PATTERN =
  /(?:access|refresh|gateway|maritime)?token|secret|password|cookie|authorization|credential|storage.?state|(?:node|agent|user|profile)id/iu;

function requiredValue(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  name: string,
  maximumLength = 4096
): string {
  const value = environment[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required.`);
  if (value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function secureOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials.`);
  if (url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must be a clean HTTPS origin.`);
  }
  return url.href;
}

function secureWebSocketOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "wss:") throw new Error(`${name} must use WSS.`);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must be a clean WSS origin.`);
  }
  return url.href;
}

function approvedZillowUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VERA_OPENCLAW_APPROVED_ZILLOW_URL must be a valid URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "zillow.com" && !hostname.endsWith(".zillow.com")) ||
    !url.pathname.includes("/homedetails/") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("VERA_OPENCLAW_APPROVED_ZILLOW_URL must be an exact HTTPS Zillow listing URL.");
  }
  return url.href;
}

function optionalExactFlag(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  name: string
): boolean {
  const value = environment[name]?.trim();
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`${name} must be exactly 0 or 1 when set.`);
}

export function parseFounderStagingEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  options: { readonly workspaceRoot?: string } = {}
): FounderStagingEnvironment {
  if (environment.VERA_FOUNDER_STAGING_SMOKE !== "1") {
    throw new Error("VERA_FOUNDER_STAGING_SMOKE must be exactly 1.");
  }

  const releaseManifestPath = requiredValue(environment, "VERA_RELEASE_MANIFEST_PATH");
  if (!releaseManifestPath.endsWith(".json")) {
    throw new Error("VERA_RELEASE_MANIFEST_PATH must name a JSON manifest.");
  }
  const playwrightStorageStatePath = requiredValue(
    environment,
    "VERA_PLAYWRIGHT_STORAGE_STATE_PATH"
  );
  if (!isAbsolute(playwrightStorageStatePath) || !playwrightStorageStatePath.endsWith(".json")) {
    throw new Error("VERA_PLAYWRIGHT_STORAGE_STATE_PATH must be an absolute JSON path.");
  }
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const storageRelativeToWorkspace = relative(workspaceRoot, resolve(playwrightStorageStatePath));
  if (
    storageRelativeToWorkspace === "" ||
    (!storageRelativeToWorkspace.startsWith("..") && !isAbsolute(storageRelativeToWorkspace))
  ) {
    throw new Error("VERA_PLAYWRIGHT_STORAGE_STATE_PATH must remain outside the repository.");
  }

  const maritimeToken = requiredValue(environment, "MARITIME_TOKEN", 8192);
  const maritimeWorkerAgentId = requiredValue(environment, "VERA_MARITIME_WORKER_AGENT_ID", 256);
  const maritimeGatewayAgentId = requiredValue(environment, "VERA_MARITIME_GATEWAY_AGENT_ID", 256);
  const stagingBaseUrl = secureOrigin(
    requiredValue(environment, "VERA_STAGING_BASE_URL"),
    "VERA_STAGING_BASE_URL"
  );
  const founderUserId = requiredValue(environment, "VERA_FOUNDER_USER_ID", 64);
  if (!UUID_PATTERN.test(founderUserId)) {
    throw new Error("VERA_FOUNDER_USER_ID must be a UUID.");
  }
  const listingUrl = approvedZillowUrl(
    requiredValue(environment, "VERA_OPENCLAW_APPROVED_ZILLOW_URL")
  );
  const openClawNodeId = requiredValue(environment, "VERA_OPENCLAW_NODE_ID", 256);
  const openClawProfileId = requiredValue(environment, "VERA_OPENCLAW_PROFILE_ID", 256);
  const gatewayWebSocketUrl = secureWebSocketOrigin(
    requiredValue(environment, "OPENCLAW_GATEWAY_URL"),
    "OPENCLAW_GATEWAY_URL"
  );
  const gatewayUrl = new URL(gatewayWebSocketUrl);
  gatewayUrl.protocol = "https:";
  const gatewayToken = requiredValue(environment, "OPENCLAW_GATEWAY_TOKEN", 8192);

  return {
    enabled: true,
    releaseManifestPath,
    maritimeToken,
    maritimeWorkerAgentId,
    maritimeGatewayAgentId,
    stagingBaseUrl,
    playwrightStorageStatePath,
    founderUserId,
    approvedZillowUrl: listingUrl,
    openClawNodeId,
    openClawProfileId,
    gatewayWebSocketUrl,
    gatewayUrl: gatewayUrl.href,
    gatewayToken,
    gmailConfigured: optionalExactFlag(environment, "VERA_GMAIL_STAGING_TEST"),
    webPushConfigured: optionalExactFlag(environment, "VERA_WEB_PUSH_STAGING_TEST"),
    sensitiveValues: [
      maritimeToken,
      maritimeWorkerAgentId,
      maritimeGatewayAgentId,
      stagingBaseUrl,
      playwrightStorageStatePath,
      founderUserId,
      listingUrl,
      openClawNodeId,
      openClawProfileId,
      gatewayWebSocketUrl,
      gatewayUrl.href,
      gatewayToken
    ]
  };
}

function validRunnerResult(value: SmokePhaseRunnerResult): boolean {
  return (
    ["passed", "failed", "skipped_with_blocker", "not_applicable"].includes(value.status) &&
    SAFE_CODE_PATTERN.test(value.code)
  );
}

export async function runFounderReleaseSmoke(input: {
  readonly phaseRunners: Partial<Record<FounderReleasePhaseId, SmokePhaseRunner>>;
  readonly environment?: FounderStagingEnvironment;
  readonly now?: () => Date;
}): Promise<FounderReleaseSmokeReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const phases: SmokePhaseReport[] = [];

  for (const phase of FOUNDER_RELEASE_PHASES) {
    const runner = input.phaseRunners[phase.id];
    let result: SmokePhaseRunnerResult;
    if (!runner) {
      result = { status: "skipped_with_blocker", code: "phase_dependency_not_configured" };
    } else {
      try {
        const context: SmokePhaseContext = input.environment
          ? { phaseId: phase.id, environment: input.environment }
          : { phaseId: phase.id };
        const candidate = await runner(context);
        result = validRunnerResult(candidate)
          ? candidate
          : { status: "failed", code: "invalid_phase_result" };
      } catch {
        result = { status: "failed", code: "phase_runner_threw" };
      }
    }
    phases.push({ ...phase, ...result });
  }

  const failed = phases.some(
    ({ mandatory, status }) =>
      status === "failed" ||
      (mandatory && (status === "skipped_with_blocker" || status === "not_applicable"))
  );
  return {
    schemaVersion: 1,
    startedAt,
    completedAt: now().toISOString(),
    outcome: failed ? "failed" : "passed",
    phases
  };
}

function replaceConfiguredSecrets(value: string, sensitiveValues: readonly string[]): string {
  let result = value;
  const orderedValues = [...new Set(sensitiveValues.filter((secret) => secret.length >= 3))].sort(
    (left, right) => right.length - left.length
  );
  for (const secret of orderedValues) result = result.split(secret).join("[redacted]");
  return result;
}

function sanitizeString(value: string, sensitiveValues: readonly string[]): string {
  return replaceConfiguredSecrets(value, sensitiveValues)
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[redacted database url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted email]")
    .replace(/\+?\d[\d ()-]{7,}\d/gu, "[redacted phone]")
    .replace(/https?:\/\/[^\s"'<>()]+/giu, (candidate) => {
      try {
        const url = new URL(candidate);
        if (!url.search && !url.hash) return candidate;
        url.search = "";
        url.hash = "";
        return url.href;
      } catch {
        return "[redacted url]";
      }
    });
}

function sanitizeValue(value: unknown, sensitiveValues: readonly string[], key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (typeof value === "string") return sanitizeString(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, sensitiveValues));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, sensitiveValues, childKey)
      ])
    );
  }
  return value;
}

export function serializeSafeSmokeReport(
  report: unknown,
  sensitiveValues: readonly string[] = []
): string {
  return JSON.stringify(sanitizeValue(report, sensitiveValues), null, 2);
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/gu, " ")
    .replace(/\|/gu, "\\|")
    .slice(0, 160);
}

export function renderSafeSmokeMarkdownReport(
  report: unknown,
  sensitiveValues: readonly string[] = []
): string {
  const sanitized = sanitizeValue(report, sensitiveValues);
  const object = sanitized && typeof sanitized === "object" ? sanitized : {};
  const record = object as { readonly outcome?: unknown; readonly phases?: unknown };
  const phases = Array.isArray(record.phases) ? record.phases : [];
  const rows = phases.map((phase) => {
    const entry = phase && typeof phase === "object" ? (phase as Record<string, unknown>) : {};
    return `| ${markdownCell(entry.id)} | ${markdownCell(entry.status)} | ${markdownCell(entry.code)} |`;
  });
  return [
    "# Founder staging smoke",
    "",
    `Outcome: **${markdownCell(record.outcome)}**`,
    "",
    "| Phase | Status | Safe code |",
    "| --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}

async function writeSafeReports(
  report: FounderReleaseSmokeReport,
  sensitiveValues: readonly string[]
): Promise<void> {
  const directory = resolve("release-evidence/private");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(directory, "founder-staging-smoke.json"),
      `${serializeSafeSmokeReport(report, sensitiveValues)}\n`,
      { encoding: "utf8", mode: 0o600 }
    ),
    writeFile(
      resolve(directory, "founder-staging-smoke.md"),
      renderSafeSmokeMarkdownReport(report, sensitiveValues),
      { encoding: "utf8", mode: 0o600 }
    )
  ]);
}

async function main(): Promise<void> {
  if (process.env.VERA_FOUNDER_STAGING_SMOKE !== "1") {
    process.stdout.write("Founder staging smoke skipped: explicit live flag absent.\n");
    return;
  }

  const environment = parseFounderStagingEnvironment(process.env);
  const report = await runFounderReleaseSmoke({
    environment,
    phaseRunners: {
      gateway_unauthorized: async () => {
        const result = await runGatewayHttpSmoke({ gatewayUrl: environment.gatewayUrl });
        return result.outcome === "passed"
          ? { status: "passed", code: "gateway_negative_matrix_passed" }
          : { status: "failed", code: "gateway_negative_matrix_failed" };
      }
    }
  });
  await writeSafeReports(report, environment.sensitiveValues);
  process.stdout.write(`${serializeSafeSmokeReport(report, environment.sensitiveValues)}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
