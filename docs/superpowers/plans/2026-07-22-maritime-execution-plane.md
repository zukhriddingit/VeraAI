# Maritime Execution Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Maritime Vera's primary production worker/scheduling plane, upgrade the hosted OpenClaw path to patched `2026.6.33`, add narrow scheduled Gmail alert ingestion, and deliver privacy-preserving browser Web Push notifications while PostgreSQL remains canonical.

**Architecture:** Hosted Vera writes tenant-owned jobs, dispatch envelopes, schedules, and deliveries to PostgreSQL. A server-only Maritime SDK adapter wakes and observes one Maritime worker; the worker consumes one-time dispatches, reconciles Maritime-triggered schedules, and reaches the selected local browser node only through the pinned gateway. Gmail and Web Push sit behind provider-neutral contracts, strict schemas, fail-closed policy, idempotent repositories, and no-network mocks.

**Tech Stack:** Node 24 LTS, pnpm 11.14.0, TypeScript 6 strict mode, Next.js 16 App Router, PostgreSQL 18/Drizzle, Zod 4, `maritime-sdk@0.5.0`, `openclaw@2026.6.33`, `web-push@3.6.7`, Vitest 4, Playwright 1.61.

## Global Constraints

- Maritime is required in production but default tests must never call Maritime, OpenClaw, Google, or Web Push.
- PostgreSQL is the only hosted source of truth; `@vera/db/demo` remains an isolated sanitized SQLite composition.
- Use `ghcr.io/openclaw/openclaw:2026.6.33`; never deploy or restore `2026.5.28`.
- Application runtime may use `maritime-sdk@0.5.0`; CLI `1.7.0` is operator-only and is never spawned by HTTP handlers.
- Marketplace passwords, cookies, profiles, storage, raw snapshots, OAuth tokens, Push subscription secrets, and raw Gmail messages never enter jobs, logs, audit, health output, or client bundles.
- Scheduled browser monitoring remains disabled. Existing Zillow current-tab capture remains manual, founder-only, and fail-closed.
- Gmail uses `gmail.readonly` only when intentionally enabled. No Gmail send, compose, modify, SMTP, deletion, labeling, or forwarding is added.
- Notification lock-screen copy is generic and contains no address, price, description, contact, or risk evidence.
- Every new private row is tenant-owned and every private repository method requires its bound user.
- Preserve the dirty worktree. Stage or commit only newly created planning/deployment files when safe; do not absorb unrelated pre-existing changes.

---

### Task 1: Pin dependencies and freeze platform boundaries

**Files:**
- Modify: `packages/connectors/package.json`
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `.env.example`
- Test: `scripts/verify-maritime-boundaries.unit.test.ts`
- Create: `scripts/verify-maritime-boundaries.ts`

**Interfaces:**
- Consumes: current workspace dependency conventions and existing browser-boundary verifier.
- Produces: exact dependency pins and one static verifier callable as `pnpm verify:maritime-boundaries`.

- [ ] **Step 1: Write the failing version and secret-boundary tests**

