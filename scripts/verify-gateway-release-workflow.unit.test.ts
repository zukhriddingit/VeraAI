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
const resumeWorkflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/attest-openclaw-gateway.yml"),
  "utf8"
);

describe("Gateway release workflow verifier", () => {
  it("accepts the manual exact-source build, scan, sign, and attestation boundary", () => {
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, resumeWorkflow)
    ).toEqual([]);
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
    [
      "vulnerability suppression",
      (source: string) => `${source}\n# --skip-db-update\n`,
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
      "missing published image layout verification",
      (source: string) =>
        source.replace("node scripts/verify-gateway-image-layout.mjs", "node -e 'true'"),
      "missing required boundary: node scripts/verify-gateway-image-layout.mjs"
    ],
    [
      "missing simulated provider bootstrap",
      (source: string) => source.replace("            --simulate-bootstrap\n", ""),
      "missing required boundary: --simulate-bootstrap"
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
      "unsupported SLSA build type",
      (source: string) =>
        source.replace(
          "https://actions.github.io/buildtypes/workflow/v1",
          "https://github.com/docker/build-push-action"
        ),
      "required boundary: buildType"
    ],
    [
      "missing GitHub provenance context",
      (source: string) =>
        source.replace(
          /                internalParameters: \{\n                  github: \{[\s\S]*?                  \}\n                \},\n/u,
          "                internalParameters: {},\n"
        ),
      "required boundary: github:"
    ],
    [
      "mutually exclusive attestation identity flags",
      (source: string) =>
        source.replace(
          '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release-openclaw-gateway.yml"',
          '--cert-identity "$CERTIFICATE_IDENTITY" \\\n            --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release-openclaw-gateway.yml"'
        ),
      "must use only the signer-workflow identity selector"
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
    expect(
      findGatewayReleaseWorkflowViolations(mutate(releaseWorkflow), ciWorkflow, resumeWorkflow)
    ).toEqual(expect.arrayContaining([expect.stringMatching(expected)]));
  });

  it("rejects a missing secretless PR Gateway scan", () => {
    const mutatedCi = ciWorkflow.replace("  gateway_image:", "  removed:");
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, mutatedCi, resumeWorkflow)
    ).toEqual(expect.arrayContaining([expect.stringMatching("CI must build and zero-scan")]));
  });

  it("rejects published-image inspection before an exact-digest pull", () => {
    const mutatedRelease = releaseWorkflow.replace(
      '          docker pull "$GATEWAY_IMAGE_REF"\n',
      ""
    );
    expect(
      findGatewayReleaseWorkflowViolations(mutatedRelease, ciWorkflow, resumeWorkflow)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("pull the immutable digest before published-image inspection")
      ])
    );
  });

  it("rejects an exact-digest pull placed after published-image inspection", () => {
    const pull = '          docker pull "$GATEWAY_IMAGE_REF"\n';
    const mutatedRelease = releaseWorkflow
      .replace(pull, "")
      .replace("            --simulate-bootstrap\n", `            --simulate-bootstrap\n${pull}`);
    expect(
      findGatewayReleaseWorkflowViolations(mutatedRelease, ciWorkflow, resumeWorkflow)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("pull the immutable digest before published-image inspection")
      ])
    );
  });

  it("rejects a publication predicate without the exact run-attempt binding", () => {
    const repairedRelease = releaseWorkflow.replace(
      "                    env.GITHUB_RUN_ID\n",
      '                    env.GITHUB_RUN_ID +\n                    "/attempts/" +\n                    env.GITHUB_RUN_ATTEMPT\n'
    );
    const mutatedRelease = repairedRelease.replace(
      '                    env.GITHUB_RUN_ID +\n                    "/attempts/" +\n                    env.GITHUB_RUN_ATTEMPT\n',
      "                    env.GITHUB_RUN_ID\n"
    );
    expect(
      findGatewayReleaseWorkflowViolations(mutatedRelease, ciWorkflow, resumeWorkflow)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("bind provenance to the exact workflow run attempt")
      ])
    );
  });

  it("rejects CI that omits the simulated provider bootstrap layout check", () => {
    const mutatedCi = ciWorkflow.replace("            --simulate-bootstrap\n", "");
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, mutatedCi, resumeWorkflow)
    ).toEqual(expect.arrayContaining([expect.stringMatching("CI must build and zero-scan")]));
  });

  it("rejects a signing resume path that can build or publish another image", () => {
    const mutatedResume = `${resumeWorkflow}
      - uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf
        with:
          push: true
`;
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must never build or publish another candidate")
      ])
    );
  });

  it("rejects signing resume that omits the simulated provider bootstrap layout check", () => {
    const mutatedResume = resumeWorkflow.replace("            --simulate-bootstrap\n", "");
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });

  it("rejects signing resume that reads a different runtime base lock field", () => {
    const mutatedResume = resumeWorkflow.replace(
      ".finalRuntime.linuxAmd64Image",
      ".finalRuntime.imageIndex"
    );
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });

  it("rejects signing resume that does not compare labels to retained lock digests", () => {
    const mutatedResume = resumeWorkflow.replace(
      '            "$expected_runtime_base_digest"',
      '            "sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f"'
    );
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });

  it.each([
    [
      "the reviewed failed-job conclusion",
      '.conclusion == "failure"',
      '.conclusion == "cancelled"'
    ],
    [
      "the successful publication step",
      '"Build and publish the commit-bound Gateway"',
      '"Unreviewed build step"'
    ],
    [
      "the immutable-reference step",
      '"Resolve immutable Gateway reference"',
      '"Unreviewed digest step"'
    ],
    [
      "the failed published-layout step",
      '"Verify minimal published runtime identity"',
      '"Unreviewed failed step"'
    ],
    [
      "the skipped evidence-generation step",
      '"Generate SBOM and vulnerability evidence"',
      '"Unreviewed evidence step"'
    ],
    [
      "the skipped zero-finding step",
      '"Enforce zero unresolved critical or high findings"',
      '"Unreviewed scan step"'
    ],
    [
      "the preserved publication artifact",
      '"Preserve pre-signing Gateway evidence"',
      '"Unreviewed artifact step"'
    ],
    [
      "the pinned Trivy installer",
      "aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567",
      "aquasecurity/setup-trivy@v0.3.1"
    ],
    [
      "the fresh SPDX evidence",
      "release-evidence/gateway/gateway.spdx.json",
      "release-evidence/gateway/gateway.unknown.json"
    ],
    [
      "the fresh vulnerability evidence",
      "release-evidence/gateway/trivy-vulnerabilities.json",
      "release-evidence/gateway/trivy-unknown.json"
    ],
    [
      "the complete HIGH/CRITICAL gate",
      "--severity CRITICAL,HIGH --exit-code 1",
      "--severity CRITICAL --exit-code 1"
    ]
  ])("rejects signing recovery without %s", (_label, before, after) => {
    const mutatedResume = resumeWorkflow.replaceAll(before, after);
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("independently revalidate the existing digest")
      ])
    );
  });

  it.each(["docker build .", "docker buildx build .", "docker push image"])(
    "rejects signing recovery command: %s",
    (command) => {
      const mutatedResume = `${resumeWorkflow}\n# ${command}\n`;
      expect(
        findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
      ).toEqual(
        expect.arrayContaining([
          "Gateway signing resume must never build or publish another candidate."
        ])
      );
    }
  );

  it("rejects signing-resume attestations without the exact workflow identity", () => {
    const mutatedResume = resumeWorkflow.replaceAll(
      '            --certificate-identity "$CERTIFICATE_IDENTITY" \\\n',
      ""
    );
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });

  it("rejects the GitHub attestation action for a pre-merge source commit", () => {
    const mutatedResume = `${resumeWorkflow}
      - uses: actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6
`;
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([expect.stringMatching("must use direct Cosign attestations")])
    );
  });

  it("rejects signing resume without direct Cosign attestations", () => {
    const mutatedResume = resumeWorkflow.replaceAll("cosign attest --yes", "echo skipped");
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });

  it("rejects conflating the publication workflow SHA with the candidate source SHA", () => {
    const mutatedResume = resumeWorkflow
      .replace("--json event,headBranch,headSha,workflowName", "--json event,headSha,workflowName")
      .replace(
        /          test "\$\(jq -r '\.headBranch' <<< "\$run_metadata"\)" = "\$TRUSTED_SOURCE_BRANCH"\n          publication_workflow_sha="\$\(jq -r '\.headSha' <<< "\$run_metadata"\)"\n          \[\[ "\$publication_workflow_sha" =~ \^\[a-f0-9\]\{40\}\$ \]\]\n          git cat-file -e "\$publication_workflow_sha\^\{commit\}"\n          git merge-base --is-ancestor \\\n            "\$publication_workflow_sha" "origin\/\$TRUSTED_SOURCE_BRANCH"\n/u,
        '          test "$(jq -r \'.headSha\' <<< "$run_metadata")" = "$RELEASE_SOURCE_SHA"\n'
      );
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutatedResume)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must not conflate the publication workflow commit")
      ])
    );
  });

  it.each([
    [
      "claims the publication workflow as the signer",
      (source: string) =>
        source.replace(
          'path: ".github/workflows/attest-openclaw-gateway.yml"',
          'path: ".github/workflows/release-openclaw-gateway.yml"'
        )
    ],
    [
      "uses the subject source as the workflow commit",
      (source: string) =>
        source.replace(
          '--arg workflowCommit "$GITHUB_SHA"',
          '--arg workflowCommit "$RELEASE_SOURCE_SHA"'
        )
    ],
    [
      "uses a fabricated builder identity",
      (source: string) =>
        source.replace(
          '--arg workflowRef "$GITHUB_WORKFLOW_REF"',
          '--arg workflowRef "owner/repo/.github/workflows/fake.yml@refs/heads/main"'
        )
    ],
    [
      "duplicates the repository in the builder identity",
      (source: string) =>
        source.replace(
          'builder: { id: ($serverUrl + "/" + $workflowRef) }',
          'builder: { id: ($sourceRepository + "/" + $workflowRef) }'
        )
    ],
    [
      "drops the run-attempt binding",
      (source: string) =>
        source.replace("$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT", "$GITHUB_RUN_ID")
    ],
    [
      "drops the original publication evidence",
      (source: string) => source.replace("publicationEvidence:", "removedPublicationEvidence:")
    ],
    [
      "drops the exact subject source binding",
      (source: string) =>
        source.replace("sourceCommit: $sourceCommit", "removedSourceCommit: $sourceCommit")
    ]
  ])("rejects a signing resume predicate that %s", (_label, mutate) => {
    expect(
      findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutate(resumeWorkflow))
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching("must bind the existing zero-finding digest and evidence")
      ])
    );
  });
});
