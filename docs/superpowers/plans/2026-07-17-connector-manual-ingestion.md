# Connector and Manual Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, no-network fixture/manual capture pipeline that idempotently preserves raw evidence, queues deterministic normalization, records complete known/unknown provenance and audit events, and exposes capture and connector status in the local web UI.

**Architecture:** Domain owns durable schemas; policy owns deterministic authorization; connectors own pure adapters, URL classification, and normalization; DB owns immutable evidence and leased jobs; web owns user-triggered capture; worker owns asynchronous normalization. The API returns after a short transaction and the worker performs parsing outside the job-claim transaction.

**Tech Stack:** TypeScript 6, Zod 4, Next.js 16, React 19, SQLite via better-sqlite3, Drizzle ORM, Vitest, Playwright, pnpm workspaces.

## Global Constraints

- Do not fetch, resolve, preview, redirect, or render user-supplied URLs.
- Do not add browser, Gmail, Calendar, OAuth, notification, email, or LLM integrations.
- Treat fixture, pasted, and structured listing content as inert untrusted data.
- Every connector capability fails closed unless an enabled manifest grants the exact operation.
- Preserve immutable `RawListing` rows and append-only `ActivityEvent` rows.
- Missing facts remain explicit unknown values and receive unknown provenance.
- Audit metadata must not contain pasted content, raw JSON, full URLs, email addresses, or phone numbers.
- Keep SQLite claim and write transactions short; normalization runs outside a transaction.
- Use strict Zod validation at API, connector, policy, normalizer, and repository boundaries.
- Use only sanitized fixtures with `example.invalid` URLs and synthetic facts.

---

## File structure

### Domain

- Modify `packages/domain/src/primitives.ts`: add `other` and manual capture methods.
- Modify `packages/domain/src/listing.ts`: add contact channel, source-posted time, and known/unknown provenance fields.
- Replace `packages/domain/src/source-policy.ts`: implement the normative manifest vocabulary.
- Create `packages/domain/src/jobs.ts`: durable normalization-job schemas.
- Create `packages/domain/src/capture-api.ts`: public capture, status, and connector-health response schemas.
- Modify `packages/domain/src/index.ts`: export the new schemas and types.

### Policy

- Modify `packages/policy/package.json`: depend on `@vera/domain`.
- Create `packages/policy/src/registry.ts`: `SourcePolicyRegistry` and fail-closed decisions.
- Create `packages/policy/src/manifests.ts`: code-owned fixture/manual manifests.
- Create `packages/policy/src/registry.unit.test.ts`: policy behavior.
- Modify `packages/policy/src/index.ts`: public exports.

### Connectors

- Modify `packages/connectors/package.json`: depend on domain and policy.
- Create `packages/connectors/src/contracts.ts`: required `SourceConnector`, `ConnectorContext`, `CaptureRequest`, `CaptureResult`, `RawListingEnvelope`, and `NormalizationResult` interfaces and strict schemas.
- Create `packages/connectors/src/errors.ts`: typed safe connector errors.
- Create `packages/connectors/src/url-policy.ts`: pure SSRF-defensive URL validation, domain allowlist handling, and source classification.
- Create `packages/connectors/src/fixture-connector.ts`: sanitized fixture adapter.
- Create `packages/connectors/src/manual-connector.ts`: text and structured adapters.
- Create `packages/connectors/src/normalizer.ts`: deterministic baseline normalizer.
- Create connector, URL, and normalizer unit tests.
- Modify `packages/connectors/src/index.ts`: public exports.

### Database

- Modify `packages/db/src/schema.ts`: evolved evidence/policy columns and `normalization_jobs`.
- Generate `packages/db/drizzle/0001_*.sql` and metadata.
- Modify `packages/db/src/repositories.ts`: manifest listing and job repository interfaces.
- Modify `packages/db/src/row-mappers.ts`: new fields and job mapping.
- Modify `packages/db/src/sqlite-repositories.ts`: job lease state machine and new round trips.
- Modify `packages/db/src/fixtures.ts` and `seed.ts`: enriched policies and provenance.
- Add repository/job/migration integration tests.

### Web and worker