```ts
expect(connectors.dependencies?.["maritime-sdk"]).toBe("0.5.0");
expect(notifications.dependencies?.["web-push"]).toBe("3.6.7");
expect(workspaceText).not.toMatch(/openclaw:(?:latest|2026\.5\.28)/u);
expect(runtimeSources).not.toMatch(/spawn\([^)]*maritime|exec\([^)]*maritime/u);
expect(clientSources).not.toMatch(/MARITIME_API_KEY|VAPID_PRIVATE|OPENCLAW_GATEWAY_TOKEN/u);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `./node_modules/.bin/vitest run --project unit scripts/verify-maritime-boundaries.unit.test.ts`  
Expected: FAIL because the verifier/package pins do not exist and `2026.5.28` is still present.

- [ ] **Step 3: Add exact packages and environment names**

Add `maritime-sdk: "0.5.0"` to `@vera/connectors`; create `@vera/notifications` with `web-push: "3.6.7"`, `zod: "4.4.3"`, `@vera/domain`, and `@types/web-push: "3.6.4"`. Add only names/purposes for `MARITIME_API_KEY`, worker/gateway agent IDs, deployment environment, operator IDs, VAPID keys/subject, notification kill switch, and staging flags. No values are committed.

- [ ] **Step 4: Install with the committed package manager and inspect the lockfile**

Run: `CI=1 corepack pnpm install --no-frozen-lockfile`  
Expected: lockfile contains exact Maritime/Web Push packages and no OpenClaw workspace dependency.

- [ ] **Step 5: Run the verifier test**

Run: `./node_modules/.bin/vitest run --project unit scripts/verify-maritime-boundaries.unit.test.ts`  
Expected: PASS.

### Task 2: Add strict orchestration, Gmail, notification, and operations contracts

**Files:**
- Create: `packages/domain/src/maritime.ts`
- Create: `packages/domain/src/gmail.ts`
- Create: `packages/domain/src/notifications.ts`
- Create: `packages/domain/src/operations-api.ts`
- Modify: `packages/domain/src/source-orchestration.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/maritime.unit.test.ts`
- Test: `packages/domain/src/gmail.unit.test.ts`
- Test: `packages/domain/src/notifications.unit.test.ts`
- Test: `packages/domain/src/operations-api.unit.test.ts`

**Interfaces:**
- Consumes: `EntityIdSchema`, `VeraUserIdSchema`, `IsoDateTimeSchema`, `JsonValueSchema`, `SourceJobSchema`, and existing safe-error vocabularies.
- Produces: `MaritimeDispatch`, `ProductionSchedule`, `ProductionScheduleRun`, `ServiceHeartbeat`, `GmailAlertCursor`, `NotificationPreference`, `WebPushSubscriptionRecord`, `NotificationDelivery`, and operations read schemas.

- [ ] **Step 1: Write schema rejection and lifecycle tests**

```ts
expect(() => MaritimeDispatchSchema.parse({ ...validDispatch, issuer: "attacker" })).toThrow();
expect(() => MaritimeDispatchSchema.parse({ ...validDispatch, nonceHash: "raw-nonce" })).toThrow();
expect(() => MaritimeDispatchSchema.parse({ ...validDispatch, payload: { cookie: "secret" } })).toThrow();
expect(transitionMaritimeDispatch(validDispatch, "accepted", NOW).state).toBe("accepted");
expect(() => transitionMaritimeDispatch(validDispatch, "consumed", NOW)).toThrow();
expect(NotificationPayloadSchema.parse({
  title: "Vera found a new match",
  body: "Open Vera to review a new listing.",
  deepLink: "/listings/listing-1"
})).toBeTruthy();
expect(() => NotificationPayloadSchema.parse({ ...safePayload, body: "12 Main St for $2,000" })).toThrow();
```

- [ ] **Step 2: Run the four domain test files**

Run: `./node_modules/.bin/vitest run --project unit packages/domain/src/{maritime,gmail,notifications,operations-api}.unit.test.ts`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement exact state vocabularies and schemas**

```ts
export const MaritimeDispatchStateSchema = z.enum([
  "pending_wake", "accepted", "consumed", "expired", "rejected"
]);
export const MaritimeDispatchIdentitySchema = z.object({
  issuer: z.literal("vera-control-plane"),
  audience: EntityIdSchema,
  nonceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema
}).strict();
export const ProductionScheduleKindSchema = z.enum([
  "gmail_alert_ingestion", "normalization_reconciliation", "decision_reconciliation",
  "stale_listing_check", "notification_fanout", "health_reconciliation", "ephemeral_cleanup"
]);
export const NotificationDeliveryStateSchema = z.enum([
  "queued", "leased", "deferred_quiet_hours", "deferred_rate_limit",
  "delivered", "retryable_failed", "permanently_failed", "cancelled_by_policy"
]);
export const GmailAlertExternalReferenceSchema = z.object({
  messageId: z.string().min(1).max(256),
  historyId: z.string().regex(/^\d+$/u).nullable()
}).strict();
```

The dispatch transition function permits `pending_wake -> accepted|expired|rejected` and `accepted -> consumed|expired|rejected`; all terminal states are idempotent only for the same state. Every schema is strict and forbids free-form secret-bearing metadata.

- [ ] **Step 4: Run domain tests and the existing orchestration suite**

Run: `./node_modules/.bin/vitest run --project unit packages/domain/src/{maritime,gmail,notifications,operations-api,source-orchestration}.unit.test.ts`  
Expected: PASS.

### Task 3: Add the additive PostgreSQL migration and tenant repositories

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `packages/db/src/postgres/row-mappers.ts`
- Create: `packages/db/src/postgres/maritime-repositories.ts`
- Create: `packages/db/src/postgres/notification-repositories.ts`
- Create: `packages/db/src/postgres/gmail-repositories.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/drizzle/0003_maritime_execution_plane.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0003_snapshot.json`
- Test: `packages/db/src/postgres/maritime-repositories.integration.test.ts`
- Test: `packages/db/src/postgres/notification-repositories.integration.test.ts`
- Test: `packages/db/src/postgres/gmail-repositories.integration.test.ts`
- Modify: `packages/db/src/postgres/migrations.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas and `UserRepositoryProvider`/`SystemWorkerQueue` patterns.
- Produces: tenant repositories plus system claim methods for dispatches and notification deliveries.

