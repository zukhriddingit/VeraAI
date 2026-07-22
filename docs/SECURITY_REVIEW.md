# Vera Founder-Release Security Review

Date: 2026-07-22

Review status: Pre-remediation evidence baseline

Initial release outcome: **conditional founder staging**. Vera is **not approved for multi-user beta**. Founder staging remains conditional until every release-blocking finding below is resolved and the local, PostgreSQL, supply-chain, Maritime, OpenClaw, and live failure-path evidence is recorded in this document.

## Scope and method

This review covers the current repository and uncommitted Prompt 10 implementation as it existed before founder-release hardening code was added. It includes:

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
| SEC-001 | Non-founder browser execution | High | `apps/web/lib/browser-agent-service.ts`; `apps/web/lib/server/maritime-dispatch.ts`; `apps/worker/src/acquisition-worker.ts` | Ordinary tenant ownership is enforced, but an authenticated user can reach the single founder gateway whenever browser controls are enabled because there is no independent founder UUID allowlist. | Enforce one server-only founder UUID allowlist at job creation, dispatch, and immediately before worker provider invocation. Missing or malformed configuration must deny. | Application | Yes | Open |
| SEC-002 | OpenClaw capability surface | High | `infra/maritime/OPENCLAW.md`; no checked-in gateway configuration | Documentation says dangerous commands are denied, but deployment does not supply or validate an enforceable command, tool, plugin, channel, node-routing, or profile configuration. | Add and validate a least-privilege OpenClaw `2026.6.33` gateway/node configuration; allow only explicit `browser.proxy` routing to one node/profile. | Infrastructure | Yes | Open |
| SEC-003 | Mutable release identity | High | `Dockerfile`; `infra/maritime/README.md`; `.github/workflows/ci.yml` | The worker base is tag-only, OpenClaw is installed globally during the image build, deployment uses mutable tags, and no complete SBOM/provenance/advisory evidence is required. | Pin base, dependency, actions, worker, and gateway by immutable identity and require SBOM, provenance/signature, vulnerability review, and rollback evidence. | Release | Yes | Open |
| SEC-004 | Public worker ingress | Medium | `infra/maritime/README.md` provisions `vera-worker` with `--public` | A worker that needs only Maritime wake/status and PostgreSQL claims has an unnecessary internet-reachable health surface, increasing scanning and denial-of-service exposure. | Provision the worker without public ingress and keep health, readiness, and metrics on the agent-local port. | Infrastructure | Yes | Open |
| SEC-005 | Mutation exhaustion and CSRF inconsistency | Medium | `apps/web/app/api/captures/route.ts` reads before authentication; `apps/web/app/api/dedupe/overrides/route.ts`, shortlist, and dismiss call unbounded `request.json()`; several other routes hand-roll body limits | An unauthenticated or cross-origin request can be buffered before rejection, and inconsistent parsing can bypass the intended body-size/content-type policy. | Authenticate, require the exact configured same origin, stream a bounded JSON body in UTF-8 bytes, then schema-validate in every mutation route. Add a static regression gate. | Web | Yes | Open |
| SEC-006 | Gmail capability regression | High | `packages/connectors/src/gmail-client.ts` currently exposes GET-only search/detail; OAuth uses `gmail.readonly`; no dedicated production-source verifier exists | A later dependency, scope, adapter method, or route could silently introduce compose, send, modify, label, delete, or broad mailbox access. | Add a CI verifier rejecting broad/compose/modify scopes and all draft/send/mailbox-mutation methods while allowing only bounded read-only alert ingestion. | Integrations | Yes | Open |
| SEC-007 | Nested log disclosure | Medium | `apps/worker/src/logger.ts` relies on a finite set of shallow Pino redact paths | Secrets, contact data, raw evidence, prompts, or response bodies nested in arrays or deeper provider objects can evade those paths and enter hosted logs. | Recursively sanitize structured values with key/value, depth, entry, cycle, and contact-pattern controls before serialization. | Worker | Yes | Open |
| SEC-008 | Outbound request hangs | Medium | `packages/connectors/src/gmail-client.ts`; `apps/worker/src/google-gmail-access.ts` | Gmail list/detail and token-refresh requests accept caller cancellation but impose no complete local deadline; a stalled provider can retain a lane or lease until process termination. | Compose caller cancellation with a bounded per-attempt timeout, bound response processing, cap retries, and return typed safe errors. | Integrations | Yes | Open |
| SEC-009 | PostgreSQL schedule uniqueness and ciphertext bounds | Medium | `packages/db/drizzle/0003_maritime_execution_plane.sql`; `packages/db/src/postgres/schema.ts` | SQL uniqueness with a nullable source permits duplicate global schedules; encrypted Web Push nonce/tag/ciphertext byte fields have no exact or practical length constraints. | Add a forward migration with ambiguity preflight, partial uniqueness, exact GCM nonce/tag lengths, bounded ciphertext, and populated-upgrade tests. | Persistence | Yes | Open |
| SEC-010 | Ephemeral retention and lease recovery | Medium | OAuth state, Maritime dispatch, heartbeat, schedule-run, and delivery lease tables; no implemented cleanup; notification claims exclude expired `leased` rows | Expired control data accumulates, and a crashed worker can strand a notification indefinitely. | Add bounded cleanup for explicitly ephemeral rows and atomic expired notification-lease recovery while preserving immutable evidence and audit history. | Reliability | No for founder staging; Yes for broader beta | Open |
| SEC-011 | Browser data-flow ambiguity | Medium | `docs/SECURITY.md`; `infra/maritime/OPENCLAW.md`; no complete data inventory/retention runbook | An operator can overstate the local privacy boundary even though selected page content may cross the local node, hosted gateway, worker, and PostgreSQL ingestion boundary. | Publish exact location, transit, persistence, logging, retention, export, deletion, disconnect, revocation, backup, and provider-outage behavior. | Privacy | Yes | Open |
| SEC-012 | Missing unified live staging evidence | High | Existing opt-in Maritime, OpenClaw, and Web Push tests are separate; no signed release manifest or single failure-path report exists | Local mocks can pass while the deployed image, trigger, gateway, node, notification, kill switch, replay defense, or rollback path is broken. | Build one sanitized staging matrix against immutable release identities and require positive plus failure/recovery paths before promotion. | Release | Yes | Open |

