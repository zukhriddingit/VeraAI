# Live Maritime OpenClaw Rental Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a founder-only live search that retrieves at most ten active long-term rentals from RentCast, obtains strictly validated qualitative notes from the configured Maritime OpenClaw agent, imports immutable sanitized observations through Vera's existing normalization and deterministic decision pipeline, and renders the results in the authenticated cockpit.

**Architecture:** The authenticated Next.js server creates a tenant-owned `SourceJob` and performs the two bounded read-only provider calls through injected clients. It persists only allowlisted RentCast evidence and validated analysis, then queues the existing normalization jobs; the existing worker remains authoritative for normalization, deduplication, deterministic scoring, risk evaluation, and final completion. Source-job and activity records provide durable run state without adding a second job system.

**Tech Stack:** TypeScript 6, Zod 4, Next.js 16 route handlers and React client components, PostgreSQL/Drizzle repositories, Vitest, Playwright, native `fetch`.

## Global Constraints

- Browser execution remains disabled and no gateway, local node, companion, extension, scraping, Gmail, Calendar, messaging, deployment, or landing-page change is introduced.
- Live search is disabled unless `VERA_LIVE_AGENT_SEARCH_ENABLED=1` and the authenticated UUID is in `VERA_LIVE_AGENT_FOUNDER_USER_IDS`.
- Provider calls use only `https://api.rentcast.io/v1/listings/rental/long-term` and `https://api.maritime.sh/api/agents/{agent_id}/chat`.
- RentCast requests use `GET`, `X-Api-Key`, `status=Active`, `limit=10`, no offset, no redirect, bounded timeout/response bytes, and at most one safe transient retry.
- Maritime requests use `POST`, bearer authentication, a fixed prompt version, bounded timeout/response bytes, and no shell or public webhook.
- No real credentials, raw provider responses, prompts, contact email/phone, or environment-specific evidence enter Git, logs, activity metadata, URLs, or client payloads.
- OpenClaw output is untrusted and cannot modify policy, hard constraints, deterministic scores, persistence authority, or external effects.
- The live path never invokes fixture connectors, demo seed data, or mock fallback behavior.

---

### Task 1: Domain contracts and source policy

**Files:**
- Create: `packages/domain/src/live-search.ts`
- Modify: `packages/domain/src/primitives.ts`
- Modify: `packages/domain/src/api.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/source-orchestration.ts`
- Modify: `packages/policy/src/manifests.ts`
- Modify: `packages/db/src/fixtures.ts`
- Test: `packages/domain/src/live-search.unit.test.ts`
- Test: `packages/policy/src/registry.unit.test.ts`

**Interfaces:**
- Produces `RentCastSearchQuerySchema`, `RentCastProviderListingSchema`, `AgentRentalAnalysisSchema`, `LiveSearchRunResponseSchema`, safe result-state schemas, and `RENTCAST_RENTAL_MANIFEST`.
- Adds `rentcast` to the closed listing-source label and adds an official-API source-job payload variant bound to an exact search profile.

- [ ] Write table-driven failing tests for query bounds, result states, analysis size/ID/run validation, duplicate IDs, URLs/HTML/contact instructions, and protected-class or definitive-safety language.
- [ ] Implement strict schemas and pure response validation.
- [ ] Add the enabled manual `official_api` RentCast manifest with exact origin/domain/method/operation and existing kill switches.
- [ ] Add the manifest to hosted policy seed fixtures without enabling fixtures in hosted composition.
- [ ] Run the focused domain and policy tests.

### Task 2: RentCast read-only connector

**Files:**
- Create: `packages/connectors/src/rentcast-connector.ts`
- Create: `packages/connectors/src/rentcast-connector.unit.test.ts`
- Create: `packages/testing/fixtures/rentcast-rental-listings.synthetic.json`
- Modify: `packages/connectors/src/contracts.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `packages/testing/package.json` if an export is required

**Interfaces:**
- Consumes a validated `SearchProfile`, `SourcePolicyRegistry`, injected `fetch`, clock, and abort signal.
- Produces `{ query, queryHash, listings, retrievedAt, latencyMilliseconds }` with no contact fields.

- [ ] Write parser tests using a fully synthetic provider response.
- [ ] Write query translation tests for exact ZIP, `City, ST`, coordinates/radius, budget, bedrooms, bathrooms, limit, active status, and unsupported/ambiguous locations.
- [ ] Write timeout, authentication, rate-limit, transient-retry, response-size, redirect, and API-key leakage tests.
- [ ] Implement deterministic profile-to-query translation and sanitized provider projection.
- [ ] Implement a bounded `fetch` transport with one retry only for safe transient provider/network errors.
- [ ] Run focused connector tests.

### Task 3: Maritime OpenClaw analysis client

**Files:**
- Create: `packages/connectors/src/maritime-openclaw-client.ts`
- Create: `packages/connectors/src/maritime-openclaw-client.unit.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Consumes an opaque run ID, minimized criteria, sanitized candidates, deterministic constraint previews, configuration, and abort signal.
- Produces a validated `AgentRentalAnalysis`; throws closed typed errors for timeout, unavailable service, oversized response, invalid JSON, unknown/duplicate IDs, cross-run output, or policy language.

- [ ] Write contract tests for the exact authenticated chat request and minimized prompt.
- [ ] Write invalid JSON, unknown ID, duplicate ID, cross-run ID, timeout, response-size, contact/safety/protected-trait language, and secret-leakage tests.
- [ ] Implement the fixed prompt serializer and strict response parser.
- [ ] Implement the HTTPS-only no-redirect bounded client without retries or fallback.
- [ ] Run focused client tests.