- [ ] **Step 1: Write PostgreSQL tests for constraints, encryption, claims, rollback, and replay**

```ts
await expect(userA.maritimeDispatches.create(dispatchForUserB)).rejects.toThrow(); // cross-user dispatch
await expect(userA.maritimeDispatches.create(validDispatch)).resolves.toBeTruthy();
await expect(userA.maritimeDispatches.create(validDispatch)).rejects.toMatchObject({ code: "unique_violation" });
expect(await Promise.all([queue.claimNextNotificationDelivery(leaseA), queue.claimNextNotificationDelivery(leaseB)]))
  .toHaveLength(2);
expect(JSON.stringify(await rawSubscriptionRow())).not.toContain("https://push.example.test/subscription");
```

- [ ] **Step 2: Run the PostgreSQL tests and verify missing tables fail**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test ./node_modules/.bin/vitest run --project postgres-integration packages/db/src/postgres/{maritime,notification,gmail}-repositories.integration.test.ts`  
Expected: FAIL on missing repositories/tables.

- [ ] **Step 3: Implement tables and repositories**

Add tenant-owned tables named `maritime_dispatches`, `production_schedules`, `production_schedule_runs`, `notification_preferences`, `web_push_subscriptions`, `notification_deliveries`, `notification_digest_items`, `gmail_oauth_states`, `gmail_alert_cursors`, and `gmail_alert_external_references`; add global `maritime_deployments` and `service_heartbeats`. Use `timestamptz`, `jsonb` only for closed structured projections, UUID user foreign keys, composite ownership FKs, hash checks, unique idempotency keys, constrained states, and lease-pair checks.

Expose these exact repository properties on `UserRepositories`:

```ts
readonly maritimeDispatches: AsyncRepository<MaritimeDispatchRepository>;
readonly productionSchedules: AsyncRepository<ProductionScheduleRepository>;
readonly notificationPreferences: AsyncRepository<NotificationPreferenceRepository>;
readonly webPushSubscriptions: AsyncRepository<WebPushSubscriptionRepository>;
readonly notificationDeliveries: AsyncRepository<NotificationDeliveryRepository>;
readonly gmailOAuthStates: AsyncRepository<GmailOAuthStateRepository>;
readonly gmailAlertCursors: AsyncRepository<GmailAlertCursorRepository>;
```

Extend `SystemWorkerQueue` with claims that return `{ userId, record }` and use `FOR UPDATE SKIP LOCKED`.

- [ ] **Step 4: Upgrade the OpenClaw constraint without resetting rows**

The migration drops only `browser_nodes_expected_version_pinned`, updates `expected_openclaw_version` to `2026.6.33`, sets `version_compatibility='unknown'`, recreates the exact check, and preserves all node/profile/job/acceptance rows.

- [ ] **Step 5: Run migration and repository tests**

Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test ./node_modules/.bin/vitest run --project postgres-integration packages/db/src/postgres/{migrations,maritime-repositories,notification-repositories,gmail-repositories}.integration.test.ts`  
Expected: PASS with additive migration, tenant isolation, concurrency, encryption, and rollback assertions.

### Task 4: Implement the production Maritime adapter

**Files:**
- Create: `packages/connectors/src/maritime-client.ts`
- Create: `packages/connectors/src/maritime-client.unit.test.ts`
- Create: `packages/connectors/src/production-maritime-orchestrator.ts`
- Create: `packages/connectors/src/production-maritime-orchestrator.unit.test.ts`
- Modify: `packages/connectors/src/maritime-orchestrator.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Consumes: `maritime-sdk@0.5.0`, Task 2 dispatch schemas, Task 3 repositories, policy registry, and current mock contract.
- Produces: `MaritimeControlPlaneClient`, `SdkMaritimeControlPlaneClient`, and `ProductionMaritimeOrchestrator`.

- [ ] **Step 1: Write client error-mapping and no-payload tests**

```ts
await expect(client.wake("worker-agent", signal)).rejects.toMatchObject({ code: "maritime_rate_limited", retryable: true });
expect(fakeSdk.start).toHaveBeenCalledWith("worker-agent");
expect(JSON.stringify(fakeSdk.calls)).not.toMatch(/listing|cookie|oauth|snapshot|refresh_token/iu);
expect(await orchestrator.dispatchJob(job.id)).toMatchObject({ status: "dispatched" });
```

- [ ] **Step 2: Run focused connector tests**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{maritime-client,production-maritime-orchestrator,maritime-orchestrator}.unit.test.ts`  
Expected: FAIL for missing production modules.

