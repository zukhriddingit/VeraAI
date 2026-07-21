# OpenClaw Current-Tab Capture Implementation Plan

**Goal:** Let an authenticated founder capture one already-open, exact Zillow listing tab through an explicitly selected, paired, allowlisted local OpenClaw node/profile and durably ingest it without navigation, discovery, scheduling, credentials, or side effects.

**Architecture:** Extend the existing source-job and browser-execution contracts with one `current_tab` payload/result variant. A tenant-scoped web service creates policy-checked jobs; the PostgreSQL worker claims them, rechecks all controls, invokes a pinned OpenClaw CLI adapter through fixed `nodes invoke ... browser.proxy` arguments, and accepts the bounded result transactionally into immutable RawListing plus normalization and audit. The deterministic demo and default tests use mocks only.

**Tech Stack:** Node.js 24, TypeScript 6 strict mode, pnpm 11.14.0, Next.js 16.2.10, PostgreSQL 18.4, Drizzle ORM 0.45.2, Zod 4.4.3, OpenClaw CLI 2026.5.28, Vitest 4.1.10, Playwright 1.61.1.

## Global constraints

- Zillow current-tab capture is `local_browser`, `experimental_personal`, `user_triggered_only`, `unsupported_experimental`, and disabled by default.
- The real provider may invoke only `openclaw nodes invoke --node <selected> --command browser.proxy` with `GET /tabs` and `GET /snapshot` requests for the selected allowlisted profile.
- No navigation, tab opening, click, type, evaluate, cookie/storage, upload/download, dialog, shell, filesystem, compose, send, contact, form, apply, payment, schedule, discovery, or pagination path may exist.
- OpenClaw is pinned to `2026.5.28`; runtime version mismatch is a typed manual blocker.
- Gateway URL/token remain server-side environment inputs and never enter argv, payloads, persistence, audit, or logs.
- The user manually authenticates in a dedicated local profile. Vera never requests, stores, transmits, autofills, or types marketplace credentials.
- Page content is untrusted data. It cannot affect policy, target user/node/profile/URL, allowed operations, tools, secrets, or audit.
- PostgreSQL is the hosted authority. SQLite remains an isolated no-network demo adapter.
- Provider calls occur outside transactions. A job completes only after durable result acceptance and raw import commit.
- All default tests are network-free. The live test is opt-in and skips unless every explicit configuration value is present.
- Preserve the existing dirty worktree and unrelated Calendar/PostgreSQL changes; stage or commit only prompt-owned files.

## Target file structure

```text
packages/domain/src/source-orchestration.ts                    # current-tab jobs, node readiness, blockers, result identity
packages/domain/src/source-orchestration.unit.test.ts          # strict contracts and state transitions
packages/domain/src/browser-agent-api.ts                       # shared settings/job API schemas
packages/domain/src/browser-agent-api.unit.test.ts
packages/policy/src/manifests.ts                               # disabled-by-default Zillow manifest
packages/policy/src/browser-policy.ts                          # exact URL and layered control evaluation
packages/policy/src/browser-policy.unit.test.ts
packages/connectors/src/browser-execution.ts                   # provider-neutral current-tab operation
packages/connectors/src/openclaw-cli.ts                         # bounded child-process seam
packages/connectors/src/openclaw-browser-execution.ts           # 2026.5.28 adapter
packages/connectors/src/openclaw-browser-execution.unit.test.ts
packages/db/src/repositories.ts                                # tenant browser controls and acceptance contracts
packages/db/src/postgres/schema.ts                             # additive node/control/acceptance persistence
packages/db/src/postgres/browser-repositories.ts               # tenant-scoped controls and node registry
packages/db/src/postgres/browser-transactions.ts               # idempotent result acceptance
packages/db/src/postgres/browser-*.integration.test.ts         # ownership, rollback, restart, audit ordering
packages/db/drizzle/0002_openclaw_current_tab.sql              # additive migration
apps/worker/src/acquisition-worker.ts                          # claim/recheck/invoke/accept state machine
apps/worker/src/acquisition-worker.unit.test.ts
apps/worker/src/acquisition-worker.integration.test.ts
apps/worker/src/postgres-runtime.ts                            # alternating acquisition/normalization/decision loop
apps/web/lib/browser-agent-service.ts                          # create/read/control browser jobs
apps/web/lib/browser-agent-service.unit.test.ts
apps/web/app/api/integrations/browser-agent/**                 # authenticated same-origin routes
apps/web/app/settings/integrations/browser-agent/**            # founder UI and confirmation
tests/e2e/browser-agent.spec.ts                                # mocked founder golden/blocker flow
tests/live/openclaw-current-tab.smoke.test.ts                  # opt-in live capture
docs/OPENCLAW_FOUNDER_SETUP.md                                 # exact setup, privacy, recovery, removal
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/SECURITY.md
docs/SOURCE_POLICY.md
.env.example
package.json
pnpm-lock.yaml
```

