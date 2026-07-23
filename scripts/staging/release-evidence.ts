import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const FOUNDER_STAGING_PHASES = [
  "gateway_unauthenticated_request",
  "gateway_wrong_token",
  "maritime_worker_dispatch",
  "founder_positive_current_tab_capture",
  "node_offline",
  "stale_heartbeat",
  "manual_login_2fa_captcha_blocker",
  "kill_switch_after_queueing",
  "worker_crash_after_browser_invocation",
  "duplicate_dispatch",
  "replayed_result",
  "gateway_restart",
  "web_push_delivery",
  "web_push_deduplication",
  "quiet_hours",
  "provider_outage",
  "worker_image_rollback",
  "postgresql_restore",
  "gmail_readonly_verification",
  "calendar_freebusy_and_approved_hold"
] as const;

export type FounderStagingPhaseId = (typeof FOUNDER_STAGING_PHASES)[number];

export const RELEASE_PHASE_RESULT_STATES = [
  "passed_automated",
  "passed_manual_evidence",
  "blocked_missing_configuration",
  "failed_assertion",
  "failed_provider",
  "not_applicable_with_approved_reason"
] as const;

export type ReleasePhaseResultState = (typeof RELEASE_PHASE_RESULT_STATES)[number];

export const EVIDENCE_REFERENCE_KINDS = [
  "github_actions_artifact",
  "managed_database_snapshot",
  "private_object",
  "sanitized_screenshot",
  "test_run",
  "workflow_run",
  "deployment_digest"
] as const;

type JsonObject = Record<string, unknown>;

export interface EvidenceReference {
  readonly kind: (typeof EVIDENCE_REFERENCE_KINDS)[number];
  readonly locator: string;
  readonly sha256: string;
}

export interface EvidenceSignature {
  readonly kind: "ci" | "operator";
  readonly signerReference: string;
  readonly signedBundleHash: string;
  readonly value: string;
}

export interface ReleaseEvidenceRecord {
  readonly schemaVersion: 1;
  readonly synthetic: boolean;
  readonly phaseId: FounderStagingPhaseId;
  readonly releaseId: string;
  readonly environmentId: string;
  readonly sourceCommit: string;
  readonly candidateWorkerImage: string;
  readonly candidateOpenclawImage: string | null;
  readonly executedAt: string;
  readonly operatorReference: string;
  readonly expectedResult: string;
  readonly observedResult: string;
  readonly resultState: ReleasePhaseResultState;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly approvalState: "approved";
  readonly contentHash: string;
}

export interface ReleaseEvidenceBundle {
  readonly schemaVersion: 1;
  readonly synthetic: boolean;
  readonly releaseId: string;
  readonly environmentId: string;
  readonly sourceCommit: string;
  readonly candidateWorkerImage: string;
  readonly candidateOpenclawImage: string;
  readonly createdAt: string;
  readonly records: readonly ReleaseEvidenceRecord[];
  readonly bundleHash: string;
  readonly signature?: EvidenceSignature;
}

export interface EvidenceValidationOptions {
  readonly allowSynthetic?: boolean;
  readonly requireAllPhases?: boolean;
  readonly requiredPhaseIds?: readonly FounderStagingPhaseId[];
}

