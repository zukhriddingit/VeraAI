import { createHash } from "node:crypto";

import {
  DOCKER_MANIFEST_V2,
  OCI_MANIFEST,
  parseImmutableImageReference,
  type ApprovedManifestMediaType,
  type Sha256Digest
} from "./gateway-registry-contract.ts";
import type { GatewayRegistryInspection } from "./gateway-registry-client.ts";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const BINDING_KEYS = [
  "schemaVersion",
  "releaseIndex",
  "runtimeManifest",
  "descriptorMediaType",
  "platform",
  "sourceRevision",
  "imageConfigDigest",
  "rootfsDiffIds",
  "sbomSubject",
  "provenanceSubject",
  "signatureVerification"
] as const;
const HASHED_BINDING_KEYS = [...BINDING_KEYS, "contentHash"] as const;

export interface GatewayImageStructuralDiff {
  readonly schemaVersion: 1;
  readonly topLevelMediaTypeChanged: boolean;
  readonly runnablePlatformCount: { readonly previous: number; readonly current: number };
  readonly attestationManifestCount: {
    readonly previous: number;
    readonly current: number;
  };
  readonly runtimeManifestMediaTypeChanged: boolean;
  readonly runtimeLayerCount: { readonly previous: number; readonly current: number };
  readonly compressedBytes: { readonly previous: number; readonly current: number };
  readonly changedConfig: boolean;
  readonly changedRootfsDiffIds: boolean;
  readonly addedLayerDigests: readonly Sha256Digest[];
  readonly removedLayerDigests: readonly Sha256Digest[];
  readonly reorderedLayers: boolean;
}

export interface RuntimeBindingRecordWithoutHash {
  readonly schemaVersion: 1;
  readonly releaseIndex: string;
  readonly runtimeManifest: string;
  readonly descriptorMediaType: ApprovedManifestMediaType;
  readonly platform: {
    readonly os: "linux";
    readonly architecture: "amd64";
  };
  readonly sourceRevision: string;
  readonly imageConfigDigest: Sha256Digest;
  readonly rootfsDiffIds: readonly Sha256Digest[];
  readonly sbomSubject: Sha256Digest;
  readonly provenanceSubject: Sha256Digest;
  readonly signatureVerification: "verified";
}

export interface RuntimeBindingRecord extends RuntimeBindingRecordWithoutHash {
  readonly contentHash: Sha256Digest;
}

type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256.test(value) && value !== `sha256:${"0".repeat(64)}`;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  const object = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key] as JsonValue)}`)
    .join(",")}}`;
}

function withoutHash(record: RuntimeBindingRecord): RuntimeBindingRecordWithoutHash {
  return {
    schemaVersion: record.schemaVersion,
    releaseIndex: record.releaseIndex,
    runtimeManifest: record.runtimeManifest,
    descriptorMediaType: record.descriptorMediaType,
    platform: record.platform,
    sourceRevision: record.sourceRevision,
    imageConfigDigest: record.imageConfigDigest,
    rootfsDiffIds: record.rootfsDiffIds,
    sbomSubject: record.sbomSubject,
    provenanceSubject: record.provenanceSubject,
    signatureVerification: record.signatureVerification
  };
}

