# PostgreSQL Reliability, Privacy, and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Vera's canonical PostgreSQL state, recover expired work safely, expose bounded operational metrics, and publish executable privacy, backup, restore, and incident procedures for founder staging.

**Architecture:** Keep PostgreSQL and the existing asynchronous repository interfaces canonical. Add one forward migration for constraints only, one system cleanup repository for short-lived control data, lease recovery in the existing claim transactions, and an in-process fixed-cardinality metrics registry; preserve immutable raw listings and audit history and treat operator-assisted export/deletion as a documented founder-only boundary rather than pretending multi-user self-service exists.

**Tech Stack:** PostgreSQL 18.4, Drizzle ORM 0.45.2, node-postgres 8.22, TypeScript 6, Vitest 4, Docker Compose, native `pg_dump`/`pg_restore`, OpenMetrics text format without a new runtime dependency.

## Global Constraints

- PostgreSQL is the only hosted database; SQLite remains isolated under `@vera/db/demo` and is not imported by production entry points.
- Migration `0003_maritime_execution_plane.sql` is never rewritten after release; all corrections use forward migration `0004_founder_security_hardening.sql`.
- Use `timestamptz` for persisted instants, integer money, `jsonb` only for schema-bounded structures, and database-enforced tenant foreign keys and uniqueness.
- Migration preflight must fail visibly rather than silently deleting or merging ambiguous rows.
- Never reset, truncate, or reseed private production data.
- `pnpm db:seed` may create or update global sanitized source-policy manifests only; it must create no user, listing, job, integration, credential, notification, or audit row.
- Preserve `RawListing`, extraction runs, field provenance, availability checks, and `ActivityEvent` immutability.
- Cleanup may remove only expired ephemeral control records after their explicit retention window; it may not delete raw evidence, source records, canonical listings, or audit events.
- Metrics labels are fixed enums only. Never label by user ID, job ID, listing ID, source URL, email, phone, node identifier, payload hash, or error message.
- Production readiness remains distinct from liveness and returns no database URL, query text, token, or exception body.
- Founder staging may use audited operator-assisted export and deletion; missing self-service export/deletion remains a blocker for multi-user beta.

---

## File Map

- Create `packages/db/drizzle/0004_founder_security_hardening.sql`: partial uniqueness, encrypted-envelope bounds, and a tenant-owned integration refresh lease table with preflight.
- Create/update `packages/db/drizzle/meta/0004_snapshot.json` and `_journal.json`: Drizzle migration metadata.
- Modify `packages/db/src/postgres/schema.ts`: declarative schema parity.
- Modify `packages/db/src/postgres/migrations.integration.test.ts`: populated-data upgrade, ambiguity failure, lock-safe SQL, and migration count.
- Modify `packages/db/src/postgres/schema.integration.test.ts`: enforced partial uniqueness and bytea bounds.
- Create `packages/db/src/postgres/integration-refresh-leases.ts`: atomic acquire/release of short Google refresh leases without holding a transaction across network I/O.
- Create `packages/db/src/postgres/integration-refresh-leases.integration.test.ts`: cross-user, concurrency, expiry, and owner-safe release tests.
- Modify `packages/db/src/demo/index.ts`: expose a fail-closed unavailable refresh-lease repository so the deterministic demo cannot acquire hosted credentials.
- Modify `apps/web/lib/server/google-integration-oauth.ts` and tests: coordinate Calendar refresh/revocation calls.
- Modify `apps/worker/src/google-gmail-access.ts` and tests: coordinate Gmail refresh calls through the same lease.
- Create `packages/db/src/postgres/seed.integration.test.ts`: prove hosted seed is global-only and idempotent.
- Modify `packages/db/src/postgres/seed.ts`: expose exact inserted/present counts without touching private tables.
- Modify `packages/db/src/postgres/worker-queue.ts`: recover expired notification leases atomically.
- Modify `packages/db/src/postgres/notification-repositories.integration.test.ts`: concurrent and expired-lease recovery.
- Create `packages/db/src/postgres/ephemeral-cleanup.ts`: bounded cleanup/expiry transitions for OAuth state, dispatches, heartbeats, and terminal schedule runs.
- Create `packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`: cutoff, ownership, batch, and immutable-table preservation.
- Modify `packages/db/src/repositories.ts`: `SystemEphemeralCleanupRepository` contract.
- Modify `apps/worker/src/postgres-runtime.ts`: execute `ephemeral_cleanup` schedule through the system repository.
- Modify `apps/worker/src/maritime-scheduler.unit.test.ts`: cleanup schedule result and replay behavior.
- Create `apps/worker/src/metrics.ts`: fixed-cardinality counters/histograms and OpenMetrics rendering.
- Create `apps/worker/src/metrics.unit.test.ts`: deterministic rendering and secret/cardinality exclusions.
- Modify `apps/worker/src/cli.ts`: observe lane outcomes/durations and supply metrics to the private service.
- Modify `apps/worker/src/service-server.ts`: private `/metrics` response plus exact method/path behavior.
- Modify `apps/worker/src/service-server.unit.test.ts`: real HTTP tests for health/readiness/metrics and denial paths.
- Create `scripts/postgres-backup-rehearsal.ts`: explicit temporary-database dump/restore verification.
- Create `scripts/postgres-backup-rehearsal.unit.test.ts`: target validation and secret-free command diagnostics.
- Modify `package.json`: `postgres:backup-rehearsal` and relevant verification scripts.
- Create `docs/PRIVACY_OPERATIONS.md`: inventory, retention, export, deletion, disconnect, revocation, provider, and backup behavior.
- Modify `docs/POSTGRES_OPERATIONS.md`, `docs/SECURITY.md`, `docs/DATA_MODEL.md`, `docs/SECURITY_REVIEW.md`, and `.env.example`: migration, cleanup, metrics, retention, and release evidence.

