# Gateway Zero-Finding Runtime Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the reviewed OpenClaw `2026.7.1` browser-extension Gateway behavior in a
linux/amd64 image that has zero Trivy `HIGH` or `CRITICAL` findings, then publish, sign, attest, and
verify exactly one replacement candidate before any Maritime deployment.

**Architecture:** Copy only `/app` from the immutable reviewed OpenClaw image, replace five
allowlisted vulnerable application package directories from integrity-pinned npm tarballs, and
copy the sanitized runtime into an immutable zero-finding Chainguard Node base. Replace the shell
entrypoint with a fail-closed Node supervisor, keep the existing route filter and OpenClaw config,
and enforce the runtime lock in static verification, CI, local image acceptance, and the manual
release workflow.

**Tech Stack:** Docker BuildKit, Node.js ESM, TypeScript, Vitest, GitHub Actions, Trivy `0.72.0`,
Cosign `3.0.6`, GitHub artifact attestations, GHCR.

## Global Constraints

- Work only in `/private/tmp/vera-founder-staging-evidence-pr` on
  `codex/founder-browser-remote-extension`.
- Preserve OpenClaw application version `2026.7.1` and upstream image
  `ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c`.
- Use final linux/amd64 runtime base
  `cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f`.
- Keep final runtime UID/GID exactly `1000:1000`.
- Retain only public `0.0.0.0:18789`, internal Gateway `127.0.0.1:18790`, and internal eager
  browser-control `127.0.0.1:18792`.
- Do not add a shell, npm, Corepack, pnpm, Git, curl, Python, Perl, Chromium, or package-manager
  cache to the final image.
- Do not use a Trivy ignore file, VEX suppression, severity downgrade, `--ignore-unfixed`, or
  scanner exclusion.
- Do not broaden browser capabilities or begin Milestone 13B.
- Publish exactly one replacement candidate and deploy nothing unless scan, signature, provenance,
  SBOM, and attestations all pass.
- Preserve all existing private evidence; new real evidence stays gitignored at directory mode
  `0700` and file mode `0600`.

---

### Task 1: Add the immutable runtime lock and deterministic package sanitizer

**Files:**

- Create: `infra/maritime/openclaw/remote-extension-runtime-lock.json`
- Create: `infra/maritime/openclaw/sanitize-runtime-dependencies.mjs`
- Create: `infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts`

**Interfaces:**

- Consumes: immutable upstream `/app`, five exact installed package paths, public npm tarballs.
- Produces:
  `sanitizeRuntimeDependencies({ appRoot, lock, fetchImplementation, extractImplementation })`
  and `findRuntimeLockViolations(lock)`.
- The sanitizer prints only `{"status":"repaired","packageCount":5}` and never package contents,
  environment variables, credentials, or filesystem paths outside `/app/node_modules`.

- [ ] **Step 1: Write failing lock-validation tests**

Create tests that import the ESM sanitizer and assert:

```ts
expect(findRuntimeLockViolations(validLock)).toEqual([]);
expect(
  findRuntimeLockViolations({
    ...validLock,
    finalRuntime: { ...validLock.finalRuntime, uid: 65532 }
  })
).toContain("Final Gateway runtime UID/GID must remain 1000:1000.");
expect(
  findRuntimeLockViolations({
    ...validLock,
    repairs: [...validLock.repairs, { ...validLock.repairs[0], name: "unexpected" }]
  })
).toContain("Runtime repair lock must contain exactly the five approved packages.");
```

Also verify `verifyPackageManifest` rejects the wrong source version, fixed version, package name,
or dependency-name set.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```sh
pnpm exec vitest run infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts
```

Expected: fail because the lock and sanitizer module do not exist.

- [ ] **Step 3: Add the complete runtime lock**

Use this exact schema and immutable content:

```json
{
  "schemaVersion": "1",
  "openclaw": {
    "version": "2026.7.1",
    "sourceCommit": "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
    "image": "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c"
  },
  "finalRuntime": {
    "imageIndex": "cgr.dev/chainguard/node@sha256:9cb13df6c9cf12a80967d16cc85687d4d70f5a6fd76001a9764aa08a34e6d2f5",
    "linuxAmd64Image": "cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f",
    "observedNodeVersion": "26.5.0",
    "uid": 1000,
    "gid": 1000,
    "entrypoint": [
      "/usr/bin/node",
      "/opt/vera/bin/remote-extension-supervisor.mjs"
    ]
  },
  "scanner": {
    "name": "trivy",
    "version": "0.72.0",
    "severities": ["CRITICAL", "HIGH"],
    "ignoreUnfixed": false
  },
  "repairs": [
    {
      "name": "@opentelemetry/propagator-jaeger",
      "path": "node_modules/@opentelemetry/propagator-jaeger",
      "fromVersion": "2.8.0",
      "toVersion": "2.9.0",
      "tarball": "https://registry.npmjs.org/@opentelemetry/propagator-jaeger/-/propagator-jaeger-2.9.0.tgz",
      "integrity": "sha512-4mYGty27rYvSM0jtp1ZUOqd3LfVRCYg9H5G9OFzSx5HViYToU21MFhWfco7x1HwXr7ER8yGOiCIHZUwjPksc0Q==",
      "dependencyNames": ["@opentelemetry/core"]
    },
    {
      "name": "@vitest/browser",
      "path": "node_modules/@vitest/browser",
      "fromVersion": "4.1.9",
      "toVersion": "4.1.10",
      "tarball": "https://registry.npmjs.org/@vitest/browser/-/browser-4.1.10.tgz",
      "integrity": "sha512-UDwuWGwXj646CBx/bQHOaJSX7np0I8JL/UKQYa1e4QrVHH8VdWtx8eaOuf8sy0ShwDgR6NjJAsp5eF6vjF6qng==",
      "dependencyNames": [
        "@blazediff/core",
        "@vitest/mocker",
        "@vitest/utils",
        "magic-string",
        "pngjs",
        "sirv",
        "tinyrainbow",
        "ws"
      ]
    },
    {
      "name": "brace-expansion",
      "path": "node_modules/brace-expansion",
      "fromVersion": "5.0.7",
      "toVersion": "5.0.8",
      "tarball": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.8.tgz",
      "integrity": "sha512-JZyDyq3D4AUifKTPOB7DELf6XsB3WdPuNxCtob1vFXPsSXhdAiHBWJ/tJ8HAc9aH84BK+5JFZLNkJKx3G9kzQg==",
      "dependencyNames": ["balanced-match"]
    },
    {
      "name": "fast-uri",
      "path": "node_modules/fast-uri",
      "fromVersion": "3.1.2",
      "toVersion": "3.1.4",
      "tarball": "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.4.tgz",
      "integrity": "sha512-8JnbkQ4juDyvYs4mgFGQqg4yCYtFDtUtmp2QIQq11ZZe5CFQ5wcqm1rqDgAh/QdMySuBnPzMUiJUNZG5N/AiQw==",
      "dependencyNames": []
    },
    {
      "name": "postcss",
      "path": "node_modules/postcss",
      "fromVersion": "8.5.16",
      "toVersion": "8.5.18",
      "tarball": "https://registry.npmjs.org/postcss/-/postcss-8.5.18.tgz",
      "integrity": "sha512-xdB1oSLHbz1vRWgCDalrCqEFTWzFlhqFC5tIHLMOSUIjhm3XXQ1qrFy8S/ESr1JYRRXqM3c1QFiMZUJdUTqyMQ==",
      "dependencyNames": ["nanoid", "picocolors", "source-map-js"]
    }
  ],
  "forbiddenFinalPaths": [
    "/bin/sh",
    "/usr/bin/npm",
    "/usr/bin/pnpm",
    "/usr/local/bin/npm",
    "/usr/local/bin/pnpm",
    "/usr/local/lib/node_modules/npm",
    "/usr/local/share/corepack"
  ]
}
```

- [ ] **Step 4: Implement lock validation and package replacement**