function bindingHash(record: RuntimeBindingRecordWithoutHash): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(canonicalize(record as unknown as JsonValue))
    .digest("hex")}` as Sha256Digest;
}

function orderedLayersChanged(
  previous: readonly Sha256Digest[],
  current: readonly Sha256Digest[]
): boolean {
  const shared = previous.filter((digest) => current.includes(digest));
  const currentShared = current.filter((digest) => previous.includes(digest));
  return shared.some((digest, index) => digest !== currentShared[index]);
}

export function diffGatewayImages(
  previous: GatewayRegistryInspection,
  current: GatewayRegistryInspection
): GatewayImageStructuralDiff {
  const previousLayers = previous.runtimeManifest.layers.map(({ digest }) => digest);
  const currentLayers = current.runtimeManifest.layers.map(({ digest }) => digest);
  return {
    schemaVersion: 1,
    topLevelMediaTypeChanged: previous.releaseIndexMediaType !== current.releaseIndexMediaType,
    runnablePlatformCount: {
      previous: previous.runnablePlatformCount,
      current: current.runnablePlatformCount
    },
    attestationManifestCount: {
      previous: previous.attestationManifestCount,
      current: current.attestationManifestCount
    },
    runtimeManifestMediaTypeChanged:
      previous.runtimeManifestMediaType !== current.runtimeManifestMediaType,
    runtimeLayerCount: {
      previous: previous.runtimeLayerCount,
      current: current.runtimeLayerCount
    },
    compressedBytes: {
      previous: previous.totalCompressedBytes,
      current: current.totalCompressedBytes
    },
    changedConfig:
      previous.configurationDigest !== current.configurationDigest ||
      previous.runtimeManifest.config.size !== current.runtimeManifest.config.size,
    changedRootfsDiffIds:
      JSON.stringify(previous.rootfsDiffIds) !== JSON.stringify(current.rootfsDiffIds),
    addedLayerDigests: currentLayers.filter((digest) => !previousLayers.includes(digest)),
    removedLayerDigests: previousLayers.filter((digest) => !currentLayers.includes(digest)),
    reorderedLayers: orderedLayersChanged(previousLayers, currentLayers)
  };
}

export function validateRuntimeBinding(value: unknown): readonly string[] {
  const violations: string[] = [];
  if (!isObject(value)) return ["Runtime binding must be an object."];
  const hasHash = Object.hasOwn(value, "contentHash");
  const expectedKeys = hasHash ? HASHED_BINDING_KEYS : BINDING_KEYS;
  if (!hasExactKeys(value, expectedKeys)) {
    violations.push("Runtime binding fields must match the closed schema.");
  }
  if (value.schemaVersion !== 1) {
    violations.push("Runtime binding schemaVersion must be 1.");
  }

  let releaseIndex: ReturnType<typeof parseImmutableImageReference> | null = null;
  let runtimeManifest: ReturnType<typeof parseImmutableImageReference> | null = null;
  try {
    releaseIndex = parseImmutableImageReference(value.releaseIndex);
  } catch {
    violations.push("Release index must be an immutable image reference.");
  }
  try {
    runtimeManifest = parseImmutableImageReference(value.runtimeManifest);
  } catch {
    violations.push("Runtime manifest must be an immutable image reference.");
  }
  if (
    releaseIndex &&
    runtimeManifest &&
    (releaseIndex.registry !== runtimeManifest.registry ||
      releaseIndex.repository !== runtimeManifest.repository)
  ) {
    violations.push("Release index and runtime manifest repositories must match.");
  }
  if (
    value.descriptorMediaType !== OCI_MANIFEST &&
    value.descriptorMediaType !== DOCKER_MANIFEST_V2
  ) {
    violations.push("Runtime descriptor media type is not approved.");
  }
  if (
    !isObject(value.platform) ||
    !hasExactKeys(value.platform, ["os", "architecture"]) ||
    value.platform.os !== "linux" ||
    value.platform.architecture !== "amd64"
  ) {
    violations.push("Runtime platform must be exactly linux/amd64.");
  }
  if (typeof value.sourceRevision !== "string" || !COMMIT_SHA.test(value.sourceRevision)) {
    violations.push("Source revision must be an exact commit SHA.");
  }
  if (!isDigest(value.imageConfigDigest)) {
    violations.push("Image config digest is invalid.");
  }
  if (
    !Array.isArray(value.rootfsDiffIds) ||
    value.rootfsDiffIds.length === 0 ||
    !value.rootfsDiffIds.every(isDigest)
  ) {
    violations.push("Rootfs diff IDs must be a non-empty ordered digest list.");
  }
  if (!isDigest(value.sbomSubject)) {
    violations.push("SBOM subject digest is invalid.");
  }
  if (!isDigest(value.provenanceSubject)) {
    violations.push("Provenance subject digest is invalid.");
  }
  if (
    runtimeManifest &&
    (value.sbomSubject !== runtimeManifest.digest ||
      value.provenanceSubject !== runtimeManifest.digest)
  ) {
    violations.push("SBOM and provenance must subject the runtime manifest.");
  }
  if (value.signatureVerification !== "verified") {
    violations.push("Runtime signature must be verified.");
  }
  if (hasHash) {
    if (!isDigest(value.contentHash)) {
      violations.push("Runtime binding content hash is invalid.");
    } else if (
      violations.length === 0 &&
      value.contentHash !== bindingHash(withoutHash(value as unknown as RuntimeBindingRecord))
    ) {
      violations.push("Runtime binding content hash does not match.");
    }
  }
  return violations;
}

export function withRuntimeBindingHash(
  value: RuntimeBindingRecordWithoutHash
): RuntimeBindingRecord {
  const violations = validateRuntimeBinding(value);
  if (violations.length > 0) throw new Error(violations.join(" "));
  return { ...value, contentHash: bindingHash(value) };
}

export function createRuntimeBinding(input: {
  readonly inspection: GatewayRegistryInspection;
  readonly sbomSubject: Sha256Digest;
  readonly provenanceSubject: Sha256Digest;
  readonly signatureVerification: "verified";
}): RuntimeBindingRecord {
  const { inspection } = input;
  const referencedRuntime = inspection.releaseIndex.manifests.some(
    ({ digest, mediaType, platform }) =>
      digest === inspection.runtimeManifestDigest &&
      mediaType === inspection.runtimeManifestMediaType &&
      platform?.os === "linux" &&
      platform.architecture === "amd64"
  );
  if (!referencedRuntime) {
    throw new Error("Release index does not reference the inspected runtime manifest.");
  }
  return withRuntimeBindingHash({
    schemaVersion: 1,
    releaseIndex: inspection.imageRef,
    runtimeManifest: `${inspection.registry}/${inspection.repository}@${inspection.runtimeManifestDigest}`,
    descriptorMediaType: inspection.runtimeManifestMediaType,
    platform: { os: "linux", architecture: "amd64" },
    sourceRevision: inspection.sourceRevision,
    imageConfigDigest: inspection.configurationDigest,
    rootfsDiffIds: inspection.rootfsDiffIds,
    sbomSubject: input.sbomSubject,
    provenanceSubject: input.provenanceSubject,
    signatureVerification: input.signatureVerification
  });
}
