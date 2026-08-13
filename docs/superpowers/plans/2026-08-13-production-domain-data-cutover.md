# Production Domain and Data Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Vera's web, deterministic worker, and managed PostgreSQL critical path on Heroku, restore all retained data, make `/api/ready` healthy, and serve the existing marketing project at `verahousing.app` without changing OpenClaw.

**Architecture:** Add a versioned, non-secret Heroku production manifest plus fail-closed release and database-transfer verifiers. Build web and worker images from one reviewed commit, restore a verified DigitalOcean PostgreSQL dump into an unpromoted Heroku Standard-tier database, release both processes together, then attach the apex and `www` domains to the existing Vercel marketing project while preserving `app.verahousing.app`.

**Tech Stack:** TypeScript 6.0.3, Node.js 24, pnpm 11.14.0, Vitest 4.1.10, PostgreSQL 18 client tools, Docker/OCI images, Heroku Container Registry and Heroku Postgres, Vercel, Name.com DNS, DigitalOcean, Maritime/OpenClaw.

## Global Constraints

- Work only in `/private/tmp/vera-m13b-pr75-live-20260811` on branch `codex/production-domain-data-cutover`.
- Use one branch and one final PR; production provider mutations happen only after the PR is green and merged.
- Preserve the DigitalOcean PostgreSQL container, the Railway PostgreSQL volume, every RawListing/provenance/audit row, and all private evidence.
- Never commit or print database URLs, passwords, tokens, pairing values, OAuth material, cookies, raw listings, private infrastructure addresses, or provider exports.
- Do not build, push, restart, reconfigure, or replace the signed OpenClaw Gateway.
- Do not weaken TLS, hostname restrictions, one-tab sharing, cancellation, source limits, forbidden-action checks, or manual blocker behavior.
- Keep Maritime as the approved browser-orchestration boundary; the Heroku worker may run deterministic database work but receives no browser session or credential.
- Heroku production runs exactly one `web` and one `worker` process from the same reviewed commit.
- The managed database is Heroku Postgres Standard-0 or a higher inspected plan in the same region as the dynos.
- The marketing canonical URL is `https://verahousing.app`; `https://www.verahousing.app` permanently redirects to it; `https://app.verahousing.app` remains the authenticated product.
- Run focused tests while iterating and full CI exactly once on the final PR before merge.
- All external writes are preceded by read-only target resolution and followed by bounded verification.

## File Map

- Create `infra/heroku/production-manifest.json`: non-secret desired production topology and immutable safety exclusions.
- Create `scripts/verify-heroku-production.ts`: fail-closed static verifier for the Heroku manifest, Dockerfiles, and CI image pairing.
- Create `scripts/verify-heroku-production.unit.test.ts`: mutation tests for topology, image, readiness, source-revision, and OpenClaw exclusions.
- Create `scripts/production-postgres-transfer.ts`: secret-safe dump/list/restore helper using private URL files and password-free process arguments.
- Create `scripts/production-postgres-transfer.unit.test.ts`: target/path/argument/redaction regression tests.
- Create `scripts/production-data-manifest.ts`: capture and compare safe table counts, migration hashes, database controls, and forbidden-action count.
- Create `scripts/production-data-manifest.unit.test.ts`: canonicalization, tamper, mismatch, and private-path tests.
- Modify `package.json`: expose the three production verification commands.
- Modify `.github/workflows/ci.yml`: run Heroku topology verification and build both application images without publishing them.
- Modify `README.md`: replace obsolete Railway production assumptions with the approved Heroku critical path.
- Modify `docs/ARCHITECTURE.md`: record the Heroku application/database overlay and keep Maritime/OpenClaw boundaries explicit.
- Modify `docs/POSTGRES_OPERATIONS.md`: add the private-file dump/restore, manifest comparison, promotion, and rollback commands.
- Modify `docs/RELEASE_READINESS.md`: add a dated production-cutover gate without rewriting historical browser evidence.
- Modify `docs/superpowers/specs/2026-08-13-production-domain-data-cutover-design.md`: mark the reviewed specification approved.

---

### Task 1: Encode and verify the Heroku production boundary

**Files:**
- Create: `infra/heroku/production-manifest.json`
- Create: `scripts/verify-heroku-production.ts`
- Create: `scripts/verify-heroku-production.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Dockerfile.web`, `Dockerfile`, `.github/workflows/ci.yml` as text.
- Produces: `findHerokuProductionViolations(input): string[]` and `pnpm verify:heroku-production`.

- [ ] **Step 1: Write the failing topology tests**

Create `scripts/verify-heroku-production.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { findHerokuProductionViolations } from "./verify-heroku-production.ts";

const manifest = {
  version: "vera-heroku-production.v1",
  app: "vera-housing-app",
  productDomain: "app.verahousing.app",
  marketingDomain: "verahousing.app",
  processes: {
    web: { dockerfile: "Dockerfile.web", quantity: 1, readinessPath: "/api/ready" },
    worker: { dockerfile: "Dockerfile", quantity: 1, readinessPath: "/health" }
  },
  database: {
    provider: "heroku-postgresql",
    minimumPlan: "standard-0",
    attachment: "VERA_GREEN_DATABASE",
    sameRegion: true
  },
  release: {
    processTypes: ["web", "worker"],
    sourceRevisionLabel: "org.opencontainers.image.revision",
    automaticDeploy: false
  },
  openclaw: { deploymentAction: "none", gatewayImageChange: false }
} as const;

const webDockerfile = `USER vera
HEALTHCHECK CMD fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready')
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
`;
const workerDockerfile = `USER vera
HEALTHCHECK CMD fetch('http://127.0.0.1:8080/health')
CMD ["node", "apps/worker/dist/index.js", "serve"]
`;
const workflow = `
app_images:
  name: Build Heroku application images
  steps:
    - name: Build Heroku web image
      with:
        file: Dockerfile.web
        push: false
        tags: vera-web:ci
        labels: org.opencontainers.image.revision=\${{ github.event.pull_request.head.sha || github.sha }}
    - name: Build Heroku worker image
      with:
        file: Dockerfile
        push: false
        tags: vera-worker:ci
        labels: org.opencontainers.image.revision=\${{ github.event.pull_request.head.sha || github.sha }}