### Task 1: Add the Forward PostgreSQL Hardening Migration

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/drizzle/0004_founder_security_hardening.sql`
- Create: `packages/db/drizzle/meta/0004_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/postgres/migrations.integration.test.ts`
- Modify: `packages/db/src/postgres/schema.integration.test.ts`

**Interfaces:**
- Consumes: existing `production_schedules` and `web_push_subscriptions` tables from migration `0003`.
- Produces: unique global schedule per `(user_id, kind)` when `source_configuration_id IS NULL`, 12-byte GCM nonce, 16-byte GCM authentication tag, ciphertext size `1..16384` bytes, and tenant-owned `integration_refresh_leases`.

- [ ] **Step 1: Write failing schema and migration tests**

```ts
it("enforces one null-source schedule per user and kind", async () => {
  await connection.db.insert(productionSchedules).values(schedule({ id: "schedule-a", sourceConfigurationId: null }));
  await expect(
    connection.db.insert(productionSchedules).values(schedule({ id: "schedule-b", sourceConfigurationId: null }))
  ).rejects.toMatchObject({ code: "23505" });
});

it.each([
  { nonce: Buffer.alloc(11), ciphertext: Buffer.alloc(32), tag: Buffer.alloc(16) },
  { nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(0), tag: Buffer.alloc(16) },
  { nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(16_385), tag: Buffer.alloc(16) },
  { nonce: Buffer.alloc(12), ciphertext: Buffer.alloc(32), tag: Buffer.alloc(15) }
])("rejects malformed encrypted Web Push material %#", async (encrypted) => {
  await expect(insertSubscription(encrypted)).rejects.toMatchObject({ code: "23514" });
});
```

Add a migration-source assertion:

```ts
expect(migration).toContain("production_schedules_user_global_kind_unique");
expect(migration).toContain("WHERE source_configuration_id IS NULL");
expect(migration).toContain("octet_length(credential_nonce) = 12");
expect(migration).toContain("octet_length(credential_authentication_tag) = 16");
expect(migration).toContain("octet_length(credential_ciphertext) BETWEEN 1 AND 16384");
expect(migration).toContain('CREATE TABLE "integration_refresh_leases"');
expect(migration).toContain('integration_refresh_leases_connection_tenant_fk');
expect(migration).not.toMatch(/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/iu);
```

- [ ] **Step 2: Run the PostgreSQL tests and confirm they fail**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test \
  pnpm exec vitest run --project postgres-integration \
  packages/db/src/postgres/migrations.integration.test.ts \
  packages/db/src/postgres/schema.integration.test.ts
```

Expected: FAIL because migration `0004` and its constraints do not exist.

- [ ] **Step 3: Add declarative schema constraints**

Add to `productionSchedules`:

```ts
uniqueIndex("production_schedules_user_global_kind_unique")
  .on(table.userId, table.kind)
  .where(sql`${table.sourceConfigurationId} IS NULL`)
```

Add to `webPushSubscriptions`:

```ts
check("web_push_subscriptions_nonce_length", sql`octet_length(${table.credentialNonce}) = 12`),
check("web_push_subscriptions_ciphertext_length", sql`octet_length(${table.credentialCiphertext}) BETWEEN 1 AND 16384`),
check("web_push_subscriptions_authentication_tag_length", sql`octet_length(${table.credentialAuthenticationTag}) = 16`)
```

- [ ] **Step 4: Generate migration metadata, then make the SQL lock-conscious**

Run: `pnpm db:generate`

Expected: Drizzle creates migration index `0004` and its snapshot. Rename the SQL file to `0004_founder_security_hardening.sql` and keep the journal tag identical.

The final SQL must begin with this tenant-owned lease table and then apply the constraint preflight:

```sql
CREATE TABLE "integration_refresh_leases" (
  "user_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "lease_owner" text NOT NULL,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "integration_refresh_leases_user_id_integration_id_pk" PRIMARY KEY("user_id", "integration_id"),
  CONSTRAINT "integration_refresh_leases_owner_valid" CHECK ("lease_owner" ~ '^[A-Za-z0-9._:-]{1,160}$'),
  CONSTRAINT "integration_refresh_leases_expiry_order" CHECK ("lease_expires_at" > "updated_at")
);
--> statement-breakpoint
ALTER TABLE "integration_refresh_leases" ADD CONSTRAINT "integration_refresh_leases_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "integration_refresh_leases" ADD CONSTRAINT "integration_refresh_leases_connection_tenant_fk"
  FOREIGN KEY ("user_id", "integration_id") REFERENCES "integration_connections"("user_id", "id") ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX "integration_refresh_leases_expiry_idx" ON "integration_refresh_leases" ("lease_expires_at", "user_id", "integration_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM production_schedules
    WHERE source_configuration_id IS NULL
    GROUP BY user_id, kind HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'production_schedules contains duplicate null-source rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM web_push_subscriptions
    WHERE octet_length(credential_nonce) <> 12
       OR octet_length(credential_authentication_tag) <> 16
       OR octet_length(credential_ciphertext) NOT BETWEEN 1 AND 16384
  ) THEN
    RAISE EXCEPTION 'web_push_subscriptions contains malformed encrypted material';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "production_schedules_user_global_kind_unique"
  ON "production_schedules" ("user_id", "kind")
  WHERE "source_configuration_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_nonce_length"
  CHECK (octet_length("credential_nonce") = 12) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_nonce_length";
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_ciphertext_length"
  CHECK (octet_length("credential_ciphertext") BETWEEN 1 AND 16384) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_ciphertext_length";
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_authentication_tag_length"
  CHECK (octet_length("credential_authentication_tag") = 16) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_authentication_tag_length";
```

