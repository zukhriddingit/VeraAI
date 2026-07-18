# Offline Ship Season Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, credential-free Vera recording flow from a staged sanitized search through listing evidence, fit/risk explanations, shortlist, manual capture, and activity history.

**Architecture:** Keep the existing seed as the reliable canonical fixture graph, hide it in explicit demo mode until an audited fixture-connector run completes, and reuse the current policy, capture, lifecycle, repository, and activity boundaries. Add only pure deterministic scoring/risk functions, read projections, guarded local APIs, focused UI, safe demo scripts, and offline tests.

**Tech Stack:** TypeScript 6, pnpm workspaces, Next.js App Router, React 19, SQLite/better-sqlite3, Drizzle, Zod 4, Vitest, Playwright Chromium, existing CSS.

## Global Constraints

- Preserve Maritime as the primary future orchestrator and OpenClaw as the default future browser adapter in existing architecture documents.
- Do not implement Maritime, OpenClaw, Gmail, Google Calendar, OAuth, a live LLM, or any live marketplace integration.
- Add no dependencies and perform no platform scraping or external network access.
- Demo behavior is enabled only by exact `VERA_DEMO_MODE=1`; demo-only APIs fail closed otherwise.
- Keep all source URLs synthetic under `example.invalid`; add no credentials or real personal data.
- Keep RawListing and ActivityEvent append-only and use explicit lifecycle transitions for shortlist state.
- Unknown listing facts remain neutral/unknown; risk output is evidence-backed and never a scam verdict.
- Use a dedicated demo application-data directory and never reset normal Vera data, the repository root, or the home directory.
- This workspace has no `.git`; do not initialize one and do not include commit commands in execution.

---

### Task 1: Safe demo runtime and root commands

**Files:**

- Create: `scripts/demo-environment.ts`
- Create: `scripts/demo-reset.ts`
- Create: `scripts/demo-seed.ts`
- Create: `scripts/demo-start.ts`
- Create: `scripts/demo-environment.unit.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `resolveDemoDataDirectory(environment?, platform?, homeDirectory?)`, `demoEnvironment(base?)`, and root commands `demo:reset`, `demo:seed`, `demo`.
- Consumes: `getDataDirectory`, `migrateDatabase`, `seedDatabase`, `openDatabase`, and existing `pnpm dev`.

- [ ] **Step 1: Write the failing safe-path tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveDemoDataDirectory, validateDemoResetTarget } from "./demo-environment.ts";

describe("demo data directory", () => {
  it("uses a distinct sibling of normal Vera data", () => {
    expect(resolveDemoDataDirectory({}, "darwin", "/Users/demo")).toBe(
      "/Users/demo/Library/Application Support/Vera Demo"
    );
  });

  it("honors an explicit demo-only override", () => {
    expect(
      resolveDemoDataDirectory({ VERA_DEMO_DATA_DIR: "/tmp/vera-recording" }, "linux", "/home/demo")
    ).toBe("/tmp/vera-recording");
  });

  it("rejects broad or production reset targets", () => {
    expect(() => validateDemoResetTarget("/Users/demo", "/Users/demo/.local/share/vera")).toThrow(
      "Unsafe demo reset target"
    );
    expect(() =>
      validateDemoResetTarget("/Users/demo/.local/share/vera", "/Users/demo/.local/share/vera")
    ).toThrow("Unsafe demo reset target");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm exec vitest run --project unit scripts/demo-environment.unit.test.ts`  
Expected: FAIL because `demo-environment.ts` does not exist.

- [ ] **Step 3: Implement deterministic environment resolution**

