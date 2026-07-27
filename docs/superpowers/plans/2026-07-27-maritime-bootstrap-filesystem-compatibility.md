# Maritime Bootstrap Filesystem Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and live-test exactly one replacement Vera OpenClaw Gateway whose immutable image contains an empty root-owned `/usr/local/bin` directory without adding an executable or weakening Milestone 13A.

**Architecture:** Create the missing directory with final-stage Docker `WORKDIR` metadata while the build identity is root, restore `/app`, and constrain runtime `PATH` to `/usr/bin`. A reusable host-side image-layout verifier enforces filesystem, identity, executable, and simulated provider-bootstrap invariants in local checks, CI, publication, and attestation; the existing transport and browser boundaries remain unchanged.

**Tech Stack:** Docker BuildKit, Chainguard Node, OpenClaw `2026.7.1`, Node.js ESM, TypeScript, Vitest, pnpm, GitHub Actions, Trivy `0.72.0`, Cosign, GitHub attestations, Maritime CLI `1.7.0`.

## Global Constraints

- Work only in `/private/tmp/vera-founder-staging-evidence-pr` on `codex/founder-browser-remote-extension`.
- Preserve `ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c`.
- Preserve `cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f`.
- Preserve OpenClaw `2026.7.1`, UID/GID `1000:1000`, working directory `/app`, and entrypoint `/usr/bin/node /opt/vera/bin/remote-extension-supervisor.mjs`.
- Add no BusyBox, shell, Coreutils, curl, Git, npm, pnpm, yarn, Corepack, package manager, or other executable.
- Keep `/usr/local/bin` outside application `PATH`; application `PATH` is exactly `/usr/bin`.
- Keep public port `18789`, internal Gateway port `18790`, browser-control port `18792`, exact route `/browser/extension`, pairing, Origin, and subprotocol enforcement unchanged.
- Publish exactly one replacement image, create exactly one disposable Maritime agent, and always remove temporary credentials and infrastructure.
- Keep all real evidence gitignored under `release-evidence/private/` with directory mode `0700` and file mode `0600`.
- Do not modify the landing page, browse rental sites, access marketplace accounts, implement source adapters, or begin Milestone 13B.

---

### Task 1: Add failing static filesystem-boundary tests

**Files:**
- Modify: `scripts/verify-gateway-runtime-supply-chain.unit.test.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`

**Interfaces:**
- Consumes: `findGatewayRuntimeSupplyChainViolations(input)` and `findRemoteExtensionConfigViolations(input)`.
- Produces: regression cases that require root metadata creation, restored workdir, constrained PATH, and no copied helper.

- [ ] **Step 1: Add table-driven supply-chain mutations**

Add mutations that remove or alter each approved invariant:

```ts
[
  "missing provider bootstrap directory",
  (input) => {
    input.dockerfile = input.dockerfile.replace("WORKDIR /usr/local/bin\n", "");
  }
],
[
  "provider bootstrap directory created as runtime user",
  (input) => {
    input.dockerfile = input.dockerfile.replace(
      "USER 0:0\nWORKDIR /usr/local/bin",
      "USER 1000:1000\nWORKDIR /usr/local/bin"
    );
  }
],
[
  "provider bootstrap directory added to PATH",
  (input) => {
    input.dockerfile = input.dockerfile.replace(
      "PATH=/usr/bin",
      "PATH=/usr/local/bin:/usr/bin"
    );
  }
],
[
  "provider helper copied into immutable image",
  (input) => {
    input.dockerfile +=
      "\nCOPY --from=vera-layout /opt/provider-helper /usr/local/bin/provider-helper\n";
  }
]
```

- [ ] **Step 2: Add remote-extension configuration mutations**

Add focused tests requiring the final image to restore `/app`, constrain PATH, and retain its
fixed identity:

```ts
it.each([
  ["missing bootstrap directory", "WORKDIR /usr/local/bin\n", ""],
  ["wrong runtime path", "PATH=/usr/bin", "PATH=/usr/local/bin:/usr/bin"],
  ["wrong application workdir", "WORKDIR /app", "WORKDIR /srv"]
])("rejects an image with %s", (_label, before, after) => {
  const input = fixture();
  input.dockerfile = input.dockerfile.replace(before, after);
  expect(findRemoteExtensionConfigViolations(input)).toContain(
    "Hardened Gateway image must preserve the provider-compatible filesystem and constrained runtime."
  );
});
```

