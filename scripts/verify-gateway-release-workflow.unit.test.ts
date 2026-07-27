import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { findGatewayReleaseWorkflowViolations } from "./verify-gateway-release-workflow.ts";

const releaseWorkflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/release-openclaw-gateway.yml"),
  "utf8"
);
const ciWorkflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/ci.yml"),
  "utf8"
);

describe("Gateway release workflow verifier", () => {
  it("accepts the manual exact-source build, scan, sign, and attestation boundary", () => {
    expect(findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow)).toEqual([]);
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
      "repository token for the existing unlinked package",
      (source: string) =>
        source.replace(
          "password: ${{ secrets.GHCR_PUBLISH_TOKEN }}",
          "password: ${{ github.token }}"
        ),
      "must not use the repository token"
    ],
    [
      "ignore-unfixed vulnerability suppression",
      (source: string) => `${source}\n# --ignore-unfixed=true\n`,
      "must not suppress"
    ],
    ["Trivy ignore file", (source: string) => `${source}\n# .trivyignore\n`, "must not suppress"],
    [
      "weakened scan severity",
      (source: string) =>
        source.replace(
          "--severity CRITICAL,HIGH --exit-code 1",
          "--severity CRITICAL --exit-code 1"
        ),
      "zero-finding scan must include both CRITICAL and HIGH"
    ],
    [
      "missing runtime-lock artifact",
      (source: string) =>
        source
          .replace(
            /          cp infra\/maritime\/openclaw\/remote-extension-runtime-lock\.json \\\n            release-evidence\/gateway\/remote-extension-runtime-lock\.json\n/u,
            ""
          )
          .replace(
            /          sha256sum release-evidence\/gateway\/remote-extension-runtime-lock\.json \\\n            > release-evidence\/gateway\/remote-extension-runtime-lock\.sha256\n/u,
            ""
          ),
      "runtime lock and its SHA-256"
    ],
    [
      "signing without successful scan dependency",
      (source: string) =>
        source.replace("if: needs.build_scan.result == 'success'", "if: always()"),
      "only after the zero-finding scan succeeds"
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
    expect(findGatewayReleaseWorkflowViolations(mutate(releaseWorkflow), ciWorkflow)).toEqual(
      expect.arrayContaining([expect.stringMatching(expected)])
    );
  });

  it("rejects a missing secretless PR Gateway scan", () => {
    const mutatedCi = ciWorkflow.replace("  gateway_image:", "  removed:");
    expect(findGatewayReleaseWorkflowViolations(releaseWorkflow, mutatedCi)).toEqual(
      expect.arrayContaining([expect.stringMatching("CI must build and zero-scan")])
    );
  });
});