```ts
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getDataDirectory } from "../packages/db/src/paths.ts";

export function resolveDemoDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir()
): string {
  const override = environment.VERA_DEMO_DATA_DIR?.trim();
  if (override) return resolve(override);
  const production = getDataDirectory({ environment, platform, homeDirectory });
  return join(dirname(production), platform === "linux" ? "vera-demo" : "Vera Demo");
}

export function validateDemoResetTarget(target: string, production: string): string {
  const resolved = resolve(target);
  const forbidden = new Set([
    resolve("/"),
    resolve(homedir()),
    resolve(process.cwd()),
    resolve(production)
  ]);
  if (forbidden.has(resolved)) throw new Error("Unsafe demo reset target.");
  return resolved;
}

export function demoEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = {
    ...base,
    VERA_DEMO_MODE: "1",
    VERA_DATA_DIR: resolveDemoDataDirectory(base),
    NEXT_TELEMETRY_DISABLED: "1"
  };
  delete environment.OPENAI_API_KEY;
  delete environment.VERA_LLM_MODEL;
  delete environment.VERA_LLM_TIMEOUT_MS;
  return environment;
}
```

Implement reset with `rmSync(validatedTarget, { recursive: true, force: true })`, seed by opening the explicit demo database, applying migrations, and calling `seedDatabase`, and start with `spawn("pnpm", ["dev"], { stdio: "inherit", env: demoEnvironment() })`. Forward `SIGINT`/`SIGTERM` to the child and propagate its exit code.

- [ ] **Step 4: Add exact root scripts**

```json
{
  "demo:reset": "node --import tsx scripts/demo-reset.ts",
  "demo:seed": "node --import tsx scripts/demo-seed.ts",
  "demo": "node --import tsx scripts/demo-start.ts"
}
```

- [ ] **Step 5: Verify scripts and tests**

Run: `pnpm exec vitest run --project unit scripts/demo-environment.unit.test.ts`  
Expected: PASS.

Run: `pnpm demo:reset && pnpm demo:seed`  
Expected: both exit 0; seed prints exactly 12 raw/source records, 8 canonical listings, and 3 clusters once Task 3 is complete.

### Task 2: Deterministic demo scoring and risk rules

**Files:**

- Create: `packages/scoring/src/demo-evaluation.ts`
- Create: `packages/scoring/src/demo-evaluation.unit.test.ts`
- Modify: `packages/scoring/src/index.ts`
- Modify: `packages/scoring/package.json`

**Interfaces:**

- Produces: `scoreDemoListing(profile, listing): DemoListingEvaluation` and `deriveDemoRiskSignals(listing, sourceRecords, now): RiskSignal[]`.
- Consumes: `SearchProfile`, `CanonicalListing`, `ListingSourceRecord`, `ListingScore`, `RiskSignal`, and deterministic hash input supplied by the seed.

- [ ] **Step 1: Write failing score tests**

