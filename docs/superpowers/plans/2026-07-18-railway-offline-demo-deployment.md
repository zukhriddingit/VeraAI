# Railway Offline Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Vera's existing sanitized Ship Season demo to one public Railway service with a persistent SQLite volume, a supervised worker, and fail-closed startup.

**Architecture:** A compiled Node bootstrap validates Railway's `/data` volume and `PORT`, forces demo mode, removes live-model configuration, migrates and idempotently seeds SQLite, then supervises the compiled worker and production Next.js server. Railway Railpack builds the pnpm workspace, starts only that bootstrap, checks `/api/health`, and runs exactly one replica.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 11.14.0, Next.js 16.2.10, SQLite/better-sqlite3 12.11.1, Drizzle ORM 0.45.2, esbuild 0.28.1, Vitest 4.1.10, Playwright 1.61.1, Railway CLI 5.27.0.

## Global Constraints

- Deploy only sanitized fixture data; the exact demo-mode disclosure remains visible.
- Do not add marketplace scraping, browser automation, Gmail, Calendar, AI, credentials, or real personal data.
- Every missing or invalid source, storage, and demo capability fails closed.
- Use one Railway service, one `/data` volume, and exactly one replica.
- Run migration and idempotent seed at runtime after the Railway volume is mounted, never at build or pre-deploy time.
- Bind Next.js to `0.0.0.0` and Railway's injected `PORT`; use `/api/health` for health checks.
- Do not log secrets, fixture payloads, or filesystem paths.

---

### Task 1: Railway environment and migration contracts

**Files:**

- Create: `scripts/railway-environment.ts`
- Create: `scripts/railway-environment.unit.test.ts`
- Modify: `packages/db/src/migrations.ts`
- Test: `packages/db/src/migration.integration.test.ts`

**Interfaces:**

- Produces: `resolveRailwayConfiguration(environment, options): RailwayConfiguration`.
- Produces: `migrateDatabase(connection, options?: { migrationsFolder?: string }): void`.
- `RailwayConfiguration` contains `dataDirectory`, numeric `port`, and a sanitized `childEnvironment`.

- [ ] **Step 1: Write the failing environment tests**

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveRailwayConfiguration } from "./railway-environment.ts";

const checks = {
  expectedMountPath: "/data",
  assertDirectory: vi.fn(),
  assertReadableWritable: vi.fn()
};

describe("Railway environment", () => {
  it.each([
    [{ PORT: "3000" }, "Railway volume mount is required"],
    [
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "relative/data" },
      "Railway volume mount must be absolute"
    ],
    [
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "/tmp/data" },
      "Railway volume must be mounted at /data"
    ]
  ])("rejects invalid storage configuration", (environment, message) => {
    expect(() => resolveRailwayConfiguration(environment, checks)).toThrow(message);
  });

  it.each(["", "0", "65536", "abc", "3000.5"])("rejects invalid PORT %s", (port) => {
    expect(() =>
      resolveRailwayConfiguration(
        { PORT: port, RAILWAY_VOLUME_MOUNT_PATH: "/data" },
        checks
      )
    ).toThrow("Railway PORT must be an integer between 1 and 65535");
  });

  it("forces demo mode and removes live model configuration", () => {
    const configuration = resolveRailwayConfiguration(
      {
        PORT: "3000",
        RAILWAY_VOLUME_MOUNT_PATH: "/data",
        OPENAI_API_KEY: "not-a-real-key",
        VERA_LLM_MODEL: "live-model",
        VERA_LLM_TIMEOUT_MS: "1000",
        VERA_DEMO_DATA_DIR: "/tmp/override"
      },
      checks
    );

    expect(configuration).toMatchObject({ dataDirectory: "/data", port: 3000 });
    expect(configuration.childEnvironment).toMatchObject({
      VERA_DATA_DIR: "/data",
      VERA_DEMO_MODE: "1",
      NEXT_TELEMETRY_DISABLED: "1"
    });
    expect(configuration.childEnvironment.OPENAI_API_KEY).toBeUndefined();
    expect(configuration.childEnvironment.VERA_LLM_MODEL).toBeUndefined();
    expect(configuration.childEnvironment.VERA_LLM_TIMEOUT_MS).toBeUndefined();
    expect(configuration.childEnvironment.VERA_DEMO_DATA_DIR).toBeUndefined();
  });

  it("fails closed when the volume cannot be accessed", () => {
    expect(() =>
      resolveRailwayConfiguration(
        { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "/data" },
        {
          ...checks,
          assertReadableWritable() {
            throw new Error("unwritable");
          }
        }
      )
    ).toThrow("Railway volume is unavailable or not writable");
  });
});
```

- [ ] **Step 2: Run the unit test and verify it fails**

Run: `pnpm exec vitest run --project unit scripts/railway-environment.unit.test.ts`

Expected: FAIL because `scripts/railway-environment.ts` does not exist.

- [ ] **Step 3: Implement strict environment validation and sanitization**

```ts
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const RAILWAY_VOLUME_PATH = "/data";

