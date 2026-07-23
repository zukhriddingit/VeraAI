# Vera security and privacy baseline

Status: normative MVP controls  
Reviewed: 2026-07-21

## Security goals

Vera should reduce rental-search risk without becoming a new source of credential loss, privacy exposure, unintended messages, calendar invitations, or unsafe browsing. Security controls must preserve user control even when listing content, a provider response, an LLM output, or a connector fails unexpectedly.

## Current implementation and target boundary

Hosted Vera now persists identity and application data only in PostgreSQL. Every private repository is bound to the authenticated session's UUID; callers cannot select an owner, every query predicates on `user_id`, and composite foreign keys reject cross-user parent/child references. Foreign and missing resources share the same 404 behavior. The worker may cross users only to atomically claim one owned job, then immediately returns to that owner's repositories.

Better Auth uses a Google Web Application OAuth client for identity only. The exact scopes are `openid`, `email`, and `profile`; implicit cross-email linking is disabled, OAuth state is database-backed, origin/CSRF checks remain enabled, and secure cookies are required in production. Calendar uses a separate Google Web Application OAuth client and server-side authorization-code flow. Gmail authorization remains a separate capability boundary.

Calendar refresh tokens and OAuth PKCE verifiers use a separate application-layer AES-256-GCM envelope before PostgreSQL insertion. Additional authenticated data binds user ID, integration or state ID, provider, and envelope version. Database encryption at rest is supplementary. Access tokens stay process-local and short-lived. Token material, authorization codes, client secrets, connection URLs, message bodies, calendar event details, and contacts are excluded from logs.

The credential-free deterministic demo is a separate SQLite composition with one synthetic owner. It has no users, sessions, accounts, verifications, OAuth credentials, or real personal data. Its process-local Calendar sidecar exposes one immutable, no-token capability fixture for deterministic approval tests; it is not a Google connection, cannot store credentials, and cannot be mutated through the demo repository. `VERA_DEMO_MODE=1` cannot activate the adapter through hosted startup.

The code defines strict source-job, browser-node, browser-execution, Maritime dispatch, Gmail alert, notification, and operations contracts with deterministic no-network mocks. Production composition uses an authenticated server-only Maritime SDK wake, durable PostgreSQL dispatch attempts, narrow Gmail alert reads, generic Web Push, and the pinned founder-only OpenClaw bridge. Source-specific browser monitoring remains disabled.

## Trust boundaries

Maritime is Vera's primary execution and deployment environment. The production adapter may wake and observe the exact configured worker/gateway deployments; dashboard triggers wake the worker. PostgreSQL owns job metadata, leases, schedules, bounded retries, results, policy, and audit. Maritime must not own authenticated consumer-site browser sessions. `LocalMockMaritimeOrchestrator` remains the default no-network test double.

The runtime wake call carries only the exact Maritime worker agent ID. Before wake, Vera writes a tenant-owned, expiring dispatch with a fixed issuer, exact audience, globally unique nonce hash, source-job reference, and payload hash. A worker may claim the job only while that dispatch is accepted, unexpired, unconsumed, and audience-matched. Wake failures expose closed error codes; raw Maritime logs never enter Vera. Operator deploy keys are separate from the narrower server runtime key.

Web Push subscription endpoints and key material are encrypted at the application layer before PostgreSQL storage. The lock-screen schema permits only fixed generic copy and a same-origin listing path. Deterministic eligibility enforces explicit thresholds, hard constraints, freshness, risk ceiling, duplicate suppression, quiet hours, hourly limits, and the notification kill switch. Provider response bodies and subscription secrets never enter logs, health, audit, or client responses.

The registered local browser node is a separate trust boundary. It owns the dedicated user-controlled OpenClaw profile, cookies, local storage, and browser session created by manual user login. OpenClaw is the default, replaceable browser execution adapter; `MockBrowserExecutionProvider` remains the no-network test implementation. Browser page content, redirects, and every result returned by the local node remain untrusted until schema, provenance, policy, and evidence validation succeed.

The Maritime/OpenClaw channel is authenticated, TLS-bound for public endpoints, replay-protected by Vera dispatch/result hashes, schema-bounded, and revocable. Node identity and authorization are scoped to the assigned user, connector, exact current-tab URL, profile, and manifest version. A registered node is not trusted to broaden policy or authorize external effects.

Untrusted inputs include:

- listing text, HTML, URLs, images, and attachments;
- email bodies, headers, attachments, and landlord replies;
- browser page content and redirects;
- structured feeds and third-party API responses;
- LLM output;
- all local HTTP requests until origin and anti-CSRF checks pass.

Trusted policy inputs are limited to version-controlled schemas, connector manifests, deterministic domain code, explicit local user approvals, application-owned orchestration state validated at the Maritime boundary, and secrets retrieved through an approved secret-store abstraction. A transport-authenticated local node result is still untrusted content.

## Minimum-data orchestration payloads

Source-job payloads are strict discriminated Zod schemas with unknown keys rejected. They contain only opaque identifiers and minimum control data:

- a sanitized fixture-set reference for `fixture`;
- an opaque protected capture reference for `user_capture`, never pasted listing content;
- a reviewed source-configuration reference and optional committed cursor for `official_api` or `email_alert`;
- an opaque node ID, saved-search ID, exact validated HTTP(S) URL, optional committed cursor, and bounded page, record, byte, duration, and concurrency limits for `local_browser`.

Every source job binds the payload to a SHA-256 payload hash, stable idempotency key, and correlation ID. The exact capability and optional opaque approval ID are immutable persisted job fields; session availability and approval validity are resolved again at dispatch and retry time rather than stored as authorization truth. Result envelopes add a deterministic result hash and remain marked as untrusted input. Job attempts retain safe status and error metadata only; they do not retain raw results.

The schema has no password, cookie, authorization-header, token, session-export, browser-storage, profile-path, password-manager, arbitrary metadata, or pasted-evidence field. Strict parsing rejects attempts to smuggle those fields into serialized payloads. This protects the application boundary; a future Maritime transport must additionally authenticate, encrypt, size-limit, replay-protect, and revoke messages.

## Primary threats

- Prompt injection embedded in listings or messages.
- OAuth token or browser-session theft.
- Local-node impersonation, stale registration, or use after revocation.
- Replayed or tampered browser dispatch and result messages.
- Cursor rollback, widening, or premature advance causing repeated or skipped records.
- An offline node being mistaken for a successful empty result.
- A browser layout change producing unsafe or misclassified evidence.
- Unrelated account, browsing-history, or page data escaping the local node.
- A Gmail draft path being broadened into send.
- A calendar hold inviting or notifying a landlord.
- SSRF or local-file access through manual URLs.
- Browser navigation escaping an allowlist.
- Duplicate external effects after retries.
- Sensitive content leaking through logs, audit events, fixtures, screenshots, or Git.
- Cross-tenant reads or writes caused by a missing repository owner predicate.
- PostgreSQL connection exhaustion, unsafe job claiming, or a schema version mismatch.
- Cross-site requests to the localhost application.
- Dependency or build-script compromise.
- Overconfident risk labels causing harmful user decisions.
- Adversarial or malformed listing evidence poisoning duplicate clusters, rankings, or comparative risk baselines.

## Secrets and credentials

Never commit or place in fixtures:

- .env files;
- OpenAI or other provider API keys;
- OAuth client secrets or refresh/access tokens;
- cookies or browser profiles;
- third-party passwords;
- real listing contact details;
- real mailbox content;
- real calendar event data;
- screenshots containing personal information.

Hosted integration tokens are accessed only through a narrow credential repository. Refresh-token material must be encrypted with the application-layer credential envelope before PostgreSQL insertion. Access tokens should remain short-lived and should not be persisted in browser storage. A development CLI store, if later added, must use separate development credentials, live outside the repository, use owner-only permissions, and be impossible to select in production mode.

Configuration files may contain public OAuth client metadata only when the provider treats it as non-secret. Refresh tokens, client secrets, and test-account details remain local and uncommitted.

Maritime's secret manager stores only secrets required by approved hosted API and email connectors. Consumer-site passwords, browser cookies, local storage, session exports, password-manager values, authorization headers, and OpenClaw profile contents never enter Maritime.

Vera exposes no third-party password form, password API parameter, `credentialLogin` capability, automated password-typing path, credential-replay mechanism, or session-export upload. The user signs in manually inside the dedicated local OpenClaw profile. Vera never asks for, records, types, uploads, or transmits that password. Login, reauthentication, 2FA, CAPTCHA, and consent remain manual blockers rather than automatable job steps.

## OAuth controls

Hosted identity uses the server-side authorization-code flow with a Google Web Application OAuth client. It requests only `openid`, `email`, and `profile`, binds database-backed state to the initiating Vera session, uses exact environment-specific redirect URIs, and requires HTTPS callbacks and secure cookies in production. It does not request offline access or Gmail/Calendar scopes.