`;

function input(overrides: Record<string, unknown> = {}) {
  return { manifest, webDockerfile, workerDockerfile, workflow, ...overrides };
}

describe("Heroku production boundaries", () => {
  it("accepts the paired application topology", () => {
    expect(findHerokuProductionViolations(input())).toEqual([]);
  });

  it.each([
    ["wrong app", { ...manifest, app: "vera-staging" }],
    ["wrong product domain", { ...manifest, productDomain: "verahousing.app" }],
    ["two workers", { ...manifest, processes: { ...manifest.processes, worker: { ...manifest.processes.worker, quantity: 2 } } }],
    ["development database", { ...manifest, database: { ...manifest.database, minimumPlan: "essential-0" } }],
    ["automatic deploy", { ...manifest, release: { ...manifest.release, automaticDeploy: true } }],
    ["Gateway mutation", { ...manifest, openclaw: { deploymentAction: "restart", gatewayImageChange: false } }]
  ])("rejects %s", (_name, changed) => {
    expect(findHerokuProductionViolations(input({ manifest: changed }))).not.toEqual([]);
  });

  it("rejects a workflow that builds only web", () => {
    expect(
      findHerokuProductionViolations(input({ workflow: workflow.replace("Build Heroku worker image", "Removed worker image") }))
    ).toContain("CI must build the Heroku web and worker images from one source revision.");
  });

  it("rejects publishing or Gateway work in the application image job", () => {
    expect(
      findHerokuProductionViolations(input({ workflow: workflow.replace("push: false", "push: true") }))
    ).toContain("Application-image CI must verify without publishing.");
  });
});
```

- [ ] **Step 2: Run the test and confirm the verifier is missing**

Run:

```sh
pnpm exec vitest run --project unit scripts/verify-heroku-production.unit.test.ts
```

Expected: FAIL because `scripts/verify-heroku-production.ts` does not exist.

- [ ] **Step 3: Create the production manifest**

Create `infra/heroku/production-manifest.json` with exactly:

```json
{
  "version": "vera-heroku-production.v1",
  "app": "vera-housing-app",
  "productDomain": "app.verahousing.app",
  "marketingDomain": "verahousing.app",
  "processes": {
    "web": {
      "dockerfile": "Dockerfile.web",
      "quantity": 1,
      "readinessPath": "/api/ready"
    },
    "worker": {
      "dockerfile": "Dockerfile",
      "quantity": 1,
      "readinessPath": "/health"
    }
  },
  "database": {
    "provider": "heroku-postgresql",
    "minimumPlan": "standard-0",
    "attachment": "VERA_GREEN_DATABASE",
    "sameRegion": true
  },
  "release": {
    "processTypes": ["web", "worker"],
    "sourceRevisionLabel": "org.opencontainers.image.revision",
    "automaticDeploy": false
  },
  "openclaw": {
    "deploymentAction": "none",
    "gatewayImageChange": false
  }
}
```

- [ ] **Step 4: Implement the fail-closed verifier**

Create `scripts/verify-heroku-production.ts`:

```ts
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface Manifest {
  readonly version?: string;
  readonly app?: string;
  readonly productDomain?: string;
  readonly marketingDomain?: string;
  readonly processes?: {
    readonly web?: { readonly dockerfile?: string; readonly quantity?: number; readonly readinessPath?: string };
    readonly worker?: { readonly dockerfile?: string; readonly quantity?: number; readonly readinessPath?: string };
  };
  readonly database?: {
    readonly provider?: string;
    readonly minimumPlan?: string;
    readonly attachment?: string;
    readonly sameRegion?: boolean;
  };
  readonly release?: {
    readonly processTypes?: readonly string[];
    readonly sourceRevisionLabel?: string;
    readonly automaticDeploy?: boolean;
  };
  readonly openclaw?: { readonly deploymentAction?: string; readonly gatewayImageChange?: boolean };
}

export function findHerokuProductionViolations(input: {
  readonly manifest: Manifest;
  readonly webDockerfile: string;
  readonly workerDockerfile: string;
  readonly workflow: string;
}): string[] {
  const violations: string[] = [];
  const { manifest } = input;
  if (manifest.version !== "vera-heroku-production.v1") violations.push("Heroku manifest version is invalid.");
  if (manifest.app !== "vera-housing-app") violations.push("Heroku production app identity is invalid.");
  if (manifest.productDomain !== "app.verahousing.app" || manifest.marketingDomain !== "verahousing.app") {
    violations.push("Production product and marketing domains are invalid.");
  }
  if (
    manifest.processes?.web?.dockerfile !== "Dockerfile.web" ||
    manifest.processes.web.quantity !== 1 ||
    manifest.processes.web.readinessPath !== "/api/ready" ||
    manifest.processes?.worker?.dockerfile !== "Dockerfile" ||
    manifest.processes.worker.quantity !== 1 ||
    manifest.processes.worker.readinessPath !== "/health"
  ) {
    violations.push("Heroku must run exactly one web and one worker with reviewed readiness paths.");
  }
  if (
    manifest.database?.provider !== "heroku-postgresql" ||
    manifest.database.minimumPlan !== "standard-0" ||
    manifest.database.attachment !== "VERA_GREEN_DATABASE" ||
    manifest.database.sameRegion !== true
  ) {
    violations.push("Heroku production database policy is invalid.");
  }
  if (
    JSON.stringify(manifest.release?.processTypes) !== JSON.stringify(["web", "worker"]) ||
    manifest.release?.sourceRevisionLabel !== "org.opencontainers.image.revision" ||
    manifest.release.automaticDeploy !== false
  ) {
    violations.push("Heroku releases must pair web and worker under operator control.");
  }
  if (manifest.openclaw?.deploymentAction !== "none" || manifest.openclaw.gatewayImageChange !== false) {
    violations.push("The Heroku release must not mutate OpenClaw.");
  }
  if (!input.webDockerfile.includes("/api/ready") || !input.webDockerfile.includes("USER vera")) {
    violations.push("Heroku web image must retain non-root readiness.");
  }
  if (!input.workerDockerfile.includes("127.0.0.1:8080/health") || !input.workerDockerfile.includes("USER vera")) {
    violations.push("Heroku worker image must retain non-root health checks.");
  }
  const appJob = /app_images:[\s\S]*?(?=\n[a-zA-Z0-9_]+:|$)/u.exec(input.workflow)?.[0] ?? "";
  if (
    !appJob.includes("Build Heroku web image") ||
    !appJob.includes("file: Dockerfile.web") ||
    !appJob.includes("Build Heroku worker image") ||
    !/file:\s+Dockerfile(?:\s|$)/u.test(appJob) ||
    (appJob.match(/org\.opencontainers\.image\.revision=/gu) ?? []).length !== 2
  ) {
    violations.push("CI must build the Heroku web and worker images from one source revision.");
  }
  if (/push:\s+true/u.test(appJob)) violations.push("Application-image CI must verify without publishing.");
  if (/openclaw|gateway|remote-extension/iu.test(appJob)) {
    violations.push("Heroku application-image CI must not build OpenClaw or the Gateway.");
  }
  return violations;
}

async function main(): Promise<void> {
  const [manifestText, webDockerfile, workerDockerfile, workflow] = await Promise.all([
    readFile(new URL("../infra/heroku/production-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile.web", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  ]);
  const violations = findHerokuProductionViolations({
    manifest: JSON.parse(manifestText) as Manifest,
    webDockerfile,
    workerDockerfile,
    workflow
  });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Heroku production boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
```

