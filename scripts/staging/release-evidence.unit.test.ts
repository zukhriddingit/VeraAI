import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RELEASE_PROFILES, type ReleasePhaseId } from "./release-profiles.ts";
import {
  bundleContentHash,
  classifyEvidenceBundle,
  createReleaseDecisionSummary,
  isPassingEvidenceBundle,
  loadPrivateEvidenceBundle,
  recordContentHash,
  validateEvidenceBundle,
  validateEvidenceRecord,
  validatePrivateEvidencePath,
  withBundleContentHash,
  withRecordContentHash,
  type ConfigurationBlocker,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord,
  type ReleasePhaseResultState
} from "./release-evidence.ts";

const commit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const workerImage = `ghcr.io/example/vera-worker@sha256:${"1".repeat(64)}`;
const otherWorkerImage = `ghcr.io/example/vera-worker@sha256:${"4".repeat(64)}`;
const openclawImage = `ghcr.io/openclaw/openclaw@sha256:${"2".repeat(64)}`;
const decisionAt = "2026-07-23T12:06:00Z";

const validBlocker: ConfigurationBlocker = {
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
  resultState: ReleasePhaseResultState = "passed_automated",
  configurationBlocker: ConfigurationBlocker | null = resultState ===
  "blocked_missing_configuration"
    ? validBlocker
    : null
): ReleaseEvidenceRecord {
  return withRecordContentHash({
    schemaVersion: 2,
    synthetic: false,
    releaseProfile: "founder_core",
    capabilities: RELEASE_PROFILES.founder_core.capabilities,
    phaseId,
    releaseId: "founder-release-001",
    environmentId: "founder-staging",
    sourceCommit: commit,
    candidateWorkerImage: workerImage,
    candidateOpenclawImage: null,
    executedAt: "2026-07-23T12:00:00Z",
    operatorReference: "operator-opaque-001",
    expectedResult: "Expected safety control is enforced",
    observedResult:
      resultState === "blocked_missing_configuration"
        ? "External staging execution remains pending"
        : "Observed safety control is enforced",
    resultState,
    configurationBlocker,
    evidenceReferences: [{ kind: "test_run", locator: `run-${phaseId}`, sha256: "3".repeat(64) }],
    approvalState: "approved"
  });
}

function bundle(
  records = RELEASE_PROFILES.founder_core.requiredPhaseIds.map((phaseId) => record(phaseId))
): ReleaseEvidenceBundle {
  return withBundleContentHash({
    schemaVersion: 2,
    synthetic: false,
    releaseProfile: "founder_core",
    capabilities: RELEASE_PROFILES.founder_core.capabilities,
    releaseId: "founder-release-001",
    environmentId: "founder-staging",
    sourceCommit: commit,
    candidateWorkerImage: workerImage,
    candidateOpenclawImage: null,
    createdAt: "2026-07-23T12:05:00Z",
    records
  });
}

function replacePhase(
  evidence: ReleaseEvidenceBundle,
  phaseId: ReleasePhaseId,
  resultState: ReleasePhaseResultState,
  configurationBlocker?: ConfigurationBlocker | null
): ReleaseEvidenceBundle {
  return bundle(
    evidence.records.map((candidate) =>
      candidate.phaseId === phaseId
        ? record(
            phaseId,
            resultState,
            configurationBlocker ??
              (resultState === "blocked_missing_configuration" ? validBlocker : null)
          )
        : candidate
    )
  );
}