The Calendar integration flow is separate from identity and:

- binds initiation to the authenticated Vera user with cryptographically random, single-use, short-lived state;
- exchanges the authorization code server-side and uses exact HTTPS callback URI matching;
- requests `calendar.freebusy` only when conflict checking is enabled and requests `calendar.events.owned` separately only when hold creation is enabled or first used;
- verifies the scopes actually granted and preserves granted, missing, expired, and revoked capability states independently;
- encrypts refresh tokens before PostgreSQL persistence, keeps access tokens out of persistent browser storage, and refreshes with bounded retries;
- attempts provider revocation and always clears Vera's local encrypted credential material when the user disconnects; if provider revocation cannot be confirmed, it records a safe warning and recovery state without retaining the token;
- redacts authorization codes, tokens, client secrets, provider error bodies, query strings, and message contents from logs;
- keeps any development CLI fallback on separate development credentials and outside the primary hosted UX.

The authorization request uses `access_type=offline` and `include_granted_scopes=true`. Each 10-minute state value is cryptographically random, single-use, bound to the authenticated Vera user and one requested capability, and protected by PKCE S256. The callback validates the exact configured public origin and redirect URI, exchanges the code server-side, and verifies the actual grant, Google subject, and client audience. Partial consent enables only the granted capability; it never converts a missing permission into success.

The founder release implements hosted Gmail alert ingestion with `gmail.readonly` only. It does not request `gmail.compose`, `gmail.modify`, `gmail.send`, or `mail.google.com`, and it exposes no draft or send operation. The hosted identity client never receives Gmail or Calendar data scopes, and development, staging, and production use different integration clients and callbacks.

Draft-only outreach remains an accepted future boundary, not a current production capability. Because `gmail.compose` can authorize both draft creation and sending, adding drafts later requires a separate reviewed milestone with a narrow `drafts.create` adapter and human approval; merely obtaining the provider scope is insufficient. The current founder-release defense in depth requires:

- no compose, send, or mailbox-modification capability in domain schemas or manifests;
- a Gmail adapter whose transport permits only `GET` requests;
- no generic authenticated Gmail client exposed to domain code;
- no draft, send, mailbox-modification, deletion, labeling, or forwarding route, worker job, UI action, or test helper;
- a static production-source verifier that rejects broad Gmail scopes and `drafts.create`, `drafts.send`, or `messages.send` operations;
- contract tests that fail if a non-read operation enters the Gmail client.

## Calendar privacy and side-effect controls

The founder release checks only the connected Google account's primary calendar and says so in the UI. Vera does not request `calendar.calendarlist.readonly`, broad Calendar access, or event-read scopes. Conflict checking uses the free/busy endpoint only: it does not fetch event titles, descriptions, attendees, locations, conference data, or other event details.

Free/busy responses are ephemeral. PostgreSQL stores only the state, primary-calendar attempt/result, check time, response hash, interval count, safe provider error, and the Vera rules that contributed to proposals. Raw busy intervals are not persisted or placed in logs, activity metadata, or analytics.

Availability degrades according to explicit states: `checked`, `scope_not_granted`, `google_disconnected`, `google_temporarily_unavailable`, `stale`, and `vera_rules_only`. A timeout, transient failure, absent grant, revoked token, or stale result is never interpreted as an empty calendar. Rules-only windows are labeled **Calendar conflicts not checked**, expose Connect/Reconnect or Retry, and require a visible warning before continuing.

Immediately before event creation, Vera rechecks the selected interval when free/busy is available. A newly detected conflict blocks the hold and offers replacement windows. If the final check cannot complete, the user may continue only through a fresh approval bound to the exact hold payload, explicit conflict warning, failure state, and override flag; a prior approval cannot authorize that change.

The Calendar adapter permits only a deterministic, private, tentative event on the primary calendar. The event has an empty attendee list, no conferencing, and `sendUpdates=none`; schemas and boundary tests reject wider effects. Founder-release cancel and reschedule transitions update Vera first and never call Google update or delete. The user must manage the external event manually until a later, separately approved capability exists.

## Web application boundary

