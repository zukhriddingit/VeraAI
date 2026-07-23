import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateReleaseManifest } from "./verify-release-manifest";

const ACTIVE_OPENCLAW_DIGEST = "99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee";
const hash = (character: string): string => character.repeat(64);

function vulnerabilityReview() {
  return {
    critical: 0,
    highAccepted: 0,
    scanner: "trivy 0.69.3",
    databaseUpdatedAt: "2026-07-22T12:00:00Z",
    scannedAt: "2026-07-22T12:05:00Z"
  } as const;
}

function validManifest() {
  const releaseCommit = "a".repeat(40);
  return {
    schemaVersion: 1,
    releaseCommit,
    createdAt: "2026-07-22T12:10:00Z",
    worker: {
      image: `ghcr.io/vera/worker@sha256:${hash("1")}`,
      sourceCommit: releaseCommit,
      sbomSha256: hash("2"),
      provenanceVerified: true,
      signatureVerified: true,
      vulnerabilityReview: vulnerabilityReview()
    },
    openclaw: {
      image: `ghcr.io/openclaw/openclaw@sha256:${ACTIVE_OPENCLAW_DIGEST}`,
      version: "2026.6.33",
      upstreamCommit: "7af0cfc",
      sbomSha256: hash("3"),
      provenanceVerified: true,
      signatureVerified: true,
      vulnerabilityReview: vulnerabilityReview()
    },
    rollback: {
      reviewedWorkerImage: `ghcr.io/vera/worker@sha256:${hash("4")}`,
      reviewedOpenclawImage: `ghcr.io/openclaw/openclaw@sha256:${hash("5")}`,
      workerSchemaCompatible: true,
      workerCompatibilityEvidenceSha256: hash("6")
    }
  } as const;
}

