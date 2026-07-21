# OpenClaw Current-Tab Capture Bridge Design

Status: approved for implementation
Date: 2026-07-21
Scope: founder-only, user-triggered capture of an already-open exact Zillow listing page through a paired local OpenClaw node

## Goal

Add the smallest production-shaped browser acquisition path that proves Vera can accept one real, user-authorized listing page without turning the product into a crawler or autonomous browser agent. An authenticated founder manually opens an exact Zillow listing in a dedicated local OpenClaw profile, explicitly confirms the capture, and Vera sends a bounded current-tab snapshot request through the pinned OpenClaw gateway/node interface. A successful, validated result enters the existing immutable ingestion, normalization, provenance, deduplication, scoring, risk, and audit pipeline.

The capability is an unsupported personal experiment, not a production-supported Zillow connector.

## Classification and non-goals

The first live browser source is fixed as:

- source: `zillow`;
- acquisition mode: `local_browser`;
- policy state: `experimental_personal`;
- trigger mode: `user_triggered_only`;
- enabled: `false` by default;
- support status: `unsupported_experimental`;
- capabilities: `read` and `capture` only;
- user session: required;
- exact approval: required;
- discovery and schedules: prohibited.

This milestone does not add saved-search monitoring, pagination, result-page crawling, automatic navigation, neighboring-listing capture, scheduled jobs, Maritime deployment, a hosted browser profile, login automation, blocker bypass, Gmail, landlord communication, Calendar changes, Facebook Marketplace, or Craigslist browser automation. It exposes no compose, send, contact, form-submit, apply, pay, upload, download, account-settings, arbitrary-script, filesystem, or shell capability.

## Repository reconciliation

The implementation builds on the current repository rather than historical milestone wording:

- `@vera/db` is the PostgreSQL hosted boundary; `@vera/db/demo` is the explicit deterministic SQLite adapter.
- Hosted repository contracts are asynchronous and tenant-scoped. PostgreSQL ownership and composite foreign keys are the authority for private records.
- Better Auth supplies hosted identity and request-scoped user ownership.
- Google integration authorization starts in Settings, stores encrypted refresh-token material through PostgreSQL, requests incremental Calendar scopes, and visibly falls back to Vera-only availability. Gmail alert ingestion and Gmail draft creation remain absent despite older planning assumptions and are not blockers for browser capture.
- Domain contracts already define source jobs, attempts, browser execution, node health, policy outcomes, manual action, deferred-node behavior, and a mock Maritime control plane.
- The existing worker does not yet execute acquisition jobs, and the mock orchestrator does not durably accept captured evidence into raw ingestion. This milestone supplies that missing path instead of creating parallel job or provider hierarchies.
- ADR 0002 is historical for hosted persistence and is superseded by ADR 0009 there; it remains relevant only to the explicit demo/offline composition root.
- Maritime remains the documented hosted execution plane, but this milestone uses a local control-plane composition and does not deploy Maritime.

## Selected OpenClaw interface

Pin and test OpenClaw `2026.5.28`, matching the version in Maritime's standard OpenClaw template. Do not use `latest`, the separate Maritime OpenClaw Browser template, unpublished `@openclaw/gateway-client` or `@openclaw/gateway-protocol` packages, or a speculative WebSocket implementation.

The real adapter invokes the official capability-focused CLI seam:

```text
openclaw nodes invoke
  --node <selected-node>
  --command browser.proxy
  --params <validated-json>
  --idempotency-key <stable-key>
  --invoke-timeout <bounded-ms>
  --json
```

The executable path is configured and version-checked at application startup; the adapter never installs or upgrades OpenClaw. Arguments are built as a constant array and never passed through a shell. Gateway URL and token are server-side environment inputs (`OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`) inherited by the child process, not interpolated into logs or command-line arguments. The adapter strips its environment to an explicit allowlist.

The only allowed `browser.proxy` operations for capture are:

1. `GET /tabs` for the one allowlisted profile, to identify the active/current tab without returning unrelated tab data to persistence;
2. `GET /snapshot` for the selected target ID and same allowlisted profile, using the AI/text snapshot format with bounded node/output limits.

