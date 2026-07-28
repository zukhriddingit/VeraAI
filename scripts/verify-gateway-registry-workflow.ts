import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PINNED_ACTIONS = [
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
  "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
  "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
] as const;
const CURRENT =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec";
const PREVIOUS =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4";

export function findGatewayRegistryWorkflowViolations(workflow: string): string[] {
  const violations: string[] = [];
  const required = [
    "name: Verify public Gateway registry objects",
    "  pull_request:",
    "permissions:\n  contents: read",
    "runs-on: ubuntu-24.04",
    "timeout-minutes: 15",
    `CURRENT_RELEASE_INDEX: ${CURRENT}`,
    `PREVIOUS_RELEASE_INDEX: ${PREVIOUS}`,
    "VERA_GATEWAY_REGISTRY_OUTPUT_DIRECTORY: release-evidence/gateway-registry",
    "pnpm install --frozen-lockfile",
    "pnpm inspect:gateway-registry --",
    '--current-index "$CURRENT_RELEASE_INDEX"',
    '--previous-index "$PREVIOUS_RELEASE_INDEX"',
    "--output release-evidence/gateway-registry/inspection.json",
    "name: vera-openclaw-gateway-registry-r3",
    "path: release-evidence/gateway-registry/inspection.json",
    "if-no-files-found: error",
    "retention-days: 30",
    ...PINNED_ACTIONS
  ];
  for (const text of required) {
    if (!workflow.includes(text)) {
      violations.push(`Gateway registry workflow is missing required boundary: ${text}`);
    }
  }
  if (
    /^\s{2}(?:push|schedule|repository_dispatch|workflow_run|workflow_dispatch):/mu.test(workflow)
  ) {
    violations.push("Gateway registry workflow must use only the scoped pull-request trigger.");
  }
  if (
    /secrets\.|docker\/login-action|packages:\s*write|id-token:\s*write|attestations:\s*write/iu.test(
      workflow
    )
  ) {
    violations.push("Gateway registry workflow must not receive registry or signing authority.");
  }
  if (
    /\bdocker\s+(?:push|build|buildx)\b|docker\/build-push-action|\bpush:\s*true\b/iu.test(workflow)
  ) {
    violations.push("Gateway registry workflow must not build or publish an image.");
  }
  if (
    /\bmaritime\s+(?:create|deploy|restart|stop|delete|env|trigger)\b|\bkubectl\b|\bhelm\b|\bvercel\b/iu.test(
      workflow
    )
  ) {
    violations.push("Gateway registry workflow must not contain deployment side effects.");
  }
  if (/vera-openclaw-gateway:(?!.*sha256)/u.test(workflow)) {
    violations.push("Gateway registry workflow must not use mutable image references.");
  }
  if (/timeout-minutes:\s*(?:0|[3-9][0-9]|[1-9][0-9]{2,})\b/u.test(workflow)) {
    violations.push("Gateway registry workflow runtime must remain bounded.");
  }
  if (/if-no-files-found:\s*(?:warn|ignore)/u.test(workflow)) {
    violations.push("Gateway registry evidence upload must fail when evidence is absent.");
  }
  for (const match of workflow.matchAll(/uses:\s*([^\s#]+)/gu)) {
    if (!/@[a-f0-9]{40}$/u.test(match[1] as string)) {
      violations.push(`Gateway registry workflow action is not commit-pinned: ${match[1]}`);
    }
  }
  return violations;
}

export function verifyGatewayRegistryWorkflow(root = resolve(import.meta.dirname, "..")): void {
  const workflow = readFileSync(
    resolve(root, ".github/workflows/verify-openclaw-gateway-registry.yml"),
    "utf8"
  );
  const violations = findGatewayRegistryWorkflowViolations(workflow);
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyGatewayRegistryWorkflow();
  process.stdout.write("Gateway public registry workflow boundaries verified.\n");
}
