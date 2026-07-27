# Milestone 13A-R3 Maritime Image-Pull Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove which immutable Gateway manifest Maritime can retrieve, bind that runtime digest to the signed release index and supply-chain evidence, and complete Milestone 13A without changing OpenClaw behavior.

**Architecture:** Add a closed public-registry inspection boundary, a pure structural diff and runtime-binding boundary, and non-publishing GitHub-hosted verification. Merge those diagnostics before running one bounded Maritime A/B/C matrix. Use the existing `linux/amd64` child when it works; create one Docker-V2/gzip compatibility image only when the matrix proves that the existing child format is incompatible.

**Tech Stack:** TypeScript, Node.js 24 Fetch/Web Streams/Crypto, Vitest, GitHub Actions, Docker Buildx, GHCR Registry API V2, pinned Skopeo 1.20.0, Trivy 0.72.0, Cosign 3.0.6, Maritime CLI 1.7.0.

## Global Constraints

- Required architecture: Chrome extension -> direct WSS -> Maritime public edge -> exact `/browser/extension` route filter -> hardened OpenClaw Gateway -> explicitly shared Chrome tab.
- OpenClaw remains exactly `2026.7.1`.
- Current release index remains `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4`.
- Current runtime child is `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a`.
- Previous comparison index remains `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3`.
- Runtime UID/GID remains `1000:1000`; working directory `/app`; PATH `/usr/bin`; ports `18789`, `18790`, and `18792`; executable allowlist exactly `/usr/bin/node`.
- No shell, BusyBox, Coreutils, curl, Git, npm, pnpm, yarn, package manager, source adapter, marketplace browsing, landing-page change, or Milestone 13B work.
- No mutable tag may be deployed or entered into evidence.
- Each Maritime matrix deployment has a fifteen-minute terminal bound.
- Compatibility publication is unreachable unless the current child verifies locally and the Maritime matrix proves a concrete media-type, compression, or descriptor incompatibility.
- At most one compatibility image may be published.
- Signatures, exact-source SLSA provenance, SPDX SBOM, and zero `HIGH`/`CRITICAL` Trivy evidence must bind the exact deployed runtime digest.
- Private evidence stays gitignored under `release-evidence/private/`, with directories mode `0700` and files mode `0600`.
- Every disposable agent, trigger, credential, temporary Actions secret, endpoint, and local temporary file is removed on pass or failure.
- Milestone 13B remains unauthorized.

---

## File Structure

### Registry inspection

- Create `scripts/gateway-registry-contract.ts`: closed OCI/Docker manifest types, parsing, descriptor classification, digest and media-type validation.
- Create `scripts/gateway-registry-contract.unit.test.ts`: table-driven contract and classification tests.
- Create `scripts/gateway-registry-client.ts`: anonymous GHCR token acquisition, safe redirects, bounded HEAD/GET streaming, digest/length verification.
- Create `scripts/gateway-registry-client.unit.test.ts`: injected-fetch tests for tokens, redirects, timeouts, length and digest failures.
- Create `scripts/inspect-gateway-registry.ts`: CLI that inspects current and previous indexes, verifies all runtime objects, and writes sanitized JSON.
- Create `scripts/inspect-gateway-registry.unit.test.ts`: argument, output-path, closed-output, and no-secret tests.

### Structural diff and runtime binding

- Create `scripts/gateway-runtime-binding.ts`: normalized structural diff, binding-record validation, canonical serialization, and content hash.
- Create `scripts/gateway-runtime-binding.unit.test.ts`: deterministic diff/hash and fail-closed binding tests.
- Modify `infra/maritime/openclaw/remote-extension-image.json`: record the published release index, exact runtime child, source revision, and blocked diagnostic state.
- Modify `scripts/verify-remote-extension-config.ts`: validate the index/child split without changing deployment eligibility.
- Modify `scripts/verify-remote-extension-config.unit.test.ts`: mutable/mixed/missing child cases.

### GitHub-hosted verification and exact-child attestations

- Create `.github/workflows/verify-openclaw-gateway-registry.yml`: anonymous GitHub-hosted registry verification with no registry writes.
- Create `scripts/verify-gateway-registry-workflow.ts`: static safety verifier for the registry workflow.
- Create `scripts/verify-gateway-registry-workflow.unit.test.ts`: automatic-trigger, secret, mutable-reference, missing-blob, and side-effect rejection tests.
- Create `.github/workflows/attest-openclaw-gateway-runtime.yml`: manual, non-building exact-child scan/sign/attest workflow.
- Create `scripts/verify-gateway-runtime-attestation-workflow.ts`: static gate for exact-child-only registry writes.
- Create `scripts/verify-gateway-runtime-attestation-workflow.unit.test.ts`: source/index/child binding, zero-scan-before-login, no-build/no-push tests.
- Modify `.github/workflows/ci.yml`: run both new static workflow verifiers.
- Modify `package.json`: expose the new inspection and verification commands.

### Procedures and evidence

