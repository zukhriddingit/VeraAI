# Managed Browser-Extension Pairing Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed, supervisor-owned bootstrap that installs one private OpenClaw Chrome
extension relay credential in the fixed Gateway state directory without leaking it to the OpenClaw
child process.

**Architecture:** Extend the existing fixed Node supervisor with a standard-library-only credential
installer. It atomically creates or constant-time verifies the fixed
`credentials/browser-extension-relay.secret` file, while `runGatewaySupervisor` captures and
deletes the optional server seed before any state I/O and always spawns the unchanged child with a
sanitized environment. Static repository validation and operator documentation make this new
boundary mandatory.

**Tech Stack:** Node.js ESM standard library, TypeScript, Vitest, Prettier, existing Vera static
verification scripts

## Global Constraints

- Use only the isolated worktree `/private/tmp/vera-railway-deploy-9595e3d`.
- Preserve runtime UID/GID `1000:1000`.
- Preserve `OPENCLAW_STATE_DIR=/data/.openclaw`.
- Preserve public access only to exact `/browser/extension`.
- Preserve the fixed child command `/usr/bin/node /opt/vera/bin/remote-extension-route-filter.mjs node openclaw.mjs gateway`.
- `OPENCLAW_EXTENSION_PAIRING_SEED` is optional, server-only, and must match `^[0-9a-f]{64}$`.
- `OPENCLAW_EXTENSION_PAIRING_SEED` and `OPENCLAW_GATEWAY_TOKEN` must remain distinct.
- Never log, return, hash for output, commit, or pass the seed to a child process.
- Use Node standard-library primitives only; add no dependency.
- Create the fixed credential atomically with exclusive-create semantics and mode `0600`.
- Existing matching credentials are idempotent; malformed or mismatching credentials fail closed.
- Preserve the existing RentCast path, `founder_core`, and every browser capability restriction.
- Do not publish an image, deploy a cloud resource, or mutate remote state in this plan.

---

### Task 1: Add the atomic credential installer

**Files:**

- Modify: `infra/maritime/openclaw/remote-extension-supervisor.mjs`
- Test: `infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts`

**Interfaces:**

- Consumes: a prepared state directory and a 64-character lowercase hexadecimal seed.
- Produces:
  `installExtensionPairingSecret({ stateDirectory: string, seed: string }): void`.
- Produces constants:
  `EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME` and `EXTENSION_PAIRING_SECRET_FILENAME`.

- [ ] **Step 1: Add failing table-driven format and filesystem tests**

Import `lstatSync`, `utimesSync`, and the new exports, then add:

```ts
const validPairingSeed = "a".repeat(64);

it.each([
  ["short", "a".repeat(63)],
  ["long", "a".repeat(65)],
  ["uppercase", "A".repeat(64)],
  ["whitespace", `${"a".repeat(64)}\n`],
  ["non-hex", "g".repeat(64)]
])("rejects a %s pairing seed without creating a credential", (_label, seed) => {
  const boundary = runtimeBoundary();
  prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 });

  expect(() =>
    installExtensionPairingSecret({ stateDirectory: boundary.stateDirectory, seed })
  ).toThrow("Extension pairing credential bootstrap failed.");
  expect(() =>
    lstatSync(
      join(boundary.stateDirectory, "credentials", "browser-extension-relay.secret")
    )
  ).toThrow();
});

it("atomically creates the fixed private pairing credential", () => {
  const boundary = runtimeBoundary();
  prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 });

  installExtensionPairingSecret({
    stateDirectory: boundary.stateDirectory,
    seed: validPairingSeed
  });

  const credentialPath = join(
    boundary.stateDirectory,
    "credentials",
    "browser-extension-relay.secret"
  );
  expect(readFileSync(credentialPath, "utf8")).toBe(validPairingSeed);
  expect(lstatSync(credentialPath).isFile()).toBe(true);
  expect(modeOf(credentialPath)).toBe(0o600);
});
```

Add these focused cases:

```ts
it("accepts an identical existing credential without rewriting it", () => {
  const boundary = runtimeBoundary();
  prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 });
  const credentialPath = join(
    boundary.stateDirectory,
    "credentials",
    "browser-extension-relay.secret"
  );
  writeFileSync(credentialPath, validPairingSeed, { mode: 0o600 });
  utimesSync(credentialPath, 1, 1);

  installExtensionPairingSecret({
    stateDirectory: boundary.stateDirectory,
    seed: validPairingSeed
  });

  expect(readFileSync(credentialPath, "utf8")).toBe(validPairingSeed);
  expect(statSync(credentialPath).mtimeMs).toBe(1_000);
});

it("rejects an existing credential mismatch", () => {
  const boundary = runtimeBoundary();
  prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 });
  const credentialPath = join(
    boundary.stateDirectory,
    "credentials",
    "browser-extension-relay.secret"
  );
  const existing = "b".repeat(64);
  writeFileSync(credentialPath, existing, { mode: 0o600 });

  expect(() =>
    installExtensionPairingSecret({
      stateDirectory: boundary.stateDirectory,
      seed: validPairingSeed
    })
  ).toThrow("Extension pairing credential bootstrap failed.");
  expect(readFileSync(credentialPath, "utf8")).toBe(existing);
});

it.each(["symbolic-link", "directory"])("rejects a %s credential entry", (kind) => {
  const boundary = runtimeBoundary();
  prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 });
  const credentialPath = join(
    boundary.stateDirectory,
    "credentials",
    "browser-extension-relay.secret"
  );
  if (kind === "symbolic-link") {
    const outside = join(boundary.dataDirectory, "outside-secret");
    writeFileSync(outside, validPairingSeed, { mode: 0o600 });
    symlinkSync(outside, credentialPath);
  } else {
    mkdirSync(credentialPath, { mode: 0o700 });
  }

  expect(() =>
    installExtensionPairingSecret({
      stateDirectory: boundary.stateDirectory,
      seed: validPairingSeed
    })
  ).toThrow("Extension pairing credential bootstrap failed.");
});
```