export interface RailwayConfiguration {
  readonly dataDirectory: string;
  readonly port: number;
  readonly childEnvironment: NodeJS.ProcessEnv;
}

export interface RailwayEnvironmentOptions {
  readonly expectedMountPath?: string;
  readonly assertDirectory?: (path: string) => void;
  readonly assertReadableWritable?: (path: string) => void;
}

function defaultAssertDirectory(path: string): void {
  if (!statSync(path).isDirectory()) throw new Error("not-directory");
}

function defaultAssertReadableWritable(path: string): void {
  accessSync(path, constants.R_OK | constants.W_OK);
}

export function resolveRailwayConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  options: RailwayEnvironmentOptions = {}
): RailwayConfiguration {
  const rawMountPath = environment.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (!rawMountPath) throw new Error("Railway volume mount is required.");
  if (!isAbsolute(rawMountPath)) throw new Error("Railway volume mount must be absolute.");

  const expectedMountPath = resolve(options.expectedMountPath ?? RAILWAY_VOLUME_PATH);
  const dataDirectory = resolve(rawMountPath);
  if (dataDirectory !== expectedMountPath) {
    throw new Error(`Railway volume must be mounted at ${RAILWAY_VOLUME_PATH}.`);
  }

  try {
    (options.assertDirectory ?? defaultAssertDirectory)(dataDirectory);
    (options.assertReadableWritable ?? defaultAssertReadableWritable)(dataDirectory);
  } catch {
    throw new Error("Railway volume is unavailable or not writable.");
  }

  const rawPort = environment.PORT?.trim() ?? "";
  if (!/^\d+$/.test(rawPort)) {
    throw new Error("Railway PORT must be an integer between 1 and 65535.");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Railway PORT must be an integer between 1 and 65535.");
  }

  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    VERA_DATA_DIR: dataDirectory,
    VERA_DEMO_MODE: "1",
    NEXT_TELEMETRY_DISABLED: "1"
  };
  delete childEnvironment.OPENAI_API_KEY;
  delete childEnvironment.VERA_LLM_MODEL;
  delete childEnvironment.VERA_LLM_TIMEOUT_MS;
  delete childEnvironment.VERA_DEMO_DATA_DIR;

  return { childEnvironment, dataDirectory, port };
}
```

- [ ] **Step 4: Make migration location explicit for the compiled bootstrap**

Change `packages/db/src/migrations.ts` so the public signature is:

```ts
export interface MigrationOptions {
  readonly migrationsFolder?: string;
}

