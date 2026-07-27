import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ACTIONS = new Map([
  ["actions/checkout", { commit: "de0fac2e4500dabe0009e67214ff5f5447ce83dd", count: 2 }],
  ["pnpm/action-setup", { commit: "b906affcce14559ad1aafd4ab0e942779e9f58b1", count: 1 }],
  ["actions/setup-node", { commit: "a0853c24544627f65ddf259abe73b1d18a591444", count: 1 }],
  ["docker/login-action", { commit: "b45d80f862d83dbcd57f89517bcf500b2ab88fb2", count: 2 }],
  ["docker/setup-buildx-action", { commit: "4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd", count: 1 }],
  ["docker/build-push-action", { commit: "f9f3042f7e2789586610d6e8b85c8f03e5195baf", count: 1 }],
  ["aquasecurity/setup-trivy", { commit: "81e514348e19b6112ce2a7e3ecbafe19c1e1f567", count: 1 }],
  ["actions/upload-artifact", { commit: "ea165f8d65b6e75b540449e92b4886f43607fa02", count: 2 }],
  ["actions/download-artifact", { commit: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", count: 1 }],
  ["actions/attest", { commit: "f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6", count: 2 }],
  ["sigstore/cosign-installer", { commit: "6f9f17788090df1f26f669e9d70d6ae9567deba6", count: 1 }]
]);
const RESUME_ACTIONS = new Map([
  ["actions/checkout", { commit: "de0fac2e4500dabe0009e67214ff5f5447ce83dd", count: 1 }],
  ["actions/download-artifact", { commit: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", count: 1 }],
  ["docker/login-action", { commit: "b45d80f862d83dbcd57f89517bcf500b2ab88fb2", count: 1 }],
  ["actions/attest", { commit: "f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6", count: 2 }],
  ["sigstore/cosign-installer", { commit: "6f9f17788090df1f26f669e9d70d6ae9567deba6", count: 1 }],
  ["actions/upload-artifact", { commit: "ea165f8d65b6e75b540449e92b4886f43607fa02", count: 1 }]
]);

function requireText(
  workflow: string,
  expected: string,
  message: string,
  violations: string[]
): void {
  if (!workflow.includes(expected)) violations.push(message);
}

export function findGatewayReleaseWorkflowViolations(
  workflow: string,
  ciWorkflow: string,
  resumeWorkflow: string
): string[] {
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
    "TRUSTED_SOURCE_BRANCH: main",
    "Gateway replacement publication must use only merged main.",
    violations
  );
  requireText(
    workflow,
    "github.ref == 'refs/heads/main'",
    "Gateway replacement publication must dispatch only from merged main.",
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
    "password: ${{ secrets.GHCR_PUBLISH_TOKEN }}",
    "Gateway release must use the temporary package-write credential for the existing unlinked package.",
    violations
  );
  if (workflow.includes("password: ${{ github.token }}")) {
    violations.push(
      "Gateway release must not use the repository token for the existing unlinked package."
    );
  }
  if (workflow.includes("--cert-identity")) {
    violations.push(
      "Gateway attestation verification must use only the signer-workflow identity selector."
    );
  }
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
    "node scripts/verify-gateway-image-layout.mjs",
    "--simulate-bootstrap",
    "--severity CRITICAL,HIGH --exit-code 1",
    "cosign sign --yes",
    "cosign verify",
    "predicate-type: https://slsa.dev/provenance/v1",
    'buildType: "https://actions.github.io/buildtypes/workflow/v1"',
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
  requireText(
    workflow,
    "name: Verify minimal published runtime identity",
    "Gateway release must verify the published runtime identity before scanning.",
    violations
  );
  for (const verifier of [
    "pnpm verify:gateway-runtime-supply-chain",
    "pnpm verify:remote-extension-config"
  ]) {
    requireText(
      workflow,
      verifier,
      `Gateway release must run exact-source verifier: ${verifier}`,
      violations
    );
  }
  if (
    !workflow.includes("cp infra/maritime/openclaw/remote-extension-runtime-lock.json") ||
    !workflow.includes("sha256sum release-evidence/gateway/remote-extension-runtime-lock.json") ||
    !workflow.includes(
      "sha256sum --check \\\n            release-evidence/gateway/remote-extension-runtime-lock.sha256"
    ) ||
    !workflow.includes(
      "infra/maritime/openclaw/remote-extension-runtime-lock.json \\\n            release-evidence/gateway/remote-extension-runtime-lock.json"
    )
  ) {
    violations.push("Gateway release evidence must preserve the runtime lock and its SHA-256.");
  }
  if (!workflow.includes("--severity CRITICAL,HIGH --exit-code 1")) {
    violations.push("Gateway zero-finding scan must include both CRITICAL and HIGH severities.");
  }
  if (
    !workflow.includes("needs: build_scan") ||
    !workflow.includes("if: needs.build_scan.result == 'success'") ||
    workflow.indexOf("sign_attest:") <
      workflow.indexOf("Enforce zero unresolved critical or high findings")
  ) {
    violations.push(
      "Gateway signing and attestation may run only after the zero-finding scan succeeds."
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

  const ciBoundaryMessage = "Gateway CI must build and zero-scan a secretless local image.";
  for (const required of [
    "  gateway_image:",
    "name: Build and zero-scan Gateway image",
    "runs-on: ubuntu-24.04",
    "timeout-minutes: 35",
    "contents: read",
    "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    "docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd",
    "docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf",
    "aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567",
    "file: infra/maritime/openclaw/remote-extension.Dockerfile",
    "platforms: linux/amd64",
    "load: true",
    "push: false",
    "tags: vera-openclaw-gateway:ci",
    "node scripts/verify-gateway-image-layout.mjs",
    "--image-ref vera-openclaw-gateway:ci",
    "--simulate-bootstrap",
    "version: v0.72.0",
    "--scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1",
    "vera-openclaw-gateway:ci"
  ]) {
    requireText(ciWorkflow, required, ciBoundaryMessage, violations);
  }
  if (
    ciWorkflow.includes("secrets.") ||
    ciWorkflow.includes("push: true") ||
    /\.trivyignore|--ignore-policy|--skip-db-update|--ignore-unfixed=true/iu.test(ciWorkflow) ||
    /\bmaritime\s+(?:create|deploy|restart|stop|delete|env|trigger)\b|\bkubectl\b|\bhelm\b|\bvercel\b|gh release|\bdocker service\b/iu.test(
      ciWorkflow
    )
  ) {
    violations.push(ciBoundaryMessage);
  }

  const resumeBoundaryMessage =
    "Gateway signing resume must bind the existing zero-finding digest and evidence.";
  for (const required of [
    "  workflow_dispatch:",
    "source_sha:",
    "image_digest:",
    "evidence_run_id:",
    '[[ "$REQUESTED_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]',
    '[[ "$REQUESTED_IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]',
    '[[ "$REQUESTED_EVIDENCE_RUN_ID" =~ ^[1-9][0-9]*$ ]]',
    "TRUSTED_SOURCE_BRANCH: main",
    "github.ref == 'refs/heads/main'",
    "IMAGE_REPOSITORY: ghcr.io/zukhriddingit/vera-openclaw-gateway",
    '.name == "Build and scan Gateway candidate"',
    '.conclusion == "success"',
    "run-id: ${{ steps.subject.outputs.evidence_run_id }}",
    "vera-openclaw-gateway-scan-${{ steps.subject.outputs.source_sha }}",
    "trivy-vulnerabilities.json",
    "[.Results[]?.Vulnerabilities[]?] | length",
    "remote-extension-runtime-lock.sha256",
    "cmp --",
    'docker pull "$GATEWAY_IMAGE_REF"',
    "org.opencontainers.image.revision",
    "io.vera.openclaw.image.digest",
    "org.opencontainers.image.base.digest",
    "node scripts/verify-gateway-image-layout.mjs",
    '--image-ref "$GATEWAY_IMAGE_REF"',
    "--simulate-bootstrap",
    "password: ${{ secrets.GHCR_PUBLISH_TOKEN }}",
    'buildType: "https://actions.github.io/buildtypes/workflow/v1"',
    'path: ".github/workflows/attest-openclaw-gateway.yml"',
    '--arg serverUrl "$GITHUB_SERVER_URL"',
    '--arg workflowCommit "$GITHUB_SHA"',
    '--arg workflowRef "$GITHUB_WORKFLOW_REF"',
    'builder: { id: ($serverUrl + "/" + $workflowRef) }',
    "$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT",
    "repository_id: $repositoryId",
    "repository_owner_id: $repositoryOwnerId",
    "runner_environment: $runnerEnvironment",
    "publicationEvidence:",
    'path: ".github/workflows/release-openclaw-gateway.yml"',
    "runId: $evidenceRunId",
    "sourceCommit: $sourceCommit",
    "imageDigest: $imageDigest",
    "predicate-type: https://slsa.dev/provenance/v1",
    "sbom-path: release-evidence/gateway/gateway.spdx.json",
    "cosign sign --yes",
    "cosign verify",
    "attest-openclaw-gateway.yml",
    "if-no-files-found: error"
  ]) {
    requireText(resumeWorkflow, required, resumeBoundaryMessage, violations);
  }
  if (
    /^\s{2}(?:push|pull_request|schedule|repository_dispatch|workflow_run):/mu.test(
      resumeWorkflow
    ) ||
    /docker\/build-push-action|docker\s+(?:build|buildx)|\bpush:\s*true\b/iu.test(resumeWorkflow)
  ) {
    violations.push("Gateway signing resume must never build or publish another candidate.");
  }
  if (resumeWorkflow.includes("--cert-identity")) {
    violations.push(
      "Gateway signing-resume attestation verification must use only the signer-workflow identity selector."
    );
  }
  if (
    /\bmaritime\s+(?:create|deploy|restart|stop|delete|env|trigger)\b|\bkubectl\b|\bhelm\b|\bvercel\b|gh release|\bdocker service\b/iu.test(
      resumeWorkflow
    )
  ) {
    violations.push("Gateway signing resume must not contain deployment or release side effects.");
  }
  if (
    resumeWorkflow.indexOf("Revalidate retained zero-finding evidence") >
      resumeWorkflow.indexOf("Sign in to GitHub Container Registry") ||
    resumeWorkflow.indexOf("Verify anonymous image pull and immutable runtime") >
      resumeWorkflow.indexOf("Sign in to GitHub Container Registry") ||
    resumeWorkflow.indexOf("Sign in to GitHub Container Registry") >
      resumeWorkflow.indexOf("Attest exact-source provenance")
  ) {
    violations.push(
      "Gateway signing resume must revalidate prior zero-finding evidence before registry writes."
    );
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

  const resumeActionMatches = [
    ...resumeWorkflow.matchAll(/^\s*-?\s*uses:\s*([^\s@]+)@([^\s#]+)(?:\s+#.*)?$/gmu)
  ];
  for (const match of resumeActionMatches) {
    const action = match[1];
    const commit = match[2];
    const expected = action ? RESUME_ACTIONS.get(action) : undefined;
    if (!action || !expected || commit !== expected.commit) {
      violations.push(
        `Gateway signing-resume action ${action ?? "unknown"} is not pinned to its reviewed commit.`
      );
    }
  }
  for (const [action, expected] of RESUME_ACTIONS) {
    const count = resumeActionMatches.filter((match) => match[1] === action).length;
    if (count !== expected.count) {
      violations.push(
        `Gateway signing-resume action ${action} must appear exactly ${expected.count} time(s).`
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
  const ciWorkflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const resumeWorkflow = readFileSync(
    resolve(root, ".github/workflows/attest-openclaw-gateway.yml"),
    "utf8"
  );
  const violations = findGatewayReleaseWorkflowViolations(workflow, ciWorkflow, resumeWorkflow);
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyGatewayReleaseWorkflow();
  process.stdout.write("Gateway release workflow boundaries verified.\n");
}
