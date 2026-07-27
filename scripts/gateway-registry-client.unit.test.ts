import { describe, expect, it } from "vitest";

import {
  OCI_CONFIG,
  OCI_GZIP_LAYER,
  OCI_INDEX,
  OCI_MANIFEST,
  sha256Digest,
  type Sha256Digest
} from "./gateway-registry-contract.ts";
import {
  inspectPublicGatewayImage,
  type RegistryTransportDependencies
} from "./gateway-registry-client.ts";

const REPOSITORY = "zukhriddingit/vera-openclaw-gateway";
const REGISTRY = "ghcr.io";
const SOURCE_COMMIT = "69fee2fcedf7d0474d5a75d64323318b993f7a6a";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function fixture() {
  const configBytes = jsonBytes({
    architecture: "amd64",
    os: "linux",
    config: {
      Labels: {
        "org.opencontainers.image.revision": SOURCE_COMMIT
      }
    },
    rootfs: {
      type: "layers",
      diff_ids: [`sha256:${"7".repeat(64)}`]
    }
  });
  const layerBytes = new TextEncoder().encode("verified-gzip-layer");
  const configDigest = sha256Digest(configBytes);
  const layerDigest = sha256Digest(layerBytes);
  const runtimeManifest = {
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: {
      mediaType: OCI_CONFIG,
      digest: configDigest,
      size: configBytes.byteLength
    },
    layers: [
      {
        mediaType: OCI_GZIP_LAYER,
        digest: layerDigest,
        size: layerBytes.byteLength
      }
    ]
  };
  const runtimeBytes = jsonBytes(runtimeManifest);
  const runtimeDigest = sha256Digest(runtimeBytes);
  const attestationDigest = `sha256:${"8".repeat(64)}` as Sha256Digest;
  const index = {
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests: [
      {
        mediaType: OCI_MANIFEST,
        digest: runtimeDigest,
        size: runtimeBytes.byteLength,
        platform: { os: "linux", architecture: "amd64" }
      },
      {
        mediaType: OCI_MANIFEST,
        digest: attestationDigest,
        size: 839,
        platform: { os: "unknown", architecture: "unknown" },
        annotations: {
          "vnd.docker.reference.digest": runtimeDigest,
          "vnd.docker.reference.type": "attestation-manifest"
        }
      }
    ]
  };
  const indexBytes = jsonBytes(index);
  const indexDigest = sha256Digest(indexBytes);
  return {
    index,
    indexBytes,
    indexDigest,
    runtimeManifest,
    runtimeBytes,
    runtimeDigest,
    attestationDigest,
    configBytes,
    configDigest,
    layerBytes,
    layerDigest,
    imageRef: `${REGISTRY}/${REPOSITORY}@${indexDigest}`
  };
}

type FetchMutation = (input: {
  readonly url: URL;
  readonly method: string;
  readonly response: Response;
}) => Response | Promise<Response>;

function fakeRegistry(mutation?: FetchMutation): RegistryTransportDependencies {
  const data = fixture();
  let clock = 0;
  return {
    now: () => {
      clock += 5;
      return clock;
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      let response: Response;
      if (url.origin === "https://ghcr.io" && url.pathname === "/token") {
        response = new Response(JSON.stringify({ token: "public-pull-token" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      } else if (
        url.pathname === `/v2/${REPOSITORY}/manifests/${data.indexDigest}` &&
        method === "GET"
      ) {
        response = new Response(data.indexBytes, {
          status: 200,
          headers: {
            "content-type": OCI_INDEX,
            "content-length": String(data.indexBytes.byteLength),
            "docker-content-digest": data.indexDigest
          }
        });
      } else if (
        url.pathname === `/v2/${REPOSITORY}/manifests/${data.runtimeDigest}` &&
        method === "GET"
      ) {
        response = new Response(data.runtimeBytes, {
          status: 200,
          headers: {
            "content-type": OCI_MANIFEST,
            "content-length": String(data.runtimeBytes.byteLength),
            "docker-content-digest": data.runtimeDigest
          }
        });
      } else if (
        url.pathname === `/v2/${REPOSITORY}/blobs/${data.configDigest}` &&
        method === "GET"
      ) {
        response = new Response(data.configBytes, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(data.configBytes.byteLength),
            "docker-content-digest": data.configDigest
          }
        });
      } else if (url.pathname === `/v2/${REPOSITORY}/blobs/${data.layerDigest}`) {
        response =
          method === "HEAD"
            ? new Response(null, {
                status: 200,
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": String(data.layerBytes.byteLength),
                  "docker-content-digest": data.layerDigest
                }
              })
            : new Response(data.layerBytes, {
                status: 200,
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": String(data.layerBytes.byteLength),
                  "docker-content-digest": data.layerDigest
                }
              });
      } else {
        response = new Response("missing", { status: 404 });
      }
      return mutation ? mutation({ url, method, response }) : response;
    }
  };
}