The module uses only Node built-ins. Export these functions:

```js
export function findRuntimeLockViolations(lock) {}
export function verifyPackageManifest({ manifest, repair, phase }) {}
export function verifyIntegrity(bytes, integrity) {}
export async function sanitizeRuntimeDependencies({
  appRoot = "/app",
  lock,
  fetchImplementation = fetch,
  extractImplementation = extractTarball
}) {}
```

Implementation requirements:

```js
const APPROVED_NAMES = Object.freeze([
  "@opentelemetry/propagator-jaeger",
  "@vitest/browser",
  "brace-expansion",
  "fast-uri",
  "postcss"
]);

export function verifyIntegrity(bytes, integrity) {
  if (!integrity.startsWith("sha512-")) throw new Error("Only sha512 npm integrity is accepted.");
  const observed = createHash("sha512").update(bytes).digest("base64");
  if (observed !== integrity.slice("sha512-".length)) {
    throw new Error("Runtime repair tarball integrity mismatch.");
  }
}
```

For each repair:

1. Resolve `path` below the exact `appRoot`; reject traversal.
2. Read and validate the current manifest against `name` and `fromVersion`.
3. Fetch only the lock's exact HTTPS registry URL with redirects disabled.
4. Verify SHA-512 before writing a mode-`0600` temporary archive.
5. Extract through `/usr/bin/tar` into a fresh temporary directory with one stripped `package/`
   component.
6. Validate the extracted manifest against `name`, `toVersion`, and the exact sorted
   `dependencyNames`.
7. Remove the old complete package directory and atomically rename the verified replacement.
8. Remove the archive and temporary directory in `finally`.

The executable main path reads
`/opt/vera-build/remote-extension-runtime-lock.json`, repairs `/app`, and writes only the fixed
status JSON.

- [ ] **Step 5: Run focused tests**

Run:

```sh
pnpm exec vitest run infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts
```

Expected: all sanitizer tests pass without network access.

- [ ] **Step 6: Commit Task 1**

```sh
git add infra/maritime/openclaw/remote-extension-runtime-lock.json \
  infra/maritime/openclaw/sanitize-runtime-dependencies.mjs \
  infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts
git commit -m "fix: lock gateway runtime dependency repairs"
```

---

### Task 2: Replace the shell entrypoint with a fail-closed Node supervisor

**Files:**

- Create: `infra/maritime/openclaw/remote-extension-supervisor.mjs`
- Create: `infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts`
- Delete: `infra/maritime/openclaw/remote-extension-entrypoint.sh`

**Interfaces:**

- Produces:
  `prepareRuntimeState({ dataDirectory, stateDirectory, uid, gid })` and
  `runGatewaySupervisor({ spawnImplementation })`.
- Consumes only fixed paths and the existing
  `/opt/vera/bin/remote-extension-route-filter.mjs`.

- [ ] **Step 1: Write failing state-boundary tests**

Cover:

```ts
expect(() =>
  prepareRuntimeState({ dataDirectory, stateDirectory, uid: 0, gid: 0 })
).toThrow("Gateway runtime must run as UID/GID 1000:1000.");

expect(() =>
  prepareRuntimeState({ dataDirectory, stateDirectory, uid: 1000, gid: 1000 })
).not.toThrow();

expect(modeOf(stateDirectory)).toBe(0o700);
expect(modeOf(existingEvidenceFile)).toBe(0o600);
expect(() => prepareRuntimeState(symlinkBoundaryInput)).toThrow(
  "Gateway state boundary must not be a symbolic link."
);
```

Use only temporary test directories; never read the real private evidence directory.

- [ ] **Step 2: Run the focused test and confirm failure**

```sh
pnpm exec vitest run infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
```

Expected: fail because the supervisor does not exist.

- [ ] **Step 3: Implement the supervisor**

Use fixed production constants:

```js
const DATA_DIRECTORY = "/data";
const STATE_DIRECTORY = "/data/.openclaw";
const ROUTE_FILTER = "/opt/vera/bin/remote-extension-route-filter.mjs";
const GATEWAY_ARGUMENTS = [
  ROUTE_FILTER,
  "node",
  "openclaw.mjs",
  "gateway"
];
```

