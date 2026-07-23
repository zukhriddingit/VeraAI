import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_ACTIONS: ReadonlyMap<string, { readonly commit: string; readonly count: number }> =
  new Map([
    ["actions/checkout", { commit: "de0fac2e4500dabe0009e67214ff5f5447ce83dd", count: 3 }],
    ["pnpm/action-setup", { commit: "b906affcce14559ad1aafd4ab0e942779e9f58b1", count: 1 }],
    ["actions/setup-node", { commit: "249970729cb0ef3589644e2896645e5dc5ba9c38", count: 1 }],
    ["docker/login-action", { commit: "b45d80f862d83dbcd57f89517bcf500b2ab88fb2", count: 2 }],
    [
      "docker/setup-buildx-action",
      { commit: "4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd", count: 1 }
    ],
    ["docker/build-push-action", { commit: "f9f3042f7e2789586610d6e8b85c8f03e5195baf", count: 1 }],
    ["aquasecurity/setup-trivy", { commit: "81e514348e19b6112ce2a7e3ecbafe19c1e1f567", count: 1 }],
    ["actions/upload-artifact", { commit: "ea165f8d65b6e75b540449e92b4886f43607fa02", count: 2 }],
    ["actions/download-artifact", { commit: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", count: 1 }],
    ["actions/attest", { commit: "f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6", count: 2 }],
    ["sigstore/cosign-installer", { commit: "6f9f17788090df1f26f669e9d70d6ae9567deba6", count: 1 }]
  ]);

const ACTION_REFERENCE = /^\s*-?\s*uses:\s*([^\s@]+)@([^\s#]+)(?:\s+#.*)?$/gmu;

interface WorkflowJobBoundary {
  readonly needs: readonly string[];
  readonly permissions: Readonly<Record<string, string>>;
}

const EXPECTED_JOB_BOUNDARIES: Readonly<Record<string, WorkflowJobBoundary>> = {
  acceptance: {
    needs: [],
    permissions: { contents: "read" }
  },
  build_scan: {
    needs: ["acceptance"],
    permissions: { contents: "read", packages: "write" }
  },
  sign_attest: {
    needs: ["acceptance", "build_scan"],
    permissions: {
      contents: "read",
      packages: "write",
      "id-token": "write",
      attestations: "write"
    }
  }
};

function parseJobBoundaries(
  workflow: string,
  violations: string[]
): Map<string, WorkflowJobBoundary> {
  const lines = workflow.split(/\r?\n/u);
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  const jobs = new Map<string, WorkflowJobBoundary>();
  if (jobsLine < 0) {
    violations.push("Worker release must define a top-level jobs mapping.");
    return jobs;
  }

  for (let index = jobsLine + 1; index < lines.length;) {
    const jobMatch = /^  ([a-z][a-z0-9_]*):$/u.exec(lines[index] ?? "");
    if (!jobMatch?.[1]) {
      index += 1;
      continue;
    }
    const jobName = jobMatch[1];
    const start = index + 1;
    let end = start;
    while (end < lines.length && !/^  [a-z][a-z0-9_]*:$/u.test(lines[end] ?? "")) end += 1;
    const jobLines = lines.slice(start, end);
    const permissions: Record<string, string> = {};
    const needs: string[] = [];

    for (let offset = 0; offset < jobLines.length; offset += 1) {
      const line = jobLines[offset] ?? "";
      const inlineNeeds = /^    needs:\s*([a-z][a-z0-9_]*)$/u.exec(line);
      if (inlineNeeds?.[1]) needs.push(inlineNeeds[1]);
      if (line === "    needs:") {
        for (let child = offset + 1; child < jobLines.length; child += 1) {
          const item = /^      - ([a-z][a-z0-9_]*)$/u.exec(jobLines[child] ?? "");
          if (!item?.[1]) break;
          needs.push(item[1]);
        }
      }
      if (line === "    permissions:") {
        for (let child = offset + 1; child < jobLines.length; child += 1) {
          const entry = /^      ([a-z-]+):\s*(read|write|none)$/u.exec(jobLines[child] ?? "");
          if (!entry?.[1] || !entry[2]) break;
          permissions[entry[1]] = entry[2];
        }
      }
    }
    jobs.set(jobName, { needs, permissions });
    index = end;
  }
  return jobs;
}

function validateJobBoundaries(workflow: string, violations: string[]): void {
  const observed = parseJobBoundaries(workflow, violations);
  const expectedNames = Object.keys(EXPECTED_JOB_BOUNDARIES);
  for (const name of observed.keys()) {
    if (!expectedNames.includes(name)) {
      violations.push(`Release job ${name} is outside the closed job allowlist.`);
    }
  }
  for (const [name, expected] of Object.entries(EXPECTED_JOB_BOUNDARIES)) {
    const job = observed.get(name);
    if (!job) {
      violations.push(`Release job ${name} is required.`);
      continue;
    }
    if (JSON.stringify(job.needs) !== JSON.stringify(expected.needs)) {
      violations.push(
        `Release job ${name} must have exact needs: ${expected.needs.join(", ") || "none"}.`
      );
    }
    if (JSON.stringify(job.permissions) !== JSON.stringify(expected.permissions)) {
      violations.push(`Release job ${name} must have its exact least-privilege permissions.`);
    }
  }
}

function requireText(
  workflow: string,
  expected: string,
  message: string,
  violations: string[]
): void {
  if (!workflow.includes(expected)) violations.push(message);
}

function countText(value: string, expected: string): number {
  return value.split(expected).length - 1;
}

export function findWorkerReleaseWorkflowViolations(workflow: string): string[] {
  const violations: string[] = [];

  requireText(
    workflow,
    "on:\n  workflow_dispatch:",
    "Worker release must be explicitly operator-dispatched.",
    violations
  );
  validateJobBoundaries(workflow, violations);
  if (/^\s{2}(?:push|pull_request|schedule|workflow_run):/mu.test(workflow)) {
    violations.push("Worker release must not have an automatic event trigger.");
  }

  requireText(
    workflow,
    "permissions: {}",
    "Worker release must deny permissions by default.",
    violations
  );
  for (const permission of [
    "contents: read",
    "packages: write",
    "id-token: write",
    "attestations: write"
  ]) {
    requireText(workflow, permission, `Worker release requires ${permission}.`, violations);
  }

  const observedActions = new Map<string, string[]>();
  for (const match of workflow.matchAll(ACTION_REFERENCE)) {
    const name = match[1];
    const reference = match[2];
    if (!name || !reference) continue;
    observedActions.set(name, [...(observedActions.get(name) ?? []), reference]);
    if (!/^[a-f0-9]{40}$/u.test(reference)) {
      violations.push(`Action ${name} must be pinned to a full immutable commit.`);
    }
  }
  for (const name of observedActions.keys()) {
    if (!REQUIRED_ACTIONS.has(name)) {
      violations.push(`Action ${name} is outside the closed release action allowlist.`);
    }
  }
  for (const [name, expected] of REQUIRED_ACTIONS) {
    const references = observedActions.get(name) ?? [];
    if (
      references.length !== expected.count ||
      references.some((value) => value !== expected.commit)
    ) {
      violations.push(
        `Action ${name} must appear exactly ${expected.count} time(s) at ${expected.commit}.`
      );
    }
  }

  for (const [expected, message] of [
    [
      "tags: ${{ env.IMAGE_REPOSITORY }}:${{ github.sha }}",
      "The pushed tag must be the full release commit."
    ],
    ["provenance: mode=max", "BuildKit maximum provenance must be enabled."],
    ["sbom: true", "BuildKit SBOM attestation must be enabled."],
    ["version: v0.72.0", "Trivy must be pinned to v0.72.0."],
    ["--config /dev/null", "Trivy must not load repository-controlled configuration."],
    ["--ignorefile /dev/null", "Trivy must not load repository-controlled suppressions."],
    ["--list-all-pkgs", "Trivy must retain package coverage evidence."],
    ["--format spdx-json", "The workflow must export a reviewable SPDX JSON SBOM."],
    ["--severity CRITICAL,HIGH", "The worker scan must cover both critical and high findings."],
    [
      "worker-release-evidence.mjs check-scan",
      "The zero-exception scan gate is required before signing."
    ],
    [
      'cosign sign --yes "$WORKER_IMAGE_REF"',
      "The digest-qualified worker image must be keylessly signed."
    ],
    [
      'cosign verify "$WORKER_IMAGE_REF"',
      "The worker signature must be verified in the release job."
    ],
    [
      'gh attestation verify "oci://$WORKER_IMAGE_REF"',
      "GitHub provenance and SBOM attestations must be verified."
    ],
    [
      "worker-release-evidence.mjs predicate-type",
      "The GitHub SBOM predicate type must be derived from the generated SPDX version."
    ],
    [
      '--predicate-type "$SBOM_PREDICATE_TYPE"',
      "The derived versioned SPDX predicate type must be used for verification."
    ],
    ['--source-digest "$GITHUB_SHA"', "Provenance verification must bind the source commit."],
    ["worker-release-evidence.mjs write", "The workflow must write sanitized release evidence."],
    ["pnpm test", "Release publication must be gated by the deterministic test suite."],
    ["pnpm test:integration:postgres", "Release publication must be gated by PostgreSQL tests."],
    ["pnpm build", "Release publication must be gated by production builds."],
    ["needs: acceptance", "Worker build must require the acceptance job."],
    ["- build_scan", "Signing must require the completed build-and-scan job."],
    [
      "create-storage-record: false",
      "User-owned repositories must disable organization-only storage records."
    ],
    ["permissions: {}", "Release permissions must be denied by default."]
  ] as const) {
    requireText(workflow, expected, message, violations);
  }
  if (countText(workflow, "create-storage-record: false") !== 2) {
    violations.push(
      "Both provenance and SBOM attestations must disable organization storage records."
    );
  }
  if (countText(workflow, "if: always()") !== 2) {
    violations.push("Both pre-signing and final release reports must upload on failure.");
  }
  if (/artifact-metadata:\s*write/u.test(workflow)) {
    violations.push("User-owned repository release must not request artifact-metadata write.");
  }
  if (/\.trivyignore|trivy\.ya?ml|--ignore-policy|--skip-db-update/iu.test(workflow)) {
    violations.push(
      "Release scanning must not use repository suppressions or stale database flags."
    );
  }
  if (/--ignore-unfixed(?:\s|$)/mu.test(workflow)) {
    violations.push("Release scanning must not ignore unfixed findings.");
  }

  if (/\b(?:latest|main|master)\b/iu.test(workflow.replace(/^\s*#.*$/gmu, ""))) {
    violations.push("Worker release must not use a mutable image, tool, or action reference.");
  }
  if (/\$\{\{\s*secrets\./u.test(workflow)) {
    violations.push(
      "Worker release may use only the ephemeral github.token, not repository secrets."
    );
  }
  const runtimeMutationScan = workflow
    .replaceAll("pnpm verify:maritime-boundaries", "")
    .replaceAll("pnpm maritime:validate", "");
  if (/\bmaritime\b|api\.maritime\.sh|maritime\.sh\/api/iu.test(runtimeMutationScan)) {
    violations.push("The artifact release workflow must not mutate or invoke Maritime.");
  }
  if (
    /\b(?:deploy|restart|start|stop|trigger|pair)\b/iu.test(workflow.replace(/^\s*#.*$/gmu, ""))
  ) {
    violations.push("The artifact release workflow must not perform runtime lifecycle mutations.");
  }

  return violations;
}

async function main(): Promise<void> {
  const workflowPath = resolve(".github/workflows/release-worker.yml");
  const workflow = await readFile(workflowPath, "utf8");
  const violations = findWorkerReleaseWorkflowViolations(workflow);
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Operator-controlled worker release workflow validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