- [ ] **Step 5: Add the package command and make the focused test pass**

Add to root `package.json` scripts:

```json
"verify:heroku-production": "tsx scripts/verify-heroku-production.ts"
```

Run:

```sh
pnpm exec vitest run --project unit scripts/verify-heroku-production.unit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the topology contract**

```sh
git add infra/heroku/production-manifest.json scripts/verify-heroku-production.ts scripts/verify-heroku-production.unit.test.ts package.json
git commit -m "build: define Heroku production topology"
```

---

### Task 2: Add secret-safe PostgreSQL dump and restore tooling

**Files:**
- Create: `scripts/production-postgres-transfer.ts`
- Create: `scripts/production-postgres-transfer.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: absolute private paths under `/private/tmp/` or `release-evidence/private/`.
- Produces: `connectionEnvironment(url): NodeJS.ProcessEnv`, `privateEvidencePath(path): string`, and `pnpm postgres:production-transfer` with `dump`, `list`, or `restore` mode.

- [ ] **Step 1: Write failing safety tests**

Create `scripts/production-postgres-transfer.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  connectionEnvironment,
  privateEvidencePath,
  restoreArguments
} from "./production-postgres-transfer.ts";

describe("production PostgreSQL transfer safety", () => {
  it("keeps the password out of subprocess arguments", () => {
    const environment = connectionEnvironment(
      "postgresql://vera:synthetic-secret@db.example.test:5432/vera?sslmode=require"
    );
    expect(environment).toMatchObject({
      PGHOST: "db.example.test",
      PGPORT: "5432",
      PGDATABASE: "vera",
      PGUSER: "vera",
      PGPASSWORD: "synthetic-secret",
      PGSSLMODE: "require"
    });
    expect(restoreArguments("vera", "/private/tmp/vera/production.dump").join(" ")).not.toContain(
      "synthetic-secret"
    );
  });

  it.each(["relative.dump", "/Users/example/production.dump", "/tmp/not-private.dump"])(
    "rejects a non-private path: %s",
    (path) => expect(() => privateEvidencePath(path)).toThrow("private evidence")
  );

  it("accepts the authoritative private evidence root", () => {
    expect(privateEvidencePath("/private/tmp/vera/production.dump")).toBe(
      "/private/tmp/vera/production.dump"
    );
  });

  it("restores without clean, create, owner, or ACL mutations", () => {
    expect(restoreArguments("vera", "/private/tmp/vera/production.dump")).toEqual([
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--dbname",
      "vera",
      "/private/tmp/vera/production.dump"
    ]);
  });
});
```

- [ ] **Step 2: Confirm the utility is missing**

Run:

```sh
pnpm exec vitest run --project unit scripts/production-postgres-transfer.unit.test.ts
```

Expected: FAIL because the implementation does not exist.

- [ ] **Step 3: Implement private-path and libpq environment handling**

Create `scripts/production-postgres-transfer.ts` with these exported primitives and keep the CLI in
the same file behind the normal `import.meta.url` guard:

```ts
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { openPostgresConnection, parsePostgresConfig } from "@vera/db";

export function privateEvidencePath(input: string): string {
  const path = resolve(input);
  const repositoryPrivate = resolve("release-evidence/private");
  if (
    !isAbsolute(path) ||
    !(path.startsWith("/private/tmp/") || path.startsWith(`${repositoryPrivate}/`))
  ) {
    throw new Error("Production PostgreSQL files must stay in a private evidence directory.");
  }
  return path;
}

export function connectionEnvironment(value: string): NodeJS.ProcessEnv {
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || !url.hostname || !url.username || url.pathname.length < 2) {
    throw new Error("Production PostgreSQL URL is invalid.");
  }
  const allowedQueryKeys = new Set(["sslmode", "sslrootcert", "uselibpqcompat", "application_name"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedQueryKeys.has(key)) throw new Error("Production PostgreSQL URL contains an unsupported option.");
  }
  const sslMode = url.searchParams.get("sslmode") ?? "require";
  if (!new Set(["require", "verify-ca", "verify-full"]).has(sslMode)) {
    throw new Error("Production PostgreSQL must use verified TLS.");
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: sslMode
  };
  const rootCertificate = url.searchParams.get("sslrootcert");
  if (rootCertificate) environment.PGSSLROOTCERT = rootCertificate;
  return environment;
}

export function restoreArguments(databaseName: string, dumpPath: string): string[] {
  if (!/^[a-zA-Z0-9_-]+$/u.test(databaseName)) throw new Error("Restore database name is invalid.");
  return ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", databaseName, dumpPath];
}

async function assertEmptyTarget(databaseUrl: string): Promise<void> {
  const connection = openPostgresConnection(
    parsePostgresConfig({ DATABASE_URL: databaseUrl, VERA_DB_POOL_MAX: "1" })
  );
  try {
    const result = await connection.pool.query<{ count: number }>(`
      select count(*)::int as count
        from information_schema.tables
       where table_schema in ('public', 'drizzle')
         and table_type = 'BASE TABLE'
    `);
    if ((result.rows[0]?.count ?? -1) !== 0) {
      throw new Error("Production restore target is not empty.");
    }
  } finally {
    await connection.close();
  }
}

async function checkedSpawn(
  command: "pg_dump" | "pg_restore",
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...arguments_], {
      env: environment,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 16_384) child.stderr.pause();
    });
    child.once("error", () => reject(new Error(`${command} is unavailable.`)));
    child.once("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} failed with redacted output.`))
    );
  });
}

