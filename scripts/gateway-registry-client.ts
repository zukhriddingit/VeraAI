import { createHash } from "node:crypto";

import {
  OCI_INDEX,
  classifyIndexDescriptors,
  parseImmutableImageReference,
  parseManifestEnvelope,
  type OciDescriptor,
  type OciIndex,
  type OciManifest,
  type Sha256Digest
} from "./gateway-registry-contract.ts";

const FIXED_REGISTRY = "ghcr.io";
const FIXED_REPOSITORY = "zukhriddingit/vera-openclaw-gateway";
const TOKEN_ENDPOINT = new URL("https://ghcr.io/token");
const REQUEST_TIMEOUT_MILLISECONDS = 300_000;
const MAX_REDIRECTS = 3;
const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json"
].join(", ");

export interface RegistryTransportDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => number;
}

export interface VerifiedRegistryObject {
  readonly descriptorDigest: Sha256Digest;
  readonly observedDigest: Sha256Digest;
  readonly descriptorBytes: number | null;
  readonly observedBytes: number;
  readonly responseContentType: string | null;
  readonly getStatus: number;
  readonly durationMilliseconds: number;
  readonly redirectCount: number;
}

export interface VerifiedRegistryLayer extends VerifiedRegistryObject {
  readonly mediaType:
    | "application/vnd.oci.image.layer.v1.tar+gzip"
    | "application/vnd.docker.image.rootfs.diff.tar.gzip";
  readonly compression: "gzip";
  readonly headStatus: number;
  readonly headContentLength: number | null;
  readonly headDurationMilliseconds: number;
  readonly headRedirectCount: number;
}

export interface GatewayRegistryInspection {
  readonly schemaVersion: 1;
  readonly imageRef: string;
  readonly registry: "ghcr.io";
  readonly repository: "zukhriddingit/vera-openclaw-gateway";
  readonly releaseIndexDigest: Sha256Digest;
  readonly releaseIndexMediaType: typeof OCI_INDEX;
  readonly releaseIndexObject: VerifiedRegistryObject;
  readonly releaseIndex: OciIndex;
  readonly runtimeDescriptor: OciDescriptor;
  readonly runtimeManifestDigest: Sha256Digest;
  readonly runtimeManifestMediaType: OciManifest["mediaType"];
  readonly runtimeManifestObject: VerifiedRegistryObject;
  readonly runtimeManifest: OciManifest;
  readonly attestationDescriptors: readonly OciDescriptor[];
  readonly configurationDigest: Sha256Digest;
  readonly configurationObject: VerifiedRegistryObject;
  readonly rootfsDiffIds: readonly Sha256Digest[];
  readonly sourceRevision: string;
  readonly runnablePlatformCount: 1;
  readonly attestationManifestCount: number;
  readonly runtimeLayerCount: number;
  readonly totalCompressedBytes: number;
  readonly layers: readonly VerifiedRegistryLayer[];
}

interface FetchedBytes extends VerifiedRegistryObject {
  readonly bytes: Uint8Array;
}

interface FollowedResponse {
  readonly response: Response;
  readonly redirectCount: number;
}