---

### Task 1: Lock strict domain contracts and transitions

**Files:**
- Modify: `packages/domain/src/source-orchestration.ts`
- Modify: `packages/domain/src/source-orchestration.unit.test.ts`
- Create: `packages/domain/src/browser-agent-api.ts`
- Create: `packages/domain/src/browser-agent-api.unit.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] Write failing tests for the `current_tab` payload, exact capture identity, node pairing/capability/profile/version fields, all closed blockers, secret-shaped key rejection, and result/job identity mismatch.
- [ ] Add a backward-compatible discriminated local-browser payload: existing saved-search rows remain parseable, while new jobs use `captureKind: "current_tab"`, node ID, safe profile ID, expected URL/canonical URL, one-page limits, and no cursor.
- [ ] Replace legacy blocker values only through a compatibility parser that maps persisted names to the closed current vocabulary; new serialization uses the required vocabulary.
- [ ] Extend node status with display name, pairing state, capability approval, safe selected/allowed profile IDs, reported/expected OpenClaw version, compatibility state, last successful capture, disabled time, and created time.
- [ ] Add strict browser-agent API request/response schemas for status, control mutation, current-tab confirmation, job status, and safe recovery instructions.
- [ ] Keep job lifecycle transitions centralized in `transitionSourceJobStatus`; add no arbitrary repository mutation path.
- [ ] Run: `pnpm vitest run --project unit packages/domain/src/source-orchestration.unit.test.ts packages/domain/src/browser-agent-api.unit.test.ts`

### Task 2: Add exact Zillow policy and layered controls

**Files:**
- Modify: `packages/domain/src/source-policy.ts`
- Modify: `packages/policy/src/manifests.ts`
- Create: `packages/policy/src/browser-policy.ts`
- Create: `packages/policy/src/browser-policy.unit.test.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/src/registry.unit.test.ts`

- [ ] Write failing tests for missing/disabled manifest, manual-only trigger, exact hostname/path, tracking-only canonical equivalence, sensitive/unknown query rejection, redirects, and every kill switch.
- [ ] Add `zillow.current-tab.v1` as a frozen code-backed manifest: `experimental_personal`, `enabled:false`, manual only, read/capture only, user session and approval required, exact reviewed Zillow origin/domain, no discovery/schedule.
- [ ] Implement pure URL validation for HTTPS, credentials/fragments/ports, exact allowlisted host, narrow listing-detail path, and a documented canonical query allowlist.
- [ ] Implement `evaluateCurrentTabCapturePolicy` that requires the frozen manifest plus explicit persisted founder activation and system/user/source/node/profile controls. Founder activation can activate only this exact `experimental_personal` manifest and cannot add a capability, operation, origin, host, method, or schedule.
- [ ] Return closed denial/blocker reasons and fail closed on missing/ambiguous control data.
- [ ] Run: `pnpm vitest run --project unit packages/policy/src/browser-policy.unit.test.ts packages/policy/src/registry.unit.test.ts`

### Task 3: Adapt BrowserExecutionProvider for current-tab capture

**Files:**
- Modify: `packages/connectors/src/browser-execution.ts`
- Modify: `packages/connectors/src/browser-execution.unit.test.ts`
- Modify: `packages/connectors/src/index.ts`

- [ ] Write failing provider-contract tests for `captureCurrentTab`, unsupported navigation, active URL mismatch, manual blockers, output limits, and sanitized evidence.
- [ ] Add a narrow `BrowserCurrentTabCaptureRequest` and provider method; keep existing `capture`/`navigate` only for persisted compatibility and mocks, but the new worker never calls navigation.
- [ ] Return one structured current-tab evidence object with active URL, canonical URL, title, bounded text/metadata, observed time, safe node/profile IDs, content hash, and untrusted marker.
- [ ] Extend the mock provider for deterministic active-tab/snapshot outcomes and all blocker states.
- [ ] Ensure no provider-neutral schema contains cookies, storage, headers, profile paths, credentials, commands, arbitrary methods, or arbitrary URLs.
- [ ] Run: `pnpm vitest run --project unit packages/connectors/src/browser-execution.unit.test.ts`

### Task 4: Implement the pinned OpenClaw CLI adapter

**Files:**
- Create: `packages/connectors/src/openclaw-cli.ts`
- Create: `packages/connectors/src/openclaw-browser-execution.ts`
- Create: `packages/connectors/src/openclaw-browser-execution.unit.test.ts`
- Create: `packages/connectors/src/openclaw-current-tab.live.test.ts`
- Modify: `packages/connectors/src/index.ts`
- Modify: `packages/connectors/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Write a fake-process-runner test suite that asserts the exact executable/argv/environment allowlist and proves no shell, gateway token argv, navigation, click, type, evaluate, cookie, upload, or send command can be emitted.
- [ ] Pin `openclaw` to `2026.5.28` as the tested CLI runtime dependency and validate `openclaw --version` once at provider startup.
- [ ] Implement an injected bounded process runner with timeout, abort, stdout/stderr byte caps, exit classification, and sanitized errors. Never log child output verbatim.
- [ ] Invoke `/tabs` for one profile; require one unambiguous active/current target and validate its URL before requesting `/snapshot` for that fresh target ID.
- [ ] Invoke `/snapshot` with bounded AI/text settings, parse untrusted JSON, classify deterministic blockers, redact/discard unrelated tabs, and return the provider-neutral result.
- [ ] Treat stale target, version mismatch, profile unavailable, login/2FA/CAPTCHA/consent/challenge, download/upload, camera/microphone, layout, redirect, and policy uncertainty as manual actions.
- [ ] Add the live test with an explicit `VERA_OPENCLAW_LIVE_TEST=1` gate plus binary, URL, token, node, profile, and exact approved URL requirements.
- [ ] Run: `pnpm vitest run --project unit packages/connectors/src/openclaw-browser-execution.unit.test.ts`