```ts
describe("scoreDemoListing", () => {
  it("scores known matches and keeps unknown facts neutral", () => {
    const result = scoreDemoListing(DEMO_PROFILE, CANONICAL_FIXTURES[7]!.listing);
    const budget = result.factors.find((factor) => factor.code === "budget_fit");
    expect(budget?.scoreBasisPoints).toBe(0);
    expect(budget?.reasonCode).toBe("budget_unknown");
    expect(result.topConcern).toContain("Rent needs verification");
  });

  it("does not treat unknown pet policy as incompatible", () => {
    const result = scoreDemoListing(DEMO_PROFILE, CANONICAL_FIXTURES[4]!.listing);
    expect(
      result.factors.find((factor) => factor.code === "pet_compatibility")?.scoreBasisPoints
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Write failing risk tests**

```ts
describe("deriveDemoRiskSignals", () => {
  it("creates evidence-backed payment-language and conflicting-rent signals", () => {
    const signals = deriveDemoRiskSignals(
      CANONICAL_FIXTURES[0]!.listing,
      SOURCE_FIXTURES.slice(0, 3).map((fixture) => fixture.sourceRecord),
      "2026-07-17T12:20:00.000Z"
    );
    expect(signals.map((signal) => signal.code)).toContain("conflicting_rent_evidence");
    expect(signals.every((signal) => signal.evidence.length > 0)).toBe(true);
    expect(JSON.stringify(signals)).not.toMatch(/definitive|scam verdict/iu);
  });
});
```

- [ ] **Step 3: Run the tests and confirm failure**

Run: `pnpm exec vitest run --project unit packages/scoring/src/demo-evaluation.unit.test.ts`  
Expected: FAIL because the evaluator does not exist.

- [ ] **Step 4: Implement the four-factor scorer**

Use exact factor codes `budget_fit`, `bedroom_fit`, `pet_compatibility`, and `move_in_compatibility`. Assign each factor 2,500 weight basis points. Return `+10_000` for a known match, `-10_000` for a known conflict, and `0` for unknown. Compute the weighted average and clamp to `[-10_000, 10_000]`.

```ts
export interface DemoListingEvaluation {
  readonly totalScoreBasisPoints: number;
  readonly factors: readonly ScoreFactor[];
  readonly reasonCodes: readonly string[];
  readonly topPositiveReason: string;
  readonly topConcern: string;
}
```

Budget compares known rent plus known recurring fees with the target and absolute maximum. Bedroom fit compares known bedrooms with `minimumBedrooms`. Cat/dog requirements compare only explicitly known policy values. Move-in fit compares a known availability date with the profile window. Unknown values produce neutral reason codes ending in `_unknown` and visible verification text.

- [ ] **Step 5: Implement bounded evidence-backed risk rules**

Scan only sanitized source-record descriptions and same-cluster structured facts. Create stable signal IDs from listing ID plus rule code. Match payment-before-viewing and `wire|cryptocurrency|gift card` phrases case-insensitively. Emit conflicting-rent evidence only when two known source rents differ. Each signal includes exact synthetic evidence summary and a verification action; never emit a fraud verdict.

- [ ] **Step 6: Export and verify**

Add `@vera/domain` as a workspace dependency of `@vera/scoring`, export the new functions, and run:

`pnpm exec vitest run --project unit packages/scoring/src/demo-evaluation.unit.test.ts`  
Expected: PASS.

### Task 3: Align fixture capture identity and enrich the idempotent seed

**Files:**

- Modify: `packages/db/src/fixtures.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/src/seed.integration.test.ts`

**Interfaces:**

- Produces: `DEMO_SEARCH_PROFILE`, fixture `request` values accepted by `FixtureConnector`, eight static score snapshots, and deterministic risk fixtures.
- Consumes: Task 2's versioned factor/reason vocabulary and existing repositories/tables without adding a `db -> scoring` package dependency.

- [ ] **Step 1: Extend the failing seed assertions**

```ts
expect(result).toMatchObject({
  searchProfiles: 1,
  rawListings: 12,
  sourceRecords: 12,
  canonicalListings: 8,
  duplicateClusters: 3,
  listingScores: 8
});
expect(repositories.searchProfiles.getById("profile-demo-harbor-city")).toMatchObject({
  minimumBedrooms: 1,
  targetMonthlyTotalCents: 260_000
});
expect(repositories.listingScores.listByCanonicalListingId("can-juniper-1a")).toHaveLength(1);
expect(repositories.riskSignals.listByCanonicalListingId("can-juniper-1a").length).toBeGreaterThan(
  0
);
```

Also assert that the second seed returns exactly the same counts and does not add score/risk rows.

- [ ] **Step 2: Run the seed integration test and confirm failure**

Run: `pnpm exec vitest run --project integration packages/db/src/seed.integration.test.ts`  
Expected: FAIL because the profile, score, and risk fixtures are absent.

- [ ] **Step 3: Make each source fixture carry its connector request**

Extend `SourceFixture` with `request: FixtureCaptureRequest`. Build it from the source record values using `example.invalid` URLs. Shape `capture.rawJson` and `captureMetadata` exactly like `FixtureConnector` plus `captureListing`:

```ts
captureMetadata: {
  networkAccess: false,
  untrustedContent: true,
  browserAccess: "not_applicable",
  connectorId: "fixture.feed.v1",
  capability: "fixture.read"
}
```

Preserve fixed observed times and existing source/canonical IDs. Refine only synthetic descriptions needed for risk evidence.

- [ ] **Step 4: Add the sanitized profile and derived fixtures**

Create `DEMO_SEARCH_PROFILE` with ID `profile-demo-harbor-city`, target 260,000 cents, maximum 300,000 cents, minimum one bedroom, move-in dates `2026-09-01` through `2026-09-30`, required cat compatibility, and explicit must-have/preference text.

Create stable `ListingScore` fixture rows with algorithm `demo-fit-v1` and factor/reason values matching Task 2's public vocabulary. Create `RiskSignal` fixture rows for the exact synthetic evidence covered by Task 2's rules. Use domain-separated SHA-256 input hashes and fixed seed time. `packages/db` must continue to depend only on `@vera/domain`; do not add a `@vera/scoring` dependency.

- [ ] **Step 5: Seed all new rows idempotently**

Insert or exact-match the profile before listings. Insert or exact-match scores and risks after canonical memberships. Extend `SeedResult` with `searchProfiles`, `listingScores`, and `riskSignals`. Do not add a migration.

- [ ] **Step 6: Verify seed and no personal data**

Run: `pnpm exec vitest run --project integration packages/db/src/seed.integration.test.ts`  
Expected: PASS with 12/8/3 and one profile.

Run: `rg -n -e 'zillow\\.com|facebook\\.com|craigslist\\.org|apartments\\.com|@[A-Za-z0-9.-]+\\.(com|org|net)' packages/db/src/fixtures.ts`  
Expected: no matches.

### Task 4: Domain presentation schemas and repository read projections

**Files:**

- Create: `packages/domain/src/demo-api.ts`
- Create: `packages/domain/src/demo-api.unit.test.ts`
- Modify: `packages/domain/src/api.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/sqlite-repositories.ts`
- Modify: `packages/db/src/repositories.integration.test.ts`

**Interfaces:**

- Produces: strict demo/status/detail/activity/shortlist schemas and listing-scoped repository reads.
- Consumes: existing listing, profile, source-record, provenance, score, risk, and activity schemas.

- [ ] **Step 1: Write schema tests**

Test exact rejection of unknown fields and invalid counts for:

```ts
DemoStatusResponseSchema;
DemoRunResponseSchema;
CanonicalListingDetailResponseSchema;
ShortlistRequestSchema;
ShortlistResponseSchema;
ActivityCollectionResponseSchema;
```

`DemoRunResponseSchema` contains `status: "not_run" | "completed"`, `sourceRecordsAnalyzed`, `homesFound`, `duplicateClusters`, `summary`, and `idempotentReplay`. The completion refinement requires exactly 12/8/3 and the exact summary copy.

- [ ] **Step 2: Write failing repository integration tests**

```ts
expect(repositories.listingScores.listByCanonicalListingId("can-juniper-1a")).toHaveLength(1);
expect(repositories.riskSignals.listByCanonicalListingId("can-juniper-1a").length).toBeGreaterThan(
  0
);
expect(repositories.canonicalListings.listFieldSources("can-juniper-1a").length).toBeGreaterThan(0);
expect(repositories.activityEvents.listByTarget("canonical_listing", "can-juniper-1a")).toEqual([]);
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `pnpm exec vitest run --project unit packages/domain/src/demo-api.unit.test.ts`  
Run: `pnpm exec vitest run --project integration packages/db/src/repositories.integration.test.ts`  
Expected: FAIL for missing schemas/methods.