- Modify `docs/RELEASE_READINESS.md`: index-versus-runtime identity and bounded pull matrix.
- Modify `docs/SECURITY_REVIEW.md`: exact-child supply-chain binding and compatibility-publication boundary.
- Modify `infra/maritime/OPENCLAW.md`: operator commands, fifteen-minute bounds, cleanup, and escalation.
- Create private R3 records only under `release-evidence/private/m13a-r3-maritime-image-pull-20260727-01/`.

### Conditional compatibility branch

These files are created only if matrix case C fails for a demonstrated image-format reason:

- Create `.github/workflows/release-openclaw-gateway-compatibility.yml`.
- Create `scripts/verify-gateway-compatibility-workflow.ts`.
- Create `scripts/verify-gateway-compatibility-workflow.unit.test.ts`.
- Modify the three release/security/Maritime documents with the exact selected compatibility digest after publication.

---

### Task 1: Implement the closed registry manifest contract

**Files:**
- Create: `scripts/gateway-registry-contract.ts`
- Test: `scripts/gateway-registry-contract.unit.test.ts`

**Interfaces:**
- Produces: `parseManifestEnvelope(value: unknown): ParsedManifest`
- Produces: `classifyIndexDescriptors(index: OciIndex): DescriptorClassification`
- Produces: `assertRuntimeManifest(manifest: OciManifest): RuntimeManifest`
- Produces: `sha256Digest(bytes: Uint8Array): Sha256Digest`
- Consumes: no network or filesystem state.

- [ ] **Step 1: Write failing descriptor-classification tests**

```ts
it("accepts exactly one linux amd64 runtime and one attestation descriptor", () => {
  expect(classifyIndexDescriptors(indexFixture())).toEqual({
    runtime: expect.objectContaining({
      digest: CURRENT_CHILD_DIGEST,
      platform: { os: "linux", architecture: "amd64" }
    }),
    attestations: [
      expect.objectContaining({
        platform: { os: "unknown", architecture: "unknown" }
      })
    ]
  });
});

it.each([
  ["no runtime", []],
  ["two runtimes", [runtimeDescriptor(), runtimeDescriptor({ digest: OTHER_DIGEST })]],
  ["arm64 runtime", [runtimeDescriptor({ platform: { os: "linux", architecture: "arm64" } })]]
])("rejects %s", (_label, manifests) => {
  expect(() => classifyIndexDescriptors(indexFixture({ manifests }))).toThrow(
    /exactly one runnable linux\/amd64 descriptor/u
  );
});
```

- [ ] **Step 2: Run the contract tests and confirm the missing-module failure**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-registry-contract.unit.test.ts
```

Expected: FAIL because `gateway-registry-contract.ts` does not exist.

- [ ] **Step 3: Implement strict manifest parsing and classification**

```ts
export const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
export const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
export const DOCKER_MANIFEST_V2 =
  "application/vnd.docker.distribution.manifest.v2+json";
export const OCI_GZIP_LAYER = "application/vnd.oci.image.layer.v1.tar+gzip";
export const DOCKER_GZIP_LAYER =
  "application/vnd.docker.image.rootfs.diff.tar.gzip";

export function classifyIndexDescriptors(index: OciIndex): DescriptorClassification {
  const runtime = index.manifests.filter(
    ({ platform }) => platform?.os === "linux" && platform.architecture === "amd64"
  );
  const attestations = index.manifests.filter(
    ({ platform, annotations }) =>
      platform?.os === "unknown" &&
      platform.architecture === "unknown" &&
      annotations?.["vnd.docker.reference.type"] === "attestation-manifest"
  );
  if (runtime.length !== 1 || runtime.length + attestations.length !== index.manifests.length) {
    throw new Error("Gateway index must contain exactly one runnable linux/amd64 descriptor.");
  }
  return { runtime: runtime[0], attestations };
}
```

Reject unknown fields where the contract owns the object, invalid `sha256:` values, mutable
references, zstd layers, uncompressed layers, foreign layers, missing sizes, non-OCI/Docker-V2
config media types, and duplicate descriptors.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-registry-contract.unit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add scripts/gateway-registry-contract.ts scripts/gateway-registry-contract.unit.test.ts
git commit -m "feat: add Gateway registry manifest contract"
```

---

### Task 2: Implement bounded anonymous registry-object verification

**Files:**
- Create: `scripts/gateway-registry-client.ts`
- Test: `scripts/gateway-registry-client.unit.test.ts`

**Interfaces:**
- Consumes: `parseManifestEnvelope`, `classifyIndexDescriptors`, digest constants from Task 1.
- Produces: `inspectPublicGatewayImage(input, dependencies): Promise<GatewayRegistryInspection>`
- Produces: `fetchVerifiedObject(input, dependencies): Promise<VerifiedRegistryObject>`
- Dependencies: injected `fetch`, monotonic clock, and SHA-256 implementation.

- [ ] **Step 1: Write failing transport tests**

Cover:

```ts
it("does not expose the anonymous bearer token or redirect URL", async () => {
  const result = await inspectPublicGatewayImage(input, fakeRegistry());
  expect(JSON.stringify(result)).not.toContain("Bearer");
  expect(JSON.stringify(result)).not.toContain("sig=");
});

it("rejects a digest mismatch while streaming a layer", async () => {
  await expect(fetchVerifiedObject(layerInput, mismatchedRegistry())).rejects.toThrow(
    "Registry object SHA-256 did not match its descriptor."
  );
});

it.each([
  ["content length mismatch", lengthMismatchRegistry()],
  ["HTTP downgrade redirect", downgradeRedirectRegistry()],
  ["credential-bearing redirect", credentialRedirectRegistry()],
  ["request timeout", timedOutRegistry()],
  ["missing blob", missingBlobRegistry()]
])("rejects %s", async (_label, registry) => {
  await expect(inspectPublicGatewayImage(input, registry)).rejects.toThrow();
});
```

- [ ] **Step 2: Run the client tests and confirm failure**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-registry-client.unit.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement anonymous token and safe-object fetching**

Use:

```ts
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_REDIRECTS = 3;
const TOKEN_ENDPOINT = new URL("https://ghcr.io/token");

export interface RegistryTransportDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => number;
}
```

Token acquisition uses the fixed scope:

```text
repository:zukhriddingit/vera-openclaw-gateway:pull
```

`fetchVerifiedObject` follows at most three redirects, requires HTTPS and no URL userinfo, never
returns the redirect location, streams into `createHash("sha256")`, enforces the declared
descriptor size, compares any observed `content-length`, and returns only:

```ts
interface VerifiedRegistryObject {
  readonly status: 200 | 206;
  readonly descriptorDigest: Sha256Digest;
  readonly observedDigest: Sha256Digest;
  readonly descriptorBytes: number;
  readonly observedBytes: number;
  readonly mediaType: string;
  readonly durationMilliseconds: number;
  readonly redirectCount: number;
}
```

- [ ] **Step 4: Verify only runtime objects are downloaded**

`inspectPublicGatewayImage` GETs:

1. top-level index;
2. selected `linux/amd64` child;
3. child config;
4. every child runtime layer.

It records attestation descriptors but never uses them as a runtime-layer download source.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-registry-client.unit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the client**

```bash
git add scripts/gateway-registry-client.ts scripts/gateway-registry-client.unit.test.ts
git commit -m "feat: verify public Gateway registry objects"
```

---

### Task 3: Add deterministic structural diff and runtime binding

**Files:**
- Create: `scripts/gateway-runtime-binding.ts`
- Test: `scripts/gateway-runtime-binding.unit.test.ts`

**Interfaces:**
- Consumes: `GatewayRegistryInspection` from Task 2.
- Produces: `diffGatewayImages(previous, current): GatewayImageStructuralDiff`
- Produces: `withRuntimeBindingHash(record): RuntimeBindingRecord`
- Produces: `validateRuntimeBinding(record): readonly string[]`

- [ ] **Step 1: Write failing deterministic-diff and binding tests**

```ts
it("reports the current extra gzip layer and changed config", () => {
  expect(diffGatewayImages(previousInspection, currentInspection)).toEqual({
    schemaVersion: 1,
    topLevelMediaTypeChanged: false,
    runtimeLayerCount: { previous: 16, current: 17 },
    compressedBytes: { previous: 296_050_492, current: 296_050_552 },
    changedConfig: true,
    addedLayerDigests: ["sha256:c30bbfad64f8075f8d29a27758de4589c272835b353c8f4bdc34a72b544a22d9"],
    removedLayerDigests: [],
    reorderedLayers: false
  });
});

it("hashes equivalent records identically regardless of key order", () => {
  expect(withRuntimeBindingHash(binding).contentHash).toBe(
    withRuntimeBindingHash(reorderedBinding).contentHash
  );
});
```

Add table-driven failures for extra fields, mixed index/child repositories, mutable references,
wrong platform, source-commit mismatch, missing rootfs diff IDs, child not present in the parent,
nonmatching SBOM/provenance subjects, unverified signature, and modified content after hashing.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-runtime-binding.unit.test.ts
```

Expected: FAIL because the binding module does not exist.

- [ ] **Step 3: Implement the closed binding record**

```ts
export interface RuntimeBindingRecordWithoutHash {
  readonly schemaVersion: 1;
  readonly releaseIndex: ImmutableImageReference;
  readonly runtimeManifest: ImmutableImageReference;
  readonly descriptorMediaType:
    | "application/vnd.oci.image.manifest.v1+json"
    | "application/vnd.docker.distribution.manifest.v2+json";
  readonly platform: { readonly os: "linux"; readonly architecture: "amd64" };
  readonly sourceRevision: CommitSha;
  readonly imageConfigDigest: Sha256Digest;
  readonly rootfsDiffIds: readonly Sha256Digest[];
  readonly sbomSubject: Sha256Digest;
  readonly provenanceSubject: Sha256Digest;
  readonly signatureVerification: "verified";
}
```

Canonicalize object keys, preserve array order, exclude only `contentHash`, and compute SHA-256.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run --project unit scripts/gateway-runtime-binding.unit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/gateway-runtime-binding.ts scripts/gateway-runtime-binding.unit.test.ts
git commit -m "feat: bind Gateway index to runtime manifest"
```