- Modify web and worker package manifests with workspace dependencies.
- Create `apps/web/lib/capture-service.ts`: policy-gated capture orchestration.
- Create `/api/captures`, `/api/captures/[rawListingId]`, and `/api/connectors` routes and tests.
- Create `/capture` and `/connectors` pages plus client components and styles.
- Create `apps/worker/src/normalization-worker.ts`: claim, normalize, persist, audit, complete/fail.
- Modify worker CLI to poll jobs and support a deterministic `run-once` command.
- Update Playwright startup and golden-flow tests.

### Documentation

- Modify `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/SOURCE_POLICY.md`, and `README.md`.

---

### Task 1: Evolve domain schemas

**Files:**
- Modify: `packages/domain/src/primitives.ts`
- Modify: `packages/domain/src/listing.ts`
- Modify: `packages/domain/src/source-policy.ts`
- Create: `packages/domain/src/jobs.ts`
- Create: `packages/domain/src/capture-api.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/schemas.unit.test.ts`
- Create: `packages/domain/src/jobs.unit.test.ts`

**Interfaces:**
- Produces: `ListingSourceLabel`, `ListingCaptureMethod`, `ContactChannel`, enriched `FieldProvenance`, `NormalizationJob`, enriched `SourcePolicyManifest`, and capture/status API response schemas.
- Consumes: Zod and existing primitives only.

- [ ] **Step 1: Write failing domain-schema tests**

Add assertions equivalent to:

```ts
expect(ListingSourceLabelSchema.parse("other")).toBe("other");
expect(ListingCaptureMethodSchema.parse("manual_text")).toBe("manual_text");
expect(FieldProvenanceSchema.parse({
  ...knownProvenance,
  valueStatus: "unknown",
  confidenceBasisPoints: 0,
  unknownReason: "missing_evidence",
  evidenceExcerpt: null
}).valueStatus).toBe("unknown");
expect(() => FieldProvenanceSchema.parse({
  ...knownProvenance,
  valueStatus: "known",
  unknownReason: "missing_evidence"
})).toThrow();
expect(NormalizationJobSchema.parse(queuedJob).state).toBe("queued");
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm vitest run --project unit packages/domain/src/schemas.unit.test.ts packages/domain/src/jobs.unit.test.ts`  
Expected: failure because the new schemas do not exist.

- [ ] **Step 3: Implement the exact domain vocabulary**

Use these core shapes:

```ts
export const ListingSourceLabelSchema = z.enum([
  "zillow", "facebook_marketplace", "craigslist", "apartments_com", "other"
]);
export const ListingCaptureMethodSchema = z.enum([
  "fixture", "manual_text", "manual_structured"
]);
export const ContactChannelSchema = z.enum([
  "email", "phone", "platform_message", "website_form", "other", "unknown"
]);
export const ProvenanceValueStatusSchema = z.enum(["known", "unknown"]);
export const UnknownFieldReasonSchema = z.enum([
  "missing_evidence", "unrecognized_format", "not_applicable"
]);
export const NormalizationJobStateSchema = z.enum([
  "queued", "leased", "completed", "retryable", "dead_letter"
]);
```

Add `sourcePostedAt` and `contactChannel` to `ListingSourceRecord`. Add `valueStatus` and `unknownReason` to `FieldProvenance`, enforcing that known values have no unknown reason and unknown values have confidence zero and a reason.

Define a strict manifest schema with `schemaVersion: 1`, connector/display IDs, exact capability arrays, operation/domain/origin/method arrays, approval/session flags, rate/concurrency values, kill-switch keys, redaction rules, manual-blocker behavior, owner/review/decision metadata, and timestamps.

Define `NormalizationJobSchema` with ID, raw-listing ID, idempotency key, state, available time, attempts, lease fields, safe error fields, correlation/causation IDs, and timestamps. Enforce state-specific lease and completion invariants.

- [ ] **Step 4: Add strict API schemas**

Define response schemas for:

```ts
type CaptureAcceptedResponse = {
  correlationId: string;
  rawListingId: string;
  contentHash: string;
  duplicate: boolean;
  normalizationJobId: string | null;
  normalizationState: "queued" | "leased" | "completed" | "retryable" | "dead_letter";
};

type ConnectorStatus = {
  connectorId: string;
  displayName: string;
  status: "ready" | "disabled" | "denied";
  capabilities: SourceCapability[];
  networkAccess: false;
  detail: string;
};
```

