# Vera security and privacy baseline

Status: normative MVP controls  
Reviewed: 2026-07-18

## Security goals

Vera should reduce rental-search risk without becoming a new source of credential loss, privacy exposure, unintended messages, calendar invitations, or unsafe browsing. Security controls must preserve user control even when listing content, a provider response, an LLM output, or a connector fails unexpectedly.

## Current implementation and target boundary

The current clean clone runs fixture and user-capture jobs through the local SQLite worker. It does not yet implement Maritime orchestration, remote dispatch, email-alert acquisition, an OpenClaw bridge, or source-specific browser monitoring. The controls below define the normative Ship Season MVP boundary those components must satisfy; they do not claim the target infrastructure already exists.

## Trust boundaries

Maritime is Vera's primary orchestration and deployment environment. It is trusted to manage monitoring jobs, scheduled triggers, stable job metadata, bounded retries, agent and connector health, policy-checked notifications, and secrets for approved hosted API and email integrations. It does not own authenticated consumer-site browser sessions.

The registered local browser node is a separate trust boundary. It owns the dedicated user-controlled OpenClaw profile, cookies, local storage, and browser session created by manual user login. OpenClaw is the default, replaceable browser execution adapter. Browser page content, redirects, and every result returned by the local node remain untrusted until schema, provenance, policy, and evidence validation succeed.

The Maritime-to-node channel must be mutually authenticated, encrypted, replay-protected, schema-bounded, and revocable when implemented. Node identity and authorization are scoped to the assigned user, connector, exact configured saved-search URL, and manifest version. A registered node is not trusted to broaden policy or authorize external effects.

Untrusted inputs include:

- listing text, HTML, URLs, images, and attachments;
- email bodies, headers, attachments, and landlord replies;
- browser page content and redirects;
- structured feeds and third-party API responses;
- LLM output;
- all local HTTP requests until origin and anti-CSRF checks pass.

Trusted policy inputs are limited to version-controlled schemas, connector manifests, deterministic domain code, explicit local user approvals, Maritime-managed orchestration state, and secrets retrieved through an approved secret-store abstraction. A transport-authenticated local node result is still untrusted content.

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
- SQLite corruption, unauthorized local access, or unsafe concurrent writes.
- Cross-site requests to the localhost application.
- Dependency or build-script compromise.
- Overconfident risk labels causing harmful user decisions.

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

OAuth tokens are accessed only through TokenStore. The default non-test implementation uses the operating system credential store. A developer file store, if ever added, must be explicitly labeled insecure, live outside the repository, use owner-only permissions, and be impossible to select in production mode.

Configuration files may contain public OAuth client metadata only when the provider treats it as non-secret. Refresh tokens, client secrets, and test-account details remain local and uncommitted.

Maritime's secret manager stores only secrets required by approved hosted API and email connectors. Consumer-site passwords, browser cookies, local storage, session exports, password-manager values, authorization headers, and OpenClaw profile contents never enter Maritime.

Vera exposes no third-party password form, password API parameter, `credentialLogin` capability, automated password-typing path, credential-replay mechanism, or session-export upload. The user signs in manually inside the dedicated local OpenClaw profile. Vera never asks for, records, types, uploads, or transmits that password. Login, reauthentication, 2FA, CAPTCHA, and consent remain manual blockers rather than automatable job steps.

## OAuth controls

- Use authorization code with PKCE and a cryptographically random state value.
- Bind the callback to the initiating local session and enforce one-time state use and short expiry.
- Use an exact loopback redirect URI and bind the web server to 127.0.0.1, not all interfaces.
- Request scopes incrementally: Gmail read for alert ingestion, Gmail compose only when draft creation is enabled, and owned-calendar event access only when holds are enabled.
- Store read, compose, and calendar grants separately so disconnecting one capability does not retain another.
- Revoke and remove tokens when a connector is disconnected or the local store is reset.
- Redact authorization codes, tokens, provider error bodies, and query strings from logs.

The Gmail compose scope can authorize both draft creation and sending. Provider scope alone cannot enforce Vera's draft-only promise. Defense in depth therefore requires:

- no send capability in domain schemas or manifests;
- no send method in the Gmail adapter;
- no generic authenticated Gmail client exposed to domain code;
- no send route, worker job, UI action, or test helper;
- an outbound-operation allowlist containing drafts.create but not drafts.send or messages.send;
- contract and static tests that fail if a send endpoint or operation appears.

## Local application boundary

- Bind local web and callback servers to 127.0.0.1 by default.
- Reject unexpected Host and Origin headers.
- Use same-site cookies and an anti-CSRF token for state-changing routes.
- Set a restrictive Content Security Policy and deny framing.
- Disable permissive CORS.
- Do not expose the worker over HTTP.
- Do not rely on “single user” as authentication against other local websites or processes.
- Never run Next.js route handlers requiring SQLite or credentials in an Edge runtime.

## URL and network safety

Manual capture performs no URL retrieval. A URL is inert provenance text.

