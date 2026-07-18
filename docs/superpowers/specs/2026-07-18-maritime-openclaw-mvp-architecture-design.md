# Maritime and OpenClaw MVP Architecture Correction

Status: Approved design  
Date: 2026-07-18

## Purpose

This decision corrects Vera's earlier local-only architecture direction. Maritime is the primary orchestration and deployment environment for the Ship Season MVP. OpenClaw is the default browser execution adapter when an approved source requires browser interaction. Browser acquisition is therefore a first-class MVP capability, but it remains narrow, replaceable, source-policy-gated, and subordinate to the same deterministic Vera pipeline as API, email, and user-capture inputs.

This correction changes architecture and policy documentation. It does not implement Maritime infrastructure, browser automation, autonomous messaging, or account-login automation in the current codebase.

## Decision summary

1. Maritime owns monitoring schedules, durable job state, scheduled triggers, retries, agent health, notifications, and hosted secrets.
2. A Maritime-hosted orchestrator dispatches browser acquisition jobs to a registered local browser node.
3. The local node uses OpenClaw by default behind a replaceable browser-executor interface.
4. Authenticated consumer-site sessions, cookies, and browser-profile contents remain on the user's local machine by default.
5. The user signs in manually. Vera never asks for, records, types, uploads, or transmits a third-party password.
6. An unavailable local browser node produces a visible `deferred_local_node_offline` job state. The job is neither recorded as successful nor silently dropped.
7. Browser connectors are bound to configured saved-search URLs and source-specific cursors. They do not crawl an entire site.
8. Craigslist starts with official search-alert email ingestion. Automated Craigslist browser search is disabled.
9. Facebook Marketplace and Zillow browser monitoring are `experimental_personal` and disabled by default. User-triggered capture remains available.
10. Every acquired record enters the same deterministic pipeline before any notification or human-approved external action.

## Architecture

### Control plane

Maritime is Vera's primary orchestration control plane. It owns:

- monitoring schedules and trigger definitions;
- durable job identity, state, attempt history, and idempotency keys;
- bounded retry and backoff decisions;
- agent and connector health;
- visible deferred, failed, and dead-letter outcomes;
- notification dispatch after deterministic ranking and policy evaluation;
- hosted integration secrets for approved official APIs and email connectors;
- audit metadata for dispatch and orchestration outcomes.

Maritime does not own consumer-site passwords, OpenClaw profile contents, browser cookies, or authenticated session artifacts. Those remain in the local browser node's user-controlled profile.

### Local browser execution node

The local node is a separately registered execution target. It owns:

- a dedicated user-controlled OpenClaw browser profile;
- the authenticated browser session created by manual user login;
- exact allowlisted saved-search URLs assigned to that node;
- browser navigation and bounded capture under source policy;
- local detection of manual blockers and unexpected navigation;
- returning bounded listing evidence and cursor candidates through an authenticated transport.

OpenClaw is the default adapter, not the connector contract itself. A later adapter can replace OpenClaw if it implements the same browser-executor interface and passes the same source-policy and contract tests.

### Dispatch boundary

For a browser job, Maritime sends only the minimum control data:

- opaque job and correlation IDs;
- connector ID and policy-manifest version;
- exact configured saved-search URL identifier and URL;
- prior committed source cursor or last-seen listing ID;
- bounded page, record, byte, and time limits;
- trigger type and attempt metadata.

Maritime never sends credentials to the node and the node never returns cookies, authorization headers, local profile paths, stored passwords, or session exports. The node returns schema-bounded listing evidence, discovered source IDs, cursor candidates, typed blocker/failure codes, and safe operational counts. Transport must be authenticated and encrypted when implemented.

### Offline and deferred behavior

Node availability is an expected state, not an exceptional success path. If Maritime cannot reach the assigned local node:

1. the job enters `deferred_local_node_offline`;
2. the UI and agent-health view show the connector, node, reason, deferred time, and next eligible retry;
3. no source cursor advances;
4. no RawListing or success event is created;
5. the deferral does not masquerade as an empty source result;
6. Maritime applies bounded retry policy without creating duplicate jobs;
7. the user can bring the node online or explicitly cancel the job.