Include strict error and capture-status schemas without raw evidence fields.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm vitest run --project unit packages/domain/src/schemas.unit.test.ts packages/domain/src/jobs.unit.test.ts`  
Expected: all domain tests pass.

---

### Task 2: Implement fail-closed source policy

**Files:**
- Modify: `packages/policy/package.json`
- Create: `packages/policy/src/registry.ts`
- Create: `packages/policy/src/manifests.ts`
- Create: `packages/policy/src/registry.unit.test.ts`
- Modify: `packages/policy/src/index.ts`

**Interfaces:**
- Consumes: `SourcePolicyManifest`, `SourceCapability`.
- Produces: `SourcePolicyRegistry`, `SourcePolicyRequest`, `SourcePolicyDecision`, `INITIAL_LOCAL_MANIFESTS`.

- [ ] **Step 1: Write fail-closed policy tests**

Cover exact allow, missing manifest, malformed registration, disabled connector, connector kill switch, global kill switch, wrong capability, wrong execution mode, unexpected network fields, and unknown capability. Assert every exception path returns a typed denial rather than throwing from `evaluate`.

```ts
const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
expect(registry.evaluate({
  connectorId: "manual.capture.v1",
  capability: "manual.capture",
  execution: "manual",
  operation: "capture.user_supplied",
  hasUserSession: false,
  hasApproval: false,
  network: null
})).toMatchObject({ allowed: true, reason: "authorized" });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run --project unit packages/policy/src/registry.unit.test.ts`  
Expected: module and exports are missing.

- [ ] **Step 3: Implement registry evaluation**

Create a class with these public methods:

```ts
class SourcePolicyRegistry {
  constructor(
    manifests: readonly SourcePolicyManifest[],
    options?: { activeKillSwitches?: ReadonlySet<string> }
  );
  getManifest(connectorId: string): SourcePolicyManifest | null;
  listManifests(): readonly SourcePolicyManifest[];
  evaluate(request: SourcePolicyRequest): SourcePolicyDecision;
  classifyBrowserDomain(hostname: string): BrowserDomainDecision;
}
```

Catch validation and registry errors inside `evaluate` and return `{ allowed: false, reason: "policy_error" }`. Never let a connector alter the registry.

- [ ] **Step 4: Add enabled local-only manifests**

Create fixture and manual manifests that grant exactly one capability and operation each, declare empty network arrays, require no session or external-effect approval, use concurrency one, and document local/synthetic or user-supplied data handling. Add explicit known-domain classification entries; unknown domains return `manual_policy_required`.

- [ ] **Step 5: Run policy tests and typecheck**

Run: `pnpm vitest run --project unit packages/policy/src/registry.unit.test.ts && pnpm --filter @vera/policy typecheck`  
Expected: pass.

---

### Task 3: Implement connector contracts, URL safety, and baseline normalization

**Files:**
- Modify: `packages/connectors/package.json`
- Create: `packages/connectors/src/contracts.ts`
- Create: `packages/connectors/src/errors.ts`
- Create: `packages/connectors/src/url-policy.ts`
- Create: `packages/connectors/src/fixture-connector.ts`
- Create: `packages/connectors/src/manual-connector.ts`
- Create: `packages/connectors/src/normalizer.ts`
- Create: `packages/connectors/src/connectors.unit.test.ts`
- Create: `packages/connectors/src/url-policy.unit.test.ts`
- Create: `packages/connectors/src/normalizer.unit.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Produces all named Prompt 3 connector interfaces and errors.
- Consumes domain schemas and policy request types, without repositories or I/O clients.

- [ ] **Step 1: Write shared connector contract tests**

Define a reusable suite that verifies connector ID/capability stability, strict request validation, valid `RawListingEnvelope`, `networkAccess: false`, preservation of user evidence, and rejection of the other connector's request kinds. Run it for `FixtureConnector` and `ManualCaptureConnector`.

- [ ] **Step 2: Write URL-safety tests**

