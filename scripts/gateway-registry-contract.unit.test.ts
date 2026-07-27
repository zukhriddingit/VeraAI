import { describe, expect, it } from "vitest";

import {
  DOCKER_GZIP_LAYER,
  DOCKER_MANIFEST_V2,
  OCI_GZIP_LAYER,
  OCI_INDEX,
  OCI_MANIFEST,
  classifyIndexDescriptors,
  parseImmutableImageReference,
  parseManifestEnvelope,
  sha256Digest,
  type OciDescriptor,
  type OciIndex
} from "./gateway-registry-contract.ts";

const CURRENT_CHILD = "sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a";
const ATTESTATION = "sha256:754047bc012640e17a9022fc2c1c134f317348d023d0a2a3b0c47bbc2d5433da";
const OTHER = `sha256:${"1".repeat(64)}`;

function runtimeDescriptor(overrides: Partial<OciDescriptor> = {}): OciDescriptor {
  return {
    mediaType: OCI_MANIFEST,
    digest: CURRENT_CHILD,
    size: 3_535,
    platform: { os: "linux", architecture: "amd64" },
    ...overrides
  };
}

function attestationDescriptor(overrides: Partial<OciDescriptor> = {}): OciDescriptor {
  return {
    mediaType: OCI_MANIFEST,
    digest: ATTESTATION,
    size: 839,
    platform: { os: "unknown", architecture: "unknown" },
    annotations: {
      "vnd.docker.reference.digest": CURRENT_CHILD,
      "vnd.docker.reference.type": "attestation-manifest"
    },
    ...overrides
  };
}

function indexFixture(
  manifests: readonly OciDescriptor[] = [runtimeDescriptor(), attestationDescriptor()]
): OciIndex {
  return {
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests
  };
}

function runtimeManifest(
  mediaType: typeof OCI_MANIFEST | typeof DOCKER_MANIFEST_V2 = OCI_MANIFEST
) {
  const docker = mediaType === DOCKER_MANIFEST_V2;
  return {
    schemaVersion: 2,
    mediaType,
    config: {
      mediaType: docker
        ? "application/vnd.docker.container.image.v1+json"
        : "application/vnd.oci.image.config.v1+json",
      digest: `sha256:${"2".repeat(64)}`,
      size: 6_865
    },
    layers: [
      {
        mediaType: docker ? DOCKER_GZIP_LAYER : OCI_GZIP_LAYER,
        digest: `sha256:${"3".repeat(64)}`,
        size: 1_024
      }
    ]
  };
}

describe("Gateway registry manifest contract", () => {
  it("accepts exactly one linux amd64 runtime and one attestation descriptor", () => {
    expect(classifyIndexDescriptors(indexFixture())).toEqual({
      runtime: runtimeDescriptor(),
      attestations: [attestationDescriptor()]
    });
  });

  it.each([
    ["no runtime", [attestationDescriptor()]],
    [
      "two runtimes",
      [runtimeDescriptor(), runtimeDescriptor({ digest: OTHER }), attestationDescriptor()]
    ],
    [
      "arm64 runtime",
      [
        runtimeDescriptor({ platform: { os: "linux", architecture: "arm64" } }),
        attestationDescriptor()
      ]
    ],
    [
      "unclassified descriptor",
      [
        runtimeDescriptor(),
        attestationDescriptor({
          annotations: { "vnd.docker.reference.type": "unknown" }
        })
      ]
    ]
  ])("rejects %s", (_label, manifests) => {
    expect(() => classifyIndexDescriptors(indexFixture(manifests))).toThrow(
      /exactly one runnable linux\/amd64 descriptor/u
    );
  });

  it("parses OCI indexes without accepting arbitrary fields", () => {
    expect(parseManifestEnvelope(indexFixture())).toEqual(indexFixture());
    expect(() => parseManifestEnvelope({ ...indexFixture(), metadata: {} })).toThrow(
      /manifest\.metadata is not allowed/u
    );
  });

  it.each([OCI_MANIFEST, DOCKER_MANIFEST_V2])(
    "parses an approved %s runtime manifest",
    (mediaType) => {
      expect(parseManifestEnvelope(runtimeManifest(mediaType))).toEqual(runtimeManifest(mediaType));
    }
  );

  it.each([
    [
      "zstd layer",
      {
        ...runtimeManifest(),
        layers: [
          {
            mediaType: "application/vnd.oci.image.layer.v1.tar+zstd",
            digest: `sha256:${"4".repeat(64)}`,
            size: 100
          }
        ]
      }
    ],
    [
      "foreign layer",
      {
        ...runtimeManifest(),
        layers: [
          {
            mediaType: "application/vnd.docker.image.rootfs.foreign.diff.tar.gzip",
            digest: `sha256:${"4".repeat(64)}`,
            size: 100
          }
        ]
      }
    ],
    [
      "zero-sized layer",
      {
        ...runtimeManifest(),
        layers: [
          {
            mediaType: OCI_GZIP_LAYER,
            digest: `sha256:${"4".repeat(64)}`,
            size: 0
          }
        ]
      }
    ],
    [
      "mutable digest",
      {
        ...runtimeManifest(),
        config: { ...runtimeManifest().config, digest: "latest" }
      }
    ],
    [
      "descriptor URLs",
      {
        ...runtimeManifest(),
        layers: [
          {
            mediaType: OCI_GZIP_LAYER,
            digest: `sha256:${"4".repeat(64)}`,
            size: 100,
            urls: ["https://unreviewed.example.test/blob"]
          }
        ]
      }
    ]
  ])("rejects a runtime manifest with %s", (_label, manifest) => {
    expect(() => parseManifestEnvelope(manifest)).toThrow();
  });

  it("rejects duplicate descriptor digests", () => {
    expect(() =>
      parseManifestEnvelope(
        indexFixture([runtimeDescriptor(), attestationDescriptor({ digest: CURRENT_CHILD })])
      )
    ).toThrow(/descriptor digests must be unique/u);
  });

  it("parses only immutable references", () => {
    expect(
      parseImmutableImageReference(`ghcr.io/zukhriddingit/vera-openclaw-gateway@${CURRENT_CHILD}`)
    ).toEqual({
      registry: "ghcr.io",
      repository: "zukhriddingit/vera-openclaw-gateway",
      digest: CURRENT_CHILD,
      reference: `ghcr.io/zukhriddingit/vera-openclaw-gateway@${CURRENT_CHILD}`
    });
    expect(() =>
      parseImmutableImageReference("ghcr.io/zukhriddingit/vera-openclaw-gateway:latest")
    ).toThrow(/immutable image reference/u);
  });

  it("computes a lowercase SHA-256 digest", () => {
    expect(sha256Digest(new TextEncoder().encode("vera"))).toBe(
      "sha256:c7f6d322bc205f26de153999e8d923b63b9261ce34bcb0ef1b9c711f843e05d5"
    );
  });
});