- Bind local development servers to 127.0.0.1 by default; hosted servers may bind their private platform interface behind HTTPS termination.
- Reject unexpected Host and Origin headers.
- Use same-site cookies and an anti-CSRF token for state-changing routes.
- Set a restrictive Content Security Policy and deny framing.
- Disable permissive CORS.
- Do not expose the worker over HTTP.
- Derive tenant identity from the authoritative server session; never accept an owner ID from a browser request.
- Never run Next.js route handlers requiring PostgreSQL or credentials in an Edge runtime.

## URL and network safety

Manual capture performs no URL retrieval. A URL is inert provenance text.

The current manual URL validator is a pure parser. It permits only trimmed HTTP(S) values and rejects credentials, fragments, explicit ports, localhost, IP-literal hosts, malformed hostnames, and oversized values. It performs no DNS lookup; a future network adapter must reject hostnames that resolve to private, loopback, or link-local addresses. Known-source classification requires an exact domain or subdomain boundary, so suffix spoofs remain `other`. Unknown public domains may be stored as inert provenance but are explicitly marked as requiring a future manual browser-policy decision.

External connectors call only exact HTTPS API origins declared in an enabled manifest. Redirects are rejected unless the final origin is independently allowed. Network clients enforce response-size and time limits and never access file URLs, Unix sockets, localhost, link-local addresses, or private address space unless a future local-only capability explicitly requires and documents it.

Remote image downloads are not part of the MVP. Photo hashes are computed only from sanitized or user-supplied bytes already in the capture.

## Browser safety

Local browser acquisition is a first-class but narrow MVP capability. The production connector portfolio is exactly `official_api`, `email_alert`, `local_browser`, and `user_capture`; the code-level union additionally contains test-only `fixture`, which cannot represent a live provider. OpenClaw is the default replaceable adapter for `local_browser`. The source-policy states are exactly `approved`, `user_triggered_only`, `experimental_personal`, and `disabled`. Policy state is separate from `manual` or `scheduled` execution; neither grants an operation by itself. Missing, malformed, mismatched, disabled, or killed policy always denies.

Real browser execution is additionally restricted by the server-only `VERA_BROWSER_FOUNDER_USER_IDS` allowlist. Vera rechecks the authenticated owner against the same exact UUID set when the job is created, when it is dispatched to Maritime, and immediately before the worker invokes the browser provider. Missing, malformed, or nonmatching configuration denies at every boundary; an operator role or an otherwise valid tenant session does not implicitly grant browser execution.

Every `local_browser` operation must:

- run in a dedicated, user-controlled local OpenClaw profile stored outside the repository, Maritime, and backups;
- match an exact configured saved-search URL and visit only bounded, same-source listing-detail URLs newly discovered from that search;
- use a source-specific cursor or last-seen listing ID and commit it only after durable, idempotent raw import;
- reject cursor rollback, replay, search widening, arbitrary category exploration, unrelated recommendations, broad website crawling, popups, external-protocol launches, and navigation outside the reviewed scope;
- stop for login, reauthentication, 2FA, CAPTCHA, consent, camera, microphone, download, upload, payment, unexpected navigation, or changed page structure;
- disable arbitrary page JavaScript evaluation by default;
- bound time, bytes, pages, records, and concurrency;
- provide immediate source and local-node kill switches;
- never click message, contact, apply, submit, payment, or account-setting controls.

Browser navigation requests contain one target URL and an explicit list of allowed URLs. The target must exactly match an allowed entry. Syntactic URL validation rejects credentials, fragments, explicit ports, localhost, IP-literal hosts, non-HTTP(S) schemes, and credential-like query keys. It performs no DNS resolution, so a future network adapter must separately reject public-looking hostnames that resolve to private, loopback, or link-local addresses. The interface intentionally has no arbitrary JavaScript, generic click, password entry, CAPTCHA handling, messaging, application, upload, or payment operation.

Health is an explicit heartbeat contract, not an inference from an empty result. The node record carries both `lastHeartbeatAt` and `heartbeatExpiresAt`; an online record whose expiry has passed is treated as stale. Missing, offline, stale, and revoked nodes map to distinct deferred reasons under the single `deferred_node_offline` job state.

Login, reauthentication, two-factor authentication, CAPTCHA, consent, camera permission, and microphone permission are a closed `manual_action_required` blocker vocabulary. A blocker returns only a safe instruction and opaque job/node/source identity. It cannot contain credentials, form values, cookies, or page content, cannot be retried automatically as success, and cannot advance a cursor.

Connector methods are optional by operation. Calling undeclared discovery, capture, or detail behavior returns `unsupported_operation` with no records or cursor candidate. It does not fall back to a broader method, another acquisition mode, or generic browsing.