- [ ] **Step 3: Implement the SDK wrapper and orchestration flow**

Construct `new Maritime({ apiKey, timeout: 10_000, maxRetries: 0 })`. Validate agent/status/log responses through local Zod schemas. Create dispatch intent before wake; call only `agents.start/get/logs`; accept dispatch after wake; never call provision, delete, env mutation, chat, or webhook methods at runtime. Recheck current policy immediately before accepting a dispatch.

- [ ] **Step 4: Run connector tests**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{maritime-client,production-maritime-orchestrator,maritime-orchestrator}.unit.test.ts`  
Expected: PASS, including auth/config/rate-limit/unavailable and replay-safe wake behavior.

### Task 5: Add schedule reconciliation, dispatch consumption, and worker HTTP health

**Files:**
- Create: `apps/worker/src/maritime-scheduler.ts`
- Test: `apps/worker/src/maritime-scheduler.unit.test.ts`
- Create: `apps/worker/src/service-server.ts`
- Test: `apps/worker/src/service-server.unit.test.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`
- Modify: `apps/worker/src/decision-runtime.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/build.mjs`
- Modify: `packages/db/src/postgres/worker-queue.ts`
- Test: `packages/db/src/postgres/worker-queue.integration.test.ts`

**Interfaces:**
- Consumes: accepted dispatch/schedule repositories and existing rotating worker runtime.
- Produces: one due-schedule reconciler, single-use dispatch consumer, service heartbeat, `/health`, and `/ready`.

- [ ] **Step 1: Write tests for duplicate ticks, expired leases, policy cancellation, and health secrecy**

```ts
expect(await reconcileDueSchedules(deps, NOW)).toEqual({ created: 1, replayed: 0, denied: 0 });
expect(await reconcileDueSchedules(deps, NOW)).toEqual({ created: 0, replayed: 1, denied: 0 });
expect(await consumeDispatch({ ...valid, audience: "wrong-agent" })).toMatchObject({ status: "rejected" });
expect(JSON.stringify(await request(server, "/health"))).not.toMatch(/DATABASE_URL|token|secret|cookie/iu);
```

- [ ] **Step 2: Run worker and queue tests**

Run: `./node_modules/.bin/vitest run --project unit apps/worker/src/{maritime-scheduler,service-server}.unit.test.ts`  
Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement the runtime rotation**

Add `schedule`, `notification`, and `health_reconciliation` work kinds to the existing bounded rotation without starving acquisition/normalization/decision work. Production source-job claims require an accepted, unexpired, unconsumed dispatch. Worker startup requires `VERA_MARITIME_WORKER_AGENT_ID` and records the same value as dispatch audience.

- [ ] **Step 4: Implement HTTP liveness/readiness**

Bind `PORT` or `8080` on `0.0.0.0` only in the Maritime `serve` command. `/health` returns process metadata without database I/O; `/ready` checks PostgreSQL and migration readiness. Start polling and HTTP server in one lifecycle and close both plus the pool on SIGTERM/SIGINT.

- [ ] **Step 5: Run worker and PostgreSQL queue tests**

Run: `./node_modules/.bin/vitest run --project unit apps/worker/src/{maritime-scheduler,service-server,cli,decision-runtime}.unit.test.ts`  
Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test ./node_modules/.bin/vitest run --project postgres-integration packages/db/src/postgres/worker-queue.integration.test.ts`  
Expected: PASS.

### Task 6: Upgrade OpenClaw and add continuous node reconciliation

**Files:**
- Modify: `packages/connectors/src/openclaw-cli.ts`
- Modify: `packages/connectors/src/openclaw-browser-execution.ts`
- Modify: `packages/connectors/src/openclaw-browser-execution.unit.test.ts`
- Modify: `packages/connectors/src/openclaw-current-tab.live.test.ts`
- Create: `packages/connectors/src/openclaw-node-health.ts`
- Test: `packages/connectors/src/openclaw-node-health.unit.test.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`
- Modify: `scripts/openclaw-register-node.ts`
- Modify: `scripts/verify-browser-boundaries.ts`
- Modify: `docs/OPENCLAW_FOUNDER_SETUP.md`

**Interfaces:**
- Consumes: exact OpenClaw 2026.6.33 CLI surface and existing browser provider.
- Produces: exact-version adapter plus `OpenClawNodeHealthProvider` using only `nodes status` and `nodes describe`.

- [ ] **Step 1: Change tests to require `2026.6.33` and reject broader commands**

