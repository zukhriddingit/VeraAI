# Gateway Existing-Digest Attestation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the publication verifier and recover signing and attestations for the one existing Gateway digest without building or publishing another image.

**Architecture:** The publication workflow pulls its immutable push-only output before local Docker inspection. The digest-recovery workflow recognizes only the reviewed failed publication-step shape, then independently pulls, verifies, zero-scans, signs, and attests the same source-bound digest before any Maritime operation.

**Tech Stack:** GitHub Actions, Docker/Buildx, Node.js 24, TypeScript, Vitest, pnpm, Trivy `0.72.0`, GitHub attestations, Cosign `3.0.6`.

## Global Constraints

- Work only in `/private/tmp/vera-founder-staging-evidence-pr`.
- Start from merged main commit `69fee2fcedf7d0474d5a75d64323318b993f7a6a`.
- Recover only `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4`.
- Bind publication evidence run `30295038582` and image source commit `69fee2fcedf7d0474d5a75d64323318b993f7a6a`.
- Never build, rebuild, or publish an image in the recovery workflow.
- Never dispatch the publication workflow again.
- Keep OpenClaw digest `sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c`.
- Keep Chainguard base digest `sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f`.
- Require zero Trivy `HIGH` and zero `CRITICAL` findings without suppression.
- Do not modify the Gateway runtime, route filtering, landing page, source adapters, or Milestone 13B scope.
- Do not create a Maritime agent unless signature, provenance, SBOM attestation, anonymous pull, and zero-scan gates all pass.
- Store real evidence only under gitignored `release-evidence/private/` with directory mode `0700` and file mode `0600`.

---

### Task 1: Add failing workflow-boundary tests

**Files:**
- Modify: `scripts/verify-gateway-release-workflow.unit.test.ts`

**Interfaces:**
- Consumes: `findGatewayReleaseWorkflowViolations(release, ci, recovery)`.
- Produces: regression cases for pull-before-inspect and safe failed-run recovery.

- [ ] **Step 1: Add the release pull-order regression**

Add:

```ts
it("rejects published-image inspection before an exact-digest pull", () => {
  const mutated = releaseWorkflow.replace('          docker pull "$GATEWAY_IMAGE_REF"\n', "");
  expect(
    findGatewayReleaseWorkflowViolations(mutated, ciWorkflow, resumeWorkflow)
  ).toEqual(
    expect.arrayContaining([
      expect.stringMatching("pull the immutable digest before published-image inspection")
    ])
  );
});
```

- [ ] **Step 2: Add recovery-evidence mutation cases**

Require violations when the recovery workflow loses any of these strings:

```text
.conclusion == "failure"
.name == "Build and publish the commit-bound Gateway"
.name == "Resolve immutable Gateway reference"
.name == "Verify minimal published runtime identity"
.name == "Generate SBOM and vulnerability evidence"
.name == "Enforce zero unresolved critical or high findings"
.name == "Preserve pre-signing Gateway evidence"
aquasecurity/setup-trivy@
gateway.spdx.json
trivy-vulnerabilities.json
--severity CRITICAL,HIGH --exit-code 1
```

Use table-driven mutations:

```ts
it.each([
  ["failed job eligibility", '.conclusion == "failure"', '.conclusion == "success"'],
  [
    "failed layout step",
    '.name == "Verify minimal published runtime identity"',
    '.name == "Unknown failed step"'
  ],
  [
    "fresh zero scan",
    "--severity CRITICAL,HIGH --exit-code 1",
    "--severity CRITICAL --exit-code 1"
  ]
])("rejects recovery missing %s", (_label, before, after) => {
  const mutated = resumeWorkflow.replace(before, after);
  expect(
    findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutated)
  ).toEqual(
    expect.arrayContaining([
      expect.stringMatching("independently revalidate the existing digest")
    ])
  );
});
```

- [ ] **Step 3: Add no-build/no-publish assertions**

Retain the existing build-action mutation and add literal Docker command cases:

```ts
for (const command of ["docker build .", "docker buildx build .", "docker push image"]) {
  const mutated = `${resumeWorkflow}\n# ${command}\n`;
  expect(
    findGatewayReleaseWorkflowViolations(releaseWorkflow, ciWorkflow, mutated)
  ).toContain("Gateway signing resume must never build or publish another candidate.");
}
```

- [ ] **Step 4: Run the focused tests and confirm failure**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-gateway-release-workflow.unit.test.ts
```

Expected: the new pull and recovery assertions fail against the current workflows/verifier.

### Task 2: Implement exact-digest pull and recovery gates

