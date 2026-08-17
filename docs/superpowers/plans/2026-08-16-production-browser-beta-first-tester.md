# Production Browser Beta and First External Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Vera's hydration failure, add the privacy lifecycle required for nonfounder access, deploy one current application release, and prove isolated Browser Connector acceptance for the founder and one external tester.

**Architecture:** The web application uses one explicit UTC formatting boundary for server-rendered instants and one PostgreSQL-backed privacy service for owner export, challenge-gated deletion, revocation, receipts, and restored-backup enforcement. Web and worker deploy together with browser gates off; one signed enrollment-capable Gateway and the private Chrome Web Store extension are accepted first for the founder and then for one separately provisioned tester.

**Tech Stack:** TypeScript 6, Next.js 16, React 19, Zod 4, Drizzle ORM, PostgreSQL 18, Vitest 4, Playwright 1.61, Better Auth 1.6, pnpm 11, Heroku Eco/Essential-0, Chrome Web Store, GitHub Actions, GHCR/Cosign attestations, DigitalOcean, Maritime, and OpenClaw 2026.7.1.

## Global Constraints

- Use branch `codex/production-browser-beta-first-tester` and one final pull request.
- Preserve every existing PostgreSQL listing, provenance, score, activity, and private acceptance record.
- Keep `VERA_BROWSER_DISABLED=1`, `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0`, and `VERA_BROWSER_ENROLLMENT_ENABLED=0` until their named live gate passes.
- Browser access remains `experimental_personal`, founder/private-beta only, and `user_triggered_only`.
- Exactly one explicitly shared tab; connecting or restarting shares zero tabs.
- Never automate login, password entry, 2FA, CAPTCHA, checkpoint, consent, rate-limit recovery, or blocked layouts.
- Never add arbitrary JavaScript, selector, coordinate, shell, filesystem, contact, application, tour, reply, message, email, phone, payment, upload, or download surfaces.
- Keep extension version `2.2.0` and permissions exactly `alarms`, `debugger`, `storage`, `tabGroups`, and `tabs`.
- Build a new Gateway only because one-click enrollment is a proven missing bounded primitive; retain both accepted image digests unchanged.
- Do not expose raw tickets, relay/checkpoint credentials, OAuth material, browser storage, database URLs, private infrastructure, or tester emails in Git, logs, command output, evidence, or chat.
- Keep the existing Heroku footprint at one Eco web, one Eco worker, and Essential-0 PostgreSQL; do not add paid infrastructure without approving the exact recurring amount.
- Every code task is test-first, uses focused checks while iterating, and ends in a reviewable commit; run full CI once on the final branch state.

---

### Task 1: Make server-rendered time deterministic

**Files:**
- Create: `apps/web/lib/display-time.ts`
- Create: `apps/web/lib/display-time.unit.test.ts`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Modify: `apps/web/app/listings/[id]/listing-detail.tsx`
- Modify: `apps/web/app/activity/activity-timeline.tsx`
- Modify: `apps/web/app/settings/integrations/integration-cards.tsx`
- Modify: `apps/web/app/settings/integrations/browser-agent/browser-agent-panel.tsx`
- Modify: `apps/web/app/settings/integrations/remote-browser/remote-browser-panel.tsx`
- Modify: `apps/web/app/settings/operations/operations-panel.tsx`
- Modify: `apps/web/app/settings/beta/review-queue.tsx`
- Modify: `scripts/verify-web-runtime-boundaries.ts`
- Modify: `scripts/verify-web-runtime-boundaries.unit.test.ts`
- Create: `tests/e2e/hydration.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: ISO instants already validated at API/domain boundaries and explicitly configured IANA zones for viewing windows.
- Produces: `formatUtcDate`, `formatUtcDateTime`, `formatUtcFullDateTime`, and a static verifier that denies locale-dependent server rendering.

- [ ] **Step 1: Write failing formatter and source-boundary tests**

Create tests with boundary instants that previously rendered differently in UTC and New York:

```ts
import { describe, expect, it } from "vitest";

import { formatUtcDate, formatUtcDateTime, formatUtcFullDateTime } from "./display-time.ts";

describe("deterministic display time", () => {
  it("uses UTC on both sides of local midnight", () => {
    expect(formatUtcDate("2026-08-11T01:30:00.000Z")).toBe("Aug 11");
    expect(formatUtcDateTime("2026-08-11T01:30:00.000Z")).toBe("Aug 11, 1:30 AM UTC");
    expect(formatUtcFullDateTime("2026-08-11T01:30:00.000Z")).toContain("2026");
    expect(formatUtcFullDateTime("2026-08-11T01:30:00.000Z")).toContain("UTC");
  });

  it("rejects invalid instants instead of inventing a date", () => {
    expect(() => formatUtcDate("not-an-instant")).toThrow("display instant");
  });
});
```

Extend `findWebRuntimeBoundaryViolations` with a rendering scan and test these exact denials:

```ts
expect(findWebDateRenderingViolations(new Map([
  ["apps/web/app/card.tsx", "new Date(value).toLocaleString()"],
  ["apps/web/app/card-2.tsx", "new Intl.DateTimeFormat('en-US', { month: 'short' })"]
]))).toEqual([
  expect.objectContaining({ message: expect.stringContaining("deterministic time formatter") }),
  expect.objectContaining({ message: expect.stringContaining("explicit timeZone") })
]);
```

- [ ] **Step 2: Run the tests and require failure**

```sh
pnpm vitest run --project unit apps/web/lib/display-time.unit.test.ts scripts/verify-web-runtime-boundaries.unit.test.ts
```

Expected: FAIL because the shared formatter and rendering-boundary function do not exist.

- [ ] **Step 3: Implement the UTC formatter boundary**

Use one strict instant parser and module-level formatters:

```ts
const utcDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});
const utcDateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});
const utcFullDateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

function instant(value: string | Date): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("The display instant is invalid.");
  return parsed;
}

export const formatUtcDate = (value: string | Date): string => utcDate.format(instant(value));
export const formatUtcDateTime = (value: string | Date): string =>
  utcDateTime.format(instant(value));
export const formatUtcFullDateTime = (value: string | Date): string =>
  utcFullDateTime.format(instant(value));
```

Replace every timezone-free formatter under `apps/web/app` with the helper. Keep
`viewing-planner-view.ts` and `calendar-hold-service.ts` on their explicit saved `timeZone` values.
Do not route date-only values through `Date`.

The verifier recursively reads `.ts`/`.tsx` files under `apps/web/app`, rejects
`toLocaleString`, `toLocaleDateString`, and `toLocaleTimeString`, and rejects
`new Intl.DateTimeFormat(...)` unless its object literal contains `timeZone`. Exempt only
`apps/web/app/demo/public-demo.tsx` numeric `Number.prototype.toLocaleString()` by confirming the
call receiver is not a `Date` expression.

- [ ] **Step 4: Add the cross-timezone hydration regression**

Set the Playwright browser project to `timezoneId: "America/New_York"` and the web server environment
to `TZ: "UTC"`. Add:

```ts
import { expect, test } from "@playwright/test";