export function migrateDatabase(
  connection: VeraDatabaseConnection,
  options: MigrationOptions = {}
): void {
  const resolvedMigrationsFolder = options.migrationsFolder ?? migrationsFolder;
  const foreignKeysEnabled = connection.sqlite.pragma("foreign_keys", { simple: true }) === 1;

  connection.sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(connection.db, { migrationsFolder: resolvedMigrationsFolder });
  } finally {
    if (foreignKeysEnabled) connection.sqlite.pragma("foreign_keys = ON");
  }

  const violations = connection.sqlite.pragma("foreign_key_check") as readonly unknown[];
  if (violations.length > 0) {
    throw new Error("Database migration left foreign-key integrity violations.");
  }
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run --project unit scripts/railway-environment.unit.test.ts`

Expected: PASS.

Run: `pnpm exec vitest run --project integration packages/db/src/migration.integration.test.ts`

Expected: PASS with the default migration folder still covered.

- [ ] **Step 6: Commit the contract**

```bash
git add scripts/railway-environment.ts scripts/railway-environment.unit.test.ts packages/db/src/migrations.ts
git commit -m "feat: add fail-closed Railway environment contract"
```

### Task 2: Database bootstrap and process supervisor

**Files:**

- Create: `scripts/railway-runtime.ts`
- Create: `scripts/railway-start.ts`
- Create: `scripts/railway-runtime.unit.test.ts`
- Create: `scripts/railway-runtime.integration.test.ts`
- Create: `scripts/build-railway-start.mjs`

**Interfaces:**

- Consumes: `RailwayConfiguration` and explicit migration-folder support from Task 1.
- Produces: `initializeRailwayDatabase(configuration, options): SeedResult`.
- Produces: `superviseRailwayProcesses(children, signalSource, logger): Promise<number>`.
- Produces: `runRailwayDeployment(): Promise<number>` and `dist/railway-start.mjs`.

- [ ] **Step 1: Write failing idempotency and supervisor tests**

```ts
// scripts/railway-runtime.integration.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveRailwayConfiguration } from "./railway-environment.ts";
import { initializeRailwayDatabase } from "./railway-runtime.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Railway database bootstrap", () => {
  it("migrates and seeds the mounted database idempotently", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "vera-railway-"));
    temporaryDirectories.push(dataDirectory);
    const configuration = resolveRailwayConfiguration(
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: dataDirectory },
      { expectedMountPath: dataDirectory }
    );

    const first = initializeRailwayDatabase(configuration, { rootDirectory: process.cwd() });
    const second = initializeRailwayDatabase(configuration, { rootDirectory: process.cwd() });

    expect(first).toMatchObject({ rawListings: 12, sourceRecords: 12, canonicalListings: 8 });
    expect(second).toEqual(first);
    expect(existsSync(join(dataDirectory, "vera.sqlite"))).toBe(true);
  });
});
```

```ts
// scripts/railway-runtime.unit.test.ts
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  superviseRailwayProcesses,
  type ManagedRailwayProcess
} from "./railway-runtime.ts";

class FakeProcess extends EventEmitter implements ManagedRailwayProcess {
  killed = false;
  signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }
}