The current manual URL validator is a pure parser. It permits only trimmed HTTP(S) values and rejects credentials, fragments, explicit ports, localhost, private or IP-literal hosts, malformed hostnames, and oversized values. Known-source classification requires an exact domain or subdomain boundary, so suffix spoofs remain `other`. Unknown public domains may be stored as inert provenance but are explicitly marked as requiring a future manual browser-policy decision.

External connectors call only exact HTTPS API origins declared in an enabled manifest. Redirects are rejected unless the final origin is independently allowed. Network clients enforce response-size and time limits and never access file URLs, Unix sockets, localhost, link-local addresses, or private address space unless a future local-only capability explicitly requires and documents it.

Remote image downloads are not part of the MVP. Photo hashes are computed only from sanitized or user-supplied bytes already in the capture.

## Browser safety

Local browser acquisition is a first-class but narrow MVP capability. The target `SourceConnector` vocabulary is exactly `official_api`, `email_alert`, `local_browser`, and `user_capture`; OpenClaw is the default replaceable adapter for `local_browser`. The source-policy states are exactly `approved`, `user_triggered_only`, `experimental_personal`, and `disabled`. Missing or malformed policy always denies.

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

Craigslist uses official search-alert `email_alert` ingestion initially; Craigslist `local_browser` monitoring is `disabled`. Zillow and Facebook Marketplace `local_browser` monitoring are `experimental_personal` and disabled by default. Their direct `user_capture` paths remain available, and supplied URLs remain inert unless a separate authorized operation occurs.

No browser password, cookie, authorization header, local-storage value, session export, password-manager value, or profile content may appear in a Maritime dispatch, node result, log, audit event, support bundle, or cloud backup.

## Local-node dispatch and offline safety

Maritime sends only an opaque job and correlation ID, connector and manifest identifiers, the exact configured saved-search URL and identifier, the last committed cursor, trigger and attempt metadata, and bounded page, record, byte, duration, and concurrency limits. It never sends a consumer-site credential or session artifact. The node returns only schema-bounded listing evidence, discovered source IDs, cursor candidates, typed blocker or failure codes, and safe operational counts.

Dispatch and result envelopes require a stable idempotency key, nonce or equivalent anti-replay binding, short validity window, authenticated node and orchestrator identity, integrity protection, and strict size limits. Registration and transport credentials must be independently revocable and rotated without exporting the browser profile. Results from a stale, revoked, wrong-user, wrong-connector, wrong-manifest, wrong-saved-search, or replayed dispatch deny and do not affect a cursor.

If the assigned local node is offline or unreachable after policy authorization, the job enters visible `deferred_local_node_offline`. This state:

- is shown in the dashboard and Maritime health view with connector, opaque node ID, reason code, deferred time, and next eligible retry;
- preserves the same stable job identity and last committed cursor;
- creates no RawListing, success event, or successful-empty result;
- appends only a redacted deferral event;
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

## AI and untrusted-content controls

Listing and message content is data, never instruction. Provider prompts delimit supplied evidence as untrusted quoted content and explicitly reject embedded instructions to reveal secrets, browse, use tools, run commands, contact anyone, change policy, or populate extra fields. The Responses request exposes no tools and receives no OAuth token, browser cookie, local path, raw audit history, policy registry, unrelated mailbox content, or unrelated listing.

Deterministic extraction runs first. The model receives only the unresolved field names and their reason codes; it cannot overwrite a known structured or rule-backed value. Structured output is schema-validated and then checked deterministically for requested-field membership, verbatim evidence, minimum confidence, exact contacts, explicit money currency/billing, recurring-fee separation, justified availability dates, and species-specific pet evidence. After one failed complete repair attempt, processing stops visibly. There is no permissive parser or guessed fallback. AI output cannot authorize actions, change connector policy, mark a hard constraint satisfied, create a canonical listing, infer protected traits, or declare fraud.

The official OpenAI transport sets `store: false`, exposes no tools, disables SDK retries, uses caller cancellation, and enforces a bounded timeout. Model selection comes only from `VERA_LLM_MODEL`; no default model is embedded. Both key and model absent means deterministic-only. Partial configuration fails visibly. Tests use the deterministic no-network mock only when explicitly injected; production never substitutes it.

Provider data-retention settings, contractual handling, and regional processing requirements must be reviewed before real personal data is sent to a live provider. Live extraction is disabled by default and should be exercised only with sanitized or operator-approved non-sensitive content until that review is complete. Automated tests make no live call unless the separate live-test flag, API key, and model are all present.

## Data at rest and retention

- Store the SQLite database in the operating system's per-user application-data directory with owner-only permissions.
- Enable foreign keys, WAL, and a bounded busy timeout.
- Do not use a network filesystem.
- Keep raw listing evidence, structured extraction runs, and activity events immutable through database triggers.
- Keep message bodies, tokens, email addresses, phone numbers, and unnecessary contact data out of audit payloads.
- Hash exact approved payloads with a domain-separated cryptographic hash; a hash proves binding but is not a substitute for redaction.
- Make backups opt-in and document that they may contain personal rental-search data.

Immutability applies while the local store exists. The user retains a separate, confirmed “reset Vera” operation that closes processes, revokes/removes connector tokens, and deletes the entire local database. Selective evidence deletion is not an MVP workflow because it would make provenance and audit semantics misleading.

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