Assert acceptance/classification of known domains and classification of `https://housing.example/path` as `other`. Assert typed rejection of `file:`, localhost, `.local`, IPv4, IPv6, integer IPv4, credentials, fragments, ports, and malformed URLs. Spy on no network API; the module must import no HTTP/DNS/browser package.

- [ ] **Step 3: Write normalizer tests**

Use sanitized text containing rent, beds, baths, labeled address, ISO post date, and an email-shaped contact. Assert only contact channel is retained. Use incomplete text and assert every omitted baseline field has `{ status: "unknown", value: null, confidenceBasisPoints: 0 }` and matching unknown provenance. Include prompt-like commands and prove they remain inert evidence.

- [ ] **Step 4: Run and confirm focused failures**

Run: `pnpm vitest run --project unit packages/connectors/src`  
Expected: connector modules are absent.

- [ ] **Step 5: Implement strict contracts and typed errors**

Export:

```ts
export interface ConnectorContext {
  readonly correlationId: string;
  now(): Date;
  createId(): string;
}

export interface SourceConnector<Request extends CaptureRequest = CaptureRequest> {
  readonly connectorId: string;
  readonly capability: "fixture.read" | "manual.capture";
  supports(request: CaptureRequest): request is Request;
  capture(request: Request, context: ConnectorContext): RawListingEnvelope;
  health(registry: SourcePolicyRegistry): ConnectorHealth;
}
```

Create strict discriminated request schemas, strict envelope/result schemas, and concrete error subclasses carrying only a closed code and safe details.

- [ ] **Step 6: Implement pure URL parsing and both connectors**

Use the WHATWG `URL` class only. Normalize host casing and trailing dot, reject dangerous forms before classification, and return a canonical provenance URL without a fragment. Fixture payloads require `sanitized: true`. Manual text requires URL plus text. Manual structured accepts an optional URL and strict structured values. Both set `networkAccess: false` and `untrustedContent: true`.

- [ ] **Step 7: Implement deterministic normalization**

Return a strict `NormalizationResult` containing a `ListingSourceRecord` and one field outcome/provenance record for title, URL, source, rent, beds, baths, address text, post date, and contact channel. Use structured values first; otherwise use bounded regex rules. Do not extract or persist contact details.

- [ ] **Step 8: Run connector tests and typecheck**

Run: `pnpm vitest run --project unit packages/connectors/src && pnpm --filter @vera/connectors typecheck`  
Expected: pass.

---

### Task 4: Add migration, job repositories, and enriched persistence

**Files:**
- Modify: `packages/db/src/schema.ts`
- Generate: `packages/db/drizzle/0001_*.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Generate: `packages/db/drizzle/meta/0001_snapshot.json`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/row-mappers.ts`
- Modify: `packages/db/src/sqlite-repositories.ts`
- Modify: `packages/db/src/fixtures.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/src/repositories.integration.test.ts`
- Create: `packages/db/src/jobs.integration.test.ts`
- Modify: `packages/db/src/seed.integration.test.ts`

**Interfaces:**
- Consumes evolved domain schemas.
- Produces `NormalizationJobRepository`, manifest listing, and atomic persistence operations used by web/worker.

- [ ] **Step 1: Write failing persistence tests**