**Files:**
- Modify: `.github/workflows/release-openclaw-gateway.yml`
- Modify: `.github/workflows/attest-openclaw-gateway.yml`
- Modify: `scripts/verify-gateway-release-workflow.ts`

**Interfaces:**
- Consumes: source SHA, image digest, publication run ID, and the retained publication artifact.
- Produces: a future-safe release workflow and one non-publishing recovery workflow.

- [ ] **Step 1: Pull the publication output before inspection**

Immediately before the release step invokes `verify-gateway-image-layout.mjs`, add:

```bash
docker pull "$GATEWAY_IMAGE_REF"
```

Keep the verifier bound to `"$GATEWAY_IMAGE_REF"` and `--simulate-bootstrap`.

- [ ] **Step 2: Recognize the precise failed-run shape**

Replace the successful-job-only GitHub API predicate with one that accepts either one successful
build-and-scan job or one failed job whose steps satisfy:

```jq
def step_ok($name; $conclusion):
  [.steps[] | select(.name == $name and .conclusion == $conclusion)] | length == 1;

[.jobs[] |
  select(.name == "Build and scan Gateway candidate") |
  select(
    .conclusion == "success" or
    (
      .conclusion == "failure" and
      step_ok("Build and publish the commit-bound Gateway"; "success") and
      step_ok("Resolve immutable Gateway reference"; "success") and
      step_ok("Verify minimal published runtime identity"; "failure") and
      step_ok("Generate SBOM and vulnerability evidence"; "skipped") and
      step_ok("Enforce zero unresolved critical or high findings"; "skipped") and
      step_ok("Preserve pre-signing Gateway evidence"; "success")
    )
  )
] | length == 1
```

- [ ] **Step 3: Revalidate only retained publication binding**

Before pulling, require:

```bash
grep -Fx "$GATEWAY_IMAGE_REF" release-evidence/gateway/image-reference.txt
grep -Fx "$RELEASE_SOURCE_SHA" release-evidence/gateway/source-commit.txt
sha256sum --check release-evidence/gateway/remote-extension-runtime-lock.sha256
cmp -- \
  infra/maritime/openclaw/remote-extension-runtime-lock.json \
  release-evidence/gateway/remote-extension-runtime-lock.json
```

Do not require retained Trivy or SBOM files because the known publication failure occurred before
they were generated.

- [ ] **Step 4: Independently pull and inspect**

Before registry login, anonymously run:

```bash
docker pull "$GATEWAY_IMAGE_REF"
```

Validate source, OpenClaw, and Chainguard labels, then run:

```bash
node scripts/verify-gateway-image-layout.mjs \
  --image-ref "$GATEWAY_IMAGE_REF" \
  --simulate-bootstrap
```

- [ ] **Step 5: Regenerate and enforce vulnerability/SBOM evidence**

Add pinned action:

```yaml
- name: Install pinned Trivy
  uses: aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567 # v0.3.1
  with:
    version: v0.72.0
    cache: false
```

Then run:

```bash
trivy --config /dev/null image --quiet --ignorefile /dev/null --list-all-pkgs \
  --format spdx-json \
  --output release-evidence/gateway/gateway.spdx.json \
  "$GATEWAY_IMAGE_REF"
trivy --config /dev/null image --quiet --ignorefile /dev/null --list-all-pkgs \
  --scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 0 \
  --format json \
  --output release-evidence/gateway/trivy-vulnerabilities.json \
  "$GATEWAY_IMAGE_REF"
test "$(jq '[.Results[]?.Vulnerabilities[]?] | length' \
  release-evidence/gateway/trivy-vulnerabilities.json)" = "0"
trivy --config /dev/null image --quiet --ignorefile /dev/null --list-all-pkgs \
  --scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1 \
  "$GATEWAY_IMAGE_REF"
```

- [ ] **Step 6: Strengthen the static verifier**

Require the release pull to appear before `Verify minimal published runtime identity`.

For recovery, require the precise failure shape, pinned Trivy, both generated evidence files, and
the zero-finding enforcement. Update `RESUME_ACTIONS` to expect one
`aquasecurity/setup-trivy` action. Require all anonymous pull, identity, layout, and scan steps to
occur before `Sign in to GitHub Container Registry`.

- [ ] **Step 7: Run focused validation**

Run:

```bash
pnpm verify:gateway-release-workflow
pnpm exec vitest run --project unit scripts/verify-gateway-release-workflow.unit.test.ts
```

Expected: pass.

### Task 3: Update operator documentation and run repository gates