async function fileSha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Production dump output already exists.");
}

function argument(arguments_: readonly string[], key: string): string {
  const index = arguments_.indexOf(key);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${key}.`);
  return privateEvidencePath(value);
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "dump" && mode !== "list" && mode !== "restore") {
    throw new Error("Expected dump, list, or restore mode.");
  }
  const dumpPath = argument(rest, "--dump-file");
  if (mode === "list") {
    await checkedSpawn("pg_restore", ["--list", dumpPath], process.env);
  } else {
    const databaseUrlFile = argument(rest, "--database-url-file");
    const databaseUrl = (await readFile(databaseUrlFile, "utf8")).trim();
    const environment = connectionEnvironment(databaseUrl);
    if (mode === "dump") {
      await assertMissing(dumpPath);
      await checkedSpawn(
        "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--schema=public",
          "--schema=drizzle",
          "--file",
          dumpPath
        ],
        environment
      );
      await chmod(dumpPath, 0o600);
    } else {
      if (!rest.includes("--confirm-empty-target")) {
        throw new Error("Restore requires --confirm-empty-target.");
      }
      await assertEmptyTarget(databaseUrl);
      const databaseName = environment.PGDATABASE;
      if (!databaseName) throw new Error("Restore target database name is missing.");
      await checkedSpawn(
        "pg_restore",
        restoreArguments(databaseName, dumpPath),
        environment
      );
    }
  }
  const metadata = await stat(dumpPath);
  process.stdout.write(
    `${JSON.stringify({
      event: `production_postgres_${mode}_completed`,
      dumpBytes: metadata.size,
      dumpSha256: await fileSha256(dumpPath)
    })}\n`
  );
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
```

Never pass the URL or password in subprocess arguments or error text.

- [ ] **Step 4: Add the command and pass focused tests**

Add to `package.json`:

```json
"postgres:production-transfer": "tsx scripts/production-postgres-transfer.ts"
```

Run:

```sh
pnpm exec vitest run --project unit scripts/production-postgres-transfer.unit.test.ts
```

Expected: PASS, including empty-target, private-path, TLS, and redaction cases added while completing
the implementation.

- [ ] **Step 5: Commit the transfer utility**

```sh
git add scripts/production-postgres-transfer.ts scripts/production-postgres-transfer.unit.test.ts package.json
git commit -m "feat: add safe production database transfer"
```

---

### Task 3: Add deterministic source/destination data manifests

**Files:**
- Create: `scripts/production-data-manifest.ts`
- Create: `scripts/production-data-manifest.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: a database URL in an absolute permission-restricted file.
- Produces: version `vera-production-data-manifest.v1`, a SHA-256 content hash, safe table counts, ordered migration hashes, control counts, and exact compare verification.

- [ ] **Step 1: Write failing canonicalization and mismatch tests**

Create `scripts/production-data-manifest.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertManifestMatches,
  createProductionDataManifest
} from "./production-data-manifest.ts";

const input = {
  capturedAt: "2026-08-13T12:00:00.000Z",
  migrations: ["b", "a"],
  tableCounts: [
    { table: "raw_listings", rows: 294 },
    { table: "activity_events", rows: 10 }
  ],
  controls: { appendOnlyTriggers: 8, tenantForeignKeys: 20, forbiddenBrowserActions: 0 }
};

describe("production data manifest", () => {
  it("is deterministic across collection order and capture time", () => {
    const left = createProductionDataManifest(input);
    const right = createProductionDataManifest({
      ...input,
      capturedAt: "2026-08-13T12:05:00.000Z",
      migrations: [...input.migrations].reverse(),
      tableCounts: [...input.tableCounts].reverse()
    });
    expect(left.contentHash).toBe(right.contentHash);
    expect(() => assertManifestMatches(left, right)).not.toThrow();
  });

  it("rejects a lost immutable row", () => {
    const expected = createProductionDataManifest(input);
    const actual = createProductionDataManifest({
      ...input,
      tableCounts: input.tableCounts.map((entry) =>
        entry.table === "raw_listings" ? { ...entry, rows: 293 } : entry
      )
    });
    expect(() => assertManifestMatches(expected, actual)).toThrow("do not match");
  });

  it("rejects nonzero forbidden actions", () => {
    expect(() =>
      createProductionDataManifest({
        ...input,
        controls: { ...input.controls, forbiddenBrowserActions: 1 }
      })
    ).toThrow("Forbidden browser actions");
  });
});
```

- [ ] **Step 2: Verify the manifest implementation is missing**

Run:

```sh
pnpm exec vitest run --project unit scripts/production-data-manifest.unit.test.ts
```

Expected: FAIL because the implementation does not exist.

- [ ] **Step 3: Implement canonical capture and comparison**

Create `scripts/production-data-manifest.ts`. Reuse `privateEvidencePath` from Task 2 and export these
exact data contracts:

```ts
interface TableCount {
  readonly table: string;
  readonly rows: number;
}