### Task 5: Add additive PostgreSQL persistence and migration

**Files:**
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/postgres/schema.ts`
- Modify: `packages/db/src/postgres/types.ts`
- Modify: `packages/db/src/postgres/row-mappers.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Create: `packages/db/src/postgres/browser-repositories.ts`
- Create: `packages/db/src/postgres/browser-repositories.integration.test.ts`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/0002_openclaw_current_tab.sql`
- Create: `packages/db/drizzle/meta/0002_snapshot.json`

- [ ] Write PostgreSQL integration tests for additive defaults on existing nodes, cross-tenant node/profile/control isolation, composite foreign keys, uniqueness, timestamps, disables, and migration preservation.
- [ ] Extend `browser_nodes` additively with pairing, approval, profile allowlist/selection, display name, OpenClaw version compatibility, last capture, disabled, and created time.
- [ ] Add tenant-owned `browser_user_controls`, `browser_source_controls`, and `browser_profile_controls` with fail-closed defaults and composite same-user/node foreign keys. Keep the system-wide kill switch in the existing global policy/config boundary and expose its effective state read-only to the UI.
- [ ] Add immutable `browser_capture_acceptances` with tenant/job/attempt/node/profile/payload/invocation/result/content/canonical URL/raw-listing identity and uniqueness constraints.
- [ ] Add repositories for node registration/readiness and control state without a cross-user lookup method.
- [ ] Generate/review an additive Drizzle migration; do not reset data. Verify migration from both baseline and current migration history.
- [ ] Run: `pnpm test:integration:postgres -- packages/db/src/postgres/browser-repositories.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

### Task 6: Add transactional result acceptance

