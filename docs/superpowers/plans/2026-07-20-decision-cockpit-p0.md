# Decision Cockpit P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reliable, inbox-first Vera deadline cockpit over the existing seeded deterministic decision path.

**Architecture:** Server components construct and schema-validate initial read models from existing repositories. Small client islands own demo execution, local list refinement, shortlist/dismiss mutations, and visible interaction states; no new database schema or external integration is introduced.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 strict mode, Zod, SQLite/Drizzle repositories, Vitest, Playwright.

## Global Constraints

- Do not add migrations, profile persistence, asynchronous job infrastructure, operational APIs, connectors, Gmail, Calendar, Maritime, OpenClaw, browser automation, or send actions.
- Demo mode reads the existing seeded profile and runs the existing synchronous fixture-search path.
- Every API response is parsed by a shared Zod schema.
- Unknown values remain unknown; unknown recurring fees are not added as zero.
- Shortlist and dismiss use the existing lifecycle state machine and append an activity event transactionally.
- Initial reads use server components; client components exist only for the approved interactions and their states.

---

### Task 1: Close the lifecycle action boundary

**Files:**
- Modify: `packages/domain/src/demo-api.ts`
- Modify: `apps/web/lib/listing-presentation.ts`
- Create: `apps/web/app/api/listings/[id]/dismiss/route.ts`
- Create: `apps/web/app/api/listings/[id]/dismiss/route.integration.test.ts`

**Interfaces:**
- Consumes: `transitionListingLifecycle(current, "dismissed")`, `ActivityEventSchema`, and `VeraRepositories.transaction`.
- Produces: `DismissListingRequestSchema`, `DismissListingResponseSchema`, and `dismissListing(listingId, dependencies)`.

- [ ] Write an integration test that posts `{ "dismissed": true }`, expects lifecycle `dismissed`, and finds one `listing.dismissed` activity event.
- [ ] Run `pnpm exec vitest run --project integration 'apps/web/app/api/listings/[id]/dismiss/route.integration.test.ts'` and verify the route is missing.
- [ ] Add strict request/response schemas and implement the route and transactional service with a content-only payload hash.
- [ ] Rerun the focused integration test and verify malformed IDs, malformed bodies, terminal-state conflicts, and database failures fail closed.
- [ ] Commit the lifecycle boundary.

### Task 2: Build a server-owned initial cockpit read model

**Files:**
- Create: `apps/web/lib/cockpit-read-model.ts`
- Create: `apps/web/lib/cockpit-read-model.integration.test.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/demo-search.tsx`
- Modify: `apps/web/app/listing-dashboard.tsx`

**Interfaces:**
- Consumes: `DemoStatusResponseSchema`, `CanonicalListingCollectionResponseSchema`, `getDemoStatus`, and existing listing summaries.
- Produces: `CockpitInitialState = { demoMode, demoStatus, listings, unavailableMessage }` parsed before rendering.

- [ ] Test uninitialized, staged-demo, completed-demo, and non-demo seeded states against temporary databases.
- [ ] Run the focused integration test and verify the read-model function is missing.
- [ ] Implement one short-lived database read that returns schema-validated status and summaries without changing data.
- [ ] Pass initial state from the server page; retain API fetches only after Run search or a lifecycle mutation.
- [ ] Rerun the focused integration and existing demo-route tests.
- [ ] Commit the server read boundary.

### Task 3: Implement deterministic inbox refinement

**Files:**
- Create: `apps/web/lib/listing-inbox.ts`
- Create: `apps/web/lib/listing-inbox.unit.test.ts`
- Modify: `apps/web/app/listing-dashboard.tsx`

**Interfaces:**
- Consumes: `readonly CanonicalListingSummary[]` and a closed `ListingInboxQuery`.
- Produces: `refineListingInbox(listings, query)` and lifecycle-tab counts.

- [ ] Add table-driven tests for lifecycle tabs, fit/freshness/price/risk sorts, eligibility, missing-fact, source, and duplicate filters.
- [ ] Run the focused unit test and verify the pure function is missing.
- [ ] Implement stable sorting with original index as the final tie-break and unknown price last.
- [ ] Render accessible tabs and labeled filter/sort controls in the approved rail layout.
- [ ] Rerun focused tests and verify empty-filter results have a recovery action.
- [ ] Commit inbox refinement.

### Task 4: Build scannable cards and safe actions

**Files:**
- Modify: `packages/domain/src/api.ts`
- Modify: `packages/db/src/sqlite-repositories.ts`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/api/listings/route.integration.test.ts`

**Interfaces:**
- Consumes: current score/risk snapshots and source memberships.
- Produces: summary presentation fields for highest open risk severity, source-posted time, and alert latency when justified.

- [ ] Extend route integration assertions for the new strict summary fields and unknown latency behavior.
- [ ] Run the route test and verify schema projection fails before implementation.
- [ ] Project severity and timing without fetching media or inventing missing source-posted timestamps.
- [ ] Render the canonical-photo placeholder, total/partial monthly cost, status badges, reason lines, inspect, shortlist, and confirmed dismiss actions.
- [ ] Add mobile, focus-visible, busy, stale, unknown, reduced-motion, and partial-data styles.
- [ ] Rerun route, domain, and inbox tests.
- [ ] Commit card presentation.

### Task 5: Complete evidence detail and activity initial reads

**Files:**
- Modify: `packages/domain/src/demo-api.ts`
- Modify: `apps/web/lib/listing-presentation.ts`
- Modify: `apps/web/app/listings/[id]/page.tsx`
- Modify: `apps/web/app/listings/[id]/listing-detail.tsx`
- Modify: `apps/web/app/activity/page.tsx`
- Modify: `apps/web/app/activity/activity-timeline.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `getListingDetail`, `listFieldSources`, source provenance, risks, and projected activities.
- Produces: server-rendered initial detail/activity plus client refresh after shortlist.

- [ ] Add presentation tests for selected canonical-field provenance and missing-information checklist.
- [ ] Run focused tests and verify the response schema rejects the absent fields.
- [ ] Extend the strict detail response and projection using existing repositories only.
- [ ] Pass initial detail/activity from server pages and render provenance, missing facts, duplicate evidence, risk verification, and disabled outreach.
- [ ] Rerun listing presentation, detail route, and activity route tests.
- [ ] Commit evidence views.

### Task 6: Lock the deadline demo in Playwright

**Files:**
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/demo.spec.ts`
- Create: `tests/e2e/inbox.spec.ts`
- Modify: `docs/DEMO.md`

**Interfaces:**
- Consumes: the completed P0 UI and deterministic seed.
- Produces: a stable recording path and assertions for filters, duplicate inspection, shortlist, dismiss, and audit.

- [ ] Update selectors around user-facing roles and listing-specific accessible names.
- [ ] Add one inbox test covering fit sort, source filter, shortlist tab, and a confirmed dismiss action.
- [ ] Run Playwright Chromium and fix only product regressions revealed by the test.
- [ ] Document exact setup commands and the click-by-click recording path.
- [ ] Commit E2E acceptance.

### Task 7: Run and review the full acceptance gate

**Files:**
- Review: all files changed by Tasks 1-6.

**Interfaces:**
- Consumes: the complete P0 vertical slice.
- Produces: a clean, tested, production-safe deadline demo commit.

- [ ] Run `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`.
- [ ] Run `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:e2e`.
- [ ] Run `pnpm build` and `pnpm audit --prod`.
- [ ] Scan the diff for secrets, external side effects, live URLs, dead code, and scope drift.
- [ ] Verify `git diff --check`, commit the final acceptance fixes, and report the recording commands and click path.