Record lifecycle events separately instead of updating a pending row. Raw provider payloads belong in their protected evidence tables, not the activity log.

For capture ingestion, the persisted event chain is requested, policy authorized/denied, capture completed/failed, and normalization completed/failed. Successful normalization metadata is restricted to opaque IDs, extraction mode, provider/model when applicable, prompt/extraction versions, requested-field count, known/unknown counts, token counts, latency, and repair count. Failure metadata contains only safe error code/category, retryability, and resulting state. Pasted text, prompts, raw model output, evidence snippets, provider request/response bodies, full provenance URLs, API keys, and contact values remain outside logs and audit metadata.

## Idempotency and side-effect safety

- Every import, job, draft, calendar event, and notification has a stable idempotency key.
- Browser dispatch retries retain the same logical job identity; a discovered source ID imports once.
- A cursor advances only after its corresponding raw evidence is durably accepted and never on policy denial, manual blocker, transport failure, layout/schema failure, or `deferred_local_node_offline`.
- Approval is single-use, expires after 15 minutes, and is invalid after any payload change.
- Provider calls occur only after policy authorization is persisted.
- Retries distinguish unknown outcome from confirmed failure.
- A provider lookup or deterministic ID resolves ambiguous outcomes before retrying a create.
- Calendar events contain no attendees or conference data and set sendUpdates=none.

## Database integrity

Raw evidence, extraction, and audit tables reject update and delete statements through migrations. Ingestion and canonicalization use transactions, but network or AI calls never hold a transaction open. A successful normalization atomically commits the source record, complete field provenance, immutable extraction run, redacted event, and job completion. Provider failure writes no partial source/extraction rows. Repository tests verify foreign keys, unique idempotency constraints, immutable triggers, lease recovery, and rollback behavior.

The SQLite job queue supports one worker. Starting a second worker must fail visibly or remain unsupported until a concurrency design is reviewed.

## Dependency and build hygiene

- Pin the package-manager version and commit the lockfile during scaffolding.
- Use Node 24 LTS in development and CI.
- Review install scripts and minimize native dependencies; better-sqlite3 is the intentional native dependency.
- Run audit tooling as advisory evidence, not an automatic unsafe upgrade mechanism.
- Keep generated migrations under review.
- Do not install Maritime, browser, or cloud SDKs before their implementation milestone, exact capability review, and dependency review are approved.

## Security acceptance checks

Before a milestone is accepted:

- no secret, token, cookie, browser profile, or real personal fixture appears in the diff or Git history;
- default configuration starts with all external connectors disabled;
- malformed or missing policy denies;
- unknown acquisition modes or policy states deny, and scheduled execution cannot bypass `user_triggered_only` or disabled `experimental_personal` entries;
- manual capture makes no network request;
- dispatch and result schemas reject passwords, cookies, authorization headers, local storage, session exports, password-manager values, and OpenClaw profile content;
- the Maritime/local-node channel is mutually authenticated, encrypted, replay-protected, bounded, and revocable;
- an offline node produces visible `deferred_local_node_offline`, creates no RawListing or success event, and preserves the stable job identity and committed cursor;
- browser navigation cannot escape the exact configured saved-search and newly discovered same-source detail scope;
- cursor rollback, replay, premature advance, and duplicate import tests fail closed;
- Craigslist `local_browser` monitoring denies; Zillow and Facebook Marketplace remain disabled `experimental_personal` browser entries until explicit enablement, while `user_capture` remains available;
- no autonomous message, broad-crawl, password handling, credential-login, session-export, or account-login path exists;
- prompt-injection fixtures cannot broaden an action;
- the default worker, tests, migration, seed, and build make no live model request;
- live extraction requires both key and environment-selected model; the live test additionally requires its explicit flag;
- invalid model output receives at most one repair and then fails closed;
- Gmail send operations are absent;
- Calendar payloads with attendees or conferencing are rejected;
- approval mismatch, expiry, reuse, and edit invalidation tests pass;
- raw and audit row mutation is rejected by SQLite;
- logs and activity events are redacted;
- duplicate retries create at most one provider-side effect;
- unit, integration, connector contract, and E2E suites make no live external side effects.

## Residual risks

- A stolen Gmail compose token is provider-capable of sending even though Vera is not.
- First-class browser connectors remain brittle and source-specific; layout changes can defer or fail monitoring until reviewed.
- A local OpenClaw node can be offline, compromised, stale, or unavailable at a scheduled trigger; visible deferral limits silent data loss but cannot guarantee discovery latency.
- A compromised local browser profile can expose consumer-site sessions even though Maritime never stores them.
- A local user or process with filesystem and credential-store access can read Vera's data.
- Risk indicators can be wrong; the UI must preserve evidence and uncertainty.
- Local SQLite is not a multi-host or multi-user database.

These risks are acceptable only within the single-user, Maritime-orchestrated MVP with a user-controlled local browser node. They must be revisited before multi-user expansion, hosted browser profiles, or broader source coverage.
