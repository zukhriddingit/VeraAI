import { createHash } from "node:crypto";

export const OCI_INDEX = "application/vnd.oci.image.index.v1+json" as const;
export const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json" as const;
export const DOCKER_MANIFEST_V2 = "application/vnd.docker.distribution.manifest.v2+json" as const;
export const OCI_CONFIG = "application/vnd.oci.image.config.v1+json" as const;
export const DOCKER_CONFIG = "application/vnd.docker.container.image.v1+json" as const;
export const OCI_GZIP_LAYER = "application/vnd.oci.image.layer.v1.tar+gzip" as const;
export const DOCKER_GZIP_LAYER = "application/vnd.docker.image.rootfs.diff.tar.gzip" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IMMUTABLE_IMAGE =
  /^(?<registry>[a-z0-9.-]+)\/(?<repository>[a-z0-9._/-]+)@(?<digest>sha256:[a-f0-9]{64})$/u;
const ANNOTATION_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

export type Sha256Digest = `sha256:${string}`;
export type ApprovedManifestMediaType = typeof OCI_MANIFEST | typeof DOCKER_MANIFEST_V2;
export type ApprovedConfigMediaType = typeof OCI_CONFIG | typeof DOCKER_CONFIG;
export type ApprovedLayerMediaType = typeof OCI_GZIP_LAYER | typeof DOCKER_GZIP_LAYER;

export interface OciPlatform {
  readonly os: string;
  readonly architecture: string;
  readonly variant?: string;
}