interface ManifestControls {
  readonly appendOnlyTriggers: number;
  readonly tenantForeignKeys: number;
  readonly forbiddenBrowserActions: number;
}

export interface ProductionDataManifest {
  readonly version: "vera-production-data-manifest.v1";
  readonly capturedAt: string;
  readonly migrations: readonly string[];
  readonly tableCounts: readonly TableCount[];
  readonly controls: ManifestControls;
  readonly contentHash: string;
}
```

`createProductionDataManifest` must:

```ts
export function createProductionDataManifest(input: {
  readonly capturedAt: string;
  readonly migrations: readonly string[];
  readonly tableCounts: readonly TableCount[];
  readonly controls: ManifestControls;
}): ProductionDataManifest {
  const migrations = [...input.migrations].sort();
  const tableCounts = [...input.tableCounts].sort((left, right) =>
    left.table.localeCompare(right.table)
  );
  for (const entry of tableCounts) {
    if (!/^[a-z][a-z0-9_]*$/u.test(entry.table) || !Number.isSafeInteger(entry.rows) || entry.rows < 0) {
      throw new Error("Production table count is invalid.");
    }
  }
  for (const value of Object.values(input.controls)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Production control count is invalid.");
  }
  if (input.controls.forbiddenBrowserActions !== 0) {
    throw new Error("Forbidden browser actions are nonzero.");
  }
  const payload = {
    version: "vera-production-data-manifest.v1" as const,
    migrations,
    tableCounts,
    controls: input.controls
  };
  return {
    ...payload,
    capturedAt: new Date(input.capturedAt).toISOString(),
    contentHash: sha256Text(canonicalJson(payload))
  };
}

export function assertManifestMatches(
  expected: ProductionDataManifest,
  actual: ProductionDataManifest
): void {
  const expectedRebuilt = createProductionDataManifest(expected);
  const actualRebuilt = createProductionDataManifest(actual);
  if (
    expected.contentHash !== expectedRebuilt.contentHash ||
    actual.contentHash !== actualRebuilt.contentHash ||
    expectedRebuilt.contentHash !== actualRebuilt.contentHash
  ) {
    throw new Error("Production data manifests do not match.");
  }
}
```

The runtime collector must:

1. list every base table in `public` from `information_schema.tables`;
2. validate each returned identifier against `^[a-z][a-z0-9_]*$` before issuing `count(*)::int`;
3. read ordered hashes from `drizzle.__drizzle_migrations`;
4. count non-internal append-only triggers and tenant foreign keys from `pg_catalog`;
5. count forbidden browser actions using the same action list as `listing-integrity-repair.ts`;
6. write only the manifest JSON with mode `0600`;
7. accept `capture` and `compare` modes with `--database-url-file`, `--output-file`, and, for
   compare, `--expected-file`;
8. emit only a fixed event name, table count, and content hash to stdout.

The database URL must be read from a private file and passed to `openPostgresConnection`; it must
never appear in output or an error.

- [ ] **Step 4: Add the command and run focused tests**

Add to `package.json`:

```json
"postgres:production-manifest": "tsx scripts/production-data-manifest.ts"
```

Run:

```sh
pnpm exec vitest run --project unit scripts/production-data-manifest.unit.test.ts scripts/production-postgres-transfer.unit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run an isolated PostgreSQL integration smoke**

Start the local PostgreSQL test service and migrate it:

```sh
pnpm postgres:up
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm db:migrate
```

Create a private synthetic URL file under `/private/tmp`, capture two manifests, and compare them.
Expected: compare succeeds; neither stdout nor artifacts contain the password. Remove only those
synthetic private files after the test.

- [ ] **Step 6: Commit the data manifest utility**

```sh
git add scripts/production-data-manifest.ts scripts/production-data-manifest.unit.test.ts package.json
git commit -m "feat: verify production data preservation"
```

---

### Task 4: Gate paired application images in CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/verify-heroku-production.unit.test.ts`

**Interfaces:**
- Consumes: `Dockerfile.web`, `Dockerfile`, the current PR/head SHA.
- Produces: a non-publishing `app_images` CI job that builds and inspects both images with the same OCI revision label.

- [ ] **Step 1: Make the repository verifier fail against the current CI**

Run:

```sh
pnpm verify:heroku-production
```

Expected: FAIL because the current CI job builds only the web image and identifies it as Railway.

- [ ] **Step 2: Replace the web-only image job with the paired application job**

Rename `web_image` to `app_images`, set its display name to `Build Heroku application images`, and
set `timeout-minutes: 35`. Keep the pinned checkout and Buildx actions. Replace its build/inspection
steps with:

```yaml
      - name: Build Heroku web image
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf # v7.2.0
        with:
          context: .
          file: Dockerfile.web
          pull: true
          load: true
          push: false
          tags: vera-web:ci
          labels: |
            org.opencontainers.image.revision=${{ github.event.pull_request.head.sha || github.sha }}

      - name: Build Heroku worker image
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf # v7.2.0
        with:
          context: .
          file: Dockerfile
          pull: true
          load: true
          push: false
          tags: vera-worker:ci
          labels: |
            org.opencontainers.image.revision=${{ github.event.pull_request.head.sha || github.sha }}

      - name: Verify paired runtime metadata
        shell: bash
        env:
          EXPECTED_REVISION: ${{ github.event.pull_request.head.sha || github.sha }}
        run: |
          set -euo pipefail
          test "$(docker image inspect vera-web:ci --format '{{.Config.User}}')" = "vera"
          test "$(docker image inspect vera-worker:ci --format '{{.Config.User}}')" = "vera"
          test "$(docker image inspect vera-web:ci --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$EXPECTED_REVISION"
          test "$(docker image inspect vera-worker:ci --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$EXPECTED_REVISION"
          docker image inspect vera-web:ci --format '{{json .Config.Cmd}}' | grep -F 'node_modules/next/dist/bin/next'
          docker image inspect vera-worker:ci --format '{{json .Config.Cmd}}' | grep -F 'apps/worker/dist/index.js'
          docker image inspect vera-web:ci --format '{{json .Config.Healthcheck.Test}}' | grep -F '/api/ready'
          docker image inspect vera-worker:ci --format '{{json .Config.Healthcheck.Test}}' | grep -F '127.0.0.1:8080/health'
```

