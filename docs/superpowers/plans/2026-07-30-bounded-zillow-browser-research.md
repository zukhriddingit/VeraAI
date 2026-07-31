# Bounded Founder Zillow Browser Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one founder-only, user-triggered Zillow rental-research path that uses a newly reviewed immutable Gateway tool, imports observed listings through Vera's existing canonical pipeline, and preserves every accepted Milestone 13A transport and consent boundary.

**Architecture:** A strict domain contract separates the Vera request/output model from OpenClaw's internal browser-control API. The Gateway plugin owns all navigation policy, semantic-reference validation, budgets, blocker detection, and per-action authorization checkpoints; Vera only submits a saved-profile request and receives validated listing evidence. A source-aware search coordinator runs RentCast and Zillow independently, records source/progress state, imports Zillow evidence as immutable `RawListing` records, and preserves partial results when either source fails.

**Tech Stack:** TypeScript 6, Zod 4, Next.js 16 route handlers and React UI, Vitest 4, existing PostgreSQL/Drizzle repositories, OpenClaw 2026.7.1 plugin runtime, pnpm 11, OCI/GitHub Actions/Cosign/SBOM/Trivy release gates, and the accepted DigitalOcean Regional Load Balancer deployment scripts.

## Global Constraints

- Preserve `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd` unchanged as the Milestone 13A rollback/reference artifact.
- Expose exactly one new Gateway tool named `vera_zillow_rental_research_v1`; do not expose unrestricted OpenClaw browser, navigate, act, evaluate, screenshot, download, upload, shell, filesystem, or generic tool surfaces.
- Classify Zillow as `experimental_personal`, `user_triggered_only`, founder-only, disabled by default, with no scheduled browsing or background polling.
- Accept only the versioned strict input contract: Vera run ID, explicit saved-profile fields, `maxResults <= 10`, `maxDetailPages <= 5`, and an approved safe shared-tab reference.
- Reject arbitrary URLs, JavaScript, model-supplied selectors, coordinates, action sequences, credentials, cookies, and instructions found in page content.
- Permit at most one shared Zillow rental tab, 10 result cards, 5 detail pages, 2 result-page expansions, and 90 seconds per run.
- Recheck founder authorization, source policy, browser kill switch, exact shared tab, hostname, limits, and cancellation before every browser action.
- Stop with `manual_action_required` for login, 2FA, CAPTCHA, consent, bot challenge, or layout incompatibility; never bypass a blocker.
- Never activate Contact, Apply, Tour, Message, Phone, Email, payment, upload, download, account creation, or login controls.
- Persist only observed listing evidence and safe activity metadata; never store raw page snapshots, cookies, credentials, unrelated-tab data, or invented facts.
- Import every accepted result through `RawListing -> normalization -> provenance -> deduplication -> scoring -> inbox`.
- Do not implement Apartments.com, Facebook Marketplace, Craigslist, Gmail outreach, or tour scheduling.

---

### Task 1: Versioned Zillow Research Domain Contract

**Files:**
- Create: `packages/domain/src/zillow-browser-research.ts`
- Create: `packages/domain/src/zillow-browser-research.unit.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `ZillowRentalResearchInputSchema`, `ZillowRentalResearchOutputSchema`, `ZillowObservedListingSchema`, `ZillowResearchStateSchema`, `ZillowResearchProgressPhaseSchema`, and their inferred TypeScript types.
- Produces constants: `ZILLOW_RESEARCH_TOOL_NAME`, `ZILLOW_RESEARCH_MAX_RESULTS`, `ZILLOW_RESEARCH_MAX_DETAIL_PAGES`, `ZILLOW_RESEARCH_MAX_EXPANSIONS`, and `ZILLOW_RESEARCH_MAX_DURATION_MS`.

- [ ] **Step 1: Write failing schema tests**

```ts
expect(
  ZillowRentalResearchInputSchema.safeParse({
    version: "1",
    veraRunId: "run_01",
    profile: { location: "Boston, MA", maximumRentUsd: 3_500, minimumBedrooms: 2 },
    maxResults: 10,
    maxDetailPages: 5,
    sharedTab: { kind: "target_id", value: "tab-reviewed-1" },
  }).success,
).toBe(true);
expect(
  ZillowRentalResearchInputSchema.safeParse({
    version: "1",
    veraRunId: "run_01",
    profile: { location: "Boston, MA", maximumRentUsd: 3_500, minimumBedrooms: 2 },
    maxResults: 11,
    maxDetailPages: 5,
    sharedTab: { kind: "target_id", value: "tab-reviewed-1" },
    url: "https://example.invalid",
  }).success,
).toBe(false);
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm vitest run --project unit packages/domain/src/zillow-browser-research.unit.test.ts`

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement strict schemas and constants**

```ts
export const ZILLOW_RESEARCH_TOOL_NAME = "vera_zillow_rental_research_v1" as const;
export const ZILLOW_RESEARCH_MAX_RESULTS = 10;
export const ZILLOW_RESEARCH_MAX_DETAIL_PAGES = 5;
export const ZILLOW_RESEARCH_MAX_EXPANSIONS = 2;
export const ZILLOW_RESEARCH_MAX_DURATION_MS = 90_000;

export const ZillowRentalResearchInputSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: z.string().min(1).max(128),
    profile: z
      .object({
        location: z.string().min(1).max(160),
        maximumRentUsd: z.number().int().positive(),
        minimumBedrooms: z.number().nonnegative().max(20),
        minimumBathrooms: z.number().nonnegative().max(20).optional(),
        rentalPropertyType: z.enum(["apartment", "house", "townhouse", "condo"]).optional(),
      })
      .strict(),
    maxResults: z.number().int().min(1).max(ZILLOW_RESEARCH_MAX_RESULTS),
    maxDetailPages: z.number().int().min(0).max(ZILLOW_RESEARCH_MAX_DETAIL_PAGES),
    sharedTab: z.object({ kind: z.literal("target_id"), value: z.string().min(1).max(256) }).strict(),
  })
  .strict();
```

Define strict output states `ready`, `completed`, `partial`, `failed`, and `manual_action_required`; manual blockers `login_required`, `two_factor_required`, `captcha_required`, `consent_required`, `blocked`, and `layout_changed`; listing evidence fields; per-field provenance; missing fields; warnings; bounded counters; and safe action audit entries containing only action kind, host, timestamp, result, and observed-reference hash.

- [ ] **Step 4: Verify valid evidence passes and invented/extra fields fail**

Run: `pnpm vitest run --project unit packages/domain/src/zillow-browser-research.unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/domain/src/zillow-browser-research.ts packages/domain/src/zillow-browser-research.unit.test.ts packages/domain/src/index.ts
git commit -m "feat: define bounded Zillow research contract"
```

### Task 2: Founder-Only Source Policy and Per-Action Checkpoint

**Files:**
- Modify: `packages/policy/src/manifests.ts`
- Modify: `packages/policy/src/registry.unit.test.ts`
- Create: `packages/policy/src/zillow-research-policy.ts`
- Create: `packages/policy/src/zillow-research-policy.unit.test.ts`
- Modify: `packages/policy/src/index.ts`
- Create: `apps/web/lib/zillow-research-checkpoint-service.ts`
- Create: `apps/web/lib/zillow-research-checkpoint-service.unit.test.ts`
- Create: `apps/web/app/api/internal/browser-research/checkpoint/route.ts`

**Interfaces:**
- Consumes: `ZillowRentalResearchInput` and the existing `SourcePolicyManifest`/repository contracts.
- Produces: `ZILLOW_RENTAL_RESEARCH_MANIFEST`.
- Produces: `evaluateZillowResearchAction(input: ZillowResearchActionContext): ZillowResearchActionDecision`.
- Produces: `createZillowResearchCheckpointService(dependencies).check(input): Promise<ZillowResearchCheckpointResponse>`.

- [ ] **Step 1: Write policy-denial tests**

```ts
expect(evaluateZillowResearchAction(baseContext)).toMatchObject({
  allowed: false,
  reason: "source_disabled",
});
expect(
  evaluateZillowResearchAction({
    ...baseContext,
    sourceEnabled: true,
    founderAuthorized: true,
    browserKillSwitchEnabled: false,
    sharedTabCount: 1,
    sharedTabIdMatches: true,
    hostname: "www.zillow.com",
    cancelled: false,
  }),
).toEqual({ allowed: true, reason: "allowed" });
```

Cover non-founder, scheduled execution, kill switch, cancelled run, tab-count mismatch, tab-ID mismatch, non-Zillow host, duration/action budget exhaustion, and forbidden action kinds.

- [ ] **Step 2: Verify the focused tests fail**

Run: `pnpm vitest run --project unit packages/policy/src/zillow-research-policy.unit.test.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts`

Expected: FAIL because the policy and checkpoint service do not exist.

- [ ] **Step 3: Add the fail-closed manifest and pure evaluator**

```ts
export const ZILLOW_RENTAL_RESEARCH_MANIFEST = SourcePolicyManifestSchema.parse({
  schemaVersion: 2,
  connectorId: "zillow.browser-research.v1",
  displayName: "Zillow rental research (founder experiment)",
  version: 1,
  source: "zillow",
  acquisitionMode: "local_browser",
  policyState: "experimental_personal",
  enabled: false,
  execution: "manual",
  capabilities: ["browser.capture"],
  allowedOperations: ["zillow.rental_research.v1"],
  allowedDomains: ["www.zillow.com"],
  allowedOrigins: ["https://www.zillow.com/"],
  allowedHttpMethods: ["GET"],
  requiresUserSession: true,
  requiresApproval: true,
  minimumIntervalSeconds: null,
  maxConcurrency: 1,
  globalKillSwitchKey: "browser.disabled",
  connectorKillSwitchKey: "connectors.zillow.browser-research.v1.disabled",
  dataClassification: "third_party",
  redactionRules: [
    "raw_content_from_logs",
    "full_urls_from_logs",
    "contact_details_from_logs",
    "credentials_from_logs",
  ],
  manualBlockerBehavior: "stop_and_request_user_action",
  owner: "Vera founder",
  reviewedAt: "2026-07-30",
  decisionRecord: "docs/superpowers/specs/2026-07-30-bounded-zillow-browser-research-design.md",
  notes: "Founder-only bounded rental research; user-triggered and disabled by default.",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
});
```

The evaluator must allow only `snapshot`, `navigate_observed`, `scroll_bounded`, `set_reviewed_filter`, `open_observed_listing`, and `return_to_results`; it must deny all contact/application/messaging/payment/authentication/file-transfer actions.

- [ ] **Step 4: Add authenticated checkpoint behavior**

The route accepts only a server-held bearer credential using constant-time comparison, validates a strict request, loads the founder-owned run/source job, evaluates the action, appends a redacted activity event, and returns only `{ allowed, reason, checkedAt }`. It never accepts a user ID, policy override, arbitrary URL, selector, or page content from the Gateway.

- [ ] **Step 5: Verify policy/checkpoint tests pass**

Run: `pnpm vitest run --project unit packages/policy/src/registry.unit.test.ts packages/policy/src/zillow-research-policy.unit.test.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the policy boundary**