The preflight intentionally aborts without modifying data. `NOT VALID` plus separate validation avoids a table rewrite and keeps the strongest validation lock away from the scan.

- [ ] **Step 5: Test populated upgrade and ambiguous-data refusal**

Extend the migration harness to apply through `0003`, insert one valid schedule/subscription, then apply `0004` and assert row bytes are unchanged. In a separate temporary schema, insert duplicate null-source schedules before `0004` and assert migration fails with `duplicate null-source rows` while both rows remain.

- [ ] **Step 6: Run migration and schema tests**

Run the command from Step 2.

Expected: PASS; the migration count changes from `4` to `5`, valid populated rows survive byte-for-byte, ambiguous data stops migration, and constraints are database-enforced.

- [ ] **Step 7: Commit the migration alone**

```bash
git add packages/db/src/postgres/schema.ts packages/db/drizzle/0004_founder_security_hardening.sql packages/db/drizzle/meta packages/db/src/postgres/migrations.integration.test.ts packages/db/src/postgres/schema.integration.test.ts
git commit -m "fix: harden production schedule and credential constraints"
```

### Task 2: Serialize Google Refresh Operations Across Web and Worker

**Files:**
- Create: `packages/db/src/postgres/integration-refresh-leases.ts`
- Create: `packages/db/src/postgres/integration-refresh-leases.integration.test.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/demo/index.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.unit.test.ts`
- Modify: `apps/worker/src/google-gmail-access.ts`
- Create: `apps/worker/src/google-gmail-access.unit.test.ts`

**Interfaces:**
- Consumes: scoped user repositories, integration UUID, injected lease owner/clock, and provider calls that already have deadlines.
- Produces: `integrationRefreshLeases.tryAcquire(input)`, `release(input)`, and safe retryable error `integration_refresh_in_progress`.
- Demo behavior: both methods fail closed with `Google credential refresh is unavailable in offline demo mode.` and no hosted module is imported from `@vera/db/demo`.

- [ ] **Step 1: Write concurrent lease tests**

```ts
it("allows one refresh owner and recovers after expiry", async () => {
  const first = provider.forUser(userId).integrationRefreshLeases;
  const second = secondProvider.forUser(userId).integrationRefreshLeases;
  const input = {
    integrationId,
    now: "2026-07-22T12:00:00.000Z",
    leaseExpiresAt: "2026-07-22T12:00:30.000Z"
  };
  const results = await Promise.all([
    first.tryAcquire({ ...input, leaseOwner: "web-a" }),
    second.tryAcquire({ ...input, leaseOwner: "worker-b" })
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await expect(
    provider.forUser(otherUserId).integrationRefreshLeases.release({ integrationId, leaseOwner: "web-a" })
  ).rejects.toMatchObject({ code: "ownership_violation" });
  await expect(first.tryAcquire({ ...input, now: "2026-07-22T12:00:31.000Z", leaseExpiresAt: "2026-07-22T12:01:01.000Z", leaseOwner: "web-c" })).resolves.toBe(true);
});
```

Also test that only the owning lease value can release and that deleting the integration cascades the lease.

- [ ] **Step 2: Run and confirm the repository is absent**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/integration-refresh-leases.integration.test.ts`

Expected: FAIL because the lease repository does not exist.

- [ ] **Step 3: Implement atomic acquire and owner-safe release**

Use one `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE existing.lease_expires_at <= excluded.updated_at RETURNING` statement:

```sql
INSERT INTO integration_refresh_leases (
  user_id, integration_id, lease_owner, lease_expires_at, created_at, updated_at
) VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz, $5::timestamptz, $5::timestamptz)
ON CONFLICT (user_id, integration_id) DO UPDATE SET
  lease_owner = EXCLUDED.lease_owner,
  lease_expires_at = EXCLUDED.lease_expires_at,
  updated_at = EXCLUDED.updated_at