describe("Railway process supervisor", () => {
  it("terminates the sibling and fails when one child exits", async () => {
    const web = new FakeProcess();
    const worker = new FakeProcess();
    const result = superviseRailwayProcesses(
      [
        { name: "web", process: web },
        { name: "worker", process: worker }
      ],
      new EventEmitter(),
      { info() {}, error() {} }
    );

    web.emit("exit", 1, null);
    await expect(result).resolves.toBe(1);
    expect(worker.signals).toEqual(["SIGTERM"]);
  });

  it("forwards SIGTERM and exits cleanly", async () => {
    const signals = new EventEmitter();
    const web = new FakeProcess();
    const worker = new FakeProcess();
    const result = superviseRailwayProcesses(
      [
        { name: "web", process: web },
        { name: "worker", process: worker }
      ],
      signals,
      { info() {}, error() {} }
    );

    signals.emit("SIGTERM");
    await expect(result).resolves.toBe(0);
    expect(web.signals).toEqual(["SIGTERM"]);
    expect(worker.signals).toEqual(["SIGTERM"]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm exec vitest run --project unit scripts/railway-runtime.unit.test.ts`

Expected: FAIL because `scripts/railway-runtime.ts` does not exist.

Run: `pnpm exec vitest run --project integration scripts/railway-runtime.integration.test.ts`

Expected: FAIL for the same reason.

- [ ] **Step 3: Implement database bootstrap and supervised child processes**

`scripts/railway-runtime.ts` must:

```ts
import { spawn, type SpawnOptions } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type SeedResult
} from "../packages/db/src/index.ts";
import {
  resolveRailwayConfiguration,
  type RailwayConfiguration
} from "./railway-environment.ts";

const defaultRootDirectory = fileURLToPath(new URL("../", import.meta.url));

export interface ManagedRailwayProcess {
  readonly killed: boolean;
  kill(signal: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
}

export interface RailwaySignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface RailwayLogger {
  info(record: Readonly<Record<string, unknown>>): void;
  error(record: Readonly<Record<string, unknown>>): void;
}

export interface NamedRailwayProcess {
  readonly name: "web" | "worker";
  readonly process: ManagedRailwayProcess;
}

export function initializeRailwayDatabase(
  configuration: RailwayConfiguration,
  options: { readonly rootDirectory?: string } = {}
): SeedResult {
  const rootDirectory = options.rootDirectory ?? defaultRootDirectory;
  const connection = openDatabase({ filePath: join(configuration.dataDirectory, "vera.sqlite") });
  try {
    migrateDatabase(connection, { migrationsFolder: join(rootDirectory, "packages/db/drizzle") });
    return seedDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
}

export function superviseRailwayProcesses(
  children: readonly NamedRailwayProcess[],
  signalSource: RailwaySignalSource = process,
  logger: RailwayLogger = console
): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exitCode: number, event: string): void => {
      if (settled) return;
      settled = true;
      signalSource.off("SIGINT", onSigint);
      signalSource.off("SIGTERM", onSigterm);
      for (const child of children) {
        if (!child.process.killed) child.process.kill("SIGTERM");
      }
      (exitCode === 0 ? logger.info : logger.error)({ event });
      resolve(exitCode);
    };
    const onSigint = () => finish(0, "railway_shutdown_requested");
    const onSigterm = () => finish(0, "railway_shutdown_requested");
    signalSource.once("SIGINT", onSigint);
    signalSource.once("SIGTERM", onSigterm);
    for (const child of children) {
      child.process.once("error", () => finish(1, `${child.name}_process_error`));
      child.process.once("exit", () => finish(1, `${child.name}_process_exited`));
    }
  });
}

export async function runRailwayDeployment(): Promise<number> {
  const configuration = resolveRailwayConfiguration();
  const seedResult = initializeRailwayDatabase(configuration);
  console.info(JSON.stringify({ event: "railway_database_ready", ...seedResult }));

  const commonOptions: SpawnOptions = {
    cwd: defaultRootDirectory,
    env: configuration.childEnvironment,
    stdio: "inherit"
  };
  const worker = spawn(process.execPath, [join(defaultRootDirectory, "apps/worker/dist/index.js")], commonOptions);
  let web: ManagedRailwayProcess;
  try {
    web = spawn(
      process.execPath,
      [
        join(defaultRootDirectory, "apps/web/node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "0.0.0.0",
        "--port",
        String(configuration.port)
      ],
      commonOptions
    );
  } catch (error: unknown) {
    worker.kill("SIGTERM");
    throw error;
  }

  return superviseRailwayProcesses([
    { name: "worker", process: worker },
    { name: "web", process: web }
  ]);
}
```

The implementation may add narrow type adapters around Node's `ChildProcess`, but it must preserve the exported interfaces and behavior above.

- [ ] **Step 4: Add a sanitized entry point**

```ts
// scripts/railway-start.ts
import { runRailwayDeployment } from "./railway-runtime.ts";

try {
  process.exitCode = await runRailwayDeployment();
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      event: "railway_start_failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    })}\n`
  );
  process.exitCode = 1;
}
```

- [ ] **Step 5: Add the production bootstrap build**

```js
// scripts/build-railway-start.mjs
import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["scripts/railway-start.ts"],
  external: ["better-sqlite3"],
  format: "esm",
  logLevel: "info",
  outfile: "dist/railway-start.mjs",
  platform: "node",
  sourcemap: true,
  target: "node24"
});
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run --project unit scripts/railway-environment.unit.test.ts scripts/railway-runtime.unit.test.ts`

Expected: PASS.

Run: `pnpm exec vitest run --project integration scripts/railway-runtime.integration.test.ts`

Expected: PASS twice-seeded database equality and expected fixture counts.

- [ ] **Step 7: Commit the runtime**

```bash
git add scripts/railway-runtime.ts scripts/railway-start.ts scripts/railway-runtime.unit.test.ts scripts/railway-runtime.integration.test.ts scripts/build-railway-start.mjs
git commit -m "feat: supervise Railway demo runtime"
```

### Task 3: Railway configuration, scripts, and operator documentation

**Files:**

- Create: `railway.toml`
- Create: `scripts/railway-config.unit.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Modify: `docs/DEMO_NOW.md`
- Modify: `docs/superpowers/specs/2026-07-18-railway-offline-demo-deployment-design.md`