function normalizeContentType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function parseContentLength(value: string | null, label: string): number | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} content length is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} content length is invalid.`);
  }
  return parsed;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function sanitizedRequestError(error: unknown): Error {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  ) {
    return new Error("Registry request timed out.");
  }
  return new Error("Registry request failed.");
}

async function fetchFollowingRedirects(
  initialUrl: URL,
  init: RequestInit,
  bearerToken: string | null,
  dependencies: RegistryTransportDependencies
): Promise<FollowedResponse> {
  let url = new URL(initialUrl);
  let redirectCount = 0;
  while (true) {
    const headers = new Headers(init.headers);
    if (bearerToken && url.origin === "https://ghcr.io") {
      headers.set("authorization", `Bearer ${bearerToken}`);
    } else {
      headers.delete("authorization");
    }
    let response: Response;
    try {
      response = await dependencies.fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS)
      });
    } catch (error) {
      throw sanitizedRequestError(error);
    }
    if (!isRedirect(response.status)) return { response, redirectCount };
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error("Registry redirect limit exceeded.");
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("Registry redirect did not include a location.");
    const next = new URL(location, url);
    if (next.protocol !== "https:" || next.username || next.password) {
      throw new Error("Registry redirect is unsafe.");
    }
    url = next;
    redirectCount += 1;
  }
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
  label: string
): Promise<Uint8Array> {
  if (!response.body) throw new Error(`${label} response body is missing.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeded its bounded size.`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function acquireAnonymousToken(dependencies: RegistryTransportDependencies): Promise<string> {
  const url = new URL(TOKEN_ENDPOINT);
  url.searchParams.set("service", FIXED_REGISTRY);
  url.searchParams.set("scope", `repository:${FIXED_REPOSITORY}:pull`);
  const { response } = await fetchFollowingRedirects(
    url,
    { method: "GET", headers: { accept: "application/json" } },
    null,
    dependencies
  );
  if (response.status !== 200) {
    throw new Error(`Anonymous registry token request returned status ${String(response.status)}.`);
  }
  const bytes = await readBoundedBytes(response, MAX_TOKEN_BYTES, "Registry token");
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Anonymous registry token response was invalid.");
  }
  const token =
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).token === "string"
      ? (payload as Record<string, string>).token
      : null;
  if (!token || token.length < 8 || token.length > 8_192) {
    throw new Error("Anonymous registry token response was invalid.");
  }
  return token;
}

function verifyDockerContentDigest(
  response: Response,
  expectedDigest: Sha256Digest,
  label: string
): void {
  const declared = response.headers.get("docker-content-digest");
  if (declared !== null && declared !== expectedDigest) {
    throw new Error(`${label} Docker-Content-Digest did not match its descriptor.`);
  }
}

async function fetchVerifiedBytes(input: {
  readonly url: URL;
  readonly bearerToken: string;
  readonly expectedDigest: Sha256Digest;
  readonly expectedBytes: number | null;
  readonly maximumBytes: number;
  readonly accept: string;
  readonly label: string;
  readonly dependencies: RegistryTransportDependencies;
}): Promise<FetchedBytes> {
  const startedAt = input.dependencies.now();
  const { response, redirectCount } = await fetchFollowingRedirects(
    input.url,
    { method: "GET", headers: { accept: input.accept } },
    input.bearerToken,
    input.dependencies
  );
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`${input.label} returned status ${String(response.status)}.`);
  }
  verifyDockerContentDigest(response, input.expectedDigest, input.label);
  const headerLength = parseContentLength(response.headers.get("content-length"), input.label);
  if (
    input.expectedBytes !== null &&
    headerLength !== null &&
    headerLength !== input.expectedBytes
  ) {
    throw new Error(`${input.label} content length did not match its descriptor.`);
  }
  const bytes = await readBoundedBytes(response, input.maximumBytes, input.label);
  if (input.expectedBytes !== null && bytes.byteLength !== input.expectedBytes) {
    throw new Error(`${input.label} content length did not match its descriptor.`);
  }
  const observedDigest =
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256Digest;
  if (observedDigest !== input.expectedDigest) {
    throw new Error(`${input.label} SHA-256 did not match its descriptor.`);
  }
  return {
    descriptorDigest: input.expectedDigest,
    observedDigest,
    descriptorBytes: input.expectedBytes,
    observedBytes: bytes.byteLength,
    responseContentType: normalizeContentType(response.headers.get("content-type")),
    getStatus: response.status,
    durationMilliseconds: Math.max(0, input.dependencies.now() - startedAt),
    redirectCount,
    bytes
  };
}

async function headVerifiedLayer(input: {
  readonly url: URL;
  readonly bearerToken: string;
  readonly descriptor: OciManifest["layers"][number];
  readonly dependencies: RegistryTransportDependencies;
}): Promise<{
  readonly status: number;
  readonly contentLength: number | null;
  readonly durationMilliseconds: number;
  readonly redirectCount: number;
}> {
  const startedAt = input.dependencies.now();
  const { response, redirectCount } = await fetchFollowingRedirects(
    input.url,
    { method: "HEAD", headers: { accept: "application/octet-stream" } },
    input.bearerToken,
    input.dependencies
  );
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`Runtime layer HEAD returned status ${String(response.status)}.`);
  }
  verifyDockerContentDigest(response, input.descriptor.digest, "Runtime layer HEAD");
  const contentLength = parseContentLength(
    response.headers.get("content-length"),
    "Runtime layer HEAD"
  );
  if (contentLength !== null && contentLength !== input.descriptor.size) {
    throw new Error("Runtime layer HEAD content length did not match its descriptor.");
  }
  return {
    status: response.status,
    contentLength,
    durationMilliseconds: Math.max(0, input.dependencies.now() - startedAt),
    redirectCount
  };
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

function parseConfig(
  value: unknown,
  expectedLayerCount: number
): {
  readonly rootfsDiffIds: readonly Sha256Digest[];
  readonly sourceRevision: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Gateway image config must be an object.");
  }
  const config = value as Record<string, unknown>;
  if (config.architecture !== "amd64" || config.os !== "linux") {
    throw new Error("Gateway image config must target linux/amd64.");
  }
  const rootfs =
    typeof config.rootfs === "object" && config.rootfs !== null && !Array.isArray(config.rootfs)
      ? (config.rootfs as Record<string, unknown>)
      : null;
  const diffIds = rootfs?.diff_ids;
  if (
    rootfs?.type !== "layers" ||
    !Array.isArray(diffIds) ||
    diffIds.length !== expectedLayerCount ||
    !diffIds.every((digest) => typeof digest === "string" && SHA256.test(digest))
  ) {
    throw new Error("Gateway image config rootfs diff IDs are invalid.");
  }
  const runtimeConfig =
    typeof config.config === "object" && config.config !== null && !Array.isArray(config.config)
      ? (config.config as Record<string, unknown>)
      : null;
  const labels =
    typeof runtimeConfig?.Labels === "object" &&
    runtimeConfig.Labels !== null &&
    !Array.isArray(runtimeConfig.Labels)
      ? (runtimeConfig.Labels as Record<string, unknown>)
      : null;
  const sourceRevision = labels?.["org.opencontainers.image.revision"];
  if (typeof sourceRevision !== "string" || !COMMIT_SHA.test(sourceRevision)) {
    throw new Error("Gateway image config source revision is invalid.");
  }
  return {
    rootfsDiffIds: diffIds as Sha256Digest[],
    sourceRevision
  };
}

function manifestUrl(repository: string, digest: Sha256Digest): URL {
  return new URL(`/v2/${repository}/manifests/${digest}`, `https://${FIXED_REGISTRY}`);
}