WHERE integration_refresh_leases.lease_expires_at <= EXCLUDED.updated_at
RETURNING lease_owner;
```

Return `true` only when the returned owner equals the requested owner. Release with one tenant/owner-predicated `DELETE`; return `false` on a stale/wrong owner without revealing whether another tenant has a row.

Add `integrationRefreshLeases` to `UserRepositories`, construct it in `createPostgresUserRepositories`, export the PostgreSQL implementation from `packages/db/src/index.ts`, and add an explicit unavailable implementation in `packages/db/src/demo/index.ts`. Extend the existing production/demo import-boundary test so hosted entry points cannot import the demo implementation and the demo adapter cannot acquire a refresh lease.

- [ ] **Step 4: Wrap Calendar and Gmail refresh calls without a long database transaction**

Use a unique injected owner and a 30-second lease:

```ts
const leaseOwner = `google-refresh:${randomId()}`;
const acquiredAt = clock();
const acquired = await repositories.integrationRefreshLeases.tryAcquire({
  integrationId: existing.id,
  leaseOwner,
  now: acquiredAt.toISOString(),
  leaseExpiresAt: new Date(acquiredAt.getTime() + 30_000).toISOString()
});
if (!acquired) throw new GoogleIntegrationOAuthError("integration_refresh_in_progress", 503);
try {
  return await refreshProviderAndPersist();
} finally {
  await repositories.integrationRefreshLeases.release({ integrationId: existing.id, leaseOwner });
}
```

The network call occurs after acquire and before release, but never inside a PostgreSQL transaction. Apply the same repository contract in `refreshGmailAccessToken`; map contention to retryable `gmail_temporarily_unavailable`. Revocation/disconnect must either acquire the same lease or fail retryably, preventing refresh from racing credential erasure.

- [ ] **Step 5: Prove only one provider call occurs**

In web and worker unit tests, hold the first mocked refresh unresolved, start a second call, assert the second fails with the safe contention code and the provider mock has one call, then resolve the first and assert release occurs in `finally` on success, provider error, timeout, and cancellation.

- [ ] **Step 6: Run focused and PostgreSQL tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/integration-refresh-leases.integration.test.ts
pnpm exec vitest run --project unit apps/web/lib/server/google-integration-oauth.unit.test.ts apps/worker/src/google-gmail-access.unit.test.ts
```

Expected: PASS; a refresh race results in one provider call, one retryable contender, and no lost rotated token or resurrected disconnected credential.

- [ ] **Step 7: Commit refresh coordination**

```bash
git add packages/db/src/repositories.ts packages/db/src/postgres/integration-refresh-leases.ts packages/db/src/postgres/integration-refresh-leases.integration.test.ts packages/db/src/postgres/repositories.ts packages/db/src/index.ts packages/db/src/demo/index.ts apps/web/lib/server/google-integration-oauth.ts apps/web/lib/server/google-integration-oauth.unit.test.ts apps/worker/src/google-gmail-access.ts apps/worker/src/google-gmail-access.unit.test.ts
git commit -m "fix: serialize Google token refreshes"
```

### Task 3: Prove the Hosted Seed Is Safe and Idempotent

**Files:**
- Modify: `packages/db/src/postgres/seed.ts`
- Create: `packages/db/src/postgres/seed.integration.test.ts`
- Modify: `packages/db/src/seed-cli.ts`
- Modify: `docs/POSTGRES_OPERATIONS.md`

**Interfaces:**
- Consumes: `SOURCE_POLICY_MANIFEST_FIXTURES` and the global source-policy repository.
- Produces: `seedPostgresGlobalPolicy(connection)` with `{ sourcePolicyManifests, inserted }`; no private data mutation.

- [ ] **Step 1: Write a failing integration test around every private table class**

```ts
it("seeds only global sanitized policy and is idempotent", async () => {
  const before = await privateTableCounts(connection);
  const first = await seedPostgresGlobalPolicy(connection);
  const second = await seedPostgresGlobalPolicy(connection);
  const after = await privateTableCounts(connection);

  expect(first.sourcePolicyManifests).toBe(SOURCE_POLICY_MANIFEST_FIXTURES.length);
  expect(second).toEqual({ sourcePolicyManifests: SOURCE_POLICY_MANIFEST_FIXTURES.length, inserted: 0 });
  expect(after).toEqual(before);
});
```

`privateTableCounts` must count `users`, `search_profiles`, `raw_listings`, `listing_source_records`, `canonical_listings`, `source_jobs`, `activity_events`, `integration_connections`, `integration_credentials`, `web_push_subscriptions`, and `notification_deliveries` in one query.

- [ ] **Step 2: Run and confirm the result-shape failure**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/seed.integration.test.ts`

Expected: FAIL because the seed result does not report inserted rows.

- [ ] **Step 3: Count actual inserts without broadening the seed**

```ts
let inserted = 0;
for (const manifest of SOURCE_POLICY_MANIFEST_FIXTURES) {
  const result = await repository.insert(manifest);
  if (result.inserted) inserted += 1;
}
return { sourcePolicyManifests: (await repository.list()).length, inserted };
```

If the repository's existing return type uses a different insertion flag, adapt only this count; do not add private bootstrap behavior.

- [ ] **Step 4: Run the seed test and CLI against the test database**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/seed.integration.test.ts
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm db:seed
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm db:seed
```

Expected: test PASS; the second CLI JSON line reports `inserted: 0`; private counts stay unchanged.

- [ ] **Step 5: Commit seed safety evidence**

```bash
git add packages/db/src/postgres/seed.ts packages/db/src/postgres/seed.integration.test.ts packages/db/src/seed-cli.ts docs/POSTGRES_OPERATIONS.md
git commit -m "test: prove hosted seed preserves private data"
```

### Task 4: Recover Expired Notification Leases Exactly Once

**Files:**
- Modify: `packages/db/src/postgres/worker-queue.ts`
- Modify: `packages/db/src/postgres/notification-repositories.integration.test.ts`
- Modify: `apps/worker/src/notification-worker.unit.test.ts`

**Interfaces:**
- Consumes: existing `claimNextNotificationDelivery({ leaseOwner, now, leaseExpiresAt })`.
- Produces: atomic reclaim of expired `leased` delivery rows while preserving `FOR UPDATE SKIP LOCKED` duplicate-execution protection.

- [ ] **Step 1: Write the expired-lease concurrency test**

