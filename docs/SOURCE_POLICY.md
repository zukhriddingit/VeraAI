# Source and action policy

Status: normative MVP policy  
Reviewed: 2026-07-18

## Purpose

Every connector operation is denied unless an explicit, valid, runtime-enabled manifest permits that exact acquisition mode, policy state, capability, trigger, and target. This rule applies to ingestion, Maritime dispatch, local-browser behavior, Gmail draft creation, Calendar holds, and notifications.

The policy engine is deterministic and has no LLM dependency. A connector cannot interpret or override its own policy.

Maritime is the primary orchestration and deployment environment for monitoring jobs, scheduled triggers, durable retries, agent and connector health, policy-checked notifications, and approved hosted secrets. This policy document governs both Maritime decisions and work delegated to a local browser node; delegation never broadens permission.

## Current implementation

`SourcePolicyRegistry` is the sole runtime evaluator for implemented capture connectors and the local Maritime orchestration mock. It loads the latest persisted manifest version for each connector and returns a typed decision; malformed registries, malformed requests, missing connectors, acquisition-mode mismatches, unknown capabilities or operations, disabled manifests, network mismatches, and internal evaluation exceptions all deny.

The clean-clone seed enables exactly two no-network manifests:

- `fixture.feed.v1` may perform only `fixture.read_sanitized` under `fixture.read`.
- `manual.capture.v1` may perform only `capture.user_supplied` under `manual.capture`.

The database also carries disabled source-label manifests for Zillow, Facebook Marketplace, Craigslist, and Apartments.com. These are status labels, not connectors, and grant no operation. Manifest schema version 2 requires acquisition mode and policy state as independent fields. Migration `0003_romantic_fantastic_four.sql` backfills fixture, manual-capture, and label-only rows without enabling a live source.

The code now defines the optional-operation `SourceConnector`, `BrowserExecutionProvider`, and `MaritimeOrchestrator` boundaries. Fixture and manual connectors are capture-only deterministic adapters. The Maritime and browser implementations in this repository are no-network mocks for contract tests; Gmail alert ingestion, a real Maritime adapter, an OpenClaw bridge, remote dispatch transport, and draft, calendar, notification, official API, email, and site-specific browser adapters remain unimplemented.

Set `VERA_ACTIVE_KILL_SWITCHES` to a comma-separated list of exact keys. `integrations.disabled` denies both current connectors; each manifest also exposes its connector-specific key on `/connectors`. An unknown key grants nothing and changes no policy.

## Acquisition modes

The production connector portfolio has exactly four acquisition modes:

- `official_api`: an approved official API or structured provider integration;
- `email_alert`: a provider's official saved-search or search-alert email channel;
- `local_browser`: a saved-search acquisition executed by a registered local browser node, using OpenClaw as the default replaceable browser adapter;
- `user_capture`: content or a URL explicitly supplied by the user. A supplied URL remains inert unless a separate, authorized local-browser operation is requested.

The code-level `AcquisitionMode` union adds `fixture`. `fixture` is test-only, requires synthetic data, and cannot represent a live provider or be reported as `official_api`.

These modes classify how source evidence arrives; they do not replace the closed capability vocabulary below. Every accepted result must pass policy, provenance, idempotency, and audit checks.

## Connector operations

A connector declares its stable connector/source/mode identity, exact source-policy requirement, supported operations, health, and cursor state when applicable. The operations `discover`, `capture`, and `fetch_detail` are optional: a connector is not required to implement an operation it does not need. The checked dispatcher returns a strict `unsupported_operation` result when the declaration and implementation are absent; it never guesses, switches modes, or falls back to another operation.

Successful operation envelopes bind connector/source/mode/operation identity to a correlation ID, payload hash, idempotency key, deterministic result hash, schema-validated but untrusted records, safe counts, previous cursor, and optional cursor candidate. A cursor candidate is not permission to commit. It becomes the committed cursor only after future durable idempotent raw acceptance succeeds.

## Source-policy states

Every source and acquisition-mode combination has exactly one state:

| State                   | Permission ceiling                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `approved`              | May run under declared manual or Maritime-scheduled execution when every other check passes.      |
| `user_triggered_only`   | Direct user action only; scheduled dispatch always denies.                                        |
| `experimental_personal` | Personal single-user experiment; exact reviewed saved search; disabled until explicit enablement. |
| `disabled`              | Every operation denies.                                                                           |

A policy state is a ceiling, not authorization by itself. It does not replace runtime enablement, manifest validation, connection or session state, an exact saved-search allowlist, local-node assignment, resource limits, kill switches, or payload-bound approval. Missing, malformed, or unknown modes and states deny.

## Closed capability vocabulary