**Files:**
- Modify: `docs/RELEASE_READINESS.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `infra/maritime/OPENCLAW.md`
- Modify: `scripts/verify-release-documentation.ts`
- Modify: `scripts/verify-release-documentation.unit.test.ts`

**Interfaces:**
- Consumes: the exact recovery workflow behavior.
- Produces: an operator-visible no-republish recovery procedure and regression coverage.

- [ ] **Step 1: Document the recovery boundary**

State that a push-only publication may be resumed only by exact source, digest, and run ID; the
resume path rebuilds nothing, republishes nothing, regenerates scan/SBOM evidence, and signs only
after all read-only checks pass.

- [ ] **Step 2: Add documentation verifier requirements**

Require documentation to include:

```text
exact existing digest
no rebuild
no replacement publication
independent zero-finding scan
temporary GHCR_PUBLISH_TOKEN
delete the temporary secret
```

- [ ] **Step 3: Run documentation and workflow tests**

Run:

```bash
pnpm verify:release-documentation
pnpm verify:gateway-release-workflow
pnpm exec vitest run --project unit \
  scripts/verify-release-documentation.unit.test.ts \
  scripts/verify-gateway-release-workflow.unit.test.ts
```

Expected: pass.

- [ ] **Step 4: Run full local validation**

Run:

```bash
pnpm exec prettier --check .
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:integration:postgres
pnpm build
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm verify:gateway-release-workflow
pnpm verify:release-documentation
git diff --check
```

Expected: every command passes; live-provider tests remain opt-in.

- [ ] **Step 5: Review the diff**

Confirm:

```bash
git diff --name-only origin/main...
git diff --check origin/main...
git status --short
git ls-files release-evidence/private
```

Expected: only approved workflow, verifier, tests, documentation, design, and plan files differ;
private evidence remains untracked and ignored.

### Task 4: CI-gated PR and one recovery dispatch

**Files:**
- No additional repository files unless CI exposes a regression directly related to this repair.
- Create private evidence only under:
  `release-evidence/private/m13a-gateway-digest-recovery-20260727/`

**Interfaces:**
- Consumes: merged recovery commit, fixed source/digest/run inputs, and temporary package credential.
- Produces: verified signature and attestations for the existing image or a fail-closed record.

- [ ] **Step 1: Commit and push**

Use focused commits and push:

```text
codex/gateway-digest-attestation-recovery
```

- [ ] **Step 2: Open the PR**

Title:

```text
fix: recover existing Gateway digest attestations
```

Explain that the workflow never builds or publishes an image and that Maritime remains blocked
until recovery passes.

- [ ] **Step 3: Wait for exact-head CI and merge**

Merge only when all required checks pass and GitHub reports the PR mergeable. Use squash message:

```text
fix: recover existing Gateway digest attestations
```

- [ ] **Step 4: Create the temporary Actions secret without printing it**

Pipe the existing package-write credential directly into:

```bash
gh secret set GHCR_PUBLISH_TOKEN --repo zukhriddingit/VeraAI
```

Never echo or inspect the credential.

- [ ] **Step 5: Dispatch recovery exactly once**

Dispatch `attest-openclaw-gateway.yml` on merged main with:

```text
source_sha=69fee2fcedf7d0474d5a75d64323318b993f7a6a
image_digest=sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
evidence_run_id=30295038582
```

Do not dispatch the publication workflow.

- [ ] **Step 6: Delete the temporary secret**

Delete `GHCR_PUBLISH_TOKEN` immediately after the recovery run reaches a terminal state, whether
it passes or fails.

- [ ] **Step 7: Verify recovery evidence**

Require:

```bash
gh attestation verify \
  oci://ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4 \
  --repo zukhriddingit/VeraAI \
  --signer-workflow \
    zukhriddingit/VeraAI/.github/workflows/attest-openclaw-gateway.yml
```

Verify Cosign using the recovery workflow identity and confirm the downloaded evidence contains
zero findings, SPDX SBOM, provenance bundle, SBOM bundle, and signature verification.

- [ ] **Step 8: Apply the live acceptance gate**

If every recovery gate passes, execute the already-approved one disposable Maritime acceptance
from the prior Milestone 13A plan. If any gate fails, create no Maritime resource and classify
`founder_browser_experimental=no_go`.

- [ ] **Step 9: Hash evidence and clean up**

Canonicalize the new private manifest, compute its SHA-256, enforce `0700`/`0600`, remove all
temporary credentials/files/resources, confirm the worktree is clean, and produce the required
14-point report.
