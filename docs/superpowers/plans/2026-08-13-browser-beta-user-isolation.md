# Browser Beta User Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vera's global founder Gateway identity with an exact user-to-Gateway assignment so a three-to-five-person concierge cohort can use the existing bounded browser flow without cross-user dispatch, checkpoint, import, or credential access.

**Architecture:** Add one global PostgreSQL assignment record per browser-enabled Vera user, containing routing identity and credential digests but no raw secrets. Resolve each browser client and signing key from the authenticated user assignment plus an explicit server secret reference; authenticate checkpoints by assignment credential before selecting that user's repositories. Provision a separate immutable Gateway/checkpoint deployment and credential set per active tester, with database and runtime revocation blocking all future work.

**Tech Stack:** TypeScript 6.0.3, Zod 4.4.3, Next.js 16.2.10, Drizzle ORM, PostgreSQL, Maritime clients, existing signed OpenClaw Gateway OCI image, DigitalOcean isolated deployments, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Work only in `/private/tmp/vera-m13b-pr75-live-20260811` on branch `codex/private-beta-launch-polish`.
- Store installation, beta membership, or a UUID allowlist alone never authorizes browser work.
- Browser authorization requires, in order: active beta membership, exact browser-beta UUID allowlist, active user-owned browser node/profile approval, active user-owned Gateway assignment, enabled per-user browser/source control, and one explicitly shared tab.
- Each active tester receives one isolated Gateway/checkpoint deployment, one Maritime agent, one relay credential, one checkpoint credential, and one plan-signing key.
- Because DigitalOcean Regional Load Balancers cannot route by hostname, URL, cookie, or HTTP header, Wave 1 uses one dedicated Droplet and one dedicated Regional Load Balancer per active tester; do not multiplex users behind the retained founder load balancer.
- Provisioning any additional paid DigitalOcean resource requires the founder's separate cost approval after exact monthly cost is inspected; the implementation and Store review may finish while tester activation remains waiting.
- PostgreSQL stores only non-secret routing identity, secret reference, and SHA-256 credential digests. Raw relay, checkpoint, Maritime API, and signing values remain only in approved runtime secret stores and the intended endpoint.
- An authenticated user resolves only their assignment. A checkpoint credential resolves exactly one user before a repository is selected.
- No service may fall back to `VERA_BROWSER_GATEWAY_FOUNDER_USER_ID`, `MARITIME_BROWSER_GATEWAY_AGENT_ID`, `MARITIME_BROWSER_GATEWAY_API_KEY`, `VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN`, or a founder assignment after assignment routing is enabled.
- Preserve source policy states: browser sources remain `experimental_personal`, `user_triggered_only`, founder/concierge-only, disabled for public users, and disabled at rest until explicitly enabled per isolated assignment.
- Do not add scheduled or background browser polling.
- Do not change one-tab, hostname, source, duration, result, detail-page, action-count, cancellation, provenance, or forbidden-action checks.
- Manual login, 2FA, CAPTCHA, consent, checkpoint, rate limits, redirects, and changed layouts remain typed manual/source failures.
- Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload, download, login automation, CAPTCHA bypass, and arbitrary JavaScript remain forbidden.
- Use the existing signed Gateway image `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde` unless an objectively missing bounded primitive is proven.
- Do not mutate the immutable 13A rollback image.
- Preserve PostgreSQL and all listing data. Stopping or recreating stateless Gateway/checkpoint containers must not touch PostgreSQL.
- Rotate pairing/checkpoint values through the secure flow; never print, recover, or reuse an old pairing credential.
- Wave 1 is exactly three to five active testers; expansion is capped at 25 invited testers and requires the approved stability evidence.
- Active multi-user browser onboarding is also blocked until the repository's open self-service privacy lifecycle finding (`SEC-013`) is resolved by a separate reviewed implementation; do not silently mark that finding closed in this plan.
- Run focused checks while iterating and one full CI run only on the final combined PR.

## File Map

- Create `packages/domain/src/browser-gateway-assignment.ts`: assignment, status, secret-reference, and API schemas.
- Modify browser checkpoint denial schemas and policy runtime field from founder identity to assignment authorization.
- Add `browser_gateway_assignments` and `browser_gateway_acceptance_runs` global PostgreSQL tables.
- Create `packages/db/src/postgres/browser-gateway-assignment-repository.ts`: owner, credential, revocation, and evidence operations.
- Create `apps/web/lib/server/browser-gateway-secret-store.ts`: exact environment-backed runtime secret resolver.
- Create `apps/web/lib/server/browser-gateway-runtime-resolver.ts`: user and checkpoint resolution.
- Modify `VeraApplication` to expose the assignment repository and runtime resolver in hosted mode.
- Refactor rental research, detail enrichment, remote snapshot, Zillow checkpoint, and generic checkpoint dependencies to consume resolved runtime rather than founder environment.
- Modify live-search authorization to isolate official API and browser source permissions.
- Add authenticated onboarding/readiness/revocation APIs and UI.
- Create `scripts/provision-browser-beta-assignment.ts`: secret-safe, confirmed assignment provisioning.
- Create `scripts/verify-browser-assignment-boundaries.ts`: reject global fallback and cross-user construction.
- Create `scripts/browser-beta-evidence.ts`: record and validate safe cohort acceptance metrics.
- Create `docs/BROWSER_BETA_OPERATIONS.md`: provisioning, rotation, live acceptance, incident response, expansion, and teardown.

---

### Task 1: Define assignment and authorization contracts

**Files:**
- Create: `packages/domain/src/browser-gateway-assignment.ts`
- Create: `packages/domain/src/browser-gateway-assignment.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/browser-research.ts`
- Modify: `packages/domain/src/zillow-browser-research.ts`
- Modify: `packages/domain/src/remote-extension-snapshot.ts`
- Modify: `packages/policy/src/browser-research-policy.ts`
- Modify: `packages/policy/src/browser-research-policy.unit.test.ts`
- Modify: `packages/policy/src/zillow-research-policy.ts`
- Modify: `packages/policy/src/zillow-research-policy.unit.test.ts`