A later dispatch succeeds using the same stable job identity and last committed cursor.

## SourceConnector abstraction

The target connector boundary supports exactly four acquisition modes:

```ts
type AcquisitionMode = "official_api" | "email_alert" | "local_browser" | "user_capture";

interface SourceConnector {
  readonly connectorId: string;
  readonly acquisitionMode: AcquisitionMode;
  discover(input: ConnectorDiscoveryInput): Promise<ConnectorDiscoveryResult>;
  acquire(input: ConnectorAcquireInput): Promise<RawListingEnvelope[]>;
}
```

The documentation will define the behavioral contract rather than claim this TypeScript interface is already implemented. Every mode produces the same validated raw-listing envelope and may not bypass source policy, provenance, idempotency, or audit.

- `official_api`: an approved official API or structured provider integration.
- `email_alert`: a provider's official saved-search/search-alert email channel.
- `local_browser`: saved-search acquisition executed by the registered local browser node.
- `user_capture`: content or a URL explicitly supplied by the user; a URL remains inert unless an allowed local-browser operation is separately requested.

## Source-policy states

Every source/mode combination has exactly one policy state:

| State                   | Meaning                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approved`              | The declared mode may run manually or on an approved Maritime schedule when its manifest, connection, and runtime enablement all pass.                        |
| `user_triggered_only`   | The mode may run only from an explicit user action and can never be invoked by a scheduled trigger.                                                           |
| `experimental_personal` | The mode is restricted to the single user's personal experiment, requires an exact reviewed saved search and explicit enablement, and is disabled by default. |
| `disabled`              | Every operation is denied.                                                                                                                                    |

Policy state is a ceiling, not sufficient authorization. Runtime enablement, a supported manifest version, exact capability, saved-search allowlist, node assignment, session availability, limits, kill switches, and any required approval must also pass. Missing or malformed state denies.

## Browser acquisition rules

A `local_browser` connector must:

- navigate only to exact configured saved-search URLs and necessary same-source listing detail URLs discovered from that saved search;
- maintain a source-specific cursor, last-seen listing ID, or equivalent monotonic checkpoint;
- visit only records newer than the last committed checkpoint;
- commit a cursor only after the corresponding raw evidence is durably accepted idempotently;
- cap pages, records, bytes, duration, and concurrency;
- stop on login, 2FA, CAPTCHA, consent, camera, microphone, download, upload, payment, unexpected navigation, or changed page structure;
- never explore arbitrary category pages, enumerate an entire site, follow unrelated recommendations, or widen a search automatically;
- never click message, contact, apply, submit, payment, or account-setting controls;
- preserve a visible source and node kill switch.

An empty successful result means the configured saved search produced no new IDs after the committed cursor. It must be distinguishable from node offline, manual blocker, layout change, policy denial, and transient failure.

## Initial source portfolio

| Source                                    | Acquisition mode | Policy state            | Default runtime                               | Initial rule                                                                            |
| ----------------------------------------- | ---------------- | ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sanitized fixtures                        | `official_api`   | `approved`              | Enabled for development/test                  | Contract test double with local sanitized records and no network access.                |
| General manual capture                    | `user_capture`   | `user_triggered_only`   | Enabled                                       | Store supplied evidence and inert URL provenance; no implicit fetch.                    |
| Craigslist                                | `email_alert`    | `approved`              | Disabled until email connector setup succeeds | Use official search-alert email ingestion; browser search remains `disabled`.           |
| Zillow monitoring                         | `local_browser`  | `experimental_personal` | Disabled                                      | Exact user-configured saved search through local OpenClaw only.                         |
| Facebook Marketplace monitoring           | `local_browser`  | `experimental_personal` | Disabled                                      | Exact user-configured saved search through local OpenClaw only.                         |
| Zillow/Facebook/Craigslist direct capture | `user_capture`   | `user_triggered_only`   | Available                                     | User supplies URL/content; URL is inert unless a separately allowed capture is invoked. |
| Approved structured provider              | `official_api`   | `disabled`              | Disabled                                      | Review must move it to `approved`; exact documented API operations and origins only.    |

`experimental_personal` never means generally approved, hosted browser execution, or permission to run for other users.

## Deterministic pipeline

Acquisition mode changes how evidence arrives, not how Vera decides what to do with it. The invariant pipeline remains:

```text
source record
  -> normalization
  -> field provenance
  -> deduplication
  -> deterministic ranking
  -> policy-checked notification
  -> human-approved external action
