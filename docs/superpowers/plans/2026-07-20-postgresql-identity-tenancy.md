# PostgreSQL Identity and Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL the only hosted Vera persistence engine, add Better Auth Google identity and database-enforced per-user isolation, and preserve SQLite solely as an explicit deterministic offline-demo adapter.

**Architecture:** Shared repository contracts become asynchronous and tenant-scoped. Hosted web and worker composition roots construct bounded PostgreSQL pools directly; the worker receives only a narrow cross-tenant claim interface, while normal services receive repositories already bound to one Vera user. Better Auth owns hosted identity/session tables, all private application rows carry `user_id` with composite ownership foreign keys, and a separate `@vera/db/demo` export retains the sanitized SQLite workflow without auth or hosted credentials.

**Tech Stack:** Node.js 24, TypeScript 6 strict mode, pnpm 11.14.0 workspaces, Next.js 16.2.10, React 19.2.7, PostgreSQL 18.4, `pg` 8.22.0, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, Better Auth 1.6.23, Zod, Vitest 4.1.10, Playwright 1.61.1, Docker Compose.

## Global Constraints

- PostgreSQL is the primary and only hosted database for development, staging, and production.
- SQLite may be reached only through `@vera/db/demo` and explicit `pnpm demo:*` commands.
- There is no database-selection environment variable and no PostgreSQL-to-SQLite fallback.
- Preserve existing domain behavior and repository boundaries while converting every persistence call to `Promise`-based APIs.
- Every private application table carries `user_id`; `source_policy_manifests` is the only global application table.
- Normal repositories capture one user ID at construction and never accept a user ID per query.
- Worker-wide access is limited to claiming jobs and returning the immutable owning user ID.
- Use UUIDs for Better Auth and integration identities; retain deterministic text IDs for existing content-addressed entities.
- Use `timestamptz` for instants, `date` for date-only values, `jsonb` for validated structured values, `boolean` for booleans, and integer minor units for money.
- Preserve append-only database enforcement for raw listings, audit events, attempts, extraction runs, decision history, overrides/revocations, scores, and risk snapshots.
- Better Auth Google login requests only `openid email profile`; Gmail and Calendar scopes are excluded.
- Hosted integration credential material is AES-256-GCM encrypted before PostgreSQL persistence and never logged.
- Tests that depend on PostgreSQL semantics run against PostgreSQL 18.4, not SQLite or a mock.
- Keep one region, one web process, one worker process, and one managed PostgreSQL database; do not add Redis, RLS, replicas, sharding, Kubernetes, or horizontal-scaling infrastructure.
- Preserve all fail-closed source policies, audit invariants, no-send guarantees, and deterministic demo fixtures.

## Target File Structure

```text
compose.yaml                                  # local PostgreSQL 18.4 service
infra/postgres/init/001-create-test-db.sql   # creates isolated vera_test database
packages/domain/src/identity.ts              # user/integration schemas and types
packages/domain/src/readiness.ts             # readiness response schema
packages/db/drizzle.config.ts                 # PostgreSQL Drizzle configuration
packages/db/drizzle/0000_postgres_baseline.sql
packages/db/drizzle/meta/*                    # canonical PostgreSQL snapshots
packages/db/drizzle-demo/*                    # relocated SQLite migrations/snapshots
packages/db/src/repositories.ts               # async, database-neutral contracts
packages/db/src/postgres/config.ts            # validated pool/runtime configuration
packages/db/src/postgres/connection.ts        # bounded pool and graceful close
packages/db/src/postgres/schema.ts            # PostgreSQL schema and relations
packages/db/src/postgres/errors.ts            # safe typed database errors
packages/db/src/postgres/row-mappers.ts       # Date/JSON/database row conversion
packages/db/src/postgres/repositories.ts      # tenant-scoped repository provider
packages/db/src/postgres/worker-queue.ts      # SKIP LOCKED cross-tenant claims
packages/db/src/postgres/migrations.ts        # migration and readiness checks
packages/db/src/postgres/seed.ts              # global policy seed only
packages/db/src/postgres/testing.ts           # isolated integration-test database
packages/db/src/credentials.ts                # AES-256-GCM token envelope
packages/db/src/demo/*                        # relocated SQLite connection/schema/repos/seed
packages/db/src/index.ts                      # hosted PostgreSQL exports only
packages/db/src/demo/index.ts                 # explicit offline-demo exports
apps/web/lib/server/auth.ts                   # Better Auth configuration
apps/web/lib/server/session.ts                # authoritative request session guard
apps/web/lib/server/application.ts            # hosted PostgreSQL composition
apps/web/lib/server/demo-application.ts       # demo composition, imported by preload only
apps/web/lib/server/application-registry.ts   # process-local registered composition
apps/web/instrumentation.ts                   # registers hosted composition by default
apps/web/app/api/auth/[...all]/route.ts       # Better Auth handler
apps/web/app/api/ready/route.ts                # PostgreSQL readiness endpoint
apps/web/app/sign-in/page.tsx                 # hosted sign-in page
apps/web/app/sign-in/sign-in-button.tsx       # explicit Google sign-in action
apps/worker/src/postgres-runtime.ts            # hosted worker composition
scripts/register-demo-runtime.ts              # explicit demo preload capability
scripts/verify-database-boundaries.ts         # production/demo import guard
scripts/postgres-reset.ts                     # local-Compose-only reset guard
docs/DECISIONS/0009-postgresql-hosted-persistence.md
docs/POSTGRES_OPERATIONS.md
```

---

### Task 1: Pin PostgreSQL, Better Auth, and local infrastructure

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/db/package.json`
- Modify: `apps/web/package.json`
- Create: `compose.yaml`
- Create: `infra/postgres/init/001-create-test-db.sql`
- Modify: `.env.example`
- Test: `packages/db/src/postgres/config.unit.test.ts`
- Create: `packages/db/src/postgres/config.ts`

**Interfaces:**
- Consumes: existing pnpm workspace and Node 24 constraint.
- Produces: `PostgresConfigSchema`, `parsePostgresConfig(environment)`, root `postgres:up`, `postgres:down`, `postgres:reset`, `test:integration:postgres`, `db:migrate`, and `db:seed` commands.

- [ ] **Step 1: Write configuration tests that fail without strict PostgreSQL settings**

```ts
import { describe, expect, it } from "vitest";

import { parsePostgresConfig } from "./config.ts";

const valid = {
  DATABASE_URL: "postgresql://vera:vera_dev_only@127.0.0.1:5432/vera",
  VERA_DB_POOL_MAX: "5",
  VERA_DB_CONNECTION_TIMEOUT_MS: "5000",
  VERA_DB_STATEMENT_TIMEOUT_MS: "15000",
  VERA_DB_LOCK_TIMEOUT_MS: "3000",
  VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000"
};

