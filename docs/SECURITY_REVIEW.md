# Vera Founder-Release Security Review

Date: 2026-07-23

Review status: Local founder-release controls verified; live Maritime inventory and release evidence pending

Initial release outcome: **conditional go for founder-only staging**. Vera is **not approved for multi-user beta**. Founder staging remains conditional until every release-blocking finding below is resolved and the local, PostgreSQL, supply-chain, Maritime, OpenClaw, and live failure-path evidence is recorded in this document.

## Scope and method

This review covers the actual `main...ddcbe3f` pull-request diff plus the local Prompt 12
remediations, rather than only the repository's final state. It includes:

- the hosted Next.js application and authenticated API routes;
- the PostgreSQL schema, migrations, tenant-scoped repositories, queues, leases, and audit events;
- Google OAuth and Gmail alert ingestion;
- the Vera worker, Maritime orchestration adapter, schedules, notifications, and operational endpoints;
- the OpenClaw gateway, paired local browser node, dedicated browser profile, and current-tab capture path;
- production build, dependency, deployment, secret, logging, backup, restore, retention, and incident boundaries;
- the isolated deterministic SQLite demo composition root.

The review used source inspection, targeted searches, schema and migration inspection, existing tests, and the approved design in `docs/superpowers/specs/2026-07-22-production-security-beta-hardening-design.md`. A passing mock test is not accepted as evidence of live Maritime or OpenClaw behavior. Remediation status changes require an exact code or configuration reference plus the command and result that verified it.

## Protected assets

- Vera identities, sessions, search profiles, listings, shortlist state, jobs, approvals, viewing state, notification preferences, and audit history.
- Encrypted Google refresh-token material and Web Push subscription material.
- Server-side Google, OpenAI, Maritime, OpenClaw, encryption, authentication, and notification credentials.
- Founder marketplace authentication state: passwords, cookies, local/session storage, browser profile contents, and authenticated debugging endpoints.
- Source policy, kill-switch state, approval payload hashes, idempotency keys, job leases, nonces, result hashes, and source cursors.
- Minimal listing evidence and structured fields accepted into the immutable ingestion pipeline.
- Release identity: source commit, dependency lockfile, worker image digest, OpenClaw image digest, SBOM, provenance, advisory review, and rollback identity.

## Trust boundaries

1. **Browser to Vera web.** Browser input, cookies, origins, request bodies, route parameters, and headers are untrusted until the authenticated server session, exact allowed origin, byte limit, and Zod schema all pass.
2. **Vera web/worker to PostgreSQL.** PostgreSQL is canonical. All private access is scoped by a server-derived Vera user ID. Database constraints remain an independent enforcement layer.
3. **Vera to Google.** OAuth state, authorization-code exchange, scope verification, token refresh, Gmail results, and provider failures cross an external boundary. Tokens and message contents must not enter logs or browser persistence.
4. **Vera to Maritime.** Maritime execution state is evidence, not canonical job state. Wake and status APIs receive only minimum identifiers and authenticated, replay-resistant payloads.
5. **Maritime-hosted OpenClaw gateway to local node.** The gateway is publicly reachable for TLS/WSS node connectivity but is not publicly authorized. One founder, one gateway, one explicitly paired node, and one profile form a single trusted-operator boundary.
6. **Local browser profile to captured page.** Page content is adversarial. It cannot change source policy, domain allowlists, selected user/node/profile, action capability, job payload, secrets, filesystem access, or audit behavior.
7. **Vera to notification provider.** Endpoints and provider responses are untrusted. Payloads must remain generic and idempotent, and encrypted subscription material must remain bounded.
8. **Production to deterministic demo.** Hosted entry points may use PostgreSQL only. SQLite and fixtures are available solely through the explicit `@vera/db/demo` composition root and cannot dispatch Maritime or OpenClaw work.
9. **Operator and supply chain.** Dependency registries, container registries, CI actions, operator shells, deployment manifests, and provider dashboards can alter executable bytes or secret scope. Immutable identities and reviewed evidence are required.

## Threat actors and failure sources