describe("founder staging external evidence", () => {
  it("accepts a complete deterministic founder-core bundle", () => {
    const evidence = bundle();
    expect(validateEvidenceBundle(evidence, { decisionAt })).toEqual([]);
    expect(classifyEvidenceBundle(evidence, decisionAt)).toBe("go_founder_only_core_beta");
    expect(isPassingEvidenceBundle(evidence, decisionAt)).toBe(true);
    expect(bundleContentHash(evidence)).toBe(evidence.bundleHash);
    expect(bundle().bundleHash).toBe(evidence.bundleHash);
    expect(bundleContentHash({ ...evidence, records: [...evidence.records].reverse() })).not.toBe(
      evidence.bundleHash
    );
  });

  it("rejects committed synthetic examples in production", async () => {
    for (const file of [
      "./examples/synthetic-evidence-bundle.json",
      "./examples/synthetic-manual-evidence.json"
    ]) {
      const synthetic = JSON.parse(
        await readFile(new URL(file, import.meta.url), "utf8")
      ) as unknown;
      expect(validateEvidenceBundle(synthetic)).toEqual(
        expect.arrayContaining(["Synthetic bundles are not accepted by a production release gate."])
      );
      expect(
        validateEvidenceBundle(synthetic, { allowSynthetic: true, requireAllPhases: false })
      ).toEqual([]);
    }
  });

  it("rejects evidence outside the configured private directory", () => {
    expect(validatePrivateEvidencePath("/private/tmp/evidence.json", "/workspace")).toEqual([
      "Evidence input must be a file below release-evidence/private/."
    ]);
    expect(
      validatePrivateEvidencePath("/workspace/release-evidence/private/bundle.json", "/workspace")
    ).toEqual([]);
  });

  it("requires restrictive directory and evidence-file modes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vera-evidence-test-"));
    const privateDirectory = join(workspace, "release-evidence", "private");
    const evidencePath = join(privateDirectory, "bundle.json");
    try {
      await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
      await chmod(privateDirectory, 0o700);
      await writeFile(evidencePath, JSON.stringify(bundle()), { mode: 0o600 });
      await chmod(evidencePath, 0o600);

      expect(
        (
          await loadPrivateEvidenceBundle({
            evidencePath,
            workspaceRoot: workspace,
            decisionAt
          })
        ).violations
      ).toEqual([]);

      await chmod(evidencePath, 0o644);
      expect(
        (await loadPrivateEvidenceBundle({ evidencePath, workspaceRoot: workspace })).violations
      ).toEqual(["Private evidence file must not grant group or other access."]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects missing and modified record hashes", () => {
    const validRecord = record("direct_capture");
    const { contentHash: _removed, ...withoutHash } = validRecord;
    const modified = { ...validRecord, observedResult: "Changed observed result" };
    expect(validateEvidenceRecord(withoutHash)).toContain("record.contentHash is required.");
    expect(validateEvidenceRecord(modified)).toContain(
      "record.contentHash does not match the canonical record content."
    );
    expect(recordContentHash(validRecord)).toBe(validRecord.contentHash);
  });

  it.each([
    [
      "source commit",
      (valid: ReleaseEvidenceRecord) => ({ ...valid, sourceCommit: otherCommit }),
      "bundle.records[0].sourceCommit must match bundle.sourceCommit."
    ],
    [
      "environment",
      (valid: ReleaseEvidenceRecord) => ({ ...valid, environmentId: "other-staging" }),
      "bundle.records[0].environmentId must match bundle.environmentId."
    ],
    [
      "profile",
      (valid: ReleaseEvidenceRecord) => ({
        ...valid,
        releaseProfile: "founder_browser_experimental"
      }),
      "bundle.records[0].releaseProfile must match bundle.releaseProfile."
    ],
    [
      "capabilities",
      (valid: ReleaseEvidenceRecord) => ({
        ...valid,
        capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities
      }),
      "bundle.records[0].capabilities must match bundle release capabilities."
    ],
    [
      "worker digest",
      (valid: ReleaseEvidenceRecord) => ({
        ...valid,
        candidateWorkerImage: otherWorkerImage
      }),
      "bundle.records[0].candidateWorkerImage must match bundle.candidateWorkerImage."
    ],
    [
      "OpenClaw digest",
      (valid: ReleaseEvidenceRecord) => ({
        ...valid,
        candidateOpenclawImage: openclawImage
      }),
      "bundle.records[0].candidateOpenclawImage must match bundle.candidateOpenclawImage."
    ]
  ])("rejects a mixed %s", (_label, mutate, expected) => {
    const evidence = bundle();
    const mixed = {
      ...evidence,
      records: [mutate(evidence.records[0]!), ...evidence.records.slice(1)]
    };
    expect(validateEvidenceBundle(mixed)).toContain(expected);
    expect(classifyEvidenceBundle(mixed, decisionAt)).toBe("no_go");
  });

  it("rejects mutable images, missing required phases, and duplicate phases", () => {
    const evidence = bundle();
    const mutable = { ...evidence, candidateWorkerImage: "ghcr.io/example/vera-worker:latest" };
    const missing = bundle(evidence.records.slice(1));
    const duplicate = bundle([...evidence.records, evidence.records[0]!]);

    expect(validateEvidenceBundle(mutable)).toContain(
      "bundle.candidateWorkerImage must be an immutable OCI digest."
    );
    expect(validateEvidenceBundle(missing)).toContain(
      `bundle is missing required phase record ${evidence.records[0]!.phaseId}.`
    );
    expect(validateEvidenceBundle(duplicate)).toContain(
      `bundle.records[${duplicate.records.length - 1}].phaseId is duplicated.`
    );
    expect(classifyEvidenceBundle(mutable, decisionAt)).toBe("no_go");
    expect(classifyEvidenceBundle(missing, decisionAt)).toBe("no_go");
    expect(classifyEvidenceBundle(duplicate, decisionAt)).toBe("no_go");
  });

  it.each([
    ["failed_assertion", "no_go"],
    ["failed_provider", "no_go"],
    ["not_applicable_with_approved_reason", "no_go"],
    ["blocked_missing_configuration", "conditional_go_founder_only_staging"]
  ] as const)("classifies a required %s phase", (resultState, expected) => {
    const evidence = replacePhase(bundle(), "postgresql_restore", resultState);
    expect(classifyEvidenceBundle(evidence, decisionAt)).toBe(expected);
    expect(isPassingEvidenceBundle(evidence, decisionAt)).toBe(false);
  });

  it("classifies all completed founder-core phases as core beta go", () => {
    const evidence = bundle(
      RELEASE_PROFILES.founder_core.requiredPhaseIds.map((phaseId) =>
        record(
          phaseId,
          phaseId === "direct_capture" ? "passed_manual_evidence" : "passed_automated"
        )
      )
    );
    expect(classifyEvidenceBundle(evidence, decisionAt)).toBe("go_founder_only_core_beta");
  });

  it.each([
    "missing_runner",
    "unimplemented_feature",
    "failing_test",
    "undecided_architecture",
    "incomplete_policy_enforcement",
    "mocked_only_path",
    "schema_gap",
    "unresolved_security_finding"
  ])("rejects %s as a configuration blocker", (missingConfiguration) => {
    const invalidBlocker = { ...validBlocker, missingConfiguration };
    const invalidRecord = record(
      "postgresql_restore",
      "blocked_missing_configuration",
      invalidBlocker
    );
    expect(validateEvidenceRecord(invalidRecord)).toContain(
      "record.configurationBlocker cannot represent a code, test, policy, architecture, schema, mocked-path, runner, or security gap."
    );
    expect(
      classifyEvidenceBundle(
        replacePhase(
          bundle(),
          "postgresql_restore",
          "blocked_missing_configuration",
          invalidBlocker
        ),
        decisionAt
      )
    ).toBe("no_go");
  });

  it("requires blocker attestation, remediation, and an eligible live phase", () => {
    const requiresCode = record("postgresql_restore", "blocked_missing_configuration", {
      ...validBlocker,
      requiresRepositoryChange: true
    } as unknown as ConfigurationBlocker);
    const missingRemediation = record("postgresql_restore", "blocked_missing_configuration", {
      ...validBlocker,
      remediation: ""
    });
    const staticBlock = record(
      "release_static_readiness",
      "blocked_missing_configuration",
      validBlocker
    );
    expect(validateEvidenceRecord(requiresCode)).toContain(
      "record.configurationBlocker.requiresRepositoryChange must be false."
    );
    expect(validateEvidenceRecord(missingRemediation)).toContain(
      "record.configurationBlocker.remediation must be bounded sanitized text."
    );
    expect(validateEvidenceRecord(staticBlock)).toContain(
      "record.configurationBlocker is not allowed for an implementation or static-validation phase."
    );
  });

  it("rejects stale and future evidence deterministically", () => {
    const stale = bundle().records.map((candidate) =>
      withRecordContentHash({ ...candidate, executedAt: "2026-07-10T12:00:00Z" })
    );
    const staleBundle = withBundleContentHash({
      ...bundle(stale),
      createdAt: "2026-07-10T12:05:00Z"
    });
    const futureRecord = withRecordContentHash({
      ...record("direct_capture"),
      executedAt: "2026-07-23T12:10:00Z"
    });
    const futureBundle = bundle([
      futureRecord,
      ...bundle().records.filter((candidate) => candidate.phaseId !== "direct_capture")
    ]);
    expect(validateEvidenceBundle(staleBundle, { decisionAt })).toContain(
      "bundle evidence is stale at the release decision."
    );
    expect(validateEvidenceBundle(futureBundle, { decisionAt })).toContain(
      "bundle.records[0].executedAt cannot be after bundle.createdAt."
    );
    expect(classifyEvidenceBundle(staleBundle, decisionAt)).toBe("no_go");
    expect(classifyEvidenceBundle(futureBundle, decisionAt)).toBe("no_go");
  });

  it("rejects arbitrary fields, secrets, raw emails, browser snapshots, and private identifiers", () => {
    const validRecord = record("direct_capture");
    for (const unsafe of [
      { ...validRecord, metadata: "unexpected" },
      { ...validRecord, observedResult: "Bearer sk_secretvalue" },
      { ...validRecord, observedResult: "From: renter@example.test" },
      { ...validRecord, observedResult: "<!doctype html><html>snapshot</html>" },
      { ...validRecord, observedResult: "/Users/founder/.openclaw/profiles/local" },
      { ...validRecord, operatorReference: "node_0123456789" }
    ]) {
      expect(validateEvidenceRecord(unsafe).length).toBeGreaterThan(0);
    }
  });

  it("allows manual evidence only for its named profile phase", () => {
    const validRecord = record("direct_capture", "passed_manual_evidence");
    expect(validateEvidenceRecord(validRecord)).toEqual([]);
    expect(validateEvidenceRecord({ ...validRecord, phaseId: "gateway_restart" })).toContain(
      "record.phaseId is not required by record.releaseProfile."
    );
    expect(
      validateEvidenceRecord({
        ...record("release_static_readiness"),
        resultState: "passed_manual_evidence"
      })
    ).toContain("record.resultState cannot claim manual evidence for an automated-only phase.");
  });

  it("rejects OpenClaw binding for core and keeps browser experimental no-go", () => {
    const invalidCore = withBundleContentHash({
      ...bundle(),
      candidateOpenclawImage: openclawImage
    });
    expect(validateEvidenceBundle(invalidCore)).toContain(
      "bundle.candidateOpenclawImage must be null for founder_core."
    );

    const browserRecords = RELEASE_PROFILES.founder_browser_experimental.requiredPhaseIds.map(
      (phaseId) =>
        withRecordContentHash({
          ...record("direct_capture"),
          releaseProfile: "founder_browser_experimental" as const,
          capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities,
          phaseId,
          candidateOpenclawImage: openclawImage
        })
    );
    const browserBundle = withBundleContentHash({
      ...bundle(),
      releaseProfile: "founder_browser_experimental" as const,
      capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities,
      candidateOpenclawImage: openclawImage,
      records: browserRecords
    });
    expect(validateEvidenceBundle(browserBundle, { decisionAt })).toEqual([]);
    expect(classifyEvidenceBundle(browserBundle, decisionAt)).toBe("no_go");
  });

  it("binds a signature and emits only the sanitized founder-core decision", () => {
    const evidence = bundle();
    const signed = {
      ...evidence,
      signature: {
        kind: "ci" as const,
        signerReference: "workflow-run-001",
        signedBundleHash: evidence.bundleHash,
        value: "a".repeat(64)
      }
    };

    expect(validateEvidenceBundle(signed, { decisionAt })).toEqual([]);
    expect(
      validateEvidenceBundle({
        ...signed,
        signature: { ...signed.signature, signedBundleHash: "4".repeat(64) }
      })
    ).toContain("bundle.signature.signedBundleHash must bind bundle.bundleHash.");
    expect(createReleaseDecisionSummary(signed, decisionAt)).toEqual({
      schemaVersion: 2,
      releaseId: "founder-release-001",
      releaseProfile: "founder_core",
      capabilities: RELEASE_PROFILES.founder_core.capabilities,
      sourceCommit: commit,
      workerImageDigest: workerImage,
      openclawImageDigest: null,
      evidenceBundleSha256: evidence.bundleHash,
      finalClassification: "go_founder_only_core_beta",
      approvalTimestamp: decisionAt
    });

    const conditional = replacePhase(
      evidence,
      "postgresql_restore",
      "blocked_missing_configuration"
    );
    expect(createReleaseDecisionSummary(conditional, decisionAt).finalClassification).toBe(
      "conditional_go_founder_only_staging"
    );
  });
});