Craigslist uses official search-alert `email_alert` ingestion initially; Craigslist `local_browser` monitoring is `disabled`. Zillow and Facebook Marketplace `local_browser` monitoring are `experimental_personal` and disabled by default. Their direct `user_capture` paths remain available, and supplied URLs remain inert unless a separate authorized operation occurs.

No browser password, cookie, authorization header, local-storage value, session export, password-manager value, or profile content may appear in a Maritime dispatch, node result, log, audit event, support bundle, or cloud backup.

## Local-node dispatch and offline safety

The production Maritime adapter persists an expiring, nonce-hashed dispatch bound to the user, worker audience, source job, payload hash, and correlation chain, then calls Maritime with only the worker agent identifier. The worker claims the full user-owned job from PostgreSQL only after the dispatch is accepted. No consumer-site credential, session artifact, listing/page content, OAuth token, or snapshot enters the Maritime wake request.

The OpenClaw node returns only schema-bounded evidence, typed blocker/failure codes, and safe operational counts. Stable idempotency keys, payload/result hashes, short validity windows, explicit audience, nonce replay rejection, current policy, and tenant checks reject stale, revoked, wrong-user, wrong-connector, wrong-manifest, wrong-target, or replayed results without advancing a cursor. Gateway and registration credentials are independently revocable and never require exporting the browser profile.

If the assigned local node is unregistered, offline, stale, or revoked after policy authorization, the job enters queryable `deferred_node_offline` with a typed reason. This state:

- is persisted by the source-job repository and rendered by the browser-agent and operator health views;
- preserves the same stable job identity and last committed cursor;
- creates no RawListing, success event, or successful-empty result;
- permits bounded retry or explicit user cancellation after the node returns.

A successful empty result is valid only when the authenticated node actually inspected the configured saved search and found no IDs newer than the committed cursor. Manual blockers, layout changes, cursor inconsistencies, schema failures, policy denials, and transport failures are distinct typed outcomes and never advance the cursor.

## Deterministic processing boundary

Every acquisition mode feeds the same non-bypassable sequence:

```text
source record
  -> normalization
  -> provenance
  -> deduplication
  -> ranking
  -> notification
  -> human-approved external action
```

Browser evidence cannot directly authorize, notify, message, rank, canonicalize, create an application, change an account, or write a calendar event. Autonomous messaging and account-login automation remain prohibited.

The production decision engine treats every source record, URL, description, coordinate, and photo hash as untrusted typed input. Candidate generation has a hard maximum and fails visibly instead of truncating silently. Exact links do not override material conflicts; probabilistic features are bounded basis-point values; thresholds and weights are closed versioned configuration. A low-price outlier is evaluated only against the current result set and remains a risk indicator with evidence, never a fraud verdict.

Decision computation performs no network access. URL normalization does not resolve or fetch a URL. Photo decoding is allowed only for already-supplied bytes under explicit byte and pixel limits; malformed or oversized images fail with a typed error. Perceptual similarity never causes remote image retrieval.

A result is applied only when the worker still owns the lease and the profile's corpus revision exactly matches the snapshot. The apply operation is one short transaction. Stale, partial, or unparseable plans create no canonical, score, or risk projection. Replaying an identical accepted plan resolves idempotently; changed evidence requires a new monotonic revision and immutable run.

Contact match features accept only normalized in-memory fingerprints. Raw phone numbers and email addresses are not stored in decision histories, score inputs, activity metadata, or logs. The current persisted source projection supplies no contact fingerprints to reconciliation; adding them later requires a keyed-fingerprint storage and rotation decision because unsalted hashes of low-entropy contacts are reversible by enumeration.

Operator merge/split overrides are strict, append-only, payload-hashed records. References must exist, force-merge survivors must be active, and every accepted override queues a new corpus revision in the same transaction. Reversal appends a revocation; APIs expose no destructive mutation path.

## AI and untrusted-content controls

Listing and message content is data, never instruction. Provider prompts delimit supplied evidence as untrusted quoted content and explicitly reject embedded instructions to reveal secrets, browse, use tools, run commands, contact anyone, change policy, or populate extra fields. The Responses request exposes no tools and receives no OAuth token, browser cookie, local path, raw audit history, policy registry, unrelated mailbox content, or unrelated listing.