## Browser gateway threats

The current browser bridge correctly models offline nodes as deferred and manual blockers as manual actions, but the shared gateway remains a privileged execution boundary. Tenant checks alone do not make it safe for mutually untrusted users. Until per-user gateways exist, all real browser jobs must pass the founder allowlist independently at web, dispatch, and worker layers.

The deployment must deny automatic node selection and arbitrary navigation. Each job is bound to the authenticated owner, exact reviewed Zillow listing URL, current-tab capture operation, selected node, selected profile, correlation ID, payload hash, idempotency key, current policy state, and approval. Redirects outside the exact allowed domain, stale snapshot references, login, reauthentication, 2FA, CAPTCHA, consent, challenges, camera/microphone requests, downloads/uploads, or layout uncertainty stop with a typed state. They are never empty successes.

OpenClaw configuration is part of the security control, not merely documentation. Control UI, chat/responses APIs, cron, channels, plugins, commands, MCP, ACP, agent tools, shell, filesystem, elevated mode, model/provider credentials, automatic update, and unrelated node commands must be disabled or explicitly denied. Gateway credentials remain server/local-node secrets and never appear in URLs, Vera jobs, PostgreSQL, release manifests, or logs.

## OAuth and Gmail threats

Google OAuth must bind initiation and callback to the authenticated Vera user with cryptographically random, single-use, expiring state. Account linking remains disabled. Authorization codes, client secrets, access tokens, refresh tokens, and message bodies never enter logs. Granted scopes are checked from provider evidence after every callback, partial consent is visible, and revoked/missing refresh tokens require reconnection.

The current Gmail implementation is read-only and searches configured alert criteria before retrieving bounded message details. The release invariant is stricter than current convention: production source must have no `gmail.compose`, `gmail.modify`, `mail.google.com`, `drafts.create`, `drafts.send`, `messages.send`, SMTP, forwarding, labeling, deletion, or mailbox mutation symbol or route. Token refresh needs a local deadline and cross-process serialization so web and worker cannot race a rotated token or disconnect.

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

Tag-only images and action tags are insufficient release evidence. The worker base and OpenClaw gateway must resolve to reviewed digests. OpenClaw must be a lockfile dependency, not a network-installed global package in the runtime image. CI actions are pinned to reviewed commit SHAs. The release record must bind source commit, lockfile hash, image digests, SBOMs, provenance/signature verification, vulnerability review, configuration hash, and rollback digests.

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

No current finding is marked resolved by this baseline document. The next changes must follow the application, PostgreSQL, and Maritime/OpenClaw implementation plans and update this register only after verification.
