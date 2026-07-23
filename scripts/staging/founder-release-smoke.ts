import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FOUNDER_STAGING_PHASES,
  RELEASE_PHASE_RESULT_STATES,
  ensurePrivateEvidenceDirectory,
  loadPrivateEvidenceBundle,
  validateEvidenceBundle,
  type FounderStagingPhaseId,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord,
  type ReleasePhaseResultState
} from "./release-evidence.ts";
import { runGatewayHttpSmoke, runGatewayWrongTokenSmoke } from "./gateway-http-smoke.ts";

export const FOUNDER_RELEASE_PHASES = [
  { id: "gateway_unauthenticated_request", label: "Gateway unauthenticated request" },
  { id: "gateway_wrong_token", label: "Gateway wrong token" },
  { id: "maritime_worker_dispatch", label: "Maritime worker dispatch" },
  { id: "founder_positive_current_tab_capture", label: "Founder positive current-tab capture" },
  { id: "node_offline", label: "Node offline deferral" },
  { id: "stale_heartbeat", label: "Stale heartbeat" },
  { id: "manual_login_2fa_captcha_blocker", label: "Login, 2FA, CAPTCHA manual blocker" },
  { id: "kill_switch_after_queueing", label: "Kill switch after queueing" },
  { id: "worker_crash_after_browser_invocation", label: "Worker crash after browser invocation" },
  { id: "duplicate_dispatch", label: "Duplicate dispatch" },
  { id: "replayed_result", label: "Replayed result" },
  { id: "gateway_restart", label: "Gateway restart" },
  { id: "web_push_delivery", label: "Web Push delivery" },
  { id: "web_push_deduplication", label: "Web Push deduplication" },
  { id: "quiet_hours", label: "Quiet hours" },
  { id: "provider_outage", label: "Provider outage" },
  { id: "worker_image_rollback", label: "Worker image rollback" },
  { id: "postgresql_restore", label: "PostgreSQL restore" },
  { id: "gmail_readonly_verification", label: "Gmail readonly verification" },
  { id: "calendar_freebusy_and_approved_hold", label: "Calendar free-busy and approved hold" }
] as const satisfies readonly { readonly id: FounderStagingPhaseId; readonly label: string }[];

export type FounderReleasePhaseId = (typeof FOUNDER_RELEASE_PHASES)[number]["id"];

export interface FounderStagingIdentity {
  readonly releaseId: string;
  readonly environmentId: string;
  readonly sourceCommit: string;
  readonly candidateWorkerImage: string;
  readonly candidateOpenclawImage: string;
}

export interface FounderStagingEnvironment {
  readonly enabled: true;
  readonly identity?: FounderStagingIdentity;
  readonly gatewayUrl?: string;
  readonly evidencePath?: string;
  readonly configurationIssues: readonly string[];
}

export interface SmokePhaseRunnerResult {
  readonly status: ReleasePhaseResultState;
  readonly code: string;
}

export interface SmokePhaseContext {
  readonly phaseId: FounderReleasePhaseId;
  readonly identity: FounderStagingIdentity;
}

export type SmokePhaseRunner = (context: SmokePhaseContext) => Promise<SmokePhaseRunnerResult>;

export interface SmokePhaseReport extends SmokePhaseRunnerResult {
  readonly id: FounderReleasePhaseId;
  readonly label: string;
  readonly mandatory: true;
  readonly evidenceMode: "automated" | "manual_evidence" | "blocked";
}

export interface FounderReleaseSmokeReport {
  readonly schemaVersion: 2;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "passed" | "failed";
  readonly phases: readonly SmokePhaseReport[];
  readonly evidenceViolations: readonly string[];
}

const SAFE_CODE = /^[a-z0-9][a-z0-9_.:-]{0,95}$/u;
const SENSITIVE_KEY =
  /(?:access|refresh|gateway|maritime)?token|secret|password|cookie|authorization|credential|storage.?state|(?:node|agent|user|profile)id/iu;

function optionalString(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  name: string
): string | undefined {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

function optionalHttpsOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "wss:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return undefined;
    }
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.href;
  } catch {
    return undefined;
  }
}

