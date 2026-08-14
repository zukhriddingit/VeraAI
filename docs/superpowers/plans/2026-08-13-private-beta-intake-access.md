# Private Beta Intake and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect consented email-only private-beta requests, give an exact founder-admin review queue, and require an active invitation in addition to Google identity before protected Vera data is accessible.

**Architecture:** Add global PostgreSQL repositories for beta requests, memberships, and short-lived HMAC rate-limit buckets; they sit outside tenant repositories because approval precedes account ownership. Keep the public submission endpoint narrow and enumeration-resistant. Gate account creation, session creation, protected page/API access, and revocation independently, with a disabled-by-default cutover flag and a founder bootstrap transaction.

**Tech Stack:** TypeScript 6.0.3, Zod 4.4.3, Next.js 16.2.10 App Router, Better Auth 1.6.23, Drizzle ORM, PostgreSQL, Vitest 4.1.10, Playwright 1.61.1, Heroku.

## Global Constraints

- Work only in `/private/tmp/vera-m13b-pr75-live-20260811` on branch `codex/private-beta-launch-polish`.
- `/beta` asks for one user-supplied field, email, plus one unchecked contact-consent checkbox; it asks for no password, phone, housing facts, OAuth grant, or payment.
- `POST /api/beta-access` accepts bounded same-origin JSON, current consent version, and an empty honeypot.
- Email normalization is Unicode NFKC, trim, and lower-case before validation and persistence.
- The endpoint stores one idempotent request per normalized email and returns the same `202` body for new and repeated valid requests.
- The response and logs never reveal whether an email already has an account, request, invitation, or membership.
- Rate limiting stores only a short-lived HMAC digest; raw IP addresses and submitted emails are never logged.
- Submission never provisions an account, sends an email, adds a Chrome Store tester, or issues pairing material.
- Beta review requires a valid Vera session and exact UUID membership in `VERA_BETA_ADMIN_USER_IDS`; missing configuration denies every admin operation.
- Google identity is not authorization. Every protected page and API requires an active beta membership after the gate is enabled.
- Only a verified Google email exactly matching an invited membership may create a new identity.
- Revocation invalidates all sessions for the bound user and denies future tenant repository access.
- Before any nonfounder invitation is activated, authenticated users can export their owner-scoped data and delete their account through a rehearsed self-service flow with provider revocation, browser revocation, deletion receipts, and backup-erasure tracking.
- Free-form reviewer notes are not stored.
- Migrations are additive and preserve every listing, provenance, score, job, activity event, and existing user.
- Seed and verify the founder's active membership before setting `VERA_BETA_ACCESS_GATE_ENABLED=1`.
- `/demo`, `/beta`, `/api/beta-access`, `/sign-in`, Better Auth callback assets, `/api/health`, and `/api/ready` remain public.
- Run focused checks while iterating and one full CI run only on the final combined PR.

## File Map

- Create `packages/domain/src/beta-access.ts`: request, membership, review, and API schemas.
- Create `packages/domain/src/beta-access.unit.test.ts`: normalization and non-enumerating contract tests.
- Modify `packages/domain/src/index.ts`: export beta contracts.
- Modify `packages/db/src/postgres/schema.ts`: add three global tables.
- Create `packages/db/drizzle/0007_private_beta_access.sql` and generated snapshot metadata.
- Create `packages/db/src/postgres/beta-access-repository.ts`: transactional global repository.
- Create `packages/db/src/postgres/beta-access-repository.integration.test.ts`: idempotency, binding, transition, rate-limit, and revocation tests.
- Modify `packages/db/src/index.ts`: export repository types.
- Modify `apps/web/lib/server/application-registry.ts`, `application.ts`, and `demo-application.ts`: register hosted global beta repository or `null` in demo mode.
- Create `apps/web/lib/server/beta-access-security.ts`: public mutation guard and HMAC client-network key.
- Create `apps/web/app/api/beta-access/route.ts`: public submission route.
- Create `apps/web/app/beta/page.tsx`, `beta-access-form.tsx`, and CSS.
- Create `apps/web/lib/server/beta-admin-auth.ts`: exact UUID allowlist.
- Create `/settings/beta` queue and admin API routes.
- Modify Better Auth creation, `requireVeraSession`, and page redirects to enforce memberships.
- Create `apps/web/app/access-pending/page.tsx`: generic denied/waiting page.
- Create `scripts/bootstrap-beta-founder.ts`: confirmed one-user bootstrap and verification.
- Create `packages/db/src/postgres/privacy-lifecycle-repository.ts`: safe export, deletion challenge, owner deletion, and backup-erasure receipt operations.
- Create authenticated privacy export and two-step account-deletion routes and settings UI.
- Create `scripts/reapply-privacy-deletions.ts`: fail-closed restore-time tombstone enforcement.
- Modify `scripts/verify-web-mutation-boundaries.ts`: recognize only the named public beta guard.
- Create `docs/PRIVATE_BETA_OPERATIONS.md`: rollout and rollback runbook.

---

### Task 1: Define the beta access contracts

**Files:**
- Create: `packages/domain/src/beta-access.ts`
- Create: `packages/domain/src/beta-access.unit.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `VeraUserIdSchema` and `IsoDateTimeSchema` from `@vera/domain` primitives.
- Produces: `normalizeBetaEmail`, `BetaAccessSubmissionSchema`, `BetaAccessAcceptedResponseSchema`, `BetaAccessReviewSchema`, `BetaAccessRequest`, and `BetaMembership`.

- [ ] **Step 1: Write failing normalization and schema tests**

```ts
import { describe, expect, it } from "vitest";
import {
  BETA_CONSENT_VERSION,
  BetaAccessAcceptedResponseSchema,
  BetaAccessSubmissionSchema,
  normalizeBetaEmail
} from "./beta-access.ts";