function blobUrl(repository: string, digest: Sha256Digest): URL {
  return new URL(`/v2/${repository}/blobs/${digest}`, `https://${FIXED_REGISTRY}`);
}

export async function inspectPublicGatewayImage(
  input: { readonly imageRef: string },
  dependencies: RegistryTransportDependencies = {
    fetch: globalThis.fetch,
    now: () => performance.now()
  }
): Promise<GatewayRegistryInspection> {
  const reference = parseImmutableImageReference(input.imageRef);
  if (reference.registry !== FIXED_REGISTRY || reference.repository !== FIXED_REPOSITORY) {
    throw new Error("Gateway registry inspection accepts only the approved public package.");
  }
  const bearerToken = await acquireAnonymousToken(dependencies);
  const indexObject = await fetchVerifiedBytes({
    url: manifestUrl(reference.repository, reference.digest),
    bearerToken,
    expectedDigest: reference.digest,
    expectedBytes: null,
    maximumBytes: MAX_MANIFEST_BYTES,
    accept: MANIFEST_ACCEPT,
    label: "Gateway release index",
    dependencies
  });
  const parsedIndex = parseManifestEnvelope(decodeJson(indexObject.bytes, "Gateway release index"));
  if (parsedIndex.mediaType !== OCI_INDEX) {
    throw new Error("Gateway release reference must resolve to an OCI image index.");
  }
  if (indexObject.responseContentType !== null && indexObject.responseContentType !== OCI_INDEX) {
    throw new Error("Gateway release index response media type is inconsistent.");
  }
  const { runtime, attestations } = classifyIndexDescriptors(parsedIndex);
  const runtimeObject = await fetchVerifiedBytes({
    url: manifestUrl(reference.repository, runtime.digest),
    bearerToken,
    expectedDigest: runtime.digest,
    expectedBytes: runtime.size,
    maximumBytes: MAX_MANIFEST_BYTES,
    accept: MANIFEST_ACCEPT,
    label: "Gateway runtime manifest",
    dependencies
  });
  const parsedRuntime = parseManifestEnvelope(
    decodeJson(runtimeObject.bytes, "Gateway runtime manifest")
  );
  if (parsedRuntime.mediaType === OCI_INDEX) {
    throw new Error("Gateway runtime descriptor must resolve to an image manifest.");
  }
  if (
    parsedRuntime.mediaType !== runtime.mediaType ||
    (runtimeObject.responseContentType !== null &&
      runtimeObject.responseContentType !== runtime.mediaType)
  ) {
    throw new Error("Gateway runtime manifest media type is inconsistent.");
  }
  const configObject = await fetchVerifiedBytes({
    url: blobUrl(reference.repository, parsedRuntime.config.digest),
    bearerToken,
    expectedDigest: parsedRuntime.config.digest,
    expectedBytes: parsedRuntime.config.size,
    maximumBytes: parsedRuntime.config.size,
    accept: parsedRuntime.config.mediaType,
    label: "Gateway image config",
    dependencies
  });
  const config = parseConfig(
    decodeJson(configObject.bytes, "Gateway image config"),
    parsedRuntime.layers.length
  );
  const layers: VerifiedRegistryLayer[] = [];
  for (const descriptor of parsedRuntime.layers) {
    const url = blobUrl(reference.repository, descriptor.digest);
    const head = await headVerifiedLayer({
      url,
      bearerToken,
      descriptor,
      dependencies
    });
    const object = await fetchVerifiedBytes({
      url,
      bearerToken,
      expectedDigest: descriptor.digest,
      expectedBytes: descriptor.size,
      maximumBytes: descriptor.size,
      accept: descriptor.mediaType,
      label: "Runtime layer",
      dependencies
    });
    const { bytes: _layerBytes, ...verifiedLayer } = object;
    layers.push({
      ...verifiedLayer,
      mediaType: descriptor.mediaType,
      compression: "gzip",
      headStatus: head.status,
      headContentLength: head.contentLength,
      headDurationMilliseconds: head.durationMilliseconds,
      headRedirectCount: head.redirectCount
    });
  }
  const totalCompressedBytes = parsedRuntime.layers.reduce((total, { size }) => total + size, 0);
  if (!Number.isSafeInteger(totalCompressedBytes)) {
    throw new Error("Gateway total compressed size is unsafe.");
  }
  const { bytes: _indexBytes, ...releaseIndexObject } = indexObject;
  const { bytes: _runtimeBytes, ...runtimeManifestObject } = runtimeObject;
  const { bytes: _configBytes, ...configurationObject } = configObject;
  return {
    schemaVersion: 1,
    imageRef: reference.reference,
    registry: FIXED_REGISTRY,
    repository: FIXED_REPOSITORY,
    releaseIndexDigest: reference.digest,
    releaseIndexMediaType: OCI_INDEX,
    releaseIndexObject,
    releaseIndex: parsedIndex,
    runtimeDescriptor: runtime,
    runtimeManifestDigest: runtime.digest,
    runtimeManifestMediaType: parsedRuntime.mediaType,
    runtimeManifestObject,
    runtimeManifest: parsedRuntime,
    attestationDescriptors: attestations,
    configurationDigest: parsedRuntime.config.digest,
    configurationObject,
    rootfsDiffIds: config.rootfsDiffIds,
    sourceRevision: config.sourceRevision,
    runnablePlatformCount: 1,
    attestationManifestCount: attestations.length,
    runtimeLayerCount: parsedRuntime.layers.length,
    totalCompressedBytes,
    layers
  };
}
