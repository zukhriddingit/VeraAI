import { describe, expect, it, vi } from "vitest";

import {
  withBundleContentHash,
  withRecordContentHash,
  type ConfigurationBlocker,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord
} from "./release-evidence.ts";
import {
  FOUNDER_RELEASE_PHASES,
  parseFounderStagingEnvironment,
  releasePhasesForProfile,
  renderSafeSmokeMarkdownReport,
  runFounderReleaseSmoke,
  serializeSafeSmokeReport,
  type FounderStagingIdentity,
  type SmokePhaseRunner
} from "./founder-release-smoke.ts";
import {
  RELEASE_PROFILES,
  type ReleasePhaseId,
  type ReleaseProfileId
} from "./release-profiles.ts";

const openclawImage = `ghcr.io/openclaw/openclaw@sha256:${"2".repeat(64)}`;
const identity: FounderStagingIdentity = {
  releaseProfile: "founder_core",
  capabilities: RELEASE_PROFILES.founder_core.capabilities,
  releaseId: "founder-release-001",
  environmentId: "founder-staging",
  sourceCommit: "a".repeat(40),
  candidateWorkerImage: `ghcr.io/example/vera-worker@sha256:${"1".repeat(64)}`,
  candidateOpenclawImage: null
};

const blocker: ConfigurationBlocker = {
  kind: "operator_execution",
  missingConfiguration: "staging_restore_rehearsal",
  remediation: "Run the documented restore rehearsal and attach its sanitized test run hash",
  implementationState: "implemented_and_validated",
  nonLiveValidationState: "passed",
  requiresRepositoryChange: false,
  requiresDesignDecision: false
};

function record(
  phaseId: ReleasePhaseId,
  resultState: "passed_manual_evidence" | "blocked_missing_configuration" = "passed_manual_evidence"
): ReleaseEvidenceRecord {
  return withRecordContentHash({
    schemaVersion: 2,
    synthetic: false,
    ...identity,
    phaseId,
    executedAt: "2026-07-23T12:00:00Z",
    operatorReference: "operator-opaque-001",
    expectedResult: "Expected safety control is enforced",
    observedResult:
      resultState === "blocked_missing_configuration"
        ? "External staging execution remains pending"
        : "Observed safety control is enforced",
    resultState,
    configurationBlocker: resultState === "blocked_missing_configuration" ? blocker : null,
    evidenceReferences: [{ kind: "test_run", locator: `run-${phaseId}`, sha256: "3".repeat(64) }],
    approvalState: "approved"
  });
}

function evidenceBundle(records: readonly ReleaseEvidenceRecord[]): ReleaseEvidenceBundle {
  return withBundleContentHash({
    schemaVersion: 2,
    synthetic: false,
    ...identity,
    createdAt: "2026-07-23T12:05:00Z",
    records
  });
}

function passingRunners(profileId: ReleaseProfileId) {
  return Object.fromEntries(
    releasePhasesForProfile(profileId).map(({ id }) => [
      id,
      vi.fn(async () => ({ status: "passed_automated", code: "phase_passed" }) as const)
    ])
  ) as Partial<Record<ReleasePhaseId, SmokePhaseRunner>>;
}

describe("founder staging release gate environment", () => {
  it("requires the exact live flag and an explicit profile", () => {
    expect(() => parseFounderStagingEnvironment({})).toThrow(
      "VERA_FOUNDER_STAGING_SMOKE must be exactly 1."
    );
    expect(
      parseFounderStagingEnvironment({ VERA_FOUNDER_STAGING_SMOKE: "1" }).configurationIssues
    ).toContain("release_profile_not_configured");
  });

  it.each([
    ["founder_core", undefined, true],
    ["founder_browser_experimental", openclawImage, true],
    ["founder_core", openclawImage, false],
    ["founder_browser_experimental", undefined, false]
  ] as const)(
    "validates %s OpenClaw image binding",
    (releaseProfile, candidateOpenclawImage, valid) => {
      const parsed = parseFounderStagingEnvironment({
        VERA_FOUNDER_STAGING_SMOKE: "1",
        VERA_RELEASE_PROFILE: releaseProfile,
        VERA_RELEASE_ID: "founder-release-001",
        VERA_RELEASE_ENVIRONMENT_ID: "founder-staging",
        VERA_RELEASE_SOURCE_COMMIT: "a".repeat(40),
        VERA_CANDIDATE_WORKER_IMAGE: identity.candidateWorkerImage,
        VERA_CANDIDATE_OPENCLAW_IMAGE: candidateOpenclawImage,
        VERA_RELEASE_EVIDENCE_PATH: "release-evidence/private/bundle.json"
      });
      expect(parsed.identity !== undefined).toBe(valid);
    }
  );

  it("forbids an OpenClaw gateway for founder core", () => {
    const parsed = parseFounderStagingEnvironment({
      VERA_FOUNDER_STAGING_SMOKE: "1",
      VERA_RELEASE_PROFILE: "founder_core",
      OPENCLAW_GATEWAY_URL: "https://gateway.example.test"
    });
    expect(parsed.gatewayUrl).toBeUndefined();
    expect(parsed.configurationIssues).toContain("founder_core_gateway_forbidden");
  });
});