- [ ] **Step 2: Run the focused test and verify the new API is absent**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
```

Expected: FAIL because `installExtensionPairingSecret` and the pairing constants are not exported.

- [ ] **Step 3: Implement the standard-library-only installer**

Extend the imports with `timingSafeEqual` and handle-based filesystem primitives:

```js
import { timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
```

Define the fixed contract:

```js
export const EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME =
  "OPENCLAW_EXTENSION_PAIRING_SEED";
export const EXTENSION_PAIRING_SECRET_FILENAME =
  "browser-extension-relay.secret";
const EXTENSION_PAIRING_SEED_PATTERN = /^[0-9a-f]{64}$/u;
const PAIRING_BOOTSTRAP_ERROR = "Extension pairing credential bootstrap failed.";
```

Implement these rules in `installExtensionPairingSecret`:

```js
function secretsMatch(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function installExtensionPairingSecretUnsafe({ stateDirectory, seed }) {
  if (!EXTENSION_PAIRING_SEED_PATTERN.test(seed)) {
    throw new Error("invalid");
  }

  const credentialsDirectory = join(stateDirectory, "credentials");
  const credentialPath = join(credentialsDirectory, EXTENSION_PAIRING_SECRET_FILENAME);
  const credentialsStat = lstatSync(credentialsDirectory);
  if (credentialsStat.isSymbolicLink() || !credentialsStat.isDirectory()) {
    throw new Error("invalid");
  }

  let descriptor;
  try {
    descriptor = openSync(
      credentialPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    );
    writeFileSync(descriptor, seed, "utf8");
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    const createdStat = fstatSync(descriptor);
    if (!createdStat.isFile() || (createdStat.mode & 0o777) !== 0o600) {
      throw new Error("invalid");
    }
    return;
  } catch (error) {
    if (descriptor !== undefined || error?.code !== "EEXIST") {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  const entryStat = lstatSync(credentialPath);
  if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
    throw new Error("invalid");
  }
  const existingDescriptor = openSync(
    credentialPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const openedStat = fstatSync(existingDescriptor);
    const existing = readFileSync(existingDescriptor, "utf8");
    if (
      !openedStat.isFile() ||
      (openedStat.mode & 0o777) !== 0o600 ||
      !EXTENSION_PAIRING_SEED_PATTERN.test(existing) ||
      !secretsMatch(existing, seed)
    ) {
      throw new Error("invalid");
    }
  } finally {
    closeSync(existingDescriptor);
  }
}

export function installExtensionPairingSecret(input) {
  try {
    installExtensionPairingSecretUnsafe(input);
  } catch {
    throw new Error(PAIRING_BOOTSTRAP_ERROR);
  }
}
```

Keep the function independent from process arguments and environment-derived paths. A concurrent
creator causes `O_EXCL` to return `EEXIST`; the code then validates the resulting entry through a
no-follow file descriptor instead of overwriting it.

- [ ] **Step 4: Run the focused test and confirm all installer cases pass**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
```

Expected: PASS for new creation, matching reuse, mismatch, malformed seed, mode, symlink, and
non-regular-entry tests.

- [ ] **Step 5: Commit the independently tested installer**

```bash
git add \
  infra/maritime/openclaw/remote-extension-supervisor.mjs \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
git commit -m "feat: add atomic OpenClaw pairing bootstrap"
```

---

### Task 2: Sanitize the seed before every state operation and child spawn

**Files:**

- Modify: `infra/maritime/openclaw/remote-extension-supervisor.mjs`
- Test: `infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts`

**Interfaces:**

- Consumes: `EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME` and
  `installExtensionPairingSecret` from Task 1.
- Produces: `runGatewaySupervisor` with optional dependency
  `pairingInstallerImplementation = installExtensionPairingSecret`.
- Preserves: the existing `spawnImplementation`, `prepareImplementation`, and
  `processImplementation` injection points.

- [ ] **Step 1: Add failing environment-isolation tests**

Extend the existing fixed-spawn test so it asserts a cloned environment rather than object identity:

```ts
expect(calls).toEqual([
  [
    "/usr/bin/node",
    GATEWAY_ARGUMENTS,
    {
      cwd: "/app",
      env: { OPENCLAW_STATE_DIR: "/data/.openclaw" },
      stdio: "inherit"
    }
  ]
]);
expect((calls[0]?.[2] as { env: NodeJS.ProcessEnv }).env).not.toBe(fakeProcess.env);
```

Add this harness above the supervisor tests:

```ts
function supervisorHarness(
  env: NodeJS.ProcessEnv = { OPENCLAW_STATE_DIR: "/data/.openclaw" }
) {
  const child = new EventEmitter() as EventEmitter & {
    kill: (signal: NodeJS.Signals) => boolean;
  };
  child.kill = () => true;
  const fakeProcess = new EventEmitter() as EventEmitter & {
    env: NodeJS.ProcessEnv;
    execPath: string;
    exitCode?: number;
    pid: number;
    kill: (pid: number, signal: NodeJS.Signals) => boolean;
  };
  fakeProcess.env = { ...env };
  fakeProcess.execPath = "/usr/bin/node";
  fakeProcess.pid = 42;
  fakeProcess.kill = () => true;
  return { child, fakeProcess };
}
```

Then add:

```ts
it("removes the pairing seed before preparation and child spawn", async () => {
  const seed = "a".repeat(64);
  const order: string[] = [];
  const { child, fakeProcess } = supervisorHarness({
    OPENCLAW_STATE_DIR: "/data/.openclaw",
    OPENCLAW_EXTENSION_PAIRING_SEED: seed
  });

  const running = runGatewaySupervisor({
    prepareImplementation: () => {
      order.push("prepare");
      expect(fakeProcess.env.OPENCLAW_EXTENSION_PAIRING_SEED).toBeUndefined();
      return 0o022;
    },
    pairingInstallerImplementation: ({ stateDirectory, seed: received }) => {
      order.push("install");
      expect(stateDirectory).toBe("/data/.openclaw");
      expect(received).toBe(seed);
    },
    spawnImplementation: (_command, _args, options) => {
      order.push("spawn");
      expect(options.env.OPENCLAW_EXTENSION_PAIRING_SEED).toBeUndefined();
      return child;
    },
    processImplementation: fakeProcess
  });

  child.emit("exit", 0, null);
  await running;
  expect(order).toEqual(["prepare", "install", "spawn"]);
});

it.each([
  [
    "fixed state validation",
    { OPENCLAW_STATE_DIR: "/tmp/unsafe", OPENCLAW_EXTENSION_PAIRING_SEED: "a".repeat(64) },
    () => 0o022,
    () => undefined
  ],
  [
    "state preparation",
    { OPENCLAW_STATE_DIR: "/data/.openclaw", OPENCLAW_EXTENSION_PAIRING_SEED: "a".repeat(64) },
    () => {
      throw new Error("synthetic preparation failure");
    },
    () => undefined
  ],
  [
    "pairing installation",
    { OPENCLAW_STATE_DIR: "/data/.openclaw", OPENCLAW_EXTENSION_PAIRING_SEED: "a".repeat(64) },
    () => 0o022,
    () => {
      throw new Error("Extension pairing credential bootstrap failed.");
    }
  ]
])(
  "removes the seed and does not spawn after %s failure",
  async (_label, env, prepareImplementation, pairingInstallerImplementation) => {
    const { fakeProcess } = supervisorHarness(env);
    let spawnCalled = false;

    await expect(
      runGatewaySupervisor({
        prepareImplementation,
        pairingInstallerImplementation,
        spawnImplementation: () => {
          spawnCalled = true;
          throw new Error("must not spawn");
        },
        processImplementation: fakeProcess
      })
    ).rejects.toThrow();

    expect(fakeProcess.env.OPENCLAW_EXTENSION_PAIRING_SEED).toBeUndefined();
    expect(spawnCalled).toBe(false);
  }
);

it("preserves absent-seed compatibility without invoking the installer", async () => {
  const { child, fakeProcess } = supervisorHarness();
  let installerCalled = false;
  const running = runGatewaySupervisor({
    prepareImplementation: () => 0o022,
    pairingInstallerImplementation: () => {
      installerCalled = true;
    },
    spawnImplementation: () => child,
    processImplementation: fakeProcess
  });

  child.emit("exit", 0, null);
  await running;
  expect(installerCalled).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify the seed still leaks or the injection is absent**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
```

Expected: FAIL because the current supervisor passes `processImplementation.env` directly and has
no pairing-installer injection point.

- [ ] **Step 3: Wire the fail-closed ordering**

Change `runGatewaySupervisor` to capture and remove the seed before validation or I/O:

```js
export async function runGatewaySupervisor({
  spawnImplementation = spawn,
  prepareImplementation = prepareRuntimeState,
  pairingInstallerImplementation = installExtensionPairingSecret,
  processImplementation = process
} = {}) {
  const pairingSeed =
    processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];
  delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];
  const childEnvironment = { ...processImplementation.env };
  delete childEnvironment[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];

  if (processImplementation.env.OPENCLAW_STATE_DIR !== STATE_DIRECTORY) {
    throw new Error("Gateway state directory environment is not the fixed boundary.");
  }
  const uid = processImplementation.getuid?.();
  const gid = processImplementation.getgid?.();
  prepareImplementation({
    dataDirectory: DATA_DIRECTORY,
    stateDirectory: STATE_DIRECTORY,
    uid,
    gid
  });
  if (pairingSeed !== undefined) {
    pairingInstallerImplementation({
      stateDirectory: STATE_DIRECTORY,
      seed: pairingSeed
    });
  }

  const child = spawnImplementation(processImplementation.execPath, GATEWAY_ARGUMENTS, {
    cwd: "/app",
    env: childEnvironment,
    stdio: "inherit"
  });
```

Do not print, serialize, include in an error, or copy the seed elsewhere.

- [ ] **Step 4: Run focused supervisor tests**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
```

Expected: PASS, including order `prepare -> install -> spawn`, absent-seed compatibility, and
failure-path non-inheritance.

- [ ] **Step 5: Commit the runtime wiring**

```bash
git add \
  infra/maritime/openclaw/remote-extension-supervisor.mjs \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
git commit -m "feat: isolate managed extension pairing seed"
```

---

### Task 3: Make the bootstrap a statically enforced repository boundary

**Files:**

- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`

**Interfaces:**

- Consumes: the exact constants and code patterns produced by Tasks 1 and 2.
- Produces: a new verifier violation:
  `Gateway supervisor must atomically bootstrap and isolate the extension pairing credential.`

- [ ] **Step 1: Add failing verifier mutation tests**

Add a table that independently removes or weakens each required property:

```ts
it.each([
  [
    "seed environment name",
    '"OPENCLAW_EXTENSION_PAIRING_SEED"',
    '"UNSAFE_PAIRING_SEED"'
  ],
  ["exclusive creation", "constants.O_EXCL", "0"],
  ["symlink-safe open", "constants.O_NOFOLLOW", "0"],
  ["private mode", "fchmodSync(descriptor, 0o600)", "fchmodSync(descriptor, 0o644)"],
  ["constant-time equality", "timingSafeEqual(leftBytes, rightBytes)", "left === right"],
  [
    "parent-environment deletion",
    "delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME]",
    ""
  ],
  [
    "sanitized child environment",
    "env: childEnvironment",
    "env: processImplementation.env"
  ]
])("rejects pairing bootstrap without %s", (_label, before, after) => {
  const input = fixture();
  input.supervisorSource = input.supervisorSource.replace(before, after);
  expect(findRemoteExtensionConfigViolations(input)).toContain(
    "Gateway supervisor must atomically bootstrap and isolate the extension pairing credential."
  );
});
```

- [ ] **Step 2: Run the verifier unit test and confirm the mutations are accepted**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-remote-extension-config.unit.test.ts
```

Expected: FAIL because the new bootstrap-specific violation does not exist.

- [ ] **Step 3: Add the closed static checks**

Add a separate verifier block that requires:

```ts
if (
  !supervisorSource.includes('"OPENCLAW_EXTENSION_PAIRING_SEED"') ||
  !supervisorSource.includes('"browser-extension-relay.secret"') ||
  !supervisorSource.includes("constants.O_EXCL") ||
  !supervisorSource.includes("constants.O_NOFOLLOW") ||
  !supervisorSource.includes("fchmodSync(descriptor, 0o600)") ||
  !supervisorSource.includes("timingSafeEqual(leftBytes, rightBytes)") ||
  !supervisorSource.includes(
    "delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME]"
  ) ||
  !supervisorSource.includes("const childEnvironment = { ...processImplementation.env }") ||
  !supervisorSource.includes("env: childEnvironment") ||
  supervisorSource.includes("console.log(pairingSeed)") ||
  supervisorSource.includes("process.stdout.write(pairingSeed)")
) {
  violations.push(
    "Gateway supervisor must atomically bootstrap and isolate the extension pairing credential."
  );
}
```

Keep this distinct from the existing fixed-command/state-tree violation so each security boundary
has an actionable failure.

- [ ] **Step 4: Run focused verifier and supervisor tests**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-remote-extension-config.unit.test.ts \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts
pnpm verify:remote-extension-config
```

Expected: both test files PASS and the CLI prints
`Remote extension configuration boundaries verified.`

- [ ] **Step 5: Commit the static enforcement**

```bash
git add \
  scripts/verify-remote-extension-config.ts \
  scripts/verify-remote-extension-config.unit.test.ts
git commit -m "test: enforce extension pairing bootstrap boundary"
```

---

### Task 4: Document the private managed-runtime setting and operator separation

**Files:**

- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `docs/BROWSER_CONNECTOR.md`
- Modify: `infra/maritime/OPENCLAW.md`

**Interfaces:**

- Consumes: `OPENCLAW_EXTENSION_PAIRING_SEED` from the supervisor.
- Produces: an operator contract distinguishing managed Gateway bootstrap configuration from the
  restricted local probe's `OPENCLAW_EXTENSION_PAIRING_SECRET`.

- [ ] **Step 1: Update the environment manifest**

Replace the dedicated-Gateway row that currently presents the probe secret as a Gateway setting:

```markdown
| `OPENCLAW_EXTENSION_PAIRING_SEED` | yes | Optional managed-runtime bootstrap seed; distinct from the Gateway token, removed before child spawn, and required when no interactive pairing command is available. |
```

Keep the later probe paragraph unchanged: restricted operator tooling still reads
`OPENCLAW_EXTENSION_PAIRING_SECRET`.

- [ ] **Step 2: Update the pairing runbook**

In `docs/BROWSER_CONNECTOR.md`, retain the official interactive command as the preferred supported
path and add the managed-runtime fallback:

```markdown
When the provider exposes no safe exec channel, inject one independently generated
64-character lowercase hexadecimal value as the private server setting
`OPENCLAW_EXTENSION_PAIRING_SEED`. Vera's fixed supervisor installs it at
`/data/.openclaw/credentials/browser-extension-relay.secret` before OpenClaw starts, removes it
from the child environment, and fails closed on malformed input or an existing mismatch. Never set
it to `OPENCLAW_GATEWAY_TOKEN`.
```

State that the founder receives a connection string assembled by restricted operator tooling; no
secret appears in documentation, logs, evidence, or shell history.

- [ ] **Step 3: Update the OpenClaw operator notes**

In `infra/maritime/OPENCLAW.md`, document:

- the managed bootstrap variable is a private server setting, not the smoke-probe variable;
- it is optional only when the provider supports the official pairing command or preserves an
  already-paired private state volume;
- a new per-user seed is required;
- restarts are idempotent only for an identical existing credential;
- mismatch or malformed configuration prevents startup; and
- the probe continues to read `OPENCLAW_EXTENSION_PAIRING_SECRET` from restricted operator
  tooling.

- [ ] **Step 4: Run documentation and formatting checks**

Run:

```bash
pnpm exec prettier --check \
  infra/maritime/ENVIRONMENT.md \
  docs/BROWSER_CONNECTOR.md \
  infra/maritime/OPENCLAW.md
pnpm verify:release-documentation
git diff --check
```

Expected: all commands exit `0`; no secret value or mutable image reference appears.

- [ ] **Step 5: Commit the runbook**

```bash
git add \
  infra/maritime/ENVIRONMENT.md \
  docs/BROWSER_CONNECTOR.md \
  infra/maritime/OPENCLAW.md
git commit -m "docs: describe managed extension pairing bootstrap"
```

---

### Task 5: Run the local completion audit

**Files:**

- Verify only; do not modify remote state.

**Interfaces:**

- Consumes: all preceding tasks.
- Produces: local evidence that the source-level repair is ready for a CI-gated PR, but not
  authorization to publish or deploy.

- [ ] **Step 1: Run focused security tests**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
pnpm verify:remote-extension-config
pnpm verify:gateway-image-layout
pnpm verify:gateway-runtime-supply-chain
```

Expected: every command exits `0`.

- [ ] **Step 2: Run repository checks required by the changed files**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm exec prettier --check .
git diff --check
```

Expected: every command exits `0`. Record exact counts from Vitest rather than estimating them.

- [ ] **Step 3: Audit the diff for forbidden behavior and secrets**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- \
  infra/maritime/openclaw/remote-extension-supervisor.mjs \
  infra/maritime/openclaw/remote-extension-supervisor.unit.test.ts \
  scripts/verify-remote-extension-config.ts \
  scripts/verify-remote-extension-config.unit.test.ts \
  infra/maritime/ENVIRONMENT.md \
  docs/BROWSER_CONNECTOR.md \
  infra/maritime/OPENCLAW.md
rg -n \
  'OPENCLAW_EXTENSION_PAIRING_SEED=.+|OPENCLAW_GATEWAY_TOKEN=.+|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|console\\.log\\(pairingSeed|process\\.stdout\\.write\\(pairingSeed' \
  infra/maritime docs scripts \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/superpowers/specs/**'
```

Expected: only intended source, tests, validators, and documentation changed; the secret scan finds
no value-bearing or secret-printing match. Confirm no browser action, route expansion, RentCast
change, `founder_core` change, generated artifact, or private evidence was committed.

- [ ] **Step 4: Verify isolated worktree identity**

Run:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git rev-parse HEAD
```

Expected:

```text
/private/tmp/vera-railway-deploy-9595e3d
/private/tmp/vera-railway-deploy-9595e3d
codex/search-composer-azure-runtime
```

The tracked worktree is clean and the final SHA is recorded.

- [ ] **Step 5: Report the next gated actions without performing them**

Report:

- files and commits changed;
- exact local checks and results;
- the unchanged signed-image baseline;
- `founder_browser_experimental=no_go` until a replacement passes CI, image, signing,
  attestation, and live transport gates;
- publication requires a fresh explicit remote authorization;
- any Azure or Maritime acceptance run requires a fresh explicit remote authorization; and
- the existing RentCast and `founder_core` paths remain unchanged.