`prepareRuntimeState` must:

- require UID/GID `1000:1000`;
- require the production state directory to equal `/data/.openclaw`;
- reject symlinks at the data or state boundary;
- create `.openclaw`, `credentials`, `state`, and `workspace`;
- recursively reject nested symlinks;
- chmod directories `0700` and files `0600`; and
- set umask `0077`, returning the previous mask so tests can restore it.

`runGatewaySupervisor` must spawn only:

```js
spawnImplementation(process.execPath, GATEWAY_ARGUMENTS, {
  cwd: "/app",
  env: process.env,
  stdio: "inherit"
});
```

Forward `SIGINT` and `SIGTERM`, await the child exit, and propagate its exit code or signal. The
supervisor must not print state paths, environment values, tokens, or browser data.

- [ ] **Step 4: Run supervisor and route-filter tests**

```sh
pnpm exec vitest run \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 2**

```sh
git add infra/maritime/openclaw/remote-extension-supervisor.mjs \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  infra/maritime/openclaw/remote-extension-entrypoint.sh
git commit -m "fix: supervise gateway without a shell runtime"
```

---

### Task 3: Transplant the sanitized runtime into the immutable minimal base

**Files:**

- Modify: `infra/maritime/openclaw/remote-extension.Dockerfile`
- Modify: `infra/maritime/openclaw/remote-extension-image.json`
- Create: `scripts/verify-gateway-runtime-supply-chain.ts`
- Create: `scripts/verify-gateway-runtime-supply-chain.unit.test.ts`
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`
- Modify: `package.json`

**Interfaces:**

- Final image consumes only sanitized `/app` plus Vera's fixed `/opt/vera` and `/data` layout.
- Static verification produces no output other than a pass message or closed violation list.

- [ ] **Step 1: Write failing static-boundary tests**

Add mutations that must fail:

```ts
["mutable Chainguard base", dockerfile.replace("@sha256:09e6c4", ":latest")],
["shell entrypoint", dockerfile.replace("/usr/bin/node", "/bin/sh")],
["wrong identity", dockerfile.replace("USER 1000:1000", "USER 65532")],
["package manager copied", `${dockerfile}\nCOPY --from=openclaw-runtime /usr/local /usr/local\n`],
["missing sanitizer", dockerfile.replace("sanitize-runtime-dependencies.mjs", "")],
["unexpected repair", { ...lock, repairs: [...lock.repairs, extraRepair] }]
```

Update the remote-extension configuration fixture to read
`remote-extension-supervisor.mjs` instead of the deleted shell script.

- [ ] **Step 2: Run the focused tests and confirm failure**

```sh
pnpm exec vitest run \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
```

Expected: fail because the new verifier and Dockerfile boundary do not exist.

- [ ] **Step 3: Replace the Dockerfile with three explicit stages**

Use:

```dockerfile
FROM ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c AS openclaw-runtime

USER root
COPY --chown=root:root --chmod=0444 remote-extension-runtime-lock.json \
  /opt/vera-build/remote-extension-runtime-lock.json
COPY --chown=root:root --chmod=0555 sanitize-runtime-dependencies.mjs \
  /opt/vera-build/sanitize-runtime-dependencies.mjs
RUN node /opt/vera-build/sanitize-runtime-dependencies.mjs

FROM openclaw-runtime AS vera-layout
RUN install -d -m 0755 -o 1000 -g 1000 /opt/vera /opt/vera/bin /opt/vera/config \
      /opt/vera/plugins /opt/vera/plugins/vera-read-shared-tab && \
    install -d -m 0700 -o 1000 -g 1000 /data /data/.openclaw \
      /data/.openclaw/credentials /data/.openclaw/state /data/.openclaw/workspace
COPY --chown=1000:1000 --chmod=0600 remote-extension.openclaw.json5 \
  /opt/vera/config/openclaw.json
COPY --chown=1000:1000 --chmod=0500 seed-security-audit-device.mjs \
  /opt/vera/bin/seed-security-audit-device.mjs
COPY --chown=1000:1000 --chmod=0555 remote-extension-supervisor.mjs \
  /opt/vera/bin/remote-extension-supervisor.mjs
COPY --chown=1000:1000 --chmod=0555 remote-extension-route-filter.mjs \
  /opt/vera/bin/remote-extension-route-filter.mjs
COPY --chown=1000:1000 --chmod=0444 \
  vera-read-shared-tab/index.mjs \
  vera-read-shared-tab/openclaw.plugin.json \
  vera-read-shared-tab/package.json \
  /opt/vera/plugins/vera-read-shared-tab/

FROM cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f AS final

ARG VERA_SOURCE_COMMIT
LABEL org.opencontainers.image.title="Vera OpenClaw Browser Gateway" \
  org.opencontainers.image.description="Hardened founder-only OpenClaw direct-extension Gateway" \
  org.opencontainers.image.source="https://github.com/zukhriddingit/VeraAI" \
  org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}" \
  org.opencontainers.image.version="2026.7.1-vera.2" \
  org.opencontainers.image.base.name="cgr.dev/chainguard/node" \
  org.opencontainers.image.base.digest="sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f" \
  io.vera.openclaw.image.digest="sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c"

WORKDIR /app
COPY --from=openclaw-runtime --chown=1000:1000 /app /app
COPY --from=vera-layout --chown=1000:1000 /opt/vera /opt/vera
COPY --from=vera-layout --chown=1000:1000 /data /data

ENV HOME=/data \
  OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json \
  OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1 \
  OPENCLAW_HEADLESS=true \
  OPENCLAW_STATE_DIR=/data/.openclaw

EXPOSE 18789
USER 1000:1000
ENTRYPOINT ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]
```

Do not copy `/usr/local`, `/bin`, `/usr/bin`, npm, Corepack, or pnpm from an earlier stage.

- [ ] **Step 4: Update the image manifest and static verification**

Keep `openclawVersion` and `baseImage` unchanged. Add:

```json
"runtimeBaseImage": "cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f",
"runtimeLock": "infra/maritime/openclaw/remote-extension-runtime-lock.json"
```

The new verifier must:

- validate the complete lock;
- split the Dockerfile at the exact final `FROM`;
- reject mutable references;
- require the five-stage-boundary strings shown above;
- require `USER 1000:1000`;
- require the exact Node entrypoint;
- reject shell, npm, Corepack, pnpm, apt, apk, package-manager caches, or a broad filesystem copy
  in the final stage; and
- require scanner configuration `0.72.0`, `CRITICAL,HIGH`, and `ignoreUnfixed=false`.

Add:

```json
"verify:gateway-runtime-supply-chain": "tsx scripts/verify-gateway-runtime-supply-chain.ts"
```

Update `verify-remote-extension-config.ts` to validate the Node supervisor constants and reject
`eval`, `exec`, arbitrary commands, root acceptance, or a missing fixed route-filter child.

- [ ] **Step 5: Run focused verification**

```sh
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm exec vitest run \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts \
  infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts
```

Expected: all verifiers and tests pass.

- [ ] **Step 6: Commit Task 3**

```sh
git add infra/maritime/openclaw/remote-extension.Dockerfile \
  infra/maritime/openclaw/remote-extension-image.json \
  scripts/verify-gateway-runtime-supply-chain.ts \
  scripts/verify-gateway-runtime-supply-chain.unit.test.ts \
  scripts/verify-remote-extension-config.ts \
  scripts/verify-remote-extension-config.unit.test.ts \
  package.json
git commit -m "fix: transplant gateway into minimal runtime"
```

---

