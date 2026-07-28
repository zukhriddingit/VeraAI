# Maritime `/sbin` Bootstrap Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and live-test exactly one replacement Vera OpenClaw Gateway whose immutable image exposes the conventional empty `/usr/sbin` injection directory through `/sbin -> usr/sbin` without adding an executable or weakening Milestone 13A.

**Architecture:** Extend the existing root-only Node build instruction to normalize the two inherited Chainguard symlinks before pruning runtime tools. Static and container-level validators bind the exact filesystem shape, then the existing manual publication workflow produces one immutable signed and attested candidate for one disposable Maritime/Chrome acceptance.

**Tech Stack:** Docker BuildKit, Chainguard Node, OpenClaw `2026.7.1`, Node.js ESM, TypeScript, Vitest, pnpm, GitHub Actions, Trivy `0.72.0`, Cosign, GitHub attestations, Maritime CLI `1.7.0`.

## Global Constraints

- Work only in `/private/tmp/vera-founder-staging-evidence-pr`.
- Preserve the immutable OpenClaw and Chainguard source digests already declared in the Dockerfile.
- Preserve OpenClaw behavior, the route filter, supervisor, ports `18789`/`18790`/`18792`, runtime UID/GID `1000:1000`, `/app`, `PATH=/usr/bin`, and the fixed Node entrypoint.
- Add no shell, BusyBox, Coreutils, curl, Git, npm, pnpm, yarn, Corepack, package manager, provider helper, or additional executable.
- Keep `/usr/local/bin` as an empty root-owned `0755` directory outside `PATH`.
- Make `/usr/sbin` an empty root-owned `0755` directory and `/sbin` the exact relative symlink `usr/sbin`.
- Publish exactly one replacement candidate and create exactly one disposable Maritime Gateway.
- Keep real evidence gitignored under `release-evidence/private/`, with directories mode `0700` and files mode `0600`.
- Preserve all prior evidence byte-for-byte, do not modify the landing page, do not browse rental sites, and do not begin Milestone 13B.

---

### Task 1: Add failing static filesystem-boundary tests

**Files:**
- Modify: `scripts/verify-gateway-runtime-supply-chain.unit.test.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`

**Interfaces:**
- Consumes: `findGatewayRuntimeSupplyChainViolations(input)` and `findRemoteExtensionConfigViolations(input)`.
- Produces: regression mutations for the exact `/sbin` normalization and prohibition on immutable provider helpers.

- [ ] **Step 1: Add table-driven supply-chain mutations**

Add mutations that remove the normalization, use an absolute or wrong symlink target, leave
`/usr/sbin` as a symlink, omit the root-only metadata repair, or append a copied
`maritime-init`. Each mutation must make `findGatewayRuntimeSupplyChainViolations` return at
least one violation.

- [ ] **Step 2: Add remote-extension configuration mutations**

Add focused cases that remove each required Node filesystem operation and expect:

```text
Hardened Gateway image must preserve Maritime's empty provider-init filesystem boundary.
```

- [ ] **Step 3: Prove the tests fail first**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
```

Expected: the new cases fail because the current validators accept the Chainguard merged-`/usr`
layout.

### Task 2: Add failing image-layout and bootstrap-simulation tests

**Files:**
- Modify: `scripts/verify-gateway-image-layout.unit.test.ts`

**Interfaces:**
- Consumes: `findGatewayImageLayoutViolations(observation)` and
  `findBootstrapSimulationViolations(observation)`.
- Produces: unit fixtures for `systemSbin`, `sbin`, and bootstrap resolution through
  `/sbin/maritime-init`.

- [ ] **Step 1: Extend the valid layout fixture**

Represent:

```ts
systemSbin: {
  isDirectory: true,
  isSymbolicLink: false,
  uid: 0,
  gid: 0,
  mode: 0o755,
  entries: []
},
sbin: {
  isSymbolicLink: true,
  target: "usr/sbin"
}
```

- [ ] **Step 2: Add rejection cases**

Reject a missing or symlinked `/usr/sbin`, non-root ownership, non-`0755` mode, a nonempty
directory, a real `/sbin` directory, and any `/sbin` target other than `usr/sbin`.

- [ ] **Step 3: Extend the bootstrap fixture**

Require `helperPath === "/usr/sbin/maritime-init"`,
`bootPath === "/sbin/maritime-init"`, `bootPathResolved === true`, and cleanup that leaves
`/usr/sbin` empty.

- [ ] **Step 4: Prove the image-layout tests fail**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-gateway-image-layout.unit.test.ts
```

Expected: new assertions fail until the verifier observes and enforces the corrected paths.

### Task 3: Implement the static and runtime verifiers

