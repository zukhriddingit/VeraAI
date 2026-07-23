# Vera Production Security and Founder-Beta Hardening Design

Date: 2026-07-22

Status: Approved for planning

Release target: founder-only staging, with promotion to founder beta only after every live gate passes

## 1. Decision summary

Vera will harden the current production-shaped PostgreSQL, Maritime, and OpenClaw implementation without broadening the product or rebuilding completed milestones. The release boundary is one founder, one Maritime-hosted OpenClaw gateway, one explicitly paired founder-owned browser node, and one dedicated manually authenticated browser profile.

The shared OpenClaw gateway is a single trusted-operator boundary. Tenant identifiers and repository ownership checks do not turn one gateway into a safe hostile-multi-tenant execution plane. Browser acquisition will therefore be restricted to an explicit founder user allowlist at every server-side boundary. Supporting another user requires a separately provisioned gateway, gateway credential, paired node, and browser profile.

The implementation sequence is mandatory:

1. Write an evidence-backed security and privacy review before changing application code.
2. Fix all critical and high findings and practical medium findings within the approved scope.
3. Run local static, unit, integration, E2E, configuration, and clean-install gates.
4. Inspect and validate the real Maritime/OpenClaw deployment using operator-authorized access.
5. Run the unified live founder-staging smoke and failure-recovery suite.
6. Issue an explicit release outcome: no-go, conditional founder staging, founder beta go, or multi-user beta go.

Multi-user beta cannot receive a go decision while browser jobs share one OpenClaw gateway trust boundary.

## 2. Scope

### 2.1 In scope

- Review the complete uncommitted Prompt 10 implementation and PostgreSQL migration `0003_maritime_execution_plane.sql`.
- Preserve existing PostgreSQL repositories, async domain contracts, tenant scoping, demo isolation, fixture ingestion, Calendar behavior, and Gmail alert ingestion.
- Keep Gmail read-only. Add no compose, draft, send, modify, label, delete, forward, or SMTP capability.
- Remove unnecessary public exposure from the Vera worker.
- Harden the remaining OpenClaw gateway exposure and document its reachable surface.
- Enforce the founder-only browser execution boundary independently of ordinary tenant ownership.
- Pin deployable artifacts immutably and produce supply-chain evidence.
- Add an additive PostgreSQL hardening migration; do not reset or rewrite founder data.
- Standardize request, payload, timeout, logging, readiness, metrics, retention, and incident-response controls.
- Add live staging validation for Maritime dispatch, OpenClaw capture, ingestion, and one notification.
- Produce privacy, retention, export, deletion, disconnect, backup, restore, and provider-outage runbooks.

### 2.2 Out of scope

- Multi-user browser execution through a shared OpenClaw gateway.
- Per-user automatic gateway provisioning.
- Gmail draft creation or any email send capability.
- Browser messaging, applications, payments, uploads, automated login, CAPTCHA solving, 2FA handling, or blocker bypass.
- New listing-platform connectors or scheduled public browser monitoring.
- Redis, Kubernetes, replicas, sharding, row-level security, or horizontal scaling.
- Replacing Maritime, OpenClaw, PostgreSQL, the repository contracts, or the explicit SQLite demo composition root.
- Treating sanitized demo fixtures as live connectors or production data.

## 3. Reconciled baseline

The current repository already contains the production-shaped contracts and most implementation seams needed for hardening:

- PostgreSQL is the hosted source of truth; SQLite is isolated under the demo composition root.
- Repository operations are asynchronous and scoped to an authenticated Vera user.
- Better Auth provides hosted identity and server-derived sessions.
- Google authorization is incremental and begins from Vera settings.
- Gmail integration currently requests read-only access and has no compose or send method.
- Calendar free/busy degrades visibly and hold creation rechecks availability.
- Source jobs, dispatch records, attempts, leases, manual-action states, node-offline states, and audit events exist.
- Maritime is the primary hosted execution plane.
- OpenClaw is the replaceable browser executor for an exact user-triggered current-tab capture.
- Demo and production composition roots remain separate.

The hardening milestone must not rename or duplicate these stable contracts without a concrete incompatibility.

## 4. Known release risks to verify in the pre-code audit

The security review will confirm exact line-level evidence and may adjust severity, but the following are expected findings:

### 4.1 Shared gateway founder isolation