```ts
it("recovers one expired notification lease without duplicate execution", async () => {
  await insertDelivery({ state: "leased", leaseOwner: "crashed-worker", leaseExpiresAt: "2026-07-22T11:59:00.000Z" });
  const input = { now: "2026-07-22T12:00:00.000Z", leaseExpiresAt: "2026-07-22T12:01:00.000Z" };
  const [left, right] = await Promise.all([
    queueA.claimNextNotificationDelivery({ ...input, leaseOwner: "worker-a" }),
    queueB.claimNextNotificationDelivery({ ...input, leaseOwner: "worker-b" })
  ]);
  expect([left, right].filter(Boolean)).toHaveLength(1);
  expect((left ?? right)?.delivery.attemptCount).toBe(2);
});
```

- [ ] **Step 2: Run and confirm the current queue returns no row**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/notification-repositories.integration.test.ts`

Expected: FAIL because `leased` is excluded from the claim candidates.

- [ ] **Step 3: Add the exact recovery predicate**

Replace the notification claim state predicate with:

```ts
or(
  and(
    inArray(notificationDeliveries.state, ["queued", "retryable_failed", "deferred_quiet_hours", "deferred_rate_limit"]),
    lte(notificationDeliveries.availableAt, now)
  ),
  and(
    eq(notificationDeliveries.state, "leased"),
    lte(notificationDeliveries.leaseExpiresAt, now)
  )
)
```

Keep the existing transaction, ordering, `FOR UPDATE SKIP LOCKED`, attempt increment, lease owner replacement, and returning row.

- [ ] **Step 4: Run repository and worker tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/notification-repositories.integration.test.ts
pnpm exec vitest run --project unit apps/worker/src/notification-worker.unit.test.ts
```

Expected: PASS; exactly one worker reclaims the row and idempotent delivery remains enforced by the existing unique key.

- [ ] **Step 5: Commit lease recovery**

```bash
git add packages/db/src/postgres/worker-queue.ts packages/db/src/postgres/notification-repositories.integration.test.ts apps/worker/src/notification-worker.unit.test.ts
git commit -m "fix: recover expired notification leases"
```

### Task 5: Implement Bounded Ephemeral Cleanup

**Files:**
- Create: `packages/db/src/postgres/ephemeral-cleanup.ts`
- Create: `packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`
- Modify: `apps/worker/src/maritime-scheduler.unit.test.ts`

**Interfaces:**
- Consumes: `{ now: string; batchSize: number }` and canonical PostgreSQL connection.
- Produces: `SystemEphemeralCleanupRepository.cleanup(input): Promise<EphemeralCleanupResult>` with fixed count fields.

- [ ] **Step 1: Define and test the cleanup contract**

```ts
export interface EphemeralCleanupResult {
  readonly gmailOauthStatesDeleted: number;
  readonly dispatchesExpired: number;
  readonly heartbeatsDeleted: number;
  readonly scheduleRunsDeleted: number;
}

export interface SystemEphemeralCleanupRepository {
  cleanup(input: { readonly now: string; readonly batchSize: number }): Promise<EphemeralCleanupResult>;
}
```

Write fixtures on both sides of these exact retention cutoffs:

- Gmail OAuth state: delete only consumed or expired rows whose `expires_at < now - 24 hours`.
- Maritime dispatch: transition `pending_wake` or `accepted` to `expired` when `expires_at <= now`; do not delete it in founder release.
- Service heartbeat: delete rows whose `expires_at < now - 7 days`.
- Terminal production schedule run: delete only rows completed before `now - 30 days`.
- Never touch users, integrations, credentials, raw listings, source records, canonical listings, source jobs, or activity events.