- [ ] **Step 3: Run the two focused test files and confirm failure**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
```

Expected: new cases fail because the current validators do not require the filesystem boundary.

### Task 2: Implement static filesystem-boundary validation

**Files:**
- Modify: `scripts/verify-gateway-runtime-supply-chain.ts`
- Modify: `scripts/verify-remote-extension-config.ts`

**Interfaces:**
- Consumes: the final-stage Dockerfile text already passed to both validators.
- Produces: closed static checks for the one approved directory-creation mechanism and PATH.

- [ ] **Step 1: Add the approved Dockerfile boundary constants**

Add:

```ts
const PROVIDER_BOOTSTRAP_DIRECTORY = "WORKDIR /usr/local/bin";
const APPLICATION_WORKDIR = "WORKDIR /app";
const CONSTRAINED_PATH = "PATH=/usr/bin";
```

- [ ] **Step 2: Require the ordered metadata sequence**

In `findGatewayRuntimeSupplyChainViolations`, require this exact order inside the final stage:

```ts
const providerLayoutPattern =
  /USER 0:0\s+WORKDIR \/usr\/local\/bin\s+WORKDIR \/app[\s\S]*ENV PATH=\/usr\/bin\b/u;

if (
  !providerLayoutPattern.test(finalStage) ||
  /(?:COPY|ADD|RUN)[^\n]*\/usr\/local\/bin/iu.test(finalStage)
) {
  violations.push(
    "Final Gateway runtime must create one empty provider bootstrap directory through root-owned Docker metadata and exclude it from PATH."
  );
}
```

Retain the existing prohibition on copying `/usr/local`, system binaries, or a complete root
filesystem from an earlier stage.

- [ ] **Step 3: Extend the remote-extension validator**

Require:

```ts
dockerfile.includes("USER 0:0\nWORKDIR /usr/local/bin\nWORKDIR /app") &&
dockerfile.includes("ENV PATH=/usr/bin") &&
dockerfile.includes("USER 1000:1000")
```

Emit:

```text
Hardened Gateway image must preserve the provider-compatible filesystem and constrained runtime.
```

- [ ] **Step 4: Run focused tests**

Run the Task 1 Vitest command.

Expected: tests still fail only because the Dockerfile has not yet adopted the approved layout.

### Task 3: Apply the metadata-only Dockerfile repair

**Files:**
- Modify: `infra/maritime/openclaw/remote-extension.Dockerfile`

**Interfaces:**
- Consumes: unchanged immutable source and runtime bases.
- Produces: an empty root-owned `/usr/local/bin`, restored `/app`, PATH `/usr/bin`, unchanged runtime identity and entrypoint.

- [ ] **Step 1: Change only final-stage metadata**

Replace the start of the final stage with:

```dockerfile
FROM cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f AS final

USER 0:0
WORKDIR /usr/local/bin
WORKDIR /app
```

Remove the later redundant `USER 0:0`, retain the Node-only pruning `RUN`, and change the
environment block to:

```dockerfile
ENV PATH=/usr/bin \
  HOME=/data \
  OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json \
  OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1 \
  OPENCLAW_HEADLESS=true \
  OPENCLAW_STATE_DIR=/data/.openclaw
```

Advance only the Vera repair label:

```dockerfile
org.opencontainers.image.version="2026.7.1-vera.3"
```

- [ ] **Step 2: Run static validators and focused tests**

Run:

```bash
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm exec vitest run --project unit \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
```

Expected: all commands pass.

### Task 4: Add a reusable image-layout and simulated-bootstrap verifier

**Files:**
- Create: `scripts/verify-gateway-image-layout.mjs`
- Create: `scripts/verify-gateway-image-layout.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: a concrete local tag or immutable digest through `--image-ref`, plus optional
  `--simulate-bootstrap`.
- Produces: a sanitized JSON summary or nonzero exit with a closed violation list.

- [ ] **Step 1: Write failing pure-observation tests**

Export `findGatewayImageLayoutViolations(observation)` and cover valid plus mutations for:

```ts
const valid = {
  uid: 1000,
  gid: 1000,
  cwd: "/app",
  path: "/usr/bin",
  localBin: {
    isDirectory: true,
    isSymbolicLink: false,
    uid: 0,
    gid: 0,
    mode: 0o755,
    entries: []
  },
  usrBinEntries: ["node"],
  bannedPathsPresent: [],
  entrypoint: ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]
};
```

Mutate every field individually and require at least one violation. Add a simulated-bootstrap
result fixture requiring `created`, root ownership, mode `0500`, `removed`, and `directoryEmpty`.

- [ ] **Step 2: Confirm the new tests fail**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-gateway-image-layout.unit.test.ts
```

Expected: fail because the verifier does not exist.

- [ ] **Step 3: Implement the pure validator and Docker CLI**

The CLI must:

1. Parse only `--image-ref` and `--simulate-bootstrap`.
2. Run `docker image inspect` and one default-user `/usr/bin/node -e` observation.
3. Use `lstatSync` for `/usr/local/bin`, record numeric ownership/mode, and list entries.
4. Check `/usr/bin`, known banned paths, UID/GID, cwd, PATH, and image entrypoint.
5. When requested, run a second ephemeral container with `--user 0:0`.
6. Create `/usr/local/bin/maritime-bootstrap-layout-probe` with mode `0500`, `lstat` it, remove it
   in `finally`, and verify the directory is empty.
7. Print only closed booleans, numeric metadata, and the fixed probe name; never environment
   values other than the exact PATH assertion.

Use `spawnSync("docker", args, { encoding: "utf8" })` with argument arrays and no shell.

- [ ] **Step 4: Add the package command**

Add:

```json
"verify:gateway-image-layout": "node scripts/verify-gateway-image-layout.mjs"
```

- [ ] **Step 5: Run unit tests and formatting**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-gateway-image-layout.unit.test.ts
pnpm exec prettier --check scripts/verify-gateway-image-layout.mjs \
  scripts/verify-gateway-image-layout.unit.test.ts package.json
```

Expected: pass.

### Task 5: Enforce the layout in CI, release, and attestation workflows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-openclaw-gateway.yml`
- Modify: `.github/workflows/attest-openclaw-gateway.yml`
- Modify: `scripts/verify-gateway-release-workflow.ts`
- Modify: `scripts/verify-gateway-release-workflow.unit.test.ts`

**Interfaces:**
- Consumes: `scripts/verify-gateway-image-layout.mjs`.
- Produces: identical local-image, published-image, and retained-image layout gates.

- [ ] **Step 1: Replace duplicated inline identity checks**

In CI run:

```bash
node scripts/verify-gateway-image-layout.mjs \
  --image-ref vera-openclaw-gateway:ci \
  --simulate-bootstrap
```

In release and attestation workflows run:

```bash
node scripts/verify-gateway-image-layout.mjs \
  --image-ref "$GATEWAY_IMAGE_REF" \
  --simulate-bootstrap
```

Keep the immutable source/base label checks and Trivy gates.

- [ ] **Step 2: Extend the workflow static verifier**

Require each relevant workflow to contain:

```text
scripts/verify-gateway-image-layout.mjs
--simulate-bootstrap
```

Reject reintroduction of an inline layout check that omits `/usr/local/bin`, PATH, or the simulated
bootstrap.

- [ ] **Step 3: Add workflow mutation tests**

Delete the script invocation, delete `--simulate-bootstrap`, and replace the image reference with a
mutable tag in separate fixtures. Each mutation must produce a violation.

- [ ] **Step 4: Run workflow and Gateway tests**

Run:

```bash
pnpm verify:gateway-release-workflow
pnpm exec vitest run --project unit \
  scripts/verify-gateway-release-workflow.unit.test.ts \
  scripts/verify-gateway-image-layout.unit.test.ts
```

Expected: pass.

### Task 6: Document immutable versus provider-injected executables

**Files:**
- Modify: `infra/maritime/OPENCLAW.md`
- Modify: `docs/RELEASE_READINESS.md`

**Interfaces:**
- Consumes: the approved image and live acceptance boundaries.
- Produces: operator-facing distinction between immutable shipped contents and runtime provider artifacts.

- [ ] **Step 1: Add the filesystem compatibility contract**

Document:

- the published image has an empty root-owned `0755` `/usr/local/bin`;
- application PATH is `/usr/bin`;
- the immutable executable inventory remains only Node;
- the directory exists solely for the privileged Maritime bootstrap boundary;
- Vera never ships or retains the provider helper; and
- live evidence records only the sanitized helper metadata authorized by the design.

- [ ] **Step 2: Add the stop condition**

State that unexpected executables, symlinks, shell tools, PATH expansion, or UID `1000` execution
surface force `founder_browser_experimental=no_go`.

- [ ] **Step 3: Run documentation-related validators**

Run:

```bash
pnpm maritime:validate
pnpm verify:remote-extension-config
pnpm format:check
```

Expected: pass.

### Task 7: Build and validate the local replacement candidate

**Files:**
- No source files added.
- Private outputs: a new directory under `release-evidence/private/`, mode `0700`, files `0600`.

**Interfaces:**
- Consumes: exact committed repair source.
- Produces: local build, runtime layout, transport, zero-finding, and secret-scan evidence.

- [ ] **Step 1: Commit implementation files**

Before committing, verify the exact worktree and that only approved files are staged. Commit:

```text
fix: add Maritime bootstrap filesystem compatibility
```

- [ ] **Step 2: Build the linux/amd64 candidate**

Resolve the exact commit into `REPAIR_SOURCE_SHA`, then run:

```bash
docker buildx build \
  --platform linux/amd64 \
  --pull \
  --load \
  --build-arg "VERA_SOURCE_COMMIT=$REPAIR_SOURCE_SHA" \
  --file infra/maritime/openclaw/remote-extension.Dockerfile \
  --tag vera-openclaw-gateway:bootstrap-repair-local \
  infra/maritime/openclaw
```

- [ ] **Step 3: Run image-layout and simulated-bootstrap checks**

Run:

```bash
pnpm verify:gateway-image-layout -- \
  --image-ref vera-openclaw-gateway:bootstrap-repair-local \
  --simulate-bootstrap
```

Expected: root-owned `0755` empty directory, PATH `/usr/bin`, only Node, simulated helper removed.

- [ ] **Step 4: Run transport and snapshot tests**

Run focused unit suites for the supervisor, route filter, diagnostic server, proxy, transport, and
snapshot plugin. Start the local exact image through the existing loopback smoke procedures and
require route `404`, wrong-secret `401`, correct `101`, selected
`openclaw-extension-relay`, ping/pong, bounded stability, and one official-extension inert-page
snapshot.

- [ ] **Step 5: Run zero-finding and secret gates**

Run Trivy `0.72.0` with `--ignorefile /dev/null`, `--ignore-unfixed=false`,
`--severity HIGH,CRITICAL`, and `--exit-code 1`. Scan committed diffs and sanitized outputs for
credentials, raw agent IDs, private endpoints, browser content, and environment files.