export function parseFounderStagingEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>
): FounderStagingEnvironment {
  if (environment.VERA_FOUNDER_STAGING_SMOKE !== "1") {
    throw new Error("VERA_FOUNDER_STAGING_SMOKE must be exactly 1.");
  }

  const rawGatewayUrl = optionalString(environment, "OPENCLAW_GATEWAY_URL");
  const gatewayUrl = optionalHttpsOrigin(rawGatewayUrl);
  const identity = {
    releaseId: optionalString(environment, "VERA_RELEASE_ID"),
    environmentId: optionalString(environment, "VERA_RELEASE_ENVIRONMENT_ID"),
    sourceCommit: optionalString(environment, "VERA_RELEASE_SOURCE_COMMIT"),
    candidateWorkerImage: optionalString(environment, "VERA_CANDIDATE_WORKER_IMAGE"),
    candidateOpenclawImage: optionalString(environment, "VERA_CANDIDATE_OPENCLAW_IMAGE")
  };
  const configurationIssues: string[] = [];
  if (Object.values(identity).some((value) => value === undefined)) {
    configurationIssues.push("release_identity_not_configured");
  }
  if (rawGatewayUrl && !gatewayUrl) configurationIssues.push("gateway_url_invalid");
  const evidencePath = optionalString(environment, "VERA_RELEASE_EVIDENCE_PATH");
  if (!evidencePath) configurationIssues.push("private_evidence_path_not_configured");

  return {
    enabled: true,
    identity: configurationIssues.includes("release_identity_not_configured")
      ? undefined
      : (identity as FounderStagingIdentity),
    gatewayUrl,
    evidencePath,
    configurationIssues
  };
}

function isValidRunnerResult(value: SmokePhaseRunnerResult): boolean {
  return RELEASE_PHASE_RESULT_STATES.includes(value.status) && SAFE_CODE.test(value.code);
}

function isPassingState(status: ReleasePhaseResultState): boolean {
  return status === "passed_automated" || status === "passed_manual_evidence";
}

function manualEvidenceByPhase(
  input: unknown,
  identity: FounderStagingIdentity
): {
  readonly records: ReadonlyMap<FounderReleasePhaseId, ReleaseEvidenceRecord>;
  readonly violations: readonly string[];
} {
  const validation = validateEvidenceBundle(input, { requireAllPhases: false });
  if (validation.length > 0 || !isEvidenceBundle(input))
    return { records: new Map(), violations: validation };
  if (
    input.releaseId !== identity.releaseId ||
    input.environmentId !== identity.environmentId ||
    input.sourceCommit !== identity.sourceCommit ||
    input.candidateWorkerImage !== identity.candidateWorkerImage ||
    input.candidateOpenclawImage !== identity.candidateOpenclawImage
  ) {
    return { records: new Map(), violations: ["manual_evidence_identity_mismatch"] };
  }
  return {
    records: new Map(input.records.map((record) => [record.phaseId, record] as const)),
    violations: []
  };
}

function isEvidenceBundle(value: unknown): value is ReleaseEvidenceBundle {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ReleaseEvidenceBundle).records)
  );
}

function phaseFromManualEvidence(
  record: ReleaseEvidenceRecord | undefined
): SmokePhaseRunnerResult | null {
  if (!record) return null;
  if (record.resultState === "passed_manual_evidence") {
    return { status: "passed_manual_evidence", code: "manual_evidence_validated" };
  }
  if (record.resultState === "passed_automated") {
    return { status: "failed_assertion", code: "manual_evidence_claims_automated_result" };
  }
  return { status: record.resultState, code: "manual_evidence_nonpassing" };
}

export async function runFounderReleaseSmoke(input: {
  readonly phaseRunners: Partial<Record<FounderReleasePhaseId, SmokePhaseRunner>>;
  readonly identity?: FounderStagingIdentity;
  readonly manualEvidenceBundle?: unknown;
  readonly evidenceViolations?: readonly string[];
  readonly ingressApproved?: boolean;
  readonly now?: () => Date;
}): Promise<FounderReleaseSmokeReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const initialEvidenceViolations = [...(input.evidenceViolations ?? [])];
  const manualEvidence =
    input.identity && input.manualEvidenceBundle
      ? manualEvidenceByPhase(input.manualEvidenceBundle, input.identity)
      : { records: new Map<FounderReleasePhaseId, ReleaseEvidenceRecord>(), violations: [] };
  const evidenceViolations = [...initialEvidenceViolations, ...manualEvidence.violations];
  const phases: SmokePhaseReport[] = [];

  for (const phase of FOUNDER_RELEASE_PHASES) {
    let result: SmokePhaseRunnerResult;
    let evidenceMode: SmokePhaseReport["evidenceMode"] = "manual_evidence";
    if (!input.identity) {
      result = { status: "blocked_missing_configuration", code: "release_identity_not_configured" };
      evidenceMode = "blocked";
    } else if (
      phase.id === "founder_positive_current_tab_capture" &&
      input.ingressApproved !== true
    ) {
      result = { status: "blocked_missing_configuration", code: "openclaw_ingress_unreviewed" };
      evidenceMode = "blocked";
    } else {
      const runner = input.phaseRunners[phase.id];
      const manualResult = phaseFromManualEvidence(manualEvidence.records.get(phase.id));
      if (runner) {
        evidenceMode = "automated";
        try {
          const candidate = await runner({ phaseId: phase.id, identity: input.identity });
          result = isValidRunnerResult(candidate)
            ? candidate
            : { status: "failed_assertion", code: "invalid_phase_result" };
        } catch {
          result = { status: "failed_provider", code: "phase_runner_threw" };
        }
      } else if (manualResult) {
        result = manualResult;
      } else {
        result = { status: "blocked_missing_configuration", code: "manual_evidence_required" };
        evidenceMode = "blocked";
      }
    }
    phases.push({ ...phase, mandatory: true, evidenceMode, ...result });
  }

  return {
    schemaVersion: 2,
    startedAt,
    completedAt: now().toISOString(),
    outcome: phases.every((phase) => isPassingState(phase.status)) ? "passed" : "failed",
    phases,
    evidenceViolations
  };
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[redacted database url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted email]")
    .replace(/\+?\d[\d ()-]{7,}\d/gu, "[redacted phone]");
}