**Interfaces:**

- Consumes: `scripts/build-railway-start.mjs` and `dist/railway-start.mjs` from Task 2.
- Produces: root `pnpm deploy:railway` and Railway config-as-code.

- [ ] **Step 1: Write the failing config contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Railway configuration", () => {
  it("uses the approved build, start, health, and restart contract", () => {
    expect(readFileSync("railway.toml", "utf8")).toBe(`[build]
builder = "RAILPACK"
buildCommand = "pnpm build"

[deploy]
startCommand = "pnpm deploy:railway"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
`);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run --project unit scripts/railway-config.unit.test.ts`

Expected: FAIL because `railway.toml` does not exist.

- [ ] **Step 3: Add exact Railway config-as-code**

```toml
[build]
builder = "RAILPACK"
buildCommand = "pnpm build"

[deploy]
startCommand = "pnpm deploy:railway"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 4: Wire root scripts**

Change root scripts to:

```json
{
  "build": "pnpm -r --if-present run build && node scripts/build-railway-start.mjs",
  "deploy:railway": "node dist/railway-start.mjs"
}
```

All existing scripts remain unchanged.

Add root runtime dependency `"better-sqlite3": "12.11.1"`. The compiled bootstrap intentionally
keeps the native addon external, so the root package must make it resolvable from
`dist/railway-start.mjs`. Refresh `pnpm-lock.yaml` with `pnpm install --lockfile-only`.

Add `.railway/` to `.gitignore` so account/project link metadata remains local and credentials can never be staged from that directory.

- [ ] **Step 5: Document deployment and mark the approved spec**

Add to `docs/DEMO_NOW.md`:

```markdown
## Railway demo

The public deployment is one fixture-only Railway service with one `/data` volume and one replica. Runtime startup validates the volume, forces `VERA_DEMO_MODE=1`, removes live-model configuration, migrates and idempotently seeds SQLite, then supervises the worker and web server.

Build: `pnpm build`  
Start: `pnpm deploy:railway`  
Health: `/api/health`
```

Change the deployment design status to `Approved for implementation on 2026-07-18`.

- [ ] **Step 6: Run config, build, and fail-closed smoke checks**

Run: `pnpm exec vitest run --project unit scripts/railway-config.unit.test.ts`

Expected: PASS.

Run: `pnpm build`

Expected: PASS and `dist/railway-start.mjs` exists.

Run: `env -u RAILWAY_VOLUME_MOUNT_PATH PORT=3000 pnpm deploy:railway`

Expected: exit 1 with only `{"event":"railway_start_failed","errorType":"Error"}` on stderr; no fallback database is created.

- [ ] **Step 7: Commit deployment configuration**

```bash
git add railway.toml package.json pnpm-lock.yaml .gitignore scripts/railway-config.unit.test.ts docs/DEMO_NOW.md docs/superpowers/specs/2026-07-18-railway-offline-demo-deployment-design.md docs/superpowers/plans/2026-07-18-railway-offline-demo-deployment.md
git commit -m "feat: configure Railway offline demo"
```

### Task 4: Acceptance, push, Railway provisioning, and public verification

**Files:**

- Verify only; no product files are added in this task.
- Railway creates local link metadata under `.railway/`; verify it contains no credentials before deciding whether it remains ignored or local-only.

**Interfaces:**

- Consumes: public GitHub repository `zukhriddingit/VeraAI`, `railway.toml`, `pnpm deploy:railway`, and `/api/health`.
- Produces: one public Railway URL and a verified persistent fixture deployment.

- [ ] **Step 1: Run the complete local acceptance gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build
```

Expected: every command passes; the existing opt-in live integration test remains skipped unless credentials are explicitly supplied.

- [ ] **Step 2: Push implementation commits**

```bash
git status --short
git push origin main
```

Expected: clean status and remote `main` updated.

- [ ] **Step 3: Authenticate and provision Railway with CLI 5.27.0**

```bash
pnpm dlx @railway/cli@5.27.0 whoami
pnpm dlx @railway/cli@5.27.0 init --name VeraAI --json
pnpm dlx @railway/cli@5.27.0 add --service vera --json
pnpm dlx @railway/cli@5.27.0 service link vera
pnpm dlx @railway/cli@5.27.0 volume add --mount-path /data --json
pnpm dlx @railway/cli@5.27.0 variable set VERA_DEMO_MODE=1 --service vera --skip-deploys --json
pnpm dlx @railway/cli@5.27.0 variable set NEXT_TELEMETRY_DISABLED=1 --service vera --skip-deploys --json
pnpm dlx @railway/cli@5.27.0 status --json
```

Expected: a linked project, one service named `vera`, one `/data` volume, exactly one replica, and only non-secret demo variables. If `whoami` is unauthenticated, run `pnpm dlx @railway/cli@5.27.0 login` and complete Railway's official browser/device authorization; never commit credentials.

- [ ] **Step 4: Deploy and generate a public domain**

```bash
pnpm dlx @railway/cli@5.27.0 up --service vera --detach --json --message "Deploy sanitized Vera Ship Season demo"
pnpm dlx @railway/cli@5.27.0 domain --service vera --json
pnpm dlx @railway/cli@5.27.0 deployment list --service vera --limit 1 --json
```

Expected: deployment reaches `SUCCESS` and the domain command returns one Railway-provided HTTPS URL.

- [ ] **Step 5: Verify runtime, fixtures, and logs**

```bash
pnpm dlx @railway/cli@5.27.0 domain list --service vera --json
curl -fsS "$VERA_RAILWAY_URL/api/health"
curl -fsS "$VERA_RAILWAY_URL/"
pnpm dlx @railway/cli@5.27.0 logs --service vera --lines 100 --json
```

Before the two `curl` commands, set the task-specific shell variable `VERA_RAILWAY_URL` to the exact HTTPS domain returned by `railway domain list`. Expected: health is `ok`; the dashboard contains `Demo mode — sanitized fixture data; no live marketplace accounts connected.`; logs contain migration/seed, web, and worker startup events and contain no credentials, fixture payloads, or local filesystem paths.

- [ ] **Step 6: Verify persistence and idempotency across restart**

Record the seed summary from logs, then run:

```bash
pnpm dlx @railway/cli@5.27.0 restart --service vera --yes --json
pnpm dlx @railway/cli@5.27.0 deployment list --service vera --limit 1 --json
pnpm dlx @railway/cli@5.27.0 logs --service vera --lines 100 --json
```

Expected: the restarted service returns to `SUCCESS`; seed counts remain 12 raw listings, 12 source records, and 8 canonical listings with no duplicate increase; `/api/health` still returns 200.

- [ ] **Step 7: Report the public link and evidence**

Report the GitHub URL, Railway URL, deployment status, health result, fixture counts, acceptance-gate results, restart/idempotency result, files changed, and any remaining limitation. Do not claim completion until each item has direct command or HTTP evidence.