---

### Task 4: Add the inspection CLI and published index/child metadata

**Files:**
- Create: `scripts/inspect-gateway-registry.ts`
- Test: `scripts/inspect-gateway-registry.unit.test.ts`
- Modify: `infra/maritime/openclaw/remote-extension-image.json`
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `pnpm inspect:gateway-registry -- --output PATH`
- Produces: closed sanitized `GatewayRegistryComparison` JSON.

- [ ] **Step 1: Write CLI and manifest failure tests**

Require:

```ts
expect(parseGatewayRegistryArguments([
  "--current-index", CURRENT_INDEX,
  "--previous-index", PREVIOUS_INDEX,
  "--output", outputPath
])).toEqual({
  currentIndex: CURRENT_INDEX,
  previousIndex: PREVIOUS_INDEX,
  outputPath
});
```

Reject a missing argument, mutable tag, non-GHCR repository, duplicate option, output outside the
configured directory, arbitrary metadata field, index/child equality, and a child not matching the
inspected descriptor.

- [ ] **Step 2: Update the committed image metadata**

Use this closed shape:

```json
{
  "schemaVersion": "2",
  "openclawVersion": "2026.7.1",
  "baseImage": "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c",
  "runtimeBaseImage": "cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f",
  "runtimeLock": "infra/maritime/openclaw/remote-extension-runtime-lock.json",
  "publicationState": "published",
  "releaseIndex": "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4",
  "runtimeManifest": "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a",
  "sourceCommit": "69fee2fcedf7d0474d5a75d64323318b993f7a6a",
  "runtimeSelectionState": "diagnostic_pending",
  "releaseProfile": "founder_browser_experimental",
  "synthetic": false,
  "deployableBeforeLiveProxyAcceptance": false
}
```

Remove the obsolete single `image` field. The config verifier requires exactly these fields and
does not treat `runtimeSelectionState: diagnostic_pending` as deployment approval.

- [ ] **Step 3: Implement the CLI with atomic private output**

The CLI writes to a caller-provided path only after both inspections and the structural diff pass.
It creates no default output file, prints only:

```json
{"outcome":"passed","runnablePlatformCount":1,"attestationManifestCount":1}
```

and never prints registry tokens, raw headers, redirect URLs, or object bodies.

- [ ] **Step 4: Add package scripts**

```json
"inspect:gateway-registry": "tsx scripts/inspect-gateway-registry.ts"
```

- [ ] **Step 5: Run tests and static config verification**

Run:

```bash
pnpm vitest run --project unit \
  scripts/inspect-gateway-registry.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
pnpm verify:remote-extension-config
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json \
  infra/maritime/openclaw/remote-extension-image.json \
  scripts/inspect-gateway-registry.ts \
  scripts/inspect-gateway-registry.unit.test.ts \
  scripts/verify-remote-extension-config.ts \
  scripts/verify-remote-extension-config.unit.test.ts
git commit -m "feat: record Gateway runtime manifest identity"
```

---

### Task 5: Add GitHub-hosted anonymous registry verification

**Files:**
- Create: `.github/workflows/verify-openclaw-gateway-registry.yml`
- Create: `scripts/verify-gateway-registry-workflow.ts`
- Test: `scripts/verify-gateway-registry-workflow.unit.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pnpm inspect:gateway-registry` from Task 4.
- Produces: PR check `Verify public Gateway registry objects`.
- Produces: sanitized artifact `vera-openclaw-gateway-registry-r3`.

- [ ] **Step 1: Write failing workflow-verifier tests**

Require the verifier to reject:

```ts
it.each([
  ["a registry secret", "secrets.GHCR_PUBLISH_TOKEN"],
  ["an image push", "docker push"],
  ["a Maritime side effect", "maritime deploy"],
  ["a mutable image", "vera-openclaw-gateway:latest"],
  ["suppressed upload failure", "if-no-files-found: warn"],
  ["unbounded runtime", "timeout-minutes: 0"]
])("rejects %s", (_label, injected) => {
  expect(findGatewayRegistryWorkflowViolations(validWorkflow + injected)).not.toEqual([]);
});
```

- [ ] **Step 2: Create the non-publishing workflow**

The workflow:

- triggers on pull requests touching Gateway registry, manifest, workflow, or validator files;
- uses `ubuntu-24.04`, Node 24, pnpm 11.14.0;
- has only `contents: read`;
- installs with `--frozen-lockfile`;
- runs `pnpm inspect:gateway-registry` with the exact immutable current and previous indexes;
- writes `release-evidence/gateway-registry/inspection.json`;
- uploads the sanitized JSON with `if-no-files-found: error` and 30-day retention;
- contains no login, package write, Docker build, image push, Maritime action, or secret.

- [ ] **Step 3: Add static verifier commands**