```bash
git add packages/policy/src apps/web/lib/zillow-research-checkpoint-service.ts apps/web/lib/zillow-research-checkpoint-service.unit.test.ts apps/web/app/api/internal/browser-research/checkpoint/route.ts
git commit -m "feat: gate founder Zillow research actions"
```

### Task 3: Vera-Owned Gateway Tool

**Files:**
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/openclaw.plugin.json`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/package.json`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/fixtures/ready-results.json`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/fixtures/manual-blockers.json`
- Modify: `infra/maritime/openclaw/remote-extension.openclaw.json5`
- Modify: `infra/maritime/openclaw/remote-extension.Dockerfile`

**Interfaces:**
- Consumes: the strict JSON input from Task 1, OpenClaw loopback `GET /tabs`, `GET /snapshot`, `POST /navigate`, and semantic-reference-only `POST /act`.
- Consumes: `POST ${VERA_BROWSER_RESEARCH_CHECKPOINT_URL}` with the server-held `VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN` before every action.
- Produces: strict `ZillowRentalResearchOutput` JSON and registers exactly `vera_zillow_rental_research_v1`.

- [ ] **Step 1: Write contract and forbidden-action tests**

```ts
expect(toolNames).toEqual(["vera_zillow_rental_research_v1"]);
expect(await runTool(validInput, readyFixture)).toMatchObject({
  state: "completed",
  listings: [{ address: "Observed fixture address", sourceFieldProvenance: expect.any(Object) }],
});
expect(browserCalls).not.toContainEqual(
  expect.objectContaining({ path: expect.stringMatching(/evaluate|screenshot|download|upload/) }),
);
expect(serializedCalls).not.toMatch(/Contact|Apply|Request a tour|Message|Phone|Email|payment/i);
```

Add cases for two tabs, stale tab ID, non-Zillow host, non-rental Zillow surface, arbitrary extra input keys, manual blockers, layout changes, cancellation, elapsed time, 10/5/2 caps, non-observed link destinations, off-host links, and reauthorization before every call.

- [ ] **Step 2: Verify the Gateway tests fail**

