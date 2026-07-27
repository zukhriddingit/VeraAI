import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { findGatewayRuntimeAttestationWorkflowViolations } from "./verify-gateway-runtime-attestation-workflow.ts";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/attest-openclaw-gateway-runtime.yml"),
  "utf8"
);

describe("existing Gateway runtime attestation workflow verifier", () => {
  it("accepts exact-child recovery only after anonymous zero-scan verification", () => {
    expect(findGatewayRuntimeAttestationWorkflowViolations(workflow)).toEqual([]);
  });

  it.each([
    [
      "an automatic trigger",
      (source: string) => source.replace("  workflow_dispatch:", "  push:\n  workflow_dispatch:"),
      /manual-only/u
    ],
    [
      "a mutable child input",
      (source: string) =>
        source.replace(
          '[[ "$REQUESTED_RUNTIME_MANIFEST_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]',
          'test -n "$REQUESTED_RUNTIME_MANIFEST_DIGEST"'
        ),
      /bind and revalidate/u
    ],
    [
      "missing parent-child registry inspection",
      (source: string) => source.replace("pnpm inspect:gateway-registry --", "true # removed"),
      /bind and revalidate/u
    ],
    [
      "an unverified evidence workflow identity",
      (source: string) =>
        source.replace(
          '"Attest existing zero-finding Vera OpenClaw Gateway"',
          '"Release immutable Vera OpenClaw Gateway"'
        ),
      /bind and revalidate/u
    ],
    [
      "a source-scan artifact instead of the verified index attestation",
      (source: string) =>
        source.replace(
          "vera-openclaw-gateway-attestation-${{ steps.subject.outputs.release_index_hex }}",
          "vera-openclaw-gateway-scan-${{ steps.subject.outputs.source_sha }}"
        ),
      /bind and revalidate/u
    ],
    [
      "login before zero scan",
      (source: string) => {
        const login = source.match(
          /      - name: Sign in to GitHub Container Registry after verification[\s\S]*?(?=\n      - name: Create exact-child provenance predicate)/u
        )?.[0];
        return login
          ? source
              .replace(`${login}\n`, "")
              .replace(
                "      - name: Install pinned Trivy",
                `${login}\n\n      - name: Install pinned Trivy`
              )
          : source;
      },
      /precede every registry write/u
    ],
    ["a Docker build", (source: string) => `${source}\n# docker build .\n`, /never build/u],
    ["an image push", (source: string) => `${source}\n# docker push image\n`, /never build/u],
    [
      "weakened scan",
      (source: string) =>
        source.replace(
          "--severity CRITICAL,HIGH --exit-code 1",
          "--severity CRITICAL --exit-code 1"
        ),
      /bind and revalidate/u
    ],
    [
      "a different attestation subject",
      (source: string) =>
        source.replace(
          "subject-digest: ${{ steps.subject.outputs.runtime_manifest_digest }}",
          "subject-digest: ${{ steps.subject.outputs.release_index_digest }}"
        ),
      /subject only/u
    ],
    [
      "an unpinned action",
      (source: string) => `${source}\n# uses: actions/checkout@v6\n`,
      /not commit-pinned/u
    ],
    [
      "a Maritime deployment",
      (source: string) => `${source}\n# maritime deploy agent\n`,
      /must not deploy/u
    ],
    [
      "suppressed vulnerabilities",
      (source: string) => `${source}\n# --skip-db-update\n`,
      /must not suppress/u
    ]
  ])("rejects %s", (_label, mutate, message) => {
    expect(findGatewayRuntimeAttestationWorkflowViolations(mutate(workflow)).join(" ")).toMatch(
      message
    );
  });
});