- [ ] **Step 2: Run the cleanup integration test and confirm the missing implementation**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`

Expected: FAIL because the cleanup repository does not exist.

- [ ] **Step 3: Implement bounded CTE operations**

Use parameterized SQL and a shared `batchSize` constrained to `1..1000`. Each delete uses `ctid` selected in deterministic order and limited to the batch. The dispatch update is:

```sql
WITH candidates AS (
  SELECT ctid
  FROM maritime_dispatches
  WHERE state IN ('pending_wake', 'accepted') AND expires_at <= $1::timestamptz
  ORDER BY expires_at, user_id, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE maritime_dispatches AS target
SET state = 'expired', updated_at = $1::timestamptz
FROM candidates
WHERE target.ctid = candidates.ctid;
```

Use equivalent bounded CTE deletes for the other three tables. Return `rowCount` only; do not return deleted record content.

- [ ] **Step 4: Wire only the `ephemeral_cleanup` schedule kind**

In `apps/worker/src/postgres-runtime.ts`:

```ts
if (schedule.kind === "ephemeral_cleanup") {
  await ephemeralCleanup.cleanup({ now: now().toISOString(), batchSize: 500 });
  return { status: "completed" };
}
```

Construct the system cleanup repository once per worker runtime. A cleanup failure must return `retryable_failed` with safe code `ephemeral_cleanup_failed`; it must not mark unrelated jobs complete.

- [ ] **Step 5: Run cleanup and scheduler tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm exec vitest run --project postgres-integration packages/db/src/postgres/ephemeral-cleanup.integration.test.ts
pnpm exec vitest run --project unit apps/worker/src/maritime-scheduler.unit.test.ts
```

Expected: PASS; repeated cleanup returns zero counts, preserves immutable/domain tables, and concurrent cleanup does not process a row twice.

- [ ] **Step 6: Commit cleanup**

```bash
git add packages/db/src/postgres/ephemeral-cleanup.ts packages/db/src/postgres/ephemeral-cleanup.integration.test.ts packages/db/src/repositories.ts packages/db/src/index.ts apps/worker/src/postgres-runtime.ts apps/worker/src/maritime-scheduler.unit.test.ts
git commit -m "feat: clean expired execution metadata safely"
```

### Task 6: Add Fixed-Cardinality Worker Metrics and Endpoint Tests

**Files:**
- Create: `apps/worker/src/metrics.ts`
- Create: `apps/worker/src/metrics.unit.test.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/src/service-server.ts`
- Modify: `apps/worker/src/service-server.unit.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: worker lane, closed outcome, monotonic duration, and readiness observation.
- Produces: `WorkerMetrics.observeJob(lane, outcome, durationMs)`, `setReadiness(ready)`, and `render()`.

- [ ] **Step 1: Write deterministic metrics tests**

```ts
it("renders fixed labels and excludes identifiers", () => {
  const metrics = createWorkerMetrics();
  metrics.observeJob("acquisition", "completed", 125);
  metrics.observeJob("acquisition", "manual_action_required", 40);
  metrics.setReadiness(true);
  const output = metrics.render();
  expect(output).toContain('vera_worker_jobs_total{lane="acquisition",outcome="completed"} 1');
  expect(output).toContain("vera_worker_ready 1");
  expect(output).not.toMatch(/user|job_id|listing|email|phone|payload_hash/iu);
});
```

Test that invalid dynamic labels cannot compile by accepting only these exact lane values: `schedule`, `acquisition`, `normalization`, `decision`, `notification`, `health`; outcomes are mapped into `idle`, `completed`, `deferred`, `manual_action_required`, `retryable_failed`, `permanently_failed`, `cancelled_by_policy`, and `other`.

- [ ] **Step 2: Run and confirm the missing metrics module**

Run: `pnpm exec vitest run --project unit apps/worker/src/metrics.unit.test.ts apps/worker/src/service-server.unit.test.ts`

Expected: FAIL because the metrics module and `/metrics` endpoint do not exist.

- [ ] **Step 3: Implement counters and bounded duration buckets**

```ts
const buckets = [10, 50, 100, 250, 500, 1_000, 5_000, 15_000, 30_000] as const;

export interface WorkerMetrics {
  observeJob(lane: WorkerLane, outcome: WorkerMetricOutcome, durationMilliseconds: number): void;
  setReadiness(ready: boolean): void;
  render(): string;
}
```

Store a map initialized only from the Cartesian product of the closed lane/outcome enums. Clamp negative/non-finite durations to `0` and values above `60_000` to `60_000`. Render deterministic OpenMetrics text ending with `# EOF\n`. Add no dependency.

- [ ] **Step 4: Observe jobs in the CLI and expose private metrics**

Wrap `normalizationRuntime.processNext(signal)` with `performance.now()` and map the returned status to the closed metric outcome. Pass `metrics: () => metrics.render()` into `createWorkerServiceServer`.

Add exact GET behavior:

```ts
if (request.url === "/metrics" && options.metrics) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/openmetrics-text; version=1.0.0; charset=utf-8");
  response.end(options.metrics());
  return;
}
```

Keep non-GET as `405`, unknown paths as `404`, and exception bodies as `{ "status": "not_ready" }` only.

Document and wire these founder-staging alert thresholds without adding user-controlled labels:

- readiness remains not-ready for two consecutive checks or five minutes;
- worker heartbeat is stale for more than two minutes;
- OpenClaw gateway is unavailable for more than two minutes;
- oldest runnable queue item exceeds ten minutes;
- any dead-letter or permanently failed job fires immediately;
- OAuth failures, provider rate limits, or notification failures each reach three events in fifteen minutes;
- PostgreSQL pool waiters remain above zero for five minutes or connection failures reach three in five minutes;
- backup or restore rehearsal failure fires immediately.

Metrics expose only the fixed state/count inputs required for those alerts. Provider-specific alert routing is configured in Maritime/operator infrastructure and must be evidenced before founder staging.

- [ ] **Step 5: Use a real ephemeral port in server tests**

Start the server on port `0`, read `server.address()`, and test:

```ts
expect(await fetch(`${origin}/health`).then((response) => response.status)).toBe(200);
expect(await fetch(`${origin}/ready`).then((response) => response.status)).toBe(503);
expect(await fetch(`${origin}/metrics`).then((response) => response.text())).toContain("vera_worker_ready");
expect(await fetch(`${origin}/unknown`).then((response) => response.status)).toBe(404);
expect(await fetch(`${origin}/health`, { method: "POST" }).then((response) => response.status)).toBe(405);
```

Assert every response body is free of environment values matching `DATABASE_URL`, `MARITIME_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`, and `VERA_CREDENTIAL_KEYS_JSON`.

- [ ] **Step 6: Run worker tests**

Run: `pnpm exec vitest run --project unit apps/worker/src/metrics.unit.test.ts apps/worker/src/service-server.unit.test.ts apps/worker/src/cli.unit.test.ts`

Expected: PASS; labels remain fixed and denial responses expose no secrets.

- [ ] **Step 7: Commit observability**

```bash
git add apps/worker/src/metrics.ts apps/worker/src/metrics.unit.test.ts apps/worker/src/cli.ts apps/worker/src/service-server.ts apps/worker/src/service-server.unit.test.ts apps/worker/src/index.ts
git commit -m "feat: expose bounded worker metrics"
```

### Task 7: Add an Executable Backup and Restore Rehearsal

**Files:**
- Create: `scripts/postgres-backup-rehearsal.ts`
- Create: `scripts/postgres-backup-rehearsal.unit.test.ts`
- Modify: `package.json`
- Modify: `docs/POSTGRES_OPERATIONS.md`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL` whose database name is exactly `vera_test`, installed PostgreSQL client tools, and an explicit `--confirm vera_test` flag.
- Produces: a temporary custom-format backup, restored temporary database, schema/count verification, and guaranteed scoped cleanup.

- [ ] **Step 1: Test target validation without spawning database tools**

```ts
it.each([
  ["postgresql://vera:secret@db.example.test/production", "vera_test"],
  ["postgresql://vera:secret@127.0.0.1:5432/vera_test", "wrong-confirmation"]
])("rejects an unsafe rehearsal target", (url, confirmation) => {
  expect(() => validateBackupRehearsalTarget(url, confirmation)).toThrow("Backup rehearsal requires the exact vera_test database and confirmation.");
});

it("returns a redacted diagnostic label", () => {
  expect(redactedDatabaseLabel("postgresql://vera:secret@127.0.0.1:5432/vera_test")).toBe("127.0.0.1:5432/vera_test");
});
```

- [ ] **Step 2: Run and confirm the missing script failure**

Run: `pnpm exec vitest run --project unit scripts/postgres-backup-rehearsal.unit.test.ts`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the scoped rehearsal**

The script must:

1. Validate exact source database `vera_test` and `--confirm vera_test`.
2. Create a temp directory with `mkdtemp` under the OS temp directory.
3. Generate a random target name matching `vera_restore_rehearsal_[a-f0-9]{16}`.
4. Run the following argument-array call, never a shell string:

   ```ts
   checkedSpawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpPath, sourceUrl]);
   ```

5. Create the generated target with:

   ```ts
   checkedSpawn("createdb", ["--maintenance-db", adminUrl, targetName]);
   ```

6. Restore with:

   ```ts
   checkedSpawn("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", targetUrl, dumpPath]);
   ```
7. Query the restored database with the existing `pg` driver and assert migrations are current, append-only triggers exist, tenant composite foreign keys exist, encrypted integration/Web Push byte fields match source counts, and private table counts match source.
8. In `finally`, run `checkedSpawn("dropdb", ["--if-exists", "--maintenance-db", adminUrl, targetName])` and remove the temp directory.
9. Print only the redacted host/database label and safe counts; never print URLs, commands containing URLs, or row contents.

- [ ] **Step 4: Add the command and run local unit tests**

Add:

```json
"postgres:backup-rehearsal": "tsx scripts/postgres-backup-rehearsal.ts --confirm vera_test"
```

Run: `pnpm exec vitest run --project unit scripts/postgres-backup-rehearsal.unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the real local rehearsal**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm postgres:backup-rehearsal
```

Expected: exit `0`, safe restored counts, and confirmation that the temporary database was removed. If PostgreSQL client tools are absent, install the official PostgreSQL 18 client before retrying; do not weaken the rehearsal.

- [ ] **Step 6: Commit backup verification**

```bash
git add scripts/postgres-backup-rehearsal.ts scripts/postgres-backup-rehearsal.unit.test.ts package.json docs/POSTGRES_OPERATIONS.md
git commit -m "feat: verify PostgreSQL backup restoration"
```

### Task 8: Publish the Privacy Inventory and Founder Lifecycle Runbook

**Files:**
- Create: `docs/PRIVACY_OPERATIONS.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/GOOGLE_INTEGRATION_SETUP.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: actual table/schema inventory, browser transit path, Google disconnect implementation, cleanup cutoffs, and backup behavior.
- Produces: one normative data inventory and operator-assisted founder workflow.