describe("parsePostgresConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => parsePostgresConfig({})).toThrow("DATABASE_URL");
  });

  it("rejects an oversized pool", () => {
    expect(() => parsePostgresConfig({ ...valid, VERA_DB_POOL_MAX: "51" })).toThrow(
      "VERA_DB_POOL_MAX"
    );
  });

  it("returns bounded production settings", () => {
    expect(parsePostgresConfig(valid)).toMatchObject({
      connectionString: valid.DATABASE_URL,
      poolMax: 5,
      connectionTimeoutMilliseconds: 5000,
      statementTimeoutMilliseconds: 15000,
      lockTimeoutMilliseconds: 3000,
      idleTransactionTimeoutMilliseconds: 10000
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run: `pnpm vitest run packages/db/src/postgres/config.unit.test.ts`

Expected: FAIL because `packages/db/src/postgres/config.ts` does not exist.

- [ ] **Step 3: Add strict configuration parsing and exact local infrastructure**

Use this configuration shape:

```ts
import { z } from "zod";

const boundedMilliseconds = z.coerce.number().int().min(250).max(120_000);

export const PostgresConfigSchema = z
  .object({
    DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgresql://"), {
      message: "DATABASE_URL must use postgresql://"
    }),
    VERA_DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    VERA_DB_CONNECTION_TIMEOUT_MS: boundedMilliseconds.default(5_000),
    VERA_DB_STATEMENT_TIMEOUT_MS: boundedMilliseconds.default(15_000),
    VERA_DB_LOCK_TIMEOUT_MS: boundedMilliseconds.default(3_000),
    VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: boundedMilliseconds.default(10_000)
  })
  .passthrough();

export function parsePostgresConfig(environment: Readonly<Record<string, string | undefined>>) {
  const value = PostgresConfigSchema.parse(environment);
  return {
    connectionString: value.DATABASE_URL,
    poolMax: value.VERA_DB_POOL_MAX,
    connectionTimeoutMilliseconds: value.VERA_DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMilliseconds: value.VERA_DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMilliseconds: value.VERA_DB_LOCK_TIMEOUT_MS,
    idleTransactionTimeoutMilliseconds: value.VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS
  } as const;
}
```

Pin `pg@8.22.0`, `@types/pg@8.20.0`, and `better-auth@1.6.23`. Use Better Auth's `better-auth/adapters/drizzle` export; do not add another adapter package. Remove root-level `better-sqlite3`; retain it only in `@vera/db` for the demo subpath.

Create `compose.yaml` with image `postgres:18.4-alpine`, database `vera`, user `vera`, development-only password `vera_dev_only`, port `127.0.0.1:5432:5432`, named volume `vera-postgres-data`, the init SQL mount, and `pg_isready -U vera -d vera` health check. The init SQL contains exactly:

```sql
CREATE DATABASE vera_test OWNER vera;
```

Add these root scripts:

```json
{
  "postgres:up": "docker compose up -d postgres",
  "postgres:down": "docker compose down",
  "postgres:reset": "node --import tsx scripts/postgres-reset.ts",
  "test:integration:postgres": "vitest run --project postgres-integration",
  "db:generate": "pnpm --filter @vera/db db:generate",
  "db:migrate": "pnpm --filter @vera/db db:migrate",
  "db:seed": "pnpm --filter @vera/db db:seed"
}
```

- [ ] **Step 4: Install, start PostgreSQL, and pass configuration tests**

Run: `pnpm install && pnpm postgres:up && docker compose ps && pnpm vitest run packages/db/src/postgres/config.unit.test.ts`

Expected: lockfile updated, `vera-postgres` healthy, and the focused test PASS.

- [ ] **Step 5: Commit infrastructure and pinned packages**

```bash
git add package.json pnpm-lock.yaml packages/db/package.json apps/web/package.json compose.yaml infra/postgres/init/001-create-test-db.sql .env.example packages/db/src/postgres/config.ts packages/db/src/postgres/config.unit.test.ts
git commit -m "chore: add PostgreSQL and identity infrastructure"
```

---

### Task 2: Add user, integration, and readiness domain contracts

**Files:**
- Create: `packages/domain/src/identity.ts`
- Create: `packages/domain/src/identity.unit.test.ts`
- Create: `packages/domain/src/readiness.ts`
- Create: `packages/domain/src/readiness.unit.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `IsoDateTimeSchema`, `Sha256Schema` from `packages/domain/src/primitives.ts`.
- Produces: `VeraUserId`, `IntegrationId`, `IntegrationConnection`, `IntegrationConnectionStatus`, `EncryptedCredentialEnvelope`, `ReadinessReport`, and their strict Zod schemas.

- [ ] **Step 1: Write strict schema tests**

```ts
import { describe, expect, it } from "vitest";

import {
  EncryptedCredentialEnvelopeSchema,
  IntegrationConnectionSchema,
  ReadinessReportSchema,
  VeraUserIdSchema
} from "./index.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";

describe("identity persistence contracts", () => {
  it("requires UUID user identities", () => {
    expect(VeraUserIdSchema.parse(userId)).toBe(userId);
    expect(() => VeraUserIdSchema.parse("demo-user")).toThrow();
  });

  it("rejects plaintext or extra credential fields", () => {
    expect(() =>
      EncryptedCredentialEnvelopeSchema.parse({
        version: 1,
        algorithm: "aes-256-gcm",
        keyId: "2026-07",
        nonce: "AA",
        ciphertext: "AA",
        authenticationTag: "AA",
        plaintext: "forbidden"
      })
    ).toThrow();
  });

  it("sorts and deduplicates granted scopes at construction", () => {
    const parsed = IntegrationConnectionSchema.parse({
      id: userId,
      userId,
      provider: "google",
      providerSubjectId: "google-subject",
      displayEmail: "user@example.test",
      encryptedRefreshToken: null,
      grantedScopes: ["openid", "email", "openid"],
      tokenExpiresAt: null,
      status: "connected",
      lastSuccessfulUseAt: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z"
    });
    expect(parsed.grantedScopes).toEqual(["email", "openid"]);
  });

  it("distinguishes liveness from database readiness", () => {
    expect(
      ReadinessReportSchema.parse({
        service: "vera-web",
        status: "not_ready",
        checkedAt: "2026-07-20T12:00:00.000Z",
        database: { status: "unavailable", migration: "unknown" }
      }).status
    ).toBe("not_ready");
  });
});
```

- [ ] **Step 2: Run the domain test and confirm missing exports**

Run: `pnpm vitest run packages/domain/src/identity.unit.test.ts packages/domain/src/readiness.unit.test.ts`

Expected: FAIL because the schemas are not exported.

- [ ] **Step 3: Add strict identity and readiness schemas**

Define these exact vocabularies:

```ts
export const IntegrationProviderSchema = z.literal("google");
export const IntegrationConnectionStatusSchema = z.enum([
  "connected",
  "partial",
  "expired",
  "revoked",
  "disconnected",
  "reconnect_required"
]);
export const CredentialAlgorithmSchema = z.literal("aes-256-gcm");
export const DatabaseReadinessStatusSchema = z.enum([
  "ready",
  "unavailable",
  "timed_out",
  "migration_behind"
]);
```

Use `z.uuid()` for Vera user and integration IDs, `.strict()` for every persisted object, base64 validation for nonce/ciphertext/tag, sorted unique scopes through a transform, nullable token/last-use instants, and no access-token, authorization-code, client-secret, mailbox-body, or password field. Re-export both modules from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run domain tests and package typecheck**

Run: `pnpm vitest run packages/domain/src/identity.unit.test.ts packages/domain/src/readiness.unit.test.ts && pnpm --filter @vera/domain typecheck`

Expected: PASS.

- [ ] **Step 5: Commit domain contracts**

```bash
git add packages/domain/src/identity.ts packages/domain/src/identity.unit.test.ts packages/domain/src/readiness.ts packages/domain/src/readiness.unit.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): add tenant and readiness contracts"
```

---

### Task 3: Convert repository contracts and application services to async tenant scope

**Files:**
- Modify: `packages/db/src/repositories.ts`
- Create: `packages/db/src/repositories.contract.unit.test.ts`
- Modify: `apps/web/lib/capture-service.ts`
- Modify: `apps/web/lib/cockpit-read-model.ts`
- Modify: `apps/web/lib/demo-search-service.ts`
- Modify: `apps/web/lib/listing-presentation.ts`
- Modify: `apps/web/app/api/activity/route.ts`
- Modify: `apps/web/app/api/captures/[rawListingId]/route.ts`
- Modify: `apps/web/app/api/captures/route.ts`
- Modify: `apps/web/app/api/connectors/route.ts`
- Modify: `apps/web/app/api/decision-jobs/[id]/route.ts`
- Modify: `apps/web/app/api/dedupe/overrides/route.ts`
- Modify: `apps/web/app/api/demo/run/route.ts`
- Modify: `apps/web/app/api/demo/status/route.ts`
- Modify: `apps/web/app/api/listings/[id]/dismiss/route.ts`
- Modify: `apps/web/app/api/listings/[id]/route.ts`
- Modify: `apps/web/app/api/listings/[id]/shortlist/route.ts`
- Modify: `apps/web/app/api/listings/route.ts`
- Modify: `apps/web/app/activity/page.tsx`
- Modify: `apps/web/app/captures/[rawListingId]/page.tsx`
- Modify: `apps/web/app/connectors/page.tsx`
- Modify: `apps/web/app/listings/[id]/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/worker/src/normalization-worker.ts`
- Modify: `apps/worker/src/decision-worker.ts`
- Modify: `apps/web/app/api/captures/[rawListingId]/route.integration.test.ts`
- Modify: `apps/web/app/api/captures/route.integration.test.ts`
- Modify: `apps/web/app/api/connectors/route.integration.test.ts`
- Modify: `apps/web/app/api/decision-routes.integration.test.ts`
- Modify: `apps/web/app/api/demo/routes.integration.test.ts`
- Modify: `apps/web/app/api/listings/[id]/dismiss/route.integration.test.ts`
- Modify: `apps/web/app/api/listings/route.integration.test.ts`
- Modify: `apps/web/lib/cockpit-read-model.integration.test.ts`
- Modify: `apps/web/lib/demo-search-service.integration.test.ts`
- Modify: `apps/web/lib/listing-presentation.integration.test.ts`
- Modify: `apps/worker/src/decision-worker.integration.test.ts`
- Modify: `apps/worker/src/normalization-worker.integration.test.ts`
- Modify: `packages/db/src/decision-jobs.integration.test.ts`
- Modify: `packages/db/src/decision-reconciliation.integration.test.ts`
- Modify: `packages/db/src/extractions.integration.test.ts`
- Modify: `packages/db/src/jobs.integration.test.ts`
- Modify: `packages/db/src/migration.integration.test.ts`
- Modify: `packages/db/src/production-seed.integration.test.ts`
- Modify: `packages/db/src/repositories.integration.test.ts`
- Modify: `packages/db/src/seed.integration.test.ts`
- Modify: `packages/db/src/source-orchestration.integration.test.ts`
- Modify: `scripts/railway-runtime.integration.test.ts`

**Interfaces:**
- Consumes: existing repository method names and domain values.
- Produces: `UserRepositories`, `UserRepositoryProvider`, `SystemWorkerQueue`, `OwnedNormalizationJob`, `OwnedDecisionJob`, and `OwnedSourceJob`; every repository operation returns `Promise`.

- [ ] **Step 1: Add compile-time contract tests**

```ts
import { expectTypeOf, test } from "vitest";

import type {
  SearchProfileRepository,
  SystemWorkerQueue,
  UserRepositoryProvider,
  UserRepositories
} from "./repositories.ts";

test("repositories are asynchronous and user-scoped", () => {
  expectTypeOf<SearchProfileRepository["getById"]>().returns.toEqualTypeOf<
    Promise<Awaited<ReturnType<SearchProfileRepository["getById"]>>>
  >();
  expectTypeOf<UserRepositoryProvider["forUser"]>().parameter(0).toMatchTypeOf<string>();
  expectTypeOf<UserRepositoryProvider["transaction"]>().returns.toMatchTypeOf<Promise<unknown>>();
  expectTypeOf<SystemWorkerQueue>().not.toHaveProperty("searchProfiles");
  expectTypeOf<UserRepositories>().not.toHaveProperty("workerQueue");
});
```

- [ ] **Step 2: Run typecheck to capture all synchronous consumers**

Run: `pnpm typecheck`

Expected: FAIL after the contract change and enumerate every missed `await` or sync callback.

- [ ] **Step 3: Change every contract to promises and split authority**

The target provider boundary is:

```ts
export interface UserRepositories {
  readonly searchProfiles: SearchProfileRepository;
  readonly rawListings: RawListingRepository;
  readonly sourceRecords: ListingSourceRecordRepository;
  readonly listingPhotos: ListingPhotoRepository;
  readonly fieldProvenance: FieldProvenanceRepository;
  readonly listingExtractions: ListingExtractionRepository;
  readonly duplicateClusters: DuplicateClusterRepository;
  readonly canonicalListings: CanonicalListingRepository;
  readonly listingScores: ListingScoreRepository;
  readonly riskSignals: RiskSignalRepository;
  readonly contactWorkflows: ContactWorkflowRepository;
  readonly approvals: ApprovalRepository;
  readonly viewings: ViewingRepository;
  readonly activityEvents: ActivityEventRepository;
  readonly sourcePolicyManifests: SourcePolicyManifestReader;
  readonly sourceJobs: SourceJobRepository;
  readonly sourceJobAttempts: SourceJobAttemptRepository;
  readonly browserNodes: BrowserNodeRepository;
  readonly normalizationJobs: NormalizationJobRepository;
  readonly decisionJobs: DecisionJobRepository;
  readonly duplicateOverrides: DuplicateOverrideRepository;
  readonly decisionHistory: DecisionHistoryRepository;
  readonly decisionReconciliation: DecisionReconciliationRepository;
}

export interface UserRepositoryProvider {
  forUser(userId: VeraUserId): UserRepositories;
  transaction<T>(
    userId: VeraUserId,
    operation: (repositories: UserRepositories) => Promise<T>
  ): Promise<T>;
}

export interface SystemWorkerQueue {
  claimNextNormalizationJob(input: ClaimNormalizationJob): Promise<OwnedNormalizationJob | null>;
  claimNextDecisionJob(input: ClaimDecisionJobInput): Promise<OwnedDecisionJob | null>;
  claimNextSourceJob(input: ClaimSourceJobInput): Promise<OwnedSourceJob | null>;
}
```

Each `Owned*Job` is `{ readonly userId: VeraUserId; readonly job: <job type> }`. Global source policy writes belong to a separate `GlobalPolicyRepository` used by migrations/seeding, not `UserRepositories`.

- [ ] **Step 4: Await all application and worker persistence calls**

Convert server pages to `async` components, route handlers and services to `Promise` results, and transaction callbacks to `async`. The normalization worker pattern becomes:

```ts
const owned = await dependencies.workerQueue.claimNextNormalizationJob(claim);
if (!owned) return { status: "idle" };
const repositories = dependencies.repositoryProvider.forUser(owned.userId);
const raw = await repositories.rawListings.getById(owned.job.rawListingId);
const decisionJob = await dependencies.repositoryProvider.transaction(
  owned.userId,
  async (transactionRepositories) => {
    await transactionRepositories.sourceRecords.insert(normalized.sourceRecord);
    for (const provenance of normalized.provenance) {
      await transactionRepositories.fieldProvenance.insert(provenance);
    }
    await transactionRepositories.listingExtractions.insert(extractionRun);
    return transactionRepositories.decisionJobs.bumpCorpusRevisionAndEnqueue(input);
  }
);
```

Update test doubles with `async` methods rather than `Promise.resolve` casts. Do not expose a raw client to make a caller compile.

- [ ] **Step 5: Run typecheck and non-database unit tests**

Run: `pnpm typecheck && pnpm test:unit`

Expected: PASS. SQLite integration tests may remain red until Task 10 converts the demo adapter.

- [ ] **Step 6: Commit the async authority boundary**

```bash
git add packages/db/src/repositories.ts packages/db/src/repositories.contract.unit.test.ts apps/web apps/worker packages/db/src/*.test.ts
git commit -m "refactor(db): make repositories async and tenant scoped"
```

---

### Task 4: Implement credential envelope encryption before persistence

**Files:**
- Create: `packages/db/src/credentials.ts`
- Create: `packages/db/src/credentials.unit.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `EncryptedCredentialEnvelope`, Vera user ID, integration ID, and provider from `@vera/domain`.
- Produces: `CredentialKeyProvider`, `StaticCredentialKeyProvider`, `encryptCredential`, `decryptCredential`, and `CredentialDecryptionError`.

- [ ] **Step 1: Write cryptographic behavior tests**

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptCredential, encryptCredential, StaticCredentialKeyProvider } from "./credentials.ts";

const context = {
  userId: "018f9f64-7b5a-7c91-a12e-123456789abc",
  integrationId: "018f9f64-7b5a-7c91-a12e-123456789abd",
  provider: "google" as const
};

describe("credential envelopes", () => {
  it("round-trips without storing plaintext", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const envelope = await encryptCredential("synthetic-refresh-token", context, keys);
    expect(JSON.stringify(envelope)).not.toContain("synthetic-refresh-token");
    await expect(decryptCredential(envelope, context, keys)).resolves.toBe(
      "synthetic-refresh-token"
    );
  });

  it("rejects ciphertext moved to another user", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const envelope = await encryptCredential("synthetic-refresh-token", context, keys);
    await expect(
      decryptCredential(envelope, { ...context, userId: "018f9f64-7b5a-7c91-a12e-123456789abe" }, keys)
    ).rejects.toThrow("Credential decryption failed");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm vitest run packages/db/src/credentials.unit.test.ts`

Expected: FAIL because the credential module does not exist.

- [ ] **Step 3: Implement versioned AES-256-GCM**

Use Node `createCipheriv`/`createDecipheriv`, a fresh 12-byte nonce per encryption, a 16-byte GCM tag, and this exact associated-data serialization:

```ts
function associatedData(context: CredentialContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      userId: context.userId,
      integrationId: context.integrationId,
      provider: context.provider
    }),
    "utf8"
  );
}
```

`CredentialKeyProvider.current()` returns `{ keyId, key }`; `byId(keyId)` returns the 32-byte key or `null`. Validate exact key length, encode binary fields as base64, zero no buffers through logging, and collapse unknown-key/tamper/context mismatch into `CredentialDecryptionError("Credential decryption failed; reconnect is required.")`.

- [ ] **Step 4: Run tests and scan for plaintext logging**

Run: `pnpm vitest run packages/db/src/credentials.unit.test.ts && rg -n "refresh.?token|access.?token|authorization.?code" packages/db/src apps/web --glob '*.ts'`

Expected: tests PASS; matches are field/config names only, with no log call carrying values.

- [ ] **Step 5: Commit the encryption boundary**

```bash
git add packages/db/src/credentials.ts packages/db/src/credentials.unit.test.ts packages/db/src/index.ts
git commit -m "feat(db): encrypt hosted integration credentials"
```

---

### Task 5: Define the tenant-owned PostgreSQL schema and baseline migration

**Files:**
- Create: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/src/postgres/schema.integration.test.ts`
- Modify: `packages/db/drizzle.config.ts`
- Move: `packages/db/drizzle/*` to `packages/db/drizzle-demo/*`
- Create: `packages/db/drizzle/0000_postgres_baseline.sql`
- Create: `packages/db/drizzle/meta/_journal.json`
- Create: generated PostgreSQL snapshot under `packages/db/drizzle/meta/`

**Interfaces:**
- Consumes: all existing SQLite table columns and checks, Better Auth model requirements, `VeraUserId` ownership, and PostgreSQL types from the approved spec.
- Produces: canonical `schema`, Better Auth tables, `integration_connections`, 29 tenant-owned application tables, one global policy table, composite ownership keys, indexes, checks, and append-only triggers.

- [ ] **Step 1: Write migration/schema assertions against PostgreSQL**

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { withPostgresTestDatabase } from "./testing.ts";

describe("PostgreSQL baseline", () => {
  it("uses tenant ownership and PostgreSQL-native types", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      const result = await db.execute(sql`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = current_schema()
          and (
            (column_name = 'user_id' and table_name in ('search_profiles', 'raw_listings', 'activity_events'))
            or (table_name = 'activity_events' and column_name = 'occurred_at')
            or (table_name = 'raw_listings' and column_name = 'payload')
          )
        order by table_name, column_name
      `);
      expect(result.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table_name: "activity_events", column_name: "occurred_at", data_type: "timestamp with time zone" }),
          expect.objectContaining({ table_name: "raw_listings", column_name: "payload", data_type: "jsonb" }),
          expect.objectContaining({ table_name: "search_profiles", column_name: "user_id", data_type: "uuid" })
        ])
      );
    });
  });
});
```

- [ ] **Step 2: Move SQLite migration history before generating PostgreSQL history**

Move all six SQL migrations, six snapshots, and the SQLite journal from `packages/db/drizzle` to `packages/db/drizzle-demo`. Update no hosted command to reference `drizzle-demo`; only Task 10's demo migrator may do so.

- [ ] **Step 3: Define auth and integration tables**

Use plural table names and UUID primary keys:

```ts
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)]);

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerSubjectId: text("provider_subject_id").notNull(),
  displayEmail: text("display_email"),
  credentialVersion: integer("credential_version"),
  credentialAlgorithm: text("credential_algorithm"),
  credentialKeyId: text("credential_key_id"),
  credentialNonce: bytea("credential_nonce"),
  credentialCiphertext: bytea("credential_ciphertext"),
  credentialAuthenticationTag: bytea("credential_authentication_tag"),
  grantedScopes: text("granted_scopes").array().notNull().default(sql`ARRAY[]::text[]`),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  status: text("status").notNull(),
  lastSuccessfulUseAt: timestamp("last_successful_use_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("integration_connections_user_provider_subject_unique").on(table.userId, table.provider, table.providerSubjectId),
  uniqueIndex("integration_connections_user_id_id_unique").on(table.userId, table.id),
  check("integration_connections_provider_allowed", sql`${table.provider} IN ('google')`),
  check("integration_connections_status_allowed", sql`${table.status} IN ('connected','partial','expired','revoked','disconnected','reconnect_required')`)
]);
```

Define Better Auth `sessions`, `accounts`, and `verifications` according to Better Auth 1.6.23's required fields. Map Better Auth's model names to the plural table names in Task 9. Use composite indexes for session token and user expiration lookup; encrypt Better Auth OAuth tokens through its account option.

- [ ] **Step 4: Translate every existing application table with exact ownership**

Add UUID `user_id` to every table in this matrix and a unique `(user_id, id)` key for every table with an `id` column:

| Table | Composite tenant parents |
| --- | --- |
| `search_profiles` | `users(user_id)` |
| `raw_listings` | `users(user_id)` |
| `listing_source_records` | `raw_listings(user_id, raw_listing_id)` |
| `listing_photos` | `listing_source_records(user_id, listing_source_record_id)` |
| `field_provenance` | `listing_source_records(user_id, listing_source_record_id)` |
| `listing_extractions` | raw listing and source record |
| `normalization_jobs` | raw listing |
| `source_jobs` | search profile where present |
| `source_job_attempts` | source job |
| `browser_nodes` | user only |
| `decision_corpus_state` | search profile |
| `decision_jobs` | search profile |
| `decision_job_attempts` | decision job |
| `decision_runs` | decision job and search profile |
| `duplicate_pair_evaluations` | decision run |
| `duplicate_overrides` | search profile |
| `duplicate_override_revocations` | duplicate override |
| `canonical_decision_runs` | canonical listing and decision run |
| `duplicate_clusters` | search profile |
| `canonical_listings` | search profile and duplicate cluster |
| `canonical_listing_sources` | canonical listing and source record |
| `canonical_field_sources` | canonical listing, source record, provenance |
| `listing_scores` | canonical listing and search profile |
| `risk_signals` | canonical listing |
| `contact_workflows` | canonical listing |
| `approvals` | contact workflow or viewing where present |
| `viewings` | canonical listing |
| `activity_events` | user only; target IDs remain polymorphic text |

`source_policy_manifests` has no `user_id`. Preserve every existing closed vocabulary as a PostgreSQL `CHECK`; rewrite SQLite `GLOB` hashes as `value ~ '^[a-f0-9]{64}$'`; rewrite integer booleans as `boolean`; use `jsonb` only for the 45 existing structured JSON columns; use `timestamptz` for every persisted instant and `date` for move-in/availability dates. Preserve integer money and half-unit room encodings.

Define composite ownership foreign keys with Drizzle `foreignKey`:

```ts
foreignKey({
  name: "listing_source_records_raw_listing_tenant_fk",
  columns: [table.userId, table.rawListingId],
  foreignColumns: [rawListings.userId, rawListings.id]
}).onDelete("restrict").onUpdate("restrict")
```

- [ ] **Step 5: Add PostgreSQL append-only trigger functions**

The migration defines one reusable function and attaches it to all immutable tables:

```sql
CREATE FUNCTION vera_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER raw_listings_append_only
BEFORE UPDATE OR DELETE ON raw_listings
FOR EACH ROW EXECUTE FUNCTION vera_reject_mutation();
```

Attach equivalent triggers to `activity_events`, `source_job_attempts`, `decision_job_attempts`, `listing_extractions`, `decision_runs`, `duplicate_pair_evaluations`, `duplicate_overrides`, `duplicate_override_revocations`, `canonical_decision_runs`, `listing_scores`, and `risk_signals`.

- [ ] **Step 6: Generate and inspect the baseline**

Run: `DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:generate`

Expected: one PostgreSQL baseline migration and snapshot. Inspect it with `rg -n "CREATE TABLE|FOREIGN KEY|CREATE TRIGGER|jsonb|timestamp with time zone" packages/db/drizzle` and verify all named tables and triggers appear.

- [ ] **Step 7: Commit the canonical schema and isolated old history**

```bash
git add packages/db/src/postgres/schema.ts packages/db/src/postgres/schema.integration.test.ts packages/db/drizzle.config.ts packages/db/drizzle packages/db/drizzle-demo
git commit -m "feat(db): define tenant-owned PostgreSQL schema"
```

---

### Task 6: Build bounded connections, migrations, readiness, and safe errors

**Files:**
- Create: `packages/db/src/postgres/connection.ts`
- Create: `packages/db/src/postgres/connection.unit.test.ts`
- Create: `packages/db/src/postgres/errors.ts`
- Create: `packages/db/src/postgres/errors.unit.test.ts`
- Create: `packages/db/src/postgres/migrations.ts`
- Create: `packages/db/src/postgres/migrations.integration.test.ts`
- Create: `packages/db/src/postgres/testing.ts`
- Modify: `packages/db/src/migrate-cli.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `parsePostgresConfig`, PostgreSQL schema, `DATABASE_URL`, and `TEST_DATABASE_URL`.
- Produces: `PostgresConnection`, `openPostgresConnection`, `checkPostgresReadiness`, `migratePostgres`, `mapPostgresError`, and `withPostgresTestDatabase`.

- [ ] **Step 1: Write pool, error-redaction, and migration-readiness tests**

Test that one `Pool` is constructed with `max`, `connectionTimeoutMillis`, `statement_timeout`, `lock_timeout`, and `idle_in_transaction_session_timeout`; two calls through a memoized process composition reuse it; `close()` calls `pool.end()` exactly once; and a synthetic `DATABASE_URL`/SQL parameter never appears in `mapPostgresError(error).message` or safe log fields. Add an integration test that returns `migration_behind` before migration and `ready` after migration.

- [ ] **Step 2: Run focused unit tests and confirm missing modules**

Run: `pnpm vitest run packages/db/src/postgres/connection.unit.test.ts packages/db/src/postgres/errors.unit.test.ts`

Expected: FAIL because the connection and error modules do not exist.

- [ ] **Step 3: Implement one bounded pool per composition root**

The connection API is:

```ts
export interface PostgresConnection {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
  query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export function openPostgresConnection(
  config: PostgresConfig,
  dependencies: { readonly createPool?: (options: PoolConfig) => Pool } = {}
): PostgresConnection;
```

Set timeouts via connection options, register only safe pool error metadata, and make `close()` idempotent. Do not create or memoize a connection inside request handlers; Task 9's composition owns the singleton.

- [ ] **Step 4: Implement migrations, isolated tests, and readiness**

`migratePostgres(connection)` uses `drizzle-orm/node-postgres/migrator` and `packages/db/drizzle`. `withPostgresTestDatabase` connects through `TEST_DATABASE_URL`, creates a random schema name matching `vera_test_[a-f0-9]+`, sets `search_path`, migrates, invokes the test callback, drops that exact schema in `finally`, and refuses any base database other than `vera_test`.

`checkPostgresReadiness` runs `SELECT 1` with a bounded abort/timeout and verifies the latest Drizzle migration hash. It returns a strict `ReadinessReport` and never throws private driver data to a route.

- [ ] **Step 5: Apply migrations and pass PostgreSQL infrastructure tests**

Run: `DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm db:migrate && pnpm test:integration:postgres`

Expected: migration succeeds and connection/migration/schema tests PASS.

- [ ] **Step 6: Commit connection and migration runtime**

```bash
git add packages/db/src/postgres/connection.ts packages/db/src/postgres/connection.unit.test.ts packages/db/src/postgres/errors.ts packages/db/src/postgres/errors.unit.test.ts packages/db/src/postgres/migrations.ts packages/db/src/postgres/migrations.integration.test.ts packages/db/src/postgres/testing.ts packages/db/src/migrate-cli.ts vitest.config.ts
git commit -m "feat(db): add safe PostgreSQL runtime"
```

---

### Task 7: Implement tenant-scoped PostgreSQL repositories and global seed

**Files:**
- Create: `packages/db/src/postgres/row-mappers.ts`
- Create: `packages/db/src/postgres/repositories.ts`
- Create: `packages/db/src/postgres/repositories.integration.test.ts`
- Create: `packages/db/src/postgres/repository-contract.ts`
- Create: `packages/db/src/postgres/seed.ts`
- Create: `packages/db/src/postgres/seed.integration.test.ts`
- Modify: `packages/db/src/seed-cli.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: async repository contracts, PostgreSQL connection/schema, all domain Zod schemas, and global source manifests.
- Produces: `createPostgresRepositoryProvider(connection)`, `createPostgresGlobalPolicyRepository(connection)`, `seedPostgresGlobalPolicy(connection)`, and a reusable repository contract suite.

- [ ] **Step 1: Write the shared contract and tenant-isolation tests first**

The fixture API is:

```ts
export interface RepositoryContractFixture {
  createUser(): Promise<VeraUserId>;
  repositoriesFor(userId: VeraUserId): UserRepositories;
  transaction<T>(userId: VeraUserId, operation: (repositories: UserRepositories) => Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}

export function repositoryContract(name: string, createFixture: () => Promise<RepositoryContractFixture>): void;
```

The contract covers search-profile create/read/list/count, raw import idempotency, append-only mutation rejection, source/canonical membership, shortlist transition plus activity event rollback, and event ordering. PostgreSQL-only tests create users Alice and Bob, insert the same deterministic entity ID for each, prove each sees only their row, prove a Bob child cannot reference an Alice parent, and prove Alice's ID returns `null` through Bob's repositories.

- [ ] **Step 2: Run the focused integration tests and confirm no repository provider exists**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/repositories.integration.test.ts`

Expected: FAIL because `createPostgresRepositoryProvider` does not exist.

- [ ] **Step 3: Implement scoped queries and row parsing**

Every repository factory captures `userId` in closure:

```ts
function createSearchProfileRepository(db: PostgresTransaction, userId: VeraUserId): SearchProfileRepository {
  return {
    async insert(profile) {
      const [row] = await db.insert(searchProfiles).values(toSearchProfileRow(userId, profile)).returning();
      return SearchProfileSchema.parse(fromSearchProfileRow(requiredRow(row)));
    },
    async getById(id) {
      const [row] = await db.select().from(searchProfiles).where(
        and(eq(searchProfiles.userId, userId), eq(searchProfiles.id, id))
      ).limit(1);
      return row ? SearchProfileSchema.parse(fromSearchProfileRow(row)) : null;
    },
    async list() {
      const rows = await db.select().from(searchProfiles)
        .where(eq(searchProfiles.userId, userId))
        .orderBy(asc(searchProfiles.createdAt), asc(searchProfiles.id));
      return rows.map(fromSearchProfileRow).map((value) => SearchProfileSchema.parse(value));
    },
    async count() {
      const [row] = await db.select({ value: count() }).from(searchProfiles)
        .where(eq(searchProfiles.userId, userId));
      return Number(requiredRow(row).value);
    }
  };
}
```

Repeat this exact tenant predicate for all private repositories. Parse every result through its domain schema. Convert `Date` to ISO at the row-mapper edge, preserve JSON as structured data, and never return driver rows directly.

- [ ] **Step 4: Implement tenant-scoped transactions and idempotent imports**

`provider.transaction(userId, operation)` calls `db.transaction`, creates a fresh `UserRepositories` bound to the transaction and same user, and awaits the callback. Raw import inserts on `(user_id, idempotency_key)` conflict, reads the existing row for the same user, and returns `{ inserted: false }`. It must not resolve a conflict to another tenant's row.

Lifecycle operations lock with `SELECT ... FOR UPDATE`, call the existing domain transition function, perform a compare-and-update, and return a typed conflict when concurrent state has changed. Append-only repositories expose no update/delete methods.

- [ ] **Step 5: Implement global-policy-only seeding**

`pnpm db:seed` upserts only source policy manifests by their global version key. It creates no user, session, search profile, raw listing, canonical listing, score, risk signal, or decision job. Add an integration assertion that all private table counts remain zero after seeding.

- [ ] **Step 6: Run repository, seed, rollback, and isolation tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/repositories.integration.test.ts packages/db/src/postgres/seed.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit scoped repositories**

```bash
git add packages/db/src/postgres/row-mappers.ts packages/db/src/postgres/repositories.ts packages/db/src/postgres/repositories.integration.test.ts packages/db/src/postgres/repository-contract.ts packages/db/src/postgres/seed.ts packages/db/src/postgres/seed.integration.test.ts packages/db/src/seed-cli.ts packages/db/src/index.ts
git commit -m "feat(db): add tenant-scoped PostgreSQL repositories"
```

---

### Task 8: Implement concurrent worker claiming and decision reconciliation

**Files:**
- Create: `packages/db/src/postgres/worker-queue.ts`
- Create: `packages/db/src/postgres/worker-queue.integration.test.ts`
- Create: `packages/db/src/postgres/decision-repositories.ts`
- Create: `packages/db/src/postgres/decision-repositories.integration.test.ts`
- Modify: `packages/db/src/postgres/repositories.ts`

**Interfaces:**
- Consumes: `SystemWorkerQueue`, user-scoped repository provider, decision/scoring domain contracts.
- Produces: `createPostgresWorkerQueue(connection)` plus PostgreSQL decision reconciliation matching current deterministic behavior.

- [ ] **Step 1: Write concurrent claim and rollback tests**

Create two queue instances over the same test database, enqueue one job, release both claim promises together, and assert exactly one receives the job while the other receives `null`. Repeat for normalization, decision, and source jobs. Assert each claim returns the row's owner. Add tests for expired leases, safe retry, source-job transition plus attempt append rollback, decision plan idempotency, and concurrent shortlist transitions.

- [ ] **Step 2: Run the focused suite and confirm failure**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/worker-queue.integration.test.ts packages/db/src/postgres/decision-repositories.integration.test.ts`

Expected: FAIL because PostgreSQL claim/reconciliation implementations do not exist.

- [ ] **Step 3: Claim with row locking and return ownership**

Each claim transaction uses this SQL shape with the appropriate table/status vocabulary:

```sql
WITH candidate AS (
  SELECT user_id, id
  FROM normalization_jobs
  WHERE status IN ('queued', 'retryable_failed')
    AND available_at <= $1
    AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
  ORDER BY available_at, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE normalization_jobs AS job
SET status = 'running', lease_owner = $2, lease_expires_at = $3,
    attempt_count = attempt_count + 1, updated_at = $1
FROM candidate
WHERE job.user_id = candidate.user_id AND job.id = candidate.id
RETURNING job.*;
```

Validate the returned row and expose `{ userId, job }`. No worker method may list arbitrary users or private records.

- [ ] **Step 4: Port deterministic decision reads and plan application**

Use tenant predicates on every snapshot query, keep freshness/completeness ordering deterministic, persist plan output and reason JSON as `jsonb`, and apply the decision run, canonical memberships, scores, risk signals, and job completion in one transaction. A repeated `(user_id, job_id)` application returns the existing run with `replayed: true`.

- [ ] **Step 5: Pass concurrency and decision regression tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/worker-queue.integration.test.ts packages/db/src/postgres/decision-repositories.integration.test.ts`

Expected: PASS with no duplicate job execution.

- [ ] **Step 6: Commit worker persistence**

```bash
git add packages/db/src/postgres/worker-queue.ts packages/db/src/postgres/worker-queue.integration.test.ts packages/db/src/postgres/decision-repositories.ts packages/db/src/postgres/decision-repositories.integration.test.ts packages/db/src/postgres/repositories.ts
git commit -m "feat(db): add safe PostgreSQL job claiming"
```

---

### Task 9: Add Better Auth identity and protect hosted request boundaries

**Files:**
- Create: `apps/web/lib/server/auth.ts`
- Create: `apps/web/lib/server/auth.unit.test.ts`
- Create: `apps/web/lib/server/session.ts`
- Create: `apps/web/lib/server/session.unit.test.ts`
- Create: `apps/web/lib/server/application.ts`
- Create: `apps/web/lib/server/application-registry.ts`
- Create: `apps/web/instrumentation.ts`
- Create: `apps/web/app/api/auth/[...all]/route.ts`
- Create: `apps/web/app/api/ready/route.ts`
- Create: `apps/web/app/api/ready/route.integration.test.ts`
- Create: `apps/web/app/sign-in/page.tsx`
- Create: `apps/web/app/sign-in/sign-in-button.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: every private page and API route under `apps/web/app`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: PostgreSQL connection/provider, Better Auth Drizzle adapter, request headers/cookies, identity-only Google credentials.
- Produces: `auth`, `requireVeraSession`, `createPostgresApplication`, `getHostedApplication`, `/api/auth/[...all]`, `/api/ready`, and protected user-scoped route behavior.

- [ ] **Step 1: Write identity configuration and route-guard tests**

Test the built Better Auth options rather than calling Google. Assert:

```ts
expect(options.socialProviders.google.scope).toEqual(["openid", "email", "profile"]);
expect(options.socialProviders.google.accessType).toBeUndefined();
expect(JSON.stringify(options)).not.toMatch(/gmail|calendar|mail\.google\.com/u);
expect(options.account?.encryptOAuthTokens).toBe(true);
expect(options.advanced?.database?.generateId).toBe("uuid");
```

Session tests cover no cookie, expired/revoked session, valid user, and a body/query `userId` that differs from the session. API tests assert unauthenticated requests return 401, pages redirect to `/sign-in`, and another user's resource returns 404.

- [ ] **Step 2: Run the focused tests and confirm missing identity modules**

Run: `pnpm vitest run apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.unit.test.ts`

Expected: FAIL because auth and session modules do not exist.

- [ ] **Step 3: Configure Better Auth server-side only**

Build auth with `betterAuth`, `drizzleAdapter`, `databaseHooks` only when required for audited user lifecycle, and these constraints:

```ts
socialProviders: {
  google: {
    clientId: environment.VERA_AUTH_GOOGLE_CLIENT_ID,
    clientSecret: environment.VERA_AUTH_GOOGLE_CLIENT_SECRET,
    scope: ["openid", "email", "profile"]
  }
},
account: { encryptOAuthTokens: true },
advanced: { database: { generateId: "uuid" } },
trustedOrigins: [environment.VERA_PUBLIC_BASE_URL],
secret: environment.BETTER_AUTH_SECRET,
baseURL: environment.VERA_PUBLIC_BASE_URL
```

Map Better Auth models to plural PostgreSQL tables. Do not enable offline access, prompt consent, ID-token client sign-in, cross-email account linking, or any Gmail/Calendar scope. Keep credentials in server-only modules.

- [ ] **Step 4: Add authoritative session-to-repository binding**

`createPostgresApplication(config)` constructs one connection, repository provider, global policy reader, and readiness service and returns an object with async `close()`. `getHostedApplication()` memoizes exactly one such object per process. `requireVeraSession(headers)` calls `auth.api.getSession`, parses `session.user.id` as `VeraUserId`, and returns `{ user, repositories }` where repositories came from `application.repositoryProvider.forUser(user.id)`. It accepts no user ID argument.

API helpers map no session to 401, foreign/missing entity to 404, validation to 400, conflict to 409, and safe unavailable errors to 503. Pages redirect before accessing repositories.

- [ ] **Step 5: Register the auth handler, sign-in page, and readiness endpoint**

The auth route is:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../lib/server/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

The sign-in client calls `authClient.signIn.social({ provider: "google", callbackURL: "/" })`. `/api/health` stays dependency-free liveness. `/api/ready` calls `checkPostgresReadiness` and returns 200 only for `ready`, otherwise 503 with no connection details.

- [ ] **Step 6: Protect every hosted page and API route**

Public routes are exactly `/sign-in`, `/api/auth/*`, `/api/health`, `/api/ready`, and existing public legal pages if present. All activity, capture, connector, listing, decision, dedupe, demo-control, and home data access uses `requireVeraSession`. Hosted demo-control routes return 404; the offline demo composition supplies its own fixed context in Task 10.

- [ ] **Step 7: Run auth, route, readiness, typecheck, and build gates**

Run: `pnpm vitest run apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.unit.test.ts apps/web/app/api/ready/route.integration.test.ts && pnpm --filter @vera/web typecheck && pnpm --filter @vera/web build`

Expected: PASS without network or Google credentials in tests.

- [ ] **Step 8: Commit hosted identity**

```bash
git add apps/web/lib/server apps/web/instrumentation.ts apps/web/app/api/auth apps/web/app/api/ready apps/web/app/sign-in apps/web/app apps/web/next.config.ts
git commit -m "feat(web): add hosted identity and tenant guards"
```

---

### Task 10: Isolate and preserve the explicit SQLite demo adapter

**Files:**
- Move: `packages/db/src/connection.ts` to `packages/db/src/demo/connection.ts`
- Move: `packages/db/src/schema.ts` to `packages/db/src/demo/schema.ts`
- Move: `packages/db/src/migrations.ts` to `packages/db/src/demo/migrations.ts`
- Move: `packages/db/src/row-mappers.ts` to `packages/db/src/demo/row-mappers.ts`
- Move: `packages/db/src/sqlite-repositories.ts` to `packages/db/src/demo/repositories.ts`
- Move: `packages/db/src/sqlite-decision-repositories.ts` to `packages/db/src/demo/decision-repositories.ts`
- Move: `packages/db/src/fixtures.ts` to `packages/db/src/demo/fixtures.ts`
- Move: SQLite seed logic from `packages/db/src/seed.ts` to `packages/db/src/demo/seed.ts`
- Create: `packages/db/src/demo/index.ts`
- Create: `packages/db/src/demo/adapter.integration.test.ts`
- Modify: `packages/db/package.json`
- Create: `apps/web/lib/server/demo-application.ts`
- Create: `scripts/register-demo-runtime.ts`
- Modify: `scripts/demo-start.ts`
- Modify: `scripts/demo-seed.ts`
- Modify: `scripts/demo-reset.ts`
- Modify: `scripts/demo-environment.ts`
- Modify: `tests/e2e/reset-data.ts`

**Interfaces:**
- Consumes: async `UserRepositoryProvider`, SQLite history in `drizzle-demo`, deterministic fixture data.
- Produces: `@vera/db/demo`, `DEMO_USER_ID`, `createDemoRepositoryProvider`, `createDemoApplication`, and explicit preload-based `pnpm demo` startup.

- [ ] **Step 1: Write isolation and parity tests**

Assert importing `@vera/db` exposes no `openDatabase`, `createSqliteRepositories`, SQLite schema, fixture seed, or path helper. Assert `@vera/db/demo` exposes those demo-only capabilities. Run the shared repository contract with the fixed demo owner. Assert any user ID other than `DEMO_USER_ID` throws `DemoTenantMismatchError`, and assert demo schema has no users, sessions, accounts, verifications, integration connections, refresh tokens, or hosted job credentials.

- [ ] **Step 2: Move SQLite files and adapt them to async contracts**

Wrap synchronous driver calls inside `async` repository methods so callers share one contract; keep SQLite transactions synchronous internally but execute the awaited callback only when it performs no asynchronous suspension. Because a true async callback cannot stay inside `better-sqlite3`'s transaction, implement demo `transaction` as an explicit `BEGIN IMMEDIATE` / awaited callback / `COMMIT`, with `ROLLBACK` in `catch`, and serialize demo transactions through a process-local promise mutex.

The exported adapter is:

```ts
export const DEMO_USER_ID = "018f9f64-7b5a-7c91-a12e-000000000001" as VeraUserId;

export function createDemoRepositoryProvider(connection: DemoDatabaseConnection): UserRepositoryProvider {
  return {
    forUser(userId) {
      assertDemoUser(userId);
      return createDemoRepositories(connection);
    },
    async transaction(userId, operation) {
      assertDemoUser(userId);
      return demoTransactionMutex.run(() => runDemoTransaction(connection, operation));
    }
  };
}
```

- [ ] **Step 3: Make demo startup an explicit preload capability**

`scripts/demo-start.ts` creates a cryptographically random launch capability and passes it only to its spawned child process. `scripts/register-demo-runtime.ts` verifies that `VERA_DEMO_LAUNCH_TOKEN` capability, registers `createDemoApplication` in the process-global application registry, then deletes the environment value. `apps/web/instrumentation.ts` registers PostgreSQL only when the registry is empty. The demo process includes the `tsx` loader and the exact absolute `scripts/register-demo-runtime.ts` preload; normal `pnpm dev`, Railway, and worker commands never set this preload.

Do not branch on `DATABASE_URL`, `VERA_DATA_DIR`, or a generic database-type setting. `VERA_DEMO_MODE=1` alone is insufficient to construct SQLite.

- [ ] **Step 4: Preserve deterministic seed and E2E behavior**

`pnpm demo:reset`, `pnpm demo:seed`, and `pnpm demo` use only `@vera/db/demo`, the fixed demo owner, twelve sanitized source records, existing duplicate clusters, and existing activity history. Keep demo banners and no-credentials behavior. The production `db:seed` remains global-policy-only.

- [ ] **Step 5: Run shared contract and demo E2E tests**

Run: `pnpm vitest run packages/db/src/demo/adapter.integration.test.ts scripts/demo-environment.unit.test.ts && pnpm demo:reset && pnpm demo:seed && pnpm test:e2e`

Expected: PASS; dashboard, run demo search, duplicate detail, shortlist/dismiss, and activity log remain deterministic.

- [ ] **Step 6: Commit the isolated demo adapter**

```bash
git add packages/db/src packages/db/package.json scripts apps/web/lib/server/demo-application.ts tests/e2e packages/db/drizzle-demo
git commit -m "refactor(db): isolate SQLite as offline demo adapter"
```

---

### Task 11: Switch the hosted worker to PostgreSQL and graceful async shutdown

**Files:**
- Create: `apps/worker/src/postgres-runtime.ts`
- Create: `apps/worker/src/postgres-runtime.integration.test.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/src/lifecycle.ts`
- Modify: `apps/worker/src/normalization-worker.ts`
- Modify: `apps/worker/src/decision-worker.ts`
- Modify: `apps/worker/src/cli.unit.test.ts`
- Modify: `apps/worker/src/lifecycle.unit.test.ts`

**Interfaces:**
- Consumes: `openPostgresConnection`, `createPostgresRepositoryProvider`, `createPostgresWorkerQueue`.
- Produces: `createPostgresWorker`, `createPostgresWorkerRuntime`, async `close(): Promise<void>`, and PostgreSQL-backed `worker:start`/`worker:run-once`.

- [ ] **Step 1: Write worker composition and shutdown tests**

Assert default worker startup requires `DATABASE_URL`, creates one pool, passes only `SystemWorkerQueue` and a user provider to workers, stops polling before pool close, awaits in-flight work within the configured grace period, and exits nonzero when PostgreSQL is unavailable. Assert no SQLite file appears after a failed hosted worker startup.

- [ ] **Step 2: Run worker tests and confirm the old SQLite composition fails expectations**

Run: `pnpm vitest run apps/worker/src/postgres-runtime.integration.test.ts apps/worker/src/cli.unit.test.ts apps/worker/src/lifecycle.unit.test.ts`

Expected: FAIL because the CLI still imports SQLite and closes synchronously.

- [ ] **Step 3: Construct PostgreSQL worker dependencies directly**

`createPostgresWorker(config)` creates one connection, repository provider, queue, and async shutdown boundary. `createPostgresWorkerRuntime(worker, leaseOwner)` composes the normalization/decision poller over that boundary. Normalization/decision processors claim through the system queue and then use `repositoryProvider.forUser(owned.userId)`. `NormalizationRuntime.close()` becomes `Promise<void>`, and all CLI `finally`/signal paths await it after polling stops.

Do not add a database switch. The offline demo's worker is registered by the Task 10 preload and is never reachable from normal `worker:start`.

- [ ] **Step 4: Pass worker integration and lifecycle tests**

Run: `pnpm vitest run apps/worker/src/postgres-runtime.integration.test.ts apps/worker/src/cli.unit.test.ts apps/worker/src/lifecycle.unit.test.ts && pnpm --filter @vera/worker typecheck && pnpm --filter @vera/worker build`

Expected: PASS.

- [ ] **Step 5: Commit hosted worker composition**

```bash
git add apps/worker/src
git commit -m "feat(worker): use PostgreSQL job persistence"
```

---

### Task 12: Add adversarial tenancy, concurrency, timestamp, JSONB, and encryption coverage

**Files:**
- Create: `packages/db/src/postgres/tenancy.integration.test.ts`
- Create: `packages/db/src/postgres/concurrency.integration.test.ts`
- Create: `packages/db/src/postgres/types.integration.test.ts`
- Create: `packages/db/src/postgres/credentials.integration.test.ts`
- Create: `apps/web/app/api/tenant-isolation.integration.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: completed PostgreSQL schema/repositories, auth session test harness, credential envelope.
- Produces: acceptance evidence for all persistence-sensitive founder-release invariants.

- [ ] **Step 1: Implement the PostgreSQL-only acceptance matrix**

Tests must prove:

1. duplicate `(user_id, idempotency_key)` imports converge to one raw row;
2. the same deterministic ID can exist for two users without visibility leakage;
3. composite FKs reject cross-user parent/child links;
4. a thrown transaction leaves no partial row or activity event;
5. two concurrent shortlist requests yield one legal state and deterministic audit behavior;
6. two claimers cannot execute one job twice;
7. audit events persist and reject update/delete through raw SQL;
8. JSONB round-trips through Zod without stringification drift;
9. `timestamptz` values round-trip identically under `TZ=UTC` and `TZ=America/Los_Angeles` child processes;
10. raw SQL contains ciphertext but not the synthetic refresh token;
11. captured logs contain no token, connection URL, authorization code, or email body;
12. cross-user HTTP access returns 404 and never a differently shaped authorization response.

- [ ] **Step 2: Run the entire PostgreSQL integration project repeatedly**

Run: `pnpm test:integration:postgres && pnpm test:integration:postgres`

Expected: both runs PASS, demonstrating clean isolated schemas and no order dependence.

- [ ] **Step 3: Commit persistence acceptance coverage**

```bash
git add packages/db/src/postgres/*integration.test.ts apps/web/app/api/tenant-isolation.integration.test.ts vitest.config.ts
git commit -m "test: prove PostgreSQL isolation and concurrency"
```

---

### Task 13: Enforce production/demo import boundaries and local reset safety

**Files:**
- Create: `scripts/verify-database-boundaries.ts`
- Create: `scripts/verify-database-boundaries.unit.test.ts`
- Create: `scripts/postgres-reset.ts`
- Create: `scripts/postgres-reset.unit.test.ts`
- Modify: `eslint.config.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: target import boundary and local Compose database identity.
- Produces: `verify:db-boundaries` and guarded `postgres:reset`.

- [ ] **Step 1: Write boundary and destructive-target tests**

Fixtures prove the verifier rejects:

- `better-sqlite3` or `@vera/db/demo` imports outside `packages/db/src/demo`, `scripts/demo-*`, and demo tests;
- `pg`, Drizzle schema, or raw SQL imports from domain/application service files;
- hosted code importing SQLite paths;
- demo code importing hosted identity or credential tables.

Reset tests reject a non-loopback host, non-`vera` database, user other than `vera`, missing Compose project label, or `NODE_ENV=production`.

- [ ] **Step 2: Implement the verifier and guarded reset**

The verifier enumerates tracked TypeScript files with `git ls-files`, parses import specifiers without executing code, applies exact allowlists, and exits 1 with file/specifier pairs. Add ESLint `no-restricted-imports` for fast editor feedback.

`postgres-reset.ts` parses `DATABASE_URL`, requires host `127.0.0.1` or `localhost`, database `vera`, user `vera`, verifies `docker compose ps --format json postgres` identifies the workspace service, then runs `docker compose down --volumes` and `docker compose up -d postgres`. It never executes `DROP DATABASE` against an arbitrary URL.

- [ ] **Step 3: Run security boundary tests and verifier**

Run: `pnpm vitest run scripts/verify-database-boundaries.unit.test.ts scripts/postgres-reset.unit.test.ts && pnpm verify:db-boundaries`

Expected: PASS and no forbidden imports.

- [ ] **Step 4: Commit enforced boundaries**

```bash
git add scripts/verify-database-boundaries.ts scripts/verify-database-boundaries.unit.test.ts scripts/postgres-reset.ts scripts/postgres-reset.unit.test.ts eslint.config.mjs package.json
git commit -m "chore: enforce hosted database boundaries"
```

---

### Task 14: Update deployment, operations, architecture, security, and demo documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `railway.toml`
- Modify: `scripts/railway-runtime.ts`
- Modify: `scripts/railway-start.ts`
- Modify: `scripts/railway-runtime.integration.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SOURCE_POLICY.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/DEMO_NOW.md`
- Create: `docs/POSTGRES_OPERATIONS.md`
- Create: `docs/DECISIONS/0009-postgresql-hosted-persistence.md`

**Interfaces:**
- Consumes: verified commands and final hosted/demo topology.
- Produces: clone-to-run local setup, hosted release contract, backup/restore/rollback runbook, accurate Mermaid model, and explicit demo isolation.

- [ ] **Step 1: Write deployment tests before changing Railway behavior**

Assert Railway startup requires `DATABASE_URL`, runs migrations as the release/start gate, never creates a SQLite path, starts web and worker against PostgreSQL, and configures `/api/ready` as the health check. Missing PostgreSQL must fail rather than fall back.

- [ ] **Step 2: Update Railway for one web, one worker, and PostgreSQL**

Set `healthcheckPath = "/api/ready"`. Document that the founder deploy uses two services from one repo: web start `pnpm --filter @vera/web start`, worker start `pnpm worker:start`, each with bounded pool values whose sum remains below the managed connection limit. Run `pnpm db:migrate` as a release step and `pnpm db:seed` explicitly after the first migration.

- [ ] **Step 3: Write exact local and operational commands**

README quick start:

```sh
cp .env.example .env.local
pnpm install
pnpm postgres:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Demo quick start remains:

```sh
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

`docs/POSTGRES_OPERATIONS.md` documents migration preflight, managed snapshot, `pg_dump --format=custom --no-owner`, restore to a new/maintenance database with `pg_restore --no-owner`, readiness verification, rollback by compatible app deploy or pre-migration snapshot restore, and a restore rehearsal. Do not present automatic down migrations or SQLite as hosted recovery.

- [ ] **Step 4: Update architecture, data model, security, source policy, and demo truthfully**

The Mermaid entity diagram includes `users` ownership edges to each private aggregate and marks `source_policy_manifests` global. Security documents session-derived user scope, composite ownership constraints, Better Auth identity-only scopes, application-layer credential encryption, log redaction, and 404 foreign-resource behavior. Demo docs explicitly say SQLite contains sanitized fixtures only and stores no production identity/OAuth data.

- [ ] **Step 5: Record the ADR**

ADR 0009 records status accepted, context, decision, consequences, rejected generic dual-database/RLS/importer options, and the condition that meaningful non-demo founder data would require a separately reviewed one-time migration utility.

- [ ] **Step 6: Run documentation/deployment checks and commit**

Run: `pnpm vitest run scripts/railway-runtime.integration.test.ts scripts/railway-config.unit.test.ts && pnpm format:check`

Expected: PASS.

```bash
git add README.md .env.example railway.toml scripts/railway-* docs/ARCHITECTURE.md docs/DATA_MODEL.md docs/SECURITY.md docs/SOURCE_POLICY.md docs/DEMO.md docs/DEMO_NOW.md docs/POSTGRES_OPERATIONS.md docs/DECISIONS/0009-postgresql-hosted-persistence.md
git commit -m "docs: document PostgreSQL hosted operations"
```

---

### Task 15: Run the full cutover and acceptance gate

**Files:**
- Modify only files required by failures proven in this task.
- Review: every changed file since commit `c9cf9b8`.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: verified hosted PostgreSQL/identity cutover with preserved offline demo and a clean security/policy diff.

- [ ] **Step 1: Start clean local infrastructure and apply the canonical schema**

Run:

```sh
pnpm postgres:reset
pnpm db:migrate
pnpm db:seed
```

Expected: PostgreSQL is healthy, migration history is current, global policies seed idempotently, and no private fixture user is created.

- [ ] **Step 2: Run narrow and full automated gates**

Run:

```sh
pnpm verify:db-boundaries
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration:postgres
pnpm test:integration
pnpm demo:reset
pnpm demo:seed
pnpm test:e2e
pnpm build
```

Expected: every command exits 0. Default tests make no Google/OpenAI/external side effect.

- [ ] **Step 3: Verify runtime failure and readiness behavior**

With PostgreSQL running, start hosted web and assert `/api/health` is 200 and `/api/ready` is 200. Stop PostgreSQL, leave the web process alive, and assert `/api/health` stays 200 while `/api/ready` becomes 503. Assert no `.sqlite` file appears anywhere in the hosted data path. Restart PostgreSQL and verify readiness recovers.

- [ ] **Step 4: Verify deterministic demo click path**

Run `pnpm demo`, then click: Inbox → Run demo search → inspect a duplicate-source badge → open listing detail → Shortlist → Activity. Verify sanitized fixtures, deterministic scores, duplicate evidence, persistent shortlist, and audit event. Verify no sign-in, database URL, Google credential, or network connector is required.

- [ ] **Step 5: Audit the diff for tenant and secret regressions**

Run:

```sh
git diff --check c9cf9b8..HEAD
git diff --stat c9cf9b8..HEAD
rg -n "mail\.google\.com|gmail\.|calendar\.|messages\.send|drafts\.send|VERA_DATA_DIR|better-sqlite3|@vera/db/demo" apps packages scripts package.json
rg -n "password|client_secret|refresh_token|access_token|authorization_code" . --glob '!pnpm-lock.yaml' --glob '!docs/**'
```

Expected: Gmail/Calendar/send APIs are absent; SQLite matches only the demo allowlist; secret terms occur only in schema/config/redaction tests with synthetic values; no credential or personal data is committed.

- [ ] **Step 6: Resolve any acceptance failure in its owning task**

If a gate fails, return to the task that owns the failing component, add a focused regression test beside that source file, run that task's narrow command, and use that task's explicit `git add` list and commit message. After every gate is green, run `git status --short`; expected output is empty, so no empty acceptance commit is created.

The milestone report must include schema differences, migrations created, repository compatibility changes, demo preservation, exact setup commands, every gate result, deployment assumptions, remaining risks, and recommended commit message `feat: migrate hosted Vera persistence to PostgreSQL`.

## Completion Boundary

This plan ends when PostgreSQL identity/tenant isolation is accepted and documented. The next separately reviewed plan covers `/settings/integrations`, incremental Google data OAuth, Gmail alert ingestion, payload-bound `drafts.create`, Calendar availability/holds, revocation, and Google verification. None of those capabilities may be folded into this cutover.