Add this step to the main `verify` job immediately after the existing web-image verifier:

```yaml
      - name: Verify Heroku production boundaries
        run: pnpm verify:heroku-production
```

- [ ] **Step 3: Run static and focused tests**

```sh
pnpm verify:heroku-production
pnpm exec vitest run --project unit scripts/verify-heroku-production.unit.test.ts
```

Expected: both PASS.

- [ ] **Step 4: Commit the CI gate**

```sh
git add .github/workflows/ci.yml scripts/verify-heroku-production.unit.test.ts
git commit -m "ci: build paired Heroku application images"
```

---

### Task 5: Align production documentation and rollback instructions

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `docs/RELEASE_READINESS.md`
- Modify: `docs/superpowers/specs/2026-08-13-production-domain-data-cutover-design.md`

**Interfaces:**
- Consumes: the production manifest and safe database commands from Tasks 1–3.
- Produces: one consistent public topology and operator sequence; no secrets or private provider IDs.

- [ ] **Step 1: Mark the reviewed specification approved**

Change its status line to:

```text
Status: Approved
```

- [ ] **Step 2: Replace obsolete production assumptions in README and architecture**

Document exactly:

```text
Production application: app.verahousing.app on Heroku
Production processes: one web image plus one deterministic worker image released together
Production persistence: same-region Heroku Postgres Standard-0 or higher
Marketing: verahousing.app on the existing Vercel project, with www redirecting to the apex
Browser orchestration: Maritime -> unchanged signed DigitalOcean OpenClaw Gateway -> one shared tab
Railway: removed from the production request path; retained volume is recovery-only
```

Retain `railway.toml` as historical/recovery configuration and do not describe its failed URL as a
live environment. State that a normal application release never builds or deploys OpenClaw.

- [ ] **Step 3: Add exact safe database commands to PostgreSQL operations**

Use these public, non-secret forms, with all actual URL files and dumps under the existing gitignored
private evidence directory:

```sh
pnpm postgres:production-manifest capture --database-url-file "$VERA_SOURCE_DATABASE_URL_FILE" --output-file "$VERA_SOURCE_MANIFEST_FILE"
pnpm postgres:production-transfer dump --database-url-file "$VERA_SOURCE_DATABASE_URL_FILE" --dump-file "$VERA_SOURCE_DUMP_FILE"
pnpm postgres:production-transfer list --dump-file "$VERA_SOURCE_DUMP_FILE"
pnpm postgres:production-transfer restore --database-url-file "$VERA_GREEN_DATABASE_URL_FILE" --dump-file "$VERA_SOURCE_DUMP_FILE" --confirm-empty-target
pnpm postgres:production-manifest compare --database-url-file "$VERA_GREEN_DATABASE_URL_FILE" --expected-file "$VERA_SOURCE_MANIFEST_FILE" --output-file "$VERA_RESTORE_VERIFICATION_FILE"
```

Document that the URL variables name files, not URLs; their values must never be echoed.

- [ ] **Step 4: Add the dated production cutover gate**

At the top of `docs/RELEASE_READINESS.md`, preserve historical browser sections but add a 2026-08-13
application gate stating that production remains no-go until:

- the safe source/destination manifest matches;
- both images come from one merged SHA;
- `/api/ready` passes ten checks over five minutes;
- product authentication and inbox reads pass;
- marketing apex/TLS/redirect checks pass;
- forbidden actions remain zero;
- OpenClaw and retained recovery stores remain unchanged.

- [ ] **Step 5: Verify documentation and formatting**

```sh
pnpm verify:release-documentation
pnpm format:check
```

Expected: PASS.

- [ ] **Step 6: Commit documentation**

```sh
git add README.md docs/ARCHITECTURE.md docs/POSTGRES_OPERATIONS.md docs/RELEASE_READINESS.md docs/superpowers/specs/2026-08-13-production-domain-data-cutover-design.md
git commit -m "docs: align production operations with Heroku"
```

---

### Task 6: Run the code and supply-chain release gates

**Files:**
- Review only: all files changed since `773afa83f4a134740303ffc01eb508cb1e230e53`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: a clean, tested candidate branch and two locally inspected application images.

- [ ] **Step 1: Run focused unit and static checks**

```sh
pnpm exec vitest run --project unit scripts/verify-heroku-production.unit.test.ts scripts/production-postgres-transfer.unit.test.ts scripts/production-data-manifest.unit.test.ts
pnpm verify:heroku-production
pnpm verify:web-image-boundaries
pnpm verify:worker-image-boundaries
pnpm verify:browser-boundaries
pnpm verify:openclaw-config
```

Expected: PASS with no live browser or provider access.