### Task 4: Enforce the zero-finding image in CI and release evidence

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-openclaw-gateway.yml`
- Modify: `scripts/verify-gateway-release-workflow.ts`
- Modify: `scripts/verify-gateway-release-workflow.unit.test.ts`

**Interfaces:**

- PR CI builds without pushing or using secrets.
- Manual release still publishes once, then passes the immutable digest to scan/sign/attest jobs.
- Release artifacts add the runtime-lock file and its SHA-256; no private values.

- [ ] **Step 1: Write failing workflow-boundary tests**

Mutations must reject:

- missing PR image scan;
- Trivy `--ignore-unfixed=true`;
- a Trivy ignore file;
- scan severities other than `CRITICAL,HIGH`;
- missing runtime-lock artifact/hash;
- signing before a successful zero-finding scan; and
- any deployment command.

- [ ] **Step 2: Add the secretless CI image job**

Add a second `gateway_image` job on `ubuntu-24.04` with `contents: read`, a 35-minute timeout,
pinned checkout, pinned Buildx, pinned build-push action, and pinned Trivy setup.

Build:

```yaml
- name: Build local Gateway candidate
  uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf
  with:
    context: infra/maritime/openclaw
    file: infra/maritime/openclaw/remote-extension.Dockerfile
    platforms: linux/amd64
    pull: true
    load: true
    push: false
    tags: vera-openclaw-gateway:ci
    build-args: |
      VERA_SOURCE_COMMIT=${{ github.event.pull_request.head.sha || github.sha }}
```

Verify identity and omitted tools without requiring a shell in the image:

```yaml
- name: Verify minimal runtime identity
  run: |
    set -euo pipefail
    observed="$(docker run --rm --entrypoint /usr/bin/node \
      vera-openclaw-gateway:ci \
      -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),shell:fs.existsSync("/bin/sh"),npm:fs.existsSync("/usr/local/lib/node_modules/npm"),corepack:fs.existsSync("/usr/local/share/corepack")}));')"
    test "$observed" = '{"uid":1000,"gid":1000,"shell":false,"npm":false,"corepack":false}'
```

Enforce:

```yaml
trivy --config /dev/null image --quiet --ignorefile /dev/null --list-all-pkgs \
  --scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1 \
  vera-openclaw-gateway:ci
```

- [ ] **Step 3: Bind the release artifact to the runtime lock**

During exact-source verification, run both committed static verifiers. During evidence creation,
copy the runtime lock and record:

```sh
cp infra/maritime/openclaw/remote-extension-runtime-lock.json \
  release-evidence/gateway/remote-extension-runtime-lock.json
sha256sum release-evidence/gateway/remote-extension-runtime-lock.json \
  > release-evidence/gateway/remote-extension-runtime-lock.sha256
```

The sign/attest job must restore both files, recompute the SHA-256, and fail on mismatch before
provenance, SBOM attestation, or signing.

- [ ] **Step 4: Run workflow verification**

```sh
pnpm verify:gateway-release-workflow
pnpm exec vitest run scripts/verify-gateway-release-workflow.unit.test.ts
pnpm exec prettier --check .github/workflows/ci.yml \
  .github/workflows/release-openclaw-gateway.yml
```

Expected: all checks pass.

- [ ] **Step 5: Commit Task 4**

```sh
git add .github/workflows/ci.yml \
  .github/workflows/release-openclaw-gateway.yml \
  scripts/verify-gateway-release-workflow.ts \
  scripts/verify-gateway-release-workflow.unit.test.ts
git commit -m "ci: require zero-finding gateway image"
```

---

### Task 5: Build and prove the local replacement before opening the PR

**Files:**

- Modify: `infra/maritime/OPENCLAW.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Create outside Git:
  `release-evidence/private/m13a-r2-security-repair-local-20260726/`

**Interfaces:**

- Produces one local linux/amd64 image and sanitized private scan/acceptance evidence.
- Does not push an image, dispatch a workflow, or change Maritime.

- [ ] **Step 1: Document the repaired runtime and fail-closed gate**

Document:

- immutable OpenClaw application source;
- immutable Chainguard final base;
- five application dependency repairs;
- package-manager/system-tool omission;
- Node supervisor;
- local zero-finding command;
- rejected digest `sha256:5d1f6d2d097bb8e53f2e2dd6c1e6f8499d6daf34dff8a61b9b0c187fd9e1ec6b`;
- replacement state `pending`;
- no Maritime deployment until publication verification passes.