Run: `pnpm vitest run --project unit infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

Expected: FAIL because the plugin does not exist.

- [ ] **Step 3: Implement the closed browser-control client**

Inside `index.mjs`, expose no generic operation dispatcher. Implement fixed functions:

```js
async function listSharedTabs(signal) {
  return browserRequest("GET", "/tabs", undefined, signal);
}
async function snapshotTab(targetId, signal) {
  return browserRequest(
    "GET",
    `/snapshot?profile=chrome&format=ai&compact=true&urls=true&targetId=${encodeURIComponent(targetId)}`,
    undefined,
    signal,
  );
}
async function navigateObserved(targetId, observedUrl, signal) {
  assertObservedZillowRentalUrl(observedUrl);
  return browserRequest("POST", "/navigate", { targetId, url: observedUrl }, signal);
}
async function activateObservedRef(targetId, ref, signal) {
  assertSemanticRef(ref);
  return browserRequest("POST", "/act", { targetId, request: { kind: "click", ref } }, signal);
}
```

Use only exact fixed endpoints and fixed action shapes. Do not implement an `evaluate` function, selector parameter, coordinate parameter, screenshot/download/upload operation, arbitrary action array, or arbitrary URL input.

- [ ] **Step 4: Implement deterministic bounded research**

Parse semantic snapshots into observed refs/links/text; detect blockers before filter/result extraction; reject instructions embedded in content; apply only exact reviewed filter labels; extract at most 10 cards; open at most 5 observed listing links; return to the captured observed results URL; stop at two bounded expansions or 90 seconds. Run `authorizeAction` and then re-list/revalidate the single shared tab immediately before every snapshot, navigation, semantic click/fill/select, or scroll.

- [ ] **Step 5: Allowlist only the Vera tools in OpenClaw**

Set the agent allowlist to:

```json5
allow: ["vera_read_shared_tab_snapshot", "vera_zillow_rental_research_v1"]
```

Keep the existing generic `browser`, `shell`, `filesystem`, and related deny entries and keep browser `evaluate` disabled. Copy the new plugin directory into the image without changing the pinned OpenClaw version or UID/GID.

- [ ] **Step 6: Verify Gateway and 13A snapshot tests pass**

Run: `pnpm vitest run --project unit infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts infra/maritime/openclaw/vera-read-shared-tab/index.unit.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the Gateway tool**

```bash
git add infra/maritime/openclaw/vera-zillow-rental-research infra/maritime/openclaw/remote-extension.openclaw.json5 infra/maritime/openclaw/remote-extension.Dockerfile
git commit -m "feat: add bounded Zillow Gateway tool"
```

### Task 4: Gateway Regression and Release Gates

**Files:**
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-gateway-image-layout.mjs`
- Modify: `scripts/verify-browser-boundaries.ts`
- Modify: `scripts/verify-gateway-runtime-supply-chain.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `infra/maritime/openclaw/vera-zillow-rental-research/restart.unit.test.ts`
- Create: `infra/maritime/openclaw/remote-extension-image.m13b-candidate.json`
- Modify: `docs/OPENCLAW_FOUNDER_SETUP.md`

**Interfaces:**
- Consumes: the accepted 13A digest and the new plugin/config from Task 3.
- Produces: automated assertions for route isolation, pairing/consent/revocation invariants, exact tool allowlist, no forbidden operations, restart preservation, immutable base, signed image metadata, SBOM/provenance, and zero HIGH/CRITICAL findings.

- [ ] **Step 1: Add failing boundary/restart assertions**

Require the accepted 13A digest to remain present as `rollbackImage`; require a distinct digest-only `candidateImage`; require the new plugin to survive restart while cancellation remains fail-closed; scan all plugin source/config for forbidden endpoint/action exposure and model-controlled URL/selector/evaluate fields.

- [ ] **Step 2: Verify the assertions fail before metadata/support changes**

Run: `pnpm run verify:remote-extension-config && pnpm run verify:gateway-image-layout && pnpm vitest run --project unit infra/maritime/openclaw/vera-zillow-rental-research/restart.unit.test.ts`

Expected: FAIL on missing candidate metadata or restart contract.

- [ ] **Step 3: Extend validation without weakening 13A gates**

Keep all existing OpenClaw version, extension 2.0.0, UID/GID 1000:1000, executable, route-filter, pairing, consent-tab, revocation, symlink reconciliation, and vulnerability checks. Add a distinct candidate descriptor whose digest is populated only after publication; do not edit or replace the accepted 13A digest record.

- [ ] **Step 4: Add CI focused tests**

Run the new Gateway tests and static no-forbidden-action verifier before the existing image build/scan job. The image job must continue producing SBOM and provenance artifacts and must fail for any HIGH or CRITICAL vulnerability.

- [ ] **Step 5: Verify all release gates pass locally**

Run: `pnpm run verify:browser-boundaries && pnpm run verify:remote-extension-config && pnpm run verify:gateway-image-layout && pnpm run verify:gateway-runtime-supply-chain && pnpm run verify:gateway-release-workflow`

Expected: PASS, with the candidate digest check explicitly deferred to the post-publish verification command rather than replaced by a mutable tag.

- [ ] **Step 6: Commit release-gate changes**

```bash
git add scripts .github/workflows/ci.yml infra/maritime/openclaw/remote-extension-image.m13b-candidate.json docs/OPENCLAW_FOUNDER_SETUP.md infra/maritime/openclaw/vera-zillow-rental-research/restart.unit.test.ts
git commit -m "test: preserve Gateway safety gates for Zillow research"
```