```ts
expect(PINNED_OPENCLAW_VERSION).toBe("2026.6.33");
expect(commandCalls.map((call) => call.command)).toEqual(["nodes", "status", "nodes", "describe"]);
expect(serializedCalls).not.toMatch(/system\.run|camera|screen|location|notify|navigate|click|type/iu);
```

- [ ] **Step 2: Run OpenClaw tests and confirm the old pin fails**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{openclaw-browser-execution,openclaw-node-health}.unit.test.ts scripts/verify-browser-boundaries.unit.test.ts`  
Expected: FAIL on `2026.5.28` and missing health provider.

- [ ] **Step 3: Implement exact version and bounded health parsing**

Keep `shell:false`, minimal environment, byte/time limits, redacted errors, and fixed argument arrays. Node reconciliation accepts only the configured node ID and required `browser.proxy` capability, then writes safe pairing/capability/version/heartbeat projection through the user's repository.

- [ ] **Step 4: Run OpenClaw boundary tests**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{openclaw-browser-execution,openclaw-node-health}.unit.test.ts scripts/verify-browser-boundaries.unit.test.ts`  
Expected: PASS with no live gateway.

### Task 7: Implement narrow scheduled Gmail alert ingestion

**Files:**
- Create: `packages/connectors/src/gmail-client.ts`
- Create: `packages/connectors/src/gmail-client.unit.test.ts`
- Create: `packages/connectors/src/gmail-alert-connector.ts`
- Create: `packages/connectors/src/gmail-alert-connector.unit.test.ts`
- Create: `packages/testing/src/gmail-alert-fixtures.ts`
- Modify: `packages/testing/src/index.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.unit.test.ts`
- Create: `apps/web/app/api/integrations/google/gmail/authorize/route.ts`
- Create: `apps/web/app/api/integrations/google/gmail/callback/route.ts`
- Create: `apps/web/app/api/integrations/google/gmail/routes.integration.test.ts`
- Modify: `apps/web/app/settings/integrations/integration-cards.tsx`
- Create: `apps/worker/src/gmail-alert-worker.ts`
- Test: `apps/worker/src/gmail-alert-worker.unit.test.ts`

**Interfaces:**
- Consumes: encrypted Google integration connection, strict source connector, raw import transaction, Task 5 schedule runs.
- Produces: `GmailClient`, `MockGmailClient`, `GoogleGmailClient`, and scheduled `google.gmail.listing-alerts.v1` acquisition.

- [ ] **Step 1: Write OAuth, filter, cursor, idempotency, and no-send tests**

```ts
expect(authorizeUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
expect(query).toMatch(/label:Vera|from:\([^)]*\)|subject:\([^)]*\)/u);
expect(await worker.run(scheduleRun)).toMatchObject({ imported: 1, replayed: 0 });
expect(await worker.run(scheduleRun)).toMatchObject({ imported: 0, replayed: 1 });
expect(productionSources).not.toMatch(/messages\.send|drafts\.send|gmail\.modify|smtp/iu);
```