Test manual raw import, `other` source round-trip, known/unknown provenance, enriched manifest round-trip/listing, one-job-per-raw idempotency, immediate claim, active-lease exclusion, expired-lease recovery, owner-bound completion, retry scheduling, dead-letter transition, and transaction rollback.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run --project integration packages/db/src/repositories.integration.test.ts packages/db/src/jobs.integration.test.ts`  
Expected: new fields and repository are absent.

- [ ] **Step 3: Evolve Drizzle schema**

Add the approved evidence columns and a `normalization_jobs` table with unique raw-listing and idempotency indexes, state/attempt checks, lease consistency checks, and foreign keys using restrict semantics. Retain raw/activity update/delete triggers.

- [ ] **Step 4: Generate and inspect migration**

Run: `pnpm db:generate`  
Expected: one new numbered migration. Inspect it to ensure existing seed data is preserved, new non-null fields have safe migration defaults, the fixture-only raw check is replaced, and append-only triggers survive table recreation.

- [ ] **Step 5: Implement repositories**

Add:

```ts
interface NormalizationJobRepository {
  enqueue(input: EnqueueNormalizationJob): { record: NormalizationJob; inserted: boolean };
  getById(id: string): NormalizationJob | null;
  getByRawListingId(rawListingId: string): NormalizationJob | null;
  claimNext(input: ClaimNormalizationJob): NormalizationJob | null;
  complete(input: CompleteNormalizationJob): NormalizationJob;
  fail(input: FailNormalizationJob): NormalizationJob;
  count(): number;
}
```

Use `better-sqlite3`'s immediate transaction for claim compare-and-set. Completion and failure require matching lease owner and leased state.

- [ ] **Step 6: Update sanitized seed**

Preserve 12 raw source records and 8 canonical listings. Mark all existing provenance as known. Add the two enabled local manifests and enriched disabled source manifests. Keep the seed idempotent and free of live domains and contacts.

- [ ] **Step 7: Run migrations and persistence tests**

Run: `pnpm vitest run --project integration packages/db/src && pnpm db:generate`  
Expected: integration tests pass and the second generate reports no schema changes.

---

### Task 5: Implement capture orchestration and API routes

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/capture-service.ts`
- Create: `apps/web/lib/connector-registry.ts`
- Create: `apps/web/app/api/captures/route.ts`
- Create: `apps/web/app/api/captures/route.integration.test.ts`
- Create: `apps/web/app/api/captures/[rawListingId]/route.ts`
- Create: `apps/web/app/api/captures/[rawListingId]/route.integration.test.ts`
- Create: `apps/web/app/api/connectors/route.ts`
- Create: `apps/web/app/api/connectors/route.integration.test.ts`

**Interfaces:**
- Consumes connectors, policy registry, DB repositories, and API schemas.
- Produces a 202 capture endpoint and read-only status endpoints.

- [ ] **Step 1: Write service and route integration tests**

Cover valid manual text, valid structured JSON, fixture JSON, duplicate capture, unsupported connector/source, malformed body, policy denial, unavailable database, no-network connector status, and sanitized errors. Assert exact audit action sequences for success, denial, and malformed payload.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run --project integration apps/web/app/api/captures apps/web/app/api/connectors`  
Expected: route modules are missing.

- [ ] **Step 3: Implement connector composition**

Create an immutable connector map with fixture and manual connectors. Build `SourcePolicyRegistry` from latest persisted manifests and injected kill switches. Missing or malformed manifests yield denied connector status.

- [ ] **Step 4: Implement capture service**

Expose:

```ts
export function captureListing(
  input: unknown,
  dependencies: CaptureServiceDependencies
): CaptureAcceptedResponse;
```

Generate one correlation ID, append requested, parse input, evaluate policy, append the policy decision, call the selected connector, and transactionally import raw evidence, enqueue one job, and append completion. On errors append `capture.failed` with safe code/category metadata, then throw a typed service error. Do not include evidence or URL in any event metadata.

- [ ] **Step 5: Implement Node-only routes**

Set `runtime = "nodejs"`, `dynamic = "force-dynamic"`, no-store headers, strict response parsing, bounded request-body handling, existing-database opening, and `finally` closure. Map malformed/unsupported to 400 or 422, policy denial to 403, and database failure to 503.

- [ ] **Step 6: Run API tests and typecheck**

Run: `pnpm vitest run --project integration apps/web/app/api && pnpm --filter @vera/web typecheck`  
Expected: pass.

---

### Task 6: Implement the normalization worker

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/build.mjs`
- Create: `apps/worker/src/normalization-worker.ts`
- Create: `apps/worker/src/normalization-worker.integration.test.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/src/cli.unit.test.ts`

**Interfaces:**
- Consumes raw/job repositories and `normalizeRawListing`.
- Produces `processNextNormalizationJob` and polling worker behavior.

- [ ] **Step 1: Write worker integration tests**

