import { describe, expect, it } from "vitest";

import {
  OCI_CONFIG,
  OCI_GZIP_LAYER,
  OCI_INDEX,
  OCI_MANIFEST,
  type Sha256Digest
} from "./gateway-registry-contract.ts";
import type { GatewayRegistryInspection } from "./gateway-registry-client.ts";
import {
  createRuntimeBinding,
  diffGatewayImages,
  validateRuntimeBinding,
  withRuntimeBindingHash,
  type RuntimeBindingRecordWithoutHash
} from "./gateway-runtime-binding.ts";

const digest = (character: string): Sha256Digest =>
  `sha256:${character.repeat(64)}` as Sha256Digest;
const SOURCE = "69fee2fcedf7d0474d5a75d64323318b993f7a6a";
const REPOSITORY = "ghcr.io/zukhriddingit/vera-openclaw-gateway";

function inspection(input: {
  index: Sha256Digest;
  runtime: Sha256Digest;
  config: Sha256Digest;
  layers: readonly Sha256Digest[];
  sizes: readonly number[];
  attestation?: Sha256Digest;
}): GatewayRegistryInspection {
  const runtimeDescriptor = {
    mediaType: OCI_MANIFEST,
    digest: input.runtime,
    size: 1_000,
    platform: { os: "linux", architecture: "amd64" }
  } as const;
  const attestation = input.attestation
    ? [
        {
          mediaType: OCI_MANIFEST,
          digest: input.attestation,
          size: 839,
          platform: { os: "unknown", architecture: "unknown" },
          annotations: {
            "vnd.docker.reference.digest": input.runtime,
            "vnd.docker.reference.type": "attestation-manifest"
          }
        }
      ]
    : [];
  const runtimeManifest = {
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: { mediaType: OCI_CONFIG, digest: input.config, size: 100 },
    layers: input.layers.map((layerDigest, index) => ({
      mediaType: OCI_GZIP_LAYER,
      digest: layerDigest,
      size: input.sizes[index] as number
    }))
  } as const;
  return {
    schemaVersion: 1,
    imageRef: `${REPOSITORY}@${input.index}`,
    registry: "ghcr.io",
    repository: "zukhriddingit/vera-openclaw-gateway",
    releaseIndexDigest: input.index,
    releaseIndexMediaType: OCI_INDEX,
    releaseIndexObject: {
      descriptorDigest: input.index,
      observedDigest: input.index,
      descriptorBytes: null,
      observedBytes: 1_000,
      responseContentType: OCI_INDEX,
      getStatus: 200,
      durationMilliseconds: 5,
      redirectCount: 0
    },
    releaseIndex: {
      schemaVersion: 2,
      mediaType: OCI_INDEX,
      manifests: [runtimeDescriptor, ...attestation]
    },
    runtimeDescriptor,
    runtimeManifestDigest: input.runtime,
    runtimeManifestMediaType: OCI_MANIFEST,
    runtimeManifestObject: {
      descriptorDigest: input.runtime,
      observedDigest: input.runtime,
      descriptorBytes: 1_000,
      observedBytes: 1_000,
      responseContentType: OCI_MANIFEST,
      getStatus: 200,
      durationMilliseconds: 5,
      redirectCount: 0
    },
    runtimeManifest,
    attestationDescriptors: attestation,
    configurationDigest: input.config,
    configurationObject: {
      descriptorDigest: input.config,
      observedDigest: input.config,
      descriptorBytes: 100,
      observedBytes: 100,
      responseContentType: "application/octet-stream",
      getStatus: 200,
      durationMilliseconds: 5,
      redirectCount: 0
    },
    rootfsDiffIds: input.layers.map((_value, index) => digest(String((index + 1) % 10))),
    sourceRevision: SOURCE,
    runnablePlatformCount: 1,
    attestationManifestCount: attestation.length,
    runtimeLayerCount: input.layers.length,
    totalCompressedBytes: input.sizes.reduce((total, size) => total + size, 0),
    layers: []
  };
}

