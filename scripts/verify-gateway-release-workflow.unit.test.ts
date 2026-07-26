import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { findGatewayReleaseWorkflowViolations } from "./verify-gateway-release-workflow.ts";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/release-openclaw-gateway.yml"),
  "utf8"
);

describe("Gateway release workflow verifier", () => {
  it("accepts the manual exact-source build, scan, sign, and attestation boundary", () => {
    expect(findGatewayReleaseWorkflowViolations(workflow)).toEqual([]);
  });

  it.each([
    [
      "automatic publication",
      (source: string) => source.replace("  workflow_dispatch:", "  push:\n  workflow_dispatch:"),
      "automatic trigger"
    ],
    [
      "mutable source",
      (source: string) =>
        source.replace(
          '[[ "$REQUESTED_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]',
          'test -n "$REQUESTED_SOURCE_SHA"'
        ),
      "full lowercase source SHA"
    ],
    [
      "another package",
      (source: string) =>
        source.replace(
          "ghcr.io/zukhriddingit/vera-openclaw-gateway",
          "ghcr.io/zukhriddingit/another-package"
        ),
      "approved public package"
    ],
    [
      "vulnerability suppression",
      (source: string) => `${source}\n# --skip-db-update\n`,
      "must not suppress"
    ],
    [
      "deployment command",
      (source: string) => `${source}\n# maritime deploy\n`,
      "must not contain deployment"
    ],
    [
      "unpinned action",
      (source: string) =>
        source.replace(
          "docker/login-action@b45d80f862d83dbcd57f89517bcf500b2ab88fb2",
          "docker/login-action@v4"
        ),
      "not pinned"
    ]
  ])("rejects %s", (_label, mutate, expected) => {
    expect(findGatewayReleaseWorkflowViolations(mutate(workflow))).toEqual(
      expect.arrayContaining([expect.stringMatching(expected)])
    );
  });
});
