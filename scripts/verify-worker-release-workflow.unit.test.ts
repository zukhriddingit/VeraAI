import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findWorkerReleaseWorkflowViolations } from "./verify-worker-release-workflow";

const workflow = readFileSync(
  new URL("../.github/workflows/release-worker.yml", import.meta.url),
  "utf8"
);

describe("worker release workflow boundary", () => {
  it("accepts the checked-in operator-only immutable release", () => {
    expect(findWorkerReleaseWorkflowViolations(workflow)).toEqual([]);
  });

  it("rejects automatic execution and mutable action or image references", () => {
    const automatic = workflow.replace("  workflow_dispatch:", "  push:\n  workflow_dispatch:");
    const mutableAction = workflow.replace(
      "docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf",
      "docker/build-push-action@v7"
    );
    const mutableImage = workflow.replace(
      "tags: ${{ env.IMAGE_REPOSITORY }}:${{ github.sha }}",
      "tags: ${{ env.IMAGE_REPOSITORY }}:latest"
    );

    expect(findWorkerReleaseWorkflowViolations(automatic)).toContain(
      "Worker release must not have an automatic event trigger."
    );
    expect(findWorkerReleaseWorkflowViolations(mutableAction)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("full immutable commit"),
        expect.stringContaining("docker/build-push-action must appear exactly")
      ])
    );
    expect(findWorkerReleaseWorkflowViolations(mutableImage)).toContain(
      "Worker release must not use a mutable image, tool, or action reference."
    );
  });

  it("rejects Maritime mutations, repository secrets, and missing evidence gates", () => {
    const maritimeMutation = `${workflow}\n      - run: maritime restart vera-worker\n`;
    const secret = `${workflow}\n      - run: echo \"${"${{ secrets.MARITIME_API_KEY }}"}\"\n`;
    const missingScanGate = workflow.replaceAll("worker-release-evidence.mjs check-scan", "true");

    expect(findWorkerReleaseWorkflowViolations(maritimeMutation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must not mutate or invoke Maritime"),
        expect.stringContaining("must not perform runtime lifecycle mutations")
      ])
    );
    expect(findWorkerReleaseWorkflowViolations(secret)).toContain(
      "Worker release may use only the ephemeral github.token, not repository secrets."
    );
    expect(findWorkerReleaseWorkflowViolations(missingScanGate)).toContain(
      "The zero-exception scan gate is required before signing."
    );
  });

  it("rejects unreviewed actions and scanner suppressions", () => {
    const extraAction = `${workflow}\n      - uses: example/unreviewed@${"a".repeat(40)}\n`;
    const repositoryIgnore = workflow.replaceAll(
      "--ignorefile /dev/null",
      "--ignorefile .trivyignore"
    );
    const ignoredUnfixed = workflow.replace("--ignore-unfixed=false", "--ignore-unfixed");

    expect(findWorkerReleaseWorkflowViolations(extraAction)).toContain(
      "Action example/unreviewed is outside the closed release action allowlist."
    );
    expect(findWorkerReleaseWorkflowViolations(repositoryIgnore)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must not load repository-controlled suppressions"),
        expect.stringContaining("must not use repository suppressions")
      ])
    );
    expect(findWorkerReleaseWorkflowViolations(ignoredUnfixed)).toContain(
      "Release scanning must not ignore unfixed findings."
    );
  });

  it("enforces exact per-job permissions and dependencies", () => {
    const broadenedBuildPermissions = workflow.replace(
      "      packages: write\n    env:\n      IMAGE_REPOSITORY",
      "      packages: write\n      id-token: write\n    env:\n      IMAGE_REPOSITORY"
    );
    const weakenedSigningDependency = workflow.replace(
      "      - acceptance\n      - build_scan",
      "      - build_scan"
    );

    expect(findWorkerReleaseWorkflowViolations(broadenedBuildPermissions)).toContain(
      "Release job build_scan must have its exact least-privilege permissions."
    );
    expect(findWorkerReleaseWorkflowViolations(weakenedSigningDependency)).toContain(
      "Release job sign_attest must have exact needs: acceptance, build_scan."
    );
  });

  it("requires a versioned SPDX predicate derived from the generated SBOM", () => {
    const hardcodedPredicate = workflow
      .replace(
        'SBOM_PREDICATE_TYPE="$(node scripts/worker-release-evidence.mjs predicate-type)"',
        'SBOM_PREDICATE_TYPE="https://spdx.dev/Document"'
      )
      .replace(
        '--predicate-type "$SBOM_PREDICATE_TYPE"',
        "--predicate-type https://spdx.dev/Document"
      );

    expect(findWorkerReleaseWorkflowViolations(hardcodedPredicate)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be derived from the generated SPDX version"),
        expect.stringContaining("derived versioned SPDX predicate type must be used")
      ])
    );
  });
});