describe("release manifest validation", () => {
  it("accepts complete immutable evidence", () => {
    expect(validateReleaseManifest(validManifest())).toEqual([]);
  });

  it("rejects mutable images and missing evidence", () => {
    const manifest = validManifest();
    expect(
      validateReleaseManifest({
        ...manifest,
        worker: { image: "ghcr.io/example/vera-worker:latest" },
        openclaw: { image: "ghcr.io/openclaw/openclaw:2026.6.33" }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/worker digest/iu),
        expect.stringMatching(/OpenClaw digest/iu),
        expect.stringMatching(/SBOM/iu),
        expect.stringMatching(/provenance/iu)
      ])
    );
  });

  it("enforces a closed schema at every evidence boundary", () => {
    const manifest = validManifest();
    const violations = validateReleaseManifest({
      ...manifest,
      token: "must-never-be-accepted",
      worker: {
        ...manifest.worker,
        mutableTag: "latest",
        vulnerabilityReview: {
          ...manifest.worker.vulnerabilityReview,
          ignored: true
        }
      },
      rollback: { ...manifest.rollback, note: "trust me" }
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("manifest.token is not allowed"),
        expect.stringContaining("worker.mutableTag is not allowed"),
        expect.stringContaining("worker.vulnerabilityReview.ignored is not allowed"),
        expect.stringContaining("rollback.note is not allowed")
      ])
    );
  });

  it("binds worker source bytes to the release commit", () => {
    const manifest = validManifest();
    expect(
      validateReleaseManifest({
        ...manifest,
        worker: { ...manifest.worker, sourceCommit: "b".repeat(40) }
      })
    ).toContain("worker.sourceCommit must exactly equal manifest.releaseCommit.");
    expect(
      validateReleaseManifest({
        ...manifest,
        worker: { ...manifest.worker, sourceCommit: "not-a-commit" }
      })
    ).toContain("worker.sourceCommit must be a lowercase 40-character Git commit.");
  });

  it("pins the exact reviewed OpenClaw release", () => {
    const manifest = validManifest();
    const violations = validateReleaseManifest({
      ...manifest,
      openclaw: {
        ...manifest.openclaw,
        image: `ghcr.io/openclaw/openclaw@sha256:${hash("6")}`,
        version: "2026.7.0",
        upstreamCommit: "deadbee"
      }
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("OpenClaw digest must be exactly"),
        expect.stringContaining("OpenClaw version must be exactly 2026.6.33"),
        expect.stringContaining("OpenClaw upstream commit must be exactly 7af0cfc")
      ])
    );
  });

  it("requires successful signed evidence and timestamped zero-exception scans", () => {
    const manifest = validManifest();
    const violations = validateReleaseManifest({
      ...manifest,
      worker: {
        ...manifest.worker,
        provenanceVerified: false,
        signatureVerified: false,
        vulnerabilityReview: {
          critical: 1,
          highAccepted: 2,
          scanner: " ",
          databaseUpdatedAt: "2026-02-31T00:00:00Z",
          scannedAt: "yesterday"
        }
      }
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("worker provenance verification must be true"),
        expect.stringContaining("worker signature verification must be true"),
        expect.stringContaining("zero critical"),
        expect.stringContaining("zero high"),
        expect.stringContaining("identify its scanner"),
        expect.stringContaining("databaseUpdatedAt must be an ISO-8601 instant"),
        expect.stringContaining("scannedAt must be an ISO-8601 instant")
      ])
    );
  });

  it("requires real rollback worker identity and schema compatibility before image rollback", () => {
    const manifest = validManifest();
    const violations = validateReleaseManifest({
      ...manifest,
      rollback: {
        reviewedWorkerImage: manifest.worker.image,
        reviewedOpenclawImage: manifest.openclaw.image,
        workerSchemaCompatible: false,
        workerCompatibilityEvidenceSha256: "0".repeat(64)
      }
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("different immutable worker artifact"),
        expect.stringContaining("workerSchemaCompatible must be true"),
        expect.stringContaining("compatibility evidence")
      ])
    );
    expect(
      validateReleaseManifest({
        ...manifest,
        rollback: {
          reviewedWorkerImage: "ghcr.io/vera/worker:previous",
          reviewedOpenclawImage: "ghcr.io/openclaw/openclaw:previous",
          workerSchemaCompatible: true,
          workerCompatibilityEvidenceSha256: hash("7")
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rollback.reviewedWorkerImage"),
        expect.stringContaining("rollback.reviewedOpenclawImage")
      ])
    );
    expect(
      validateReleaseManifest({
        ...manifest,
        rollback: {
          reviewedWorkerImage: `ghcr.io/other/worker@sha256:${hash("8")}`,
          reviewedOpenclawImage: `ghcr.io/other/openclaw@sha256:${hash("9")}`,
          workerSchemaCompatible: true,
          workerCompatibilityEvidenceSha256: hash("a")
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("active worker image repository"),
        expect.stringContaining("active OpenClaw image repository")
      ])
    );
  });

  it("keeps the checked-in JSON schema closed at all object levels", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL("../infra/maritime/release-manifest.schema.json", import.meta.url),
        "utf8"
      )
    ) as {
      readonly additionalProperties?: unknown;
      readonly properties?: Record<
        string,
        {
          readonly additionalProperties?: unknown;
          readonly properties?: Record<string, { readonly const?: unknown }>;
        }
      >;
      readonly $defs?: Record<
        string,
        { readonly additionalProperties?: unknown; readonly required?: readonly string[] }
      >;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.worker?.additionalProperties).toBe(false);
    expect(schema.properties?.openclaw?.additionalProperties).toBe(false);
    expect(schema.properties?.rollback?.additionalProperties).toBe(false);
    expect(schema.$defs?.vulnerabilityReview?.additionalProperties).toBe(false);
    expect(schema.$defs?.vulnerabilityReview?.required).toContain("scannedAt");
    expect(schema.properties?.openclaw?.properties?.image?.const).toContain(
      `@sha256:${ACTIVE_OPENCLAW_DIGEST}`
    );
    expect(schema.properties?.openclaw?.properties?.version?.const).toBe("2026.6.33");
    expect(schema.properties?.openclaw?.properties?.upstreamCommit?.const).toBe("7af0cfc");
  });

  it("makes live evidence optional for local validation without claiming deploy readiness", () => {
    const validator = readFileSync(
      new URL("../infra/maritime/validate.mjs", import.meta.url),
      "utf8"
    );

    expect(validator).toContain("process.env.VERA_RELEASE_MANIFEST_PATH?.trim()");
    expect(validator).toContain("live release evidence not supplied");
    expect(validator).toContain("deployment readiness was not established");
    expect(validator).toContain('"scripts/verify-release-manifest.ts"');
  });
});