- [ ] **Step 2: Run workspace quality checks**

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:integration:postgres
pnpm build
```

Expected: PASS. `TEST_DATABASE_URL` is supplied only to the PostgreSQL integration command through
the local test environment.

- [ ] **Step 3: Build and inspect both candidate images**

Read the exact 40-character output of `git rev-parse HEAD` into the operator environment as
`VERA_RELEASE_COMMIT`, then run:

```sh
docker build --platform linux/amd64 --pull --file Dockerfile.web --label "org.opencontainers.image.revision=$VERA_RELEASE_COMMIT" --tag vera-web:release-candidate .
docker build --platform linux/amd64 --pull --file Dockerfile --label "org.opencontainers.image.revision=$VERA_RELEASE_COMMIT" --tag vera-worker:release-candidate .
```

Inspect both users, commands, health checks, architectures, and OCI revision labels. Expected:
non-root `vera`, `linux/amd64`, correct web/worker commands, correct health paths, and identical exact
revision labels.

- [ ] **Step 4: Review for secret and policy regressions**

```sh
git diff --check 773afa83f4a134740303ffc01eb508cb1e230e53...HEAD
git status --short
git diff --stat 773afa83f4a134740303ffc01eb508cb1e230e53...HEAD
```

Inspect every diff. Confirm no credential-shaped value, private evidence, Gateway code, pairing code,
browser permission, contact action, or destructive database command entered Git.

- [ ] **Step 5: Commit any review corrections**

Use a scoped message that names the correction. Re-run the affected focused test after each
correction. Expected: clean worktree.

---

### Task 7: Open one PR, run full CI once, and merge

**Files:**
- No new files.

**Interfaces:**
- Consumes: the final candidate branch.
- Produces: one green PR and one immutable merge commit on `main`.

- [ ] **Step 1: Restore authenticated GitHub access without copying a token**

Use the browser/device authorization flow for `gh auth login -h github.com` if the existing token is
still invalid. Never paste a GitHub token into the task transcript or repository.

- [ ] **Step 2: Push the branch and open one PR**

```sh
git push --set-upstream origin codex/production-domain-data-cutover
gh pr create --base main --head codex/production-domain-data-cutover --title "fix: cut over Vera production data and domains" --body-file "$VERA_PR_BODY_FILE"
```

The private body input is a sanitized markdown file containing only design/plan links, safe test
results, and the statement that production mutation has not occurred.

- [ ] **Step 3: Run and observe full CI once**

Do not manually rerun green jobs. Wait for all required checks, including both application image
builds. If a check fails, fix the branch, run only affected local checks, push once, and treat the
new final SHA's CI as the single authoritative full run.

Expected: all required checks green; neither the OpenClaw release workflow nor any production deploy
workflow is dispatched.

- [ ] **Step 4: Merge and record immutable identities**

Merge only when green. Record the PR URL, merge commit, CI run ID, and final web/worker candidate
image labels in private release evidence. Fetch the merged `main` over HTTPS and verify the local
merge commit exactly.

---

### Task 8: Freeze the source and create verified backups

**Files:**
- Private evidence only under `release-evidence/private/m13b-pr75-live-20260811/production-cutover/`.

**Interfaces:**
- Consumes: merged source SHA, retained DigitalOcean PostgreSQL, Heroku app inventory.
- Produces: encrypted dump, source manifest, dump hash/list verification, and a write-free source.

- [ ] **Step 1: Re-resolve every live target read-only**

Verify the Heroku app name, stack, region, domain, dynos, releases, config-variable names, add-ons, and
current `/api/health`/`api/ready` responses. Verify the DigitalOcean Droplet, firewall, database
container, Gateway container, and checkpoint identities from the private evidence. Verify Railway's
old database deployment remains removed and its volume remains ready. Record only safe identities
and hashes.

- [ ] **Step 2: Confirm the paid database plan before purchase**

Inspect the current Heroku quote for `heroku-postgresql:standard-0`, including monthly price, region,
storage, connections, continuous protection, and maintenance policy. Present the exact charge for
founder confirmation before provisioning; do not silently choose a cheaper non-production plan.

- [ ] **Step 3: Freeze all source writers**

Confirm shared-tab count zero and extension connections zero. Stop the local app and worker processes
that target the retained database. Enable Heroku maintenance mode and scale the existing Heroku
worker to zero. Query `pg_stat_activity` on the retained database and require no Vera application
writer sessions before backup.

- [ ] **Step 4: Open bounded SSH access and capture the source manifest**

Add only the operator's current exact `/32` SSH rule after resolving the firewall. Re-establish the
private SSH control connection and PostgreSQL tunnel without printing credentials. Store the source
database URL in a mode-`0600` private file, then run `postgres:production-manifest capture` into a
mode-`0600` source manifest.

Expected: fixed event output, zero forbidden actions, current migration hashes, and safe counts only.

- [ ] **Step 5: Dump and validate the source database**

Run `postgres:production-transfer dump`, then `list`. Record dump byte size and SHA-256. Perform the
existing isolated restore rehearsal against an exact `vera_test` database. Expected: restored
controls/counts match and temporary test database is removed.

- [ ] **Step 6: Remove temporary SSH access**

Delete only the exact temporary `/32` rule added in Step 4 and verify it is absent. Keep the Droplet,
source database, Gateway, checkpoint, and Railway volume intact.

---

### Task 9: Provision and validate the unpromoted Heroku database

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: approved paid plan, verified dump, source manifest.
- Produces: an unpromoted same-region Heroku database whose contents exactly match the source.

- [ ] **Step 1: Provision the green database**

After explicit price approval:

```sh
heroku addons:create heroku-postgresql:standard-0 --app vera-housing-app --as VERA_GREEN_DATABASE --wait
```

Expected: a second database attachment exists; `DATABASE_URL` still names the old broken target.
Verify the new database region equals the app region and continuous protection is active.

- [ ] **Step 2: Capture the green URL without printing it**

Write `VERA_GREEN_DATABASE_URL` to a mode-`0600` private file using CLI output redirection. Do not
display, log, or paste the value. Inspect only the redacted hostname/database label through the safe
utility.

- [ ] **Step 3: Restore only into the proven-empty green database**

Run `postgres:production-transfer restore --confirm-empty-target`. Expected: success without
`--clean`, `--create`, owner changes, ACL changes, or source mutation.

- [ ] **Step 4: Compare the destination to the source**

Run `postgres:production-manifest compare` using the source manifest. Expected: exact content-hash
match and zero forbidden actions. Any mismatch stops the cutover; discard the unpromoted target and
start with a new target rather than editing evidence rows.

- [ ] **Step 5: Run migrations and idempotent seed**

Using the private green URL file without printing it, run `pnpm db:migrate`, then `pnpm db:seed`
twice. Expected: current migration hash and second seed `inserted: 0`. Capture a new manifest and
explain any first-seed global-policy change; immutable evidence counts must remain equal.

- [ ] **Step 6: Validate candidate containers against green**

Run one candidate web container and one candidate worker container with the green URL supplied via a
private env file. Verify candidate `/api/ready`, worker `/health` and `/ready`, founder inbox reads,
and one idempotent deterministic no-side-effect job. Stop both containers and capture safe evidence.

- [ ] **Step 7: Take the pre-promotion Heroku backup**

Capture and verify a Heroku logical backup of the migrated green database. Record only backup ID,
timestamp, size, and hash/verification metadata.

---

### Task 10: Release web and worker together and repair `/api/ready`

**Files:**
- Private release evidence only.

**Interfaces:**
- Consumes: merged commit, verified green database, locally inspected images.
- Produces: one Heroku release containing paired web/worker images and the promoted database.

- [ ] **Step 1: Rebuild release images from the exact merged commit**

Check out the merged commit detached, require a clean tree, and build `linux/amd64` web and worker
images with identical `org.opencontainers.image.revision` labels. Inspect labels/commands/users and
record local digests before registry push.

- [ ] **Step 2: Push both process images without releasing either one**

Authenticate to Heroku Container Registry through the CLI. Tag the verified images as:

```text
registry.heroku.com/vera-housing-app/web
registry.heroku.com/vera-housing-app/worker
```

Push both. Do not run `container:release` until both pushes and local identity checks pass.

- [ ] **Step 3: Promote the database while maintenance remains enabled**

Promote `VERA_GREEN_DATABASE` through the Heroku PostgreSQL attachment command so Heroku updates
`DATABASE_URL`; do not paste a URL. Verify config-variable names and require the Railway CA path and
host to be absent from the effective attachment without printing the new value.

- [ ] **Step 4: Release both process types atomically**

```sh
heroku container:release web worker --app vera-housing-app
```

Expected: one Heroku release lists both process types. Scale exactly `web=1` and `worker=1`, then
disable maintenance mode only after both dynos are up.

- [ ] **Step 5: Verify application readiness for five minutes**

Check `/api/health` and `/api/ready` ten times over at least five minutes. Expected: health 200 and
readiness 200 with `status: ready` and the current migration every time. Inspect bounded Heroku logs
for database, crash, restart, memory, and worker-claim errors without copying secrets or row data.

- [ ] **Step 6: Verify the authenticated product**

Use the existing founder session to load the inbox, the accepted Zillow listing detail, source links,
photos/placeholders, provenance, and activity history. Run one deterministic source-independent job
and prove idempotency. Re-capture a safe data manifest and require preserved immutable counts and
forbidden-action count zero.

- [ ] **Step 7: Exercise rollback evidence without destructive restore**

Prove the prior application image can be selected and identify the exact pre-promotion backup/new
database restore procedure. Do not actually overwrite the healthy promoted database. Keep the old
Railway volume and DigitalOcean database unchanged.

---

### Task 11: Move marketing to the apex domain

**Files:**
- No repository files; provider state and private evidence only.

**Interfaces:**
- Consumes: existing Vercel marketing project and Name.com zone.
- Produces: apex marketing, permanent `www` redirect, unchanged authenticated app subdomain.

- [ ] **Step 1: Authenticate through user-controlled browser sessions**

The founder manually completes Name.com password entry. Use GitHub SSO or an already authenticated
session for Vercel. Never ask for, type, capture, or store the Name.com password.

- [ ] **Step 2: Resolve the Vercel project and DNS inventory**

Prove the selected project currently serves `https://vera-ai-housing.vercel.app`. Export or record a
safe inventory of existing Name.com record names/types/targets, especially `app`, MX, TXT, CAA, and
verification records.