test("authenticated product routes hydrate without server/client date drift", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|did not match|Minified React error #418/iu.test(message.text())) {
      failures.push(message.text());
    }
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your housing options, already organized." })).toBeVisible();
  await expect(page.locator("[data-testid='listing-card']").first()).toBeVisible();
  expect(failures).toEqual([]);
});
```

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit apps/web/lib/display-time.unit.test.ts scripts/verify-web-runtime-boundaries.unit.test.ts
pnpm verify:web-runtime-boundaries
pnpm exec playwright test tests/e2e/hydration.spec.ts
pnpm --filter @vera/web run build
git add apps/web/lib/display-time.ts apps/web/lib/display-time.unit.test.ts apps/web/app scripts/verify-web-runtime-boundaries.ts scripts/verify-web-runtime-boundaries.unit.test.ts tests/e2e/hydration.spec.ts playwright.config.ts
git commit -m "fix: make server-rendered dates deterministic"
```

Expected: all checks pass and the browser records no hydration error.

---

### Task 2: Define privacy contracts and additive schema

**Files:**
- Create: `packages/domain/src/privacy-lifecycle.ts`
- Create: `packages/domain/src/privacy-lifecycle.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/postgres/schema.ts`
- Create through Drizzle generation: `packages/db/drizzle/0010_privacy_lifecycle.sql`
- Create through Drizzle generation: `packages/db/drizzle/meta/0010_snapshot.json`
- Modify through Drizzle generation: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/postgres/migrations.integration.test.ts`

**Interfaces:**
- Consumes: `VeraUserIdSchema`, ISO datetimes, SHA-256 digests, and the existing `users` table.
- Produces: closed privacy request/response schemas plus `privacy_deletion_challenges` and `privacy_deletion_receipts`.

- [ ] **Step 1: Write failing domain and migration tests**

Cover strict parsing, the exact confirmation phrase, 43-character base64url challenges, fixed
revocation states, size constants, and secret-free receipts:

```ts
expect(PrivacyDeletionChallengeRequestSchema.parse({
  confirmation: "request_account_deletion"
})).toEqual({ confirmation: "request_account_deletion" });
expect(() => PrivacyDeletionRequestSchema.parse({
  challengeToken: "a".repeat(43),
  confirmation: "DELETE ACCOUNT"
})).toThrow();
expect(PrivacyDeletionRequestSchema.parse({
  challengeToken: "a".repeat(43),
  confirmation: "DELETE MY VERA ACCOUNT"
})).toBeDefined();
expect(JSON.stringify(receipt)).not.toMatch(/email|token|secret|credential|nonce|url/iu);
```

Add a migration test that requires `0010_privacy_lifecycle.sql`, both tables, digest/lifetime/status
checks, no `DROP`, no `TRUNCATE`, and no `REFERENCES "public"`.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit packages/domain/src/privacy-lifecycle.unit.test.ts
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm vitest run --project postgres-integration packages/db/src/postgres/migrations.integration.test.ts
```

Expected: FAIL because the contracts and migration are absent.

- [ ] **Step 3: Implement the exact domain contracts**

Define these constants and schemas:

```ts
export const PRIVACY_EXPORT_SCHEMA_VERSION = "vera-privacy-export.v1" as const;
export const PRIVACY_DELETION_CONFIRMATION = "DELETE MY VERA ACCOUNT" as const;
export const PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS = 15 * 60 * 1_000;
export const PRIVACY_EXPORT_MAX_LINE_BYTES = 1_048_576;
export const PRIVACY_EXPORT_MAX_TOTAL_BYTES = 52_428_800;

export const PrivacyDeletionChallengeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const PrivacyDeletionChallengeRequestSchema = z.object({
  confirmation: z.literal("request_account_deletion")
}).strict();
export const PrivacyDeletionRequestSchema = z.object({
  challengeToken: PrivacyDeletionChallengeTokenSchema,
  confirmation: z.literal(PRIVACY_DELETION_CONFIRMATION)
}).strict();
export const PrivacyRevocationStatusSchema = z.enum([
  "confirmed",
  "unconfirmed",
  "not_configured"
]);
export const PrivacyDeletionReceiptSchema = z.object({
  id: z.uuid(),
  formerUserId: VeraUserIdSchema,
  subjectDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  providerRevocation: PrivacyRevocationStatusSchema,
  browserRevocation: PrivacyRevocationStatusSchema,
  completedAt: IsoDateTimeSchema,
  backupEraseAfter: IsoDateTimeSchema,
  legalHoldUntil: IsoDateTimeSchema.nullable()
}).strict();
```

Add strict manifest, record, challenge response, and deletion response schemas. Export records use
`{ type: "record", table: string, data: JsonObject }`; manifests use
`{ type: "manifest", schemaVersion, userId, generatedAt, recordCounts, recordHashes, warning }`.
The warning is exactly:

```text
This export excludes passwords, sessions, OAuth tokens, browser credentials, and internal security material.
```

Add `serializePrivacyExportNdjson` that validates every record, appends exactly one newline per JSON
record, rejects a line above 1 MiB, rejects a complete export above 50 MiB before returning bytes,
and never produces a partial response.

- [ ] **Step 4: Add the schema and generate migration `0010`**

Add `privacyDeletionChallenges` with UUID ID, owner FK `ON DELETE CASCADE`, unique 64-hex digest,
created/expiry/consumed timestamps, and a check requiring expiry after creation and no more than 15
minutes later. Add `privacyDeletionReceipts` with no owner FK, UUID ID, unique former-user UUID,
64-hex subject digest, fixed provider/browser statuses, completion/backup-erasure/legal-hold times,
and ordering checks.

Run:

```sh
pnpm db:generate
```

Rename only the newly generated migration and snapshot to `0010_privacy_lifecycle`, update the new
journal tag to the same exact name, and inspect the generated SQL. Do not edit migrations `0000`
through `0009`.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit packages/domain/src/privacy-lifecycle.unit.test.ts
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm vitest run --project postgres-integration packages/db/src/postgres/migrations.integration.test.ts
pnpm --filter @vera/domain run typecheck
pnpm --filter @vera/db run typecheck
git add packages/domain/src/privacy-lifecycle.ts packages/domain/src/privacy-lifecycle.unit.test.ts packages/domain/src/index.ts packages/db/src/postgres/schema.ts packages/db/src/postgres/migrations.integration.test.ts packages/db/drizzle
git commit -m "feat: define privacy lifecycle contracts"
```

Expected: the additive migration applies from an empty schema and from the nine-migration production
baseline while preserving seeded rows.

---

### Task 3: Implement owner-scoped export and deletion persistence

**Files:**
- Create: `packages/db/src/postgres/privacy-owner-table-policy.ts`
- Create: `packages/db/src/postgres/privacy-owner-table-policy.unit.test.ts`
- Create: `packages/db/src/postgres/privacy-lifecycle-repository.ts`
- Create: `packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: privacy domain contracts, `PostgresConnection`, owner UUID, SHA-256 challenge digest, HMAC subject digest, and fixed revocation statuses.
- Produces: `PrivacyLifecycleRepository`, `createPostgresPrivacyLifecycleRepository`, deterministic export records, challenge consumption, owner deletion, and restored-owner re-deletion.