Deterministic extraction runs first. The model receives only the unresolved field names and their reason codes; it cannot overwrite a known structured or rule-backed value. Structured output is schema-validated and then checked deterministically for requested-field membership, verbatim evidence, minimum confidence, exact contacts, explicit money currency/billing, monetary role, justified availability dates, and species-specific pet evidence. Monetary-role validation requires a base-rent label for base rent and same-line label/amount evidence under explicit required or mandatory context for each recurring fee. After one failed complete repair attempt, processing stops visibly. There is no permissive parser or guessed fallback. AI output cannot authorize actions, change connector policy, mark a hard constraint satisfied, create a canonical listing, infer protected traits, or declare fraud.

The official OpenAI transport sets `store: false`, exposes no tools, disables SDK retries, uses caller cancellation, and enforces a bounded timeout. Model selection comes only from `VERA_LLM_MODEL`; no default model is embedded. Both key and model absent means deterministic-only. Partial configuration fails visibly. Tests use the deterministic no-network mock only when explicitly injected; production never substitutes it.

Provider data-retention settings, contractual handling, and regional processing requirements must be reviewed before real personal data is sent to a live provider. Live extraction is disabled by default and should be exercised only with sanitized or operator-approved non-sensitive content until that review is complete. Automated tests make no live call unless the separate live-test flag, API key, and model are all present.

## Data at rest and retention

The normative data inventory, browser-content transit boundary, retention targets, founder export/deletion procedure, provider-outage behavior, and credential-incident runbook are in [`PRIVACY_OPERATIONS.md`](./PRIVACY_OPERATIONS.md). The local browser keeps passwords, cookies, storage, and profile contents local; the minimal page content accepted for capture may traverse the configured OpenClaw gateway and worker before it is persisted as listing evidence. Do not describe that flow as fully local processing.

- Store hosted private data only in the managed PostgreSQL database for its environment; do not share databases or OAuth clients across development, staging, and production.
- Use database-enforced foreign keys, composite ownership references, uniqueness, bounded pools, and transaction timeouts.
- Keep raw listing evidence, structured extraction runs, activity events, source-job attempts, and Calendar availability checks immutable through PostgreSQL triggers.
- Encrypt sensitive integration credentials at the application layer; managed-database encryption at rest is supplementary.
- Keep message bodies, tokens, email addresses, phone numbers, and unnecessary contact data out of audit payloads.
- Hash exact approved payloads with a domain-separated cryptographic hash; a hash proves binding but is not a substitute for redaction.
- Encrypt and access-control backups, test restores into a separate non-production database, and apply production retention/deletion policy to backup copies.

The explicit SQLite demo stores only sanitized fixtures for one synthetic owner, enables foreign keys and WAL, and may be reset and reseeded. It is not a backup, failover, hosted datastore, or destination for real identity and integration data.

## Logging and audit

Structured logs use correlation IDs and an allowlist of safe fields. Redact authorization headers, cookies, tokens, query strings, message bodies, email addresses, phone numbers, and listing contact fields by default. A debug flag must never disable token or cookie redaction.

Activity events are immutable and append-only. Record:

- actor and action;
- target type and opaque ID;
- connector and capability;
- policy allow/deny reason code;
- approval ID and payload hash when applicable;
- outcome or typed error class;
- correlation and causation IDs;
- timestamp.

For local-browser dispatch, record the policy state and manifest version, acquisition mode, opaque job/node/connector IDs, trigger, saved-search identifier rather than a credential-bearing URL, last committed cursor hash or opaque checkpoint, bounded limits, typed outcome, retry time, and correlation/causation IDs. Do not record dispatch nonces, transport credentials, full URLs with query values, session state, or returned unrelated page content.

Source jobs may persist an opaque approval ID but never persist `hasApproval` or `hasUserSession` truth flags. Dispatch and retry query current session availability and resolve the current approval through a fail-closed runtime provider. The approval must remain pending, unused, unexpired, and exactly bound to the source job. The local mock re-requires this state on each attempt; a live side-effect composition must atomically consume the approval before execution.

Record lifecycle events separately instead of updating a pending row. Raw provider payloads belong in their protected evidence tables, not the activity log.

For capture ingestion, the persisted event chain is requested, policy authorized/denied, capture completed/failed, and normalization completed/failed. Successful normalization metadata is restricted to opaque IDs, extraction mode, provider/model when applicable, prompt/extraction versions, requested-field count, known/unknown counts, token counts, latency, and repair count. Failure metadata contains only safe error code/category, retryability, and resulting state. Pasted text, prompts, raw model output, evidence snippets, provider request/response bodies, full provenance URLs, API keys, and contact values remain outside logs and audit metadata.

