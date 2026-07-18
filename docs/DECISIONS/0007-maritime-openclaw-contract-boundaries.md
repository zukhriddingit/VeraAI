# ADR 0007: Maritime and OpenClaw contract boundaries

- Status: Accepted
- Date: 2026-07-18

## Context

Vera's Ship Season topology now names Maritime as its primary orchestration environment and OpenClaw as the default local browser execution adapter. The working repository, however, remains a deterministic single-user application with local fixture and user-capture ingestion. Treating architecture direction as if live integrations already existed would make fixtures look like production connectors and could hide offline nodes, manual blockers, or policy denials behind successful empty results.

The source-acquisition lifecycle is also different from the existing normalization queue. Acquisition begins with a policy-checked connector job and may require a local browser node. Normalization begins only after immutable raw evidence has been accepted.

## Decision

Maritime is Vera's primary target control plane. Application code owns a `MaritimeOrchestrator` interface for scheduling a connector job, dispatching it, querying status, retrying safe transient failures, cancelling by policy, and receiving browser-node heartbeats. This milestone supplies only `LocalMockMaritimeOrchestrator`, a deterministic in-memory implementation for contract tests. A future Maritime SDK or HTTP transport must remain behind the interface.

OpenClaw is the default replaceable local browser adapter. Application code owns a provider-neutral `BrowserExecutionProvider` interface for heartbeat, allowlisted navigation, bounded capture, structured outcomes, manual blockers, cancellation, and correlation IDs. This milestone supplies only a deterministic no-network mock. It does not install, launch, authenticate, or automate OpenClaw.

Source acquisition uses a dedicated `SourceJob` lifecycle:

```text
queued
dispatched
running
completed
retryable_failed
permanently_failed
deferred_node_offline
manual_action_required
cancelled_by_policy
```

`SourceJob` and append-only `JobAttempt` records are separate from `NormalizationJob`. An unregistered, offline, stale, or revoked local node produces `deferred_node_offline`; it produces no RawListing or successful result and does not advance a source cursor. Login, reauthentication, 2FA, CAPTCHA, consent, camera, and microphone blockers produce `manual_action_required` and remain manual.

The production connector portfolio has exactly four acquisition modes: `official_api`, `email_alert`, `local_browser`, and `user_capture`. The code-level union additionally contains `fixture`, a test-only mode for sanitized local evidence. A fixture cannot represent or masquerade as a live provider.

Every source manifest independently declares one of `approved`, `user_triggered_only`, `experimental_personal`, or `disabled`, plus `manual` or `scheduled` execution. Policy state is a permission ceiling and execution is a trigger constraint; neither authorizes a request by itself. Connector operations are optional and unsupported operations fail closed.

Job payloads contain minimum control data only and are bound to correlation IDs, payload hashes, and stable idempotency keys. They contain no marketplace credentials, raw passwords, browser cookies or storage, authorization headers, session exports, browser-profile paths, password-manager values, or pasted evidence. All connector and browser output remains untrusted input.

## Supersession scope

This record supersedes only these conflicting clauses in older decisions:

- ADR 0001's statement that cloud deployment is wholly deferred is superseded insofar as Maritime is now the primary target orchestration environment and its application-owned contract is implemented. The current code still has no live Maritime deployment, and ADR 0001's single-user, local-data, loopback, SQLite, OS credential-store, and no-hosted-browser-session decisions remain accepted.
- ADR 0004's statement that browser capture is post-core and manual-only is superseded. Narrow `local_browser` acquisition is first-class MVP architecture and may be scheduled only when an exact manifest permits it. ADR 0004's closed capabilities, inert manual URLs, fail-closed evaluation, disabled-by-default source behavior, and prohibition on send, apply, pay, upload, CAPTCHA bypass, credential login, arbitrary fetch, and arbitrary script behavior remain accepted.

Neither older ADR is superseded as a whole.

## Consequences

- Real Maritime durability, authentication, encryption, replay protection, schedules, SDK/HTTP integration, deployment, and hosted secrets are not implemented or authorized by this record.
- Real OpenClaw installation, profile creation, browser launch, session handling, and source-specific page automation are not implemented or authorized by this record.
- No live `official_api`, `email_alert`, or `local_browser` source connector is enabled. Fixture and manual capture preserve the current no-network deterministic demo.
- Zillow and Facebook Marketplace browser work remains disabled-by-default `experimental_personal`; Craigslist browser searching remains `disabled`.
- Migration `0003_romantic_fantastic_four.sql` adds source jobs, append-only attempts, browser-node health, acquisition mode, and manifest policy state without resetting existing listing data.
- Future live adapters must preserve strict schemas, policy checks, kill switches, idempotency, cursor commit-after-ingestion, manual blockers, and the local credential boundary.

## Alternatives rejected

- **Treat fixture data as `official_api`:** rejected because test evidence must not imply provider access.
- **Reuse `normalization_jobs` for acquisition:** rejected because node health and policy outcomes occur before raw evidence exists.
- **Make every connector implement every operation:** rejected because fake no-op methods can turn unsupported behavior into false success.
- **Couple source connectors directly to OpenClaw or a Maritime SDK:** rejected because both external systems must remain replaceable and testable behind application-owned interfaces.
- **Treat an offline node as an empty successful search:** rejected because it hides missed acquisition and could advance a cursor incorrectly.

## Revisit when

Revisit the adapter details only after one exact source and saved-search contract has current policy review, live Maritime node registration and transport controls pass acceptance tests, and a dedicated user-controlled OpenClaw profile can execute without credentials leaving the local boundary. The safety invariants and separation of source jobs from normalization jobs require a new ADR to change.
