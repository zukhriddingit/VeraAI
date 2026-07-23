import { describe, expect, it } from "vitest";

import {
  FOUNDER_STAGING_PHASES,
  withBundleContentHash,
  withRecordContentHash,
  type FounderStagingPhaseId,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord
} from "./release-evidence.ts";
import {
  FOUNDER_RELEASE_PHASES,
  parseFounderStagingEnvironment,
  renderSafeSmokeMarkdownReport,
  runFounderReleaseSmoke,
  serializeSafeSmokeReport,
  type FounderStagingIdentity
} from "./founder-release-smoke.ts";

const identity: FounderStagingIdentity = {
  releaseId: "founder-release-001",
  environmentId: "founder-staging",
  sourceCommit: "a".repeat(40),
  candidateWorkerImage: `ghcr.io/example/vera-worker@sha256:${"1".repeat(64)}`,
  candidateOpenclawImage: `ghcr.io/openclaw/openclaw@sha256:${"2".repeat(64)}`
};

function record(phaseId: FounderStagingPhaseId): ReleaseEvidenceRecord {
  return withRecordContentHash({
    schemaVersion: 1,
    synthetic: false,
    phaseId,
    ...identity,
    candidateOpenclawImage: null,
    executedAt: "2026-07-23T12:00:00Z",
    operatorReference: "operator-opaque-001",
    expectedResult: "Expected safety control is enforced",
    observedResult: "Observed safety control is enforced",
    resultState: "passed_manual_evidence",
    evidenceReferences: [{ kind: "test_run", locator: `run-${phaseId}`, sha256: "3".repeat(64) }],
    approvalState: "approved"
  });
}

function evidenceBundle(records = FOUNDER_STAGING_PHASES.map(record)): ReleaseEvidenceBundle {
  return withBundleContentHash({
    schemaVersion: 1,
    synthetic: false,
    ...identity,
    createdAt: "2026-07-23T12:05:00Z",
    records
  });
}

describe("founder staging release gate environment", () => {
  it("requires the exact explicit live flag", () => {
    expect(() => parseFounderStagingEnvironment({})).toThrow(
      "VERA_FOUNDER_STAGING_SMOKE must be exactly 1."
    );
  });

  it("collects configuration issues without exposing sensitive inputs", () => {
    expect(
      parseFounderStagingEnvironment({
        VERA_FOUNDER_STAGING_SMOKE: "1",
        OPENCLAW_GATEWAY_URL: "http://gateway.example.test"
      })
    ).toMatchObject({
      identity: undefined,
      gatewayUrl: undefined,
      configurationIssues: [
        "release_identity_not_configured",
        "gateway_url_invalid",
        "private_evidence_path_not_configured"
      ]
    });
  });
});

describe("founder staging release gate", () => {
  it("declares the exact mandatory phase coverage and never silently skips", async () => {
    expect(FOUNDER_RELEASE_PHASES.map(({ id }) => id)).toEqual(FOUNDER_STAGING_PHASES);

    const report = await runFounderReleaseSmoke({ phaseRunners: {}, identity });

    expect(report.phases).toHaveLength(FOUNDER_STAGING_PHASES.length);
    expect(report.phases.every(({ mandatory }) => mandatory)).toBe(true);
    expect(report.phases.every(({ status }) => status !== ("skipped_with_blocker" as never))).toBe(
      true
    );
    expect(report.phases.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["manual_evidence_required", "openclaw_ingress_unreviewed"])
    );
    expect(report.outcome).toBe("failed");
  });

  it("turns missing release identity into visible blocked phases and a non-passing gate", async () => {
    const report = await runFounderReleaseSmoke({ phaseRunners: {} });

    expect(report.outcome).toBe("failed");
    expect(report.phases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "blocked_missing_configuration",
          code: "release_identity_not_configured"
        })
      ])
    );
  });

  it("allows validated manual evidence only for the phase named by that record", async () => {
    const manual = evidenceBundle([record("gmail_readonly_verification")]);
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {},
      manualEvidenceBundle: manual,
      ingressApproved: true
    });

    expect(report.phases.find(({ id }) => id === "gmail_readonly_verification")).toMatchObject({
      status: "passed_manual_evidence",
      code: "manual_evidence_validated"
    });
    expect(
      report.phases.find(({ id }) => id === "calendar_freebusy_and_approved_hold")
    ).toMatchObject({
      status: "blocked_missing_configuration",
      code: "manual_evidence_required"
    });
  });

  it("does not let a private evidence record claim an automated result", async () => {
    const automatedClaim = withRecordContentHash({
      ...record("gateway_unauthenticated_request"),
      resultState: "passed_automated" as const
    });
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {},
      manualEvidenceBundle: evidenceBundle([automatedClaim]),
      ingressApproved: true
    });

    expect(report.phases.find(({ id }) => id === "gateway_unauthenticated_request")).toMatchObject({
      status: "failed_assertion",
      code: "manual_evidence_claims_automated_result"
    });
  });

  it("passes only when every required phase has validated evidence or automation", async () => {
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {},
      manualEvidenceBundle: evidenceBundle(),
      ingressApproved: true
    });

    expect(report.outcome).toBe("passed");
    expect(report.phases.every(({ status }) => status === "passed_manual_evidence")).toBe(true);
  });

  it("keeps current-tab browser capture blocked when no reviewed ingress topology exists", async () => {
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {},
      manualEvidenceBundle: evidenceBundle(),
      ingressApproved: false
    });

    expect(report.outcome).toBe("failed");
    expect(
      report.phases.find(({ id }) => id === "founder_positive_current_tab_capture")
    ).toMatchObject({
      status: "blocked_missing_configuration",
      code: "openclaw_ingress_unreviewed"
    });
  });

  it("converts invalid automated output and thrown runners to failed release results", async () => {
    const report = await runFounderReleaseSmoke({
      identity,
      phaseRunners: {
        gateway_unauthenticated_request: async () => ({
          status: "passed_automated",
          code: "INVALID SPACE"
        }),
        gateway_wrong_token: async () => {
          throw new Error("provider token must not appear");
        }
      },
      ingressApproved: true
    });

    expect(report.phases.find(({ id }) => id === "gateway_unauthenticated_request")).toMatchObject({
      status: "failed_assertion",
      code: "invalid_phase_result"
    });
    expect(report.phases.find(({ id }) => id === "gateway_wrong_token")).toMatchObject({
      status: "failed_provider",
      code: "phase_runner_threw"
    });
  });
});

describe("founder staging report redaction", () => {
  it("does not render secret-like values or personal contact data", () => {
    const report = {
      outcome: "failed",
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
  });
});
