# ADR 0011: Maritime production execution and notification plane

Status: accepted

Date: 2026-07-22

## Context

ADR 0009 made PostgreSQL the only hosted database, and ADR 0010 introduced one founder-only OpenClaw current-tab capture. Vera still needed a production execution owner, durable dispatch bridge, approved schedules, health reconciliation, and a renter notification channel without moving canonical state or local browser secrets into the platform.

Current Maritime documentation supports Docker-image deployment, agent wake/status/log APIs, dashboard-managed triggers, and CLI trigger inspection. The current Maritime OpenClaw guide still advertises OpenClaw `2026.5.28`, while Vera's security review requires the patched official `2026.6.33` release.

## Decision

Maritime is the primary hosted worker and scheduling plane. The founder topology is one hosted Vera web application, one managed PostgreSQL database, one Maritime Vera worker, one pinned Maritime OpenClaw gateway, one explicitly paired founder-controlled browser node/profile, and one region. There is no horizontal scaling requirement.

PostgreSQL remains canonical for users, policy, jobs, dispatch attempts, leases, schedules, approvals, results, notification delivery, and audit history. A server-only `maritime-sdk@0.5.0` adapter wakes the worker with its agent identifier only. Before wake, Vera persists an expiring, replay-protected dispatch containing issuer, audience, nonce hash, payload hash, job reference, and no listing/page data. The worker atomically consumes an accepted dispatch and claims the tenant-owned job.

Maritime cron triggers wake the worker every five minutes. Trigger creation uses the supported Maritime dashboard; the CLI validates with `maritime triggers vera-worker`. PostgreSQL schedule rows decide what is due. Gmail alert ingestion, deterministic reconciliation, stale checks, notification fan-out, health reconciliation, and cleanup may be scheduled only while their current policy permits. Public-source browser work remains unscheduled and user-triggered.

OpenClaw gateway and node compatibility is pinned to `2026.6.33`; the reviewed gateway image is
`ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee`.
The founder's existing Maritime OpenClaw agent is inventoried and reconciled rather than duplicated.
The gateway routes only to an explicitly selected node/profile. Marketplace passwords, cookies,
local storage, profiles, and full snapshots remain local and are prohibited in Maritime/PostgreSQL
payloads and logs.

Web Push is the founder production notification channel. Subscriptions are application-encrypted before PostgreSQL persistence. Eligibility is deterministic: enabled preference, profile threshold, hard constraints, freshness, duplicate suppression, and risk ceiling. Lock-screen text is fixed and omits address, price, description, contact, and risk evidence. Quiet hours and per-hour limits defer delivery; idempotency is per canonical listing and subscription.

The worker exposes `/health` for liveness and `/ready` for PostgreSQL readiness. Operator-only status/retry/cancel controls require an exact Vera user allowlist and recheck policy. Ordinary renters cannot access the operations view.

## Invocation security

Vera uses authenticated outbound Maritime SDK invocation rather than an inbound job webhook. No sensitive value appears in a wake URL. The stored dispatch validates issuer, exact worker audience, job ownership, expiry, unique nonce hash, payload hash, current policy, and replay status. Maritime execution state is evidence, never authority over Vera domain state.

## Consequences

- The web and worker require separate narrow Maritime runtime configuration; operator deploy credentials remain separate.
- A Maritime outage leaves jobs visibly queued/deferred and retryable instead of producing empty success.
- Multiple dispatch attempts may exist for one job; each has a globally unique nonce hash and only one accepted attempt can be atomically consumed with the job.
- The default suite uses mocks and makes no Maritime, OpenClaw, Google, or Web Push request.
- Demo mode remains isolated behind `@vera/db/demo` and cannot import Maritime production composition.
- Current Maritime trigger creation is a documented dashboard step, not a fabricated repository configuration.
- The always-on founder gateway has an explicit cost and patch-management obligation.

## Supersession

This record supersedes ADR 0007 where it says real Maritime durability, SDK integration, schedules, deployment assets, and hosted notification behavior are absent. It supersedes ADR 0010's OpenClaw `2026.5.28` version pin and its statement that Maritime deployment assets are not authorized. All prior prohibitions on crawling, automated login, blocker bypass, sending, applying, payments, and browser-session persistence remain in force.

## Rejected alternatives

- **Make Maritime the job database:** rejected because tenant ownership, policy, approvals, replay checks, results, and audit must remain transactionally consistent in Vera/PostgreSQL.
- **Invoke an unauthenticated webhook carrying work:** rejected because URLs and platform wake events cannot authorize tenant jobs.
- **Run a second cron loop in the web process:** rejected because Maritime owns production wake scheduling.
- **Deploy the currently documented OpenClaw template pin:** rejected because it is below Vera's reviewed security floor.
- **Use Gmail as an outbound notification transport:** rejected because Gmail authorization is narrow and user mailbox access is not a notification channel.
- **Schedule Zillow browser capture:** rejected because the current source contract is manual, founder-only, and disabled by default.

## Review triggers

Re-review before changing the Maritime SDK/API, OpenClaw version or command surface, trigger topology, notification provider, gateway exposure, tenant count, region count, worker concurrency, or browser scheduling policy.