### Task 5: Maritime Zillow Tool Client

**Files:**
- Create: `packages/connectors/src/maritime-zillow-research-client.ts`
- Create: `packages/connectors/src/maritime-zillow-research-client.unit.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Consumes: `ZillowRentalResearchInputSchema` and `ZillowRentalResearchOutputSchema`.
- Produces: `MaritimeZillowResearchClient.run(input: ZillowRentalResearchInput, options: { signal: AbortSignal }): Promise<ZillowRentalResearchOutput>`.

- [ ] **Step 1: Write failing request/response contract tests**

Assert the client validates input before dispatch, instructs the reviewed agent to invoke exactly `vera_zillow_rental_research_v1` once, includes no arbitrary URL/action language, parses exactly one strict JSON object, rejects schema drift, and propagates cancellation/timeouts.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run --project unit packages/connectors/src/maritime-zillow-research-client.unit.test.ts`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the fixed client**

```ts
export interface MaritimeZillowResearchClient {
  run(
    input: ZillowRentalResearchInput,
    options: { signal: AbortSignal },
  ): Promise<ZillowRentalResearchOutput>;
}
```

Use the existing Maritime agent/chat authentication transport, a fixed prompt that contains the validated JSON input and exact tool name, a 95-second client deadline, and strict Zod output parsing. Never accept a prompt, system instruction, tool list, URL, selector, or action sequence from the caller.

- [ ] **Step 4: Verify connector tests pass**

Run: `pnpm vitest run --project unit packages/connectors/src/maritime-zillow-research-client.unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the client**

```bash
git add packages/connectors/src/maritime-zillow-research-client.ts packages/connectors/src/maritime-zillow-research-client.unit.test.ts packages/connectors/src/index.ts
git commit -m "feat: call bounded Zillow research through Maritime"
```

### Task 6: Source-Aware Search Coordinator and Safe Controls

**Files:**
- Modify: `packages/domain/src/live-search.ts`
- Modify: `packages/domain/src/live-search.unit.test.ts`
- Create: `apps/web/lib/browser-research-run-service.ts`
- Create: `apps/web/lib/browser-research-run-service.unit.test.ts`
- Modify: `apps/web/lib/live-search-service.ts`
- Modify: `apps/web/app/api/live-search/route.ts`
- Modify: `apps/web/app/api/live-search/[id]/route.ts`
- Create: `apps/web/app/api/live-search/[id]/execute/route.ts`
- Create: `apps/web/app/api/live-search/[id]/stop/route.ts`
- Create: `apps/web/app/api/live-search/[id]/retry/route.ts`

**Interfaces:**
- Consumes: existing RentCast flow, `MaritimeZillowResearchClient`, policy/checkpoint service, and repository provider.
- Produces source states: `ready`, `login_required`, `browser_offline`, `excluded_by_user`, `searching`, `completed`, `partial`, and `failed`.
- Produces progress phases: `connecting`, `checking_login`, `searching`, `opening_details`, `importing`, `deduplicating`, `ranking`, and `completed`.
- Produces: `startLiveSearch`, `executeLiveSearch`, `stopLiveSearch`, `retryFailedSource`, and `getLiveSearchStatus`.

- [ ] **Step 1: Write source-state and partial-completion tests**

```ts
expect(await service.start({ sources: ["rentcast", "zillow"], ...request })).toMatchObject({
  sources: {
    rentcast: { state: "ready" },
    zillow: { state: "ready" },
  },
});
expect(await service.execute(runId)).toMatchObject({
  sources: {
    rentcast: { state: "completed" },
    zillow: { state: "failed" },
  },
  overallState: "partial",
});
```

Also cover default-disabled Zillow, non-founder denial, disconnected extension, no shared tab/manual action, Stop, Retry failed source only, idempotent execute, and cancellation visible to the checkpoint route.

- [ ] **Step 2: Verify coordinator/API tests fail**

Run: `pnpm vitest run --project unit packages/domain/src/live-search.unit.test.ts apps/web/lib/browser-research-run-service.unit.test.ts`

Expected: FAIL on missing source-aware contract/service.

- [ ] **Step 3: Extend the live-search schemas**

Add strict selected-source input and per-source status output while maintaining compatibility for a request that selects only RentCast. Source selection must be explicit in the UI/API; omitted source selection is rejected for the new endpoint contract.

- [ ] **Step 4: Implement independent source execution**

Create one correlated `SourceJob` per selected source. Run each source in an independent guarded branch, append progress activity events, and derive overall completion without deleting the other source's imported records. POST `/execute` performs the bounded work with `maxDuration = 120`; the UI starts it and polls status. POST `/stop` marks only active source jobs cancelled; POST `/retry` creates an idempotent retry only for failed/partial sources.

- [ ] **Step 5: Verify coordinator/API tests pass**

Run: `pnpm vitest run --project unit packages/domain/src/live-search.unit.test.ts apps/web/lib/browser-research-run-service.unit.test.ts apps/web/lib/live-search-service.unit.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the orchestration**