describe("beta access contracts", () => {
  it("normalizes an email before validating it", () => {
    expect(normalizeBetaEmail("  TESTER＠EXAMPLE.COM  ")).toBe("tester@example.com");
  });

  it("requires current consent and an empty honeypot", () => {
    expect(BetaAccessSubmissionSchema.parse({
      email: "tester@example.com",
      consent: true,
      consentVersion: BETA_CONSENT_VERSION,
      website: ""
    }).email).toBe("tester@example.com");
    expect(() => BetaAccessSubmissionSchema.parse({
      email: "tester@example.com",
      consent: false,
      consentVersion: BETA_CONSENT_VERSION,
      website: ""
    })).toThrow();
    expect(() => BetaAccessSubmissionSchema.parse({
      email: "tester@example.com",
      consent: true,
      consentVersion: BETA_CONSENT_VERSION,
      website: "bot"
    })).toThrow();
  });

  it("has one enumeration-resistant accepted response", () => {
    expect(BetaAccessAcceptedResponseSchema.parse({ accepted: true, code: "request_received" }))
      .toEqual({ accepted: true, code: "request_received" });
  });
});
```

- [ ] **Step 2: Run the test and verify the contract is missing**

Run: `pnpm exec vitest run --project unit packages/domain/src/beta-access.unit.test.ts`

Expected: FAIL because `beta-access.ts` does not exist.

- [ ] **Step 3: Implement the complete domain contract**

```ts
import { z } from "zod";
import { VeraUserIdSchema } from "./identity.ts";

export const BETA_CONSENT_VERSION = "vera-private-beta-contact.v1" as const;
export const BetaAccessRequestStatusSchema = z.enum(["requested", "invited", "declined", "withdrawn"]);
export const BetaMembershipStatusSchema = z.enum(["invited", "active", "revoked"]);

export function normalizeBetaEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export const BetaEmailSchema = z.string().max(320).transform(normalizeBetaEmail).pipe(z.email().max(320));
export const BetaAccessSubmissionSchema = z.object({
  email: BetaEmailSchema,
  consent: z.literal(true),
  consentVersion: z.literal(BETA_CONSENT_VERSION),
  website: z.literal("")
}).strict();
export const BetaAccessAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
  code: z.literal("request_received")
}).strict();
export const BetaAccessReviewSchema = z.object({
  action: z.enum(["invite", "decline", "withdraw"])
}).strict();

export interface BetaAccessRequest {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly status: z.infer<typeof BetaAccessRequestStatusSchema>;
  readonly consentVersion: typeof BETA_CONSENT_VERSION;
  readonly consentedAt: Date;
  readonly requestedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewedByUserId: z.infer<typeof VeraUserIdSchema> | null;
}

export interface BetaMembership {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly userId: z.infer<typeof VeraUserIdSchema> | null;
  readonly status: z.infer<typeof BetaMembershipStatusSchema>;
  readonly invitedAt: Date;
  readonly activatedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly approvedByUserId: z.infer<typeof VeraUserIdSchema> | null;
}
```

Export it from `packages/domain/src/index.ts` with `export * from "./beta-access.ts";`.

- [ ] **Step 4: Run unit and type checks**

Run: `pnpm exec vitest run --project unit packages/domain/src/beta-access.unit.test.ts && pnpm --filter @vera/domain run typecheck`

Expected: 3 tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit the contracts**

```sh
git add packages/domain/src/beta-access.ts packages/domain/src/beta-access.unit.test.ts packages/domain/src/index.ts
git commit -m "feat: define private beta access contracts"
```

---

### Task 2: Persist global requests, memberships, and rate-limit buckets

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/src/postgres/beta-access-repository.ts`
- Create: `packages/db/src/postgres/beta-access-repository.integration.test.ts`
- Create: `packages/db/drizzle/0007_private_beta_access.sql`
- Create: `packages/db/drizzle/meta/0007_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/demo-application.ts`

**Interfaces:**
- Consumes: domain types from Task 1 and hosted `PostgresConnection`.
- Produces: `BetaAccessRepository` with `submit`, `consumeRateLimit`, `listRequests`, `review`, `findInvitedByEmail`, `isActiveUser`, `bindInvitedMembership`, `revoke`, and `bootstrapExistingUser`.

- [ ] **Step 1: Write failing PostgreSQL integration cases**

```ts
it("stores one request for repeated normalized email", async () => {
  const first = await repository.submit({ email: "tester@example.com", consentVersion: BETA_CONSENT_VERSION, now });
  const repeated = await repository.submit({ email: "TESTER@example.com", consentVersion: BETA_CONSENT_VERSION, now: later });
  expect(repeated.id).toBe(first.id);
  expect(await repository.listRequests("requested")).toHaveLength(1);
});

it("invites and binds one verified identity atomically", async () => {
  const request = await repository.submit({ email: "tester@example.com", consentVersion: BETA_CONSENT_VERSION, now });
  await repository.review({ requestId: request.id, action: "invite", reviewerUserId: founderId, now });
  const membership = await repository.bindInvitedMembership({ email: "tester@example.com", userId: testerId, now: later });
  expect(membership).toMatchObject({ userId: testerId, status: "active" });
  await expect(repository.bindInvitedMembership({ email: "tester@example.com", userId: otherId, now: later })).rejects.toThrow();
});

it("revokes membership and deletes every existing session", async () => {
  await seedActiveMemberAndSession(connection, testerId);
  await repository.revoke({ membershipId, reviewerUserId: founderId, now });
  expect(await repository.isActiveUser(testerId)).toBe(false);
  expect(await countSessions(connection, testerId)).toBe(0);
});

it("enforces a short-lived opaque rate bucket", async () => {
  expect(await repository.consumeRateLimit({ keyDigest: "a".repeat(64), now, windowSeconds: 600, maximum: 2 })).toBe(true);
  expect(await repository.consumeRateLimit({ keyDigest: "a".repeat(64), now, windowSeconds: 600, maximum: 2 })).toBe(true);
  expect(await repository.consumeRateLimit({ keyDigest: "a".repeat(64), now, windowSeconds: 600, maximum: 2 })).toBe(false);
});
```