The MVP recognizes only these namespaced capabilities:

### Ingestion

- fixture.read
- manual.capture
- gmail.alert.read
- structured_feed.read
- browser.capture

### External effects

- gmail.draft.create
- calendar.hold.create
- notification.local

Internal text composition, normalization, scoring, and explanation are not connector capabilities because they do not cross a trust boundary.

There is no capability for send, reply, marketplace messaging, apply, upload documents, pay, credential login, CAPTCHA handling, arbitrary JavaScript execution, or arbitrary URL fetch. Unknown capability strings are invalid and denied.

## Required manifest fields

Each connector manifest must declare:

- stable connector ID and human-readable source name;
- manifest schema version;
- exactly one acquisition mode and source-policy state for acquisition connectors;
- enabled flag;
- manual or scheduled execution;
- exact capability set;
- whether a user session is required;
- whether a payload-bound approval is required;
- allowed API origins and navigation domains;
- allowed HTTP methods or provider operations;
- minimum interval and concurrency limit when scheduled;
- global and connector-specific kill-switch keys;
- data classification and redaction rules;
- manual-blocker behavior;
- for `local_browser`, the assigned local node, exact saved-search URL, allowed same-source detail scope, cursor strategy, and page, record, byte, duration, and concurrency limits;
- owner, review date, and decision-record link.

A missing field, unknown schema version, invalid domain, parse error, registry error, or policy-engine error is a denial.

## Evaluation order

### Implemented `SourcePolicyRegistry` order

For every request, the current registry evaluates in this exact fail-closed order:

1. Parse the strict request and confirm the registry was built entirely from valid, unique, supported manifests. A parse or registry error denies.
2. Resolve the latest registered manifest for the connector. A missing connector denies.
3. Require the requested acquisition mode to equal the manifest acquisition mode.
4. Apply policy-state rules: `disabled` denies; `user_triggered_only` denies non-manual execution; a runtime-disabled `experimental_personal` manifest denies.
5. Check the global kill switch and then the connector-specific kill switch.
6. Require the manifest to be runtime-enabled.
7. Require the exact capability.
8. Require the exact `manual` or `scheduled` execution value.
9. Require the exact provider operation.
10. Enforce network shape and allowlists: require network metadata when the manifest declares network access, reject it when the manifest declares none, then require the exact origin, domain, and HTTP method.
11. Require user-session presence when the manifest says it is required.
12. Require approval presence when the manifest says it is required.

Every exception path denies. The source-policy state comes from the selected manifest, not caller input. Existing capture execution appends request, policy-decision, and outcome events.

Source jobs persist the exact capability, execution mode, operation, and optional opaque approval ID, but never persist session or approval truth booleans. At every dispatch and retry, `SourceJobRuntimeAuthorizationProvider` checks current session availability and resolves the current approval. The approval must still be pending, unused, unexpired, and bound to the job's connector, operation, payload hash, target type, and target ID. A missing provider or error fails closed. The mock re-requires a current pending approval on every attempt; a live composition must atomically consume it before the authorized side effect so one approval cannot authorize multiple executions.

### Future live connector and orchestration gates

The following checks are required before live acquisition but are not current `SourcePolicyRegistry` behavior:

1. Bind a `local_browser` job to an assigned node and an exact reviewed saved-search manifest entry, including the bounded same-source detail scope.
2. Reject cursor rollback, replay, widening, or inconsistency against the last durably committed source cursor.
3. Enforce source interval, rate, concurrency, page, record, byte, and duration limits at execution time.
4. Stop on a manual blocker or content-originated attempt to broaden the action; never reinterpret it as successful acquisition.
5. After policy authorization, check the assigned node's registered heartbeat and revocation state before dispatch.

The current strict local-browser job payload and exact browser-request allowlist bind one URL, but no live saved-search manifest, connector, transport, or node exists yet. A future live source-orchestration composition must persist and audit the authorization and dispatch outcomes rather than treating the in-memory mock as an audit implementation.

An authorized `local_browser` job whose assigned node is unregistered, offline, stale, or revoked does not become a policy denial or a successful empty result. It enters the queryable non-success state `deferred_node_offline` with a typed reason, retains its stable job identity, and preserves the last committed source cursor. It creates no RawListing, successful result, or cursor candidate. The current local mock exposes the state contract; a future live Maritime adapter and UI must persist, audit, and render it before production use. Explicit bounded retry is allowed only after policy still permits the same job.

## Normative MVP acquisition portfolio