- [ ] **Step 4: Implement strict projections**

Extend `CanonicalListingSummarySchema` with:

```ts
fitScoreBasisPoints: z.number().int().min(-10_000).max(10_000).nullable(),
fitLabel: z.enum(["strong_fit", "possible_fit", "needs_review"]).nullable(),
topPositiveReason: z.string().trim().min(1).max(300).nullable(),
topConcern: z.string().trim().min(1).max(300).nullable(),
riskIndicatorCount: z.number().int().nonnegative()
```

Detail response includes canonical summary, source records with per-source provenance arrays, nullable duplicate explanation, nullable latest score, risks, and listing-target activity events. Activity presentation includes only safe scalar fields and redacted metadata keys.

- [ ] **Step 5: Add repository methods**

Add:

```ts
ListingScoreRepository.listByCanonicalListingId(id: string): readonly ListingScore[];
RiskSignalRepository.listByCanonicalListingId(id: string): readonly RiskSignal[];
CanonicalListingRepository.listFieldSources(id: string): readonly CanonicalFieldSource[];
ActivityEventRepository.listByTarget(targetType: string, targetId: string): readonly ActivityEvent[];
```

Use validated inputs, deterministic ordering, and existing row mappers. Update `listSummaries()` to join/project the newest score and count open risks without N+1 queries where practical.

