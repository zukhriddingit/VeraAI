import { describe, expect, it, vi } from "vitest";

import type { GatewayRegistryInspection } from "./gateway-registry-client.ts";
import {
  parseGatewayRegistryArguments,
  runGatewayRegistryInspection
} from "./inspect-gateway-registry.ts";

const CURRENT =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4";
const PREVIOUS =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3";

describe("Gateway registry inspection arguments", () => {
  it("accepts two immutable indexes and a configured private output", () => {
    expect(
      parseGatewayRegistryArguments(
        [
          "--current-index",
          CURRENT,
          "--previous-index",
          PREVIOUS,
          "--output",
          "release-evidence/private/r3/inspection.json"
        ],
        { workspaceRoot: "/workspace" }
      )
    ).toEqual({
      currentIndex: CURRENT,
      previousIndex: PREVIOUS,
      outputPath: "/workspace/release-evidence/private/r3/inspection.json"
    });
  });

  it.each([
    ["missing argument", ["--current-index", CURRENT]],
    [
      "mutable reference",
      [
        "--current-index",
        "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest",
        "--previous-index",
        PREVIOUS,
        "--output",
        "release-evidence/private/r3/inspection.json"
      ]
    ],
    [
      "wrong repository",
      [
        "--current-index",
        CURRENT.replace("zukhriddingit", "someone-else"),
        "--previous-index",
        PREVIOUS,
        "--output",
        "release-evidence/private/r3/inspection.json"
      ]
    ],
    [
      "duplicate option",
      [
        "--current-index",
        CURRENT,
        "--current-index",
        PREVIOUS,
        "--output",
        "release-evidence/private/r3/inspection.json"
      ]
    ],
    [
      "outside configured directory",
      [
        "--current-index",
        CURRENT,
        "--previous-index",
        PREVIOUS,
        "--output",
        "output/inspection.json"
      ]
    ],
    [
      "same current and previous index",
      [
        "--current-index",
        CURRENT,
        "--previous-index",
        CURRENT,
        "--output",
        "release-evidence/private/r3/inspection.json"
      ]
    ]
  ])("rejects %s", (_label, args) => {
    expect(() => parseGatewayRegistryArguments(args, { workspaceRoot: "/workspace" })).toThrow();
  });
});

describe("Gateway registry inspection command", () => {
  it("writes only the closed comparison and prints a sanitized status", async () => {
    const current = {
      releaseIndexDigest: CURRENT.split("@")[1],
      runtimeManifestDigest: `sha256:${"b".repeat(64)}`,
      runtimeDescriptor: { digest: `sha256:${"b".repeat(64)}` },
      runnablePlatformCount: 1,
      attestationManifestCount: 1,
      releaseIndexMediaType: "application/vnd.oci.image.index.v1+json",
      runtimeManifestMediaType: "application/vnd.oci.image.manifest.v1+json",
      runtimeLayerCount: 1,
      totalCompressedBytes: 10,
      configurationDigest: `sha256:${"c".repeat(64)}`,
      runtimeManifest: {
        config: { size: 5 },
        layers: [{ digest: `sha256:${"d".repeat(64)}` }]
      },
      rootfsDiffIds: [`sha256:${"e".repeat(64)}`]
    } as unknown as GatewayRegistryInspection;
    const previous = {
      ...structuredClone(current),
      releaseIndexDigest: PREVIOUS.split("@")[1],
      runtimeManifestDigest: `sha256:${"1".repeat(64)}`,
      runtimeDescriptor: { digest: `sha256:${"1".repeat(64)}` }
    } as unknown as GatewayRegistryInspection;
    const writeOutput = vi.fn(async () => undefined);
    const stdout = vi.fn();
    const result = await runGatewayRegistryInspection(
      {
        currentIndex: CURRENT,
        previousIndex: PREVIOUS,
        outputPath: "/workspace/release-evidence/private/r3/inspection.json"
      },
      {
        inspect: vi.fn(async ({ imageRef }) => (imageRef === CURRENT ? current : previous)),
        writeOutput,
        stdout
      }
    );
    expect(Object.keys(result).sort()).toEqual([
      "current",
      "previous",
      "schemaVersion",
      "structuralDiff"
    ]);
    expect(writeOutput).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith(
      '{"outcome":"passed","runnablePlatformCount":1,"attestationManifestCount":1}\n'
    );
    expect(JSON.stringify(result)).not.toContain("authorization");
    expect(JSON.stringify(result)).not.toContain("sig=");
  });

  it("rejects a child that does not match the index descriptor", async () => {
    const invalid = {
      releaseIndexDigest: CURRENT.split("@")[1],
      runtimeManifestDigest: `sha256:${"b".repeat(64)}`,
      runtimeDescriptor: { digest: `sha256:${"c".repeat(64)}` }
    } as unknown as GatewayRegistryInspection;
    await expect(
      runGatewayRegistryInspection(
        {
          currentIndex: CURRENT,
          previousIndex: PREVIOUS,
          outputPath: "/workspace/release-evidence/private/r3/inspection.json"
        },
        {
          inspect: vi.fn(async () => invalid),
          writeOutput: vi.fn(async () => undefined),
          stdout: vi.fn()
        }
      )
    ).rejects.toThrow(/does not match/u);
  });
});