```

Each stage has a stable idempotency boundary and typed failure state. Browser output cannot directly create notifications, messages, calendar events, approvals, ranking outcomes, or canonical facts. Unknown values remain unknown. Model output remains subordinate to schemas and deterministic evidence checks.

## Security and privacy

- Users authenticate to consumer sites only inside the local OpenClaw profile.
- Vera does not render a password field, accept a password API parameter, read password-manager values, or expose a credential-login capability.
- Browser profiles, cookies, local storage, session exports, and authorization headers stay off Maritime.
- Maritime's secret store contains only hosted/API integration secrets explicitly approved for Maritime-managed connectors.
- Captured listing evidence is minimized to the connector contract; arbitrary browsing history and unrelated page/account data are excluded.
- Listing content remains untrusted data and cannot broaden navigation or policy.
- Dispatch/result transport is authenticated, encrypted, bounded, and replay-protected when implemented.
- The local node must be revocable, health-visible, and kill-switchable.
- Autonomous messages, marketplace contact, applications, payments, and account changes remain absent.

## Current-state honesty

The current repository implements fixture and user-capture connectors, local SQLite job processing, deterministic-first extraction, and fail-closed policy evaluation. It does not yet implement Maritime orchestration, an OpenClaw bridge, email-alert acquisition, remote dispatch, or the four-mode connector contract.

The corrected documents must distinguish:

- **implemented now:** fixture/user capture, local evidence pipeline, current job worker;
- **normative MVP architecture:** Maritime orchestration, local OpenClaw execution, connector modes, policy states, cursor semantics, and visible deferral;
- **still prohibited:** autonomous messaging, password handling, account-login automation, broad crawling, and source-wide scraping.

## Documentation changes

The correction will update:

- `docs/PRODUCT.md`: make browser acquisition and Maritime orchestration part of the MVP boundary; retain explicit non-goals and safety invariants.
- `docs/ARCHITECTURE.md`: replace the local-only target with the Maritime/local-node topology, dispatch/deferred behavior, connector modes, and deterministic pipeline.
- `docs/SOURCE_POLICY.md`: define acquisition modes, the four policy states, saved-search/cursor rules, and the initial source matrix.
- `docs/SECURITY.md`: define the cloud/local trust boundary, secret split, node authentication, password prohibition, manual blockers, and offline semantics.
- `AGENTS.md`: remove contributor instructions that call Maritime optional or OpenClaw post-core.
- `VERA_BUILD_PLAN.md`: promote Maritime and OpenClaw into MVP architecture and adjust source tiers/milestones without claiming implementation.

No application code, dependency, migration, credential, or live connector is added by this documentation correction.

## Acceptance criteria

The correction is complete only when:

1. all six authoritative files state Maritime is the primary orchestration/deployment environment for the listed responsibilities;
2. all six files treat local OpenClaw browser execution as first-class MVP architecture and a replaceable adapter;
3. local session/password rules and cloud/local secret ownership are unambiguous;
4. an offline node has a visible, cursor-preserving deferred state;
5. the four acquisition modes and four source-policy states are defined exactly;
6. saved-search-only discovery, source cursors, and new-record-only visits are normative;
7. Craigslist email-alert-first and Zillow/Facebook experimental-disabled defaults are explicit;
8. the deterministic pipeline order is preserved;
9. autonomous messaging, account-login automation, broad crawling, and password collection remain prohibited;
10. current implementation status is not overstated;
11. formatting and contradiction scans pass.
