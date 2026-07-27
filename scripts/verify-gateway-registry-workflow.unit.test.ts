import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { findGatewayRegistryWorkflowViolations } from "./verify-gateway-registry-workflow.ts";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/verify-openclaw-gateway-registry.yml"),
  "utf8"
);

describe("Gateway public registry workflow verifier", () => {
  it("accepts the anonymous, non-publishing GitHub-hosted verification", () => {
    expect(findGatewayRegistryWorkflowViolations(workflow)).toEqual([]);
  });

  it.each([
    ["a registry secret", "\n# secrets.GHCR_PUBLISH_TOKEN\n", /authority/u],
    ["an image push", "\n# docker push image\n", /must not build or publish/u],
    ["a Maritime side effect", "\n# maritime deploy agent\n", /deployment/u],
    ["a mutable image", "\n# ghcr.io/zukhriddingit/vera-openclaw-gateway:latest\n", /mutable/u],
    ["suppressed upload failure", "\n# if-no-files-found: warn\n", /must fail/u],
    ["unbounded runtime", "\n# timeout-minutes: 0\n", /bounded/u],
    ["automatic dispatch", "\n  workflow_dispatch:\n", /pull-request trigger/u],
    ["an unpinned action", "\n# uses: actions/checkout@v6\n", /not commit-pinned/u]
  ])("rejects %s", (_label, injected, message) => {
    expect(findGatewayRegistryWorkflowViolations(`${workflow}${injected}`).join(" ")).toMatch(
      message
    );
  });
});