**Files:**
- Create: `packages/db/src/postgres/browser-transactions.ts`
- Create: `packages/db/src/postgres/browser-transactions.integration.test.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Modify: `packages/db/src/repositories.ts`

- [ ] Write failing tests for idempotent acceptance, replay under another job/user, payload/canonical/node/profile mismatch, rollback after RawListing insert, worker restart recovery, normalization enqueue, and exact audit ordering.
- [ ] Add one tenant-scoped transaction that locks the job, validates the claimed attempt/result identity, inserts or resolves the acceptance, imports one immutable `RawListingCapture`, enqueues normalization, appends stable idempotent audit events, and completes the job.
- [ ] Derive separate stable keys for invocation, acceptance, raw import, normalization, and audit. A replay returns the already accepted record and emits no duplicate ActivityEvent.
- [ ] Mark source job completed only in the same commit as acceptance/raw import/normalization/audit. Do not hold the transaction during provider I/O.
- [ ] Preserve append-only RawListing and ActivityEvent enforcement.
- [ ] Run: `pnpm test:integration:postgres -- packages/db/src/postgres/browser-transactions.integration.test.ts`

### Task 7: Add the acquisition worker state machine

**Files:**
- Create: `apps/worker/src/acquisition-worker.ts`
- Create: `apps/worker/src/acquisition-worker.unit.test.ts`
- Create: `apps/worker/src/acquisition-worker.integration.test.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`
- Modify: `apps/worker/src/decision-runtime.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `apps/worker/src/cli.unit.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] Write tests for transactional claim, tenant scope, execution-time policy reevaluation, global/user/source/node/profile controls, node freshness, pairing, capability, version, blockers, retry classification, cancellation, and recovery after invocation before acceptance.
- [ ] Add `processNextAcquisitionJob` with injected repositories, policy evaluator, provider, clock, IDs, and acceptance transaction.
- [ ] Reject non-current-tab/scheduled/local-browser jobs in this implementation without treating them as success.
- [ ] Validate the claimed job and selected tenant-owned node/profile, then call only `captureCurrentTab` outside transactions.
- [ ] Persist every attempt and typed state. Offline/stale nodes defer visibly; pairing/capability/version/blockers require manual action; policy denials cancel; only safe transport failures retry.
- [ ] On completed provider output, invoke durable acceptance; never set job completed directly.
- [ ] Extend the worker runtime's fair rotation to acquisition, normalization, and decision jobs and keep graceful shutdown/cancellation.
- [ ] Run: `pnpm vitest run --project unit apps/worker/src/acquisition-worker.unit.test.ts apps/worker/src/cli.unit.test.ts && pnpm test:integration:postgres -- apps/worker/src/acquisition-worker.integration.test.ts`

### Task 8: Add authenticated founder routes and service

**Files:**
- Create: `apps/web/lib/browser-agent-service.ts`
- Create: `apps/web/lib/browser-agent-service.unit.test.ts`
- Create: `apps/web/lib/server/browser-agent-application.ts`
- Modify: `apps/web/lib/server/application.ts`
- Create: `apps/web/app/api/integrations/browser-agent/status/route.ts`
- Create: `apps/web/app/api/integrations/browser-agent/controls/route.ts`
- Create: `apps/web/app/api/integrations/browser-agent/captures/route.ts`
- Create: `apps/web/app/api/integrations/browser-agent/jobs/[id]/route.ts`
- Create: `apps/web/app/api/integrations/browser-agent/routes.integration.test.ts`

- [ ] Write tests for unauthenticated access, wrong tenant node/job, same-origin mutation, malformed/credential-bearing payloads, source disabled, exact confirmation, idempotent creation, and no-store responses.
- [ ] Build a tenant-scoped status read model containing safe readiness/control/job fields only.
- [ ] Add explicit enable/disable and node/profile selection mutations with audit events; no route approves OpenClaw pairing/capabilities.
- [ ] Create `capture.current_tab` jobs only after exact URL validation, persisted founder opt-in, all controls, current user/session, explicit four-part confirmation, and a stable payload hash/idempotency key.
- [ ] Return typed deferred/manual/policy recovery information and canonical listing link after acceptance.
- [ ] Ensure route logs never include expected URL query strings, page content, node external ID where redaction is required, profile paths, tokens, or contact data.
- [ ] Run: `pnpm vitest run --project unit apps/web/lib/browser-agent-service.unit.test.ts && pnpm test:integration:postgres -- apps/web/app/api/integrations/browser-agent/routes.integration.test.ts`

### Task 9: Add the founder browser-agent UI

**Files:**
- Create: `apps/web/app/settings/integrations/browser-agent/page.tsx`
- Create: `apps/web/app/settings/integrations/browser-agent/browser-agent-panel.tsx`
- Create: `apps/web/app/settings/integrations/browser-agent/browser-agent-panel.unit.test.tsx`
- Modify: `apps/web/app/settings/integrations/page.tsx`
- Modify: `apps/web/app/settings/integrations/integration-cards.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] Add a server-rendered initial status view and a small client panel only for controls, exact URL/confirmation submission, polling feedback, retry, and visible errors.
- [ ] Display all required readiness states, version, profile, source policy, last heartbeat/capture, kill switches, active/deferred/manual jobs, recovery steps, and canonical result link.
- [ ] Require the exact confirmation copy before enabling `Capture current tab`.
- [ ] Label the Zillow capability unsupported and experimental; state that authorization does not override platform terms and that listing content may traverse the configured gateway.
- [ ] Do not expose setup secrets, pairing approval mutations, or any send/apply/contact control.
- [ ] Run focused component/unit tests and `pnpm --filter @vera/web typecheck`.

