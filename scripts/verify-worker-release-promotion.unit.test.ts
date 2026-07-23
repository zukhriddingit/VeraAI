import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildPromotionVerificationCommands,
  verifyWorkerReleasePromotion
} from "./verify-worker-release-promotion";

const digest = "1".repeat(64);
const sourceCommit = "a".repeat(40);
const image = `ghcr.io/zukhriddingit/vera-worker@sha256:${digest}`;
const sbomBytes = Buffer.from('{"spdxVersion":"SPDX-2.3"}');
const sbomSha256 = createHash("sha256").update(sbomBytes).digest("hex");
const workflowRef =
  "zukhriddingit/VeraAI/.github/workflows/release-worker.yml@refs/heads/codex/founder-release";

function vulnerabilityReview() {
  return {
    critical: 0,
    highAccepted: 0,
    scanner: "trivy 0.72.0",
    databaseUpdatedAt: "2026-07-22T12:00:00Z",
    scannedAt: "2026-07-22T12:05:00Z"
  };
}

function input() {
  return {
    manifest: {
      schemaVersion: 1,
      releaseCommit: sourceCommit,
      createdAt: "2026-07-22T12:10:00Z",
      worker: {
        image,
        sourceCommit,
        sbomSha256,
        provenanceVerified: true,
        signatureVerified: true,
        vulnerabilityReview: vulnerabilityReview()
      },
      openclaw: {
        image:
          "ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee",
        version: "2026.6.33",
        upstreamCommit: "7af0cfc",
        sbomSha256: "2".repeat(64),
        provenanceVerified: true,
        signatureVerified: true,
        vulnerabilityReview: vulnerabilityReview()
      },
      rollback: {
        reviewedWorkerImage: `ghcr.io/zukhriddingit/vera-worker@sha256:${"3".repeat(64)}`,
        reviewedOpenclawImage: `ghcr.io/openclaw/openclaw@sha256:${"4".repeat(64)}`,
        workerSchemaCompatible: true,
        workerCompatibilityEvidenceSha256: "5".repeat(64)
      }
    },
    evidence: {
      image,
      sourceCommit,
      sbom: { sha256: sbomSha256 },
      provenance: { workflowRef },
      signature: { certificateIdentity: `https://github.com/${workflowRef}` }
    },
    sbomBytes,
    provenanceBundlePath: "/private/release/provenance-bundle.json",
    sbomBundlePath: "/private/release/sbom-bundle.json"
  };
}

function verifiedOutput(predicate: unknown = JSON.parse(sbomBytes.toString("utf8"))) {
  return JSON.stringify([
    {
      verificationResult: {
        statement: {
          subject: [{ digest: { sha256: digest } }],
          predicateType: "https://spdx.dev/Document/v2.3",
          predicate
        }
      }
    }
  ]);
}

describe("worker release promotion verification", () => {
  it("builds exact digest-, source-, and workflow-bound verification commands", () => {
    const commands = buildPromotionVerificationCommands(input());

    expect(commands).toHaveLength(3);
    expect(commands[0]).toMatchObject({ executable: "cosign" });
    expect(commands[0]?.args).toEqual(
      expect.arrayContaining([image, `https://github.com/${workflowRef}`])
    );
    expect(commands[1]?.args).toEqual(
      expect.arrayContaining([
        `oci://${image}`,
        "zukhriddingit/VeraAI",
        sourceCommit,
        "zukhriddingit/VeraAI/.github/workflows/release-worker.yml",
        "/private/release/provenance-bundle.json"
      ])
    );
    expect(commands[2]?.args).toEqual(
      expect.arrayContaining([
        "--predicate-type",
        "https://spdx.dev/Document/v2.3",
        "/private/release/sbom-bundle.json"
      ])
    );
  });

  it("runs all three cryptographic verifiers and requires digest-bound output", () => {
    const runner = vi.fn((command) =>
      command.label === "GitHub SBOM attestation verification"
        ? verifiedOutput()
        : JSON.stringify({ digest })
    );

    verifyWorkerReleasePromotion(input(), runner);

    expect(runner).toHaveBeenCalledTimes(3);
    expect(() => verifyWorkerReleasePromotion(input(), () => "verified something else")).toThrow(
      /digest-bound/iu
    );
  });

  it("requires the downloaded SPDX document to equal the verified attestation predicate", () => {
    expect(() =>
      verifyWorkerReleasePromotion(input(), (command) =>
        command.label === "GitHub SBOM attestation verification"
          ? verifiedOutput({ spdxVersion: "SPDX-2.2", swapped: true })
          : JSON.stringify({ digest })
      )
    ).toThrow(/cryptographically verified SPDX/iu);
  });

  it("rejects swapped evidence, SBOM bytes, workflow identities, and registry owners", () => {
    const baseline = input();
    expect(() =>
      buildPromotionVerificationCommands({
        ...baseline,
        evidence: { ...baseline.evidence, image: image.replace("vera-worker", "other") }
      })
    ).toThrow(/does not match/iu);
    expect(() =>
      buildPromotionVerificationCommands({ ...baseline, sbomBytes: Buffer.from("swapped") })
    ).toThrow(/SBOM bytes/iu);
    expect(() =>
      buildPromotionVerificationCommands({
        ...baseline,
        evidence: {
          ...baseline.evidence,
          signature: { certificateIdentity: "https://github.com/attacker/workflow" }
        }
      })
    ).toThrow(/certificate identity/iu);
    expect(() =>
      buildPromotionVerificationCommands({
        ...baseline,
        evidence: {
          ...baseline.evidence,
          provenance: {
            workflowRef:
              "zukhriddingit/OtherRepo/.github/workflows/release-worker.yml@refs/heads/codex/release"
          },
          signature: {
            certificateIdentity:
              "https://github.com/zukhriddingit/OtherRepo/.github/workflows/release-worker.yml@refs/heads/codex/release"
          }
        }
      })
    ).toThrow(/signer repository/iu);
  });
});