- [ ] **Step 6: Run full repository validation**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration:postgres
pnpm build
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm verify:gateway-release-workflow
pnpm maritime:validate
git diff --check
```

Expected: every command passes before remote action.

### Task 8: Open, gate, and merge the focused PR

**Files:**
- No additional source changes unless CI exposes a directly related defect.

**Interfaces:**
- Consumes: exact clean local head with all validation passing.
- Produces: one merged main commit.

- [ ] **Step 1: Push the expected branch and open the PR**

Use title:

```text
fix: add Maritime bootstrap filesystem compatibility
```

The body records the pre-entrypoint failure, absence of `/usr/local/bin`, metadata-only directory,
no shipped helper/shell, exact tests, provider-helper inspection boundary, and current
`no_go` classification.

- [ ] **Step 2: Wait for exact-head CI**

Require all required checks to pass and GitHub to report the PR mergeable. If a check fails, make
only the smallest directly related fix, rerun affected and full gates, push once, and wait again.

- [ ] **Step 3: Squash merge and update the isolated branch**

Use the same commit title, delete the remote feature branch, fetch merged main, and record the
exact merged source SHA. Do not dispatch publication before the merge is verified.

### Task 9: Publish and independently verify exactly one replacement image

**Files:**
- Private evidence only under a new gitignored identifier.

**Interfaces:**
- Consumes: exact merged main SHA and the one authorized publication credential.
- Produces: one immutable replacement digest with verified supply-chain evidence.

- [ ] **Step 1: Create the temporary Actions secret without printing it**

Pass the authorized `write:packages` credential on stdin to create `GHCR_PUBLISH_TOKEN`. Verify only
the secret name exists; never read the value.

- [ ] **Step 2: Dispatch the release workflow exactly once**

Dispatch `.github/workflows/release-openclaw-gateway.yml` on `main` with the exact merged SHA.
Record the run ID and do not retry publication if it fails.

- [ ] **Step 3: Delete the temporary secret at terminal state**

Delete `GHCR_PUBLISH_TOKEN` immediately after the run succeeds or fails. Confirm its name is absent.

- [ ] **Step 4: Verify the one published subject**

Require one immutable digest, anonymous pull, exact source/base/OpenClaw labels, runtime layout,
simulated bootstrap, zero Trivy findings, SPDX SBOM, SLSA provenance, Cosign signature, and
attestation binding. Use only the digest reference in later commands and evidence.

### Task 10: Run one disposable Maritime bootstrap and transport acceptance

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: the verified immutable replacement digest.
- Produces: sanitized bootstrap/helper/transport observations or an exact fail-closed boundary.

- [ ] **Step 1: Create one disposable custom always-on agent**

Use port `18789`, zero triggers, no model credentials, and one fresh Gateway credential stored only
in a mode-`0600` temporary file. Retain only a SHA-256 reference to the environment identity.

- [ ] **Step 2: Verify bootstrap before Chrome**

Require VM ready state, Node supervisor UID/GID `1000:1000`, exact three listeners, no unexpected
public listener, unrelated-route `404`, and no Control UI.

- [ ] **Step 3: Inventory only sanitized provider helper metadata**

Record opaque helper identifier, SHA-256, ownership, mode, persistence, PATH membership, UID
`1000` invocation result, and counts of unexpected executables/symlinks. Never retain helper bytes.
Stop as `no_go` on any broadened execution surface.

- [ ] **Step 4: Run the complete pre-pair transport matrix**

Require valid HTTPS, unrelated HTTP/WS denial, wrong-secret `401`, correct `101`, selected
`openclaw-extension-relay`, Origin acceptance/denial, preserved protocols, ping/pong, bounded
stability, safe payload/timeouts, and secret-free logs. Stop before Chrome on any failure.

### Task 11: Complete manual Chrome, live security, evidence, and cleanup

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: passing pre-pair acceptance.
- Produces: final `passed_13a` or `founder_browser_experimental=no_go`, with validated evidence and no disposable infrastructure.

- [ ] **Step 1: Pair only the reviewed extension**

Generate one fresh pairing string without printing it, place it temporarily on the clipboard, pair
installed Chrome, and share exactly one inert `https://example.com/` tab.

- [ ] **Step 2: Execute one minimized snapshot and revocation proof**

Request one read-only minimized snapshot. Verify no navigation, interaction, forms, files,
screenshots, cookies, storage, history, or unrelated tabs. Unshare and require the next request to
fail `no_shared_tab`; revoke pairing.

- [ ] **Step 3: Run live security acceptance**

Run shallow/deep OpenClaw audits, wrong and revoked secret tests, pairing replay denial,
restart/reconnect, inert prompt-injection, forbidden-action, unrelated-route, Control UI, executable
inventory, and secret/log scans.

- [ ] **Step 4: Generate and validate a new private evidence bundle**

Bind exact digest, merged source, OpenClaw/extension versions, Maritime environment hash, UTC
timestamp, and `founder_browser_experimental`. Canonically serialize, hash records and references,
compute the bundle SHA-256, validate the strict schema, and scan sanitized outputs.

- [ ] **Step 5: Perform mandatory cleanup in `finally`**

Unshare tabs, unpair, revoke credentials, remove temporary files, delete the one disposable agent,
confirm inventory absence, endpoint `404`, zero triggers, no temporary Actions secret, private
permissions, unchanged prior evidence, and clean Git status.

- [ ] **Step 6: Classify**

Return `passed_13a` only if every image, bootstrap, helper, transport, Chrome, revocation, security,
evidence, and cleanup gate passes. Otherwise return
`founder_browser_experimental=no_go` with the exact smallest remaining repair. Milestone 13B stays
unauthorized.