describe("founder staging release gate", () => {
  it("uses the exact profile phase set and never silently skips", async () => {
    expect(FOUNDER_RELEASE_PHASES.map(({ id }) => id)).toEqual(
      RELEASE_PROFILES.founder_core.requiredPhaseIds
    );
    const report = await runFounderReleaseSmoke({
      phaseRunners: {},
      identity,
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.phases).toHaveLength(RELEASE_PROFILES.founder_core.requiredPhaseIds.length);
    expect(report.phases.every(({ mandatory }) => mandatory)).toBe(true);
    expect(report.phases.every(({ code }) => code === "phase_runner_not_implemented")).toBe(true);
    expect(report.classification).toBe("no_go");
  });

  it("turns missing identity and missing runners into failures, never configuration blockers", async () => {
    const missingIdentity = await runFounderReleaseSmoke({
      phaseRunners: {},
      releaseProfile: "founder_core"
    });
    expect(missingIdentity.phases.every(({ status }) => status === "failed_assertion")).toBe(true);
    expect(missingIdentity.classification).toBe("no_go");

    const missingRunner = await runFounderReleaseSmoke({
      phaseRunners: {},
      identity,
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(missingRunner.phases[0]).toMatchObject({
      status: "failed_assertion",
      code: "phase_runner_not_implemented"
    });
  });

  it("allows validated manual evidence only for the named phase", async () => {
    const manual = evidenceBundle([record("gmail_readonly_verification")]);
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {},
      manualEvidenceBundle: manual,
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.phases.find(({ id }) => id === "gmail_readonly_verification")).toMatchObject({
      status: "passed_manual_evidence",
      code: "manual_evidence_validated"
    });
    expect(
      report.phases.find(({ id }) => id === "calendar_freebusy_and_approved_hold")
    ).toMatchObject({
      status: "failed_assertion",
      code: "phase_runner_not_implemented"
    });
    expect(report.classification).toBe("no_go");
  });

  it("classifies passing phases plus strict configuration blockers as conditional staging go", async () => {
    const runners = passingRunners("founder_core");
    delete runners.postgresql_restore;
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: runners,
      manualEvidenceBundle: evidenceBundle([
        record("postgresql_restore", "blocked_missing_configuration")
      ]),
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.phases.find(({ id }) => id === "postgresql_restore")).toMatchObject({
      status: "blocked_missing_configuration",
      code: "configuration_blocker_validated",
      configurationBlockerValid: true
    });
    expect(report.classification).toBe("conditional_go_founder_only_staging");
    expect(report.outcome).toBe("conditional");
  });

  it("classifies every completed founder-core phase as core beta go", async () => {
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: passingRunners("founder_core"),
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.classification).toBe("go_founder_only_core_beta");
    expect(report.outcome).toBe("passed");
  });

  it("keeps browser experimental no-go even when every live phase passes", async () => {
    const browserIdentity: FounderStagingIdentity = {
      ...identity,
      releaseProfile: "founder_browser_experimental",
      capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities,
      candidateOpenclawImage: openclawImage
    };
    const report = await runFounderReleaseSmoke({
      identity: browserIdentity,
      phaseRunners: passingRunners("founder_browser_experimental"),
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.classification).toBe("no_go");
    expect(report.outcome).toBe("failed");
  });

  it("converts invalid automated output and thrown runners to no-go failures", async () => {
    const runners = passingRunners("founder_core");
    runners.release_static_readiness = async () => ({
      status: "passed_automated",
      code: "INVALID SPACE"
    });
    runners.direct_capture = async () => {
      throw new Error("provider token must not appear");
    };
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: runners,
      now: () => new Date("2026-07-23T12:06:00Z")
    });
    expect(report.phases.find(({ id }) => id === "release_static_readiness")).toMatchObject({
      status: "failed_assertion",
      code: "invalid_phase_result"
    });
    expect(report.phases.find(({ id }) => id === "direct_capture")).toMatchObject({
      status: "failed_provider",
      code: "phase_runner_threw"
    });
    expect(report.classification).toBe("no_go");
  });
});

describe("founder staging report redaction", () => {
  it("does not render secret-like values or personal contact data", () => {
    const report = {
      outcome: "failed",
      classification: "no_go",
      gatewayToken: "secret-gateway-token",
      phases: [
        {
          id: "gateway_wrong_token",
          status: "failed_assertion",
          code: "gateway_wrong_token_failed",
          detail:
            "Bearer secret-gateway-token user@example.test +1 617 555 0100 postgresql://vera:secret@db.test/vera"
        }
      ]
    };

    expect(serializeSafeSmokeReport(report)).not.toMatch(
      /secret-gateway-token|user@example\.test|617 555 0100|postgresql:\/\//u
    );
    expect(renderSafeSmokeMarkdownReport(report)).toContain("gateway_wrong_token_failed");
    expect(renderSafeSmokeMarkdownReport(report)).toContain("no_go");
  });
});