**Interfaces:**
- Consumes: `VeraUserIdSchema`, browser source schemas, and existing checkpoint policies.
- Produces: `BrowserGatewayAssignmentSchema`, `BrowserGatewaySecretReferenceSchema`, `BrowserAssignmentStatusSchema`, `BrowserGatewayRuntime`, and runtime authorization field `assignmentAuthorized`.

- [ ] **Step 1: Write failing assignment and policy tests**

```ts
import { describe, expect, it } from "vitest";
import {
  BrowserGatewayAssignmentSchema,
  BrowserGatewaySecretReferenceSchema
} from "./browser-gateway-assignment.ts";

describe("browser Gateway assignment", () => {
  it("accepts non-secret owner routing", () => {
    expect(BrowserGatewayAssignmentSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      nodeId: "vera-browser-node-tester-a",
      maritimeAgentId: "vera-browser-gateway-tester-a",
      gatewayOrigin: "https://browser-a.verahousing.app",
      checkpointOrigin: "https://app.verahousing.app",
      secretReference: "TESTER_A_202608",
      relayCredentialDigest: "a".repeat(64),
      checkpointCredentialDigest: "b".repeat(64),
      status: "active",
      createdAt: "2026-08-13T18:00:00.000Z",
      activatedAt: "2026-08-13T18:05:00.000Z",
      revokedAt: null
    }).status).toBe("active");
  });

  it("rejects raw or unsafe secret references", () => {
    expect(() => BrowserGatewaySecretReferenceSchema.parse("wss://gateway/#token".repeat(4))).toThrow();
    expect(() => BrowserGatewaySecretReferenceSchema.parse("TESTER_A_202608")).not.toThrow();
  });
});
```

Update policy tests with:

```ts
it("denies an otherwise valid action without exact assignment authorization", () => {
  expect(evaluateBrowserResearchAction({ checkpoint, runtime: { ...authorized, assignmentAuthorized: false }, checkedAt }).reason)
    .toBe("assignment_denied");
});
```

- [ ] **Step 2: Run tests and verify the assignment schema is absent**

Run: `pnpm exec vitest run --project unit packages/domain/src/browser-gateway-assignment.unit.test.ts packages/policy/src/browser-research-policy.unit.test.ts packages/policy/src/zillow-research-policy.unit.test.ts`

Expected: FAIL because assignment contracts and `assignmentAuthorized` do not exist.

- [ ] **Step 3: Implement exact schemas and neutral policy vocabulary**

```ts
import { z } from "zod";
import { BrowserResearchSourceSchema } from "./browser-research.ts";
import { VeraUserIdSchema } from "./identity.ts";

export const BrowserAssignmentStatusSchema = z.enum(["pending", "active", "revoked"]);
export const BrowserGatewaySecretReferenceSchema = z.string().regex(/^[A-Z][A-Z0-9_]{7,31}$/u);
export const BrowserCredentialDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const BrowserGatewayAssignmentSchema = z.object({
  id: z.uuid(),
  userId: VeraUserIdSchema,
  nodeId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u),
  maritimeAgentId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u),
  gatewayOrigin: z.url().refine((value) => new URL(value).protocol === "https:" && new URL(value).origin === value),
  checkpointOrigin: z.literal("https://app.verahousing.app"),
  secretReference: BrowserGatewaySecretReferenceSchema,
  relayCredentialDigest: BrowserCredentialDigestSchema,
  checkpointCredentialDigest: BrowserCredentialDigestSchema,
  status: BrowserAssignmentStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  activatedAt: z.iso.datetime({ offset: true }).nullable(),
  revokedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();

export interface BrowserGatewayRuntime {
  readonly assignment: z.infer<typeof BrowserGatewayAssignmentSchema>;
  readonly maritimeApiKey: string;
  readonly planSigningKey: string;
  readonly enabledSources: ReadonlySet<z.infer<typeof BrowserResearchSourceSchema>>;
}
```

Rename `founderAuthorized` to `assignmentAuthorized` in both policy runtime interfaces and replace denial reason `founder_denied` with `assignment_denied` in all three domain schemas and service mappings. Do not change the source manifests or their `experimental_personal` policy states.

- [ ] **Step 4: Run domain and policy tests**

Run: `pnpm exec vitest run --project unit packages/domain/src/browser-gateway-assignment.unit.test.ts packages/domain/src/browser-research.unit.test.ts packages/domain/src/zillow-browser-research.unit.test.ts packages/policy/src/browser-research-policy.unit.test.ts packages/policy/src/zillow-research-policy.unit.test.ts`

Expected: all focused tests PASS and existing hostname/limit/forbidden-action decisions remain unchanged.

- [ ] **Step 5: Commit the neutral authorization contract**

```sh
git add packages/domain/src/browser-gateway-assignment.ts packages/domain/src/browser-gateway-assignment.unit.test.ts packages/domain/src/index.ts packages/domain/src/browser-research.ts packages/domain/src/zillow-browser-research.ts packages/domain/src/remote-extension-snapshot.ts packages/policy/src/browser-research-policy.ts packages/policy/src/browser-research-policy.unit.test.ts packages/policy/src/zillow-research-policy.ts packages/policy/src/zillow-research-policy.unit.test.ts
git commit -m "feat: define browser Gateway assignments"
```

---