Expected severity: high, release blocking.

Tenant-scoped repositories prevent ordinary cross-user database access, but browser jobs can still target the same configured gateway. The application needs an independent, explicit founder allowlist enforced when a capture job is created, when it is dispatched, and immediately before the worker invokes OpenClaw. A denial must be audited without leaking node or credential details.

### 4.2 Public worker exposure

Expected severity: medium to high depending on deployed state, release blocking until resolved.

The documented worker provisioning command uses Maritime `--public`, even though the service exposes only health/readiness and does not need inbound public invocation. The worker will be private. Unsupported methods and malformed requests will continue to fail closed.

### 4.3 OpenClaw gateway capability surface

Expected severity: high, release blocking.

Documentation describes least privilege but the deployment artifacts do not yet prove an enforced browser-proxy-only configuration. The deployed gateway must have no channels, shell, filesystem, elevated execution, cron, session spawning, model credentials, or unrelated plugins. Pairing and node capability approval remain manual.

### 4.4 Mutable deployment identity

Expected severity: high for release provenance, release blocking.

Semantic tags alone do not provide an immutable production identity. The worker and OpenClaw gateway will deploy by digest, with version/source revision, SBOM, build provenance, verification, upgrade, and rollback evidence.

### 4.5 Request mutation consistency

Expected severity: medium.

Some legacy mutation routes do not consistently apply the shared same-origin guard, and some parse request bodies before authentication or size enforcement. Authentication and origin validation must precede bounded parsing.

### 4.6 Migration `0003` constraints

Expected severity: medium.

The review will verify lock behavior, duplicate prevention, foreign keys, replay constraints, encrypted-column sizing, backward compatibility, and rollback. Anticipated additive fixes include null-safe production-schedule uniqueness and bounds for encrypted Web Push material.

### 4.7 Scheduling cost behavior

Expected severity: medium operational risk.

A five-minute trigger paired with a 600-second idle window can keep the worker continuously warm. Founder release defaults will use a shorter idle window, initially 120 seconds, unless measurement shows an always-on worker is intentional and cheaper or more reliable.

### 4.8 Provider deadlines and logging

Expected severity: medium.

Google/Gmail and other provider calls need bounded deadlines and retries. Structured logs need recursive or equivalently comprehensive redaction for secrets, contact details, raw page evidence, OAuth codes, and sensitive query parameters.

### 4.9 Privacy and lifecycle operations

Expected severity: medium for founder staging and release blocking for broader beta.

Data retention, export, account deletion, integration disconnect, credential deletion, browser-node revocation, and provider-revocation behavior must be explicit. Founder staging may use an audited operator-assisted workflow; broader beta requires a reliable user-facing or documented support workflow.

## 5. Security architecture

### 5.1 Founder-only browser authorization

Production configuration will require an explicit set of founder Vera user IDs for browser execution. The allowlist is separate from operator authorization and from normal user tenancy.

The check is enforced at three layers:

1. Web capture service before creating a browser SourceJob.
2. Maritime dispatch service before creating or accepting a dispatch record.
3. Worker immediately before OpenClaw network/process invocation.

All three checks fail closed when the allowlist is missing, malformed, or does not contain the authenticated job owner. No client-supplied identity can satisfy the check. Non-browser Gmail/API/normalization work remains governed by its existing source policy and tenant ownership rather than this founder browser allowlist.

### 5.2 Maritime worker exposure

The Vera worker will not use `--public`. It will expose health, readiness, and bounded internal metrics only on the agent-local service port. Maritime triggers and authenticated control-plane wake/dispatch operations do not require public application ingress.

Health distinguishes process liveness from dependency readiness:

- liveness proves the process event loop is serving;
- readiness proves PostgreSQL and required runtime configuration are usable;
- neither response contains secrets, identifiers, listing data, provider payloads, or stack traces.

### 5.3 Remaining OpenClaw gateway exposure

The gateway may remain externally reachable only because the explicitly paired local browser node must connect to it. Its exposure must be documented as public network reachability, not as public authorization.

Controls include:

- TLS through the supported Maritime endpoint;
- OpenClaw token authentication with a high-entropy server-side secret;
- no trust in arbitrary forwarded headers;
- bounded connection, request, and output limits;
- rate limiting and fail-closed authentication;
- exact supported protocol endpoints and HTTP methods;
- disabled Control UI or an authenticated operator-only surface;
- explicit node and browser-profile selection;
- minimal `browser.proxy` capability only;
- token rotation and emergency revocation procedure;
- per-founder gateway isolation.

