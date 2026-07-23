import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RELEASE_PROFILES } from "./staging/release-profiles.ts";
import { validateReleaseManifest } from "./verify-release-manifest.ts";

const ACTIVE_OPENCLAW_DIGEST = "99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee";
const hash = (character: string): string => character.repeat(64);

function vulnerabilityReview() {
  return {
    critical: 0,
    highAccepted: 0,
    scanner: "trivy 0.72.0",
    databaseUpdatedAt: "2026-07-22T12:00:00Z",
    scannedAt: "2026-07-22T12:05:00Z"
  } as const;
}

function validCoreManifest() {
  const releaseCommit = "a".repeat(40);
  return {
    schemaVersion: 2,
    releaseProfile: "founder_core",
    capabilities: RELEASE_PROFILES.founder_core.capabilities,
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
    openclaw: null,
    rollback: {
      reviewedWorkerImage: `ghcr.io/vera/worker@sha256:${hash("4")}`,
      reviewedOpenclawImage: null,
      workerSchemaCompatible: true,
      workerCompatibilityEvidenceSha256: hash("6")
    }
  } as const;
}

function validBrowserManifest() {
  return {
    ...validCoreManifest(),
    releaseProfile: "founder_browser_experimental",
    capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities,
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
      ...validCoreManifest().rollback,
      reviewedOpenclawImage: `ghcr.io/openclaw/openclaw@sha256:${hash("5")}`
    }
  } as const;
}

describe("release manifest validation", () => {
  it("accepts complete immutable core and browser profile manifests", () => {
    expect(validateReleaseManifest(validCoreManifest())).toEqual([]);
    expect(validateReleaseManifest(validBrowserManifest())).toEqual([]);
  });

  it("binds the exact closed capabilities to the selected profile", () => {
    const core = validCoreManifest();
    expect(
      validateReleaseManifest({
        ...core,
        capabilities: RELEASE_PROFILES.founder_browser_experimental.capabilities
      })
    ).toContain("manifest.capabilities must exactly match manifest.releaseProfile.");
    expect(
      validateReleaseManifest({
        ...core,
        capabilities: { ...core.capabilities, arbitrary: true }
      })
    ).toContain("manifest.capabilities must exactly match manifest.releaseProfile.");
  });

  it("forbids OpenClaw artifacts for core and requires them for browser experimental", () => {
    const core = validCoreManifest();
    const browser = validBrowserManifest();
    expect(validateReleaseManifest({ ...core, openclaw: browser.openclaw })).toContain(
      "manifest.openclaw must be null for founder_core."
    );
    expect(
      validateReleaseManifest({
        ...core,
        rollback: {
          ...core.rollback,
          reviewedOpenclawImage: browser.rollback.reviewedOpenclawImage
        }
      })
    ).toContain("rollback.reviewedOpenclawImage must be null for founder_core.");
    expect(validateReleaseManifest({ ...browser, openclaw: null })).toEqual(
      expect.arrayContaining([expect.stringMatching(/OpenClaw.*required/iu)])
    );
    expect(
      validateReleaseManifest({
        ...browser,
        rollback: { ...browser.rollback, reviewedOpenclawImage: null }
      })
    ).toContain("rollback.reviewedOpenclawImage must be a non-placeholder digest-qualified image.");
  });

  it("rejects mutable images and missing candidate evidence", () => {
    const manifest = validBrowserManifest();
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
    const manifest = validCoreManifest();
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
    const manifest = validCoreManifest();
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

  it("pins the exact reviewed browser-experimental OpenClaw release", () => {
    const manifest = validBrowserManifest();
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
    const manifest = validCoreManifest();
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

  it("requires a distinct immutable rollback worker with compatibility evidence", () => {
    const manifest = validCoreManifest();
    const violations = validateReleaseManifest({
      ...manifest,
      rollback: {
        reviewedWorkerImage: manifest.worker.image,
        reviewedOpenclawImage: null,
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
          ...manifest.rollback,
          reviewedWorkerImage: "ghcr.io/vera/worker:previous"
        }
      })
    ).toContain("rollback.reviewedWorkerImage must be a non-placeholder digest-qualified image.");
  });

  it("keeps the checked-in JSON schema closed and profile conditional", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL("../infra/maritime/release-manifest.schema.json", import.meta.url),
        "utf8"
      )
    ) as {
      readonly additionalProperties?: unknown;
      readonly required?: readonly string[];
      readonly allOf?: readonly unknown[];
      readonly $defs?: Record<
        string,
        {
          readonly additionalProperties?: unknown;
          readonly required?: readonly string[];
          readonly properties?: Record<string, { readonly const?: unknown }>;
        }
      >;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(["releaseProfile", "capabilities", "worker", "openclaw", "rollback"])
    );
    expect(schema.allOf).toHaveLength(1);
    expect(schema.$defs?.capabilities?.additionalProperties).toBe(false);
    expect(schema.$defs?.worker?.additionalProperties).toBe(false);
    expect(schema.$defs?.openclaw?.additionalProperties).toBe(false);
    expect(schema.$defs?.rollback?.additionalProperties).toBe(false);
    expect(schema.$defs?.vulnerabilityReview?.additionalProperties).toBe(false);
    expect(schema.$defs?.openclaw?.properties?.image?.const).toContain(
      `@sha256:${ACTIVE_OPENCLAW_DIGEST}`
    );
  });

  it("makes live evidence optional locally without claiming deploy readiness", () => {
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