### Task 2: Persist owner assignments without raw credentials

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/src/postgres/browser-gateway-assignment-repository.ts`
- Create: `packages/db/src/postgres/browser-gateway-assignment-repository.integration.test.ts`
- Create: `packages/db/drizzle/0009_browser_gateway_assignments.sql`
- Create: `packages/db/drizzle/meta/0009_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/demo-application.ts`

**Interfaces:**
- Consumes: assignment schemas from Task 1 and global hosted PostgreSQL connection.
- Produces: `BrowserGatewayAssignmentRepository` with `createPending`, `activate`, `getActiveForUser`, `getActiveByCheckpointDigest`, `revokeForUser`, `recordAcceptance`, and `summarizeAcceptance`.

- [ ] **Step 1: Write failing persistence and isolation cases**

```ts
it("allows only one non-revoked assignment per user", async () => {
  await repository.createPending(inputFor(userA));
  await expect(repository.createPending({ ...inputFor(userA), id: otherAssignmentId })).rejects.toThrow();
});

it("resolves a checkpoint digest to exactly one owner", async () => {
  await repository.createPending(inputFor(userA));
  await repository.activate({ assignmentId, activatedAt: now });
  expect(await repository.getActiveByCheckpointDigest("b".repeat(64))).toMatchObject({ userId: userA });
  expect(await repository.getActiveByCheckpointDigest("c".repeat(64))).toBeNull();
});

