import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FOUNDER_STAGING_PHASES,
  bundleContentHash,
  createReleaseDecisionSummary,
  isPassingEvidenceBundle,
  loadPrivateEvidenceBundle,
  recordContentHash,
  validateEvidenceBundle,
  validateEvidenceRecord,
  validatePrivateEvidencePath,
  withBundleContentHash,
  withRecordContentHash,
  type FounderStagingPhaseId,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceRecord
} from "./release-evidence.ts";

const commit = "a".repeat(40);
const workerImage = `ghcr.io/example/vera-worker@sha256:${"1".repeat(64)}`;
const openclawImage = `ghcr.io/openclaw/openclaw@sha256:${"2".repeat(64)}`;

function record(phaseId: FounderStagingPhaseId): ReleaseEvidenceRecord {
  return withRecordContentHash({
    schemaVersion: 1,
    synthetic: false,
    phaseId,
    releaseId: "founder-release-001",
    environmentId: "founder-staging",
    sourceCommit: commit,
    candidateWorkerImage: workerImage,
    candidateOpenclawImage: phaseId.includes("gateway") ? openclawImage : null,
    executedAt: "2026-07-23T12:00:00Z",
    operatorReference: "operator-opaque-001",
    expectedResult: "Expected safety control is enforced",
    observedResult: "Observed safety control is enforced",
    resultState: "passed_manual_evidence",
    evidenceReferences: [{ kind: "test_run", locator: `run-${phaseId}`, sha256: "3".repeat(64) }],
    approvalState: "approved"
  });
}

function bundle(records = FOUNDER_STAGING_PHASES.map(record)): ReleaseEvidenceBundle {
  return withBundleContentHash({
    schemaVersion: 1,
    synthetic: false,
    releaseId: "founder-release-001",
    environmentId: "founder-staging",
    sourceCommit: commit,
    candidateWorkerImage: workerImage,
    candidateOpenclawImage: openclawImage,
    createdAt: "2026-07-23T12:05:00Z",
    records
  });
}