### Task 10: Document setup, privacy, policy, data model, and operations

**Files:**
- Create: `docs/OPENCLAW_FOUNDER_SETUP.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SOURCE_POLICY.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] Document exact `openclaw@2026.5.28` installation/version check, gateway start, device pairing, node capability approval, node-host startup, `nodeHost.browserProxy.allowProfiles`, dedicated profile creation, manual Zillow login, current-tab flow, blockers, disable/disconnect/remove, retention, and private transport.
- [ ] State the privacy boundary honestly: auth state stays local, required page content may traverse the gateway to hosted Vera.
- [ ] Document unsupported experimental status and that user authorization does not override platform terms.
- [ ] Update Mermaid data/sequence diagrams, migration/rollback notes, worker topology, demo isolation, and Prompt 10 deployment boundary.
- [ ] Add `openclaw:version` and `test:live:openclaw` scripts without automatic install/upgrade.
- [ ] Document every environment variable without real values or credentials.

### Task 11: Add E2E, invariant, and live smoke coverage

**Files:**
- Create: `tests/e2e/browser-agent.spec.ts`
- Create: `scripts/verify-browser-boundaries.ts`
- Create: `scripts/verify-browser-boundaries.unit.test.ts`
- Modify: `package.json`

- [ ] Add deterministic E2E for settings readiness, explicit confirmation, mocked successful capture, canonical link, offline deferral, and manual blocker.
- [ ] Add a static invariant verifier that fails on forbidden commands/routes/capabilities, token logging, any navigation use by the new OpenClaw current-tab adapter/worker, send/apply/contact methods, or real provider composition in demo.
- [ ] Verify the live smoke remains skipped by default and fails closed when only partial configuration is present.
- [ ] Run: `pnpm vitest run --project unit scripts/verify-browser-boundaries.unit.test.ts && pnpm test:e2e -- tests/e2e/browser-agent.spec.ts`

### Task 12: Run the acceptance gate and security diff review

- [ ] Run focused domain, policy, connector, worker, web, and PostgreSQL tests first.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:unit`.
- [ ] Run `pnpm test:integration`.
- [ ] Run `pnpm test:integration:postgres` against the documented local PostgreSQL service.
- [ ] Run `pnpm test:e2e`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm verify:browser-boundaries` and `pnpm audit --prod`.
- [ ] Review `git diff` and `git status` for secrets, tokens, cookies, profiles, raw page snapshots, URLs with sensitive queries, unrelated changes, demo/hosted boundary regressions, and accidental side-effect methods.
- [ ] Report migration, worker path, acceptance path, pinned version, setup/live-test commands, security limitations, test evidence, Maritime remaining work, and recommended commit message.
