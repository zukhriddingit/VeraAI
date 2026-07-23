import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  RELEASE_PHASE_RESULT_STATES,
  ensurePrivateEvidenceDirectory,
  loadPrivateEvidenceBundle,
  validateEvidenceBundle,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord
} from "./release-evidence.ts";
import {
  RELEASE_PHASES,
  RELEASE_PROFILES,
  capabilitiesMatchProfile,
  classifyRequiredPhaseStates,
  isReleaseProfileId,
  type ReleaseCapabilities,
  type ReleaseClassification,
  type ReleasePhaseId,
  type ReleasePhaseResultState,
  type ReleaseProfileId
} from "./release-profiles.ts";
import { runGatewayHttpSmoke, runGatewayWrongTokenSmoke } from "./gateway-http-smoke.ts";

export type FounderReleasePhaseId = ReleasePhaseId;

export function releasePhasesForProfile(profileId: ReleaseProfileId) {
  return RELEASE_PROFILES[profileId].requiredPhaseIds.map((id) => ({
    id,
    label: RELEASE_PHASES[id].label
  }));
}

export const FOUNDER_RELEASE_PHASES = releasePhasesForProfile("founder_core");

export interface FounderStagingIdentity {
  readonly releaseProfile: ReleaseProfileId;
  readonly capabilities: ReleaseCapabilities;
  readonly releaseId: string;
  readonly environmentId: string;
  readonly sourceCommit: string;
  readonly candidateWorkerImage: string;
  readonly candidateOpenclawImage: string | null;
}

export interface FounderStagingEnvironment {
  readonly enabled: true;
  readonly releaseProfile?: ReleaseProfileId;
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
  readonly evidenceMode: "automated" | "manual_evidence" | "configuration_blocker" | "failed";
  readonly configurationBlockerValid: boolean;
}

export interface FounderReleaseSmokeReport {
  readonly schemaVersion: 3;
  readonly releaseProfile: ReleaseProfileId;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "passed" | "conditional" | "failed";
  readonly classification: ReleaseClassification;
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

  const configurationIssues: string[] = [];
  const releaseProfileRaw = optionalString(environment, "VERA_RELEASE_PROFILE");
  const releaseProfile = isReleaseProfileId(releaseProfileRaw) ? releaseProfileRaw : undefined;
  if (!releaseProfile) configurationIssues.push("release_profile_not_configured");

  const rawGatewayUrl = optionalString(environment, "OPENCLAW_GATEWAY_URL");
  const gatewayUrl = optionalHttpsOrigin(rawGatewayUrl);
  if (rawGatewayUrl && !gatewayUrl) configurationIssues.push("gateway_url_invalid");
  if (releaseProfile === "founder_core" && rawGatewayUrl) {
    configurationIssues.push("founder_core_gateway_forbidden");
  }

  const commonIdentity = {
    releaseId: optionalString(environment, "VERA_RELEASE_ID"),
    environmentId: optionalString(environment, "VERA_RELEASE_ENVIRONMENT_ID"),
    sourceCommit: optionalString(environment, "VERA_RELEASE_SOURCE_COMMIT"),
    candidateWorkerImage: optionalString(environment, "VERA_CANDIDATE_WORKER_IMAGE")
  };
  const candidateOpenclawImage = optionalString(environment, "VERA_CANDIDATE_OPENCLAW_IMAGE");
  if (Object.values(commonIdentity).some((value) => value === undefined)) {
    configurationIssues.push("release_identity_not_configured");
  }
  if (releaseProfile === "founder_core" && candidateOpenclawImage) {
    configurationIssues.push("founder_core_openclaw_image_forbidden");
  }
  if (releaseProfile === "founder_browser_experimental" && !candidateOpenclawImage) {
    configurationIssues.push("browser_openclaw_image_not_configured");
  }

  const evidencePath = optionalString(environment, "VERA_RELEASE_EVIDENCE_PATH");
  if (!evidencePath) configurationIssues.push("private_evidence_path_not_configured");

  const identityComplete =
    releaseProfile !== undefined &&
    !configurationIssues.some((issue) =>
      [
        "release_identity_not_configured",
        "founder_core_openclaw_image_forbidden",
        "browser_openclaw_image_not_configured"
      ].includes(issue)
    );
  const identity = identityComplete
    ? {
        releaseProfile,
        capabilities: RELEASE_PROFILES[releaseProfile].capabilities,
        releaseId: commonIdentity.releaseId!,
        environmentId: commonIdentity.environmentId!,
        sourceCommit: commonIdentity.sourceCommit!,
        candidateWorkerImage: commonIdentity.candidateWorkerImage!,
        candidateOpenclawImage: releaseProfile === "founder_core" ? null : candidateOpenclawImage!
      }
    : undefined;

  return {
    enabled: true,
    releaseProfile,
    identity,
    gatewayUrl: releaseProfile === "founder_browser_experimental" ? gatewayUrl : undefined,
    evidencePath,
    configurationIssues
  };
}

function isValidRunnerResult(value: SmokePhaseRunnerResult): boolean {
  return RELEASE_PHASE_RESULT_STATES.includes(value.status) && SAFE_CODE.test(value.code);
}

