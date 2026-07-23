import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { validateReleaseManifest } from "./verify-release-manifest";

type JsonObject = Record<string, unknown>;

export interface VerificationCommand {
  readonly executable: "cosign" | "gh";
  readonly args: readonly string[];
  readonly label: string;
}

export interface PromotionVerificationInput {
  readonly manifest: unknown;
  readonly evidence: unknown;
  readonly sbomBytes: Buffer;
  readonly provenanceBundlePath: string;
  readonly sbomBundlePath: string;
}

export type VerificationRunner = (command: VerificationCommand) => string;

const IMAGE_REFERENCE = /^ghcr\.io\/([a-z0-9_.-]+)\/vera-worker@sha256:([a-f0-9]{64})$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TRUSTED_REPOSITORY = "zukhriddingit/VeraAI";
const WORKFLOW_REF =
  /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/\.github\/workflows\/release-worker\.yml@refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/u;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function spdxPredicateType(input: unknown): string {
  const sbom = object(input, "Worker SPDX SBOM");
  const match =
    typeof sbom.spdxVersion === "string" ? /^SPDX-(2\.[23])$/u.exec(sbom.spdxVersion) : null;
  if (!match?.[1]) {
    throw new Error("Worker SBOM must use supported SPDX-2.2 or SPDX-2.3 JSON.");
  }
  return `https://spdx.dev/Document/v${match[1]}`;
}

function parseSbom(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Downloaded worker SBOM must be valid JSON.");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as JsonObject).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireVerifiedSbomPredicate(output: string, input: PromotionVerificationInput): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error("GitHub SBOM verification must return valid JSON.");
  }
  const sbom = parseSbom(input.sbomBytes);
  const expectedPredicateType = spdxPredicateType(sbom);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("GitHub SBOM verification returned no verified attestations.");
  }
  const manifest = object(input.manifest, "Release manifest");
  const worker = object(manifest.worker, "Release manifest worker");
  const image = string(worker.image, "Worker image");
  const digest = image.slice(image.lastIndexOf("sha256:") + "sha256:".length);

  const matches = parsed.some((entryValue) => {
    try {
      const entry = object(entryValue, "Verified SBOM attestation");
      const verificationResult = object(entry.verificationResult, "SBOM verification result");
      const statement = object(verificationResult.statement, "Verified SBOM statement");
      if (statement.predicateType !== expectedPredicateType) return false;
      if (!Array.isArray(statement.subject)) return false;
      const subjectMatches = statement.subject.some((subjectValue) => {
        const subject = object(subjectValue, "Verified SBOM subject");
        const subjectDigest = object(subject.digest, "Verified SBOM subject digest");
        return subjectDigest.sha256 === digest;
      });
      return subjectMatches && canonicalJson(statement.predicate) === canonicalJson(sbom);
    } catch {
      return false;
    }
  });
  if (!matches) {
    throw new Error(
      "Downloaded worker SBOM does not match the cryptographically verified SPDX attestation predicate."
    );
  }
}