function sanitize(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey)
      ])
    );
  }
  return value;
}

export function serializeSafeSmokeReport(report: unknown): string {
  return JSON.stringify(sanitize(report), null, 2);
}

export function renderSafeSmokeMarkdownReport(report: unknown): string {
  const sanitized = sanitize(report) as { readonly outcome?: unknown; readonly phases?: unknown };
  const phases = Array.isArray(sanitized.phases) ? sanitized.phases : [];
  const rows = phases.map((phase) => {
    const entry = phase && typeof phase === "object" ? (phase as Record<string, unknown>) : {};
    return `| ${String(entry.id ?? "").slice(0, 80)} | ${String(entry.status ?? "").slice(0, 80)} | ${String(entry.code ?? "").slice(0, 96)} |`;
  });
  return [
    "# Founder staging release gate",
    "",
    `Outcome: **${String(sanitized.outcome ?? "failed")}**`,
    "",
    "| Phase | Result | Safe code |",
    "| --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}

async function writeSafeReports(report: FounderReleaseSmokeReport): Promise<void> {
  const directory = await ensurePrivateEvidenceDirectory();
  await Promise.all([
    writeFile(
      resolve(directory, "founder-staging-gate-report.json"),
      `${serializeSafeSmokeReport(report)}\n`,
      {
        encoding: "utf8",
        mode: 0o600
      }
    ),
    writeFile(
      resolve(directory, "founder-staging-gate-report.md"),
      renderSafeSmokeMarkdownReport(report),
      {
        encoding: "utf8",
        mode: 0o600
      }
    )
  ]);
}

async function main(): Promise<void> {
  if (process.env.VERA_FOUNDER_STAGING_SMOKE !== "1") {
    process.stdout.write("Founder staging release gate requires VERA_FOUNDER_STAGING_SMOKE=1.\n");
    process.exitCode = 1;
    return;
  }
  const environment = parseFounderStagingEnvironment(process.env);
  const loadedEvidence = environment.evidencePath
    ? await loadPrivateEvidenceBundle({
        evidencePath: environment.evidencePath,
        requireAllPhases: false
      })
    : { bundle: null, violations: ["private_evidence_path_not_configured"] };
  const phaseRunners: Partial<Record<FounderReleasePhaseId, SmokePhaseRunner>> = {};
  if (environment.gatewayUrl) {
    phaseRunners.gateway_unauthenticated_request = async () => {
      const result = await runGatewayHttpSmoke({ gatewayUrl: environment.gatewayUrl ?? "" });
      return result.outcome === "passed"
        ? { status: "passed_automated", code: "gateway_unauthenticated_denied" }
        : { status: "failed_assertion", code: "gateway_unauthenticated_failed" };
    };
    phaseRunners.gateway_wrong_token = async () => {
      const result = await runGatewayWrongTokenSmoke({ gatewayUrl: environment.gatewayUrl ?? "" });
      return result.outcome === "passed"
        ? { status: "passed_automated", code: "gateway_wrong_token_denied" }
        : { status: "failed_assertion", code: "gateway_wrong_token_failed" };
    };
  }
  const report = await runFounderReleaseSmoke({
    identity: environment.identity,
    phaseRunners,
    manualEvidenceBundle: loadedEvidence.bundle ?? undefined,
    evidenceViolations: [...environment.configurationIssues, ...loadedEvidence.violations],
    ingressApproved: false
  });
  await writeSafeReports(report);
  process.stdout.write(`${serializeSafeSmokeReport(report)}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();

export { FOUNDER_STAGING_PHASES };