```json
"verify:gateway-registry-workflow": "tsx scripts/verify-gateway-registry-workflow.ts"
```

Append it to the existing CI `Verify Gateway runtime and release boundaries` step.

- [ ] **Step 4: Run focused tests**

```bash
pnpm vitest run --project unit scripts/verify-gateway-registry-workflow.unit.test.ts
pnpm verify:gateway-registry-workflow
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify-openclaw-gateway-registry.yml \
  .github/workflows/ci.yml package.json \
  scripts/verify-gateway-registry-workflow.ts \
  scripts/verify-gateway-registry-workflow.unit.test.ts
git commit -m "ci: verify public Gateway registry objects"
```

---

### Task 6: Add exact-existing-child supply-chain recovery

**Files:**
- Create: `.github/workflows/attest-openclaw-gateway-runtime.yml`
- Create: `scripts/verify-gateway-runtime-attestation-workflow.ts`
- Test: `scripts/verify-gateway-runtime-attestation-workflow.unit.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Inputs: exact source SHA, release-index digest, runtime-child digest, original verified evidence run.
- Produces: one signature, one SLSA provenance attestation, one SPDX SBOM attestation for the existing child.
- Prohibits: Docker build, Buildx build, image push, mutable reference, automatic trigger, Maritime action.

- [ ] **Step 1: Write workflow-verifier tests**

Require:

- index and child match `sha256:` syntax and fixed repository;
- merged-main ancestry;
- registry inspection proves the index contains the child;
- anonymous child pull and image-layout verification precede login;
- Trivy 0.72.0 fresh SBOM and zero-finding scan precede login;
- parent index, child, source, OpenClaw base, Chainguard base, runtime lock, and publication run are bound;
- provenance and SBOM subject the child digest;
- Cosign signs and verifies the child;
- GitHub attestations verify the child;
- all Actions are commit-pinned;
- no automatic trigger, build, push, publication, or deployment command exists.

- [ ] **Step 2: Create the manual exact-child workflow**

Use these inputs:

```yaml
on:
  workflow_dispatch:
    inputs:
      source_sha:
        required: true
        type: string
      release_index_digest:
        required: true
        type: string
      runtime_manifest_digest:
        required: true
        type: string
      evidence_run_id:
        required: true
        type: string
```

Read-only steps run before registry login:

```bash
pnpm inspect:gateway-registry -- \
  --current-index "$IMAGE_REPOSITORY@$RELEASE_INDEX_DIGEST" \
  --previous-index "$PREVIOUS_RELEASE_INDEX" \
  --output release-evidence/gateway-runtime/inspection.json
docker pull "$IMAGE_REPOSITORY@$RUNTIME_MANIFEST_DIGEST"
node scripts/verify-gateway-image-layout.mjs \
  --image-ref "$IMAGE_REPOSITORY@$RUNTIME_MANIFEST_DIGEST" \
  --simulate-bootstrap
trivy --config /dev/null image --quiet --ignorefile /dev/null --list-all-pkgs \
  --scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1 \
  "$IMAGE_REPOSITORY@$RUNTIME_MANIFEST_DIGEST"
```

After zero findings, login with the temporary `GHCR_PUBLISH_TOKEN`, attest the existing child,
sign it, and verify all evidence. The provenance predicate names the release index as a resolved
dependency and the child as the immutable subject; it does not claim a new build.

- [ ] **Step 3: Add package and CI static-verifier commands**

```json
"verify:gateway-runtime-attestation-workflow":
  "tsx scripts/verify-gateway-runtime-attestation-workflow.ts"
```

- [ ] **Step 4: Run focused tests**

```bash
pnpm vitest run --project unit \
  scripts/verify-gateway-runtime-attestation-workflow.unit.test.ts
pnpm verify:gateway-runtime-attestation-workflow
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/attest-openclaw-gateway-runtime.yml \
  .github/workflows/ci.yml package.json \
  scripts/verify-gateway-runtime-attestation-workflow.ts \
  scripts/verify-gateway-runtime-attestation-workflow.unit.test.ts
git commit -m "ci: attest existing Gateway runtime manifest"
```

---

### Task 7: Document the R3 procedure and failure interpretation

**Files:**
- Modify: `docs/RELEASE_READINESS.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `infra/maritime/OPENCLAW.md`
- Modify: `scripts/verify-release-documentation.ts`
- Modify: `scripts/verify-release-documentation.unit.test.ts`

**Interfaces:**
- Consumes: exact commands from Tasks 4-6.
- Produces: one operator-safe, secret-free R3 procedure.

- [ ] **Step 1: Add failing documentation assertions**

Require documentation to name:

- release index and runtime child as different immutable identities;
- exact current and previous index digests;
- exact child digest;
- fifteen-minute matrix timeout;
- A/B/C interpretation table;
- no public route or pairing on the matrix agent;
- direct-child supply-chain workflow;
- compatibility publication preconditions;
- pinned Skopeo command;
- cleanup and provider escalation fields.