- unauthenticated internet clients attempting request exhaustion, CSRF, route discovery, or secret extraction;
- an authenticated non-founder attempting to invoke the shared founder browser gateway;
- one authenticated user attempting to address another user's records, node, profile, job, result, integration, or notification;
- malicious instructions embedded in listing pages, emails, URLs, image metadata, or model output;
- replayed, stale, mismatched, cross-user, or payload-hash-invalid dispatches and results;
- compromised or over-scoped provider credentials, dependency artifacts, CI actions, or operator accounts;
- accidental operator error, configuration drift, mutable image tags, incomplete rollback evidence, or secret-bearing diagnostics;
- Google, PostgreSQL, Maritime, OpenClaw, browser-node, or notification-provider outage and partial failure;
- resource exhaustion through unbounded bodies, responses, encrypted fields, queues, logs, metrics labels, or retry loops;
- a database owner or superuser bypassing application checks or append-only triggers.

## Finding register

| ID | Boundary / threat | Severity | Evidence | Exploit or failure path | Required fix | Owner | Release blocker | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Non-founder browser execution | High | `packages/domain/src/founder-browser-access.ts`; creation, dispatch, and worker tests listed below | Ordinary tenant ownership is enforced, but an authenticated user can reach the single founder gateway whenever browser controls are enabled because there is no independent founder UUID allowlist. | Enforce one server-only founder UUID allowlist at job creation, dispatch, and immediately before worker provider invocation. Missing or malformed configuration must deny. | Application | Yes | Resolved |
| SEC-002 | OpenClaw capability surface | High | reviewed configs/verifier plus sanitized read-only Maritime inventory | The desired gateway/node config reduces the effective command set to `browser.proxy`, but OpenClaw 2026.6.33 provides no path-level allowlist inside that admin-sensitive proxy. The trigger-free existing candidate runs 2026.5.22 and its effective config is not observed while sleeping. | Upgrade only the candidate to the reviewed digest, install and verify the reviewed config/version/one-node routing, accept the single-founder residual explicitly, and require a narrow node-side command before multi-user beta. | Infrastructure | Yes | Candidate identified; live runtime evidence open |
| SEC-003 | Mutable release identity | High | immutable Node/OpenClaw digests, exact OpenClaw package, SHA-pinned CI actions, production-only worker deploy, local image/SBOM evidence below | The local candidate is identified and inventoried, but a registry digest, provenance/signature, approved advisory review, and rollback worker digest are not yet recorded. | Produce and verify those artifacts for the release candidate and deploy by digest. | Release | Yes | Locally mitigated; promotion evidence open |
| SEC-004 | Public worker ingress | Medium | runbook requires agent-local worker port; read-only Maritime inventory found no Vera worker deployment | A worker that needs only Maritime wake/status and PostgreSQL claims must not expose a public application URL. Maritime may still provide a secret invoke webhook, which is not a Vera authorization surface. | Deploy one worker by immutable digest without public application ingress and verify its readiness/diagnostic boundary. | Infrastructure | Yes | Desired state fixed; deployment evidence open |
| SEC-005 | Mutation exhaustion and CSRF inconsistency | Medium | `apps/web/lib/server/request-security.ts`; `scripts/verify-web-mutation-boundaries.ts`; route and parser tests listed below | An unauthenticated or cross-origin request can be buffered before rejection, and inconsistent parsing can bypass the intended body-size/content-type policy. | Authenticate, require the exact configured same origin, stream a bounded JSON body in UTF-8 bytes, then schema-validate in every mutation route. Add a static regression gate. | Web | Yes | Resolved |
| SEC-006 | Gmail capability regression | High | `scripts/verify-gmail-boundaries.ts`; `packages/connectors/src/gmail-client.ts`; verifier/client tests listed below | A later dependency, scope, adapter method, or route could silently introduce compose, send, modify, label, delete, or broad mailbox access. | Add a CI verifier rejecting broad/compose/modify scopes and all draft/send/mailbox-mutation methods while allowing only bounded read-only alert ingestion. | Integrations | Yes | Resolved |
| SEC-007 | Nested log disclosure | Medium | `apps/worker/src/log-sanitizer.ts`; `apps/worker/src/logger.ts`; sanitizer/logger tests listed below | Secrets, contact data, raw evidence, prompts, or response bodies nested in arrays or deeper provider objects can evade those paths and enter hosted logs. | Recursively sanitize structured values with key/value, depth, entry, cycle, and contact-pattern controls before serialization. | Worker | Yes | Resolved |
| SEC-008 | Outbound request hangs | Medium | `packages/connectors/src/gmail-client.ts`; `apps/worker/src/google-gmail-access.ts`; timeout/cancellation tests listed below | Gmail list/detail and token-refresh requests accept caller cancellation but impose no complete local deadline; a stalled provider can retain a lane or lease until process termination. | Compose caller cancellation with a bounded per-attempt timeout, bound response processing, cap retries, and return typed safe errors. | Integrations | Yes | Resolved |
| SEC-009 | PostgreSQL schedule uniqueness and ciphertext bounds | Medium | `packages/db/drizzle/0004_founder_security_hardening.sql`; schema/migration tests listed below | SQL uniqueness with a nullable source permits duplicate global schedules; encrypted Web Push nonce/tag/ciphertext byte fields have no exact or practical length constraints. | Add a forward migration with ambiguity preflight, partial uniqueness, exact GCM nonce/tag lengths, bounded ciphertext, and populated-upgrade tests. | Persistence | Yes | Resolved |
| SEC-010 | Ephemeral retention and lease recovery | Medium | `packages/db/src/postgres/ephemeral-cleanup.ts`; `packages/db/src/postgres/worker-queue.ts`; tests listed below | Expired control data accumulates, and a crashed worker can strand a notification indefinitely. | Add bounded cleanup for explicitly ephemeral rows and atomic expired notification-lease recovery while preserving immutable evidence and audit history. | Reliability | No for founder staging; Yes for broader beta | Resolved for founder staging |
| SEC-011 | Browser data-flow ambiguity | Medium | `docs/PRIVACY_OPERATIONS.md`; `docs/SECURITY.md`; `docs/POSTGRES_OPERATIONS.md` | An operator can overstate the local privacy boundary even though selected page content may cross the local node, hosted gateway, worker, and PostgreSQL ingestion boundary. | Publish exact location, transit, persistence, logging, retention, export, deletion, disconnect, revocation, backup, and provider-outage behavior. | Privacy | Yes | Resolved |
| SEC-012 | Missing unified live staging evidence | High | Offline-safe unified staging harness and closed release-manifest verifier exist; no live report or signed release manifest exists | Local mocks can pass while the deployed image, trigger, gateway, node, notification, kill switch, replay defense, or rollback path is broken. | Execute the sanitized staging matrix against the inventoried existing deployment and immutable release identities; require positive plus failure/recovery paths before promotion. | Release | Yes | Harness complete; live evidence open |
| SEC-013 | No self-service privacy lifecycle | Medium | `docs/PRIVACY_OPERATIONS.md`; no export or account-deletion endpoint | The reviewed founder operator can perform an owner-scoped export/deletion, but a normal user cannot independently export or erase their account and backup aging is operator-controlled. | Implement and rehearse authenticated self-service export/deletion, provider revocation, backup-erasure tracking, and durable legal/security-hold exceptions before multi-user beta. | Privacy | No for founder staging; Yes for multi-user beta | Open |
| SEC-014 | Hosted fixture ingestion | Medium | `apps/web/lib/connector-registry.ts`; capture route and hosted policy seed | The pull-request diff retained the fixture connector in the hosted API registry and seeded its policy as approved, allowing an authenticated hosted user to write synthetic demo evidence to PostgreSQL. | Select connectors from an explicit hosted/demo composition mode, exclude fixture manifests from new hosted policy seeds, and prove a hosted fixture request fails without writing evidence. | Application | Yes | Resolved locally in Prompt 12; full gate passed |
| SEC-015 | Maritime acquisition crash recovery | Medium | `packages/db/src/postgres/worker-queue.ts`; `apps/worker/src/postgres-runtime.ts` | The hosted worker consumed a dispatch before execution, but its claimant selected only accepted dispatches and dispatched jobs. A crash left a running, lease-expired job behind a consumed dispatch, so restart could not reclaim it. | Permit one atomic, audience-matched reclaim of a consumed dispatch's running job after lease expiry, retain the attempt budget, and prove concurrent replacement workers cannot both claim it. | Reliability | Yes | Resolved locally in Prompt 12; full gate passed |

