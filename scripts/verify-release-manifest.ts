import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OPENCLAW_IMAGE =
  "ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee";
const OPENCLAW_VERSION = "2026.6.33";
const OPENCLAW_COMMIT = "7af0cfc";
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_DIGEST = /^[^\s@]+@sha256:([a-f0-9]{64})$/u;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

type JsonObject = Record<string, unknown>;

interface ImageIdentity {
  readonly repository: string;
  readonly digest: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireClosedObject(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  violations: string[]
): JsonObject | null {
  if (!isObject(value)) {
    violations.push(`${path} must be an object.`);
    return null;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) violations.push(`${path}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!requiredKeys.includes(key)) {
      violations.push(`${path}.${key} is not allowed by the closed release manifest schema.`);
    }
  }
  return value;
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = INSTANT.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    Number.isFinite(Date.parse(value))
  );
}

function imageIdentity(value: unknown): ImageIdentity | null {
  if (typeof value !== "string") return null;
  const match = IMAGE_DIGEST.exec(value);
  if (!match || /^0{64}$/u.test(match[1] ?? "")) return null;
  const separator = value.lastIndexOf("@sha256:");
  const digest = match[1];
  if (separator <= 0 || !digest) return null;
  return { repository: value.slice(0, separator), digest };
}

function validateSha256(value: unknown, label: string, violations: string[]): void {
  if (typeof value !== "string" || !SHA256.test(value) || /^0{64}$/u.test(value)) {
    violations.push(`${label} SBOM SHA-256 is required and cannot be a placeholder.`);
  }
}

function validateVulnerabilityReview(
  value: unknown,
  component: "worker" | "OpenClaw",
  violations: string[]
): void {
  const review = requireClosedObject(
    value,
    `${component}.vulnerabilityReview`,
    ["critical", "highAccepted", "scanner", "databaseUpdatedAt", "scannedAt"],
    violations
  );
  if (!review) return;

  if (review.critical !== 0) {
    violations.push(`${component} vulnerability review must report zero critical findings.`);
  }
  if (review.highAccepted !== 0) {
    violations.push(`${component} vulnerability review must accept zero high findings.`);
  }
  if (
    typeof review.scanner !== "string" ||
    review.scanner.trim().length === 0 ||
    review.scanner.length > 100
  ) {
    violations.push(`${component} vulnerability review must identify its scanner.`);
  }
  if (!isIsoInstant(review.databaseUpdatedAt)) {
    violations.push(`${component} vulnerability databaseUpdatedAt must be an ISO-8601 instant.`);
  }
  if (!isIsoInstant(review.scannedAt)) {
    violations.push(`${component} vulnerability scannedAt must be an ISO-8601 instant.`);
  }
}

function validateEvidence(
  component: JsonObject,
  label: "worker" | "OpenClaw",
  violations: string[]
): void {
  validateSha256(component.sbomSha256, label, violations);
  if (component.provenanceVerified !== true) {
    violations.push(`${label} provenance verification must be true.`);
  }
  if (component.signatureVerified !== true) {
    violations.push(`${label} signature verification must be true.`);
  }
  validateVulnerabilityReview(component.vulnerabilityReview, label, violations);
}

export function validateReleaseManifest(input: unknown): string[] {
  const violations: string[] = [];
  const manifest = requireClosedObject(
    input,
    "manifest",
    ["schemaVersion", "releaseCommit", "createdAt", "worker", "openclaw", "rollback"],
    violations
  );
  if (!manifest) return violations;

  if (manifest.schemaVersion !== 1) violations.push("manifest.schemaVersion must be 1.");
  if (typeof manifest.releaseCommit !== "string" || !GIT_COMMIT.test(manifest.releaseCommit)) {
    violations.push("manifest.releaseCommit must be a lowercase 40-character Git commit.");
  }
  if (!isIsoInstant(manifest.createdAt)) {
    violations.push("manifest.createdAt must be an ISO-8601 instant.");
  }

  const worker = requireClosedObject(
    manifest.worker,
    "worker",
    [
      "image",
      "sourceCommit",
      "sbomSha256",
      "provenanceVerified",
      "signatureVerified",
      "vulnerabilityReview"
    ],
    violations
  );
  let workerImage: ImageIdentity | null = null;
  if (worker) {
    workerImage = imageIdentity(worker.image);
    if (!workerImage) {
      violations.push("worker digest must be a non-placeholder OCI sha256 image reference.");
    }
    if (typeof worker.sourceCommit !== "string" || !GIT_COMMIT.test(worker.sourceCommit)) {
      violations.push("worker.sourceCommit must be a lowercase 40-character Git commit.");
    } else if (worker.sourceCommit !== manifest.releaseCommit) {
      violations.push("worker.sourceCommit must exactly equal manifest.releaseCommit.");
    }
    validateEvidence(worker, "worker", violations);
  } else {
    violations.push("worker digest, SBOM, provenance, signature, and scan evidence are required.");
  }

  const openclaw = requireClosedObject(
    manifest.openclaw,
    "openclaw",
    [
      "image",
      "version",
      "upstreamCommit",
      "sbomSha256",
      "provenanceVerified",
      "signatureVerified",
      "vulnerabilityReview"
    ],
    violations
  );
  let openclawImage: ImageIdentity | null = null;
  if (openclaw) {
    openclawImage = imageIdentity(openclaw.image);
    if (openclaw.image !== OPENCLAW_IMAGE) {
      violations.push(`OpenClaw digest must be exactly ${OPENCLAW_IMAGE}.`);
    }
    if (openclaw.version !== OPENCLAW_VERSION) {
      violations.push(`OpenClaw version must be exactly ${OPENCLAW_VERSION}.`);
    }
    if (openclaw.upstreamCommit !== OPENCLAW_COMMIT) {
      violations.push(`OpenClaw upstream commit must be exactly ${OPENCLAW_COMMIT}.`);
    }
    validateEvidence(openclaw, "OpenClaw", violations);
  } else {
    violations.push(
      "OpenClaw digest, SBOM, provenance, signature, and scan evidence are required."
    );
  }

  const rollback = requireClosedObject(
    manifest.rollback,
    "rollback",
    [
      "reviewedWorkerImage",
      "reviewedOpenclawImage",
      "workerSchemaCompatible",
      "workerCompatibilityEvidenceSha256"
    ],
    violations
  );
  if (rollback) {
    const rollbackWorkerImage = imageIdentity(rollback.reviewedWorkerImage);
    const rollbackOpenClawImage = imageIdentity(rollback.reviewedOpenclawImage);
    if (!rollbackWorkerImage) {
      violations.push(
        "rollback.reviewedWorkerImage must be a non-placeholder digest-qualified image."
      );
    }
    if (!rollbackOpenClawImage) {
      violations.push(
        "rollback.reviewedOpenclawImage must be a non-placeholder digest-qualified image."
      );
    }
    if (workerImage && rollbackWorkerImage?.repository !== workerImage.repository) {
      violations.push("rollback.reviewedWorkerImage must use the active worker image repository.");
    }
    if (openclawImage && rollbackOpenClawImage?.repository !== openclawImage.repository) {
      violations.push(
        "rollback.reviewedOpenclawImage must use the active OpenClaw image repository."
      );
    }
    if (workerImage && rollbackWorkerImage?.digest === workerImage.digest) {
      violations.push(
        "rollback.reviewedWorkerImage must identify a different immutable worker artifact."
      );
    }
    if (rollback.workerSchemaCompatible !== true) {
      violations.push(
        "rollback.workerSchemaCompatible must be true before image rollback is available."
      );
    }
    validateSha256(
      rollback.workerCompatibilityEvidenceSha256,
      "rollback worker compatibility evidence",
      violations
    );
    if (rollbackWorkerImage && rollbackWorkerImage.digest === rollbackOpenClawImage?.digest) {
      violations.push("Rollback worker and OpenClaw images must identify distinct artifacts.");
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2] ?? process.env.VERA_RELEASE_MANIFEST_PATH;
  if (!manifestPath) {
    process.stderr.write("A release manifest path is required.\n");
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as unknown;
  } catch {
    process.stderr.write("The configured release manifest could not be read as JSON.\n");
    process.exitCode = 1;
    return;
  }

  const violations = validateReleaseManifest(parsed);
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Immutable release evidence manifest validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