## Idempotency and side-effect safety

- Every import, job, draft, calendar event, and notification has a stable idempotency key.
- Browser dispatch retries retain the same logical job identity; a discovered source ID imports once.
- A cursor advances only after its corresponding raw evidence is durably accepted and never on policy denial, unsupported operation, manual blocker, transport failure, layout/schema failure, or `deferred_node_offline`.
- Approval is single-use, expires after 15 minutes, and is invalid after any payload change.
- Provider calls occur only after policy authorization is persisted.
- Retries distinguish unknown outcome from confirmed failure.
- A provider lookup or deterministic ID resolves ambiguous outcomes before retrying a create.
- Calendar events contain no attendees or conference data and set sendUpdates=none.
- Calendar suggestions never silently fall back from a failed check, and every hold receives a final conflict recheck or a new, explicitly warned override approval.
- Calendar cancel and reschedule update internal state only; no Google event update/delete capability exists in the founder release.

## Database integrity

Raw evidence, extraction, and audit tables reject update and delete statements through PostgreSQL migration triggers. Ingestion and canonicalization use transactions, but network or AI calls never hold a transaction open. A successful normalization atomically commits the source record, complete field provenance, immutable extraction run, redacted event, and job completion. Provider failure writes no partial source/extraction rows. Repository tests verify tenant foreign keys, unique idempotency constraints, immutable triggers, timezone behavior, lease recovery, concurrent lifecycle updates, `FOR UPDATE SKIP LOCKED` claiming, and rollback behavior against PostgreSQL.

The founder deployment runs one worker instance. The claim implementation still prevents duplicate execution under tested concurrent claimers; adding more deployed workers is an operational topology change requiring pool-budget and throughput review.

## OpenClaw current-tab threat boundary

The real adapter is server-side and version-pinned. Gateway URL/token never enter a SourceJob, browser request schema, PostgreSQL, audit, argv, browser storage, or client component. The child process receives them only as `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`; errors expose closed codes and never child stdout/stderr. The CLI call is fixed to `nodes invoke`, an exact node, `browser.proxy`, and JSON parameters for `GET /tabs` or `GET /snapshot` on the selected profile.

The worker validates user ownership, manifest/operation, four persisted control layers plus the process kill switch, selected and allowlisted profile, heartbeat freshness, pairing, capability approval, and exact `2026.6.33` compatibility before provider I/O. It validates result correlation, execution, node, profile, canonical URL, payload hash, invocation key, result hash, and content hash before acceptance. A replay resolves the immutable prior acceptance; a mismatch rejects. Node absence/staleness is visible deferral, not empty success. Pairing/capability/login/2FA/CAPTCHA/consent/challenge/redirect/stale-target/layout/version uncertainty is manual action, not an automatic retry loop.

Page text is untrusted evidence. It can never modify the chosen user/node/profile/URL, policy, tool surface, environment, filesystem, secrets, audit, or job payload. The accepted evidence is bounded to one title, one exact canonical URL, listing text, a small scalar metadata map, and hashes. The adapter discards unrelated tabs and does not retain screenshots or raw provider envelopes.

The fixed Vera adapter surface and the native OpenClaw capability are distinct boundaries. Vera serializes only `GET /tabs` and `GET /snapshot`, but OpenClaw `2026.6.33` has no path-level allowlist inside `browser.proxy`. The reviewed node and gateway configuration therefore minimizes the effective command set to that single command, allows only the dedicated profile, disables arbitrary evaluation and unrelated plugins/tools, and leaves the source disabled by default. This is an explicitly accepted single-founder residual, not a claim that the native proxy is read-only; a narrow node-side command is required before broader beta use.

The founder node-registration helper records a manually verified pairing/capability observation for five minutes; it does not call OpenClaw approval APIs or grant a real capability. This is acceptable only for single-founder dogfooding. A signed continuous heartbeat/enrollment channel is required before broader hosted enrollment.

## Dependency and build hygiene

