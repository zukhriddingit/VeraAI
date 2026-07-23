import { describe, expect, it } from "vitest";

import {
  analyzeTrivyReport,
  createWorkerReleaseEvidence,
  readTrivyVersion,
  spdxPredicateType
} from "./worker-release-evidence.mjs";

const digest = "1".repeat(64);
const image = `ghcr.io/vera/vera-worker@sha256:${digest}`;

function trivyReport(severity?: "HIGH" | "CRITICAL") {
  return {
    SchemaVersion: 2,
    CreatedAt: "2026-07-22T18:20:00Z",
    ArtifactName: image,
    ArtifactType: "container_image",
    Metadata: { RepoDigests: [image], ImageID: `sha256:${"3".repeat(64)}` },
    Results: [
      {
        Target: "debian",
        Class: "os-pkgs",
        Type: "debian",
        Packages: [{ Name: "libc6", Version: "fixture" }],
        Vulnerabilities: severity ? [{ VulnerabilityID: "CVE-fixture", Severity: severity }] : []
      },
      {
        Target: "apps/worker/package.json",
        Class: "lang-pkgs",
        Type: "node-pkg",
        Packages: [{ Name: "openclaw", Version: "2026.6.33" }],
        Vulnerabilities: []
      }
    ]
  };
}

const trivyVersion = {
  Version: "0.72.0",
  VulnerabilityDB: { UpdatedAt: "2026-07-22T18:00:00Z" }
};

function evidenceInput() {
  const workflowRef =
    "vera/VeraAI/.github/workflows/release-worker.yml@refs/heads/codex/founder-release";
  const report = trivyReport();
  const digestEvidence = Buffer.from(JSON.stringify([{ digest }]));
  return {
    image,
    sourceCommit: "a".repeat(40),
    createdAt: "2026-07-22T18:30:00Z",
    sbom: { spdxVersion: "SPDX-2.3" },
    sbomBytes: Buffer.from('{"spdxVersion":"SPDX-2.3"}\n'),
    trivyReport: report,
    trivyReportBytes: Buffer.from(JSON.stringify(report)),
    trivyVersion,
    cosignVerificationBytes: digestEvidence,
    provenanceVerificationBytes: digestEvidence,
    sbomVerificationBytes: digestEvidence,
    provenanceBundleBytes: Buffer.from('{"bundle":"provenance"}'),
    sbomBundleBytes: Buffer.from('{"bundle":"sbom"}'),
    workflowRef,
    certificateIdentity: `https://github.com/${workflowRef}`,
    attestationUrl: "https://github.com/vera/VeraAI/attestations/1",
    workflowRunUrl: "https://github.com/vera/VeraAI/actions/runs/1"
  };
}

describe("worker release evidence", () => {
  it("derives only the versioned predicate types emitted for supported SPDX documents", () => {
    expect(spdxPredicateType({ spdxVersion: "SPDX-2.2" })).toBe("https://spdx.dev/Document/v2.2");
    expect(spdxPredicateType({ spdxVersion: "SPDX-2.3" })).toBe("https://spdx.dev/Document/v2.3");
    expect(() => spdxPredicateType({ spdxVersion: "SPDX-3.0" })).toThrow(/supported SPDX/iu);
  });

  it("creates sanitized evidence bound to the image, source, workflow, and scanner database", () => {
    const evidence = createWorkerReleaseEvidence(evidenceInput());

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      sourceCommit: "a".repeat(40),
      image,
      provenance: { verified: true },
      signature: {
        verified: true,
        oidcIssuer: "https://token.actions.githubusercontent.com"
      },
      vulnerabilityReview: {
        critical: 0,
        highAccepted: 0,
        scanner: "trivy 0.72.0",
        databaseUpdatedAt: "2026-07-22T18:00:00Z"
      }
    });
    expect(JSON.stringify(evidence)).not.toMatch(/"(?:token|password|cookie|secret)"\s*:/iu);
  });

  it.each(["HIGH", "CRITICAL"] as const)("fails closed on a %s finding", (severity) => {
    expect(() => analyzeTrivyReport(trivyReport(severity), image)).toThrow(/release is blocked/iu);
  });

  it("rejects a report for another digest and missing scanner database freshness", () => {
    expect(() =>
      analyzeTrivyReport(
        {
          ...trivyReport(),
          ArtifactName: `ghcr.io/vera/vera-worker@sha256:${"2".repeat(64)}`,
          Metadata: { ...trivyReport().Metadata, RepoDigests: [] }
        },
        image
      )
    ).toThrow(/not bound/iu);
    expect(() =>
      readTrivyVersion({ Version: "0.72.0", VulnerabilityDB: {} }, "2026-07-22T18:20:00Z")
    ).toThrow(/UpdatedAt/iu);
  });

  it("rejects empty package coverage and a stale scanner database", () => {
    expect(() => analyzeTrivyReport({ ...trivyReport(), Results: [] }, image)).toThrow(
      /non-empty scan results/iu
    );
    expect(() =>
      analyzeTrivyReport(
        {
          ...trivyReport(),
          Results: trivyReport().Results.map((result) => ({ ...result, Packages: [] }))
        },
        image
      )
    ).toThrow(/operating-system and Node production packages/iu);
    expect(() =>
      readTrivyVersion(
        { Version: "0.72.0", VulnerabilityDB: { UpdatedAt: "2026-07-20T18:00:00Z" } },
        "2026-07-22T18:20:00Z"
      )
    ).toThrow(/within 24 hours/iu);
  });

  it("rejects empty or digest-mismatched cryptographic verification outputs", () => {
    expect(() =>
      createWorkerReleaseEvidence({
        ...evidenceInput(),
        cosignVerificationBytes: Buffer.from("[]")
      })
    ).toThrow(/non-empty verification evidence/iu);
    expect(() =>
      createWorkerReleaseEvidence({
        ...evidenceInput(),
        provenanceVerificationBytes: Buffer.from('{"digest":"different"}')
      })
    ).toThrow(/must reference the worker image digest/iu);
  });

  it("rejects a mismatched signing identity and malformed release commit", () => {
    expect(() =>
      createWorkerReleaseEvidence({ ...evidenceInput(), certificateIdentity: "someone-else" })
    ).toThrow(/certificate identity/iu);
    expect(() => createWorkerReleaseEvidence({ ...evidenceInput(), sourceCommit: "main" })).toThrow(
      /40-character Git commit/iu
    );
  });
});