### Application remediation evidence — 2026-07-22

- **SEC-001:** `packages/domain/src/founder-browser-access.unit.test.ts`, `apps/web/lib/browser-agent-service.unit.test.ts`, `apps/web/lib/server/maritime-dispatch.unit.test.ts`, and `apps/worker/src/acquisition-worker.unit.test.ts` prove missing, malformed, and nonmatching founder UUID configuration denies independently at creation, dispatch, and execution. The focused run passed 4 files and 9 tests.
- **SEC-005:** `apps/web/lib/server/request-security.unit.test.ts` proves content-type, exact-origin, byte-limit, UTF-8, and malformed-JSON behavior. `scripts/verify-web-mutation-boundaries.unit.test.ts` proves the AST gate rejects missing or misordered controls. `node --import tsx scripts/verify-web-mutation-boundaries.ts` reported `Web mutation boundaries validated.` The complete non-PostgreSQL integration project passed 34 files, 138 tests, with one environment-gated test skipped.
- **SEC-006:** `scripts/verify-gmail-boundaries.unit.test.ts`, `packages/connectors/src/gmail-client.unit.test.ts`, and `apps/web/lib/server/gmail-integration-oauth.unit.test.ts` prove the GET-only client, exact readonly scope, and static rejection of broad/compose/send operations. `node --import tsx scripts/verify-gmail-boundaries.ts` reported `Gmail production sources are readonly-only.`
- **SEC-007:** `apps/worker/src/log-sanitizer.unit.test.ts` and `apps/worker/src/logger.unit.test.ts` prove arbitrary-depth key/value redaction, cycle/depth/entry/string bounds, safe timestamp preservation, query stripping, and sanitation before Pino serialization. The focused run passed 2 files and 6 tests.
- **SEC-008:** `packages/connectors/src/gmail-client.unit.test.ts` and `apps/worker/src/google-gmail-access.unit.test.ts` prove local timeout, caller cancellation, one bounded 5xx refresh retry with a fresh deadline, and safe typed errors. The Gmail connector/worker focused run passed 4 files and 10 tests.
- **SEC-009:** migration `0004_founder_security_hardening.sql` preflights ambiguous data, adds the tenant-owned refresh-lease table, enforces one null-source schedule with a partial unique index, and validates exact AES-GCM nonce/tag plus bounded ciphertext. `packages/db/src/postgres/migrations.integration.test.ts` and `schema.integration.test.ts` passed 2 files and 20 PostgreSQL-backed tests, including valid populated upgrade and refusal of ambiguous rows.
- **SEC-010:** `ephemeral-cleanup.integration.test.ts` proves bounded, idempotent expiry/deletion while durable raw, job, and audit evidence remains; `notification-repositories.integration.test.ts` proves a concurrent worker can reclaim one expired delivery lease without double claim. The focused PostgreSQL-backed runs passed 2 files and 4 tests. Refresh and disconnect also share a tested tenant-owned lease in `integration-refresh-leases.integration.test.ts`.
- **SEC-011:** `docs/PRIVACY_OPERATIONS.md` now states the exact local/hosted browser boundary, data inventory, transit and persistence, implemented ephemeral cleanup, unverified hosted retention settings, founder export/deletion sequence, disconnect/revocation, backup aging, provider outages, incident response, and required operational alerts. It explicitly says minimal captured page content may traverse the existing Maritime-hosted OpenClaw gateway and blocks any claim of fully local processing.
- **SEC-014:** hosted connector selection now contains only `manual.capture.v1`; the explicit demo selection retains `fixture.feed.v1`. The PostgreSQL global-policy seed excludes every fixture acquisition manifest. The registry unit test and hosted capture-route integration test prove the fixture is unavailable and creates no RawListing or normalization job.
- **SEC-015:** the Maritime source-job claimant can now recover a consumed dispatch only when its same-audience job is still `running`, its lease expired, and attempts remain. `FOR UPDATE SKIP LOCKED` plus the existing attempt bound still provide one claimant. The focused PostgreSQL test proves initial consumption, post-expiry recovery after dispatch expiry, concurrent single claim, unchanged consumed timestamp, and attempt exhaustion.