- [ ] **Step 2: Run PostgreSQL tests and verify the repository is missing**

Run: `pnpm exec vitest run --project postgres-integration packages/db/src/postgres/beta-access-repository.integration.test.ts`

Expected: FAIL because `beta-access-repository.ts` does not exist.

- [ ] **Step 3: Add the three-table schema and repository contract**

Add Drizzle tables equivalent to this SQL, then generate migration `0007` with `pnpm db:generate` and inspect that it is additive:

```sql
CREATE TABLE "beta_access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_email" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "consent_version" text NOT NULL,
  "consented_at" timestamptz NOT NULL,
  "requested_at" timestamptz NOT NULL,
  "reviewed_at" timestamptz,
  "reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "beta_access_requests_email_unique" UNIQUE("normalized_email"),
  CONSTRAINT "beta_access_requests_normalized_email_check" CHECK ("normalized_email" = lower(btrim("normalized_email"))),
  CONSTRAINT "beta_access_requests_status_check" CHECK ("status" IN ('requested','invited','declined','withdrawn'))
);
CREATE TABLE "beta_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_email" text NOT NULL UNIQUE,
  "user_id" uuid UNIQUE REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'invited' NOT NULL,
  "invited_at" timestamptz NOT NULL,
  "activated_at" timestamptz,
  "revoked_at" timestamptz,
  "approved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "beta_memberships_status_check" CHECK ("status" IN ('invited','active','revoked'))
);
CREATE TABLE "beta_access_rate_limits" (
  "key_digest" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "beta_access_rate_limits_digest_check" CHECK ("key_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "beta_access_rate_limits_attempts_check" CHECK ("attempts" > 0)
);
```

Define the exact repository:

```ts
export interface BetaAccessRepository {
  submit(input: { readonly email: string; readonly consentVersion: string; readonly now: Date }): Promise<BetaAccessRequest>;
  consumeRateLimit(input: { readonly keyDigest: string; readonly now: Date; readonly windowSeconds: number; readonly maximum: number }): Promise<boolean>;
  listRequests(status?: "requested" | "invited" | "declined" | "withdrawn"): Promise<readonly BetaAccessRequest[]>;
  review(input: { readonly requestId: string; readonly action: "invite" | "decline" | "withdraw"; readonly reviewerUserId: VeraUserId; readonly now: Date }): Promise<BetaAccessRequest>;
  findInvitedByEmail(email: string): Promise<BetaMembership | null>;
  isActiveUser(userId: VeraUserId): Promise<boolean>;
  bindInvitedMembership(input: { readonly email: string; readonly userId: VeraUserId; readonly now: Date }): Promise<BetaMembership>;
  revoke(input: { readonly membershipId: string; readonly reviewerUserId: VeraUserId; readonly now: Date }): Promise<BetaMembership>;
  bootstrapExistingUser(input: { readonly userId: VeraUserId; readonly approvedByUserId: VeraUserId; readonly now: Date }): Promise<BetaMembership>;
}
```

Use transactions for `review`, binding, revocation, and bootstrap. `submit` uses `INSERT ... ON CONFLICT (normalized_email) DO UPDATE SET normalized_email = excluded.normalized_email RETURNING *`, without changing original consent/request timestamps. `review(invite)` upserts a membership only for the request email. `revoke` updates membership and deletes `sessions` by `user_id` in the same transaction. Rate-limit cleanup deletes only rows whose `expires_at < now` and caps at 100 deletions per call.

Add `readonly betaAccess: BetaAccessRepository | null` to `VeraApplication`; hosted application constructs it from the existing connection, and demo application sets it to `null`.

- [ ] **Step 4: Generate, inspect, and test the migration**

Run: `pnpm db:generate && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/beta-access-repository.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

Expected: generated migration has only `CREATE TABLE`, constraints, and indexes; all focused PostgreSQL tests PASS.

- [ ] **Step 5: Commit persistence**

```sh
git add packages/db packages/domain/src/index.ts apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts apps/web/lib/server/demo-application.ts
git commit -m "feat: persist private beta approvals"
```

---

### Task 3: Add the public, bounded, enumeration-resistant intake

**Files:**
- Create: `apps/web/lib/server/beta-access-security.ts`
- Create: `apps/web/lib/server/beta-access-security.unit.test.ts`
- Create: `apps/web/app/api/beta-access/route.ts`
- Create: `apps/web/app/api/beta-access/route.unit.test.ts`
- Create: `apps/web/app/beta/page.tsx`
- Create: `apps/web/app/beta/beta-access-form.tsx`
- Create: `apps/web/app/beta/beta-access.module.css`
- Modify: `scripts/verify-web-mutation-boundaries.ts`
- Modify: `scripts/verify-web-mutation-boundaries.unit.test.ts`

**Interfaces:**
- Consumes: `VeraApplication.betaAccess`, Task 1 schemas, `assertSameOriginMutation`, and `readBoundedJson`.
- Produces: `requirePublicBetaSubmissionBoundary(request, repository, environment)`, `POST /api/beta-access`, and `/beta`.

- [ ] **Step 1: Write failing security and route tests**

```ts
it("derives an opaque key without returning or logging the network value", () => {
  const digest = betaRateLimitDigest("203.0.113.0/24", { VERA_BETA_RATE_LIMIT_KEY: "k".repeat(32) });
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(digest).not.toContain("203.0.113");
});

it("returns the same response for new and duplicate requests", async () => {
  repository.submit.mockResolvedValue(requestRecord);
  const first = await POST(betaRequest("tester@example.com"), application);
  const repeated = await POST(betaRequest("TESTER@example.com"), application);
  expect(first.status).toBe(202);
  expect(repeated.status).toBe(202);
  await expect(first.json()).resolves.toEqual({ accepted: true, code: "request_received" });
  await expect(repeated.json()).resolves.toEqual({ accepted: true, code: "request_received" });
});