```bash
git add packages/domain/src/live-search.ts packages/domain/src/live-search.unit.test.ts apps/web/lib/browser-research-run-service.ts apps/web/lib/browser-research-run-service.unit.test.ts apps/web/lib/live-search-service.ts apps/web/app/api/live-search
git commit -m "feat: coordinate RentCast and Zillow research sources"
```

### Task 7: RawListing Import, Provenance, Dedupe, and Scoring

**Files:**
- Create: `packages/connectors/src/zillow-research-import.ts`
- Create: `packages/connectors/src/zillow-research-import.unit.test.ts`
- Modify: `packages/connectors/src/deterministic-extraction.ts`
- Modify: `packages/connectors/src/deterministic-extraction.unit.test.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `apps/web/lib/browser-research-run-service.ts`
- Create: `apps/web/lib/zillow-pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `ZillowObservedListing` and existing `StructuredListingInputSchema`.
- Produces: `toZillowRawListingInput(listing, context): RawListingCreateInput`.
- Produces: deterministic extraction that preserves observed source URL, observed time, fields, per-field provenance, missing fields, warnings, and OpenClaw research notes.

- [ ] **Step 1: Write failing import/pipeline tests**

Assert that a Zillow listing becomes an immutable `RawListing`, normalizes into a listing/source record, persists field provenance, receives a versioned fit score, appears in the inbox, and clusters with a matching RentCast address/unit without destroying either source record. Assert missing Zillow facts remain unknown.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run --project unit packages/connectors/src/zillow-research-import.unit.test.ts packages/connectors/src/deterministic-extraction.unit.test.ts`

Expected: FAIL because the importer is absent.

- [ ] **Step 3: Implement observed-evidence mapping**

Map only supplied evidence into `StructuredListingInput`; set `source = "zillow"` and `sourceListingId` only when visible; use the observed canonical/final detail URL; place safe extraction warnings, missing fields, action counters, and redacted research notes in bounded capture metadata. Do not serialize a snapshot, semantic tree, ref map, cookie, account text, or unrelated tab metadata.

- [ ] **Step 4: Wire the existing canonical worker**

For every validated listing, create an idempotent `RawListing` using `veraRunId + canonicalObservedUrl` as the stable key, queue the existing normalization job, run normal decision reconciliation, dedupe, and scoring, and record the resulting normalized listing ID/cluster/score in safe activity metadata.

- [ ] **Step 5: Verify unit and PostgreSQL pipeline tests pass**

Run: `pnpm vitest run --project unit packages/connectors/src/zillow-research-import.unit.test.ts packages/connectors/src/deterministic-extraction.unit.test.ts`

Run: `pnpm vitest run --project postgres-integration apps/web/lib/zillow-pipeline.integration.test.ts`

Expected: PASS (the PostgreSQL command requires the repository's test database).

- [ ] **Step 6: Commit pipeline integration**

```bash
git add packages/connectors/src apps/web/lib/browser-research-run-service.ts apps/web/lib/zillow-pipeline.integration.test.ts
git commit -m "feat: import Zillow evidence through the canonical pipeline"
```

### Task 8: Source Selector, Live Progress, Stop/Retry, and Inbox Evidence

**Files:**
- Modify: `apps/web/app/live-search-panel.tsx`
- Create: `apps/web/app/live-search-panel.unit.test.tsx`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Create: `apps/web/app/listing-dashboard.unit.test.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/lib/listing-inbox.ts`

**Interfaces:**
- Consumes: source-aware live-search API/status and existing canonical listing presenter.
- Produces: explicit RentCast/Zillow selector, per-source state, ordered phase progress, manual-action instructions, Stop and Retry failed source controls, and listing evidence badges.

- [ ] **Step 1: Write failing UI tests**

Assert the panel requires one selected source; labels RentCast `Official API`; labels Zillow `Founder experiment`; shows disabled-by-policy copy; renders every required source state/progress phase; prompts “Open Zillow rentals and share exactly one tab” for no tab; and exposes Stop only while active and Retry only for failed/partial sources.

Assert listing cards show Vera fit score, source badge, duplicate-source badge, freshness, missing facts, risk indicators, and OpenClaw research notes when present.

- [ ] **Step 2: Verify UI tests fail**

Run: `pnpm vitest run --project unit apps/web/app/live-search-panel.unit.test.tsx apps/web/app/listing-dashboard.unit.test.tsx`

Expected: FAIL on missing controls/evidence.

- [ ] **Step 3: Implement the source-aware panel**

POST the selected sources, start `/execute`, poll `/api/live-search/[id]`, render each source independently, and stop polling only at a terminal overall state. The browser research itself remains user-triggered and single-run; status polling observes Vera job state and never initiates new Zillow browser work.

- [ ] **Step 4: Add safe listing evidence presentation**

Display only canonical pipeline output and safe capture metadata. Never render raw browser snapshots, semantic refs, cookies, credentials, or unrelated-tab metadata.

- [ ] **Step 5: Verify UI tests and web typecheck pass**

Run: `pnpm vitest run --project unit apps/web/app/live-search-panel.unit.test.tsx apps/web/app/listing-dashboard.unit.test.tsx`

Run: `pnpm --filter @vera/web run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the UI**