- [ ] **Step 2: Run focused tests**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{gmail-client,gmail-alert-connector}.unit.test.ts apps/worker/src/gmail-alert-worker.unit.test.ts`  
Expected: FAIL because Gmail modules do not exist.

- [ ] **Step 3: Implement incremental OAuth and strict parsing**

Use the existing web-server authorization-code/PKCE boundary, but a dedicated Gmail OAuth state. Search only the configured Vera label or code-owned sanitized sender/subject patterns. Fetch only required message metadata/body fragments, parse source URL/address/price/posted/excerpt when explicit, and discard the full message after bounded parsing.

- [ ] **Step 4: Import through immutable ingestion and commit cursor last**

Persist message ID as the external reference, content/idempotency hashes, minimal evidence, normalization enqueue, schedule outcome, and audit in a transaction. Commit history/cursor only after every accepted import is durable. Treat revoked/partial scopes as visible reconnect/manual states, not empty mail.

- [ ] **Step 5: Run Gmail tests**

Run: `./node_modules/.bin/vitest run --project unit packages/connectors/src/{gmail-client,gmail-alert-connector}.unit.test.ts apps/worker/src/gmail-alert-worker.unit.test.ts apps/web/lib/server/google-integration-oauth.unit.test.ts`  
Expected: PASS without Google/network.

### Task 8: Implement notification decision engine and providers

**Files:**
- Create: `packages/notifications/src/contracts.ts`
- Create: `packages/notifications/src/eligibility.ts`
- Create: `packages/notifications/src/quiet-hours.ts`
- Create: `packages/notifications/src/mock-provider.ts`
- Create: `packages/notifications/src/console-provider.ts`
- Create: `packages/notifications/src/web-push-provider.ts`
- Create: `packages/notifications/src/index.ts`
- Test: `packages/notifications/src/eligibility.unit.test.ts`
- Test: `packages/notifications/src/quiet-hours.unit.test.ts`
- Test: `packages/notifications/src/web-push-provider.unit.test.ts`
- Create: `apps/worker/src/notification-worker.ts`
- Test: `apps/worker/src/notification-worker.unit.test.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`

**Interfaces:**
- Consumes: Task 2 notification schemas, Task 3 encrypted subscription/delivery repositories, current deterministic score and risk records.
- Produces: provider-neutral delivery and worker fan-out.

- [ ] **Step 1: Write golden rules and provider tests**

```ts
expect(evaluateNotificationEligibility(hardConstraintFailure)).toEqual({ eligible: false, reason: "hard_constraint" });
expect(evaluateNotificationEligibility(duplicateDelivery)).toEqual({ eligible: false, reason: "duplicate" });
expect(evaluateQuietHours("2026-11-01T05:30:00.000Z", "America/New_York", "22:00", "07:00").quiet).toBe(true);
expect(pushRequest.payload).toEqual({ title: "Vera found a new match", body: "Open Vera to review a new listing.", deepLink: "/listings/listing-1" });
```

- [ ] **Step 2: Run notification package tests**

Run: `./node_modules/.bin/vitest run --project unit packages/notifications/src/*.unit.test.ts apps/worker/src/notification-worker.unit.test.ts`  
Expected: FAIL because the package is empty.

- [ ] **Step 3: Implement pure eligibility and timezone-safe quiet hours**

Eligibility checks hard constraints, explicit threshold, freshness, canonical duplicate key, risk ceiling, current profile ownership, user preference, and kill switch. Use `Intl.DateTimeFormat` with an injected clock and reject invalid IANA zones. Queue digest membership rather than sending during quiet hours or above the hourly limit.

- [ ] **Step 4: Implement providers and worker outcomes**

Web Push config requires complete VAPID settings or fails startup in production. Map 404/410 to revoked subscription, 429/5xx/network to bounded retry, and other 4xx to permanent failure. Never log the endpoint, auth secret, p256dh key, or provider response body.

- [ ] **Step 5: Run notification tests**

Run: `./node_modules/.bin/vitest run --project unit packages/notifications/src/*.unit.test.ts apps/worker/src/notification-worker.unit.test.ts`  
Expected: PASS.

### Task 9: Add renter Web Push settings and service worker

**Files:**
- Create: `apps/web/public/vera-push-sw.js`
- Create: `apps/web/app/settings/notifications/page.tsx`
- Create: `apps/web/app/settings/notifications/notification-settings.tsx`
- Create: `apps/web/app/settings/notifications/notification-settings.unit.test.tsx`
- Create: `apps/web/app/api/notifications/preferences/route.ts`
- Create: `apps/web/app/api/notifications/subscriptions/route.ts`
- Create: `apps/web/app/api/notifications/routes.integration.test.ts`
- Modify: `apps/web/app/settings/integrations/page.tsx`
- Modify: `apps/web/lib/server/application.ts`

**Interfaces:**
- Consumes: authenticated session, notification repositories, VAPID public key, CSRF/origin checks.
- Produces: explicit subscribe/unsubscribe/preferences UX and same-origin service-worker deep links.

- [ ] **Step 1: Write route and view tests**

```ts
await expect(POST(unauthenticatedRequest)).resolves.toMatchObject({ status: 401 });
expect(JSON.stringify(subscriptionResponse)).not.toMatch(/auth|p256dh|endpoint/iu);
expect(view.lockScreenDisclosure).toContain("generic");
expect(view.permissionRequestedAutomatically).toBe(false);
```

- [ ] **Step 2: Run web notification tests**

Run: `./node_modules/.bin/vitest run --project unit apps/web/app/settings/notifications/notification-settings.unit.test.tsx`  
Run: `./node_modules/.bin/vitest run --project integration apps/web/app/api/notifications/routes.integration.test.ts`  
Expected: FAIL because routes/components do not exist.

- [ ] **Step 3: Implement explicit browser subscription flow**

Request permission only from a user click. Register `/vera-push-sw.js`, subscribe with the public VAPID key, send the subscription once to the protected route, and display enabled/revoked/error states without returning persisted secrets. Unsubscribe disables the row and calls browser `unsubscribe()`.

- [ ] **Step 4: Implement preferences and safe service-worker behavior**

Validate timezone, quiet hours, threshold, freshness, hourly limit, digest, and risk ceiling through shared schemas. The service worker displays only the server-supplied strict generic payload and opens only a same-origin `/listings/<safe-id>` path.

- [ ] **Step 5: Run web tests**

Run: `./node_modules/.bin/vitest run --project unit apps/web/app/settings/notifications/notification-settings.unit.test.tsx`  
Run: `./node_modules/.bin/vitest run --project integration apps/web/app/api/notifications/routes.integration.test.ts`  
Expected: PASS.

### Task 10: Add operator-only operations view and controls

**Files:**
- Create: `apps/web/lib/server/operator-auth.ts`
- Test: `apps/web/lib/server/operator-auth.unit.test.ts`
- Create: `apps/web/lib/server/operations-service.ts`
- Test: `apps/web/lib/server/operations-service.unit.test.ts`
- Create: `apps/web/app/settings/operations/page.tsx`
- Create: `apps/web/app/settings/operations/operations-panel.tsx`
- Create: `apps/web/app/settings/operations/operations-panel.unit.test.tsx`
- Create: `apps/web/app/api/operations/status/route.ts`
- Create: `apps/web/app/api/operations/jobs/[id]/retry/route.ts`
- Create: `apps/web/app/api/operations/jobs/[id]/cancel/route.ts`
- Create: `apps/web/app/api/operations/routes.integration.test.ts`
- Modify: `apps/web/lib/server/application.ts`

**Interfaces:**
- Consumes: operator ID allowlist, production orchestrator, deployment/heartbeat/schedule/job/notification repositories, policy registry.
- Produces: protected operations read model and policy-checked retry/cancel APIs.

- [ ] **Step 1: Write ordinary-renter denial and safe-control tests**

```ts
expect(requireOperator(renterSession, env)).rejects.toMatchObject({ status: 403 });
expect(await loadOperations(operatorSession)).toMatchObject({ worker: { status: "ready" } });
await expect(retryJob(permanentFailure)).rejects.toMatchObject({ code: "unsafe_retry" });
expect(JSON.stringify(statusResponse)).not.toMatch(/token|secret|cookie|DATABASE_URL|snapshot/iu);
```

- [ ] **Step 2: Run operations tests**

Run: `./node_modules/.bin/vitest run --project unit apps/web/lib/server/{operator-auth,operations-service}.unit.test.ts apps/web/app/settings/operations/operations-panel.unit.test.tsx`  
Expected: FAIL because operations modules do not exist.

- [ ] **Step 3: Implement authorization, read model, and controls**

Parse `VERA_OPERATOR_USER_IDS` as exact UUIDs. Do not render a navigation link for non-operators. Every page and route calls `requireOperator`. Status combines safe worker heartbeat, Maritime agent state, gateway/node version, trigger/schedule runs, job counts, kill switches, and notification counts. Retry/cancel uses repository optimistic revision, rechecks current policy, and appends safe audit.

- [ ] **Step 4: Run operations tests**

Run: `./node_modules/.bin/vitest run --project unit apps/web/lib/server/{operator-auth,operations-service}.unit.test.ts apps/web/app/settings/operations/operations-panel.unit.test.tsx`  
Run: `./node_modules/.bin/vitest run --project integration apps/web/app/api/operations/routes.integration.test.ts`  
Expected: PASS.

### Task 11: Add Maritime deployment assets, runbooks, and static validation

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `infra/maritime/README.md`
- Create: `infra/maritime/ENVIRONMENT.md`
- Create: `infra/maritime/TOPOLOGY.md`
- Create: `infra/maritime/OPENCLAW.md`
- Create: `infra/maritime/COSTS.md`
- Create: `infra/maritime/validate.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SOURCE_POLICY.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `docs/DEMO.md`
- Modify: `AGENTS.md`
- Create: `docs/DECISIONS/0011-maritime-production-execution.md`
- Test: `scripts/verify-maritime-boundaries.unit.test.ts`

**Interfaces:**
- Consumes: all implemented versions, health routes, environment schemas, migration, and operator paths.
- Produces: reproducible operator deployment/rollback and `pnpm maritime:validate`.

- [ ] **Step 1: Write static deployment validation assertions**

```ts
expect(dockerfile).toContain("node:24");
expect(dockerfile).toContain("openclaw@2026.6.33");
expect(openclawRunbook).toContain("ghcr.io/openclaw/openclaw:2026.6.33");
expect(allInfra).not.toMatch(/2026\.5\.28|:latest|MARITIME_API_KEY=mk_|OPENCLAW_GATEWAY_TOKEN=\S+/u);
```

- [ ] **Step 2: Implement a non-root worker image and validation command**

The root Dockerfile installs with the frozen lockfile, builds the worker, installs exact OpenClaw CLI, copies only runtime artifacts/dependencies, runs as non-root, exposes `8080`, and starts the worker `serve` command. `infra/maritime/validate.mjs` checks pins, required env names, no secret values, health paths, and trigger commands without network access.

- [ ] **Step 3: Document exact operator commands**

Document pinned CLI commands for login/whoami, worker create/deploy/status/logs, `maritime triggers create vera-worker --type cron --cron "*/5 * * * *"`, trigger list/delete, gateway Docker redeploy, secret setting with masked listing, health/readiness checks, staging smoke flags, and rollback to the prior reviewed patched image/worker commit. Initial gateway secrets/pairing occur only after version validation.