The complete post-Prompt-12 application gate ran every static boundary verifier, Prettier, ESLint, root plus all 11 workspace TypeScript project checks, the worker and Next.js production builds, the full unit project (134 files, 946 tests), the non-PostgreSQL integration project (34 files, 139 tests, one environment-gated skip), and the PostgreSQL integration project (16 files, 65 tests); every completed command exited `0`. Six serial Playwright Chromium flows also passed. The earlier PostgreSQL backup/restore rehearsal restored five migrations and verified 14 triggers, 60 tenant foreign keys, and matching private/encrypted row counts in an isolated temporary database.

### Maritime and OpenClaw local remediation evidence — 2026-07-22

- `apps/worker/package.json` pins `openclaw` exactly to `2026.6.33`; install-time OpenClaw
  lifecycle scripts are disabled explicitly. The local CLI reports commit `7af0cfc`.
- The Node base image is pinned to
  `sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f` and
  the reviewed OpenClaw image to
  `sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee`.
  CI actions are commit-SHA pinned. The worker runtime is assembled from a production-only
  `pnpm deploy` tree and executes the lockfile-installed OpenClaw binary as a non-root user.
- `infra/maritime/openclaw/openclaw.json5` disables gateway plugins and all application/model
  surfaces while pinning manual routing to one node. `node.openclaw.json5` loads exactly the
  bundled browser plugin, disables page evaluation and prompt/conversation hooks, and allows only
  profile `vera-zillow`.