```bash
git add apps/web/app/live-search-panel.tsx apps/web/app/live-search-panel.unit.test.tsx apps/web/app/listing-dashboard.tsx apps/web/app/listing-dashboard.unit.test.tsx apps/web/app/globals.css apps/web/lib/listing-inbox.ts
git commit -m "feat: show multi-source browser research progress"
```

### Task 9: Opt-In Live Acceptance and Disposable 13B Infrastructure Variant

**Files:**
- Create: `apps/web/lib/live-founder-zillow-research.live.test.ts`
- Modify: `package.json`
- Create: `infra/digitalocean/browser-gateway/m13b-candidate-config.ts`
- Modify: `infra/digitalocean/browser-gateway/render-cloud-init.ts`
- Modify: `infra/digitalocean/browser-gateway/verify-rendered-cloud-init.ts`
- Create: `infra/digitalocean/browser-gateway/m13b-candidate-config.unit.test.ts`
- Create: `scripts/staging/zillow-browser-research-acceptance.ts`
- Modify: `docs/BROWSER_CONNECTOR.md`
- Modify: `docs/SOURCE_POLICY.md`

**Interfaces:**
- Consumes: a digest-pinned candidate image plus the proven 13A renderer/lifecycle/reconciliation code.
- Produces: `pnpm run test:live:founder-zillow` and a private, secret-redacted acceptance bundle.

- [ ] **Step 1: Write failing acceptance/config tests**

Require the 13A default renderer to produce its byte-identical accepted configuration and digest. Require the explicit `--milestone 13b` variant to accept only a digest-pinned candidate image/source revision plus server-held checkpoint URL/token placeholders, retain UID/GID 1000:1000 and VPC-only binding, and reject tags or missing values.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run --project unit infra/digitalocean/browser-gateway/m13b-candidate-config.unit.test.ts`

Expected: FAIL because the isolated candidate variant does not exist.

- [ ] **Step 3: Add the isolated candidate renderer**

Keep all 13A constants/defaults unchanged. The candidate path must require explicit CLI/env selection, reuse exact resource journal/readiness/restart/link-reconciliation/cleanup logic, inject secrets only at render time, and ensure rendered secret-bearing cloud-init stays private and is deleted during cleanup.

- [ ] **Step 4: Add the opt-in live test**

The live test must skip unless `VERA_RUN_LIVE_FOUNDER_ZILLOW_TESTS=1`. It must assert one Boston run imports at least one real Zillow listing, normalization and scoring IDs exist, the safe action trail contains no forbidden actions, unsharing makes the next checkpoint/browser attempt stop, pairing is revoked, and cleanup readback reports zero disposable resources/secrets.

- [ ] **Step 5: Add exact setup/runbook commands**

Document environment names and commands without values: enable founder/search policy and browser kill switch; configure checkpoint URL/token; deploy digest-only candidate through the `13b` variant; pair official extension 2.0.0; open Zillow rentals; log in manually if required; share exactly one tab; use the UI path; unshare; revoke; cleanup. State that no password is ever supplied to Vera.

- [ ] **Step 6: Verify focused live-test compilation and infrastructure tests**

Run: `pnpm vitest run --project unit apps/web/lib/live-founder-zillow-research.live.test.ts infra/digitalocean/browser-gateway/m13b-candidate-config.unit.test.ts`

Expected: PASS with the live test skipped when the opt-in variable is absent.

- [ ] **Step 7: Commit acceptance support**

```bash
git add apps/web/lib/live-founder-zillow-research.live.test.ts package.json infra/digitalocean/browser-gateway scripts/staging/zillow-browser-research-acceptance.ts docs/BROWSER_CONNECTOR.md docs/SOURCE_POLICY.md
git commit -m "test: add opt-in founder Zillow acceptance"
```

### Task 10: Verification, PR, Immutable Release, Live Acceptance, and Cleanup

**Files:**
- Modify after publication: `infra/maritime/openclaw/remote-extension-image.m13b-candidate.json`
- Create privately at runtime only: `release-evidence/private/m13b-zillow-20260730-live/`

**Interfaces:**
- Consumes: all code/tests above and existing release/deployment workflows.
- Produces: one reviewed commit/PR, one immutable signed image candidate, verified SBOM/provenance/digest/zero HIGH+CRITICAL scan, one real imported Boston Zillow listing, revocation proof, and zero-resource cleanup readback.

- [ ] **Step 1: Run the narrow and global verification suite**

Run:

```bash
pnpm vitest run --project unit packages/domain/src/zillow-browser-research.unit.test.ts packages/policy/src/zillow-research-policy.unit.test.ts packages/connectors/src/maritime-zillow-research-client.unit.test.ts packages/connectors/src/zillow-research-import.unit.test.ts infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run verify:browser-boundaries
pnpm run verify:remote-extension-config
pnpm run verify:gateway-image-layout
pnpm run verify:gateway-runtime-supply-chain
pnpm run verify:digitalocean-browser-gateway
```

Expected: all commands PASS.

- [ ] **Step 2: Review the complete diff**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git grep -n -E '(password|cookie|credential|secret|token)' -- ':!pnpm-lock.yaml'
git status --short
```