function manualEvidenceByPhase(
  input: unknown,
  identity: FounderStagingIdentity,
  decisionAt: string
): {
  readonly records: ReadonlyMap<FounderReleasePhaseId, ReleaseEvidenceRecord>;
  readonly violations: readonly string[];
} {
  const validation = validateEvidenceBundle(input, {
    requireAllPhases: false,
    decisionAt
  });
  if (validation.length > 0 || !isEvidenceBundle(input)) {
    return { records: new Map(), violations: validation };
  }
  if (
    input.releaseProfile !== identity.releaseProfile ||
    !capabilitiesMatchProfile(identity.releaseProfile, input.capabilities) ||
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
): Pick<SmokePhaseReport, "status" | "code" | "evidenceMode" | "configurationBlockerValid"> | null {
  if (!record) return null;
  if (record.resultState === "passed_manual_evidence") {
    return {
      status: "passed_manual_evidence",
      code: "manual_evidence_validated",
      evidenceMode: "manual_evidence",
      configurationBlockerValid: false
    };
  }
  if (record.resultState === "passed_automated") {
    return {
      status: "failed_assertion",
      code: "manual_evidence_claims_automated_result",
      evidenceMode: "failed",
      configurationBlockerValid: false
    };
  }
  if (record.resultState === "blocked_missing_configuration") {
    return {
      status: record.resultState,
      code: "configuration_blocker_validated",
      evidenceMode: "configuration_blocker",
      configurationBlockerValid: true
    };
  }
  return {
    status: record.resultState,
    code: "manual_evidence_nonpassing",
    evidenceMode: "failed",
    configurationBlockerValid: false
  };
}

export async function runFounderReleaseSmoke(input: {
  readonly phaseRunners: Partial<Record<FounderReleasePhaseId, SmokePhaseRunner>>;
  readonly releaseProfile?: ReleaseProfileId;
  readonly identity?: FounderStagingIdentity;
  readonly manualEvidenceBundle?: unknown;
  readonly evidenceViolations?: readonly string[];
  readonly now?: () => Date;
}): Promise<FounderReleaseSmokeReport> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const releaseProfile = input.identity?.releaseProfile ?? input.releaseProfile ?? "founder_core";
  const manualEvidence =
    input.identity && input.manualEvidenceBundle
      ? manualEvidenceByPhase(input.manualEvidenceBundle, input.identity, startedAt)
      : { records: new Map<FounderReleasePhaseId, ReleaseEvidenceRecord>(), violations: [] };
  const evidenceViolations = [...(input.evidenceViolations ?? []), ...manualEvidence.violations];
  const phases: SmokePhaseReport[] = [];

  for (const phase of releasePhasesForProfile(releaseProfile)) {
    let result: Pick<
      SmokePhaseReport,
      "status" | "code" | "evidenceMode" | "configurationBlockerValid"
    >;
    if (!input.identity) {
      result = {
        status: "failed_assertion",
        code: "release_identity_not_configured",
        evidenceMode: "failed",
        configurationBlockerValid: false
      };
    } else {
      const runner = input.phaseRunners[phase.id];
      const manualResult = phaseFromManualEvidence(manualEvidence.records.get(phase.id));
      if (runner) {
        try {
          const candidate = await runner({ phaseId: phase.id, identity: input.identity });
          result = isValidRunnerResult(candidate)
            ? {
                ...candidate,
                evidenceMode: "automated",
                configurationBlockerValid: false
              }
            : {
                status: "failed_assertion",
                code: "invalid_phase_result",
                evidenceMode: "failed",
                configurationBlockerValid: false
              };
        } catch {
          result = {
            status: "failed_provider",
            code: "phase_runner_threw",
            evidenceMode: "failed",
            configurationBlockerValid: false
          };
        }
      } else if (manualResult) {
        result = manualResult;
      } else {
        result = {
          status: "failed_assertion",
          code: "phase_runner_not_implemented",
          evidenceMode: "failed",
          configurationBlockerValid: false
        };
      }
    }
    phases.push({ ...phase, mandatory: true, ...result });
  }

  const classification =
    evidenceViolations.length > 0
      ? "no_go"
      : classifyRequiredPhaseStates(
          releaseProfile,
          phases.map((phase) => ({
            phaseId: phase.id,
            resultState: phase.status,
            configurationBlockerValid: phase.configurationBlockerValid
          }))
        );
  return {
    schemaVersion: 3,
    releaseProfile,
    startedAt,
    completedAt: now().toISOString(),
    outcome:
      classification === "go_founder_only_core_beta"
        ? "passed"
        : classification === "conditional_go_founder_only_staging"
          ? "conditional"
          : "failed",
    classification,
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
  const sanitized = sanitize(report) as {
    readonly outcome?: unknown;
    readonly classification?: unknown;
    readonly phases?: unknown;
  };
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
    `Classification: **${String(sanitized.classification ?? "no_go")}**`,
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
  const decisionAt = new Date().toISOString();
  const loadedEvidence = environment.evidencePath
    ? await loadPrivateEvidenceBundle({
        evidencePath: environment.evidencePath,
        requireAllPhases: false,
        decisionAt
      })
    : { bundle: null, violations: ["private_evidence_path_not_configured"] };
  const phaseRunners: Partial<Record<FounderReleasePhaseId, SmokePhaseRunner>> = {};
  if (environment.releaseProfile === "founder_browser_experimental" && environment.gatewayUrl) {
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
    releaseProfile: environment.releaseProfile,
    identity: environment.identity,
    phaseRunners,
    manualEvidenceBundle: loadedEvidence.bundle ?? undefined,
    evidenceViolations: [...environment.configurationIssues, ...loadedEvidence.violations],
    now: () => new Date(decisionAt)
  });
  await writeSafeReports(report);
  process.stdout.write(`${serializeSafeSmokeReport(report)}\n`);
  if (report.classification === "no_go") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