- [ ] **Step 1: Write the inventory with exact retention classes**

Use this table as the normative baseline:

```markdown
| Data class | Examples | Location | Transit | Founder retention | Delete/revoke behavior |
| --- | --- | --- | --- | --- | --- |
| Identity/session | Vera user ID, session rows | PostgreSQL | Browser ↔ Vera web | While account is active; expired sessions follow auth-library cleanup | Operator-assisted account deletion; revoke sessions first |
| Search/listing evidence | Profiles, raw listing text, source records, provenance, canonical listings | PostgreSQL | Approved connector/browser → worker → PostgreSQL | While search/account is active | Included in export; deletion requires audited account workflow |
| Browser-local secrets | Marketplace cookies, passwords, profile storage | Founder device only | Never intentionally sent to Vera/Maritime | Controlled by founder's browser profile | Revoke node, sign out, delete local profile manually |
| Browser capture content | Minimal selected page evidence | Node → OpenClaw gateway → worker; accepted evidence in PostgreSQL | TLS gateway path | Same as listing evidence | No screenshots/snapshots/cookies persisted by default |
| Google credential material | Encrypted refresh token envelope, scopes, expiry | PostgreSQL ciphertext; keys in server secret store | Google ↔ Vera server | Until disconnect/revocation/account deletion | Revoke Google grant, erase ciphertext, retain safe audit metadata |
| Gmail alert reference | Message ID, history cursor, minimal parsed listing facts | PostgreSQL | Gmail API → worker | While alert integration/search is active | Disconnect stops reads; operator deletion removes references with account |
| Calendar availability | Free/busy-derived status, checked IDs/time, Vera windows | PostgreSQL | Google free/busy → Vera server | While viewing workflow is active | No event details retained; disconnect stops checks |
| Execution control | Jobs, attempts, dispatch hashes, leases, node health | PostgreSQL | Web/worker/Maritime | Durable job/audit history; ephemeral rows use explicit cleanup windows | Kill switch/cancel/revoke; cleanup only short-lived control rows |
| Notifications | Encrypted Web Push subscription, generic payload, delivery state | PostgreSQL | Worker → push service | Until revoke/disable; delivery history per founder policy | Revoke subscription and erase encrypted endpoint material |
| Logs/metrics | Correlation IDs, fixed status codes/counts | Maritime/log provider | Server/worker → operator systems | 14 days for founder staging | Access-controlled deletion by log provider; no raw content/secrets |
| Backups | Encrypted database snapshots/custom dump | Managed PostgreSQL / protected backup store | Database → backup store | 30 daily snapshots for founder staging | Expire by provider policy; deletion requests age out through documented window |
```