- `scripts/verify-openclaw-config.ts` passed pinned upstream config validation, observed an empty
  gateway plugin inventory and exactly one node plugin (`browser`), and used OpenClaw's own command
  policy for iOS, Android, macOS, Windows, Linux, and unknown platforms to prove both runtime and
  pairing allowlists resolve to exactly `browser.proxy`. Its focused tests plus runtime-config,
  CLI-preflight, adapter, health-parser, and web-policy tests passed 6 files and 26 tests.
- The real adapter rejects remote plaintext WebSocket endpoints, emits only fixed `GET /tabs` and
  `GET /snapshot` proxy requests, selects exactly one exact-URL tab using the fresh suggested
  target reference, and requires manual action for ambiguity. Node health now parses the pinned
  `nodeId`/`displayName`/`approvalState` contract instead of obsolete field names.
- Hosted browser, Gmail-alert, integration, and notification lanes default disabled. Partial
  Maritime/OpenClaw tuples, invalid environment values, remote `ws://`, and non-absolute hosted
  OpenClaw binaries fail before PostgreSQL is opened. The operations snapshot retains typed
  Maritime configuration/authentication/rate-limit/unavailable codes.
- Residual: native `browser.proxy` remains broader than Vera's two GET operations. This is accepted
  only as a guarded single-founder administrative boundary pending live inventory; it is not a
  multi-user-beta control.
- The final local worker image identity is
  `sha256:302db8495e14e039f061be9601a0fdbe0ac58189f650dae03514bf6b863c4a13`.
  It runs as UID/GID 10001, reports Node 24.13.0 and OpenClaw 2026.6.33 (`7af0cfc`), returns a
  secret-free healthy payload, contains `pg`, `sharp`, and `openclaw`, excludes Vitest and
  TypeScript, and contains no `better-sqlite3` package, link, or hidden store payload.
- A private local SPDX 2.2 SBOM contains 725 packages and 2,760 files, is 2,318,102 bytes, and has
  SHA-256 `24f143dce315b0efc5d394e27d6c433b895b09439e9f6615e9285c616dbaf037`.
  It contains no `better-sqlite3` package. This local SBOM is not a substitute for the signed
  registry artifact required for promotion.
- `infra/maritime/validate.mjs` validates worker/OpenClaw assets but explicitly reports that live
  release evidence was not supplied. The release-manifest schema/verifier rejects placeholders,
  mutable references, version mismatches, missing signatures/provenance, critical/high findings,
  and non-distinct rollback digests.
- `.github/workflows/release-worker.yml` provides the missing operator-controlled registry build
  path without any Maritime call. It is `workflow_dispatch`-only and re-runs the full deterministic,
  PostgreSQL, E2E, and production-build acceptance gates before publication. Read-only acceptance,
  package-write build/scan, and OIDC sign/attest jobs have distinct permissions. The workflow pushes
  a full-commit tag; resolves the image digest; emits BuildKit/GitHub provenance and SPDX SBOM
  attestations; uses exact-workflow keyless Cosign identity; disables organization-only storage
  records for this user-owned repository; ignores repository Trivy config/suppression files;
  requires OS and Node package coverage plus a vulnerability database no older than 24 hours; and
  rejects any critical or high finding. Signed bundles and verification outputs are retained and
  hashed in the sanitized evidence. An exact count-checked SHA-pinned action allowlist and parsed
  job-boundary policy reject new actions, broadened permissions, weakened dependencies, automatic
  triggers, mutable references, repository secrets, and runtime lifecycle verbs. The separate
  read-only promotion command reruns Cosign plus GitHub provenance and SBOM bundle verification
  against the exact digest, source commit, and `zukhriddingit/VeraAI` workflow identity, and requires
  the downloaded SPDX document to equal the verified signed predicate; downloaded hashes alone are
  not accepted. No release run has occurred yet, so registry identity and signed evidence remain
  open.