- [ ] **Step 3: Attach domains in Vercel before DNS**

Add `verahousing.app` and `www.verahousing.app` to the existing marketing project. Configure a
permanent project-level redirect from `www` to the apex. Inspect the exact project-specific DNS
records Vercel requests; do not use hard-coded general-purpose values.

- [ ] **Step 4: Add only the requested Name.com records**

Add the exact apex and `www` records provided by Vercel. Do not change nameservers and do not touch
the existing `app` CNAME, MX, TXT, CAA, or verification records.

- [ ] **Step 5: Verify DNS, TLS, rendering, and isolation**

Expected:

- `https://verahousing.app` serves the same marketing title/content as the Vercel deployment;
- `https://www.verahousing.app` permanently redirects to the apex;
- Vercel reports ownership and a valid certificate;
- `https://app.verahousing.app` still resolves to Heroku and remains ready;
- Better Auth and Google OAuth product callback origins remain `app.verahousing.app`.

If any marketing check fails, remove/revert only the new apex/`www` records using the saved inventory.

---

### Task 12: Complete the production acceptance audit

**Files:**
- Private evidence only.

**Interfaces:**
- Consumes: all repository, provider, database, domain, and runtime evidence.
- Produces: a requirement-by-requirement completion record and concise founder handoff.

- [ ] **Step 1: Audit every definition-of-done requirement**

Create a private checklist that maps each design requirement to authoritative evidence: Heroku
formation, database attachment/backup, manifest hashes, readiness samples, authenticated UI checks,
DNS/TLS, Vercel redirect, Railway/DigitalOcean preservation, OpenClaw digest/config state, shared-tab
revocation, and forbidden-action count.

- [ ] **Step 2: Confirm no unsupported completion claim remains**

Treat missing, indirect, cached, or stale evidence as incomplete. Query current counts before quoting
them. Do not call the release ready because health alone passes.

- [ ] **Step 3: Remove transient access and credentials**

Remove any temporary SSH `/32` rule, local database tunnel, temporary registry login, and private
URL files no longer required. Preserve encrypted backups and the retained databases under their
approved retention policy. Do not clean up the Gateway or old Railway volume.

- [ ] **Step 4: Deliver the final handoff**

Report concisely:

- marketing URL;
- interactive product URL;
- `/api/ready` result and observation window;
- restored safe counts and source/destination manifest hash;
- web/worker source commit and Heroku release;
- photo/source-link coverage queried from the live database;
- forbidden-action verification;
- PR URL, merge commit, and CI run;
- confirmation that OpenClaw was unchanged and no LLM was configured there;
- whether the improved product is ready to record.