describe("founder staging external evidence", () => {
  it("accepts a complete, deterministic manual-evidence bundle", () => {
    const evidence = bundle();
    expect(validateEvidenceBundle(evidence)).toEqual([]);
    expect(isPassingEvidenceBundle(evidence)).toBe(true);
    expect(bundleContentHash(evidence)).toBe(evidence.bundleHash);
    expect(bundle().bundleHash).toBe(evidence.bundleHash);
    expect(bundleContentHash({ ...evidence, records: [...evidence.records].reverse() })).not.toBe(
      evidence.bundleHash
    );
  });

  it("rejects the committed synthetic example in a production release gate", async () => {
    const synthetic = JSON.parse(
      await readFile(new URL("./examples/synthetic-evidence-bundle.json", import.meta.url), "utf8")
    ) as unknown;
    expect(validateEvidenceBundle(synthetic)).toEqual(
      expect.arrayContaining(["Synthetic bundles are not accepted by a production release gate."])
    );
    expect(
      validateEvidenceBundle(synthetic, { allowSynthetic: true, requireAllPhases: false })
    ).toEqual([]);
  });

  it("rejects an evidence file outside the configured private input directory", () => {
    expect(validatePrivateEvidencePath("/private/tmp/evidence.json", "/workspace")).toEqual([
      "Evidence input must be a file below release-evidence/private/."
    ]);
    expect(
      validatePrivateEvidencePath("/workspace/release-evidence/private/bundle.json", "/workspace")
    ).toEqual([]);
  });

  it("requires restrictive modes for the private evidence directory and file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "vera-evidence-test-"));
    const privateDirectory = join(workspace, "release-evidence", "private");
    const evidencePath = join(privateDirectory, "bundle.json");
    try {
      await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
      await chmod(privateDirectory, 0o700);
      await writeFile(evidencePath, JSON.stringify(bundle()), { mode: 0o600 });
      await chmod(evidencePath, 0o600);

      expect(
        (await loadPrivateEvidenceBundle({ evidencePath, workspaceRoot: workspace })).violations
      ).toEqual([]);

      await chmod(evidencePath, 0o644);
      expect(
        (await loadPrivateEvidenceBundle({ evidencePath, workspaceRoot: workspace })).violations
      ).toEqual(["Private evidence file must not grant group or other access."]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects missing or modified record content hashes", () => {
    const validRecord = record("gateway_unauthenticated_request");
    const withoutHash = { ...validRecord, contentHash: "" };
    const modified = { ...validRecord, observedResult: "Changed observed result" };
    expect(validateEvidenceRecord(withoutHash)).toEqual(
      expect.arrayContaining(["record.contentHash must be a non-placeholder SHA-256."])
    );
    expect(validateEvidenceRecord(modified)).toEqual(
      expect.arrayContaining(["record.contentHash does not match the canonical record content."])
    );
    expect(recordContentHash(validRecord)).toBe(validRecord.contentHash);
  });

  it("rejects mixed commits, candidate identities, mutable tags, missing phases, and blocked passes", () => {
    const evidence = bundle();
    const mixed = {
      ...evidence,
      records: [
        { ...evidence.records[0], sourceCommit: "b".repeat(40) },
        ...evidence.records.slice(1)
      ]
    };
    const mutable = { ...evidence, candidateWorkerImage: "ghcr.io/example/vera-worker:latest" };
    const missing = bundle([record("gateway_unauthenticated_request")]);
    const blockedRecord = withRecordContentHash({
      ...record("gateway_unauthenticated_request"),
      resultState: "blocked_missing_configuration" as const
    });
    const blocked = bundle([blockedRecord, ...FOUNDER_STAGING_PHASES.slice(1).map(record)]);

    expect(validateEvidenceBundle(mixed)).toEqual(
      expect.arrayContaining([
        "bundle.records[0].sourceCommit must match bundle.sourceCommit.",
        "bundle.bundleHash does not match the canonical accepted evidence manifest."
      ])
    );
    expect(validateEvidenceBundle(mutable)).toEqual(
      expect.arrayContaining([
        "bundle.candidateWorkerImage must be an immutable OCI digest.",
        "bundle.bundleHash does not match the canonical accepted evidence manifest."
      ])
    );
    expect(validateEvidenceBundle(missing)).toContain(
      "bundle is missing required phase record gateway_wrong_token."
    );
    expect(isPassingEvidenceBundle(blocked)).toBe(false);
  });

  it("rejects arbitrary fields, secrets, raw emails, browser snapshots, and node identifiers", () => {
    const validRecord = record("gateway_unauthenticated_request");
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

  it("allows manual evidence only for the declared required phase", () => {
    const validRecord = record("gmail_readonly_verification");
    expect(validateEvidenceRecord(validRecord)).toEqual([]);
    expect(validateEvidenceRecord({ ...validRecord, phaseId: "arbitrary_phase" })).toEqual(
      expect.arrayContaining(["record.phaseId must be a required founder staging phase."])
    );
  });

  it("binds an optional signature and emits only a sanitized final decision", () => {
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

    expect(validateEvidenceBundle(signed)).toEqual([]);
    expect(
      validateEvidenceBundle({
        ...signed,
        signature: { ...signed.signature, signedBundleHash: "4".repeat(64) }
      })
    ).toEqual(
      expect.arrayContaining(["bundle.signature.signedBundleHash must bind bundle.bundleHash."])
    );
    expect(createReleaseDecisionSummary(signed, "2026-07-23T12:06:00Z")).toEqual({
      schemaVersion: 1,
      releaseId: "founder-release-001",
      sourceCommit: commit,
      workerImageDigest: workerImage,
      openclawImageDigest: openclawImage,
      evidenceBundleSha256: evidence.bundleHash,
      finalClassification: "passed",
      approvalTimestamp: "2026-07-23T12:06:00Z"
    });
  });
});