If actual provider settings cannot enforce `14` and `30` days, mark that as an operational release blocker instead of claiming compliance.

- [ ] **Step 2: Document founder export, deletion, and disconnect procedures**

The workflow must identify the exact Vera user UUID from the authenticated account, stop schedules and browser controls, revoke the OpenClaw node, disconnect Google (provider revocation first, ciphertext deletion always), revoke Web Push, export the tenant-owned tables into an encrypted operator artifact, record safe counts and hashes, and require a second-person or delayed self-check before destructive account deletion. State that append-only audit guarantees apply during normal operation; an approved privacy deletion removes the account under a separately reviewed maintenance procedure.

Do not add a generic SQL cascade command to the runbook. The founder-release outcome remains conditional until the operator has rehearsed the workflow on sanitized staging data.

Document two PostgreSQL roles: a migration role allowed to apply reviewed Drizzle DDL and a runtime role with only the table/sequence privileges needed by Vera. The runtime role must not be superuser, own the database, bypass row-level security, create extensions, or execute DDL. Founder operations may temporarily bind the migration credential to `DATABASE_URL` only for `pnpm db:migrate`; web and worker retain the runtime credential.

State the audit limitation precisely: append-only triggers prevent normal application mutation, but a database owner or superuser can bypass or remove them. Managed-database administrative access, migration review, backup retention, and provider audit logs are therefore part of the evidence chain.

- [ ] **Step 3: Document provider outage and incident containment**

Include exact responses:

- Google outage: stop Gmail polling, show Calendar fallback warning, never treat timeout as empty mailbox/calendar.
- Maritime outage: retain queued canonical job state, no local web cron replacement, retry only safe wake failures.
- OpenClaw outage: set gateway unavailable or node deferred, create no empty success result.
- PostgreSQL outage: liveness may remain up; readiness fails; no in-memory write fallback.
- Suspected credential disclosure: activate global integrations/browser/notification kill switches, revoke affected provider grant/token, rotate keys, preserve safe audit evidence, and do not paste raw logs into tickets.

- [ ] **Step 4: Update audit statuses honestly**

Mark `SEC-009` resolved after Task 1, `SEC-010` resolved for founder staging after Task 4, and `SEC-011` resolved after this task. Add a separate medium finding stating self-service export/deletion is absent and is a blocker for multi-user beta, not founder staging.

- [ ] **Step 5: Verify terminology and claims**

Run:

```bash
rg -n "password|cookie|profile|page content|PostgreSQL|Maritime|OpenClaw|retention|export|deletion|revocation|backup|runtime role|migration role|audit|alert|founder staging|multi-user beta" docs/PRIVACY_OPERATIONS.md docs/SECURITY.md docs/POSTGRES_OPERATIONS.md docs/GOOGLE_INTEGRATION_SETUP.md
```

Expected: every boundary and lifecycle term appears with an explicit location, transit, retention, and action.

- [ ] **Step 6: Commit privacy operations**

```bash
git add docs/PRIVACY_OPERATIONS.md docs/SECURITY.md docs/DATA_MODEL.md docs/GOOGLE_INTEGRATION_SETUP.md docs/POSTGRES_OPERATIONS.md docs/SECURITY_REVIEW.md
git commit -m "docs: define founder privacy operations"
```

### Task 9: Run PostgreSQL and Reliability Acceptance

**Files:**
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`

**Interfaces:**
- Consumes: Tasks 1 through 8.
- Produces: local PostgreSQL evidence and remaining live-release blockers.

- [ ] **Step 1: Start and migrate the exact local PostgreSQL service**

Run:

```bash
pnpm postgres:up
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:migrate
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:seed
```

Expected: PostgreSQL 18.4 reports healthy, five migrations are current, and seed output contains only policy counts.

- [ ] **Step 2: Run all persistence-sensitive tests**

Run:

```bash
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres
pnpm postgres:backup-rehearsal
pnpm verify:db-boundaries
```

Expected: PASS; backup rehearsal removes its temporary database and boundary verifier confirms hosted entry points do not import demo SQLite.

- [ ] **Step 3: Run affected unit and build gates**

Run:

```bash
pnpm test:unit
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits `0` with no external provider call.

- [ ] **Step 4: Record evidence and preserve live blockers**

Add exact command timestamps/results to `docs/SECURITY_REVIEW.md`. Do not mark `SEC-002`, `SEC-003`, `SEC-004`, or `SEC-012` resolved; those belong to the Maritime/OpenClaw live-release plan.

- [ ] **Step 5: Commit the reliability closeout**

```bash
git add docs/SECURITY_REVIEW.md docs/POSTGRES_OPERATIONS.md
git commit -m "docs: record PostgreSQL reliability evidence"
```