- [ ] **Step 2: Update the documentation**

Include the independent child copy:

```bash
docker run --rm \
  -v "$R3_OCI_OUTPUT:/var/lib/vera-output" \
  quay.io/skopeo/stable@sha256:47853bb9fb24202af9110531ebd6e43c5f97701254ca290596640290d17942f4 \
  copy \
  --override-os linux \
  --override-arch amd64 \
  docker://ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a \
  oci:/var/lib/vera-output/runtime:accepted
```

`R3_OCI_OUTPUT` must be a newly created mode-`0700` temporary directory outside Git and must be
removed after digest verification.

- [ ] **Step 3: Run documentation tests**

```bash
pnpm vitest run --project unit scripts/verify-release-documentation.unit.test.ts
pnpm verify:release-documentation
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/RELEASE_READINESS.md docs/SECURITY_REVIEW.md \
  infra/maritime/OPENCLAW.md \
  scripts/verify-release-documentation.ts \
  scripts/verify-release-documentation.unit.test.ts
git commit -m "docs: add Maritime image-pull R3 procedure"
```

---

### Task 8: Run local registry, child, transport, and supply-chain validation

**Files:**
- Create privately: `release-evidence/private/m13a-r3-maritime-image-pull-20260727-01/`
- Do not commit private evidence.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: sanitized registry inspection, structural diff, direct pull, Skopeo copy, image-layout, transport, snapshot, and scan evidence.

- [ ] **Step 1: Create the private evidence directory**

```bash
install -d -m 0700 \
  release-evidence/private/m13a-r3-maritime-image-pull-20260727-01
```

- [ ] **Step 2: Inspect and verify both public images**

```bash
pnpm inspect:gateway-registry -- \
  --current-index \
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4 \
  --previous-index \
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3 \
  --output \
  release-evidence/private/m13a-r3-maritime-image-pull-20260727-01/registry-inspection.json
chmod 0600 \
  release-evidence/private/m13a-r3-maritime-image-pull-20260727-01/registry-inspection.json
```

Expected: one runnable current child, one current attestation descriptor, all config/layer
digests and lengths verified, no zstd.

- [ ] **Step 3: Pull and copy the direct child independently**

```bash
docker pull \
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a
```

Create a fresh `mktemp -d` output directory, run the pinned Skopeo command from Task 7, inspect
`index.json` and `blobs/sha256`, verify the accepted manifest digest, then remove that exact
temporary directory.

- [ ] **Step 4: Run child image and local Gateway acceptance**

```bash
node scripts/verify-gateway-image-layout.mjs \
  --image-ref \
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a \
  --simulate-bootstrap
pnpm verify:gateway-runtime-supply-chain
pnpm vitest run --project unit \
  infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  infra/maritime/openclaw/vera-read-shared-tab/index.unit.test.ts \
  scripts/staging/remote-extension-proxy-smoke.unit.test.ts \
  scripts/staging/websocket-transport-probe.unit.test.ts
```

For the official-extension snapshot, create Docker network
`vera-m13a-r3-local`, start container `vera-m13a-r3-gateway-local` from the exact child with a
fresh unprinted 32-byte Gateway token, and bind only loopback test ports. Copy
`/app/dist/extensions/browser/chrome-extension` from that container into a new system temporary
directory. Launch `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with a new
`--user-data-dir`, `--disable-extensions-except`, and `--load-extension`. Pair the popup, share one
inert `https://example.com/` tab, then invoke only:

```bash
docker exec -u 1000:1000 vera-m13a-r3-gateway-local \
  node --input-type=module -e \
  'import { readSharedTabSnapshot } from "/opt/vera/plugins/vera-read-shared-tab/index.mjs"; const result = await readSharedTabSnapshot({}); process.stdout.write(JSON.stringify(result));'
```

Redirect the snapshot to a mode-`0600` private file without printing it. Validate at most 24
bounded lines, origin-only URL, hashes present, and no query, fragment, form value, email, phone,
target ID, profile path, screenshot, or raw snapshot. Unshare, require `no_shared_tab`, unpair,
stop the disposable Chrome process and container, delete the exact temporary Chrome/extension
directories, and remove only Docker network `vera-m13a-r3-local`.

- [ ] **Step 5: Run Trivy 0.72.0 against the child**

Require zero `HIGH` and zero `CRITICAL`, no ignore policy, no skipped DB update, and write only the
sanitized JSON under the private R3 directory.

- [ ] **Step 6: Run repository validation**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test \
  pnpm test:integration:postgres
pnpm build
git diff --check
```

Expected: all pass. Scan changed files and private sanitized JSON for likely secrets. Confirm
`git ls-files 'release-evidence/private/**'` is empty.

---

### Task 9: Push, open, CI-gate, and merge the R3 diagnostics PR

**Files:**
- No new source files.

**Interfaces:**
- Produces: merged exact-source diagnostics and GitHub-hosted blob evidence.

- [ ] **Step 1: Verify branch isolation and diff**

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git diff origin/main...HEAD --check
git ls-files 'release-evidence/private/**'
```