export function buildPromotionVerificationCommands(
  input: PromotionVerificationInput
): VerificationCommand[] {
  const manifestViolations = validateReleaseManifest(input.manifest);
  if (manifestViolations.length > 0) {
    throw new Error(`Release manifest validation failed: ${manifestViolations.join(" ")}`);
  }

  const manifest = object(input.manifest, "Release manifest");
  const worker = object(manifest.worker, "Release manifest worker");
  const evidence = object(input.evidence, "Worker release evidence");
  const evidenceSbom = object(evidence.sbom, "Worker release evidence SBOM");
  const evidenceSignature = object(evidence.signature, "Worker release evidence signature");
  const evidenceProvenance = object(evidence.provenance, "Worker release evidence provenance");

  const image = string(worker.image, "Worker image");
  const imageMatch = IMAGE_REFERENCE.exec(image);
  if (!imageMatch?.[1] || !imageMatch[2]) {
    throw new Error("Worker image must be an immutable ghcr.io/<owner>/vera-worker digest.");
  }
  const sourceCommit = string(worker.sourceCommit, "Worker source commit");
  if (!COMMIT.test(sourceCommit)) throw new Error("Worker source commit is invalid.");
  if (evidence.image !== image || evidence.sourceCommit !== sourceCommit) {
    throw new Error("Downloaded worker evidence does not match the release manifest identity.");
  }

  const manifestSbomSha256 = string(worker.sbomSha256, "Manifest worker SBOM SHA-256");
  const evidenceSbomSha256 = string(evidenceSbom.sha256, "Evidence worker SBOM SHA-256");
  if (!SHA256.test(manifestSbomSha256) || manifestSbomSha256 !== evidenceSbomSha256) {
    throw new Error("Worker SBOM identity differs between the release manifest and evidence.");
  }
  if (sha256(input.sbomBytes) !== evidenceSbomSha256) {
    throw new Error("Downloaded worker SBOM bytes do not match the recorded SHA-256.");
  }
  const expectedSbomPredicateType = spdxPredicateType(parseSbom(input.sbomBytes));

  const workflowRef = string(evidenceProvenance.workflowRef, "Evidence workflow reference");
  const workflowMatch = WORKFLOW_REF.exec(workflowRef);
  const repository = workflowMatch?.[1];
  if (!repository)
    throw new Error("Evidence workflow reference is not an approved release workflow.");
  if (repository !== TRUSTED_REPOSITORY) {
    throw new Error(`Release signer repository must be exactly ${TRUSTED_REPOSITORY}.`);
  }
  const repositoryOwner = repository.slice(0, repository.indexOf("/")).toLowerCase();
  if (repositoryOwner !== imageMatch[1]) {
    throw new Error("Worker registry owner must match the verified GitHub workflow owner.");
  }

  const certificateIdentity = string(
    evidenceSignature.certificateIdentity,
    "Evidence certificate identity"
  );
  if (certificateIdentity !== `https://github.com/${workflowRef}`) {
    throw new Error("Evidence certificate identity does not exactly match the release workflow.");
  }
  const signerWorkflow = `${repository}/.github/workflows/release-worker.yml`;
  const commonAttestationArguments = [
    "attestation",
    "verify",
    `oci://${image}`,
    "--repo",
    repository,
    "--cert-identity",
    certificateIdentity,
    "--source-digest",
    sourceCommit,
    "--signer-workflow",
    signerWorkflow,
    "--format",
    "json"
  ] as const;

  return [
    {
      executable: "cosign",
      label: "Cosign signature verification",
      args: [
        "verify",
        image,
        "--certificate-identity",
        certificateIdentity,
        "--certificate-oidc-issuer",
        "https://token.actions.githubusercontent.com"
      ]
    },
    {
      executable: "gh",
      label: "GitHub provenance attestation verification",
      args: [...commonAttestationArguments, "--bundle", input.provenanceBundlePath]
    },
    {
      executable: "gh",
      label: "GitHub SBOM attestation verification",
      args: [
        ...commonAttestationArguments.slice(0, -2),
        "--predicate-type",
        expectedSbomPredicateType,
        "--format",
        "json",
        "--bundle",
        input.sbomBundlePath
      ]
    }
  ];
}

export function verifyWorkerReleasePromotion(
  input: PromotionVerificationInput,
  runner: VerificationRunner
): void {
  const commands = buildPromotionVerificationCommands(input);
  const manifest = object(input.manifest, "Release manifest");
  const worker = object(manifest.worker, "Release manifest worker");
  const image = string(worker.image, "Worker image");
  const digestHash = image.slice(image.lastIndexOf("sha256:") + "sha256:".length);
  for (const command of commands) {
    const output = runner(command);
    if (output.trim().length === 0 || !output.includes(digestHash)) {
      throw new Error(`${command.label} did not return digest-bound verification evidence.`);
    }
    if (command.label === "GitHub SBOM attestation verification") {
      requireVerifiedSbomPredicate(output, input);
    }
  }
}

function defaultRunner(command: VerificationCommand): string {
  const result = spawnSync(command.executable, [...command.args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 5 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command.label} failed; no release is approved for promotion.`);
  }
  return result.stdout;
}

function parseArguments(args: readonly string[]): {
  readonly manifestPath: string;
  readonly evidenceDirectory: string;
  readonly confirmation: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !value || !["--manifest", "--evidence-dir", "--confirm"].includes(name)) {
      throw new Error("Expected --manifest <path> --evidence-dir <path> --confirm <image-digest>.");
    }
    values.set(name, value);
  }
  const manifestPath = values.get("--manifest");
  const evidenceDirectory = values.get("--evidence-dir");
  const confirmation = values.get("--confirm");
  if (!manifestPath || !evidenceDirectory || !confirmation || values.size !== 3) {
    throw new Error("Expected --manifest <path> --evidence-dir <path> --confirm <image-digest>.");
  }
  return { manifestPath, evidenceDirectory, confirmation };
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} is missing or invalid.`);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArguments(process.argv.slice(2));
    const manifest = await readJson(resolve(args.manifestPath), "Release manifest");
    const evidenceDirectory = resolve(args.evidenceDirectory);
    const evidence = await readJson(
      resolve(evidenceDirectory, "worker-release-evidence.json"),
      "Worker release evidence"
    );
    const sbomBytes = await readFile(resolve(evidenceDirectory, "worker.spdx.json"));
    const manifestWorker = object(object(manifest, "Release manifest").worker, "Worker");
    if (manifestWorker.image !== args.confirmation) {
      throw new Error("Confirmation must exactly equal the manifest worker digest.");
    }
    verifyWorkerReleasePromotion(
      {
        manifest,
        evidence,
        sbomBytes,
        provenanceBundlePath: resolve(evidenceDirectory, "provenance-bundle.json"),
        sbomBundlePath: resolve(evidenceDirectory, "sbom-bundle.json")
      },
      defaultRunner
    );
    process.stdout.write(
      "Worker signature, provenance, and SBOM attestation were cryptographically reverified; no runtime was mutated.\n"
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Promotion verification failed."}\n`
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