- `scripts/staging/founder-release-smoke.ts` defines the ordered positive and failure/recovery
  matrix and remains network-inert unless its explicit live flag and protected configuration are
  present. `scripts/staging/gateway-http-smoke.ts` provides bounded unauthenticated negative-path
  checks. Neither result is represented as live evidence yet.
- Maritime CLI 1.7.0 read-only inventory confirmed two sleeping generic OpenClaw agents. The
  trigger-free candidate runs `2026.5.22`, has no public web URL, exposed port, or trigger, and is
  the proposed Vera gateway. A separate Telegram-enabled agent is explicitly excluded. No Vera
  worker deployment exists. No agent was started or mutated, and effective gateway config/node
  evidence remains open.

## Browser gateway threats

The current browser bridge correctly models offline nodes as deferred and manual blockers as manual actions, but the shared gateway remains a privileged execution boundary. Tenant checks alone do not make it safe for mutually untrusted users. Until per-user gateways exist, all real browser jobs must pass the founder allowlist independently at web, dispatch, and worker layers.

The deployment must deny automatic node selection and arbitrary navigation. Each job is bound to the authenticated owner, exact reviewed Zillow listing URL, current-tab capture operation, selected node, selected profile, correlation ID, payload hash, idempotency key, current policy state, and approval. Redirects outside the exact allowed domain, stale snapshot references, login, reauthentication, 2FA, CAPTCHA, consent, challenges, camera/microphone requests, downloads/uploads, or layout uncertainty stop with a typed state. They are never empty successes.

OpenClaw configuration is part of the security control, not merely documentation. Control UI, chat/responses APIs, cron, channels, plugins, commands, MCP, ACP, agent tools, shell, filesystem, elevated mode, model/provider credentials, automatic update, and unrelated node commands must be disabled or explicitly denied. Gateway credentials remain server/local-node secrets and never appear in URLs, Vera jobs, PostgreSQL, release manifests, or logs.

## OAuth and Gmail threats

Google OAuth must bind initiation and callback to the authenticated Vera user with cryptographically random, single-use, expiring state. Account linking remains disabled. Authorization codes, client secrets, access tokens, refresh tokens, and message bodies never enter logs. Granted scopes are checked from provider evidence after every callback, partial consent is visible, and revoked/missing refresh tokens require reconnection.

The current Gmail implementation is read-only and searches configured alert criteria before retrieving bounded message details. The release invariant is stricter than current convention: production source must have no `gmail.compose`, `gmail.modify`, `mail.google.com`, `drafts.create`, `drafts.send`, `messages.send`, SMTP, forwarding, labeling, deletion, or mailbox mutation symbol or route. Token refresh needs a local deadline and cross-process serialization so web and worker cannot race a rotated token or disconnect.

The founder release uses Better Auth's explicit seven-day server session, daily renewal, database-backed identity state, secure `SameSite=Lax` HTTP-only cookies in production, CSRF/origin checks, disabled account linking, and a memory-backed rate limiter. Memory-backed limiting is accepted only for the documented one-web-instance topology; adding another web instance requires a shared atomic limiter and a new review before traffic is split.

## PostgreSQL threats

PostgreSQL is the hosted source of truth. Repositories use server-derived user ownership and tenant-composite keys; production code must never fall back to SQLite. Migration `0003` remains immutable, and all fixes use an additive `0004` migration with preflight. Ambiguous existing data aborts visibly rather than being merged or deleted.

Runtime and migration credentials require separate least-privilege roles. The runtime role must not own the database, be a superuser, bypass row-level security, create extensions, or perform DDL. Normal append-only triggers protect raw listings and audit events from application mutation, but a database owner or superuser can bypass or remove those controls; managed-provider administrative access, migration review, provider audit logs, and backup evidence are therefore part of the trust model.