Expected: correct isolated worktree/branch, clean status, no tracked private evidence.

- [ ] **Step 2: Push the exact branch**

```bash
git push -u origin codex/maritime-image-pull-r3
```

- [ ] **Step 3: Open the focused PR**

Title:

```text
fix: add Maritime Gateway pull compatibility diagnostics
```

The body states the current/previous index structures, child digest, anonymous object checks,
binding semantics, no-publication behavior, child attestation recovery, local commands/results,
and current `no_go`.

- [ ] **Step 4: Wait for required CI on the exact head**

Require:

- `Verify workspace`;
- `Build and zero-scan Gateway image`;
- `Verify public Gateway registry objects`.

Download the registry artifact and verify it binds the exact current index and child.

- [ ] **Step 5: Merge only if green and mergeable**

Squash title:

```text
fix: add Maritime Gateway pull compatibility diagnostics
```

Delete the remote feature branch, fast-forward local main, and record the merged SHA.

---

### Task 10: Verify or recover exact-child supply-chain evidence

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: merged Task 9 workflow and the current index/child.
- Produces: verified child signature, SLSA provenance, SPDX SBOM, and zero scan.

- [ ] **Step 1: Inspect existing index and child referrers**

Use pinned Cosign `3.0.6`, `cosign tree`, `cosign verify`, and GitHub attestation verification.
Record only subject digests, signer identity, predicate types, and verification outcomes.

- [ ] **Step 2: Skip registry writes if direct child evidence already passes**

If the child has a valid Cosign signature and both required attestations naming
`bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a`, write a sanitized
verification record and do not dispatch the recovery workflow.

- [ ] **Step 3: Otherwise create the temporary Actions secret without printing**

Pipe the current package-write credential directly into:

```bash
gh secret set GHCR_PUBLISH_TOKEN
```

Never print, store, or pass the credential as a command-line argument.

- [ ] **Step 4: Dispatch the exact-child workflow once**

Inputs:

```text
source_sha=69fee2fcedf7d0474d5a75d64323318b993f7a6a
release_index_digest=sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
runtime_manifest_digest=sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a
evidence_run_id=30298185379
```

Wait for the one run to complete. Do not rebuild or publish image content.

- [ ] **Step 5: Delete the temporary secret immediately**

```bash
gh secret delete GHCR_PUBLISH_TOKEN
gh secret list --app actions
```

Expected: the temporary secret is absent.

- [ ] **Step 6: Independently verify and bind the child**

Download the workflow artifact, independently verify the child signature and both attestation
subjects, then generate the deterministic runtime-binding record using Task 3. Require zero
validation violations and matching declared/recomputed content hashes.

---

### Task 11: Run the bounded Maritime A/B/C pull matrix

**Files:**
- Private evidence only.

**Interfaces:**
- Uses exactly one private non-production custom diagnostic agent.
- Produces terminal observations for A, B, and C.

- [ ] **Step 1: Create one non-public diagnostic agent**

Create a custom, always-on diagnostic agent without `--public`, without port exposure, and without
credentials or triggers. Store raw IDs only in a temporary mode-`0600` file.

- [ ] **Step 2: Case A — previous index**

Deploy:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@
sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3
```

Wait at most fifteen minutes. Require terminal history or runtime startup. A later known
`/usr/local/bin` bootstrap failure still proves image retrieval.

- [ ] **Step 3: Case B — current index**

Deploy:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@
sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
```

Use the same bound and evidence fields.

- [ ] **Step 4: Case C — direct current child**

Deploy:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@
sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a
```

Require fc-manager or runtime progress, not API acceptance.

- [ ] **Step 5: Delete the matrix agent**

Delete it on success or failure, confirm absence, confirm zero triggers, destroy raw ID files, and
preserve only sanitized observations and hashes.

- [ ] **Step 6: Apply the fixed decision table**

- A/B/C all hang: provider incident, no compatibility image, `no_go`.
- A works, B hangs, C works: use C, no compatibility image.
- A works, B hangs, C hangs with verified blob success but concrete media incompatibility:
  execute Task 12.
- C starts regardless of B: use C and continue to Task 13.

---

### Task 12: Conditionally publish one compatibility image

**Condition:** Execute only when Task 11 proves the existing child format is incompatible and the
failure is not a general provider incident.

**Files:**
- Create: `.github/workflows/release-openclaw-gateway-compatibility.yml`
- Create: `scripts/verify-gateway-compatibility-workflow.ts`
- Test: `scripts/verify-gateway-compatibility-workflow.unit.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: release/security/Maritime documentation

**Interfaces:**
- Produces exactly one Docker-V2/gzip/single-amd64 compatibility digest.

- [ ] **Step 1: Add failing static workflow tests**

Require:

```yaml
platforms: linux/amd64
outputs: type=image,push=true,oci-mediatypes=false,compression=gzip,force-compression=true
provenance: false
sbom: false
```

Require exact-source ancestry, unchanged Dockerfile/base/runtime lock, filesystem/config hash
comparison, zero scan, post-push signature/provenance/SBOM, and one publication job.