The final configuration must be validated against the exact OpenClaw `2026.6.33` schema rather than inferred from another release.

### 5.4 Browser privacy boundary

The honest data flow is:

```text
exact allowlisted listing tab
  -> dedicated local browser profile
  -> paired local OpenClaw node
  -> Maritime-hosted OpenClaw gateway
  -> Vera worker
  -> immutable raw ingestion and structured evidence
  -> PostgreSQL canonical/provenance/audit records
```

The minimum page content needed for capture can transit the local node, Maritime gateway, and Vera worker. Accepted minimal raw evidence and extracted structured fields can persist in PostgreSQL according to retention policy.

The following remain local and must never enter Vera job payloads, Maritime payloads, PostgreSQL, analytics, logs, or normal audit payloads:

- marketplace passwords;
- cookies;
- local/session storage;
- browser-profile contents and paths;
- authenticated CDP or debugging URLs;
- authorization headers;
- screenshots or full snapshots by default.

### 5.5 Gmail invariant

Gmail remains alert ingestion only:

- allowed scope: `gmail.readonly`;
- allowed operations: bounded search and message-detail reads for configured alerts;
- forbidden scopes: `mail.google.com`, `gmail.modify`, and `gmail.compose`;
- forbidden methods/routes: `drafts.create`, `drafts.send`, `messages.send`, SMTP, forwarding, labeling, deleting, or mailbox mutation.

A dedicated static boundary verifier and tests will fail if forbidden capability strings, methods, scopes, or production routes are introduced.

### 5.6 Untrusted input handling

Listing text, page snapshots, email bodies, URLs, image metadata, LLM output, Maritime responses, OpenClaw responses, and notification endpoints are untrusted.

Controls include:

- strict Zod validation at every process boundary;
- exact domain and redirect allowlists;
- no arbitrary server-side URL fetching;
- no URL or instruction supplied by captured content can mutate policy, identity, node/profile selection, tools, filesystem access, or job payloads;
- deterministic payload hashes, correlation IDs, expiry, nonce, ownership, and replay checks;
- bounded body, response, and evidence sizes;
- one schema-repair attempt for AI output, then visible failure;
- no secrets or contact details in logs.

## 6. PostgreSQL hardening

Migration `0003` will remain immutable once reviewed. Corrections will use a new additive migration.

The migration design will:

- enforce one null-source production schedule per user/kind using PostgreSQL null-safe uniqueness or equivalent partial unique indexes;
- bound encryption nonce and authentication-tag lengths to the encryption format;
- bound encrypted Web Push payload material to a practical maximum;
- preserve tenant-composite foreign keys and uniqueness;
- avoid non-null rewrites or table resets;
- document expected locks and founder-scale execution time;
- provide preflight duplicate checks;
- document application-version compatibility and rollback/roll-forward procedure.

`pnpm db:seed` remains allowed in production only if the audit proves it performs idempotent policy/bootstrap upserts and creates no user, fixture, founder, listing, job, OAuth, notification, or private data. If that proof fails, production bootstrap will be separated from fixture seeding.

Backup/restore evidence must use a realistic PostgreSQL copy, verify schema version and representative row counts/hashes, and avoid destructive operations against the source database.

## 7. Supply-chain and deployment identity

The release records:

- OpenClaw application version `2026.6.33`;
- upstream source revision and release-signature evidence;
- OpenClaw gateway image digest;
- Vera worker image digest;
- repository commit SHA;
- build timestamp and builder identity;
- generated SBOMs;
- build provenance/attestation references;
- database migration version;
- rollback image digests.

Production deployment commands accept digest-qualified images only. No `latest` tag is permitted. Tags may remain as human-readable aliases but are not deployment identity.

The worker build will be reproducible from the lockfile. OpenClaw runtime dependencies will be pinned through the narrowest supported mechanism for the exact release. CI actions and other release tooling will be pinned or explicitly justified.

## 8. Request, configuration, and observability controls

### 8.1 Web mutations

All cookie-authenticated mutations will:

1. authenticate the Vera session;
2. validate same-origin/CSRF requirements;
3. validate method and content type;
4. reject oversized requests before buffering when possible;
5. parse a bounded body;
6. validate the schema;
7. execute through tenant-scoped repositories and policy services;
8. return a sanitized typed error.

### 8.2 Production configuration

A strict validator will reject production startup or deployment validation when required configuration is missing or unsafe, including:

- absent founder browser allowlist;
- public worker configuration;
- non-HTTPS production gateway URL;
- missing or weak gateway authentication material;
- tag-only production image references;
- enabled browser execution without kill switches and source manifest approval;
- hosted SQLite composition;
- unsafe demo flags;
- missing application encryption material;
- notification or provider configuration that would silently enable side effects.

### 8.3 Logging and metrics

Structured logs use correlation IDs and stable event names. Redaction covers nested secrets, tokens, OAuth codes, authorization headers, cookies, raw page/email content, contact details, encrypted credential material, signed notification endpoints, and sensitive query parameters.

Minimum founder-release metrics include:

- queue depth by closed job state;
- claim, execution, and end-to-end latency;
- capture/alert discovery latency;
- provider failures and timeouts by provider/error class;
- deferred-offline and manual-action counts;
- replay/payload/ownership rejection counts;
- notification delivery and deduplication counts;
- trigger last-run and worker/gateway/node heartbeat age.

Metrics must not use user IDs, listing URLs, addresses, email addresses, node IDs, or other high-cardinality private labels.

## 9. Reliability and operational behavior

- PostgreSQL remains canonical for jobs, attempts, leases, dispatches, results, policy, approvals, and audit history.
- Worker claims are transactional and lease-based; duplicate execution cannot produce duplicate durable imports or notifications.
- Source policy is rechecked immediately before execution and result acceptance.
- Gateway unavailable/restarting is retryable or deferred, never an empty successful search.
- Node offline remains visibly deferred and does not advance a source cursor.
- Login, 2FA, CAPTCHA, consent, rate limits, and layout incompatibility remain manual-action states.
- Google/OpenClaw/Maritime/notification timeouts never become empty or successful results.
- Provider retries are bounded, jittered where appropriate, and limited to explicitly safe transient failures.
- Cleanup jobs handle expired nonce, dispatch, lease, OAuth-state, and ephemeral records without deleting immutable raw listings or audit events.
- All persisted instants use UTC/timestamptz with explicit user timezones at presentation boundaries.

The default Maritime worker idle setting will be lower than the five-minute trigger cadence, initially 120 seconds. Metrics will determine whether an always-on worker is later justified.

## 10. Privacy, retention, and user lifecycle

The security review will inventory every category of collected, transiting, persisted, and logged data, including identity, search preferences, listing evidence, provenance, activity, browser-node metadata, Google account metadata, encrypted refresh tokens, Calendar free/busy metadata, notification subscriptions, and provider usage metadata.

Retention rules will distinguish:

- immutable raw listing/audit records retained for provenance and safety;
- ephemeral OAuth state, dispatch nonce, lease, and temporary execution data with short expiry;
- credentials retained only while an integration is connected;
- notification subscriptions deleted when revoked or invalid;
- browser-node registrations revocable without deleting historical audit evidence;
- demo fixtures containing no real personal data.

Disconnect and deletion behavior must revoke provider grants where supported, remove Vera-stored encrypted credentials, stop future jobs, invalidate browser-node authorization, and record a non-secret audit event.

Founder staging may use a documented, audited operator-assisted export/deletion process. User-facing self-service export and deletion remain a blocker for broader beta if they are not implemented in this milestone.

Google production readiness continues to require consent-screen branding, verified domains, privacy policy, terms, narrow scope justifications, deletion behavior, and verification evidence for restricted/sensitive scopes.

## 11. Validation strategy

### 11.1 Default offline gates

The default suite must not call Maritime, OpenClaw, Google, Gmail, Calendar, OpenAI, or a live notification provider.

Required evidence includes:

- lint and formatting;
- strict TypeScript typecheck;
- unit and contract tests;
- PostgreSQL integration tests;
- deterministic demo SQLite tests;
- Playwright fixture E2E;
- multi-user isolation E2E;
- mocked Google/Gmail/Calendar flows;
- mocked Maritime/OpenClaw flows;
- production configuration validation;
- forbidden Gmail capability verifier;
- browser and Maritime boundary verifiers;
- secret/redaction tests;
- migration preflight/rollback tests where practical;
- clean frozen-lockfile install and build.

