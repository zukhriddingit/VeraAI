import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function requireText(
  workflow: string,
  expected: string,
  message: string,
  violations: string[]
): void {
  if (!workflow.includes(expected)) violations.push(message);
}

export function findGatewayRuntimeAttestationWorkflowViolations(workflow: string): string[] {
  const violations: string[] = [];
  const boundary =
    "Existing-runtime attestation must bind and revalidate the exact published child.";
  for (const required of [
    "  workflow_dispatch:",
    "source_sha:",
    "release_index_digest:",
    "runtime_manifest_digest:",
    "evidence_run_id:",
    "github.ref == 'refs/heads/main'",
    "TRUSTED_SOURCE_BRANCH: main",
    "IMAGE_REPOSITORY: ghcr.io/zukhriddingit/vera-openclaw-gateway",
    '[[ "$REQUESTED_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]',
    '[[ "$REQUESTED_RELEASE_INDEX_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]',
    '[[ "$REQUESTED_RUNTIME_MANIFEST_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]',
    '[[ "$REQUESTED_EVIDENCE_RUN_ID" =~ ^[1-9][0-9]*$ ]]',
    "git merge-base --is-ancestor",
    '"Release immutable Vera OpenClaw Gateway"',
    '".github/workflows/release-openclaw-gateway.yml"',
    'test "$(jq -r \'.event\' <<< "$run_json")" = "workflow_dispatch"',
    'test "$(jq -r \'.conclusion\' <<< "$run_json")" = "success"',
    ".releaseIndex == $releaseIndex",
    ".runtimeManifest == $runtimeManifest",
    "infra/maritime/openclaw/remote-extension-runtime-lock.json",
    "openclaw_base",
    "runtime_base",
    "runtime_lock_sha256",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "run-id: ${{ steps.subject.outputs.evidence_run_id }}",
    "release-evidence/original-publication/source-commit.txt",
    "release-evidence/original-publication/image-reference.txt",
    "expected_lock_hash=",
    "observed_lock_hash=",
    "cmp --",
    "pnpm inspect:gateway-registry --",
    ".current.runtimeManifestDigest == $child",
    'docker pull "$RUNTIME_IMAGE_REF"',
    "node scripts/verify-gateway-image-layout.mjs",
    "--simulate-bootstrap",
    "org.opencontainers.image.revision",
    "version: v0.72.0",
    "gateway-runtime.spdx.json",
    "--scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1",
    "[.Results[]?.Vulnerabilities[]?] | length",
    "password: ${{ secrets.GHCR_PUBLISH_TOKEN }}",
    "existingRuntimeDigest",
    "originalPublicationRunId",
    'recoveryMode: "attest-existing-runtime-without-rebuild"',
    "resolvedDependencies:",
    "releaseIndexDigest",
    "openclawBase",
    "runtimeBase",
    "runtimeLockSha256",
    "subject-digest: ${{ steps.subject.outputs.runtime_manifest_digest }}",
    "predicate-type: https://slsa.dev/provenance/v1",
    "sbom-path: release-evidence/gateway-runtime/gateway-runtime.spdx.json",
    "push-to-registry: true",
    "cosign-release: v3.0.6",
    'cosign sign --yes "$RUNTIME_IMAGE_REF"',
    'cosign verify "$RUNTIME_IMAGE_REF"',
    'gh attestation verify "oci://$RUNTIME_IMAGE_REF"',
    "attest-openclaw-gateway-runtime.yml",
    "if-no-files-found: error",
    "retention-days: 30"
  ]) {
    requireText(workflow, required, boundary, violations);
  }

  if (/^\s{2}(?:push|pull_request|schedule|repository_dispatch|workflow_run):/mu.test(workflow)) {
    violations.push("Existing-runtime attestation must remain manual-only.");
  }
  if (
    /docker\/build-push-action|docker\/setup-buildx-action|\bdocker\s+(?:build|buildx|push)\b|\bpush:\s*true\b/iu.test(
      workflow
    )
  ) {
    violations.push("Existing-runtime attestation must never build or publish image content.");
  }
  if (
    /\bmaritime\s+(?:create|deploy|restart|stop|delete|env|trigger)\b|\bkubectl\b|\bhelm\b|\bvercel\b/iu.test(
      workflow
    )
  ) {
    violations.push("Existing-runtime attestation must not deploy infrastructure.");
  }
  if (/\.trivyignore|--ignore-policy|--skip-db-update|--ignore-unfixed=true/iu.test(workflow)) {
    violations.push("Existing-runtime attestation must not suppress vulnerability findings.");
  }

  const inspection = workflow.indexOf("pnpm inspect:gateway-registry --");
  const pull = workflow.indexOf('docker pull "$RUNTIME_IMAGE_REF"');
  const layout = workflow.indexOf("node scripts/verify-gateway-image-layout.mjs");
  const zeroScan = workflow.indexOf(
    "--scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1"
  );
  const login = workflow.indexOf("password: ${{ secrets.GHCR_PUBLISH_TOKEN }}");
  const attest = workflow.indexOf("      - name: Attest exact-child source provenance");
  const sign = workflow.indexOf('cosign sign --yes "$RUNTIME_IMAGE_REF"');
  if (
    [inspection, pull, layout, zeroScan, login, attest, sign].some((index) => index < 0) ||
    !(inspection < pull && pull < layout && layout < zeroScan && zeroScan < login) ||
    !(login < attest && attest < sign)
  ) {
    violations.push(
      "Anonymous index, pull, layout, and zero-scan checks must precede every registry write."
    );
  }
  if (
    (workflow.match(
      /subject-digest: \$\{\{ steps\.subject\.outputs\.runtime_manifest_digest \}\}/gu
    )?.length ?? 0) !== 2
  ) {
    violations.push("Both attestations must subject only the exact runtime-manifest digest.");
  }
  for (const match of workflow.matchAll(/uses:\s*([^\s#]+)/gu)) {
    if (!/@[a-f0-9]{40}$/u.test(match[1] as string)) {
      violations.push(`Existing-runtime workflow action is not commit-pinned: ${match[1]}`);
    }
  }
  return violations;
}

export function verifyGatewayRuntimeAttestationWorkflow(
  root = resolve(import.meta.dirname, "..")
): void {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/attest-openclaw-gateway-runtime.yml"),
    "utf8"
  );
  const violations = findGatewayRuntimeAttestationWorkflowViolations(workflow);
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyGatewayRuntimeAttestationWorkflow();
  process.stdout.write("Existing Gateway runtime attestation boundaries verified.\n");
}