- [ ] **Step 2: Implement and locally verify the workflow**

The workflow builds the unchanged source once with the compatibility exporter. It rejects any
OCI index, zstd layer, non-Docker-V2 manifest, second runnable platform, changed application tree,
changed runtime config, or changed executable inventory.

- [ ] **Step 3: Open and merge the focused conditional PR**

Require the same local checks and all required CI before merge.

- [ ] **Step 4: Publish exactly once**

Create the temporary package credential, dispatch once from exact merged main, delete the secret
at terminal state, and independently verify the resulting digest. Never publish a second candidate.

- [ ] **Step 5: Test the compatibility digest on one new private diagnostic agent**

Require pull, fc-manager, supervisor, UID/GID, and three listeners. If it fails, test one small
public Docker Hub image and one small public GHCR image on the same agent, collect the sanitized
provider escalation, delete the agent, and stop `no_go`.

---

### Task 13: Run final disposable Gateway transport and security acceptance

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: accepted runtime digest from Task 11 or 12.
- Produces: live bootstrap, helper, WSS, route, origin, stability, payload, timeout, and audit evidence.

- [ ] **Step 1: Create one final public always-on Gateway**

Expose port `18789`, create one fresh unprinted Gateway token, create no model credential, and
confirm zero triggers.

- [ ] **Step 2: Verify bootstrap and runtime**

Require:

- supervisor UID/GID `1000:1000`;
- `/usr/local/bin` provider helper inventory is sanitized and acceptable;
- `0.0.0.0:18789`;
- `127.0.0.1:18790`;
- `127.0.0.1:18792`;
- no other public listener;
- `/usr/bin/node` only in immutable executable inventory;
- `/usr/local/bin` absent from PATH;
- no injected shell, package manager, or unexpected symlink/executable.

- [ ] **Step 3: Verify public transport**

Run existing HTTP and WebSocket probes for unrelated-route denial, wrong-secret denial, correct
`101`, selected `openclaw-extension-relay`, valid/invalid Origin, ping/pong, fifteen-to-thirty
second stability, bounded payload, safe timeout, and Control UI absence.

- [ ] **Step 4: Run shallow and deep audits**

Seed only the temporary read-only audit identity, run both OpenClaw audits, require zero critical
and zero warnings, remove the identity, and verify removal.

- [ ] **Step 5: Pause for the manual Chrome checkpoint**

Load the reviewed official extension, place a fresh pairing string on the clipboard without
printing it, open `https://example.com/`, share exactly one tab, and ask the founder to confirm.

---

### Task 14: Complete the one-tab snapshot after founder confirmation

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: one confirmed shared inert tab.
- Produces: one minimized snapshot and revocation evidence.

- [ ] **Step 1: Execute one minimized read-only snapshot**

Invoke `readSharedTabSnapshot({})` once and preserve only minimized text, counts, origin-only URL,
and content/source hashes in the private evidence boundary.

- [ ] **Step 2: Verify noninteraction**

Confirm no navigation, click, typing, form, upload, download, screenshot retention, cookie,
storage, history, or unrelated-tab operation occurred.

- [ ] **Step 3: Unshare and verify denial**

Unshare the tab and require the next snapshot attempt to return `no_shared_tab`.

- [ ] **Step 4: Revoke pairing and test replay denial**

Unpair the extension, destroy the clipboard value, attempt the old pairing protocol once, and
require denial.

---

### Task 15: Validate R3 evidence, clean up, and classify

**Files:**
- Private: `release-evidence/private/m13a-r3-maritime-image-pull-20260727-01/`

**Interfaces:**
- Produces: strict release-evidence records, deterministic bundle hash, sanitized decision summary.

- [ ] **Step 1: Generate the closed R3 bundle**

Bind the exact release index, deployed runtime digest, source revision, OpenClaw `2026.7.1`,
extension `2.0.0`, hashed Maritime environment reference, profile, phase records, artifact hashes,
and approval state. Compute every record hash and the canonical bundle hash.

- [ ] **Step 2: Validate fail-closed classification**

Require zero schema violations. Return `passed_13a` only when all live conditions in the design
pass; otherwise require `founder_browser_experimental=no_go`.

- [ ] **Step 3: Clean all external and local state**

Unshare/unpair, revoke credentials, delete every agent, confirm former endpoints `404`, confirm
zero triggers, delete Actions secrets and temporary files, preserve only sanitized mode-`0600`
evidence, and keep previous bundles unchanged.

- [ ] **Step 4: Final repository audit**

```bash
git status --short
git ls-files 'release-evidence/private/**'
git diff --check
```

Expected: clean worktree and zero tracked private evidence.

- [ ] **Step 5: Report all fifteen required R3 outcomes**

Report current index media type, child digest, attestation descriptors, structural diff, blob
verification, pull matrix, child result, compatibility decision/digest, runtime, WSS/Chrome,
bundle SHA-256, cleanup, classification, and Milestone 13B authorization state.