- [ ] **Step 1: Write owner-isolation, challenge, deletion, and coverage tests**

Seed two users with distinct listings, browser assignments, notification state, integration
credentials, sessions, and beta memberships. Require:

```ts
const exported = await repository.exportOwner({ userId: userA, generatedAt: now });
const json = JSON.stringify(exported);
expect(json).toContain("listing-owned-by-a");
expect(json).not.toContain("listing-owned-by-b");
expect(json).not.toContain("refresh-token-a");
expect(json).not.toContain("session-token-a");
expect(json).not.toContain("relay-digest-a");

const issued = await repository.issueDeletionChallenge({
  id: challengeId,
  userId: userA,
  challengeDigest: "a".repeat(64),
  createdAt: now,
  expiresAt
});
await expect(repository.consumeDeletionChallenge({
  userId: userB,
  challengeDigest: issued.challengeDigest,
  consumedAt: now
})).rejects.toThrow("challenge");
await expect(repository.consumeDeletionChallenge({
  userId: userA,
  challengeDigest: issued.challengeDigest,
  consumedAt: now
})).resolves.toEqual(challengeId);
await expect(repository.consumeDeletionChallenge({
  userId: userA,
  challengeDigest: issued.challengeDigest,
  consumedAt: now
})).rejects.toThrow("challenge");
```

Delete user A, assert every `user_id` table is zero for A, user B is unchanged, A's beta request,
membership, verification identifiers, accounts, sessions, and credentials are gone, and the receipt
contains no raw identity. Reinsert a restored user A fixture and require
`reapplyDeletionReceipt(receipt)` to remove it again.