Inspect every match in context. Confirm no secret values, raw snapshots, unsafe operations, mutable image tags, weakened 13A gates, unrelated changes, or dead paths were introduced.

- [ ] **Step 3: Create the requested milestone commit and PR**

```bash
git add packages/domain packages/policy packages/connectors apps/web infra/maritime/openclaw infra/digitalocean/browser-gateway scripts docs .github/workflows/ci.yml package.json
git commit -m "feat: add bounded founder Zillow browser research"
git push origin codex/browser-research-zillow
gh pr create --base main --head codex/browser-research-zillow --title "feat: add bounded founder Zillow browser research" --body-file /private/tmp/vera-m13b-pr-body.md
gh pr checks --watch
```

Expected: the focused PR is open and all required checks are green.

- [ ] **Step 4: Publish exactly one immutable candidate through the protected release workflow**

After the reviewed PR is merged under repository policy, dispatch the existing protected Gateway release workflow for that exact main revision. Record the returned digest-qualified GHCR image reference once in `remote-extension-image.m13b-candidate.json`; never retag, rebuild, or substitute the candidate during acceptance.

- [ ] **Step 5: Verify supply chain**

Use the existing registry inspection/attestation commands to verify signature identity, source revision, SBOM, SLSA provenance, OpenClaw 2026.7.1, extension 2.0.0, UID/GID 1000:1000, exact executable set, and zero HIGH/CRITICAL scan findings. Save only redacted results and hashes under the gitignored 0700 private evidence directory with 0600 files.

- [ ] **Step 6: Run one real founder Boston acceptance**

Deploy exactly one disposable DigitalOcean Gateway from the digest-pinned candidate; wait for backend-local health before creating public ingress; pair the reviewed official extension; manually log in if Zillow requests it; share exactly one Zillow rentals tab; open Vera → Search profile → Find live listings → select Zillow (and optionally RentCast) → confirm fresh paid search → Search live sources. Verify at least one observed listing appears in Inbox with normalization ID, provenance, source badge, fit score, missing facts/risk indicators, and no forbidden-action audit entries.

- [ ] **Step 7: Prove revocation and cleanup**

Click the OpenClaw extension on the shared Zillow tab to unshare it; verify a further browser checkpoint/tool attempt stops with no shared tab and produces no new `RawListing`. Unpair/revoke the extension, destroy the one disposable Droplet/LB/certificate/firewall/DNS/tag/key/token, remove local private keys/rendered secret inputs, clear clipboard secrets, and run provider/Keychain/local readback until billable disposable resources, temporary delegation, credentials, and raw secret files all equal zero.

- [ ] **Step 8: Final handoff**

Report the strict tool contract; allowed/forbidden actions; files changed; exact setup commands and UI click path; immutable image digest; real result count and proof of normalization/scoring; safe-action/revocation/cleanup results; known Zillow limitations; and this next prompt:

```text
Add a second founder-only BrowserSourceAdapter for one reviewed source at a time, reusing vera_zillow_rental_research_v1's strict input/output, per-action checkpoint, semantic-reference, bounded-navigation, blocker, provenance, partial-completion, revocation, and immutable-release gates. Start with Apartments.com; do not add Facebook Marketplace until Apartments.com passes its own live acceptance and cleanup.
```
