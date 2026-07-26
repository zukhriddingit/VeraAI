import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ACTIONS = new Map([
  ["actions/checkout", { commit: "de0fac2e4500dabe0009e67214ff5f5447ce83dd", count: 2 }],
  ["docker/login-action", { commit: "b45d80f862d83dbcd57f89517bcf500b2ab88fb2", count: 1 }],
  ["docker/setup-buildx-action", { commit: "4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd", count: 1 }],
  ["docker/build-push-action", { commit: "f9f3042f7e2789586610d6e8b85c8f03e5195baf", count: 1 }],
  ["aquasecurity/setup-trivy", { commit: "81e514348e19b6112ce2a7e3ecbafe19c1e1f567", count: 1 }],
  ["actions/upload-artifact", { commit: "ea165f8d65b6e75b540449e92b4886f43607fa02", count: 2 }],
  ["actions/download-artifact", { commit: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", count: 1 }],
  ["actions/attest", { commit: "f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6", count: 2 }],
  ["sigstore/cosign-installer", { commit: "6f9f17788090df1f26f669e9d70d6ae9567deba6", count: 1 }]
]);

function requireText(
  workflow: string,
  expected: string,
  message: string,
  violations: string[]
): void {
  if (!workflow.includes(expected)) violations.push(message);
}

export function findGatewayReleaseWorkflowViolations(workflow: string): string[] {
  const violations: string[] = [];

  requireText(workflow, "  workflow_dispatch:", "Gateway release must be manual-only.", violations);
  if (/^\s{2}(?:push|pull_request|schedule|repository_dispatch|workflow_run):/mu.test(workflow)) {
    violations.push("Gateway release must not have an automatic trigger.");
  }
  requireText(
    workflow,
    "source_sha:",
    "Gateway release must accept an exact source SHA.",
    violations
  );
  requireText(
    workflow,
    '[[ "$REQUESTED_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]',
    "Gateway release must validate a full lowercase source SHA.",
    violations
  );
  requireText(
    workflow,
    "git merge-base --is-ancestor",
    "Gateway release must require source ancestry from the reviewed branch.",
    violations
  );
  requireText(
    workflow,
    '"origin/$TRUSTED_SOURCE_BRANCH"',
    "Gateway release must bind ancestry to the reviewed remote branch.",
    violations
  );
  requireText(
    workflow,
    'git checkout --detach "$REQUESTED_SOURCE_SHA"',
    "Gateway release must check out the exact source SHA.",
    violations
  );
  requireText(
    workflow,
    "IMAGE_REPOSITORY: ghcr.io/zukhriddingit/vera-openclaw-gateway",
    "Gateway release must target only the approved public package.",
    violations
  );
  requireText(
    workflow,
    "file: infra/maritime/openclaw/remote-extension.Dockerfile",
    "Gateway release must use the repaired Gateway Dockerfile.",
    violations
  );
  for (const required of [
    "VERA_SOURCE_COMMIT=${{ steps.source.outputs.source_sha }}",
    "org.opencontainers.image.created=",
    "org.opencontainers.image.revision=",
    "org.opencontainers.image.source=",
    "org.opencontainers.image.title=",
    "provenance: mode=max",
    "sbom: true",
    "--severity CRITICAL,HIGH --exit-code 1",
    "cosign sign --yes",
    "cosign verify",
    "predicate-type: https://slsa.dev/provenance/v1",
    "sbom-path: release-evidence/gateway/gateway.spdx.json",
    "Published immutable Gateway:"
  ]) {
    requireText(
      workflow,
      required,
      `Gateway release is missing required boundary: ${required}`,
      violations
    );
  }
  if (/\.trivyignore|--ignore-policy|--skip-db-update|--ignore-unfixed=true/iu.test(workflow)) {
    violations.push(
      "Gateway release must not suppress vulnerability findings or database updates."
    );
  }
  if (
    /\bmaritime\s+(?:create|deploy|restart|stop|delete|env|trigger)\b|\bkubectl\b|\bhelm\b|\bvercel\b|gh release|\bdocker service\b/iu.test(
      workflow
    )
  ) {
    violations.push("Gateway release must not contain deployment or release side effects.");
  }

  const actionMatches = [
    ...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s@]+)@([^\s#]+)(?:\s+#.*)?$/gmu)
  ];
  for (const match of actionMatches) {
    const action = match[1];
    const commit = match[2];
    const expected = action ? ACTIONS.get(action) : undefined;
    if (!action || !expected || commit !== expected.commit) {
      violations.push(
        `Gateway release action ${action ?? "unknown"} is not pinned to its reviewed commit.`
      );
    }
  }
  for (const [action, expected] of ACTIONS) {
    const count = actionMatches.filter((match) => match[1] === action).length;
    if (count !== expected.count) {
      violations.push(
        `Gateway release action ${action} must appear exactly ${expected.count} time(s).`
      );
    }
  }

  return violations;
}

export function verifyGatewayReleaseWorkflow(root = resolve(import.meta.dirname, "..")): void {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/release-openclaw-gateway.yml"),
    "utf8"
  );
  const violations = findGatewayReleaseWorkflowViolations(workflow);
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyGatewayReleaseWorkflow();
  process.stdout.write("Gateway release workflow boundaries verified.\n");
}