- [ ] **Step 4: Correct stale architecture text**

Update hosted persistence to PostgreSQL, Maritime worker/scheduling to implemented, OpenClaw to `2026.6.33`, Gmail scope to read-only scheduled ingestion, notifications to generic Web Push, and Railway to web/demo-only. Preserve all non-goals and explicit demo isolation.

- [ ] **Step 5: Run deployment and boundary validation**

Run: `node infra/maritime/validate.mjs`  
Run: `./node_modules/.bin/vitest run --project unit scripts/verify-maritime-boundaries.unit.test.ts scripts/verify-browser-boundaries.unit.test.ts scripts/verify-database-boundaries.unit.test.ts`  
Expected: PASS without credentials or network.

### Task 12: Full acceptance, security review, and completion audit

**Files:**
- Modify: `tests/e2e/browser-agent.spec.ts`
- Create: `tests/e2e/notifications.spec.ts`
- Create: `tests/e2e/operations.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-07-22-maritime-execution-plane-design.md`
- Modify: `docs/superpowers/plans/2026-07-22-maritime-execution-plane.md`

**Interfaces:**
- Consumes: complete implementation and all default mocks.
- Produces: evidence-backed acceptance report and opt-in staging commands.

- [ ] **Step 1: Add deterministic E2E coverage**