- [ ] **Step 2: Run repository checks before the image build**

```sh
git diff --check
pnpm format:check
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm verify:gateway-release-workflow
pnpm lint
pnpm typecheck
pnpm test:unit
```

Expected: every command passes.

- [ ] **Step 3: Build exactly one local linux/amd64 test image**

Resolve `git rev-parse HEAD` without printing any secret and use it as
`VERA_SOURCE_COMMIT`. Build:

```sh
docker buildx build --platform linux/amd64 --pull --load \
  --file infra/maritime/openclaw/remote-extension.Dockerfile \
  --tag vera-openclaw-gateway:m13a-r2-security-local \
  --build-arg VERA_SOURCE_COMMIT="$VERA_SECURITY_SOURCE_SHA" \
  infra/maritime/openclaw
```

- [ ] **Step 4: Verify final identity and filesystem**

Use `docker image inspect` plus the Node entrypoint to require:

```json
{
  "uid": 1000,
  "gid": 1000,
  "shell": false,
  "npm": false,
  "corepack": false,
  "pnpm": false,
  "publicPort": "18789/tcp"
}
```

Require OCI source revision to equal `VERA_SECURITY_SOURCE_SHA`, OpenClaw source digest to equal
`6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c`, and final base
digest to equal `09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f`.

- [ ] **Step 5: Enforce the local zero-finding scan**

Create the new private directory at `0700`. Run pinned Trivy `0.72.0` with the restricted cache:

```sh
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /private/tmp/vera-trivy-cache-20260727:/root/.cache/trivy \
  -v /private/tmp/vera-founder-staging-evidence-pr/release-evidence/private/m13a-r2-security-repair-local-20260726:/evidence \
  aquasec/trivy:0.72.0 image \
  --config /dev/null --quiet --ignorefile /dev/null --list-all-pkgs \
  --scanners vuln --ignore-unfixed=false --severity CRITICAL,HIGH --exit-code 1 \
  --format json --output /evidence/trivy-zero-findings.json \
  vera-openclaw-gateway:m13a-r2-security-local
```

Mount only the new private evidence directory at `/evidence`, then chmod the JSON `0600`.
Acceptance is exit code `0` and a parsed finding count of exactly `0`.

- [ ] **Step 6: Rerun transport and route-isolation acceptance**

Run:

```sh
pnpm exec vitest run \
  infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts \
  scripts/staging/websocket-transport-probe.unit.test.ts \
  scripts/staging/remote-extension-proxy-smoke.unit.test.ts \
  scripts/staging/local-websocket-tls-proxy.unit.test.ts \
  packages/connectors/src/maritime-remote-extension-client.unit.test.ts \
  apps/web/lib/remote-extension-snapshot-service.unit.test.ts
```

Then start the local image using a mode-`0600` env file containing only a fresh
`OPENCLAW_GATEWAY_TOKEN`. Bind host loopback to container port `18789`. Require:

- supervisor and Gateway remain running;
- `/` and unrelated routes return `404`;
- ordinary HTTP `/browser/extension` returns `426`;
- the process reports UID/GID `1000:1000`;
- no additional public listener exists; and
- container logs contain no token or secret-bearing protocol.

If any local scan or transport gate fails, stop before PR creation and repair only the failing
local boundary.

- [ ] **Step 7: Run full local validation**

```sh
pnpm test
pnpm test:integration:postgres
pnpm build
git diff --check
git status --short
```

Expected: all tests/builds pass and Git shows only intentional committed-source changes. Private
evidence remains ignored.

- [ ] **Step 8: Commit Task 5**

```sh
git add infra/maritime/OPENCLAW.md docs/SECURITY_REVIEW.md
git commit -m "docs: record zero-finding gateway gate"
```

---

### Task 6: CI-gated PR, merge, and one replacement publication

**Files:**