**Files:**
- Modify: `scripts/verify-gateway-runtime-supply-chain.ts`
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-gateway-image-layout.mjs`

**Interfaces:**
- Consumes: Dockerfile source and runtime observations.
- Produces: fail-closed checks for the exact build operation and immutable/runtime layout.

- [ ] **Step 1: Define the approved Dockerfile operation**

Require the existing final-stage Node `RUN` source to contain all of:

```js
fs.rmSync("/sbin", { force: true });
fs.rmSync("/usr/sbin", { force: true });
fs.mkdirSync("/usr/sbin", { mode: 0o755 });
fs.chownSync("/usr/sbin", 0, 0);
fs.chmodSync("/usr/sbin", 0o755);
fs.symlinkSync("usr/sbin", "/sbin");
```

Keep the one-`RUN` rule, the exact `/usr/bin` pruning, the three immutable stages, and the
prohibition on copying system directories or provider helpers.

- [ ] **Step 2: Observe both system paths inside the image**

Extend `RUNTIME_OBSERVATION_SOURCE` to `lstat("/usr/sbin")`,
`lstat("/sbin")`, `readlink("/sbin")`, and list `/usr/sbin`. Return only filesystem metadata,
not file contents.

- [ ] **Step 3: Enforce the corrected layout**

Add deterministic violations for every `systemSbin` and `sbin` mismatch while retaining all
existing `/usr/local/bin`, identity, `PATH`, working-directory, entrypoint, and banned-path
checks.

- [ ] **Step 4: Simulate the provider path**

Change the disposable simulation directory to `/usr/sbin`, use filename `maritime-init`,
capture both helper and boot paths, verify `realpath("/sbin/maritime-init")` resolves to the
helper, delete it, and prove `/usr/sbin` is empty.

- [ ] **Step 5: Run the focused unit tests**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts \
  scripts/verify-gateway-image-layout.unit.test.ts
```

Expected: static tests remain red only because the Dockerfile has not yet adopted the layout;
image-layout pure-function tests pass.

### Task 4: Apply the minimal Dockerfile repair

**Files:**
- Modify: `infra/maritime/openclaw/remote-extension.Dockerfile`

**Interfaces:**
- Consumes: the unchanged immutable OpenClaw and Chainguard stages.
- Produces: the conventional empty system-administration path with no embedded helper.

- [ ] **Step 1: Extend the existing root-only Node instruction**

Before `/usr/bin` pruning, remove the inherited `/sbin` and `/usr/sbin` symlinks, create the
real root-owned `0755` `/usr/sbin`, and create `/sbin -> usr/sbin` using the exact operations
from Task 3.

- [ ] **Step 2: Advance only the repair revision label**

Change:

```text
org.opencontainers.image.version="2026.7.1-vera.3"
```

to:

```text
org.opencontainers.image.version="2026.7.1-vera.4"
```

- [ ] **Step 3: Run all focused static checks**

Run:

```bash
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm exec vitest run --project unit \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts \
  scripts/verify-gateway-image-layout.unit.test.ts
```

Expected: all pass.

### Task 5: Build and verify the candidate locally

**Files:**
- Create outside Git: `release-evidence/private/m13a-r3-sbin-bootstrap-20260727-01/`

**Interfaces:**
- Consumes: the exact branch head and repaired Dockerfile.
- Produces: local image-layout, bootstrap, vulnerability, transport, and source-diff evidence.

- [ ] **Step 1: Create the restricted evidence directory**

Create the distinct directory at mode `0700`; write every evidence file at mode `0600`.

- [ ] **Step 2: Build exactly `linux/amd64`**

Build a local tag with `VERA_SOURCE_COMMIT` set to the exact branch head and `--pull`.

- [ ] **Step 3: Run the image-layout verifier**

Run:

```bash
node scripts/verify-gateway-image-layout.mjs \
  --image-ref vera-openclaw-gateway:sbin-repair-local \
  --simulate-bootstrap
```

Expected: `/usr/sbin` and `/usr/local/bin` are empty real directories, `/sbin` targets
`usr/sbin`, the disposable helper resolves and is removed, and the executable allowlist is
exactly `["/usr/bin/node"]`.

- [ ] **Step 4: Run the local transport/security acceptance**

Run the existing remote-extension configuration, route-filter, supervisor, WebSocket,
subprotocol, snapshot, workflow, and supply-chain test suites. No marketplace site is opened.

- [ ] **Step 5: Enforce zero findings**

Run Trivy `0.72.0` with `/dev/null` configuration and ignore file, `--ignore-unfixed=false`,
and `--severity CRITICAL,HIGH --exit-code 1`.

- [ ] **Step 6: Run repository gates**

Run format check, lint, typecheck, affected unit tests, full unit tests, integration tests,
PostgreSQL integration tests, E2E tests, production builds, and `git diff --check`.

### Task 6: Commit, PR, CI, and merge

**Files:**
- Commit only the design, plan, Dockerfile, validators, and tests.

**Interfaces:**
- Consumes: a clean, locally passing branch.
- Produces: one reviewed merged main SHA.

- [ ] **Step 1: Review the complete diff**