Query `information_schema.columns` for every current table containing `user_id`; require the result
to equal the policy registry exactly so a future owner table cannot bypass export/deletion review.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit packages/db/src/postgres/privacy-owner-table-policy.unit.test.ts
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm vitest run --project postgres-integration packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts
```

Expected: FAIL because the policy and repository do not exist.

- [ ] **Step 3: Define the complete owner-table policy**

Use this closed registry; `export` returns the full owner row, `project` uses a named safe
projection, and `delete_only` never enters an export:

```ts
export const PRIVACY_OWNER_TABLE_POLICY = {
  accounts: "delete_only",
  activity_events: "export",
  approvals: "export",
  availability_checks: "export",
  availability_rule_sets: "export",
  beta_memberships: "project",
  browser_capture_acceptances: "export",
  browser_connector_devices: "project",
  browser_connector_enrollment_tickets: "delete_only",
  browser_gateway_acceptance_runs: "export",
  browser_gateway_assignments: "project",
  browser_nodes: "project",
  browser_profile_controls: "export",
  browser_source_controls: "export",
  browser_user_controls: "export",
  calendar_holds: "export",
  calendar_oauth_states: "delete_only",
  canonical_decision_runs: "export",
  canonical_field_sources: "export",
  canonical_listing_sources: "export",
  canonical_listings: "export",
  contact_workflows: "export",
  decision_corpus_state: "export",
  decision_job_attempts: "export",
  decision_jobs: "export",
  decision_runs: "export",
  duplicate_clusters: "export",
  duplicate_override_revocations: "export",
  duplicate_overrides: "export",
  duplicate_pair_evaluations: "export",
  field_provenance: "export",
  gmail_alert_cursors: "export",
  gmail_alert_external_references: "export",
  gmail_oauth_states: "delete_only",
  integration_connections: "project",
  integration_refresh_leases: "delete_only",
  listing_enrichment_snapshots: "export",
  listing_enrichment_states: "export",
  listing_extractions: "export",
  listing_photos: "export",
  listing_scores: "export",
  listing_source_record_dispositions: "export",
  listing_source_records: "export",
  maritime_dispatches: "project",
  normalization_jobs: "export",
  notification_deliveries: "export",
  notification_digest_items: "export",
  notification_preferences: "export",
  privacy_deletion_challenges: "delete_only",
  production_schedule_runs: "export",
  production_schedules: "export",
  raw_listings: "export",
  risk_signals: "export",
  search_profiles: "export",
  sessions: "delete_only",
  source_job_attempts: "export",
  source_jobs: "export",
  viewings: "export",
  web_push_subscriptions: "project"
} as const;
```

Define the repository-only data structures before the interface so every later task uses the same
names:

```ts
export interface PrivacyDeletionChallenge {
  readonly id: string;
  readonly userId: VeraUserId;
  readonly challengeDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export interface PrivacyExportBundle {
  readonly manifest: PrivacyExportManifest;
  readonly records: readonly PrivacyExportRecord[];
}
```

Safe projections expose:

- `beta_memberships`: ID, status, invitation/activation/revocation times;
- `integration_connections`: ID, provider, display email, granted scopes, status, token expiry,
  last-successful-use, creation/update times;
- `browser_gateway_assignments`: ID, status, creation/activation/revocation times;
- `browser_connector_devices`: ID, extension/protocol versions, status and lifecycle times;
- `browser_nodes`: node name, status, pairing/capability/version states, safe capabilities and
  lifecycle times, with provider/profile/internal IDs omitted;
- `maritime_dispatches`: ID, source job ID, state, run ID, issue/expiry/terminal times, rejection
  code, payload hash, with nonce, agent, issuer, and audience omitted;
- `web_push_subscriptions`: ID, status and lifecycle times, with endpoint hash and every credential
  envelope field omitted.

The recursive export-key guard rejects keys matching:

```ts
/password|accessToken|refreshToken|idToken|sessionToken|credential(?:Version|Algorithm|KeyId|Nonce|Ciphertext|AuthenticationTag)?|secretReference|relayCredentialDigest|checkpointCredentialDigest|installationDigest|ticketDigest|stateHash|codeVerifierHash|endpointHash|nonceHash/iu
```

- [ ] **Step 4: Implement the repository transaction boundaries**

Define:

```ts
export interface PrivacyLifecycleRepository {
  exportOwner(input: { userId: VeraUserId; generatedAt: string }): Promise<PrivacyExportBundle>;
  getDeletionIdentity(userId: VeraUserId): Promise<{
    normalizedEmail: string;
    providerSubject: string;
  }>;
  issueDeletionChallenge(input: {
    id: string;
    userId: VeraUserId;
    challengeDigest: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<PrivacyDeletionChallenge>;
  consumeDeletionChallenge(input: {
    userId: VeraUserId;
    challengeDigest: string;
    consumedAt: string;
  }): Promise<string>;
  deleteOwnerAccount(input: {
    userId: VeraUserId;
    consumedChallengeId: string;
    subjectDigest: string;
    providerRevocation: PrivacyRevocationStatus;
    browserRevocation: PrivacyRevocationStatus;
    completedAt: string;
    backupEraseAfter: string;
    legalHoldUntil: string | null;
  }): Promise<PrivacyDeletionReceipt>;
  reapplyDeletionReceipt(receipt: PrivacyDeletionReceipt): Promise<"absent" | "reapplied">;
  countOwnerRows(userId: VeraUserId): Promise<Readonly<Record<string, number>>>;
}
```

`exportOwner` uses a repeatable-read, read-only transaction, sorts tables by registry name and rows
by JSON text, validates every key, calculates SHA-256 per table, and places the manifest first.
`issueDeletionChallenge` rejects a lifetime above 15 minutes. `consumeDeletionChallenge` locks by
owner and digest and updates `consumed_at` only when unexpired and unused.

`deleteOwnerAccount` locks the consumed challenge and user, deletes the matching beta access request
and beta membership by normalized email, deletes matching Better Auth verifications by normalized
identifier, deletes the user through the current reviewed owner-cascade graph, verifies every
registry table count is zero, and inserts the receipt in the same transaction. The integration test
must prove the real restrictive child foreign keys permit that reviewed owner cascade; never disable
constraints. User B must remain untouched.

`reapplyDeletionReceipt` locks by former UUID, deletes any restored matching user with the same
owner-scoped procedure, and leaves the original receipt intact.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit packages/db/src/postgres/privacy-owner-table-policy.unit.test.ts
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm vitest run --project postgres-integration packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts
pnpm --filter @vera/db run typecheck
git add packages/db/src/postgres/privacy-owner-table-policy.ts packages/db/src/postgres/privacy-owner-table-policy.unit.test.ts packages/db/src/postgres/privacy-lifecycle-repository.ts packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts packages/db/src/index.ts
git commit -m "feat: persist owner privacy lifecycle"
```

Expected: owner isolation, credential exclusion, replay denial, deletion, and restored-owner removal
all pass against temporary PostgreSQL schemas.

---

### Task 4: Compose revocation and privacy orchestration

**Files:**
- Create: `apps/web/lib/server/privacy-config.ts`
- Create: `apps/web/lib/server/privacy-config.unit.test.ts`
- Create: `apps/web/lib/server/privacy-lifecycle-service.ts`
- Create: `apps/web/lib/server/privacy-lifecycle-service.unit.test.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/demo-application.ts`

**Interfaces:**
- Consumes: `PrivacyLifecycleRepository`, existing Google disconnect, Browser Gateway assignment and enrollment revocation repositories, clock/random dependencies, and protected configuration.
- Produces: `PrivacyLifecycleService` on hosted `VeraApplication`; demo mode exposes `null`.

- [ ] **Step 1: Write failing configuration and orchestration tests**

Require production configuration to reject a missing/short HMAC key and a backup retention outside
1–365 days. With fakes, verify deletion order:

```ts
expect(calls).toEqual([
  "consume_challenge",
  "load_identity",
  "revoke_assignment",
  "revoke_enrollments",
  "disconnect_google",
  "delete_owner"
]);
expect(deleteOwnerAccount).toHaveBeenCalledWith(expect.objectContaining({
  providerRevocation: "confirmed",
  browserRevocation: "confirmed"
}));
```

Test Google's `provider_revocation_unconfirmed` as `unconfirmed` while local credential deletion and
account deletion continue. Test an unconfigured Google/browser boundary as `not_configured`. Test
any other pre-delete error leaves `deleteOwnerAccount` uncalled.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit apps/web/lib/server/privacy-config.unit.test.ts apps/web/lib/server/privacy-lifecycle-service.unit.test.ts
```

Expected: FAIL because configuration and service modules are absent.

- [ ] **Step 3: Implement protected configuration**

Parse exactly:

```ts
export interface PrivacyEnvironment {
  readonly subjectHmacKey: string;
  readonly backupRetentionDays: number;
}

export function parsePrivacyEnvironment(environment: Readonly<Record<string, string | undefined>>): PrivacyEnvironment {
  const subjectHmacKey = environment.VERA_PRIVACY_SUBJECT_HMAC_KEY?.trim() ?? "";
  if (subjectHmacKey.length < 32) throw new Error("VERA_PRIVACY_SUBJECT_HMAC_KEY must contain at least 32 characters.");
  const backupRetentionDays = Number.parseInt(environment.VERA_PRIVACY_BACKUP_RETENTION_DAYS ?? "", 10);
  if (!Number.isSafeInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 365) {
    throw new Error("VERA_PRIVACY_BACKUP_RETENTION_DAYS must be an integer from 1 through 365.");
  }
  return { subjectHmacKey, backupRetentionDays };
}
```

The secret is server-only and must not use a `NEXT_PUBLIC_` name.

- [ ] **Step 4: Implement the service**

Define:

```ts
export interface PrivacyLifecycleService {
  exportOwner(input: { userId: VeraUserId; generatedAt: string }): Promise<Uint8Array>;
  issueDeletionChallenge(input: { userId: VeraUserId; now: Date }): Promise<{
    challengeToken: string;
    expiresAt: string;
  }>;
  deleteOwner(input: {
    userId: VeraUserId;
    challengeToken: string;
    confirmation: typeof PRIVACY_DELETION_CONFIRMATION;
    now: Date;
  }): Promise<PrivacyDeletionReceipt>;
}
```

Generate challenge tokens with `randomBytes(32).toString("base64url")`, persist only
`sha256Text(token)`, and clear local variables in `finally`. Compute `subjectDigest` with
`createHmac("sha256", subjectHmacKey).update("vera-privacy-subject:v1:" + providerSubject).digest("hex")`.
Compute `backupEraseAfter` from the configured verified retention days.

Browser revocation calls both `browserGatewayAssignments.revokeForUser` and
`browserConnectorEnrollments.revokeForUser`. Google revocation calls the existing
`application.calendar.oauth.disconnect`. Treat only `GoogleIntegrationOAuthError` code
`provider_revocation_unconfirmed` as a completed local disconnect with `unconfirmed`; propagate all
other unexpected failures before owner deletion.

Compose the repository and service once in `createPostgresApplication`. Add
`privacyLifecycle: PrivacyLifecycleService | null` to `VeraApplication`, with `null` in demo mode.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit apps/web/lib/server/privacy-config.unit.test.ts apps/web/lib/server/privacy-lifecycle-service.unit.test.ts apps/web/lib/server/google-integration-oauth.unit.test.ts
pnpm --filter @vera/web run typecheck
git add apps/web/lib/server/privacy-config.ts apps/web/lib/server/privacy-config.unit.test.ts apps/web/lib/server/privacy-lifecycle-service.ts apps/web/lib/server/privacy-lifecycle-service.unit.test.ts apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts apps/web/lib/server/demo-application.ts
git commit -m "feat: orchestrate privacy revocation"
```

Expected: no raw challenge, HMAC key, provider subject, or browser credential reaches logs or return
values.

---

### Task 5: Add authenticated privacy routes

**Files:**
- Create: `apps/web/app/api/settings/privacy/export/route.ts`
- Create: `apps/web/app/api/settings/privacy/deletion-request/route.ts`
- Create: `apps/web/app/api/settings/privacy/account/route.ts`
- Create: `apps/web/app/api/settings/privacy/routes.integration.test.ts`
- Modify: `scripts/verify-web-mutation-boundaries.ts`
- Modify: `scripts/verify-web-mutation-boundaries.unit.test.ts`

**Interfaces:**
- Consumes: authenticated `requireVeraSession`, same-origin mutation guard, bounded JSON reader, and `application.privacyLifecycle`.
- Produces: owner-only NDJSON export, one-time challenge issuance, two-step deletion, and expired Better Auth cookies.

- [ ] **Step 1: Write failing route tests**

Test:

- unauthenticated export/deletion returns `401`;
- export accepts no user ID and returns NDJSON, attachment, `no-store`, and `nosniff`;
- cross-origin challenge/deletion returns `403` before service calls;
- bodies over 512 bytes for challenge and 1,024 bytes for deletion are rejected;
- malformed or wrong confirmation is `400`;
- challenge response contains only token and expiry and is never audited;
- deletion uses the session owner, returns only `{ status: "deleted", receiptId }`, and expires
  Better Auth's session-token, session-data, and don't-remember cookies through the sign-out
  response; tests cover `vera.*` development names and `__Secure-vera.*` production names;
- service failure is a typed `503` and never claims deletion.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit apps/web/app/api/settings/privacy/routes.integration.test.ts scripts/verify-web-mutation-boundaries.unit.test.ts
```

Expected: FAIL because the route modules are absent and the mutation verifier does not know them.

- [ ] **Step 3: Implement the export route**

Use `runtime = "nodejs"`, `dynamic = "force-dynamic"`, require hosted auth, call
`privacyLifecycle.exportOwner({ userId: session.userId, generatedAt: new Date().toISOString() })`,
and return:

```ts
return new Response(bytes, {
  status: 200,
  headers: {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Disposition": 'attachment; filename="vera-data-export.ndjson"',
    "X-Content-Type-Options": "nosniff"
  }
});
```

Map an oversize export to `413` with code `export_too_large`; never send partial bytes.

- [ ] **Step 4: Implement challenge and account deletion routes**

Both mutation routes call `assertSameOriginMutation` before parsing bounded strict JSON. Challenge
returns `201` and `{ challengeToken, expiresAt }` with `no-store`. Account deletion calls the service
with the exact session owner. After the database commit, call:

```ts
const signOut = await application.auth!.api.signOut({
  headers: request.headers,
  asResponse: true
});
const response = Response.json(
  { status: "deleted", receiptId: receipt.id },
  { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
);
for (const cookie of signOut.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
return response;
```

Do not accept caller-provided owner IDs, retention dates, revocation states, receipt IDs, or provider
identifiers.

- [ ] **Step 5: Register the new mutation surfaces and verify**

Add both mutation routes to the web mutation boundary verifier's authenticated, same-origin,
bounded-body allowlist. Then run:

```sh
pnpm vitest run --project unit apps/web/app/api/settings/privacy/routes.integration.test.ts scripts/verify-web-mutation-boundaries.unit.test.ts
pnpm verify:web-mutation-boundaries
pnpm --filter @vera/web run build
git add apps/web/app/api/settings/privacy scripts/verify-web-mutation-boundaries.ts scripts/verify-web-mutation-boundaries.unit.test.ts
git commit -m "feat: expose owner privacy controls"
```

Expected: every route is owner-derived, CSRF-protected, bounded, and `no-store`.

---

### Task 6: Add the privacy UI and truthful public copy

**Files:**
- Create: `apps/web/app/settings/settings-nav.tsx`
- Create: `apps/web/app/settings/privacy/page.tsx`
- Create: `apps/web/app/settings/privacy/privacy-controls.tsx`
- Create: `apps/web/app/settings/privacy/privacy-controls.unit.test.tsx`
- Modify: `apps/web/app/settings/integrations/page.tsx`
- Modify: `apps/web/app/settings/availability/page.tsx`
- Modify: `apps/web/app/settings/notifications/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/marketing/app/privacy/page.tsx`
- Modify: `apps/marketing/app/privacy/browser-connector/page.tsx`
- Modify: `apps/marketing/app/browser-connector-policy.unit.test.ts`
- Modify: `tests/launch/marketing.spec.ts`

**Interfaces:**
- Consumes: the three authenticated privacy routes and existing `clearBrowserConnection` bridge helper.
- Produces: accessible export and two-step deletion controls, shared settings navigation, local connector clearing, and accurate public privacy language.

- [ ] **Step 1: Write failing UI state tests**

Extract a pure `privacyControlsView` and test these states:

```ts
expect(privacyControlsView({ phase: "idle", typedConfirmation: "" })).toMatchObject({
  exportDisabled: false,
  requestDeletionDisabled: false,
  confirmDeletionVisible: false
});
expect(privacyControlsView({ phase: "confirm", typedConfirmation: "DELETE MY VERA ACCOUNT" })).toMatchObject({
  confirmDeletionVisible: true,
  deleteDisabled: false
});
expect(privacyControlsView({ phase: "confirm", typedConfirmation: "delete my vera account" }).deleteDisabled).toBe(true);
```

Read the marketing privacy files and require `Settings`, `Export`, `Delete`, backup aging, Browser
Connector revocation, and the support address. Continue requiring Chrome Limited Use language.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit apps/web/app/settings/privacy/privacy-controls.unit.test.tsx apps/marketing/app/browser-connector-policy.unit.test.ts
```

Expected: FAIL because the UI and new copy are absent.

- [ ] **Step 3: Implement the settings page and state machine**

The server page requires `requireVeraPageSession`, rejects demo mode with a clear unavailable card,
and renders two separate cards. Export navigates directly to `/api/settings/privacy/export` so the
browser handles the attachment.

Deletion performs:

```text
idle -> requesting_challenge -> confirm -> deleting -> deleted
                              -> error
```

Keep the raw challenge token in React state only. Do not place it in a URL, local/session storage,
analytics, or console. Require the user to type the exact phrase. On a successful response, call
`clearBrowserConnection()` best-effort, erase challenge/confirmation state, and use
`window.location.replace("/sign-in?deleted=1")`. If local clearing is unavailable, server revocation
still succeeds and the UI says the local extension may need manual removal.

Explain before challenge issuance that account/listing/activity data is removed, external Google
and browser access is revoked, and managed backups age out by policy rather than disappearing
instantaneously.

- [ ] **Step 4: Add shared settings navigation and public copy**

`SettingsNav` contains Listings, Integrations, Viewing availability, Notifications, and Privacy,
with one `current` prop setting `aria-current="page"`. Replace duplicate nav markup in the three
existing user settings pages. Add **Privacy** to the home Settings navigation path.

Update public copy to say signed-in testers can export or delete under **Settings → Privacy**. State
that deletion revokes Vera's server-side browser assignment and local connector clearing is
best-effort; managed backups age out under the verified retention schedule. Keep support email as a
recovery path, not the primary privacy mechanism.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit apps/web/app/settings/privacy/privacy-controls.unit.test.tsx apps/marketing/app/browser-connector-policy.unit.test.ts
pnpm test:e2e:launch
pnpm --filter @vera/web run build
pnpm --filter @vera/marketing run build
git add apps/web/app/settings apps/web/app/page.tsx apps/web/app/globals.css apps/marketing/app/privacy apps/marketing/app/browser-connector-policy.unit.test.ts tests/launch/marketing.spec.ts
git commit -m "feat: add self-service privacy settings"
```

Expected: controls are keyboard-accessible, exact-confirmation gated, and public claims match the
implemented behavior.

---

### Task 7: Add restored-backup deletion enforcement and operations documentation

**Files:**
- Create: `scripts/reapply-privacy-deletions.ts`
- Create: `scripts/reapply-privacy-deletions.unit.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/PRIVACY_OPERATIONS.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `docs/BROWSER_BETA_OPERATIONS.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `DATABASE_URL` from the process environment, exact database-name confirmation, mode-`0600` receipt file, and `PrivacyLifecycleRepository.reapplyDeletionReceipt`.
- Produces: `pnpm privacy:reapply-deletions`, count-only restore evidence, current environment documentation, and fail-closed beta gates.

- [ ] **Step 1: Write failing CLI tests**

Test pure argument parsing and injected filesystem/database dependencies. Require rejection of:

- a missing `--confirm` or `--receipt-file`;
- any database URL argument;
- a receipt file not a regular file or with group/other permission bits;
- malformed, duplicate, or identity-bearing receipts;
- confirmation not equal to `new URL(DATABASE_URL).pathname.slice(1)`.

Require success output exactly:

```json
{"checked":2,"absent":1,"reapplied":1,"failed":0}
```

and no email, subject digest, connection string, or record contents.

- [ ] **Step 2: Run tests and require failure**

```sh
pnpm vitest run --project unit scripts/reapply-privacy-deletions.unit.test.ts
```

Expected: FAIL because the CLI is absent.

- [ ] **Step 3: Implement the guarded restore tool**

Expose:

```ts
export interface ReapplyPrivacyDeletionDependencies {
  readonly readReceiptFile: (path: string) => Promise<string>;
  readonly assertPrivateRegularFile: (path: string) => Promise<void>;
  readonly reapply: (receipt: PrivacyDeletionReceipt) => Promise<"absent" | "reapplied">;
}

export async function reapplyPrivacyDeletions(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies?: ReapplyPrivacyDeletionDependencies
): Promise<{ checked: number; absent: number; reapplied: number; failed: number }>;
```

Read a JSON array of strict receipts, sort by completion time and receipt ID, execute one transaction
per receipt, stop with nonzero status if any receipt fails, and print only the count object. The
entry point opens PostgreSQL from `DATABASE_URL` after confirmation; it never accepts or prints a
URL. Register `"privacy:reapply-deletions": "tsx scripts/reapply-privacy-deletions.ts"`.

- [ ] **Step 4: Update operations and security documentation**

Add `VERA_PRIVACY_SUBJECT_HMAC_KEY=` and `VERA_PRIVACY_BACKUP_RETENTION_DAYS=` to `.env.example`
with server-secret and verified-retention comments. Update privacy operations with self-service
routes, receipt handling, restore-before-traffic order, exact cookie/session behavior, and provider
failure recovery. Update Browser Beta activation so the nonfounder gate requires the live rehearsal.

Keep `SEC-013` in **Implemented; live rehearsal required** state. Do not mark it resolved until the
real owner-isolation deletion and isolated restore rehearsal pass. Document that private receipt
files and rehearsal outputs remain gitignored.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit scripts/reapply-privacy-deletions.unit.test.ts
pnpm verify:release-documentation
pnpm format:check
git add scripts/reapply-privacy-deletions.ts scripts/reapply-privacy-deletions.unit.test.ts package.json .env.example docs/PRIVACY_OPERATIONS.md docs/SECURITY_REVIEW.md docs/BROWSER_BETA_OPERATIONS.md docs/POSTGRES_OPERATIONS.md README.md
git commit -m "docs: enforce privacy deletion after restore"
```

Expected: the documented procedure cannot enable external-test access without a successful privacy
rehearsal.

---

### Task 8: Run the complete code gate and open one final PR

**Files:**
- Inspect: every change in `origin/main...HEAD`
- Private write: `/private/tmp/vera-production-browser-beta/pr-body.md`

**Interfaces:**
- Consumes: Tasks 1–7 on one branch.
- Produces: one reviewed PR with one green full CI run and no release mutation yet.

- [ ] **Step 1: Run focused security and persistence gates**

```sh
pnpm verify:web-runtime-boundaries
pnpm verify:web-mutation-boundaries
pnpm verify:browser-boundaries
pnpm verify:browser-assignments
pnpm verify:vera-openclaw-extension
pnpm verify:vera-connector-store
pnpm verify:gateway-runtime-supply-chain
pnpm verify:gateway-release-workflow
pnpm verify:heroku-production
pnpm vitest run --project unit apps/web/lib/display-time.unit.test.ts packages/domain/src/privacy-lifecycle.unit.test.ts packages/db/src/postgres/privacy-owner-table-policy.unit.test.ts apps/web/lib/server/privacy-config.unit.test.ts apps/web/lib/server/privacy-lifecycle-service.unit.test.ts apps/web/app/api/settings/privacy/routes.integration.test.ts apps/web/app/settings/privacy/privacy-controls.unit.test.tsx scripts/reapply-privacy-deletions.unit.test.ts
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm vitest run --project postgres-integration packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts packages/db/src/postgres/browser-gateway-assignment-repository.integration.test.ts
pnpm exec playwright test tests/e2e/hydration.spec.ts tests/e2e/browser-agent.spec.ts tests/e2e/inbox.spec.ts
```

Expected: every focused check exits zero.

- [ ] **Step 2: Run the repository gate once on final branch state**

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres
pnpm build
git diff --check origin/main...HEAD
```

Expected: all commands exit zero. Do not rerun full CI after making any code change; if a fix is
needed, rerun the affected focused test and then the complete final gate again.

- [ ] **Step 3: Audit secrets, policies, schema, and scope**

```sh
git diff --name-status origin/main...HEAD
git diff origin/main...HEAD -- . ':!docs/superpowers/plans/*' ':!docs/superpowers/specs/*'
rg -n -i 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|postgres(?:ql)?://|refresh[_-]?token|relay[_-]?(token|secret)|checkpoint[_-]?(token|secret)|pairing[_-]?(token|secret)' $(git diff --name-only origin/main...HEAD)
```

Expected: the regex finds only schema/test/documentation identifiers with sanitized values; no raw
secret, private URL, tester identity, arbitrary browser surface, or destructive migration appears.

- [ ] **Step 4: Push and open one ready PR**

Write a PR body containing the outcome, migration order, hydration reproduction/fix, privacy model,
focused/full commands, browser boundaries, deployment gates, rollback, and live acceptance still
required. Then:

```sh
git push -u origin codex/production-browser-beta-first-tester
gh pr create --base main --head codex/production-browser-beta-first-tester --title "feat: ready Vera for the first browser beta tester" --body-file /private/tmp/vera-production-browser-beta/pr-body.md
```

- [ ] **Step 5: Watch CI and merge only when green**

```sh
gh pr checks --watch "$(gh pr view --json number --jq .number)"
gh pr merge "$(gh pr view --json number --jq .number)" --merge --delete-branch=false
```

Expected: all workspace, PostgreSQL, Playwright, Heroku image, Gateway image/scan, and policy checks
are green; GitHub returns one merge commit.

---

### Task 9: Back up, migrate, and deploy the paired application release

**Files:**
- Private evidence directory: `/private/tmp/vera-production-browser-beta/application-release`
- Read: `infra/heroku/production-manifest.json`

**Interfaces:**
- Consumes: merged main SHA, existing Heroku app `vera-housing-app`, current Essential-0 database, and protected environment values.
- Produces: current migration ledger, paired web/worker containers from one SHA, ready production application, browser gates still off, and preserved data.

- [ ] **Step 1: Resolve the merged release and freeze browser work**

Fetch `main`, resolve its full SHA, confirm the PR merge is its ancestor, set
`VERA_BROWSER_DISABLED=1`, keep routing/enrollment `0`, and verify zero queued/dispatched/running
browser jobs through safe status/count queries. Record only IDs/counts/statuses.

- [ ] **Step 2: Capture the data safety boundary**

Run `heroku pg:backups:capture --app vera-housing-app`, wait for completion, record the backup ID,
current migration ledger, safe per-table counts, zero forbidden-action count, current app release,
and existing Gateway digests. Do not download or print the database URL or private rows.

- [ ] **Step 3: Configure privacy secrets without exposing them**

Generate a fresh 32-byte-or-longer HMAC value through the approved secret UI/flow, store it only as
`VERA_PRIVACY_SUBJECT_HMAC_KEY`, and set `VERA_PRIVACY_BACKUP_RETENTION_DAYS` to the actual Heroku
backup-retention interval verified in the dashboard. Never place the secret in command arguments,
clipboard evidence, or logs. Keep a safe record of only the variable name and configuration change
time.

- [ ] **Step 4: Apply migrations before releasing code**

Run a one-off dyno from the reviewed source/image with `pnpm db:migrate`. Verify migration `0010` is
current and the pre-release safe counts still match. If migration or preservation fails, stop and
retain the current app release.

- [ ] **Step 5: Build, publish, and release paired app images**

Build `Dockerfile.web` and repository `Dockerfile` for `linux/amd64`, label both with the exact merged
SHA, push both to the existing Heroku registry, inspect their labels/users/healthchecks, and release
`web worker` together. Keep each at one Eco dyno and `VERA_DB_POOL_MAX=3`.

- [ ] **Step 6: Verify production before browser activation**

Require:

```text
https://app.verahousing.app/api/health -> 200, status ok
https://app.verahousing.app/api/ready  -> 200, database ready, migration current
```

Sign in as founder and test inbox, listing detail, settings, privacy export, challenge cancellation,
browser settings, and activity routes while capturing browser console/page errors. Require no React
hydration error and preserve existing listing counts. Confirm marketing remains live at
`https://verahousing.app` and its connector link remains gated until Store publication.

- [ ] **Step 7: Record and test application rollback**

Record the previous Heroku release ID and exact paired image revisions before release. Exercise the
rollback decision without changing production: browser flags return to disabled first, then
`heroku releases:rollback` targets the recorded paired release only if readiness, authentication,
hydration, or data-preservation acceptance fails. Additive migrations and privacy receipts remain;
never delete PostgreSQL rows to match older code. A later retry uses a newly reviewed app release.

---

### Task 10: Rehearse the nonfounder privacy lifecycle

**Files:**
- Private evidence directory: `/private/tmp/vera-production-browser-beta/privacy-rehearsal`
- Private receipt file: `/private/tmp/vera-production-browser-beta/privacy-rehearsal/deletion-receipts.json`

**Interfaces:**
- Consumes: deployed privacy lifecycle, one consented nonfounder rehearsal account, current backup policy, and isolated rehearsal database.
- Produces: evidence sufficient to move `SEC-013` from live-rehearsal-required to resolved for one external tester.

- [ ] **Step 1: Create and isolate the rehearsal account**

Invite one founder-controlled, dedicated nonfounder rehearsal identity through the existing beta
review flow. This identity receives no Browser Connector assignment and is not the real external
tester. Sign in manually, create sanitized owner-specific listing/settings/activity data, and
confirm founder and rehearsal rows are distinguishable by UUID without printing emails or content.

- [ ] **Step 2: Export and inspect the rehearsal account**

Download the NDJSON through Settings → Privacy. Verify schema version, owner UUID, UTC cutoff,
record counts/hashes, inclusion of rehearsal-owned records, absence of founder sentinels, and absence
of forbidden credential keys. Delete the downloaded operator copy after retaining only safe hashes
and counts.

- [ ] **Step 3: Delete through the two-step UI**

Request a challenge, type `DELETE MY VERA ACCOUNT`, and confirm the browser reaches signed-out state.
Verify all owner-table counts are zero, sessions fail, Google local ciphertext is absent, browser
assignment/tickets/devices cannot dispatch, the founder account is unchanged, and the receipt has no
identity fields. Store the strict receipt in the private mode-`0600` file.

- [ ] **Step 4: Prove restored-backup enforcement**

Restore a sanitized pre-delete backup into an isolated rehearsal database with no traffic. Run:

```sh
pnpm privacy:reapply-deletions --confirm vera_privacy_rehearsal --receipt-file /private/tmp/vera-production-browser-beta/privacy-rehearsal/deletion-receipts.json
```

Expected: `failed` is zero, the restored deleted owner is absent, the founder remains present, and
no private value appears in output. Destroy only the isolated rehearsal database after recording
safe evidence; do not touch production PostgreSQL.

- [ ] **Step 5: Record the go/no-go decision**

If every check passes, record `SEC-013 resolved for two-user private beta` in private release
evidence with commit, release, backup retention, receipt ID, safe counts, and timestamps. If any
check fails, keep nonfounder Browser Connector access disabled and continue founder-only operation.

---

### Task 11: Publish immutable browser artifacts and accept the founder

**Files:**
- Private evidence directory: `/private/tmp/vera-production-browser-beta/founder-browser`
- Read: `docs/CHROME_WEB_STORE_RELEASE.md`
- Read: `docs/BROWSER_BETA_OPERATIONS.md`

**Interfaces:**
- Consumes: merged main SHA, verified extension `2.2.0`, release workflow, founder assignment, retained infrastructure, and fresh credentials.
- Produces: private Store item, signed Gateway digest, accepted founder enrollment, and fully revoked end state.

- [ ] **Step 1: Package and verify exact extension bytes**

```sh
pnpm verify:vera-openclaw-extension
pnpm verify:vera-connector-store
pnpm package:vera-browser-connector
```

Record version, ZIP SHA-256, manifest permission list, and source SHA only. Confirm the package has no
credentials, environment-specific host, unrelated remote code, or widened permission.

- [ ] **Step 2: Submit the private Chrome Web Store item**

Use the founder's Store session, upload the verified ZIP, complete the reviewed listing/privacy
answers, choose private distribution, and allowlist only the founder initially. This submission is a
human-confirmed external action. After Store publication, set the marketing release status and exact
Store URL, deploy marketing, and verify only the approved published URL renders.

- [ ] **Step 3: Publish the new Gateway image from merged main**

Run the manual `release-openclaw-gateway.yml` workflow with the exact full merged main SHA. Require
success, then record immutable image reference, signature identity, SBOM/provenance attestations,
runtime lock hash, and zero HIGH/CRITICAL scan results. Do not replace either accepted rollback
digest.

- [ ] **Step 4: Rotate and recreate only stateless founder browser services**

With browser work killed and PostgreSQL untouched, create fresh relay, checkpoint, bootstrap seed,
plan-signing, and scoped Maritime credentials through protected flows. Recreate only founder
Gateway/checkpoint containers using the new digest and existing bounded configuration. Verify
health, delete the old relay credential, and never print or recover old values.

- [ ] **Step 5: Accept one-click founder enrollment**

Enable routing/enrollment only for the exact founder while keeping browser jobs disabled. Install
the private Store extension, sign in to Vera, accept the read-only disclosure, and click
**Connect this browser**. Restart Chrome/extension and verify automatic reconnect, exact extension
version/protocol, and shared-tab count zero.

- [ ] **Step 6: Run and revoke the founder browser flow**

Share exactly one dedicated Vera Search tab and run the user-triggered approved source search.
Verify RawListing, provenance, normalization, dedupe, deterministic scoring, canonical inbox,
source-failure isolation, and forbidden actions zero. Unshare and require the next run to return
`tab_required`/`no_shared_tab` with zero imports. Revoke from Vera, clear local extension access,
rotate/delete credentials, and verify shared tabs `0`, established connections `0`, clipboard bytes
`0`, and forbidden actions `0`.

- [ ] **Step 7: Record and test browser rollback**

If enrollment, reconnect, checkpoint, search, unshare, or revocation acceptance fails, immediately
set the global browser kill switch, disable routing/enrollment, stop the candidate stateless
containers, and restore the accepted immutable Gateway digest. Generate new credentials before any
retry; never restore an old relay, checkpoint, bootstrap seed, enrollment ticket, or pairing value.
Verify PostgreSQL listing/provenance data remains unchanged by the transport rollback.

---

### Task 12: Provision and accept the first external tester

**Files:**
- Private evidence directory: `/private/tmp/vera-production-browser-beta/tester-1-browser`

**Interfaces:**
- Consumes: green privacy rehearsal, accepted founder release, exact recurring DigitalOcean quote, private Store item, and one consented tester identity.
- Produces: one isolated accepted tester and a fail-closed two-user private beta.

- [ ] **Step 1: Approve the exact tester infrastructure cost**

Inspect the current DigitalOcean quote for one dedicated tester Droplet and Regional Load Balancer.
Present the exact monthly recurring amount and use existing student credits only when the account
shows them. Do not create resources until that exact amount receives separate approval.

- [ ] **Step 2: Admit only the intended tester**

Invite the consented tester through Vera beta review and add only that Google account to the private
Store tester list. Confirm an unrelated account remains at `/access-pending` and cannot read APIs or
receive a browser assignment.

- [ ] **Step 3: Provision an isolated assignment**

Create a tester-only Droplet, load-balancer path, Gateway/checkpoint container set, Maritime agent,
node/profile, secret namespace, relay/checkpoint/bootstrap/signing credentials, and PostgreSQL
assignment. Reuse code/images, never founder infrastructure or credentials. Keep browser jobs
disabled while enrollment is accepted.

- [ ] **Step 4: Accept connection and restart persistence**

The tester installs the private Store extension, signs in manually, clicks **Connect this browser**,
and confirms the disclosure. Restart Chrome/extension and prove connected state persists with zero
shared tabs. Attempt wrong-owner routing and require typed denial without revealing either
assignment.

- [ ] **Step 5: Run bounded tester listing acceptance**

The tester explicitly shares one dedicated tab and triggers one approved bounded housing search.
Verify at least one real listing enters RawListing → provenance → normalization → dedupe → scoring →
canonical inbox under the tester owner only. Verify a source failure preserves successful sources,
no founder row changes, and no forbidden action occurs.

- [ ] **Step 6: Prove revocation and finish in a safe state**

Unshare and require typed `no_shared_tab` with zero imports. Revoke server access and local connector
state, rotate/delete raw credentials, and verify shared tabs, established connections, clipboard
bytes, and forbidden actions are all zero. Leave only the explicitly approved private-beta accounts
allowlisted; keep scheduled/background browser polling disabled.

- [ ] **Step 7: Completion audit**

Reconcile every acceptance item in the approved specification against authoritative evidence:

- merged PR and merge SHA;
- green full CI run;
- paired Heroku release and current migrations;
- preserved listing/database counts;
- hydration-free authenticated browser routes;
- live owner export/deletion/restore rehearsal;
- private Store version and package hash;
- signed Gateway digest, SBOM, provenance, and zero HIGH/CRITICAL scan;
- founder and tester isolation/import/unshare/revocation evidence;
- existing four-source regression; and
- forbidden actions zero.

Only after every item is proven may the release be described as ready for the founder and first
external tester. Any missing Store review, payment approval, manual login, live-site blocker, or
tester participation remains a visible incomplete gate rather than a waived requirement.