export interface ReleaseDecisionSummary {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly sourceCommit: string;
  readonly workerImageDigest: string;
  readonly openclawImageDigest: string;
  readonly evidenceBundleSha256: string;
  readonly finalClassification: "passed";
  readonly approvalTimestamp: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const OCI_IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/u;
const SAFE_RESULT = /^[A-Za-z0-9][A-Za-z0-9 .,;:()_/-]{2,500}$/u;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

const SENSITIVE_CONTENT_PATTERNS: readonly RegExp[] = [
  /(?:^|\W)(?:ya29\.|1\/\/|eyJ[A-Za-z0-9_-]{8,})/u,
  /\b(?:sk|ghp|github_pat|mk)_[A-Za-z0-9_-]{8,}\b/iu,
  /postgres(?:ql)?:\/\//iu,
  /\b(?:authorization|bearer)\s*[: ]/iu,
  /\b(?:password|passwd|cookie|set-cookie|refresh[_ -]?token|access[_ -]?token)\b/iu,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /(?:^|[\\/])(?:Users|home|private)[\\/]/u,
  /(?:^|[\\/])\.(?:openclaw|config|cache)[\\/]/iu,
  /\b(?:node|profile)[_-]?(?:id)?[=:_-]?[a-f0-9]{8,}\b/iu,
  /<!doctype html|<html\b|"tabs"\s*:\s*\[/iu,
  /\b(?:from|to|subject)\s*:/iu,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/u,
  /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?$/iu,
  /\b(?:COPY|INSERT INTO)\s+(?:public\.)?[A-Za-z_]/iu,
  /PGDMP/u
];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireClosedObject(
  value: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  violations: string[]
): JsonObject | null {
  if (!isObject(value)) {
    violations.push(`${label} must be an object.`);
    return null;
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) violations.push(`${label}.${key} is required.`);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) violations.push(`${label}.${key} is not allowed.`);
  }
  return value;
}

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_INSTANT.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value) && !/^0{64}$/u.test(value);
}

function isImageDigest(value: unknown): value is string {
  return typeof value === "string" && OCI_IMAGE.test(value) && !/@sha256:0{64}$/u.test(value);
}

function containsSensitiveContent(value: unknown): boolean {
  if (typeof value === "string") {
    return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) return value.some(containsSensitiveContent);
  if (isObject(value)) return Object.values(value).some(containsSensitiveContent);
  return false;
}

function validateSafeId(value: unknown, label: string, violations: string[]): void {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    violations.push(`${label} must be an opaque safe identifier.`);
  }
}

function validateSafeResult(value: unknown, label: string, violations: string[]): void {
  if (typeof value !== "string" || !SAFE_RESULT.test(value)) {
    violations.push(`${label} must be bounded sanitized text.`);
  }
}

function validateEvidenceReference(value: unknown, label: string, violations: string[]): void {
  const reference = requireClosedObject(
    value,
    label,
    ["kind", "locator", "sha256"],
    [],
    violations
  );
  if (!reference) return;
  if (!EVIDENCE_REFERENCE_KINDS.includes(reference.kind as EvidenceReference["kind"])) {
    violations.push(`${label}.kind must be an approved evidence reference kind.`);
  }
  if (typeof reference.locator !== "string" || !SAFE_REFERENCE.test(reference.locator)) {
    violations.push(`${label}.locator must be an opaque safe artifact reference.`);
  }
  if (!isDigest(reference.sha256))
    violations.push(`${label}.sha256 must be a non-placeholder SHA-256.`);
}