Confirm no secret, private evidence, generated artifact, landing-page change, OpenClaw behavior
change, or unrelated file is tracked.

- [ ] **Step 2: Commit the implementation**

Use:

```text
fix: restore Maritime sbin bootstrap layout
```

- [ ] **Step 3: Push and open one focused PR**

Use title:

```text
fix: restore Maritime sbin bootstrap layout
```

The body records the pre-entrypoint evidence, exact filesystem-only repair, unchanged security
boundaries, and exact local validation.

- [ ] **Step 4: Wait for exact-head CI**

Merge only if every required check passes and GitHub reports the PR mergeable. Use squash title:

```text
fix: restore Maritime sbin bootstrap layout
```

Delete the remote branch and fast-forward local `main`.

### Task 7: Publish and verify exactly one replacement

**Files:**
- Create outside Git: publication evidence below the distinct private evidence directory.

**Interfaces:**
- Consumes: the exact merged main SHA.
- Produces: one immutable release index and exact `linux/amd64` child with verified supply chain.

- [ ] **Step 1: Create the temporary package-write Actions secret**

Create `GHCR_PUBLISH_TOKEN` from the already authorized current `write:packages` credential
without printing its value.

- [ ] **Step 2: Dispatch the manual Gateway publication once**

Dispatch `.github/workflows/release-openclaw-gateway.yml` on `main` with
`source_sha=<exact-merged-main-sha>`.

- [ ] **Step 3: Wait for terminal success**

Require the build, image-layout simulation, zero-finding scan, signing, SLSA provenance, SPDX
SBOM, and verification jobs to pass.

- [ ] **Step 4: Delete the temporary secret immediately**

Delete `GHCR_PUBLISH_TOKEN` whether the run succeeds or fails, and confirm the repository secret
list no longer contains it.

- [ ] **Step 5: Independently verify the published identities**

Resolve the immutable index and child digests, anonymously pull them, verify exact source
labels, run the image-layout verifier, verify Cosign/GitHub attestations, and run a fresh Trivy
zero-finding scan. Do not publish a second candidate on failure.

### Task 8: Run one disposable Maritime and Chrome acceptance

**Files:**
- Create outside Git: sanitized runtime/WSS/Chrome evidence below the distinct private directory.

**Interfaces:**
- Consumes: the fully verified immutable replacement runtime.
- Produces: one bounded Milestone 13A acceptance or an exact fail-closed boundary.

- [ ] **Step 1: Create one disposable public always-on custom Gateway**

Use the replacement immutable digest, public port `18789`, one fresh temporary Gateway
credential, and zero triggers. Add no model credential.

- [ ] **Step 2: Require provider and Vera startup**

Prove `maritime-init`, the Vera Node supervisor, route filter `18789`, OpenClaw `18790`, and
browser control `18792` reach ready state before continuing.

- [ ] **Step 3: Run automated public-edge checks**

Require unrelated-route denial, wrong-secret denial, correct `101`, exact subprotocol
selection, Origin enforcement, ping/pong, bounded stability, payload and timeout rejection,
and shallow/deep security-audit success.

- [ ] **Step 4: Pause at the manual Chrome checkpoint**

The founder loads the reviewed official extension, pairs using the fresh clipboard-only value,
opens `https://example.com/`, shares exactly one tab, and confirms.

- [ ] **Step 5: Run the read-only consent-tab checks**

Request one minimized snapshot, verify no navigation/typing/message/form/download/upload/action
occurred, have the founder unshare the tab, verify `no_shared_tab`, and revoke pairing.

- [ ] **Step 6: Clean up unconditionally**

Delete the Maritime agent, revoke credentials, confirm the public endpoint returns `404`,
confirm trigger count is zero, and retain no disposable secret or raw identifier in the
sanitized bundle.

### Task 9: Finalize evidence and classification

**Files:**
- Create outside Git: deterministic sanitized R3 repair bundle and index.

**Interfaces:**
- Consumes: all accepted local, CI, registry, Maritime, WSS, audit, and Chrome records.
- Produces: a deterministic SHA-256 bundle and final classification.

- [ ] **Step 1: Validate every record and bundle binding**

Bind the exact source commit, release index, runtime child, image config, capability profile,
environment, OpenClaw/extension versions, UTC timestamps, sanitized references, and hashes.

- [ ] **Step 2: Verify privacy and tamper controls**

Require strict schemas, no extra fields, no secrets or raw identifiers, file mode `0600`,
directory mode `0700`, no symlinks, no tracked private files, deterministic content hashes,
and a deterministic bundle hash.

- [ ] **Step 3: Return the fail-closed classification**

Return `passed_13a` only if every local, supply-chain, Maritime startup, public WSS,
consent-tab, audit, evidence, revocation, and cleanup check passed. Otherwise return
`founder_browser_experimental=no_go` with the exact unsatisfied boundary. Milestone 13B remains
unauthorized.