- Pin the package-manager version and commit the lockfile during scaffolding.
- Use Node 24 LTS in development and CI.
- Review install scripts and minimize native dependencies; `better-sqlite3` is retained only for the explicit offline demo adapter.
- Run audit tooling as advisory evidence, not an automatic unsafe upgrade mechanism.
- Keep the pnpm-workspace PostCSS override pinned to a reviewed patched release until Next.js's direct dependency resolves beyond the advisory; current acceptance uses 8.5.20.
- Keep the pnpm-workspace Sharp override pinned to the reviewed patched `0.35.3` release until Next.js accepts that line directly; build and E2E acceptance cover the compatibility override.
- Keep generated migrations under review.
- `maritime-sdk@0.5.0` is server-only and receives only agent identifiers for runtime wake/status/log-reference operations; HTTP handlers never spawn the Maritime CLI. OpenClaw is pinned to `2026.6.33`; its process adapter uses `shell:false`, bounded output/time, a minimal child environment, and fixed browser-proxy operations. The source remains disabled and unsupported for public use despite the patched version.

## Security acceptance checks

Before the applicable implementation or live-integration milestone is accepted:

- no secret, token, cookie, browser profile, or real personal fixture appears in the diff or Git history;
- default configuration starts with all external connectors disabled;
- malformed or missing policy denies;
- unknown acquisition modes or policy states deny, and scheduled execution cannot bypass `user_triggered_only` or disabled `experimental_personal` entries;
- manual capture makes no network request;
- dispatch and result schemas reject passwords, cookies, authorization headers, local storage, session exports, password-manager values, and OpenClaw profile content;
- the Maritime/local-node channel remains mutually authenticated, encrypted, replay-protected, bounded, and revocable;
- an unregistered, offline, stale, or revoked node produces `deferred_node_offline`, creates no RawListing or success result, and preserves the stable job identity and committed cursor;
- browser navigation cannot escape the exact configured saved-search and newly discovered same-source detail scope;
- cursor rollback, replay, premature advance, and duplicate import tests fail closed;
- Craigslist `local_browser` monitoring denies; Zillow and Facebook Marketplace remain disabled `experimental_personal` browser entries until explicit enablement, while `user_capture` remains available;
- no autonomous message, broad-crawl, password handling, credential-login, session-export, or account-login path exists;
- prompt-injection fixtures cannot broaden an action;
- the default worker, tests, migration, seed, and build make no live model request;
- live extraction requires both key and environment-selected model; the live test additionally requires its explicit flag;
- invalid model output receives at most one repair and then fails closed;
- Gmail send operations are absent;
- Calendar data scopes are absent from the identity client and are requested separately and incrementally;
- conflict checking requests only `calendar.freebusy`, and hold creation requests only `calendar.events.owned` when that capability is enabled or first used;
- Calendar free/busy uses only the primary calendar, fetches no event details, and persists no raw busy intervals;
- missing, partial, revoked, stale, and temporarily unavailable Calendar checks produce a visible degraded state rather than an empty success;
- a new final conflict blocks creation, and a failed final check requires a newly payload-bound explicit override approval;
- Calendar payloads with attendees or conferencing are rejected;
- Calendar cancellation and rescheduling make no provider update or delete call;
- approval mismatch, expiry, reuse, and edit invalidation tests pass;
- raw and audit row mutation is rejected by PostgreSQL and by the explicit demo adapter;
- logs and activity events are redacted;
- duplicate retries create at most one provider-side effect;
- unit, integration, connector contract, and E2E suites make no live external side effects.

## Residual risks

- A stolen Gmail compose token is provider-capable of sending even though Vera is not.
- A stolen `calendar.events.owned` token can modify events on calendars the user owns even though Vera's adapter exposes only tentative primary-calendar insert. Application encryption, narrow adapter APIs, incremental consent, audit, disconnect, and revocation reduce but do not remove that provider-scope risk.
- First-class browser connectors remain brittle and source-specific; layout changes can defer or fail monitoring until reviewed.
- A local OpenClaw node can be offline, compromised, stale, or unavailable at a scheduled trigger; visible deferral limits silent data loss but cannot guarantee discovery latency.
- A compromised local browser profile can expose consumer-site sessions even though Maritime never stores them.
- A compromised hosted application process can access tenant data and decrypted credentials while in use; least-privilege secrets and incident revocation remain necessary.
- Risk indicators can be wrong; the UI must preserve evidence and uncertainty.
- Repository-level tenant scoping is defense in depth but not PostgreSQL row-level security; every new repository query requires isolation review and tests.
- The SQLite demo is intentionally single-owner and must never receive production data.

These risks are accepted for the founder topology of one region, one web instance, one worker instance, one managed PostgreSQL database, and an optional user-controlled local browser node. They must be revisited before horizontal scaling, live browser enablement, broader source coverage, or higher-sensitivity data collection.