Token refresh, notification delivery, job claims, and scheduled work must use short leases with owner-safe release and expiry recovery. Network calls do not occur while holding a PostgreSQL transaction. Cleanup is bounded, deterministic, and limited to documented ephemeral control records. It never deletes raw listings, source records, provenance, canonical listings, extraction evidence, or activity events.

## Provider outage behavior

- **PostgreSQL:** liveness may remain healthy, readiness fails, writes stop, and Vera creates no in-memory or SQLite fallback state.
- **Maritime:** canonical jobs remain queued in PostgreSQL. Vera does not start a replacement web-process cron. Only safe wake/status failures retry.
- **OpenClaw gateway:** execution returns a retryable gateway-unavailable or deferred state; no empty capture is accepted.
- **Local browser node:** stale or absent heartbeat produces `deferred_local_node_offline`, creates no RawListing or success event, and advances no source cursor.
- **Google Gmail:** timeout or provider failure is not an empty mailbox. Polling remains retryable or reconnect-required according to the typed failure.
- **Google Calendar:** timeout or revoked/missing scope is never conflict-free. The UI visibly falls back to Vera rules and requires warning/confirmation according to the existing availability contract.
- **Notification provider:** idempotent delivery remains queued/retryable, quiet hours and rate limits remain enforced, and failure never duplicates a lock-screen notification.

## Dependency and supply-chain threats

Tag-only images and action tags are insufficient release evidence. The worker base and OpenClaw gateway must resolve to reviewed digests. OpenClaw must be a lockfile dependency, not a network-installed global package in the runtime image. CI and release actions are pinned to reviewed commit SHAs. The manual worker release gate binds its digest to the exact source commit and workflow identity, verifies provenance/signature and SBOM attestations, and accepts zero critical or high findings. The final release record must additionally bind the lockfile hash, OpenClaw evidence, configuration hash, and distinct rollback digests.

No release receives founder-beta approval with an unaccepted critical/high advisory, missing evidence, a mutable `latest` reference, an unverifiable build, or a version mismatch between the gateway and node.

## Incident containment

1. Activate the relevant global and per-source kill switches. For a suspected cross-boundary compromise, disable browser, integrations, notifications, and production schedules.
2. Stop new dispatch and provider work while preserving canonical PostgreSQL job and audit evidence.
3. Revoke the affected Google grant, Maritime credential, OpenClaw gateway token/node pairing, Web Push subscription, or application encryption key according to the exposed boundary.
4. Rotate credentials from protected operator tooling. Never paste secrets, browser artifacts, raw provider responses, or raw logs into chat, tickets, or Git.
5. Preserve sanitized correlation IDs, hashes, safe state codes, immutable image/config identities, affected time range, and provider audit references.
6. Restore service only after policy, identity, ownership, config, digest, and replay checks pass. Do not bypass manual blockers or weaken source policy to recover availability.
7. Use managed PostgreSQL backup/restore procedures for database recovery. Never reset hosted data or switch production to SQLite.

## Evidence rules and release decisions

Each resolved finding records:

- the exact commit and changed files;
- the exact unit, integration, E2E, static, build, or live command;
- exit status and relevant safe result;
- immutable deployment/configuration identity when applicable;
- any remaining limitation and its blocking scope.

Allowed final outcomes are:

- **No-go:** any unresolved critical/high control or failed mandatory gate.
- **Conditional founder staging:** local controls pass, but live or operator evidence remains incomplete.
- **Founder beta go:** all founder release blockers and the live positive/failure matrix pass for the one-founder topology.
- **Multi-user beta go:** requires a separate per-user browser execution isolation design plus self-service or fully rehearsed privacy lifecycle controls. The current shared gateway architecture cannot receive this outcome.

Application findings SEC-001, SEC-005 through SEC-011, SEC-014, and SEC-015 are resolved at the stated founder-release boundary with the evidence above. SEC-013 intentionally remains a multi-user blocker. Founder staging remains conditional on the open OpenClaw capability, infrastructure-ingress, immutable release-identity, backup/role verification, and unified live-staging findings. Gmail draft creation is not shipped; the only Gmail capability is configured-alert ingestion through `gmail.readonly`.