- No new committed source unless CI exposes a repair-specific regression.
- Create outside Git: one new restricted publication-evidence directory.

**Interfaces:**

- Produces one merged source SHA and at most one replacement GHCR manifest.
- A terminal workflow run always triggers immediate deletion of `GHCR_PUBLISH_TOKEN`.

- [ ] **Step 1: Verify isolation before remote actions**

Require:

```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git rev-parse HEAD
git diff --check
git ls-files release-evidence/private
```

Expected worktree/root:
`/private/tmp/vera-founder-staging-evidence-pr`; expected branch:
`codex/founder-browser-remote-extension`; clean status; no tracked private evidence.

- [ ] **Step 2: Push and create the repair PR**

Push the existing branch. Open a PR into `main` titled:

```text
fix: harden OpenClaw Gateway runtime supply chain
```

The body records immutable upstream/base identities, the five dependency repairs, zero local
findings, UID/GID, preserved transport tests, exact local commands, rejected prior digest, and the
no-Maritime-before-attestation boundary.

- [ ] **Step 3: Wait for exact-head CI and merge**

Do not merge until GitHub reports the exact PR head mergeable and every required check successful,
including the linux/amd64 zero-finding image job. Apply only the smallest repair if CI fails.

Squash-merge with:

```text
fix: harden OpenClaw Gateway runtime supply chain
```

Retain the trusted feature branch until publication ends. Reconcile merged `main` into the feature
branch without losing the merged source SHA's ancestry.

- [ ] **Step 4: Create the temporary secret correctly**

Use the already-authorized current package-write credential through stdin:

```sh
gh auth token | gh secret set GHCR_PUBLISH_TOKEN --repo zukhriddingit/VeraAI
```

Never pass `--body -`; it would store a literal hyphen. Confirm only the secret name and update
timestamp, never its value.

- [ ] **Step 5: Dispatch exactly one replacement publication**

Dispatch `release-openclaw-gateway.yml` from
`codex/founder-browser-remote-extension` with `source_sha` equal to the exact merged source commit.
This is the only replacement registry publication attempt authorized by this plan.

- [ ] **Step 6: Delete the temporary secret immediately**

As the immediate next remote action after any terminal workflow conclusion:

```sh
gh secret delete GHCR_PUBLISH_TOKEN --repo zukhriddingit/VeraAI
```

Confirm the matching secret count is `0`.

- [ ] **Step 7: Apply the publication gate**

Continue only if the workflow proves all of:

- build success from exact merged source;
- one immutable GHCR digest;
- anonymous pull succeeds;
- zero Trivy `HIGH` or `CRITICAL` findings;
- SBOM exists and binds to the digest;
- Cosign signature verifies;
- exact-source SLSA provenance verifies;
- SPDX attestation verifies;
- runtime-lock file/hash matches committed source;
- UID/GID `1000:1000`;
- immutable OpenClaw and Chainguard labels match; and
- no temporary credential remains.

If any item fails, keep `founder_browser_experimental=no_go`, do not publish another replacement,
do not deploy to Maritime, preserve sanitized failure evidence, and report the exact boundary.

- [ ] **Step 8: Resume live acceptance only after a complete pass**

Only a complete Task 6 pass authorizes resuming the already-approved disposable Maritime
Milestone 13A acceptance. Deploy only the immutable replacement digest, keep the exact
`/browser/extension` route, run Tests B/C and real-Chrome acceptance, collect new private evidence,
and delete the disposable agent. Milestone 13B remains unauthorized.

---

## Plan self-review

- Every approved design requirement maps to Tasks 1–6.
- The only application package replacements are the five evidence-backed `/app` instances.
- npm/Corepack/pnpm findings disappear by filesystem omission, not version suppression.
- The final image never includes a shell or package manager.
- Both local and CI scans include fixed and unfixed findings and fail on any `HIGH` or `CRITICAL`.
- Publication is limited to one replacement attempt.
- Maritime remains conditional on scan, SBOM, signature, provenance, and attestation success.
- No task weakens browser policy or begins Milestone 13B.