No `/navigate`, `/tabs/open`, click, type, evaluate, cookie, storage, upload, download, dialog, profile-create, or profile-delete request is exposed. OpenClaw's node-side `nodeHost.browserProxy.allowProfiles` is required and must contain only the dedicated Vera profile(s). Vera enforces the same profile allowlist independently.

This choice preserves explicit node selection and native OpenClaw idempotency. Gateway-global browser routing is rejected because it could choose a different user's node. A custom Vera WebSocket daemon and raw remote CDP are rejected because they widen the attack surface and duplicate a supported OpenClaw capability.

Official references used for the pinned contract:

- [Maritime OpenClaw template](https://maritime.sh/docs/frameworks/openclaw)
- [OpenClaw 2026.5.28 release](https://github.com/openclaw/openclaw/releases/tag/v2026.5.28)
- [2026.5.28 node CLI](https://github.com/openclaw/openclaw/blob/v2026.5.28/docs/cli/node.md)
- [2026.5.28 nodes CLI](https://github.com/openclaw/openclaw/blob/v2026.5.28/docs/cli/nodes.md)
- [2026.5.28 browser tool and proxy](https://github.com/openclaw/openclaw/blob/v2026.5.28/docs/tools/browser.md)
- [2026.5.28 gateway pairing](https://github.com/openclaw/openclaw/blob/v2026.5.28/docs/gateway/pairing.md)

## Application boundaries

### Domain and policy

Extend existing schemas rather than add competing concepts:

- `SourceJob` gains a current-tab capture payload variant containing tenant-bound source, selected browser-node record ID, safe profile identifier, user-approved expected URL, expected canonical URL, correlation ID, and payload hash. It contains no page evidence or credential material.
- `SourceJobResult` gains a strict capture-result reference and acceptance status sufficient to reject mismatched, replayed, or cross-user results.
- `BrowserNodeStatus` gains pairing, command-capability, profile, version, compatibility, last-successful-capture, and disabled state.
- `ManualActionRequired` uses one closed blocker vocabulary for login, 2FA, CAPTCHA, consent, bot/rate challenge, redirect/URL mismatch, stale target, layout, unsupported page, unavailable profile, pairing, approval, node health, version, download/upload, camera/microphone, policy uncertainty, and generic user intervention.
- The source manifest declares the exact Zillow host/page pattern and `read`/`capture` ceiling. Missing, disabled, ambiguous, or incompatible manifests deny.

Execution capability remains separate from policy state. Possessing `browser.proxy` never authorizes a job; it only means the selected node can execute a request that has independently passed tenant, source, approval, kill-switch, URL, profile, and freshness checks.

### OpenClaw adapter

`OpenClawBrowserExecutionProvider` implements the existing `BrowserExecutionProvider`. OpenClaw-specific CLI output and request shapes stay in `packages/connectors`; domain, policy, worker, and web code do not import OpenClaw types.

The provider receives already-validated requests, repeats narrow schema validation, invokes only the fixed operations, enforces byte/time bounds, parses every CLI response as untrusted JSON, and returns a provider-neutral structured result. It supports cancellation by terminating only the child process associated with the correlation ID. It never kills a node or browser.

### Worker and durable acceptance

The PostgreSQL worker gains a separate acquisition loop alongside normalization and decision work. It transactionally claims one eligible source job with `FOR UPDATE SKIP LOCKED`, returns immediately to tenant scope, and performs no network or CLI work inside a database transaction.

The application service sequence is:

```text
claim job
  -> tenant ownership and current policy
  -> global/user/source/node/profile kill switches
  -> node pairing, capability, version, and heartbeat
  -> active tab lookup
  -> HTTPS/host/exact URL validation
  -> bounded snapshot capture
  -> blocker and content validation
  -> durable result acceptance transaction
  -> immutable RawListing import
  -> normalization enqueue
  -> append-only audit
  -> job completed
```

The job remains `running` after a successful OpenClaw invocation until result acceptance and raw ingestion commit. A CLI exit alone is never success.

The result-acceptance transaction validates tenant ID, job ID, attempt ID, correlation ID, payload hash, invocation idempotency key, selected node/profile, canonical URL, and content hash. It inserts an immutable acceptance record, RawListing, normalization job, and bounded audit facts idempotently. Uniqueness prevents a worker restart after invocation from duplicating RawListing or ActivityEvent rows. If persistence fails, the claimed job is recoverable and the same invocation/acceptance keys are reused.

## Current-tab and URL rules

The user supplies and approves an expected exact Zillow listing URL before job creation. The server normalizes it without fetching it:

- scheme must be `https:`;
- username, password, fragment, non-default port, shortened URL, and non-allowlisted hostname are rejected;
- the path must match the reviewed Zillow listing-detail pattern;
- known tracking parameters are removed; unknown or security-sensitive query parameters are rejected;
- canonical equivalence may differ only by the documented normalization rules;
- the active tab's normalized URL must equal the approved canonical URL;
- login, auth, ad, redirect, recommendation, search-result, and account pages never qualify.

`GET /tabs` is used only to select the active tab. The provider returns no other tab URL/title in a result or log. If OpenClaw 2026.5.28 cannot identify an unambiguous active tab for the selected profile, the adapter returns `user_intervention_required`; it does not guess among tabs.

Any cross-origin redirect, unexpected host, or active-URL mismatch returns a typed manual-action state and produces no RawListing. Current-tab capture performs no navigation.

## Browser node, profile, and control persistence

Use one additive PostgreSQL migration; preserve current rows and demo fixtures. Extend the tenant-owned node record with:

- OpenClaw node ID and safe display name;
- pairing state;
- `browser.proxy` capability-approval state;
- selected safe profile identifier and allowlisted profile identifiers;
- reported and expected OpenClaw versions;
- compatibility state;
- last heartbeat and last successful capture;
- disabled timestamp/status;
- created and updated timestamps.

Add narrow tenant-owned browser-control state for the persisted user kill switch and per-profile disable state. The existing global/source policy store remains the authority for global and per-source kill switches. A node or profile lookup always requires the authenticated Vera user ID. Database constraints prevent a job from referencing another tenant's node.

Do not store browser profile paths, cookies, storage, headers, CDP endpoints, gateway credentials, screenshots, or raw snapshots in these records.

SQLite changes are limited to deterministic demo compatibility. The demo composition never instantiates the real OpenClaw provider, registers a live node, stores gateway secrets, or makes a network/CLI call.

## Node states and offline behavior

Pairing, capability approval, version compatibility, and liveness are independent states. The founder UI maps them to:

- not configured;
- pairing required;
- capability approval required;
- online and ready;
- offline;
- manual login required;
- blocked by CAPTCHA/2FA/consent;
- version incompatible;
- disabled by policy.

A missing, explicitly disabled, offline, or stale node becomes `deferred_node_offline`/the repository's existing equivalent and cannot create RawListing, advance a cursor, or emit success. Pairing or capability approval pending becomes `manual_action_required`, not a retry loop. Heartbeat freshness is configurable with a conservative default and evaluated against an injected clock.

## Manual blockers

The closed blocker set is:

```text
login_required
two_factor_required
captcha_required
consent_required
rate_or_bot_challenge
unexpected_redirect
active_url_mismatch
stale_snapshot
layout_incompatible
unsupported_page
browser_profile_unavailable
node_pairing_required
capability_approval_required
node_offline
version_incompatible
download_or_upload_requested
camera_or_microphone_requested
policy_uncertain
user_intervention_required
```

Blocker detection is deterministic and evidence-minimal. The adapter stops; it never dismisses, solves, retries around, or asks an LLM to bypass one. Manual-action records store only the blocker code, safe recovery action, correlation ID, and time—not page text or screenshots.

## Evidence and extraction boundary

All page output is untrusted data. The capture envelope is bounded and schema-validated before ingestion. It may contain only:

- validated active and canonical URL;
- bounded page title;
- bounded rendered listing text required for extraction;
- a small allowlisted projection of structured listing metadata when present;
- already-supported image URLs or hashes;
- capture timestamp;
- safe node/profile identifiers;
- extraction provenance and content hash.

The adapter discards unrelated tabs, full browsing history, account pages, messages, cookies, storage, headers, downloads, and screenshots. Raw full-page snapshots are held only in process memory for validation/extraction and are not persisted indefinitely. The immutable RawListing contains the minimal accepted capture envelope under explicit size limits and the existing retention policy.

Deterministic extraction treats page text only as listing content. Instructions in that content cannot change the selected user, node, profile, URL, policy, commands, tools, secrets, audit behavior, or action permissions. No model or page content can cause another browser request.

## Idempotency and replay defense

At minimum, identity binds:

- tenant ID;
- source job ID;
- attempt ID;
- browser invocation idempotency key;
- job payload hash;
- canonical URL;
- capture content hash.

Job creation uses a stable key for the authenticated user, selected node/profile, canonical URL, and explicit capture confirmation. Invocation and acceptance keys are derived separately so a restart can safely determine which phase finished. PostgreSQL uniqueness makes result acceptance, RawListing creation, normalization enqueue, and corresponding activity events idempotent.

Results are rejected when stale, replayed for a different job, owned by another tenant, signed/bound to a different payload hash, returned by a different node/profile, or associated with a URL other than the approved canonical URL.

## Kill switches and execution-time authorization

Four persisted/runtime controls are checked at job creation and again immediately before invoking OpenClaw:

1. system-wide browser kill switch;
2. per-user browser kill switch;
3. per-source kill switch/manifest enabled state;
4. per-node and per-profile disable state.

Any denial transitions the job to `cancelled_by_policy`, records a redacted audit event, and performs no browser call. A source manifest cannot be enabled merely by possessing a node. The experimental Zillow manifest is disabled by default in every environment; founder enablement is explicit and user scoped.

## Founder UI

Add `/settings/integrations/browser-agent` beneath the authenticated Settings shell. Initial reads remain server components; explicit enable/disable, node/profile selection, capture confirmation, and visible request feedback are client interactions.

The view shows:

- unsupported experimental warning and source policy state;
- pairing and capability-approval status;
- node health and last heartbeat;
- selected allowlisted profile;
- reported/expected OpenClaw version and compatibility;
- last successful capture;
- global/user/source/node/profile kill-switch status;
- current, deferred, and manual-action jobs;
- a successful canonical-listing link.

`Capture current tab` requires an expected exact Zillow URL and an explicit confirmation that the user opened the intended listing, wants the visible page captured, understands the experiment, and understands Vera will not message, apply, submit, pay, or contact anyone. The action does not claim that user authorization overrides Zillow's platform terms.

Pairing and capability approvals remain operator setup steps in OpenClaw's supported flow. Vera displays exact recovery instructions but does not approve its own node permissions.

## Audit and logging

Append safe events for job creation, policy approval/denial, node selection, claim/dispatch, current-tab lookup, URL validation, snapshot completion, deferred offline, manual action, result accepted/rejected, ingestion completed, failure, and policy cancellation.

Audit metadata may include IDs, enum states, timestamps, hashes, safe host/canonical URL, safe node/profile labels, counts, and error codes. It excludes snapshot/text evidence, screenshots, cookies, storage, headers, query secrets, gateway tokens, OpenClaw config, marketplace credentials, email/phone/contact details, and raw provider error bodies.

Structured logs use correlation IDs and the same redaction policy. Child stdout/stderr is parsed through bounded sanitization and is never logged verbatim.

## Failure and recovery model

- policy denial: permanent `cancelled_by_policy`;
- node missing/offline/stale: visible `deferred_node_offline`, retry only after a fresh heartbeat;
- pairing/capability/version/profile/manual blocker: `manual_action_required`, retry only after explicit user recovery;
- timeout/transient gateway failure before an accepted result: `retryable_failed` with bounded attempts and stable invocation identity;
- invalid/mismatched/replayed result: rejected and `permanently_failed` unless the typed reason is safely recoverable;
- CLI success followed by database failure: recover the same attempt and acceptance identity; do not create a new logical capture;
- accepted evidence followed by normalization failure: source job remains completed because immutable acquisition succeeded; the existing normalization job owns its retry lifecycle.

## Tests

The default suite is fully mocked and network-free. It covers:

- provider contract and fixed command surface;
- exact HTTPS host/path/canonical URL and redirect rejection;
- disabled/missing source and global/user/source/node/profile kill switches;
- cross-user node/job/result rejection;
- node/profile not selected or profile not allowlisted;
- offline/stale heartbeat deferral;
- pairing/capability/version/manual blocker states;
- login, 2FA, CAPTCHA, consent, bot/rate challenge, stale snapshot, layout, upload/download, camera/microphone, and policy uncertainty;
- idempotent invocation and result acceptance;
- payload-hash mismatch, replay, and worker restart between invocation and acceptance;
- PostgreSQL uniqueness, tenant isolation, transactional rollback, job claiming, immutable raw import, normalization enqueue, and audit ordering;
- prompt-injection fixtures and output size limits;
- secrets, cookies, storage, headers, and profile paths absent from serialization/logs;
- absence of compose/send/apply/contact/form/payment commands;
- demo adapter isolation;
- successful capture reaching RawListing and normalization.

One opt-in founder smoke test is skipped unless the exact OpenClaw binary, gateway, token, node, profile, approved URL, experimental enablement, and live-test flag are all present. It performs current-tab capture only.

## Compatibility impact

- Existing fixture and manual connectors continue unchanged.
- Existing connector operations remain optional; no connector is forced to implement navigation or discovery.
- Existing source-job states remain stable. Schemas gain additive current-tab, node-readiness, blocker, and acceptance variants.
- Existing browser mock remains the default for tests and demo; it is extended to emulate current-tab lookup and snapshot capture without network access.
- Hosted PostgreSQL receives additive columns/tables and constraints through Drizzle migration; no data reset is permitted.
- The current saved-search-shaped local-browser payload remains parseable only if existing persisted rows require it, but no saved-search job is created or executed by the new UI. It should be deprecated explicitly rather than silently reinterpreted as current-tab capture.

## Privacy boundary

Marketplace authentication state, passwords, cookies, storage, and browser-profile contents remain on the user's machine in the dedicated OpenClaw profile. Vera never requests or types a Zillow password. The minimum page content required to capture the listing can traverse the configured OpenClaw gateway and reach Vera's hosted worker, where it is validated and reduced to a bounded immutable source envelope. That content is therefore not local-only. The UI and setup documentation state this plainly.

The gateway is operator-grade infrastructure. Production transport must be private and authenticated (for example, Maritime-to-user tailnet or WSS with a reviewed trust boundary); no raw CDP endpoint is exposed. Gateway credentials remain server-side and outside PostgreSQL job payloads.

## Acceptance criteria

- A founder can manually authenticate in a dedicated allowlisted local profile, pair and explicitly select the node, enable the experimental source/user controls, approve an exact URL, and capture the already-open current tab.
- The pinned adapter uses only `nodes invoke ... browser.proxy`, the selected node, allowed profile, `/tabs`, and `/snapshot`.
- Exact URL mismatch or off-allowlist origin is rejected.
- Offline/stale node is visible as deferred; pairing, approval, version, login, CAPTCHA, and other blockers are visible manual actions.
- One accepted capture creates one RawListing, one normalization enqueue, idempotent audit history, and ultimately a canonical listing link.
- Repeating or recovering the same logical result creates no duplicate immutable evidence or audit event.
- No message, application, form, payment, contact, Calendar action, automatic login, blocker bypass, navigation, or schedule exists.
- Mock tests pass without OpenClaw, Maritime, browser, or network; lint, typecheck, tests, and build pass.

## Prompt 10 boundary

This milestone leaves Maritime deployment, durable remote gateway configuration, hosted scheduling, production secrets injection, gateway health monitoring, transport certificates/tailnet provisioning, and operational rollout to Prompt 10. It delivers the application-owned contracts, tenant/policy boundaries, pinned OpenClaw adapter, worker execution/acceptance path, founder UI, and test evidence that Prompt 10 can deploy without redesigning acquisition.