it("does not write when rate limited or trapped by the honeypot", async () => {
  repository.consumeRateLimit.mockResolvedValue(false);
  expect((await POST(betaRequest("tester@example.com"), application)).status).toBe(429);
  expect(repository.submit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify the security boundary is missing**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/beta-access-security.unit.test.ts apps/web/app/api/beta-access/route.unit.test.ts scripts/verify-web-mutation-boundaries.unit.test.ts`

Expected: FAIL because the beta modules do not exist.

- [ ] **Step 3: Implement the named public guard and route**

```ts
import { createHmac } from "node:crypto";
import type { BetaAccessRepository } from "@vera/db";
import { assertSameOriginMutation } from "./request-security.ts";

export function betaRateLimitDigest(value: string, environment: Readonly<Record<string, string | undefined>>): string {
  const key = environment.VERA_BETA_RATE_LIMIT_KEY?.trim();
  if (!key || key.length < 32) throw new Error("VERA_BETA_RATE_LIMIT_KEY must contain at least 32 characters.");
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function trustedClientNetwork(request: Request, environment: Readonly<Record<string, string | undefined>>): string {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === "127.0.0.1" || requestUrl.hostname === "localhost") return "loopback-development";
  if (environment.NODE_ENV !== "production" || environment.VERA_TRUST_HEROKU_ROUTER !== "1") {
    throw new Error("Trusted production router configuration is required for beta intake.");
  }
  const value = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/iu.test(value)) throw new Error("Trusted client network is unavailable.");
  return value;
}

export async function requirePublicBetaSubmissionBoundary(
  request: Request,
  repository: BetaAccessRepository,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  assertSameOriginMutation(request);
  const allowed = await repository.consumeRateLimit({
    keyDigest: betaRateLimitDigest(trustedClientNetwork(request, environment), environment),
    now: new Date(),
    windowSeconds: 600,
    maximum: 5
  });
  if (!allowed) throw Object.assign(new Error("rate_limited"), { status: 429 });
}
```

The route must call `requirePublicBetaSubmissionBoundary` before `readBoundedJson(request, { maxBytes: 2048 })`, parse `BetaAccessSubmissionSchema`, return the same `BetaAccessAcceptedResponseSchema` body and status `202`, and log only `{ requestId, outcomeCode, durationMs }`. Honeypot failures return the same 202 response without persistence so bots receive no signal. Invalid JSON/schema returns `400`; rate limiting returns `429`; repository failure returns `503` with `{ accepted: false, code: "try_again" }`.

Update the mutation verifier so `requirePublicBetaSubmissionBoundary(` is recognized as both the authentication-equivalent named public guard and the origin guard only for `apps/web/app/api/beta-access/route.ts`; a mutation in any other file using it must report `public beta guard is restricted to the beta-access route`. Keep every existing route requirement unchanged.

Build the `/beta` form with an email input, unchecked consent checkbox, visually hidden `website` honeypot, privacy link `https://verahousing.app/privacy`, and submit JSON containing the fixed consent version. Show the identical success copy: “Request received. We’ll contact approved testers with next steps.” Do not call Google sign-in or imply acceptance.

- [ ] **Step 4: Run route, verifier, and web build checks**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/beta-access-security.unit.test.ts apps/web/app/api/beta-access/route.unit.test.ts scripts/verify-web-mutation-boundaries.unit.test.ts && pnpm verify:web-mutation-boundaries && pnpm --filter @vera/web run build`

Expected: focused tests PASS, the verifier prints `Web mutation boundaries validated.`, and `/beta` plus `/api/beta-access` build.

- [ ] **Step 5: Commit intake**

```sh
git add apps/web/app/beta apps/web/app/api/beta-access apps/web/lib/server/beta-access-security.ts apps/web/lib/server/beta-access-security.unit.test.ts scripts/verify-web-mutation-boundaries.ts scripts/verify-web-mutation-boundaries.unit.test.ts
git commit -m "feat: add private beta request intake"
```

---

### Task 4: Add an exact-admin review queue

**Files:**
- Create: `apps/web/lib/server/beta-admin-auth.ts`
- Create: `apps/web/lib/server/beta-admin-auth.unit.test.ts`
- Create: `apps/web/app/settings/beta/page.tsx`
- Create: `apps/web/app/settings/beta/beta-review-queue.tsx`
- Create: `apps/web/app/api/settings/beta/route.ts`
- Create: `apps/web/app/api/settings/beta/[id]/route.ts`
- Create: `apps/web/app/api/settings/beta/routes.integration.test.ts`

**Interfaces:**
- Consumes: authenticated `VeraRequestContext` and `BetaAccessRepository.review`.
- Produces: `requireBetaAdmin(userId, environment)`, queue GET, and idempotent review PATCH.

- [ ] **Step 1: Write failing deny-by-default and transition tests**

```ts
it("denies when the beta admin allowlist is missing", () => {
  expect(() => requireBetaAdmin(founderId, {})).toThrow("Beta administrator access is required.");
});

it("accepts only an exact configured UUID", () => {
  expect(requireBetaAdmin(founderId, { VERA_BETA_ADMIN_USER_IDS: founderId })).toBe(founderId);
  expect(() => requireBetaAdmin(otherId, { VERA_BETA_ADMIN_USER_IDS: founderId })).toThrow();
});

it("reviews after session, origin, and bounded-body checks", async () => {
  const response = await PATCH(reviewRequest("invite"), { params: Promise.resolve({ id: requestId }) }, application);
  expect(response.status).toBe(200);
  expect(repository.review).toHaveBeenCalledWith(expect.objectContaining({ requestId, action: "invite", reviewerUserId: founderId }));
  expect(repositories.activityEvents.list()).toContainEqual(expect.objectContaining({ action: "beta_access.invited", targetId: requestId }));
});
```

- [ ] **Step 2: Run focused tests and verify admin modules are absent**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/beta-admin-auth.unit.test.ts && pnpm exec vitest run --project postgres-integration apps/web/app/api/settings/beta/routes.integration.test.ts`

Expected: FAIL because the admin guard and routes do not exist.

- [ ] **Step 3: Implement exact authorization and idempotent review**

```ts
export function parseBetaAdminUserIds(environment: Readonly<Record<string, string | undefined>>): ReadonlySet<VeraUserId> {
  const raw = environment.VERA_BETA_ADMIN_USER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((value) => VeraUserIdSchema.parse(value.trim())));
}

export function requireBetaAdmin(userId: VeraUserId, environment = process.env): VeraUserId {
  if (!parseBetaAdminUserIds(environment).has(userId)) throw new BetaAdminAuthorizationError();
  return userId;
}
```

`GET /api/settings/beta` requires `requireVeraSession` then `requireBetaAdmin`, and returns requests sorted newest first. `PATCH /api/settings/beta/[id]` requires session, admin, exact origin, 1024-byte JSON, UUID path, and `BetaAccessReviewSchema`; it calls `review`, then appends an activity event to the admin's repository with action `beta_access.invited|declined|withdrawn`, target type `beta_access_request`, target ID only, and no email in metadata. Repeating the same transition returns 200 with the same record; conflicting transitions return 409.

The server page calls the repository only after both guards. The client queue renders normalized email because the founder must identify the request, but no email is placed in a URL, client log, audit metadata, or analytics event. Buttons are Invite, Decline, and Withdraw; there is no send or Store-provision action.

- [ ] **Step 4: Run admin tests and mutation verifier**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/beta-admin-auth.unit.test.ts && pnpm exec vitest run --project postgres-integration apps/web/app/api/settings/beta/routes.integration.test.ts && pnpm verify:web-mutation-boundaries`

Expected: all focused tests PASS and mutation verifier exits 0.

- [ ] **Step 5: Commit review queue**

```sh
git add apps/web/lib/server/beta-admin-auth.ts apps/web/lib/server/beta-admin-auth.unit.test.ts apps/web/app/settings/beta apps/web/app/api/settings/beta
git commit -m "feat: add private beta review queue"
```

---

### Task 5: Enforce invitation independently from Google identity

**Files:**
- Modify: `apps/web/lib/server/auth.ts`
- Modify: `apps/web/lib/server/auth.unit.test.ts`
- Modify: `apps/web/lib/server/session.ts`
- Modify: `apps/web/lib/server/session.unit.test.ts`
- Modify: `apps/web/lib/server/page-session.ts`
- Create: `apps/web/app/access-pending/page.tsx`
- Create: `scripts/bootstrap-beta-founder.ts`
- Create: `scripts/bootstrap-beta-founder.unit.test.ts`

**Interfaces:**
- Consumes: `VeraApplication.betaAccess`, Better Auth `databaseHooks`, and `VERA_BETA_ACCESS_GATE_ENABLED`.
- Produces: `BetaAccessRequiredError`, protected-session membership enforcement, verified-email creation hooks, and confirmed founder bootstrap.

- [ ] **Step 1: Write failing identity and session gate tests**

```ts
it("denies a valid session without an active membership when enabled", async () => {
  application.auth!.api.getSession = vi.fn().mockResolvedValue({ user: { id: testerId } });
  application.betaAccess!.isActiveUser = vi.fn().mockResolvedValue(false);
  await expect(requireVeraSession(new Headers(), application, { VERA_BETA_ACCESS_GATE_ENABLED: "1" }))
    .rejects.toThrow(BetaAccessRequiredError);
  expect(application.repositoryProvider.forUser).not.toHaveBeenCalled();
});

it("permits an active member before constructing tenant repositories", async () => {
  application.auth!.api.getSession = vi.fn().mockResolvedValue({ user: { id: testerId } });
  application.betaAccess!.isActiveUser = vi.fn().mockResolvedValue(true);
  await expect(requireVeraSession(new Headers(), application, { VERA_BETA_ACCESS_GATE_ENABLED: "1" }))
    .resolves.toMatchObject({ userId: testerId });
  expect(application.repositoryProvider.forUser).toHaveBeenCalledWith(testerId);
});

it("rejects identity creation for an unverified or uninvited email", async () => {
  const hooks = createBetaIdentityHooks(repository, { VERA_BETA_ACCESS_GATE_ENABLED: "1" });
  await expect(hooks.user.create.before({ email: "tester@example.com", emailVerified: false } as never)).rejects.toThrow();
  repository.findInvitedByEmail.mockResolvedValue(null);
  await expect(hooks.user.create.before({ email: "tester@example.com", emailVerified: true } as never)).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests and confirm membership enforcement is absent**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.unit.test.ts scripts/bootstrap-beta-founder.unit.test.ts`

Expected: FAIL because `BetaAccessRequiredError`, hooks, and bootstrap script do not exist.

- [ ] **Step 3: Implement the fail-closed gate**

Add this check before `repositoryProvider.forUser` in `requireVeraSession`:

```ts
export class BetaAccessRequiredError extends AuthenticationRequiredError {
  constructor() {
    super();
    this.name = "BetaAccessRequiredError";
  }
}

const enabled = environment.VERA_BETA_ACCESS_GATE_ENABLED === "1";
if (enabled) {
  if (application.betaAccess === null || !(await application.betaAccess.isActiveUser(parsedUserId.data))) {
    throw new BetaAccessRequiredError();
  }
}
```

Change the signature to accept `environment = process.env` as the third parameter. In `requireVeraPageSession`, redirect `BetaAccessRequiredError` to `/access-pending` before the broader `AuthenticationRequiredError` branch.

Implement Better Auth hooks and pass them from `createVeraAuth`:

```ts
export function createBetaIdentityHooks(repository: BetaAccessRepository, environment = process.env) {
  const gateEnabled = environment.VERA_BETA_ACCESS_GATE_ENABLED === "1";
  return {
    user: { create: {
      before: async (user: { email: string; emailVerified: boolean }) => {
        if (!gateEnabled) return { data: user };
        if (!user.emailVerified) throw new Error("Private beta access is required.");
        const invitation = await repository.findInvitedByEmail(user.email);
        if (invitation === null || invitation.userId !== null) throw new Error("Private beta access is required.");
        return { data: user };
      },
      after: async (user: { id: string; email: string; emailVerified: boolean }) => {
        if (gateEnabled) await repository.bindInvitedMembership({ email: user.email, userId: VeraUserIdSchema.parse(user.id), now: new Date() });
      }
    } },
    session: { create: {
      before: async (session: { userId: string }) => {
        if (gateEnabled && !(await repository.isActiveUser(VeraUserIdSchema.parse(session.userId)))) throw new Error("Private beta access is required.");
        return { data: session };
      }
    } }
  };
}
```

The access-pending page says only: “Vera is currently invite-only. If you requested access, we’ll contact you when your account is approved.” It links to `/beta` and never states whether the current Google email is known.

The bootstrap script requires `--confirm <exact-user-uuid>`, looks up the existing verified user, requires that same UUID in `VERA_BETA_ADMIN_USER_IDS`, calls `bootstrapExistingUser({ userId, approvedByUserId: userId, now })`, re-reads `isActiveUser`, and prints only the UUID plus `active`; it never prints the email or database URL.

- [ ] **Step 4: Run session, auth, bootstrap, and mutation suites**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.unit.test.ts scripts/bootstrap-beta-founder.unit.test.ts && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/beta-access-repository.integration.test.ts && pnpm verify:web-mutation-boundaries`

Expected: every focused test PASS and the mutation verifier exits 0.

- [ ] **Step 5: Commit the gate**

```sh
git add apps/web/lib/server/auth.ts apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.ts apps/web/lib/server/session.unit.test.ts apps/web/lib/server/page-session.ts apps/web/app/access-pending scripts/bootstrap-beta-founder.ts scripts/bootstrap-beta-founder.unit.test.ts
git commit -m "feat: gate Vera product access by invitation"
```

---

### Task 6: Implement the self-service privacy lifecycle required for nonfounder access

**Files:**
- Create: `packages/domain/src/privacy-lifecycle.ts`
- Create: `packages/domain/src/privacy-lifecycle.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/src/postgres/privacy-lifecycle-repository.ts`
- Create: `packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts`
- Create: `packages/db/drizzle/0008_beta_privacy_lifecycle.sql`
- Create: `packages/db/drizzle/meta/0008_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Create: `apps/web/app/settings/privacy/page.tsx`
- Create: `apps/web/app/settings/privacy/privacy-controls.tsx`
- Create: `apps/web/app/api/settings/privacy/export/route.ts`
- Create: `apps/web/app/api/settings/privacy/deletion-request/route.ts`
- Create: `apps/web/app/api/settings/privacy/account/route.ts`
- Create: `apps/web/app/api/settings/privacy/routes.integration.test.ts`
- Create: `scripts/reapply-privacy-deletions.ts`
- Create: `scripts/reapply-privacy-deletions.unit.test.ts`
- Modify: `docs/PRIVACY_OPERATIONS.md`
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: authenticated Vera session, existing Google disconnect, beta membership, optional browser assignment revocation, and tenant-owned PostgreSQL rows.
- Produces: `PrivacyLifecycleRepository`, `streamOwnerExport`, `issueDeletionChallenge`, `consumeDeletionChallenge`, `deleteOwnerAccount`, and restore-time tombstone enforcement.

- [ ] **Step 1: Write failing export, challenge, deletion, and restore tests**

```ts
it("exports only the authenticated owner's safe data", async () => {
  await seedTwoUsersWithListings(connection, userA, userB);
  const records = await collect(repository.streamOwnerExport({ userId: userA, generatedAt: now }));
  expect(records[0]).toMatchObject({ type: "manifest", schemaVersion: "vera-privacy-export.v1", userId: userA });
  expect(JSON.stringify(records)).toContain("listing-owned-by-a");
  expect(JSON.stringify(records)).not.toContain("listing-owned-by-b");
  expect(JSON.stringify(records)).not.toMatch(/refreshToken|accessToken|ciphertext|nonce|session|checkpointCredential|relayCredential/i);
});

it("requires one unexpired, unused challenge for owner deletion", async () => {
  const challenge = await repository.issueDeletionChallenge({ userId: userA, now, expiresAt: plusMinutes(now, 15) });
  await expect(repository.consumeDeletionChallenge({ userId: userB, challengeId: challenge.id, confirmation: "DELETE MY VERA ACCOUNT", now })).rejects.toThrow();
  await expect(repository.consumeDeletionChallenge({ userId: userA, challengeId: challenge.id, confirmation: "DELETE MY VERA ACCOUNT", now })).resolves.toBeUndefined();
  await expect(repository.consumeDeletionChallenge({ userId: userA, challengeId: challenge.id, confirmation: "DELETE MY VERA ACCOUNT", now })).rejects.toThrow();
});

it("deletes one owner and retains a non-identifying restore tombstone", async () => {
  const receipt = await repository.deleteOwnerAccount({ userId: userA, subjectDigest: "d".repeat(64), providerRevocation: "confirmed", browserRevocation: "not_configured", completedAt: now, backupEraseAfter: plusDays(now, 30), legalHoldUntil: null });
  expect(await countUserOwnedRows(connection, userA)).toBe(0);
  expect(await countUserOwnedRows(connection, userB)).toBeGreaterThan(0);
  expect(receipt).toMatchObject({ formerUserId: userA, subjectDigest: "d".repeat(64) });
  expect(JSON.stringify(receipt)).not.toContain("@example.com");
});

it("reapplies completed deletion tombstones after a backup restore", async () => {
  await restoreFixtureContainingDeletedUser(connection, formerUserId);
  const result = await reapplyPrivacyDeletions(connection, [receipt]);
  expect(result).toEqual({ checked: 1, reapplied: 1, failed: 0 });
  expect(await countUserOwnedRows(connection, formerUserId)).toBe(0);
});
```

- [ ] **Step 2: Run focused tests and verify the privacy lifecycle is absent**

Run: `pnpm exec vitest run --project unit packages/domain/src/privacy-lifecycle.unit.test.ts scripts/reapply-privacy-deletions.unit.test.ts && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts apps/web/app/api/settings/privacy/routes.integration.test.ts`

Expected: FAIL because the privacy contracts, repository, routes, and restore tool do not exist.

- [ ] **Step 3: Define bounded export and deletion contracts**

Create exact domain schemas:

```ts
export const PRIVACY_EXPORT_VERSION = "vera-privacy-export.v1" as const;
export const PrivacyDeletionConfirmationSchema = z.literal("DELETE MY VERA ACCOUNT");
export const PrivacyDeletionChallengeRequestSchema = z.object({ confirmation: z.literal("request_account_deletion") }).strict();
export const PrivacyDeletionRequestSchema = z.object({ challengeId: z.uuid(), confirmation: PrivacyDeletionConfirmationSchema }).strict();
export const PrivacyProviderRevocationStatusSchema = z.enum(["confirmed", "unconfirmed", "not_configured"]);
export const PrivacyExportManifestSchema = z.object({
  type: z.literal("manifest"),
  schemaVersion: z.literal(PRIVACY_EXPORT_VERSION),
  userId: VeraUserIdSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  warning: z.literal("This export excludes passwords, sessions, OAuth tokens, browser credentials, and internal security material.")
}).strict();
```

Add `privacy_deletion_challenges` with UUID, user ID `ON DELETE CASCADE`, 64-hex random-token digest, created/expiry/consumed timestamps, and a 15-minute maximum lifetime check. Add `privacy_deletion_receipts` with UUID, former user UUID, HMAC subject digest, provider/browser revocation statuses, completed time, backup erase-after time, optional legal-hold-until, and no raw email, name, IP, URL, or free-form notes. `VERA_PRIVACY_SUBJECT_HMAC_KEY` is a distinct 32+ character server secret used to digest normalized email before deletion.

`streamOwnerExport` uses a repeatable-read read-only transaction and emits NDJSON. It starts with the manifest; emits a safe user projection (`id`, `name`, `email`, timestamps); a safe Google connection projection (`provider`, `displayEmail`, granted capabilities, status, timestamps); and rows owner-predicated by `user_id` from exactly these tables: `availability_rule_sets`, `availability_checks`, `search_profiles`, `raw_listings`, `listing_source_records`, `listing_photos`, `listing_source_record_dispositions`, `listing_enrichment_states`, `listing_enrichment_snapshots`, `field_provenance`, `approvals`, `normalization_jobs`, `source_jobs`, `source_job_attempts`, `browser_nodes`, `browser_user_controls`, `browser_source_controls`, `browser_profile_controls`, `browser_capture_acceptances`, `listing_extractions`, `decision_corpus_state`, `decision_jobs`, `decision_job_attempts`, `decision_runs`, `duplicate_pair_evaluations`, `duplicate_overrides`, `duplicate_override_revocations`, `duplicate_clusters`, `canonical_listings`, `canonical_decision_runs`, `canonical_listing_sources`, `canonical_field_sources`, `listing_scores`, `risk_signals`, `contact_workflows`, `viewings`, `calendar_holds`, `activity_events`, `maritime_dispatches` with nonce and payload fields omitted, `production_schedules`, `production_schedule_runs`, `notification_preferences`, `notification_deliveries`, `notification_digest_items`, `gmail_alert_cursors`, and `gmail_alert_external_references`. It never selects `sessions`, `accounts`, OAuth-state tables, refresh tokens/ciphertext/nonces, web-push keys, dispatch nonces or bodies, Gateway/checkpoint digests, rate-limit rows, logs, or secrets. Each line is capped at 1 MiB and the complete response at 50 MiB; exceeding either returns `export_too_large` without a partial download.

`deleteOwnerAccount` runs one transaction after the challenge and external revocation steps. It deletes the user's beta request/membership, deletes the user row so owner-cascade foreign keys remove tenant rows, verifies the explicit tenant-table count is zero, and inserts the deletion receipt. `beta_memberships.approved_by_user_id` is nullable `ON DELETE SET NULL` so a founder can delete their account without blocking other members' history.

- [ ] **Step 4: Implement authenticated export and two-step deletion orchestration**

`GET /api/settings/privacy/export` requires `requireVeraSession`, calls `streamOwnerExport`, and returns `application/x-ndjson`, `Cache-Control: no-store`, `Content-Disposition: attachment; filename="vera-data-export.ndjson"`, and `X-Content-Type-Options: nosniff`. It never accepts a user ID.

`POST /api/settings/privacy/deletion-request` requires session, same origin, 512-byte JSON, and exact confirmation; it returns challenge ID and expiry. `DELETE /api/settings/privacy/account` requires session, same origin, 1024-byte JSON, exact phrase, and consumes the challenge. It then: revokes the active browser assignment when configured; invokes existing Google disconnect so provider revocation is attempted and Vera ciphertext is cleared even when confirmation fails; computes the HMAC subject digest; calls `deleteOwnerAccount`; expires the Better Auth cookie; and returns only `{ status: "deleted", receiptId }`. A provider `unconfirmed` result is recorded but does not retain local credentials or prevent deletion. Any failure before the database delete leaves the account active and shows a retry state; any failure after commit cannot recreate the account.

The settings page presents Export my Vera data and Delete my Vera account separately. Deletion first explains listing/audit/account removal and backup aging, issues the 15-minute challenge, then requires typing `DELETE MY VERA ACCOUNT`; buttons never prefill it. The UI exposes the Google manual-revocation recovery link when provider confirmation is unavailable.

`reapply-privacy-deletions.ts` requires `--confirm <database-name> --receipt-file <private-json>`, rejects production URL arguments, reads receipts from a `0600` private file, owner-deletes any restored former UUID in one transaction per receipt, and reports counts only. The restore runbook runs it before traffic after every backup restore.

- [ ] **Step 5: Run privacy isolation and restore rehearsal**

Run: `pnpm exec vitest run --project unit packages/domain/src/privacy-lifecycle.unit.test.ts scripts/reapply-privacy-deletions.unit.test.ts && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts apps/web/app/api/settings/privacy/routes.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts && pnpm verify:web-mutation-boundaries && pnpm --filter @vera/web run build`

Expected: all tests PASS; export contains only user A safe records; user B is unchanged; deletion removes user A; a restored user A is removed before traffic; web and mutation gates pass.

- [ ] **Step 6: Mark `SEC-013` resolved only after live rehearsal and commit**

Deploy with beta access gate still disabled. As a dedicated nonfounder test account, download and inspect the owner export, disconnect Google, delete the account through the two-step UI, verify all owner tables and sessions are zero, verify the browser assignment cannot dispatch, record the deletion receipt without email, restore a sanitized pre-delete backup into an isolated rehearsal database, run the tombstone tool, and verify the deleted account remains absent. Inspect and record the managed PostgreSQL backup retention period; set `backupEraseAfter` to the verified expiry date. Only then update `docs/SECURITY_REVIEW.md` `SEC-013` to Resolved with exact tests/evidence and update `docs/PRIVACY_OPERATIONS.md` from founder-only to the implemented flow.

```sh
git add packages/domain/src/privacy-lifecycle.ts packages/domain/src/privacy-lifecycle.unit.test.ts packages/domain/src/index.ts packages/db apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts apps/web/app/settings/privacy apps/web/app/api/settings/privacy scripts/reapply-privacy-deletions.ts scripts/reapply-privacy-deletions.unit.test.ts docs/PRIVACY_OPERATIONS.md docs/SECURITY_REVIEW.md
git commit -m "feat: add self-service privacy lifecycle"
```

---

### Task 7: Roll out without locking out the founder

**Files:**
- Create: `docs/PRIVATE_BETA_OPERATIONS.md`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: green migration, founder UUID, Heroku configuration, and merged application image.
- Produces: founder-safe production gate, one verified request/review flow, and rollback evidence.

- [ ] **Step 1: Document exact environment and cutover order**

Add these non-secret names to `.env.example`, with blank values and comments:

```dotenv
VERA_BETA_ACCESS_GATE_ENABLED=0
VERA_BETA_ADMIN_USER_IDS=
VERA_BETA_RATE_LIMIT_KEY=
VERA_TRUST_HEROKU_ROUTER=0
```

`docs/PRIVATE_BETA_OPERATIONS.md` must order production operations as: back up/manifest PostgreSQL; run additive migration; deploy code with gate disabled; set beta-admin UUID; set a fresh dedicated 32+ character HMAC key without printing it; bootstrap founder; verify founder active; sign in as founder; submit and invite a test email; only then enable gate and restart web/worker from the same release.

- [ ] **Step 2: Run the complete slice gate before merge**

Run: `pnpm verify:web-mutation-boundaries && pnpm exec vitest run --project unit packages/domain/src/beta-access.unit.test.ts packages/domain/src/privacy-lifecycle.unit.test.ts apps/web/lib/server/beta-access-security.unit.test.ts apps/web/lib/server/beta-admin-auth.unit.test.ts apps/web/lib/server/auth.unit.test.ts apps/web/lib/server/session.unit.test.ts scripts/bootstrap-beta-founder.unit.test.ts scripts/reapply-privacy-deletions.unit.test.ts && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/beta-access-repository.integration.test.ts packages/db/src/postgres/privacy-lifecycle-repository.integration.test.ts apps/web/app/api/settings/beta/routes.integration.test.ts apps/web/app/api/settings/privacy/routes.integration.test.ts && pnpm --filter @vera/web run build`

Expected: all commands exit 0, including export/deletion isolation and restore-tombstone checks.

- [ ] **Step 3: Apply migration and bootstrap with the gate disabled**

Use the existing Heroku release process to run `pnpm db:migrate`. Verify the new table counts without selecting emails. Set `VERA_BETA_ADMIN_USER_IDS` to the exact current founder UUID, set a newly generated `VERA_BETA_RATE_LIMIT_KEY`, and run `pnpm tsx scripts/bootstrap-beta-founder.ts --confirm <founder-uuid>` in a one-off dyno. Expected output is `<founder-uuid> active` and contains no email.

- [ ] **Step 4: Enable and accept the gate**

Verify `SEC-013` is resolved with rehearsal evidence, founder sign-in, and `/api/ready`. Submit one consented test request through `/beta`, invite it through `/settings/beta`, sign in with the exact invited verified Google email, export that account's data, and confirm a different uninvited Google account reaches `/access-pending` with no API data. Revoke the tester and confirm the existing session is denied. Query activity events by action code and verify no email appears in metadata.

- [ ] **Step 5: Record rollback and commit operations docs**

If founder bootstrap or sign-in fails, keep or reset `VERA_BETA_ACCESS_GATE_ENABLED=0`; do not delete the additive tables. If the enabled gate fails, set only that flag to `0`, restart the paired application release, and retain request/membership rows for diagnosis.

```sh
git add docs/PRIVATE_BETA_OPERATIONS.md .env.example README.md
git commit -m "docs: add private beta access operations"
```