### Task 4: Live-search application service and immutable import

**Files:**
- Create: `apps/web/lib/live-search-config.ts`
- Create: `apps/web/lib/live-search-service.ts`
- Create: `apps/web/lib/live-search-service.unit.test.ts`
- Create: `apps/web/lib/live-search-service.integration.test.ts`
- Modify: `apps/worker/src/decision-worker.ts`
- Create: `apps/worker/src/live-search-completion.ts`
- Create: `apps/worker/src/live-search-completion.unit.test.ts`

**Interfaces:**
- `runLiveAgentSearch(input, dependencies)` creates one tenant-owned source job, enforces founder/config/policy/ownership/concurrency, runs RentCast then OpenClaw, atomically imports allowlisted immutable captures, queues normalization, and emits the ordered safe activity chain.
- `projectLiveSearchRun(runId, dependencies)` returns only a safe founder-facing run/status projection.
- The decision worker finalizer appends `live_search_completed` only after all imported observations normalize and the current corpus revision is deterministically scored.

- [ ] Write authorization, disabled-default, ownership, active-profile, duplicate-concurrent-run, one-retry, no-fixture-fallback, idempotent-import, and activity-order tests.
- [ ] Implement strict environment parsing without exposing values.
- [ ] Implement source-job creation and failure/result mapping.
- [ ] Implement the provider/agent orchestration with no database transaction around network I/O.
- [ ] Atomically import all accepted envelopes, queue normalization jobs, and record safe per-listing events.
- [ ] Add deterministic completion reconciliation after decision application.
- [ ] Run focused service and worker tests.

### Task 5: Authenticated API and founder CLI

**Files:**
- Create: `apps/web/app/api/live-search/route.ts`
- Create: `apps/web/app/api/live-search/route.integration.test.ts`
- Create: `scripts/live-search-founder.ts`
- Create: `scripts/live-search-founder.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- `POST /api/live-search` requires same-origin authenticated founder confirmation and runs or retries one live search.
- `GET /api/live-search?runId=...` returns an owner-scoped safe status projection.
- `pnpm live-search:founder -- --profile <id>` invokes the same application service and prints only the run ID, state, and counts.

- [ ] Write route tests for authentication, CSRF, founder authorization, cross-owner lookup, malformed input, and safe error mapping.
- [ ] Implement the Node route handlers with bounded request parsing and no cache.
- [ ] Write CLI tests proving explicit live flags are required and stdout/stderr contain no secrets/raw payloads.
- [ ] Implement the CLI composition and package script.
- [ ] Run route and CLI tests.

### Task 6: Cockpit integration

**Files:**
- Create: `apps/web/app/live-agent-search.tsx`
- Create: `apps/web/app/live-agent-search.unit.test.tsx`
- Modify: `apps/web/app/demo-search.tsx`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/lib/cockpit-read-model.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `packages/db/src/sqlite-repositories.ts`
- Modify: `apps/web/app/globals.css`
- Test: `e2e/live-agent-search.spec.ts`

**Interfaces:**
- Hosted mode renders a founder live-search control, explicit provider-use confirmation, staged run state, safe retry, result banner, and status panel.
- Canonical listing summaries optionally expose a strict `liveEvidence` projection containing only provider name, observation/freshness fields, and one validated agent summary.

- [ ] Write read-model and component tests for the server-only metadata boundary and labels “Vera fit score” / “OpenClaw agent notes”.
- [ ] Join canonical membership to sanitized raw RentCast evidence in the PostgreSQL summary query; keep demo summaries explicitly non-live.
- [ ] Implement the confirmation, run, polling, completion/failure, and one-retry UI.
- [ ] Add real-data badges, observation/freshness, agent summary, banner, status metrics, and unchanged shortlist action.
- [ ] Add one mocked Playwright flow with no live request.
- [ ] Run focused UI tests and Playwright flow.

### Task 7: Opt-in live smoke test and demo documentation

**Files:**
- Create: `packages/connectors/src/live-rental-search.staging.test.ts`
- Create: `docs/EOD_LIVE_AGENT_DEMO.md`
- Modify: `.env.example`
- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SOURCE_POLICY.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/RELEASE_READINESS.md`

**Interfaces:**
- The opt-in test is skipped unless the live flag, founder/profile/database configuration, RentCast key, Maritime key, and agent ID are all present.
- Documentation gives exact secret-free setup, startup, UI, CLI, recording, safe-claim, troubleshooting, and revocation procedures.

- [ ] Add the live integration test and assert RentCast identity, observation time, Maritime analysis, and normal ingestion persistence.
- [ ] Document every environment variable with server-only placement and disabled defaults.
- [ ] Document exact Maritime creation/configuration commands without secret values or public exposure.
- [ ] Add the 75–100 second founder video script and prohibited claims.
- [ ] Update architecture/security/policy/readiness truth without weakening `founder_core`.
- [ ] Run the live test in skipped mode.

### Task 8: Final validation and review

**Files:**
- Review all changed files.

- [ ] Run Prettier on changed files and `pnpm format:check`.
- [ ] Run focused unit/integration suites.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm --filter @vera/web build` and `pnpm --filter @vera/worker build`.
- [ ] Run the mocked Playwright live-search flow.
- [ ] Run `git diff --check`.
- [ ] Scan the diff for RentCast/Maritime/OpenAI key patterns, authorization headers with values, contact data, raw provider responses, fixtures presented as live, shell execution in the web path, browser enablement, and landing-page changes.
- [ ] Review the final source-job/activity ordering, no-fixture fallback, authority boundary, and founder-only default denial.