function validateSignature(value: unknown, bundleHash: unknown, violations: string[]): void {
  const signature = requireClosedObject(
    value,
    "bundle.signature",
    ["kind", "signerReference", "signedBundleHash", "value"],
    [],
    violations
  );
  if (!signature) return;
  if (signature.kind !== "ci" && signature.kind !== "operator") {
    violations.push("bundle.signature.kind must be ci or operator.");
  }
  if (
    typeof signature.signerReference !== "string" ||
    !SAFE_REFERENCE.test(signature.signerReference)
  ) {
    violations.push("bundle.signature.signerReference must be an opaque safe reference.");
  }
  if (!isDigest(signature.signedBundleHash)) {
    violations.push("bundle.signature.signedBundleHash must be a non-placeholder SHA-256.");
  } else if (signature.signedBundleHash !== bundleHash) {
    violations.push("bundle.signature.signedBundleHash must bind bundle.bundleHash.");
  }
  if (
    typeof signature.value !== "string" ||
    !/^[A-Za-z0-9+/=_-]{16,4096}$/u.test(signature.value)
  ) {
    violations.push("bundle.signature.value must be a bounded signature value.");
  }
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Evidence canonicalization accepts JSON values only.");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function withoutKeys(value: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

export function recordContentHash(
  record: Omit<ReleaseEvidenceRecord, "contentHash"> | JsonObject
): string {
  return sha256(withoutKeys(record as JsonObject, ["contentHash"]));
}

export function bundleContentHash(
  bundle: Omit<ReleaseEvidenceBundle, "bundleHash"> | JsonObject
): string {
  return sha256(withoutKeys(bundle as JsonObject, ["bundleHash", "signature"]));
}

export function withRecordContentHash(
  record: Omit<ReleaseEvidenceRecord, "contentHash">
): ReleaseEvidenceRecord {
  return { ...record, contentHash: recordContentHash(record) };
}

export function withBundleContentHash(
  bundle: Omit<ReleaseEvidenceBundle, "bundleHash">
): ReleaseEvidenceBundle {
  return { ...bundle, bundleHash: bundleContentHash(bundle) };
}

export function validateEvidenceRecord(
  input: unknown,
  options: Pick<EvidenceValidationOptions, "allowSynthetic"> = {}
): string[] {
  const violations: string[] = [];
  const record = requireClosedObject(
    input,
    "record",
    [
      "schemaVersion",
      "synthetic",
      "phaseId",
      "releaseId",
      "environmentId",
      "sourceCommit",
      "candidateWorkerImage",
      "candidateOpenclawImage",
      "executedAt",
      "operatorReference",
      "expectedResult",
      "observedResult",
      "resultState",
      "evidenceReferences",
      "approvalState",
      "contentHash"
    ],
    [],
    violations
  );
  if (!record) return violations;

  if (record.schemaVersion !== 1) violations.push("record.schemaVersion must be 1.");
  if (typeof record.synthetic !== "boolean") violations.push("record.synthetic must be boolean.");
  if (record.synthetic === true && !options.allowSynthetic) {
    violations.push("Synthetic evidence is not accepted by a production release gate.");
  }
  if (!FOUNDER_STAGING_PHASES.includes(record.phaseId as FounderStagingPhaseId)) {
    violations.push("record.phaseId must be a required founder staging phase.");
  }
  validateSafeId(record.releaseId, "record.releaseId", violations);
  validateSafeId(record.environmentId, "record.environmentId", violations);
  if (typeof record.sourceCommit !== "string" || !COMMIT.test(record.sourceCommit)) {
    violations.push("record.sourceCommit must be a lowercase 40-character Git commit.");
  }
  if (!isImageDigest(record.candidateWorkerImage)) {
    violations.push("record.candidateWorkerImage must be an immutable OCI digest.");
  }
  if (record.candidateOpenclawImage !== null && !isImageDigest(record.candidateOpenclawImage)) {
    violations.push("record.candidateOpenclawImage must be null or an immutable OCI digest.");
  }
  if (!isUtcInstant(record.executedAt))
    violations.push("record.executedAt must be a UTC ISO-8601 instant.");
  validateSafeId(record.operatorReference, "record.operatorReference", violations);
  validateSafeResult(record.expectedResult, "record.expectedResult", violations);
  validateSafeResult(record.observedResult, "record.observedResult", violations);
  if (!RELEASE_PHASE_RESULT_STATES.includes(record.resultState as ReleasePhaseResultState)) {
    violations.push("record.resultState must be an approved release phase result state.");
  }
  if (
    !Array.isArray(record.evidenceReferences) ||
    record.evidenceReferences.length < 1 ||
    record.evidenceReferences.length > 12
  ) {
    violations.push("record.evidenceReferences must contain one to twelve sanitized references.");
  } else {
    record.evidenceReferences.forEach((reference, index) =>
      validateEvidenceReference(reference, `record.evidenceReferences[${index}]`, violations)
    );
  }
  if (record.approvalState !== "approved")
    violations.push("record.approvalState must be approved.");
  if (!isDigest(record.contentHash)) {
    violations.push("record.contentHash must be a non-placeholder SHA-256.");
  } else if (record.contentHash !== recordContentHash(record)) {
    violations.push("record.contentHash does not match the canonical record content.");
  }
  if (containsSensitiveContent(record)) {
    violations.push(
      "record contains likely secret, personal data, raw artifact, or private identifier content."
    );
  }
  return violations;
}

export function validateEvidenceBundle(
  input: unknown,
  options: EvidenceValidationOptions = {}
): string[] {
  const violations: string[] = [];
  const bundle = requireClosedObject(
    input,
    "bundle",
    [
      "schemaVersion",
      "synthetic",
      "releaseId",
      "environmentId",
      "sourceCommit",
      "candidateWorkerImage",
      "candidateOpenclawImage",
      "createdAt",
      "records",
      "bundleHash"
    ],
    ["signature"],
    violations
  );
  if (!bundle) return violations;

  if (bundle.schemaVersion !== 1) violations.push("bundle.schemaVersion must be 1.");
  if (typeof bundle.synthetic !== "boolean") violations.push("bundle.synthetic must be boolean.");
  if (bundle.synthetic === true && !options.allowSynthetic) {
    violations.push("Synthetic bundles are not accepted by a production release gate.");
  }
  validateSafeId(bundle.releaseId, "bundle.releaseId", violations);
  validateSafeId(bundle.environmentId, "bundle.environmentId", violations);
  if (typeof bundle.sourceCommit !== "string" || !COMMIT.test(bundle.sourceCommit)) {
    violations.push("bundle.sourceCommit must be a lowercase 40-character Git commit.");
  }
  if (!isImageDigest(bundle.candidateWorkerImage)) {
    violations.push("bundle.candidateWorkerImage must be an immutable OCI digest.");
  }
  if (!isImageDigest(bundle.candidateOpenclawImage)) {
    violations.push("bundle.candidateOpenclawImage must be an immutable OCI digest.");
  }
  if (!isUtcInstant(bundle.createdAt))
    violations.push("bundle.createdAt must be a UTC ISO-8601 instant.");
  if (Object.hasOwn(bundle, "signature")) {
    validateSignature(bundle.signature, bundle.bundleHash, violations);
  }

  const observedPhases = new Set<string>();
  if (!Array.isArray(bundle.records) || bundle.records.length === 0) {
    violations.push("bundle.records must contain accepted phase records.");
  } else {
    bundle.records.forEach((record, index) => {
      const label = `bundle.records[${index}]`;
      const recordViolations = validateEvidenceRecord(record, {
        allowSynthetic: options.allowSynthetic
      });
      violations.push(...recordViolations.map((violation) => `${label}: ${violation}`));
      if (!isObject(record)) return;
      if (record.releaseId !== bundle.releaseId)
        violations.push(`${label}.releaseId must match bundle.releaseId.`);
      if (record.environmentId !== bundle.environmentId) {
        violations.push(`${label}.environmentId must match bundle.environmentId.`);
      }
      if (record.sourceCommit !== bundle.sourceCommit) {
        violations.push(`${label}.sourceCommit must match bundle.sourceCommit.`);
      }
      if (record.candidateWorkerImage !== bundle.candidateWorkerImage) {
        violations.push(`${label}.candidateWorkerImage must match bundle.candidateWorkerImage.`);
      }
      if (
        record.candidateOpenclawImage !== null &&
        record.candidateOpenclawImage !== bundle.candidateOpenclawImage
      ) {
        violations.push(
          `${label}.candidateOpenclawImage must match bundle.candidateOpenclawImage.`
        );
      }
      if (record.synthetic !== bundle.synthetic) {
        violations.push(`${label}.synthetic must match bundle.synthetic.`);
      }
      if (typeof record.phaseId === "string") {
        if (observedPhases.has(record.phaseId)) violations.push(`${label}.phaseId is duplicated.`);
        observedPhases.add(record.phaseId);
      }
    });
  }

  const requiredPhaseIds = options.requiredPhaseIds ?? FOUNDER_STAGING_PHASES;
  if (options.requireAllPhases !== false) {
    for (const phaseId of requiredPhaseIds) {
      if (!observedPhases.has(phaseId))
        violations.push(`bundle is missing required phase record ${phaseId}.`);
    }
  }
  if (!isDigest(bundle.bundleHash)) {
    violations.push("bundle.bundleHash must be a non-placeholder SHA-256.");
  } else if (bundle.bundleHash !== bundleContentHash(bundle)) {
    violations.push("bundle.bundleHash does not match the canonical accepted evidence manifest.");
  }
  if (containsSensitiveContent(bundle)) {
    violations.push(
      "bundle contains likely secret, personal data, raw artifact, or private identifier content."
    );
  }
  return violations;
}

export function isPassingEvidenceBundle(input: unknown): boolean {
  if (
    validateEvidenceBundle(input).length > 0 ||
    !isObject(input) ||
    !Array.isArray(input.records)
  ) {
    return false;
  }
  return input.records.every(
    (record) =>
      isObject(record) &&
      (record.resultState === "passed_automated" || record.resultState === "passed_manual_evidence")
  );
}

export function createReleaseDecisionSummary(
  bundle: unknown,
  approvalTimestamp: string
): ReleaseDecisionSummary {
  const violations = validateEvidenceBundle(bundle);
  if (violations.length > 0 || !isPassingEvidenceBundle(bundle) || !isObject(bundle)) {
    throw new Error("A final release decision requires a valid, passing private evidence bundle.");
  }
  if (!isUtcInstant(approvalTimestamp)) {
    throw new Error("A final release decision requires a UTC approval timestamp.");
  }
  return {
    schemaVersion: 1,
    releaseId: bundle.releaseId as string,
    sourceCommit: bundle.sourceCommit as string,
    workerImageDigest: bundle.candidateWorkerImage as string,
    openclawImageDigest: bundle.candidateOpenclawImage as string,
    evidenceBundleSha256: bundle.bundleHash as string,
    finalClassification: "passed",
    approvalTimestamp
  };
}

export function privateEvidenceDirectory(workspaceRoot = process.cwd()): string {
  return resolve(workspaceRoot, "release-evidence/private");
}

export function validatePrivateEvidencePath(path: string, workspaceRoot = process.cwd()): string[] {
  const privateDirectory = privateEvidenceDirectory(workspaceRoot);
  const resolvedPath = resolve(workspaceRoot, path);
  const pathRelativeToPrivateDirectory = relative(privateDirectory, resolvedPath);
  if (
    pathRelativeToPrivateDirectory === "" ||
    pathRelativeToPrivateDirectory.startsWith("..") ||
    isAbsolute(pathRelativeToPrivateDirectory)
  ) {
    return ["Evidence input must be a file below release-evidence/private/."];
  }
  return [];
}

function hasRestrictiveMode(mode: number): boolean {
  return (mode & 0o077) === 0;
}

export async function ensurePrivateEvidenceDirectory(
  workspaceRoot = process.cwd()
): Promise<string> {
  const directory = privateEvidenceDirectory(workspaceRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

export async function loadPrivateEvidenceBundle(input: {
  readonly evidencePath: string;
  readonly workspaceRoot?: string;
  readonly allowSynthetic?: boolean;
  readonly requireAllPhases?: boolean;
}): Promise<{ readonly bundle: unknown | null; readonly violations: readonly string[] }> {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  const pathViolations = validatePrivateEvidencePath(input.evidencePath, workspaceRoot);
  if (pathViolations.length > 0) return { bundle: null, violations: pathViolations };

  const directory = privateEvidenceDirectory(workspaceRoot);
  const evidencePath = resolve(workspaceRoot, input.evidencePath);
  try {
    const [directoryStats, evidenceStats] = await Promise.all([
      lstat(directory),
      lstat(evidencePath)
    ]);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      return { bundle: null, violations: ["Private evidence directory must be a real directory."] };
    }
    if (!hasRestrictiveMode(directoryStats.mode)) {
      return {
        bundle: null,
        violations: ["Private evidence directory must not grant group or other access."]
      };
    }
    if (!evidenceStats.isFile() || evidenceStats.isSymbolicLink()) {
      return {
        bundle: null,
        violations: ["Private evidence input must be a regular non-symlink file."]
      };
    }
    if (!hasRestrictiveMode(evidenceStats.mode)) {
      return {
        bundle: null,
        violations: ["Private evidence file must not grant group or other access."]
      };
    }
    const bundle = JSON.parse(await readFile(evidencePath, "utf8")) as unknown;
    return {
      bundle,
      violations: validateEvidenceBundle(bundle, {
        allowSynthetic: input.allowSynthetic,
        requireAllPhases: input.requireAllPhases
      })
    };
  } catch {
    return { bundle: null, violations: ["Private evidence bundle could not be read as JSON."] };
  }
}