- [ ] **Step 6: Verify projection tests**

Run both focused commands from Step 3.  
Expected: PASS.

### Task 5: Guarded, idempotent demo search service and listing reveal

**Files:**

- Create: `apps/web/lib/demo-mode.ts`
- Create: `apps/web/lib/demo-search-service.ts`
- Create: `apps/web/lib/demo-search-service.integration.test.ts`
- Create: `apps/web/app/api/demo/status/route.ts`
- Create: `apps/web/app/api/demo/status/route.integration.test.ts`
- Create: `apps/web/app/api/demo/run/route.ts`
- Create: `apps/web/app/api/demo/run/route.integration.test.ts`
- Modify: `apps/web/app/api/listings/route.ts`
- Modify: `apps/web/app/api/listings/route.integration.test.ts`

**Interfaces:**

- Produces: `isDemoMode(environment)`, `getDemoStatus(repositories)`, and `runDemoSearch(dependencies)`.
- Consumes: fixture requests from Task 3, `captureListing`, fixture connector registry, persisted policy registry, and stable completion event ID `event-demo-search-v1-completed`.

- [ ] **Step 1: Write fail-closed and idempotency tests**

Cover:

```ts
expect(isDemoMode({ VERA_DEMO_MODE: "1" })).toBe(true);
expect(isDemoMode({ VERA_DEMO_MODE: "true" })).toBe(false);
expect(isDemoMode({})).toBe(false);
```

Integration expectations after seeding:

```ts
expect(getDemoStatus(repositories).status).toBe("not_run");
const first = runDemoSearch(dependencies);
const countsAfterFirst = snapshotCounts(repositories);
const second = runDemoSearch(dependencies);
expect(first).toMatchObject({ sourceRecordsAnalyzed: 12, homesFound: 8, duplicateClusters: 3 });
expect(second.idempotentReplay).toBe(true);
expect(snapshotCounts(repositories)).toEqual(countsAfterFirst);
expect(
  repositories.activityEvents.list().filter((event) => event.action === "demo.search.completed")
).toHaveLength(1);
```