it("revokes assignment, user controls, source controls, node, and profile together", async () => {
  await seedActiveBrowserAssignment(connection, userA);
  await repository.revokeForUser({ userId: userA, revokedAt: now });
  expect(await repository.getActiveForUser(userA)).toBeNull();
  expect(await readBrowserControlState(connection, userA)).toEqual({ userEnabled: false, sourceEnabledCount: 0, nodeStatus: "revoked", profileDisabled: true });
});
```

- [ ] **Step 2: Run PostgreSQL tests and verify repository absence**

Run: `pnpm exec vitest run --project postgres-integration packages/db/src/postgres/browser-gateway-assignment-repository.integration.test.ts`

Expected: FAIL because the repository and migration do not exist.

- [ ] **Step 3: Add the assignment and acceptance schema**

Generate additive tables equivalent to:

```sql
CREATE TABLE "browser_gateway_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "node_id" text NOT NULL,
  "maritime_agent_id" text NOT NULL UNIQUE,
  "gateway_origin" text NOT NULL UNIQUE,
  "checkpoint_origin" text NOT NULL,
  "secret_reference" text NOT NULL UNIQUE,
  "relay_credential_digest" text NOT NULL UNIQUE,
  "checkpoint_credential_digest" text NOT NULL UNIQUE,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz NOT NULL,
  "activated_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "browser_gateway_assignments_status_check" CHECK ("status" IN ('pending','active','revoked')),
  CONSTRAINT "browser_gateway_assignments_digest_check" CHECK ("relay_credential_digest" ~ '^[a-f0-9]{64}$' AND "checkpoint_credential_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "browser_gateway_assignments_node_tenant_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "browser_nodes"("user_id","node_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "browser_gateway_assignments_user_live_unique" ON "browser_gateway_assignments" ("user_id") WHERE "status" IN ('pending','active');
CREATE TABLE "browser_gateway_acceptance_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL REFERENCES "browser_gateway_assignments"("id") ON DELETE RESTRICT,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_job_id" text NOT NULL,
  "source" text NOT NULL,
  "forbidden_action_count" integer NOT NULL,
  "unshare_stopped_future_work" boolean NOT NULL,
  "unpair_verified" boolean NOT NULL,
  "completed_at" timestamptz NOT NULL,
  UNIQUE ("user_id","source_job_id"),
  CONSTRAINT "browser_gateway_acceptance_nonnegative" CHECK ("forbidden_action_count" >= 0)
);
```

The repository must parse every row, select by both `user_id` and active status, hash no raw value internally, and never expose a method that accepts or returns a raw credential. `recordAcceptance` verifies assignment/user equality before insert. `revokeForUser` is idempotent and transactionally revokes the assignment/browser node, disables user/source/profile controls, and appends no cross-tenant data.

Add `readonly browserGatewayAssignments: BrowserGatewayAssignmentRepository | null` to `VeraApplication`; hosted mode constructs it and demo mode sets it to null.

- [ ] **Step 4: Generate, inspect, and run PostgreSQL isolation tests**

Run: `pnpm db:generate && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/browser-gateway-assignment-repository.integration.test.ts packages/db/src/postgres/browser-transactions.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

Expected: migration adds only tables/indexes/constraints; all focused PostgreSQL tests PASS.

- [ ] **Step 5: Commit assignment persistence**

```sh
git add packages/db apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts apps/web/lib/server/demo-application.ts
git commit -m "feat: persist isolated browser assignments"
```

---

### Task 3: Resolve per-user runtime secrets without fallback

**Files:**
- Create: `apps/web/lib/server/browser-gateway-secret-store.ts`
- Create: `apps/web/lib/server/browser-gateway-secret-store.unit.test.ts`
- Create: `apps/web/lib/server/browser-gateway-runtime-resolver.ts`
- Create: `apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`

**Interfaces:**
- Consumes: active assignment, beta repository, browser controls, exact browser-beta UUID allowlist, and server environment.
- Produces: `BrowserGatewaySecretStore`, `EnvironmentBrowserGatewaySecretStore`, `BrowserGatewayRuntimeResolver.resolveForUser`, and `authenticateCheckpoint`.

- [ ] **Step 1: Write failing secret and cross-user resolution tests**

```ts
it("reads only the two expected server secret names for an assignment", async () => {
  const store = new EnvironmentBrowserGatewaySecretStore({
    VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY: "m".repeat(32),
    VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY: "s".repeat(32)
  });
  await expect(store.resolve("TESTER_A_202608")).resolves.toEqual({ maritimeApiKey: "m".repeat(32), planSigningKey: "s".repeat(32) });
});

it("does not return founder or another user's runtime when assignment is missing", async () => {
  assignments.getActiveForUser.mockResolvedValue(null);
  await expect(resolver.resolveForUser(userB)).resolves.toBeNull();
  expect(secretStore.resolve).not.toHaveBeenCalled();
});

it("binds checkpoint credential, origin, and owner before repository selection", async () => {
  assignments.getActiveByCheckpointDigest.mockResolvedValue(assignmentA);
  await expect(resolver.authenticateCheckpoint({ bearerToken: "checkpoint-a", origin: assignmentA.checkpointOrigin })).resolves.toMatchObject({ userId: userA });
  await expect(resolver.authenticateCheckpoint({ bearerToken: "checkpoint-a", origin: "https://evil.example" })).rejects.toThrow();
});
```

- [ ] **Step 2: Run unit tests and verify resolver modules are absent**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/browser-gateway-secret-store.unit.test.ts apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement exact environment secret names and layered authorization**

```ts
export interface BrowserGatewaySecretStore {
  resolve(reference: string): Promise<{ readonly maritimeApiKey: string; readonly planSigningKey: string }>;
}

export class EnvironmentBrowserGatewaySecretStore implements BrowserGatewaySecretStore {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {}
  async resolve(referenceInput: string) {
    const reference = BrowserGatewaySecretReferenceSchema.parse(referenceInput);
    const prefix = `VERA_BROWSER_ASSIGNMENT_${reference}`;
    const maritimeApiKey = this.environment[`${prefix}_MARITIME_API_KEY`]?.trim() ?? "";
    const planSigningKey = this.environment[`${prefix}_PLAN_SIGNING_KEY`]?.trim() ?? "";
    if (maritimeApiKey.length < 8 || planSigningKey.length < 32) throw new Error("Browser assignment secrets are unavailable.");
    return Object.freeze({ maritimeApiKey, planSigningKey });
  }
}
```

`resolveForUser(userId)` must return null unless: beta gate is enabled and `betaAccess.isActiveUser(userId)` is true; `userId` is exactly in `VERA_BROWSER_BETA_USER_IDS`; global browser kill switch is off; an active assignment exists; the assignment's tenant-scoped `browserIntegrationControls.get().userBrowserEnabled` is true; assigned node is online/paired/capability-approved/profile-approved; and secret resolution succeeds. Build `enabledSources` from rows in `browser_source_controls`, then intersect them with the existing global source enablement flags. Instantiate `MaritimeBrowserResearchClient`, Zillow client, and remote snapshot client using explicit option objects—not global constructor helpers.

`authenticateCheckpoint` rejects missing/short bearer tokens before hashing, computes SHA-256 locally, calls `getActiveByCheckpointDigest`, compares the exact configured origin, verifies active beta/UUID/node/control state, resolves the assignment secret, and returns `{ userId, runtime }`. It does not accept a user ID or run ID from headers or body.

Add `readonly browserGatewayRuntime: BrowserGatewayRuntimeResolver | null` to the hosted application registry; demo mode remains null.

- [ ] **Step 4: Run resolver tests and typecheck**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/browser-gateway-secret-store.unit.test.ts apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts && pnpm --filter @vera/web run typecheck`

Expected: all resolver tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit runtime resolution**

```sh
git add apps/web/lib/server/browser-gateway-secret-store.ts apps/web/lib/server/browser-gateway-secret-store.unit.test.ts apps/web/lib/server/browser-gateway-runtime-resolver.ts apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts
git commit -m "feat: resolve browser runtime by Vera user"
```

---

### Task 4: Refactor dispatch and enrichment to require the resolved assignment

**Files:**
- Modify: `apps/web/lib/rental-research-service.ts`
- Modify: `apps/web/lib/rental-research-service.integration.test.ts`
- Modify: `apps/web/lib/listing-enrichment-service.ts`
- Modify: `apps/web/lib/listing-enrichment-service.unit.test.ts`
- Modify: `apps/web/lib/remote-extension-snapshot-service.ts`
- Modify: `apps/web/lib/remote-extension-snapshot-service.unit.test.ts`
- Modify: `apps/web/app/api/live-search/route.ts`
- Modify: `apps/web/app/api/live-search/[id]/route.ts`
- Modify: `apps/web/app/api/live-search/[id]/stop/route.ts`
- Modify: listing enrichment and remote snapshot API routes that construct these dependencies.

**Interfaces:**
- Consumes: `BrowserGatewayRuntimeResolver.resolveForUser(userId)` from Task 3.
- Produces: asynchronous `createRentalResearchDependencies(..., browserRuntime)`, `createListingEnrichmentDependencies(..., browserRuntime)`, and no production browser client built from global Gateway values.

- [ ] **Step 1: Write failing no-fallback and user-isolation tests**

```ts
it("does not dispatch browser research when the authenticated user has no runtime", async () => {
  await expect(runRentalResearch(browserRequest, await createRentalResearchDependencies(context, live, null)))
    .rejects.toMatchObject({ code: "browser_assignment_required" });
  expect(maritimeFetch).not.toHaveBeenCalled();
});

it("dispatches with the authenticated user's exact agent", async () => {
  const runtime = runtimeFor(userA, { maritimeAgentId: "agent-a" });
  await runRentalResearch(browserRequest, await createRentalResearchDependencies(contextA, live, runtime));
  expect(maritimeFetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/agents/agent-a/chat" }), expect.anything());
  expect(JSON.stringify(maritimeFetch.mock.calls)).not.toContain("agent-b");
});

it("does not enqueue detail enrichment for another user's assignment", async () => {
  await expect(processListingEnrichment(jobOwnedByB, dependenciesForA)).rejects.toMatchObject({ code: "browser_assignment_required" });
  expect(browserResearch.run).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused service tests and confirm they still construct global clients**

Run: `pnpm exec vitest run --project unit apps/web/lib/listing-enrichment-service.unit.test.ts apps/web/lib/remote-extension-snapshot-service.unit.test.ts && pnpm exec vitest run --project integration apps/web/lib/rental-research-service.integration.test.ts`

Expected: new tests FAIL because services still parse founder/global environment.

- [ ] **Step 3: Inject explicit runtime into every browser path**

Replace all `founderUserId` fields with `assignmentAuthorized: boolean` derived from `runtime.assignment.userId === context.userId`. Remove calls to `createMaritimeBrowserResearchClient(environment)`, `createMaritimeZillowResearchClient(environment)`, and `createMaritimeRemoteExtensionClient(environment)` from web services; construct clients with `{ apiKey: runtime.maritimeApiKey, agentId: runtime.assignment.maritimeAgentId }`. Pass `runtime.planSigningKey` to plan signing. If runtime is null, return the existing visible offline/disabled state or typed `browser_assignment_required`; never substitute a founder client.

Make route construction asynchronous:

```ts
const application = getHostedApplication();
const browserRuntime = await application.browserGatewayRuntime?.resolveForUser(context.userId) ?? null;
const result = await runRentalResearch(
  input,
  createRentalResearchDependencies(context.userId, context.repositories, context.repositoryProvider, liveDependencies, browserRuntime, process.env)
);
```

Keep legacy single-source `runLiveSearch` founder-only because it includes official RentCast behavior. For multi-source requests, permit an assigned browser user to start the route, but classify RentCast as `source_not_approved` for a nonfounder instead of discarding successful browser sources. The source selection UI must disable unapproved sources. Status and stop routes authorize by session owner and source-job tenant repository, not founder allowlist. Existing founder behavior works after the founder has an active assignment.

- [ ] **Step 4: Run service, route, and four-source regression tests**

Run: `pnpm exec vitest run --project unit apps/web/lib/listing-enrichment-service.unit.test.ts apps/web/lib/remote-extension-snapshot-service.unit.test.ts && pnpm exec vitest run --project integration apps/web/lib/rental-research-service.integration.test.ts apps/web/lib/live-search-service.integration.test.ts && pnpm --filter @vera/web run typecheck`

Expected: all tests PASS; source failure isolation and existing four-source founder fixtures remain green.

- [ ] **Step 5: Commit per-user dispatch**

```sh
git add apps/web/lib/rental-research-service.ts apps/web/lib/rental-research-service.integration.test.ts apps/web/lib/listing-enrichment-service.ts apps/web/lib/listing-enrichment-service.unit.test.ts apps/web/lib/remote-extension-snapshot-service.ts apps/web/lib/remote-extension-snapshot-service.unit.test.ts apps/web/app/api/live-search apps/web/app/api/listings apps/web/app/api/integrations/remote-browser
git commit -m "feat: bind browser dispatch to user assignment"
```

---

### Task 5: Authenticate checkpoints to one assignment before tenant lookup

**Files:**
- Modify: `apps/web/app/api/internal/browser-research/checkpoint/route.ts`
- Modify: `apps/web/app/api/internal/browser-research/checkpoint/route.unit.test.ts`
- Modify: `apps/web/lib/browser-research-checkpoint-service.ts`
- Modify: `apps/web/lib/browser-research-checkpoint-service.unit.test.ts`
- Modify: `apps/web/lib/zillow-research-checkpoint-service.ts`
- Modify: `apps/web/lib/zillow-research-checkpoint-service.unit.test.ts`
- Modify: `scripts/verify-web-mutation-boundaries.ts`
- Modify: `scripts/verify-browser-boundaries.ts`

**Interfaces:**
- Consumes: `BrowserGatewayRuntimeResolver.authenticateCheckpoint` and assignment-owned repository provider.
- Produces: `requireAssignedCheckpoint(request, resolver)`, exact-owner checkpoint evaluation, and no global bearer/founder config.

- [ ] **Step 1: Write failing cross-user checkpoint tests**

```ts
it("selects the tenant only after credential authentication", async () => {
  resolver.authenticateCheckpoint.mockResolvedValue({ userId: userA, runtime: runtimeA });
  repositoryProvider.forUser.mockReturnValue(repositoriesA);
  await POST(checkpointRequest("checkpoint-a", jobA), application);
  expect(resolver.authenticateCheckpoint).toHaveBeenCalledBefore(repositoryProvider.forUser);
  expect(repositoryProvider.forUser).toHaveBeenCalledWith(userA);
});

it("cannot use assignment A credential for assignment B run", async () => {
  resolver.authenticateCheckpoint.mockResolvedValue({ userId: userA, runtime: runtimeA });
  repositoriesA.sourceJobs.getById.mockResolvedValue(null);
  const response = await POST(checkpointRequest("checkpoint-a", jobB), application);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ allowed: false, reason: "run_not_active" });
  expect(repositoryProvider.forUser).not.toHaveBeenCalledWith(userB);
});

it("denies a revoked credential before reading the body", async () => {
  resolver.authenticateCheckpoint.mockRejectedValue(new CheckpointAuthorizationError());
  const request = streamingCheckpointRequestThatRecordsReads("revoked-token");
  expect((await POST(request, application)).status).toBe(401);
  expect(request.bodyRead).toBe(false);
});
```

- [ ] **Step 2: Run checkpoint tests and verify global selection still fails them**

Run: `pnpm exec vitest run --project unit apps/web/app/api/internal/browser-research/checkpoint/route.unit.test.ts apps/web/lib/browser-research-checkpoint-service.unit.test.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts`

Expected: new tests FAIL because the route uses one global token and founder UUID.

- [ ] **Step 3: Replace bearer and founder environment with assignment resolution**

The route must execute in this order: get hosted application; require non-null resolver; call `resolver.authenticateCheckpoint({ bearerToken: parseBearer(header), origin: exactOriginHeader })`; only then `readBoundedJson(..., { maxBytes: 16_000 })`; only then `repositoryProvider.forUser(resolved.userId)`; parse generic/Zillow shape; evaluate with `assignmentAuthorized: resolved.runtime.assignment.userId === resolved.userId`, per-user enabled sources, global kill switch, and resolved signing key.

Delete `validCheckpointBearer`, `requireCheckpointBearer`, `configuredCheckpointOrigin`, and reads of `VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN`/`VERA_BROWSER_GATEWAY_FOUNDER_USER_ID` from this route. Update the mutation verifier to recognize `authenticateCheckpoint(` as the internal checkpoint authentication/origin boundary and preserve authentication-before-body ordering.

Update browser boundary verifier so it fails if production browser services or checkpoint route reference the five forbidden fallback variables. Environment documentation may retain them only under an explicitly labeled rollback-only section.

- [ ] **Step 4: Run checkpoint, policy, mutation, and browser boundary suites**

Run: `pnpm exec vitest run --project unit apps/web/app/api/internal/browser-research/checkpoint/route.unit.test.ts apps/web/lib/browser-research-checkpoint-service.unit.test.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts packages/policy/src/browser-research-policy.unit.test.ts packages/policy/src/zillow-research-policy.unit.test.ts && pnpm verify:web-mutation-boundaries && pnpm verify:browser-boundaries`

Expected: all tests PASS; both verifiers exit 0; no global founder/token fallback remains in active service code.

- [ ] **Step 5: Commit assignment-authenticated checkpoints**

```sh
git add apps/web/app/api/internal/browser-research/checkpoint/route.ts apps/web/app/api/internal/browser-research/checkpoint/route.unit.test.ts apps/web/lib/browser-research-checkpoint-service.ts apps/web/lib/browser-research-checkpoint-service.unit.test.ts apps/web/lib/zillow-research-checkpoint-service.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts scripts/verify-web-mutation-boundaries.ts scripts/verify-browser-boundaries.ts
git commit -m "feat: bind browser checkpoints to assignments"
```

---

### Task 6: Add concierge onboarding state and server revocation

**Files:**
- Create: `apps/web/app/api/settings/integrations/browser-agent/assignment/route.ts`
- Create: `apps/web/app/api/settings/integrations/browser-agent/assignment/revoke/route.ts`
- Create: `apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts`
- Modify: `apps/web/app/settings/integrations/browser-agent/page.tsx`
- Modify: `apps/web/app/settings/integrations/browser-agent/browser-agent-panel.tsx`
- Create: `scripts/provision-browser-beta-assignment.ts`
- Create: `scripts/provision-browser-beta-assignment.unit.test.ts`

**Interfaces:**
- Consumes: assignment repository, beta membership, exact beta allowlist, and tenant browser controls.
- Produces: safe assignment status, confirmed user revocation, and a secret-safe operator provisioning command.

- [ ] **Step 1: Write failing status, revocation, and secret-output tests**

```ts
it("shows waiting state without revealing routing or digests", async () => {
  assignments.getActiveForUser.mockResolvedValue(null);
  const response = await GET(authenticatedRequest(userA), application);
  await expect(response.json()).resolves.toEqual({ status: "waiting_for_onboarding", browserReady: false });
});

it("revokes only the authenticated user's assignment", async () => {
  const response = await POST(revokeRequest({ confirmation: "revoke_browser_connector" }, userA), application);
  expect(response.status).toBe(200);
  expect(assignments.revokeForUser).toHaveBeenCalledWith(expect.objectContaining({ userId: userA }));
  expect(assignments.revokeForUser).not.toHaveBeenCalledWith(expect.objectContaining({ userId: userB }));
});

it("renders provisioning output without raw secret material", async () => {
  const output = await provisionBrowserAssignment(args, dependenciesWithGeneratedSecrets());
  expect(output).toEqual({ assignmentId, userId: userA, status: "pending", secretReference: "TESTER_A_202608" });
  expect(JSON.stringify(output)).not.toMatch(/wss:|Bearer|pairing|checkpoint-a|maritime-key/i);
});
```

- [ ] **Step 2: Run tests and verify onboarding APIs are absent**

Run: `pnpm exec vitest run --project unit scripts/provision-browser-beta-assignment.unit.test.ts && pnpm exec vitest run --project postgres-integration apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts`

Expected: FAIL because routes/script do not exist.

- [ ] **Step 3: Implement safe status, confirmed revocation, and provisioning manifest**

GET returns only `waiting_for_onboarding | pending | active | revoked`, `browserReady`, `nodeState`, enabled source labels, and safe recovery code; it excludes agent ID, origins, secret reference, and digests. Revocation requires session, same origin, 1024-byte JSON `{ confirmation: "revoke_browser_connector" }`, calls transactional `revokeForUser`, and appends a user-owned `browser.assignment_revoked` activity event. The UI tells the user to click this control and then **Unpair and revoke browser access** in the extension; the server revocation immediately prevents dispatch and makes the next checkpoint deny even if a socket has not closed yet.

The provisioning script requires exact flags `--confirm-user <uuid> --node-id <id> --agent-id <id> --gateway-origin <https-origin> --secret-reference <ref> --relay-digest-file <private-file> --checkpoint-digest-file <private-file>`. It verifies active membership, UUID allowlist, one approved node/profile, no live assignment, digest file mode `0600`, and 64 lowercase hex bytes. It creates only a pending DB assignment; it never accepts raw secrets in arguments or outputs. Activation is a separate `--activate-assignment <uuid>` command after external Gateway and checkpoint smoke pass.

- [ ] **Step 4: Run route, script, mutation, and browser tests**

Run: `pnpm exec vitest run --project unit scripts/provision-browser-beta-assignment.unit.test.ts && pnpm exec vitest run --project postgres-integration apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts && pnpm verify:web-mutation-boundaries && pnpm verify:browser-boundaries`

Expected: all focused checks PASS and revocation is idempotent.

- [ ] **Step 5: Commit onboarding and revocation**

```sh
git add apps/web/app/api/settings/integrations/browser-agent/assignment apps/web/app/settings/integrations/browser-agent scripts/provision-browser-beta-assignment.ts scripts/provision-browser-beta-assignment.unit.test.ts
git commit -m "feat: add isolated browser onboarding"
```

---

### Task 7: Add fail-closed architecture and cohort evidence gates

**Files:**
- Create: `scripts/verify-browser-assignment-boundaries.ts`
- Create: `scripts/verify-browser-assignment-boundaries.unit.test.ts`
- Create: `scripts/browser-beta-evidence.ts`
- Create: `scripts/browser-beta-evidence.unit.test.ts`
- Create: `infra/maritime/browser-beta/acceptance.schema.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: application source, DB schema, safe acceptance rows, and private incident log summary.
- Produces: `pnpm verify:browser-assignments`, `browser-beta-evidence record`, and `browser-beta-evidence evaluate`.

- [ ] **Step 1: Write failing architecture and wave-gate tests**

```ts
it("rejects a global Gateway fallback in active services", () => {
  expect(findBrowserAssignmentViolations({ ...clean, rentalResearch: `process.env.MARITIME_BROWSER_GATEWAY_AGENT_ID` }))
    .toContain("Browser services must not select a global Gateway agent.");
});

it("requires credential-to-owner resolution before repository selection", () => {
  expect(findBrowserAssignmentViolations({ ...clean, checkpointRoute: `repositoryProvider.forUser(founder); authenticateCheckpoint();` }))
    .toContain("Checkpoint owner must resolve before tenant repositories.");
});

it("opens expansion only after every approved stability threshold", () => {
  expect(evaluateBrowserBetaExpansion({ sessions: 10, distinctNonFounderTesters: 3, crossUserIncidents: 0, credentialIncidents: 0, backgroundExecutionIncidents: 0, forbiddenActions: 0, fourSourceFounderRegression: false, revocationPasses: 3, incidentFreeDays: 7 })).toEqual({ allowed: false, reasons: ["four_source_founder_regression"] });
});
```

- [ ] **Step 2: Run tests and verify the gates are absent**

Run: `pnpm exec vitest run --project unit scripts/verify-browser-assignment-boundaries.unit.test.ts scripts/browser-beta-evidence.unit.test.ts`

Expected: FAIL because both tools do not exist.

- [ ] **Step 3: Implement exact static and evidence validation**

The architecture verifier must scan active service construction for all five forbidden fallback names, ensure `browserGatewayRuntime.resolveForUser(context.userId)` precedes dependency creation, ensure `authenticateCheckpoint` precedes `readBoundedJson` and `forUser`, reject assignment tables containing columns matching `secret|token|api_key|signing_key` except `secret_reference` and `*_digest`, verify user/source/node/profile checks, and ensure Gateway image manifests still pin the accepted digest.

The evidence schema stores safe fields only: assignment UUID, Vera user UUID, source-job UUID, source label, started/completed timestamps, imported count, checkpoint action types, forbidden-action count, unshare follow-up state, unpair state, cross-user check result, and incident severity. It forbids URLs, emails, raw listings, tokens, credentials, IPs, page content, and screenshots.

`evaluateBrowserBetaExpansion` requires: at least 10 completed user-triggered sessions; at least 3 distinct nonfounder testers; every dispatch/checkpoint/import/audit owner match; every live tester passes unshare and unpair; zero forbidden actions; zero credential/cross-user/background incidents; founder four-source regression true; and 7 consecutive days without severity 1 or 2. It never changes flags automatically.

Add root scripts:

```json
{
  "verify:browser-assignments": "tsx scripts/verify-browser-assignment-boundaries.ts",
  "browser-beta:evidence": "tsx scripts/browser-beta-evidence.ts"
}
```

Run assignment verification in CI next to existing browser and extension verifiers.

- [ ] **Step 4: Run the complete automated browser-assignment gate**

Run: `pnpm verify:browser-assignments && pnpm verify:browser-boundaries && pnpm verify:vera-openclaw-extension && pnpm exec vitest run --project unit scripts/verify-browser-assignment-boundaries.unit.test.ts scripts/browser-beta-evidence.unit.test.ts apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts apps/web/app/api/internal/browser-research/checkpoint/route.unit.test.ts && pnpm exec vitest run --project postgres-integration packages/db/src/postgres/browser-gateway-assignment-repository.integration.test.ts`

Expected: every verifier/test exits 0 and pinned Gateway digest is unchanged.

- [ ] **Step 5: Commit cohort gates**

```sh
git add scripts/verify-browser-assignment-boundaries.ts scripts/verify-browser-assignment-boundaries.unit.test.ts scripts/browser-beta-evidence.ts scripts/browser-beta-evidence.unit.test.ts infra/maritime/browser-beta/acceptance.schema.json package.json .github/workflows/ci.yml
git commit -m "test: gate isolated browser beta rollout"
```

---

### Task 8: Provision the founder assignment and migrate without fallback

**Files:**
- Create: `docs/BROWSER_BETA_OPERATIONS.md`
- Modify: `.env.example`
- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `docs/OPENCLAW_FOUNDER_SETUP.md`

**Interfaces:**
- Consumes: green merged release, current founder node, existing immutable Gateway/checkpoint containers, and fresh secrets.
- Produces: an active founder assignment, old credential deletion, global-fallback removal, and founder four-source regression evidence.

- [ ] **Step 1: Document exact secret namespaces and rotation sequence**

Add blank non-secret names:

```dotenv
VERA_BROWSER_BETA_USER_IDS=
VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0
VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION=sha256.v1
# Per assignment, configure VERA_BROWSER_ASSIGNMENT_<REFERENCE>_MARITIME_API_KEY and _PLAN_SIGNING_KEY in the runtime secret store.
```

The runbook must state: enable the global browser kill switch; verify zero active browser runs; back up PostgreSQL; run migrations; create/verify founder assignment pending; generate fresh relay/checkpoint/signing/Maritime values without printing; rotate the Vera pairing seed; stop and recreate only the stateless Gateway/checkpoint containers with the same immutable images; delete the old relay credential; store server secrets in Heroku/Maritime config; configure raw checkpoint only in the assigned sidecar; pair with one fresh one-time value; activate assignment; enable per-user/source controls; enable assignment routing; remove legacy global Gateway/founder/token config from the active release; then clear the kill switch.

- [ ] **Step 2: Run read-only health and data checks before container mutation**

Verify `/api/ready`, Heroku database counts, current Gateway image digest/signature, current checkpoint health, zero active runs, current assignment absence, and existing four-source listing counts. Preserve the current database tunnel/data and retained private evidence. Do not redeploy merely because a local tunnel is down.

- [ ] **Step 3: Rotate and recreate stateless runtime exactly as authorized**

Create the pending founder assignment and private digest files. Rotate the pairing seed and checkpoint token through the established secure flow. Stop and recreate the Gateway and checkpoint containers only, using Gateway digest `4bbdb...170bde` and the existing checkpoint image, same route/hostname/limits, distinct fresh credentials, and the current loopback checkpoint URL. Delete the old relay credential after the new container is healthy. Never print or copy a pairing value into terminal evidence; transfer it once through the approved user-facing flow and clear the clipboard.

- [ ] **Step 4: Prove founder behavior through the assignment**

Pair and share exactly one dedicated tab; confirm Browser ready; run the existing four-source founder acceptance; verify RawListing → provenance → normalization → dedupe → deterministic scoring → inbox; verify zero forbidden actions; unshare; start a follow-up run and require `tab_required/no_shared_tab`; unpair; revoke/rotate; verify shared tabs 0, established connections 0, clipboard bytes 0. Record only safe IDs/counts/hashes.

- [ ] **Step 5: Remove active fallback and record rollback**

Set assignment routing on, remove the five legacy global selection values from active Heroku configuration, restart the paired web/worker release, and run `pnpm verify:browser-assignments`. A rollback restores the prior application release plus its exact legacy config while the browser kill switch remains on; it never restores an old pairing/checkpoint credential. Commit documentation before the final PR:

```sh
git add docs/BROWSER_BETA_OPERATIONS.md .env.example infra/maritime/ENVIRONMENT.md docs/OPENCLAW_FOUNDER_SETUP.md
git commit -m "docs: add isolated browser beta operations"
```

---

### Task 9: Activate Wave 1 only after every external gate passes

**Files:**
- No repository files; write only sanitized records to the gitignored private evidence directory.

**Interfaces:**
- Consumes: Chrome Store-approved testers, active memberships, exact beta UUID list, resolved `SEC-013`, one isolated deployment per tester, and founder regression evidence.
- Produces: three-to-five accepted isolated testers and a pass/fail expansion report; no automatic public rollout.

- [ ] **Step 1: Stop if privacy or Store prerequisites are incomplete**

Confirm Chrome Store item is privately published; each account is an explicit trusted tester and active Vera member; the browser UUID allowlist contains only intended testers; `SEC-013` is marked resolved with linked tests and a rehearsed authenticated export/deletion flow; support/privacy pages are live; and the global browser kill switch is functional. If any condition fails, keep Browser Connector status `waiting_for_onboarding` and do not provision a Gateway.

- [ ] **Step 2: Provision one isolated deployment at a time**

For each of three to five testers, first inspect and obtain approval for the exact recurring cost of one dedicated Droplet and one dedicated Regional Load Balancer. Then resolve the exact Vera UUID; create a dedicated browser node/profile approval; provision that isolated DigitalOcean Gateway/checkpoint deployment from the same immutable images; create a distinct Maritime agent and secret namespace; generate unique relay/checkpoint/signing values; create and activate exactly one assignment; enable only explicitly reviewed sources; add the tester to `VERA_BROWSER_BETA_USER_IDS`; and provide one one-time pairing value through concierge onboarding. Do not place two users on one Droplet, load balancer, Gateway/checkpoint container set, or credential set.

- [ ] **Step 3: Run live user-isolation and revocation acceptance per tester**

With that tester authenticated, share exactly one dedicated tab and run one user-triggered bounded search. Verify every dispatch, checkpoint, RawListing, normalized listing, provenance field, canonical record, score, and activity event has the tester's exact owner. Attempt to address another user's run ID with the tester's checkpoint credential in a safe test and require `run_not_active` without the other repository being selected. Unshare and require future work to stop; invoke server assignment revoke; unpair; delete/rotate raw credentials; verify zero shared tabs/connections/clipboard bytes and zero forbidden actions.

- [ ] **Step 4: Keep Wave 1 capped while collecting the approved stability evidence**

Record at least 10 completed user-triggered sessions across at least three nonfounder testers. Every source failure must preserve other-source success. Run founder four-source regression after the final Wave 1 deployment. Maintain seven consecutive days without severity 1 or 2 browser safety incident; typed manual blocker stops are expected and do not count as safety failures.

- [ ] **Step 5: Evaluate expansion without changing flags automatically**

Run: `pnpm browser-beta:evidence -- evaluate --input <private-sanitized-evidence-file>`

Expected before all criteria: `{ "allowed": false, "reasons": [...] }`. Expected only after every criterion: `{ "allowed": true, "maximumInvitedTesters": 25 }`. Expansion still requires a human-reviewed release decision; the command never edits Store testers, database assignments, Heroku config, Maritime, DigitalOcean, or Chrome.