const previous = inspection({
  index: digest("a"),
  runtime: digest("b"),
  config: digest("c"),
  layers: [digest("d"), digest("e")],
  sizes: [296_000_000, 50_492],
  attestation: digest("8")
});
const current = inspection({
  index: digest("f"),
  runtime: digest("1"),
  config: digest("2"),
  layers: [digest("d"), digest("e"), digest("3")],
  sizes: [296_000_000, 50_492, 60],
  attestation: digest("9")
});

function binding(): RuntimeBindingRecordWithoutHash {
  return {
    schemaVersion: 1,
    releaseIndex: current.imageRef,
    runtimeManifest: `${REPOSITORY}@${current.runtimeManifestDigest}`,
    descriptorMediaType: OCI_MANIFEST,
    platform: { os: "linux", architecture: "amd64" },
    sourceRevision: SOURCE,
    imageConfigDigest: current.configurationDigest,
    rootfsDiffIds: current.rootfsDiffIds,
    sbomSubject: current.runtimeManifestDigest,
    provenanceSubject: current.runtimeManifestDigest,
    signatureVerification: "verified"
  };
}

describe("Gateway structural diff", () => {
  it("reports the extra gzip layer and changed config deterministically", () => {
    expect(diffGatewayImages(previous, current)).toEqual({
      schemaVersion: 1,
      topLevelMediaTypeChanged: false,
      runnablePlatformCount: { previous: 1, current: 1 },
      attestationManifestCount: { previous: 1, current: 1 },
      runtimeManifestMediaTypeChanged: false,
      runtimeLayerCount: { previous: 2, current: 3 },
      compressedBytes: { previous: 296_050_492, current: 296_050_552 },
      changedConfig: true,
      changedRootfsDiffIds: true,
      addedLayerDigests: [digest("3")],
      removedLayerDigests: [],
      reorderedLayers: false
    });
  });
});

describe("Gateway runtime binding", () => {
  it("hashes equivalent records identically regardless of key insertion order", () => {
    const original = binding();
    const reordered = Object.fromEntries(
      Object.entries(original).reverse()
    ) as unknown as RuntimeBindingRecordWithoutHash;
    expect(withRuntimeBindingHash(original).contentHash).toBe(
      withRuntimeBindingHash(reordered).contentHash
    );
  });

  it("creates a binding only when the release index references the runtime child", () => {
    expect(
      createRuntimeBinding({
        inspection: current,
        sbomSubject: current.runtimeManifestDigest,
        provenanceSubject: current.runtimeManifestDigest,
        signatureVerification: "verified"
      })
    ).toMatchObject({
      runtimeManifest: `${REPOSITORY}@${current.runtimeManifestDigest}`,
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    const mixed = structuredClone(current);
    mixed.releaseIndex.manifests[0]!.digest = digest("4");
    expect(() =>
      createRuntimeBinding({
        inspection: mixed,
        sbomSubject: current.runtimeManifestDigest,
        provenanceSubject: current.runtimeManifestDigest,
        signatureVerification: "verified"
      })
    ).toThrow(/does not reference/u);
  });

  it.each([
    ["extra field", { extra: "no" }, /closed schema/u],
    ["mutable release", { releaseIndex: `${REPOSITORY}:latest` }, /immutable/u],
    [
      "mixed repository",
      { runtimeManifest: `ghcr.io/other/gateway@${current.runtimeManifestDigest}` },
      /repositories must match/u
    ],
    ["wrong platform", { platform: { os: "linux", architecture: "arm64" } }, /linux\/amd64/u],
    ["bad source", { sourceRevision: "main" }, /commit SHA/u],
    ["missing diff IDs", { rootfsDiffIds: [] }, /diff IDs/u],
    ["wrong SBOM subject", { sbomSubject: digest("5") }, /must subject/u],
    ["wrong provenance subject", { provenanceSubject: digest("6") }, /must subject/u],
    ["unverified signature", { signatureVerification: "pending" }, /must be verified/u]
  ])("rejects %s", (_label, change, message) => {
    const value = { ...binding(), ...change };
    expect(validateRuntimeBinding(value).join(" ")).toMatch(message);
  });

  it("rejects modified content after hashing", () => {
    const hashed = withRuntimeBindingHash(binding());
    expect(validateRuntimeBinding({ ...hashed, sourceRevision: "1".repeat(40) }).join(" ")).toMatch(
      /content hash does not match/u
    );
  });
});