Also disable `fixture.feed.v1` in a test and assert no completion marker and no revealed listings.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm exec vitest run --project integration apps/web/lib/demo-search-service.integration.test.ts apps/web/app/api/demo/status/route.integration.test.ts apps/web/app/api/demo/run/route.integration.test.ts apps/web/app/api/listings/route.integration.test.ts`  
Expected: FAIL because demo service/routes do not exist.

- [ ] **Step 3: Implement exact demo-mode guard and status**

`isDemoMode` accepts only the exact string `"1"`. Status reads the stable completion event, validates its payload hash and 12/8/3 metadata, and returns the fixed profile. Invalid completion metadata throws a safe demo-state error.

- [ ] **Step 4: Implement the audited search batch**

Use `captureListing(fixture.request, ...)` twelve times with each fixture's fixed observed time and collision-resistant event IDs. Verify each response resolves to the fixture raw listing ID and reports duplicate reuse. After every capture succeeds, append a stable `normalization.reused` event per raw/source pair only if missing, then append stable `demo.search.completed` with the domain-separated fixture payload hash and 12/8/3 metadata.

Check for the completion marker before any new event. On replay, validate and return it immediately. Never append completion after a failed fixture or denied policy decision.

- [ ] **Step 5: Implement guarded routes and reveal behavior**

Both `/api/demo/*` routes return 404 with safe JSON unless demo mode is exact. POST returns 200 on success/replay. Update listings GET to return an empty collection only when demo mode is on and status is `not_run`; retain current behavior outside demo mode.

- [ ] **Step 6: Verify focused integration tests**

Run the command from Step 2.  
Expected: PASS, including hidden-before-run and 8-visible-after-run.

### Task 6: Listing detail, shortlist, and activity APIs

**Files:**

- Create: `apps/web/lib/listing-presentation.ts`
- Create: `apps/web/lib/listing-presentation.integration.test.ts`
- Create: `apps/web/app/api/listings/[id]/route.ts`
- Create: `apps/web/app/api/listings/[id]/route.integration.test.ts`
- Create: `apps/web/app/api/listings/[id]/shortlist/route.ts`
- Create: `apps/web/app/api/listings/[id]/shortlist/route.integration.test.ts`
- Create: `apps/web/app/api/activity/route.ts`
- Create: `apps/web/app/api/activity/route.integration.test.ts`
- Modify: `packages/domain/src/lifecycle.ts`
- Modify: `packages/domain/src/lifecycle.unit.test.ts`

**Interfaces:**

- Produces: `getListingDetail`, `setListingShortlist`, and redacted activity collection.
- Consumes: Task 4 schemas/read methods and existing `transitionLifecycle`.

- [ ] **Step 1: Write reversible lifecycle test**

```ts
expect(transitionListingLifecycle("new", "shortlisted")).toBe("shortlisted");
expect(transitionListingLifecycle("shortlisted", "new")).toBe("new");
```

- [ ] **Step 2: Write route/service integration tests**

Assert Juniper detail has three sources, non-empty provenance, an explanation containing normalized address/unit and source names, score factors, a risk signal, and no contact value. Assert shortlist changes `new -> shortlisted -> new`, persists after reopening the repository, and appends exactly one event per successful change. Assert invalid repeated target state returns 409 without a success event. Assert activity API omits raw bodies, URLs, evidence excerpts, email, and phone-shaped values.

- [ ] **Step 3: Run tests and confirm failure**

Run: `pnpm exec vitest run --project unit packages/domain/src/lifecycle.unit.test.ts`  
Run: `pnpm exec vitest run --project integration apps/web/lib/listing-presentation.integration.test.ts apps/web/app/api/listings/\[id\]/route.integration.test.ts apps/web/app/api/listings/\[id\]/shortlist/route.integration.test.ts apps/web/app/api/activity/route.integration.test.ts`  
Expected: FAIL for missing transition/routes.

- [ ] **Step 4: Implement explicit removal transition**

Add only `"new"` to the `shortlisted` adjacency list. Do not permit reversals from draft or later workflow states.

- [ ] **Step 5: Implement detail projection**

Load canonical listing, summary, member source records, each member's provenance, cluster, latest score, risks, and target activity. Duplicate explanation is null for one-source listings; otherwise use source names plus exact cluster reason `fixture_declared_duplicate` and normalized address/unit language.

- [ ] **Step 6: Implement transactional shortlist service**

Parse `{ shortlisted: boolean }`; map to target state `shortlisted` or `new`; compute a canonical payload hash; inside one repository transaction transition lifecycle and append `listing.shortlisted` or `listing.shortlist_removed`. Use `randomUUID` only for event/correlation IDs and never bypass the domain transition.

- [ ] **Step 7: Implement safe activity projection and routes**

Return newest-first activity display rows with action, target type/ID, outcome, policy decision, correlation ID, and timestamp. Keep metadata to an allowlist of safe count/reason/status values; do not return full URLs, payload bodies, contact data, or evidence snippets.

- [ ] **Step 8: Verify focused tests**

Run both commands from Step 3.  
Expected: PASS.

### Task 7: Demo banner, recording cockpit, listing detail, and activity UI

**Files:**

- Create: `apps/web/app/demo-banner.tsx`
- Create: `apps/web/app/demo-search.tsx`
- Create: `apps/web/app/listings/[id]/page.tsx`
- Create: `apps/web/app/listings/[id]/listing-detail.tsx`
- Create: `apps/web/app/activity/page.tsx`
- Create: `apps/web/app/activity/activity-timeline.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Modify: `apps/web/app/capture/page.tsx`
- Modify: `apps/web/app/connectors/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Produces: visible exact demo banner, staged-empty dashboard, 12/8/3 completion, rich cards, detail, shortlist control, and activity page.
- Consumes: Tasks 4–6 HTTP schemas/routes.

- [ ] **Step 1: Add component-level expectations to the E2E spec before UI code**

Use exact accessible names:

```ts
await expect(
  page.getByText("Demo mode — sanitized fixture data; no live marketplace accounts connected.")
).toBeVisible();
await expect(page.getByRole("button", { name: "Run demo search" })).toBeVisible();
await expect(page.getByText("No demo results yet")).toBeVisible();
```

- [ ] **Step 2: Implement the layout banner**

Render `<DemoBanner />` only when `process.env.VERA_DEMO_MODE === "1"`. Use the exact required sentence. Keep it above page content on every route.

- [ ] **Step 3: Refine the home page into the recording cockpit**

Replace the large system-readiness block with a compact profile card showing Harbor City, $2,600 target / $3,000 maximum, 1+ bedroom, September 2026, cat required, and must-haves. Keep the tagline. Add navigation links for Listings, Capture a listing, Activity, and Connector status.

- [ ] **Step 4: Implement demo search client state**

Fetch `/api/demo/status` on mount. Before completion show the empty state and enabled button. POST once, disable while loading, parse strict response, show:

```text
12 source records analyzed · 8 homes found · 3 duplicate clusters.
```

Then refresh/reload listing data. Display a safe retry message on non-success without implying live source results.

- [ ] **Step 5: Upgrade listing cards**

Preserve address, price, beds/baths, source badges, unknown fields, duplicate badge, and lifecycle state. Add fit label/score, top positive reason, top concern, risk count, freshness, and a `View evidence` link to `/listings/[id]`. Use `data-testid="listing-card"` and `data-testid="duplicate-badge"` for stable E2E assertions.

- [ ] **Step 6: Implement detail and activity clients**

Detail fetches strict API data and renders canonical facts, source records, provenance, duplicate explanation, score factors, risk cards, timeline, shortlist toggle, manual-capture link, and disabled `Prepare outreach — coming next`. Activity fetches and renders safe rows newest first.

- [ ] **Step 7: Add focused CSS without a redesign**

Reuse existing variables. Add responsive rules for `.demo-banner`, `.profile-card`, `.demo-search-card`, `.fit-pill`, `.risk-count`, `.detail-grid`, `.source-evidence-card`, `.risk-card`, `.activity-row`, and `.shortlist-button`. Keep recording viewport legible at 1280×720 and mobile fallback at 720px.

- [ ] **Step 8: Run lint and typecheck for the UI slice**

Run: `pnpm lint`  
Run: `pnpm typecheck`  
Expected: both PASS.

### Task 8: Offline Playwright golden path and founder recording guide

**Files:**

- Create: `tests/e2e/demo.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/capture.spec.ts`
- Modify: `tests/e2e/reset-data.ts`
- Modify: `playwright.config.ts`
- Create: `docs/DEMO_NOW.md`
- Modify: `docs/DEMO.md`

**Interfaces:**

- Produces: one offline golden recording test and exact founder instructions.
- Consumes: all prior tasks.

- [ ] **Step 1: Configure Playwright for explicit demo mode**

Set web-server environment to `VERA_DEMO_MODE=1`, `VERA_DEMO_DATA_DIR`/`VERA_DATA_DIR` under `test-results`, `NEXT_TELEMETRY_DISABLED=1`, and blank/absent model variables. Replace setup command with reset/migrate/seed/build/start against the isolated E2E directory. Preserve existing capture E2E coverage.

- [ ] **Step 2: Write the complete golden test**

```ts
test("offline Ship Season demo path", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("Demo mode — sanitized fixture data; no live marketplace accounts connected.")
  ).toBeVisible();
  await expect(page.getByText("No demo results yet")).toBeVisible();
  await page.getByRole("button", { name: "Run demo search" }).click();
  await expect(
    page.getByText("12 source records analyzed · 8 homes found · 3 duplicate clusters.")
  ).toBeVisible();
  await expect(page.getByTestId("listing-card")).toHaveCount(8);
  await expect(page.getByTestId("duplicate-badge")).toHaveCount(3);
  await page.getByRole("link", { name: /View evidence for Juniper Row/u }).click();
  await expect(page.getByText(/Same normalized address and unit/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk indicators" })).toBeVisible();
  await page.getByRole("button", { name: "Add to shortlist" }).click();
  await expect(page.getByRole("button", { name: "Remove from shortlist" })).toBeVisible();
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText("demo.search.completed")).toBeVisible();
  await expect(page.getByText("listing.shortlisted")).toBeVisible();
});
```

- [ ] **Step 3: Run the golden test first**

Run: `pnpm exec playwright test tests/e2e/demo.spec.ts --project chromium`  
Expected: PASS without API keys or network fixtures.

- [ ] **Step 4: Write `docs/DEMO_NOW.md`**

Document exactly:

```text
pnpm install --frozen-lockfile
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

Open `http://127.0.0.1:3000/`. Provide a timed 60–90 second click script: banner/profile → Run demo search → Juniper duplicate → fit → risk → shortlist → activity → capture. Include fallback: if manual capture fails, stay on seeded Juniper evidence and activity; do not imply the capture succeeded. State that all marketplace labels are sanitized fixtures and Maritime/OpenClaw/live sources are future work.

- [ ] **Step 5: Update the durable demo contract honestly**

Move listing inbox/detail/score/risk/shortlist/activity beats from “future” to “implemented offline demo” only after tests pass. Keep Gmail, Calendar, Maritime, OpenClaw, live LLM, live marketplaces, and new-record canonicalization explicitly unimplemented.

### Task 9: Full acceptance gate and completion audit

**Files:**

- Modify only files implicated by failures caused by Tasks 1–8.

**Interfaces:**

- Produces: verified recording commands, route, click path, file list, test evidence, omission list, and commit-message recommendation.
- Consumes: the complete implementation.

- [ ] **Step 1: Run narrow tests**

```text
pnpm exec vitest run --project unit scripts/demo-environment.unit.test.ts packages/scoring/src/demo-evaluation.unit.test.ts packages/domain/src/demo-api.unit.test.ts packages/domain/src/lifecycle.unit.test.ts
pnpm exec vitest run --project integration packages/db/src/seed.integration.test.ts packages/db/src/repositories.integration.test.ts apps/web/lib/demo-search-service.integration.test.ts apps/web/lib/listing-presentation.integration.test.ts
pnpm exec playwright test tests/e2e/demo.spec.ts --project chromium
```

Expected: all PASS.

- [ ] **Step 2: Run static gates**

```text
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all PASS with no warnings.

- [ ] **Step 3: Run the full default acceptance gate**

```text
pnpm test
pnpm build
```

Expected: unit, integration, all Playwright tests, and every package build PASS.

- [ ] **Step 4: Smoke-test founder commands**

Run `pnpm demo:reset`, `pnpm demo:seed`, then start `pnpm demo`. Verify `http://127.0.0.1:3000/api/health`, open `/`, perform the golden click path, and stop cleanly. Confirm the normal production data directory was untouched.

- [ ] **Step 5: Audit every explicit requirement**

Verify from current files and runtime evidence:

- exact banner;
- no external network connector or live-model path in demo environment;
- 12/8/3 seed and completion counts;
- fixture connector/policy/capture audit path;
- idempotent rerun;
- required profile fields;
- card fields, detail provenance, duplicate explanation, fit/risk evidence;
- shortlist/remove persistence;
- manual capture link/result flow;
- activity log;
- Playwright golden path;
- `docs/DEMO_NOW.md` commands and 60–90 second script;
- no dependencies, credentials, personal data, marketplace domains, scraping, outreach, or calendar actions;
- architecture documents remain unchanged except the intentionally honest `docs/DEMO.md` implementation-status update.

- [ ] **Step 6: Prepare final report**

Report exact recording commands, route, click sequence, files changed, test/build results, omitted P1/P2 items, lack of Git diff/commit due missing repository metadata, and recommended commit message:

```text
feat: add deterministic offline Ship Season demo
```