### 11.2 Live Maritime/OpenClaw gates

Live gates are opt-in and require explicit staging configuration. They will be run only after local gates pass.

The unified positive path proves:

```text
Maritime trigger
  -> Vera worker wake
  -> PostgreSQL dispatch claim
  -> authenticated OpenClaw gateway
  -> paired founder node/profile
  -> exact allowlisted current-tab capture
  -> durable idempotent result acceptance
  -> RawListing import
  -> normalization/deduplication/ranking
  -> exactly one Web Push notification
```

Failure-path evidence covers:

- unauthenticated or wrong gateway token;
- stale/offline node;
- pairing or capability pending;
- login/2FA/CAPTCHA/manual blocker;
- node reconnect;
- duplicate trigger;
- worker crash and lease recovery;
- gateway restart;
- expired dispatch;
- payload mismatch or replay;
- cross-user dispatch/result attempt;
- source disabled or global/per-source/per-user kill switch after queueing.

The deployed OpenClaw gate also runs and captures sanitized evidence from:

```text
openclaw doctor
openclaw security audit
openclaw security audit --deep
openclaw health
```

No raw secrets, tokens, node identifiers, page snapshots, contact details, or browser artifacts are stored in test output.

### 11.3 Operator authentication handoff

Maritime CLI or API authentication is not required for local design, audit, implementation, mock tests, or builds. It becomes necessary at two explicit points:

1. Read-only deployment inspection: actual agent IDs, image digests, public/private setting, trigger configuration, environment-variable names, health, OpenClaw version, and sanitized configuration/audit output.
2. Live staging execution: deploy/update operator-controlled staging artifacts, run the unified smoke/failure suite, inspect sanitized logs, and exercise rollback.

At those points Codex will ask the founder to authenticate using Maritime's supported browser flow or provide a narrowly scoped, short-lived token through the local environment. The token will never be pasted into chat, committed, echoed, logged, or stored in repository files.

## 12. Release gates and outcomes

### 12.1 Founder beta go

All of the following are required:

- no open critical or high findings;
- every release-blocking medium finding resolved or explicitly accepted with a bounded compensating control;
- worker private and gateway surface verified;
- founder allowlist proven at create, dispatch, and execute boundaries;
- immutable worker/gateway digests plus SBOM/provenance recorded;
- migration and production bootstrap validated;
- backup/restore exercise passed;
- default local acceptance gates passed from a clean install;
- OpenClaw doctor, audit, deep audit, and health passed;
- unified positive and failure-path staging smoke passed;
- incident, token rotation, rollback, provider outage, and deletion runbooks reviewed.

### 12.2 Conditional founder staging

Local hardening is complete, but one or more live operational gates await authenticated staging execution. No real founder browser data should be relied on as production-ready until the missing live gates pass.

### 12.3 No-go

Any unresolved critical/high issue, failed ownership/policy/replay control, missing backup proof, unsafe gateway exposure, Gmail send capability, mutable production artifact, or failed live safety path produces no-go.

### 12.4 Multi-user beta go

Explicitly impossible under the approved shared-gateway topology. It requires separately isolated gateway credentials, nodes, and profiles per user plus a new reviewed architecture decision.

## 13. Documentation deliverables

The milestone will create or update:

- `docs/SECURITY_REVIEW.md`;
- `docs/SECURITY.md`;
- `docs/ARCHITECTURE.md`;
- `docs/DATA_MODEL.md` where migration behavior changes;
- `docs/SOURCE_POLICY.md`;
- PostgreSQL backup/restore and migration runbooks;
- Google verification/privacy checklist;
- OpenClaw gateway/node hardening and incident runbook;
- Maritime deployment, validation, trigger, cost, token rotation, and rollback documentation;
- production and demo environment examples;
- final release-readiness table.

## 14. Success definition

This hardening milestone succeeds when Vera can be honestly classified as founder-beta ready under the one-founder trust boundary, or when the evidence produces a precise no-go/conditional decision with no hidden or silently waived safety failures. Passing mocked tests alone is insufficient. Availability of a Maritime-hosted OpenClaw deployment alone is also insufficient; the exact deployed identity, configuration, security audit, end-to-end capture, failure recovery, and data boundaries must be proven.