Cover operator denial/visibility, queued-to-completed scheduled job fixture, offline-node deferral, manual blocker, Web Push subscription with a fake `PushManager`, generic delivery status, duplicate suppression, and audit ordering. Do not grant browser notification permission or call a provider outside Playwright mocks.

- [ ] **Step 2: Run narrow security scans**

Run: `rg -n 'mk_[A-Za-z0-9]{12,}|OPENCLAW_GATEWAY_TOKEN=\S+|VAPID_PRIVATE_KEY=\S+|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|messages\.send|drafts\.send|gmail\.modify|captchaBypass|credentialLogin' . --glob '!node_modules/**' --glob '!pnpm-lock.yaml'`  
Expected: no real secret, send capability, CAPTCHA bypass, or credential-login implementation.

- [ ] **Step 3: Run formatting and static boundaries**

Run: `./node_modules/.bin/prettier --check .`  
Run: `pnpm verify:db-boundaries && pnpm verify:calendar-boundaries && pnpm verify:browser-boundaries && pnpm verify:maritime-boundaries && pnpm maritime:validate`  
Expected: PASS.

- [ ] **Step 4: Run compile and test gates**

Run: `pnpm lint`  
Run: `pnpm typecheck`  
Run: `pnpm test:unit`  
Run: `pnpm test:integration`  
Run: `TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres`  
Run: `pnpm test:e2e`  
Run: `pnpm build`  
Run: `pnpm audit --prod`  
Expected: every command exits 0; default suites make no live external calls.

- [ ] **Step 5: Validate the worker image**

Run: `docker build -t vera-worker:maritime .`  
Run: `docker run --rm vera-worker:maritime openclaw --version`  
Expected: build succeeds and version output is exactly `2026.6.33`.

- [ ] **Step 6: Record opt-in staging commands without executing production deployment**

Document guarded Maritime status/wake, Gmail test-label ingestion, Web Push founder-device delivery, and OpenClaw gateway/node capture commands. Each requires an explicit staging flag and environment configuration. No production deployment is performed by tests or this plan.

- [ ] **Step 7: Complete requirement-by-requirement audit**

Cross-reference every Prompt 10 acceptance criterion with a migration, contract, test, command output, documented operator action, or explicitly unexecuted staging prerequisite. Do not claim live provider acceptance without actual staging evidence. Report final topology, pins, commands, triggers, secrets, retry semantics, disabled policy behavior, test/build/deployment validation, and recommended commit message.