Assert one claimed job becomes completed, creates one source record, writes all baseline provenance including unknowns, appends `normalization.completed`, and cannot be processed again. Inject a throwing normalizer to assert retry then dead-letter and safe error metadata. Test expired lease recovery.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run --project integration apps/worker/src/normalization-worker.integration.test.ts`  
Expected: worker module is missing.

- [ ] **Step 3: Implement one-job processing**

Expose:

```ts
export function processNextNormalizationJob(
  dependencies: NormalizationWorkerDependencies
): { status: "idle" } | { status: "completed" | "retryable" | "dead_letter"; jobId: string };
```

Claim and commit first, load and normalize outside a transaction, then transactionally insert the source record, insert every provenance row, append completion, and complete the job. On a typed or unexpected error, store only a safe code/category and schedule bounded retry.

- [ ] **Step 4: Add polling and run-once CLI behavior**

The `start` command opens the configured database and polls with an abortable bounded timer. `run-once` processes at most one job and exits. Existing health/noop behavior remains testable. Shutdown releases no active DB transaction and closes the connection.

- [ ] **Step 5: Run worker tests and build**

Run: `pnpm vitest run --project unit apps/worker/src && pnpm vitest run --project integration apps/worker/src && pnpm --filter @vera/worker build`  
Expected: pass.

---

### Task 7: Add capture and connector-status UI

**Files:**
- Create: `apps/web/app/capture/capture-form.tsx`
- Create: `apps/web/app/capture/page.tsx`
- Create: `apps/web/app/connectors/connector-status.tsx`
- Create: `apps/web/app/connectors/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Create: `tests/e2e/capture.spec.ts`

**Interfaces:**
- Consumes capture and connector APIs.
- Produces accessible local UI and golden-flow browser evidence.

- [ ] **Step 1: Write E2E tests**

Assert connector status shows fixture/manual ready, `Network access: disabled`, and future manual review for unknown domains. Submit URL plus pasted text, observe queued/processing and then completed fields, verify at least one Unknown field, repeat the same capture, and observe duplicate without an extra raw row.

- [ ] **Step 2: Implement accessible pages**

Use labeled radio controls for text and structured modes, textarea/input controls with size hints, a clear statement that Vera will not open the URL, disabled submit while active, `aria-live` status, safe server errors, and bounded polling that stops on terminal state or unmount.

- [ ] **Step 3: Update local navigation and styling**

Add visible links from the dashboard to capture and connector status. Reuse the existing design tokens, provide mobile layouts, visible focus states, and no misleading fetch/import terminology.

- [ ] **Step 4: Start both web and worker in Playwright**

Update the web-server command so migration, seed, web, and worker share the isolated `VERA_DATA_DIR`. Keep loopback-only port 3000 and no external resources.

- [ ] **Step 5: Run E2E tests**

Run: `pnpm test:e2e`  
Expected: dashboard and capture/status flows pass in Chromium.

---

### Task 8: Documentation, security audit, and acceptance gate

**Files:**
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SOURCE_POLICY.md`
- Modify: `README.md`

**Interfaces:**
- Documents the behavior implemented by Tasks 1-7.

- [ ] **Step 1: Update durable documentation**

Document connector boundaries, no-network manual capture, unknown-domain classification, job states and leases, activity sequence, new routes/pages, worker commands, migrations, and local demo steps. Update Mermaid diagrams with normalization jobs and capture flow.

- [ ] **Step 2: Run source safety scans**

Run targeted `rg` scans excluding generated output for HTTP/DNS/browser clients, Gmail/Calendar/LLM dependencies, live platform fixture URLs, secrets, type suppressions, raw content in audit metadata, and direct raw/activity update/delete methods. Inspect every hit.

- [ ] **Step 3: Run migration and seed smoke tests**

Against a unique temporary `VERA_DATA_DIR`, run migration, seed twice, submit a manual capture, run the worker once, and query counts/events/job/provenance. Expected: seed remains idempotent, one manual raw row/job/source record exists, and the required audit sequence is present.

- [ ] **Step 4: Run the full acceptance gate**

Run in order:

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test
pnpm build
pnpm db:generate
```

Expected: every command passes and final migration generation reports no schema changes.

- [ ] **Step 5: Perform requirement-by-requirement completion audit**

Map every named interface, numbered requirement, security constraint, and requested test category to a concrete source export plus passing test or runtime result. Keep the goal active if any evidence is absent or indirect.

---

## Execution notes

This workspace is not a Git worktree, so the plan's normal commit checkpoints cannot be executed. Preserve unrelated files and report that limitation. Implement tasks inline unless the user explicitly authorizes subagent delegation.