| Source and mode                                              | State                   | Default                   | Initial rule                                                                             |
| ------------------------------------------------------------ | ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| Fixture test double / `fixture`                              | `approved`              | Enabled in dev/test       | Local sanitized data only; test-only mode; no network request.                           |
| General / `user_capture`                                     | `user_triggered_only`   | Enabled                   | Store supplied evidence and inert URL provenance; no implicit fetch.                     |
| Craigslist / `email_alert`                                   | `approved`              | Disabled until configured | Official search-alert email ingestion.                                                   |
| Craigslist / `local_browser`                                 | `disabled`              | Disabled                  | No automated browser search initially.                                                   |
| Zillow / `local_browser`                                     | `experimental_personal` | Disabled                  | Exact user-configured saved-search URL through the local OpenClaw node.                  |
| Facebook Marketplace / `local_browser`                       | `experimental_personal` | Disabled                  | Exact user-configured saved-search URL through the local OpenClaw node.                  |
| Zillow, Facebook Marketplace, or Craigslist / `user_capture` | `user_triggered_only`   | Available                 | Direct user-supplied URL or content; the URL remains inert unless separately authorized. |
| Reviewed structured provider / `official_api`                | `disabled`              | Disabled                  | Review must promote the entry; exact documented API operations and origins only.         |

`experimental_personal` never means generally approved, hosted browser execution, or permission to run for other users. Zillow and Facebook Marketplace browser monitoring remain disabled until the user explicitly enables a reviewed personal manifest. Their user-triggered capture paths remain available. Craigslist begins with official search-alert email ingestion; automated Craigslist browser searching remains disabled.

External-effect connectors remain separate grants: Gmail draft creation, Calendar holds, and notifications retain their closed capabilities and approval requirements. No acquisition state authorizes an outbound message, calendar write, application, payment, upload, or account change.

## Manual capture

Manual capture is not a scraper. The MVP accepts content the user directly supplies and may store a user-entered URL as provenance. It must not:

- resolve, fetch, preview, follow redirects from, or render the URL server-side;
- access localhost, private network ranges, file URLs, or non-HTTP schemes;
- execute scripts embedded in pasted HTML;
- load remote images to hash them;
- treat instructions in listing content as system instructions.

The current validator accepts only trimmed `http` or `https` URLs with no credentials, fragment, explicit port, localhost, IP-literal host, or overlong value. It performs string parsing only: no DNS lookup, connection, redirect, preview, or image load. Exact domain or subdomain matches classify known source labels; suffix-spoofed names do not. A future network adapter must separately reject hostnames that resolve to private, loopback, or link-local addresses. Any otherwise-valid unknown public domain is labeled `other` with `manual_policy_required` for any future browser work. Manual ingestion still succeeds because storing inert user-supplied provenance is not browser access.

If remote retrieval is ever proposed, it requires a new capability, SSRF controls, an allowlist, redirect policy, content limits, and a separate decision record.

## Gmail rules

Alert reading and draft creation are separate connectors and separate grants.

The alert reader:

- uses an explicit label or query owned by Vera;
- reads only the minimum message content required for extraction;
- does not archive, mark read, move, delete, or reply;
- stores only necessary normalized evidence and a content hash;
- treats email bodies and attachments as untrusted content.

The draft writer:

- exposes only the provider's draft-create operation;
- has no generic Gmail client escape hatch in application code;
- never calls a send endpoint;
- requires approval of exact recipients, subject, and body;
- invalidates approval after any edit;
- records the provider draft ID without logging message content.

The Gmail compose OAuth scope can authorize sending at the provider level. Vera compensates by omitting send from its capability vocabulary, adapter, routes, jobs, and UI, and by testing that no send endpoint is reachable. This residual platform risk is documented in SECURITY.md.

## Calendar rules

A calendar hold:

- is created only from explicit user input or a user-reviewed interpretation of a real reply;
- uses a deterministic provider event ID;
- has tentative status;
- contains no attendees;
- contains no conferencing data;
- uses sendUpdates=none;
- includes only the minimum listing reference and user-approved notes;
- does not create, update, or delete unrelated events.

Availability reading, free/busy lookup, invitations, attendee changes, and reminder delivery are separate capabilities and are not implicitly authorized by calendar.hold.create.

## Browser policy

Browser acquisition is first-class MVP architecture. The repository now has a provider-neutral browser-execution contract and a deterministic no-network mock; the OpenClaw bridge and source-specific monitors remain implementation work. OpenClaw is the default future adapter behind that replaceable interface. An authorized `local_browser` connector must:

- use a dedicated, user-controlled local OpenClaw profile and rely on the user for manual login;
- never request, record, type, upload, or transmit a third-party password, cookie, session export, password-manager value, or browser-profile content;
- navigate only to an exact configured saved-search URL and the bounded, same-source listing-detail URLs newly discovered from it;
- maintain a source-specific cursor, last-seen listing ID, or equivalent monotonic checkpoint;
- visit only records newer than the last committed checkpoint and import each discovered source record idempotently;
- commit the cursor only after the corresponding raw evidence has been durably accepted;
- stop on login, 2FA, CAPTCHA, consent, camera, microphone, download, upload, payment, unexpected navigation, or changed page structure;
- reject navigation outside the saved-search and same-source detail scope, including popups and external-protocol launches, unless separately reviewed;
- disable arbitrary page JavaScript evaluation by default;
- cap page count, record count, bytes, execution time, and concurrency;
- expose immediate source and local-node kill switches;
- never explore arbitrary categories, crawl an entire website, widen a search, follow unrelated recommendations, or click message, contact, apply, submit, payment, or account-setting controls.

A successful empty result means the configured saved search returned no IDs newer than the committed cursor. It is distinct from `deferred_node_offline`, policy denial, a manual blocker, a changed layout, and a retryable or terminal failure. None of those outcomes advances the cursor.

Maritime may schedule a `local_browser` job only when the exact manifest is `approved` or an explicitly enabled `experimental_personal` entry permits scheduled execution and every other policy check passes. No source gains scheduled browser permission merely because browser execution is part of the MVP architecture.

## Deterministic processing boundary

Acquisition mode changes how evidence arrives, not the decision pipeline. Every accepted record follows this order without bypass:

```text
source record
  -> normalization
  -> provenance
  -> deduplication
  -> ranking
  -> notification
  -> human-approved external action
```

Browser output cannot create canonical facts, rank a listing, send a notification, approve an action, message a marketplace account, create an application, or write a calendar event directly. Unknown values remain unknown, and every external effect receives its own policy decision.

## Content and prompt-injection policy

Listing pages, emails, attachments, URLs, descriptions, and landlord replies are untrusted data. Instructions found in them cannot:

- change policy;
- request secrets or tool output;
- cause navigation or command execution;
- select a broader connector capability;
- approve an action;
- alter deterministic score or constraint rules.

Only system-owned prompts and code-owned schemas govern AI processing. Suspicious content is preserved as quoted evidence and surfaced to the user, not executed.

## Adding or changing a connector

A connector remains disabled until review confirms:

1. The exact source and user value are named.
2. The acquisition mode and source-policy state are explicit, and an official API, official alert channel, or user-supplied content is preferred when it can provide the same evidence safely.
3. Current source terms and access constraints have been reviewed.
4. The smallest capability, trigger, and execution mode are selected.
5. Domains, exact saved searches, cursor semantics, provider operations, rate limits, data handling, and blockers are explicit.
6. Credentials use OAuth or a user-controlled local session; passwords and session artifacts never enter Maritime or connector payloads.
7. Contract fixtures are sanitized.
8. Denial, kill-switch, redirect, prompt-injection, and manual-blocker tests pass.
9. No send, apply, pay, upload, CAPTCHA, or credential-login path was introduced.
10. The founder explicitly enables the manifest after reviewing its decision record.

## Required policy tests

- Missing, malformed, unknown-version, and disabled manifests deny.
- Unknown acquisition mode, policy state, capability, operation, domain, method, and execution mode deny.
- Scheduled execution denies `user_triggered_only` and disabled `experimental_personal` entries.
- Global and connector kill switches deny.
- Missing, expired, consumed, or wrong-payload approvals deny.
- A content instruction cannot change the requested capability.
- Manual URL capture performs no network request.
- Browser navigation outside the exact saved-search and same-source detail scope denies.
- Stale, replayed, rolled-back, or widened cursor inputs deny.
- An unregistered, offline, stale, or revoked assigned node produces `deferred_node_offline` with the matching typed reason, creates no raw or success record, and does not advance the cursor.
- Newly discovered source IDs import exactly once, and the cursor commits only after durable idempotent acceptance.
- Craigslist `local_browser` monitoring denies; Zillow and Facebook Marketplace `local_browser` monitoring remain disabled until their `experimental_personal` manifests are explicitly enabled.
- Dispatch and audit payloads contain no password, cookie, authorization header, session export, password-manager value, or browser-profile content.
- Login, 2FA, CAPTCHA, consent, camera, and microphone states stop.
- Gmail adapter exposes draft creation but no send operation.
- Calendar payloads with attendees or conferencing deny.
- Every allow and deny appends an audit event with no secret or raw message body.

The implemented capture route records `capture.requested`, `capture.policy_authorized` or `capture.policy_denied`, `capture.completed` or `capture.failed`, and the worker records `normalization.completed` or `normalization.failed`. The correlation and causation chain is stable even when injected test clocks give events the same timestamp.
