import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_REFERENCE = /^[^\s@]+@sha256:[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_DATABASE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function instant(value, label) {
  const text = string(value, label);
  if (!ISO_INSTANT.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${label} must be an ISO-8601 UTC instant.`);
  }
  return text;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function spdxPredicateType(input) {
  const sbom = object(input, "Worker SPDX SBOM");
  const match = /^SPDX-(2\.[23])$/u.exec(sbom.spdxVersion);
  if (!match?.[1]) {
    throw new Error("Worker SBOM must use supported SPDX-2.2 or SPDX-2.3 JSON.");
  }
  return `https://spdx.dev/Document/v${match[1]}`;
}

export function analyzeTrivyReport(input, expectedImage) {
  const report = object(input, "Trivy report");
  if (report.SchemaVersion !== 2) throw new Error("Trivy report schema version must be 2.");
  if (report.ArtifactType !== "container_image") {
    throw new Error("Trivy report must describe a container image.");
  }
  if (!IMAGE_REFERENCE.test(expectedImage)) {
    throw new Error("Expected worker image must be digest-qualified.");
  }

  const metadata = object(report.Metadata, "Trivy report metadata");
  if (typeof metadata.ImageID !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(metadata.ImageID)) {
    throw new Error("Trivy report must include the scanned container image ID.");
  }
  const repoDigests = Array.isArray(metadata.RepoDigests) ? metadata.RepoDigests : [];
  if (report.ArtifactName !== expectedImage && !repoDigests.includes(expectedImage)) {
    throw new Error("Trivy report is not bound to the expected worker image digest.");
  }

  if (!Array.isArray(report.Results) || report.Results.length === 0) {
    throw new Error("Trivy report must contain non-empty scan results.");
  }
  let critical = 0;
  let high = 0;
  let osPackages = 0;
  let nodePackages = 0;
  for (const resultValue of report.Results) {
    const result = object(resultValue, "Trivy result");
    if (result.Packages !== undefined && result.Packages !== null) {
      if (!Array.isArray(result.Packages)) throw new Error("Trivy packages must be an array.");
      if (result.Class === "os-pkgs") osPackages += result.Packages.length;
      if (
        result.Class === "lang-pkgs" &&
        ["node-pkg", "npm", "pnpm"].includes(String(result.Type))
      ) {
        nodePackages += result.Packages.length;
      }
    }
    const vulnerabilities = result.Vulnerabilities;
    if (vulnerabilities === undefined || vulnerabilities === null) continue;
    if (!Array.isArray(vulnerabilities)) {
      throw new Error("Trivy vulnerabilities must be an array when present.");
    }
    for (const vulnerabilityValue of vulnerabilities) {
      const vulnerability = object(vulnerabilityValue, "Trivy vulnerability");
      if (vulnerability.Severity === "CRITICAL") critical += 1;
      if (vulnerability.Severity === "HIGH") high += 1;
    }
  }

  const scannedAt = instant(report.CreatedAt, "Trivy report CreatedAt");
  if (osPackages === 0 || nodePackages === 0) {
    throw new Error("Trivy report must cover both operating-system and Node production packages.");
  }
  if (critical !== 0 || high !== 0) {
    throw new Error(
      `Worker release is blocked by ${critical} critical and ${high} high vulnerability findings.`
    );
  }
  return { critical, high, scannedAt, osPackages, nodePackages };
}

export function readTrivyVersion(input, scannedAtInput) {
  const metadata = object(input, "Trivy version metadata");
  const version = string(metadata.Version, "Trivy version");
  const vulnerabilityDatabase = object(
    metadata.VulnerabilityDB,
    "Trivy vulnerability database metadata"
  );
  const databaseUpdatedAt = instant(
    vulnerabilityDatabase.UpdatedAt,
    "Trivy vulnerability database UpdatedAt"
  );
  const scannedAt = instant(scannedAtInput, "Trivy scan time");
  const databaseAge = Date.parse(scannedAt) - Date.parse(databaseUpdatedAt);
  if (databaseAge < -MAX_FUTURE_SKEW_MS || databaseAge > MAX_DATABASE_AGE_MS) {
    throw new Error("Trivy vulnerability database must be current within 24 hours of the scan.");
  }
  return {
    scanner: `trivy ${version}`,
    databaseUpdatedAt
  };
}

function verifiedJsonBytes(bytes, label, expectedDigest) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (
    parsed === null ||
    (Array.isArray(parsed) && parsed.length === 0) ||
    (typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0)
  ) {
    throw new Error(`${label} must contain non-empty verification evidence.`);
  }
  if (expectedDigest && !JSON.stringify(parsed).includes(expectedDigest.replace("sha256:", ""))) {
    throw new Error(`${label} must reference the worker image digest.`);
  }
  return sha256(bytes);
}

export function createWorkerReleaseEvidence(input) {
  if (!IMAGE_REFERENCE.test(input.image)) throw new Error("Worker image must be digest-qualified.");
  if (!GIT_COMMIT.test(input.sourceCommit)) {
    throw new Error("Worker source commit must be a lowercase 40-character Git commit.");
  }
  const scan = analyzeTrivyReport(input.trivyReport, input.image);
  const scanner = readTrivyVersion(input.trivyVersion, scan.scannedAt);
  spdxPredicateType(input.sbom);

  const workflowRef = string(input.workflowRef, "Workflow reference");
  const expectedIdentity = `https://github.com/${workflowRef}`;
  if (input.certificateIdentity !== expectedIdentity) {
    throw new Error("Cosign certificate identity must exactly match the executing workflow.");
  }
  for (const [value, label] of [
    [input.attestationUrl, "Attestation URL"],
    [input.workflowRunUrl, "Workflow run URL"]
  ]) {
    if (!string(value, label).startsWith("https://github.com/")) {
      throw new Error(`${label} must be an HTTPS GitHub URL.`);
    }
  }
  const imageDigest = input.image.slice(input.image.lastIndexOf("@") + 1);
  const cosignVerificationSha256 = verifiedJsonBytes(
    input.cosignVerificationBytes,
    "Cosign verification",
    imageDigest
  );
  const provenanceVerificationSha256 = verifiedJsonBytes(
    input.provenanceVerificationBytes,
    "GitHub provenance verification",
    imageDigest
  );
  const sbomVerificationSha256 = verifiedJsonBytes(
    input.sbomVerificationBytes,
    "GitHub SBOM verification",
    imageDigest
  );
  const provenanceBundleSha256 = verifiedJsonBytes(
    input.provenanceBundleBytes,
    "Provenance attestation bundle"
  );
  const sbomBundleSha256 = verifiedJsonBytes(input.sbomBundleBytes, "SBOM attestation bundle");

  return {
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
    image: input.image,
    createdAt: instant(input.createdAt, "Evidence createdAt"),
    sbom: {
      format: "spdx-json",
      sha256: sha256(input.sbomBytes),
      attestationBundleSha256: sbomBundleSha256,
      verificationSha256: sbomVerificationSha256
    },
    provenance: {
      verified: true,
      attestationUrl: input.attestationUrl,
      workflowRef,
      bundleSha256: provenanceBundleSha256,
      verificationSha256: provenanceVerificationSha256
    },
    signature: {
      verified: true,
      certificateIdentity: input.certificateIdentity,
      oidcIssuer: "https://token.actions.githubusercontent.com",
      verificationSha256: cosignVerificationSha256
    },
    vulnerabilityReview: {
      critical: scan.critical,
      highAccepted: scan.high,
      scanner: scanner.scanner,
      databaseUpdatedAt: scanner.databaseUpdatedAt,
      scannedAt: scan.scannedAt,
      reportSha256: sha256(input.trivyReportBytes)
    },
    workflowRunUrl: input.workflowRunUrl
  };
}

const evidenceDirectory = resolve("release-evidence/worker");
const paths = {
  sbom: resolve(evidenceDirectory, "worker.spdx.json"),
  report: resolve(evidenceDirectory, "trivy-vulnerabilities.json"),
  version: resolve(evidenceDirectory, "trivy-version.json"),
  output: resolve(evidenceDirectory, "worker-release-evidence.json"),
  cosignVerification: resolve(evidenceDirectory, "cosign-verification.json"),
  provenanceVerification: resolve(evidenceDirectory, "provenance-verification.json"),
  sbomVerification: resolve(evidenceDirectory, "sbom-verification.json"),
  provenanceBundle: resolve(evidenceDirectory, "provenance-bundle.json"),
  sbomBundle: resolve(evidenceDirectory, "sbom-bundle.json")
};

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} is missing or is not valid JSON.`);
  }
}

async function main() {
  const operation = process.argv[2];
  const image = process.env.WORKER_IMAGE_REF ?? "";
  const trivyReport = await readJson(paths.report, "Trivy vulnerability report");
  const trivyVersion = await readJson(paths.version, "Trivy version metadata");

  const scan = analyzeTrivyReport(trivyReport, image);
  readTrivyVersion(trivyVersion, scan.scannedAt);
  if (operation === "check-scan") {
    process.stdout.write(
      "Worker vulnerability evidence passed with zero critical/high findings.\n"
    );
    return;
  }
  const sbomBytes = await readFile(paths.sbom);
  const sbom = JSON.parse(sbomBytes.toString("utf8"));
  if (operation === "predicate-type") {
    process.stdout.write(`${spdxPredicateType(sbom)}\n`);
    return;
  }
  if (operation !== "write") {
    throw new Error("Expected check-scan, predicate-type, or write operation.");
  }

  const reportBytes = await readFile(paths.report);
  const cosignVerificationBytes = await readFile(paths.cosignVerification);
  const provenanceVerificationBytes = await readFile(paths.provenanceVerification);
  const sbomVerificationBytes = await readFile(paths.sbomVerification);
  const provenanceBundleBytes = await readFile(paths.provenanceBundle);
  const sbomBundleBytes = await readFile(paths.sbomBundle);
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const workflowRef = process.env.GITHUB_WORKFLOW_REF ?? "";
  const evidence = createWorkerReleaseEvidence({
    image,
    sourceCommit: process.env.GITHUB_SHA ?? "",
    createdAt: new Date().toISOString(),
    sbom,
    sbomBytes,
    trivyReport,
    trivyReportBytes: reportBytes,
    trivyVersion,
    cosignVerificationBytes,
    provenanceVerificationBytes,
    sbomVerificationBytes,
    provenanceBundleBytes,
    sbomBundleBytes,
    workflowRef,
    certificateIdentity: process.env.WORKER_CERTIFICATE_IDENTITY ?? "",
    attestationUrl: process.env.WORKER_ATTESTATION_URL ?? "",
    workflowRunUrl: `https://github.com/${repository}/actions/runs/${runId}`
  });

  await mkdir(dirname(paths.output), { recursive: true });
  await writeFile(paths.output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write("Sanitized worker release evidence written.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Worker evidence failed."}\n`);
    process.exitCode = 1;
  }
}