export interface OciDescriptor {
  readonly mediaType: string;
  readonly digest: Sha256Digest;
  readonly size: number;
  readonly platform?: OciPlatform;
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface OciIndex {
  readonly schemaVersion: 2;
  readonly mediaType: typeof OCI_INDEX;
  readonly manifests: readonly OciDescriptor[];
  readonly annotations?: Readonly<Record<string, string>>;
}

export interface OciManifest {
  readonly schemaVersion: 2;
  readonly mediaType: ApprovedManifestMediaType;
  readonly config: OciDescriptor & { readonly mediaType: ApprovedConfigMediaType };
  readonly layers: readonly (OciDescriptor & { readonly mediaType: ApprovedLayerMediaType })[];
  readonly annotations?: Readonly<Record<string, string>>;
}

export type ParsedManifest = OciIndex | OciManifest;

export interface DescriptorClassification {
  readonly runtime: OciDescriptor;
  readonly attestations: readonly OciDescriptor[];
}

export interface ImmutableImageReference {
  readonly registry: string;
  readonly repository: string;
  readonly digest: Sha256Digest;
  readonly reference: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[]
): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required.`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  return value;
}

function parseDigest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value) || value === `sha256:${"0".repeat(64)}`) {
    throw new Error(`${label} must be a non-placeholder SHA-256 digest.`);
  }
  return value as Sha256Digest;
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function parseAnnotations(
  value: unknown,
  label: string
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error(`${label} has too many entries.`);
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (
      !ANNOTATION_KEY.test(key) ||
      typeof entry !== "string" ||
      entry.length > 1_024 ||
      /[\u0000-\u001f\u007f]/u.test(entry)
    ) {
      throw new Error(`${label} contains an invalid annotation.`);
    }
    result[key] = entry;
  }
  return result;
}

function parsePlatform(value: unknown, label: string): OciPlatform | undefined {
  if (value === undefined) return undefined;
  const object = closedObject(value, label, ["os", "architecture"], ["variant"]);
  for (const key of ["os", "architecture"] as const) {
    if (typeof object[key] !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(object[key])) {
      throw new Error(`${label}.${key} is invalid.`);
    }
  }
  if (
    object.variant !== undefined &&
    (typeof object.variant !== "string" || !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(object.variant))
  ) {
    throw new Error(`${label}.variant is invalid.`);
  }
  return {
    os: object.os as string,
    architecture: object.architecture as string,
    ...(typeof object.variant === "string" ? { variant: object.variant } : {})
  };
}

function parseDescriptor(
  value: unknown,
  label: string,
  allowedMediaTypes: readonly string[],
  options: { readonly platform: "optional" | "forbidden" }
): OciDescriptor {
  const object = closedObject(
    value,
    label,
    ["mediaType", "digest", "size"],
    options.platform === "optional" ? ["platform", "annotations"] : ["annotations"]
  );
  if (typeof object.mediaType !== "string" || !allowedMediaTypes.includes(object.mediaType)) {
    throw new Error(`${label}.mediaType is not approved.`);
  }
  const annotations = parseAnnotations(object.annotations, `${label}.annotations`);
  const platform =
    options.platform === "optional"
      ? parsePlatform(object.platform, `${label}.platform`)
      : undefined;
  return {
    mediaType: object.mediaType,
    digest: parseDigest(object.digest, `${label}.digest`),
    size: parsePositiveInteger(object.size, `${label}.size`),
    ...(platform ? { platform } : {}),
    ...(annotations ? { annotations } : {})
  };
}

function parseIndex(value: unknown): OciIndex {
  const object = closedObject(
    value,
    "manifest",
    ["schemaVersion", "mediaType", "manifests"],
    ["annotations"]
  );
  if (object.schemaVersion !== 2 || object.mediaType !== OCI_INDEX) {
    throw new Error("Gateway image index must use OCI schema version 2.");
  }
  if (!Array.isArray(object.manifests) || object.manifests.length === 0) {
    throw new Error("Gateway image index must contain descriptors.");
  }
  const manifests = object.manifests.map((entry, index) =>
    parseDescriptor(
      entry,
      `manifest.manifests[${String(index)}]`,
      [OCI_MANIFEST, DOCKER_MANIFEST_V2],
      { platform: "optional" }
    )
  );
  const digests = manifests.map(({ digest }) => digest);
  if (new Set(digests).size !== digests.length) {
    throw new Error("Gateway index descriptor digests must be unique.");
  }
  const annotations = parseAnnotations(object.annotations, "manifest.annotations");
  return {
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests,
    ...(annotations ? { annotations } : {})
  };
}

function parseRuntimeManifest(value: unknown): OciManifest {
  const object = closedObject(
    value,
    "manifest",
    ["schemaVersion", "mediaType", "config", "layers"],
    ["annotations"]
  );
  if (
    object.schemaVersion !== 2 ||
    (object.mediaType !== OCI_MANIFEST && object.mediaType !== DOCKER_MANIFEST_V2)
  ) {
    throw new Error("Gateway runtime manifest must use approved schema version 2 media types.");
  }
  const config = parseDescriptor(object.config, "manifest.config", [OCI_CONFIG, DOCKER_CONFIG], {
    platform: "forbidden"
  }) as OciManifest["config"];
  if (!Array.isArray(object.layers) || object.layers.length === 0) {
    throw new Error("Gateway runtime manifest must contain layers.");
  }
  const layers = object.layers.map((entry, index) =>
    parseDescriptor(
      entry,
      `manifest.layers[${String(index)}]`,
      [OCI_GZIP_LAYER, DOCKER_GZIP_LAYER],
      { platform: "forbidden" }
    )
  ) as OciManifest["layers"];
  const digests = layers.map(({ digest }) => digest);
  if (new Set(digests).size !== digests.length) {
    throw new Error("Gateway runtime layer digests must be unique.");
  }
  const annotations = parseAnnotations(object.annotations, "manifest.annotations");
  return {
    schemaVersion: 2,
    mediaType: object.mediaType,
    config,
    layers,
    ...(annotations ? { annotations } : {})
  };
}

export function parseManifestEnvelope(value: unknown): ParsedManifest {
  if (!isObject(value)) throw new Error("manifest must be an object.");
  if (value.mediaType === OCI_INDEX) return parseIndex(value);
  return parseRuntimeManifest(value);
}

export function classifyIndexDescriptors(index: OciIndex): DescriptorClassification {
  const runtime = index.manifests.filter(
    ({ platform }) => platform?.os === "linux" && platform.architecture === "amd64"
  );
  const attestations = index.manifests.filter(
    ({ platform, annotations }) =>
      platform?.os === "unknown" &&
      platform.architecture === "unknown" &&
      annotations?.["vnd.docker.reference.type"] === "attestation-manifest" &&
      annotations["vnd.docker.reference.digest"] === runtime[0]?.digest
  );
  if (runtime.length !== 1 || runtime.length + attestations.length !== index.manifests.length) {
    throw new Error(
      "Gateway index must contain exactly one runnable linux/amd64 descriptor and only bound attestation manifests."
    );
  }
  return { runtime: runtime[0], attestations };
}

export function parseImmutableImageReference(value: unknown): ImmutableImageReference {
  if (typeof value !== "string") {
    throw new Error("Expected an immutable image reference.");
  }
  const match = IMMUTABLE_IMAGE.exec(value);
  const registry = match?.groups?.registry;
  const repository = match?.groups?.repository;
  const digest = match?.groups?.digest;
  if (!registry || !repository || !digest) {
    throw new Error("Expected an immutable image reference with an exact SHA-256 digest.");
  }
  return {
    registry,
    repository,
    digest: parseDigest(digest, "image digest"),
    reference: value
  };
}

export function sha256Digest(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