describe("Gateway public registry client", () => {
  it("verifies the index, selected child, config, and every runtime layer", async () => {
    const data = fixture();
    const result = await inspectPublicGatewayImage({ imageRef: data.imageRef }, fakeRegistry());

    expect(result).toMatchObject({
      schemaVersion: 1,
      imageRef: data.imageRef,
      releaseIndexDigest: data.indexDigest,
      releaseIndexMediaType: OCI_INDEX,
      runtimeManifestDigest: data.runtimeDigest,
      runtimeManifestMediaType: OCI_MANIFEST,
      configurationDigest: data.configDigest,
      runnablePlatformCount: 1,
      attestationManifestCount: 1,
      runtimeLayerCount: 1,
      totalCompressedBytes: data.layerBytes.byteLength,
      rootfsDiffIds: [`sha256:${"7".repeat(64)}`],
      sourceRevision: SOURCE_COMMIT
    });
    expect(result.layers).toEqual([
      expect.objectContaining({
        descriptorDigest: data.layerDigest,
        headStatus: 200,
        getStatus: 200,
        observedBytes: data.layerBytes.byteLength,
        observedDigest: data.layerDigest
      })
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("public-pull-token");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("sig=");
  });

  it("rejects a digest mismatch while streaming a layer", async () => {
    const data = fixture();
    await expect(
      inspectPublicGatewayImage(
        { imageRef: data.imageRef },
        fakeRegistry(({ url, method, response }) =>
          url.pathname.endsWith(data.layerDigest) && method === "GET"
            ? new Response("tampered-gzip-layer", {
                status: 200,
                headers: {
                  "content-length": String(data.layerBytes.byteLength)
                }
              })
            : response
        )
      )
    ).rejects.toThrow(/SHA-256 did not match/u);
  });

  it("rejects an inconsistent HEAD content length", async () => {
    const data = fixture();
    await expect(
      inspectPublicGatewayImage(
        { imageRef: data.imageRef },
        fakeRegistry(({ url, method, response }) =>
          url.pathname.endsWith(data.layerDigest) && method === "HEAD"
            ? new Response(null, {
                status: 200,
                headers: { "content-length": String(data.layerBytes.byteLength + 1) }
              })
            : response
        )
      )
    ).rejects.toThrow(/content length/u);
  });

  it.each([
    ["HTTP downgrade", "http://objects.example.test/blob"],
    ["credential-bearing URL", "https://user:pass@objects.example.test/blob"]
  ])("rejects an unsafe %s redirect", async (_label, location) => {
    const data = fixture();
    await expect(
      inspectPublicGatewayImage(
        { imageRef: data.imageRef },
        fakeRegistry(({ url, method, response }) =>
          url.pathname.endsWith(data.layerDigest) && method === "HEAD"
            ? new Response(null, { status: 307, headers: { location } })
            : response
        )
      )
    ).rejects.toThrow(/redirect/u);
  });

  it("rejects a missing runtime blob", async () => {
    const data = fixture();
    await expect(
      inspectPublicGatewayImage(
        { imageRef: data.imageRef },
        fakeRegistry(({ url, method, response }) =>
          url.pathname.endsWith(data.layerDigest) && method === "GET"
            ? new Response("missing", { status: 404 })
            : response
        )
      )
    ).rejects.toThrow(/status 404/u);
  });

  it("reports a bounded request timeout without returning request details", async () => {
    const data = fixture();
    const base = fakeRegistry();
    const dependencies: RegistryTransportDependencies = {
      ...base,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(data.layerDigest) && init?.method === "GET") {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return base.fetch(input, init);
      }
    };
    await expect(
      inspectPublicGatewayImage({ imageRef: data.imageRef }, dependencies)
    ).rejects.toThrow("Registry request timed out.");
  });
});
