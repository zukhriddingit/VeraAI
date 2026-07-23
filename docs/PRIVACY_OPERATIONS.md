# Privacy operations

Status: founder-release runbook
Reviewed: 2026-07-22

This document describes the data Vera actually handles. It is an operator runbook, not a claim that a local browser session makes the entire capture local. The founder release has one founder account, one Vera web instance, one Vera worker, one managed PostgreSQL database, one existing Maritime-hosted OpenClaw gateway, and one explicitly paired local browser node/profile.

## Data inventory and location

| Data | Where it originates | Transit | Persisted location | Default handling |
| --- | --- | --- | --- | --- |
| Vera identity and session state | Vera web | Browser to Vera over HTTPS | PostgreSQL | Server session cookie is secure, HTTP-only, and SameSite=Lax in production. No access token is stored in browser persistent storage. |
| Search profile, shortlist state, and listing decisions | Vera user | Browser to Vera over HTTPS | PostgreSQL | Tenant-owned. Money is integer minor units; persisted instants are `timestamptz`. |
| Listing source evidence and provenance | Fixture, user capture, Gmail alert, approved API, or browser capture | Connector to Vera worker | PostgreSQL | Raw evidence, source records, provenance, and activity history are append-only. Contact data is excluded from normal logs and audit metadata. |
| Marketplace password, cookie, local/session storage, profile, and password-manager data | Dedicated user-controlled browser profile | Must remain on the local node | Local machine only | Vera never asks for, types, uploads, stores, logs, or backs up these artifacts. Manual login, reauthentication, 2FA, CAPTCHA, and consent remain manual. |
| Current-tab capture content | Exact allowlisted tab in the local profile | Local node through the configured OpenClaw gateway to the Vera worker | Accepted minimal listing evidence in PostgreSQL | The bounded result may include title, exact canonical URL, listing text, a small scalar metadata map, and hashes. It excludes screenshots, snapshots, tab lists, cookies, storage, profile paths, and CDP credentials. Page content therefore is not purely local. |
| Google connection | Google OAuth web flow | Browser redirects; server-to-Google code/token exchange | PostgreSQL | Account subject, display email, scopes, status, expiry metadata, and AES-256-GCM-encrypted refresh token only. Authorization codes and access tokens are not durable. |
| Gmail alert state | Google Gmail API | Gmail to worker over HTTPS | PostgreSQL | Narrow sender/subject/label query state, last successful history marker, external message ID, and content/idempotency hashes. Full mailbox messages are not stored as OAuth state or audit data. |
| Calendar availability | Google free/busy API | Calendar to Vera web/worker over HTTPS | PostgreSQL | Only primary-calendar check provenance, interval count/hash, state, time, and rule provenance. Raw busy intervals and event details are not persisted. |
| Jobs, attempts, policy, approvals, leases, and audit | Vera | Web/worker and PostgreSQL | PostgreSQL | Tenant-owned canonical state. Maritime execution status is evidence, not the source of truth. Payload hashes and opaque IDs replace sensitive payloads where possible. |
| Maritime wake data | Vera worker/web | Vera to Maritime API | Maritime control plane | Minimum deployment/agent identifier only. No OAuth token, browser secret, listing/page content, or snapshot belongs in a wake payload. |
| Notification subscription and delivery | User browser and Vera worker | Browser/Vera to Web Push provider | PostgreSQL plus provider transit | Endpoint and key material are encrypted in PostgreSQL. Lock-screen text is generic by default; delivery is idempotent and tenant-owned. |
| Application logs and metrics | Web, worker, PostgreSQL client, adapters | Runtime to configured logging/monitoring service | Hosted logging/monitoring service | Recursive sanitizer removes secret keys, contacts, bearer values, query strings, and bounded nested content. Metrics use a closed label vocabulary and never user, listing, source, URL, or error-text labels. |
| Backups | Managed PostgreSQL | Managed provider snapshot/export path | Managed backup service or encrypted operator storage | Treat as private production data even when application credentials are encrypted. Never place dumps in Git, tickets, chat, or ordinary artifact storage. |

The OpenClaw gateway is a transit boundary, not a credential vault. Its exact hosted log, diagnostic, and service-retention settings must be verified against the existing Maritime deployment before founder beta. Until verified, use sanitized capture fixtures for staging evidence and do not claim that page content is never retained by the platform.

## Retention and cleanup

Vera distinguishes durable evidence from disposable control state:

- Durable listing evidence, field provenance, score/risk inputs, job attempts, approvals, Calendar check provenance, capture acceptances, and activity events are retained for the founder account until a reviewed owner-deletion operation. Append-only means normal repositories cannot rewrite or silently erase history; it does not prohibit a separately authorized privacy deletion.
- Expired Gmail OAuth state older than 24 hours is deleted in bounded batches.
- Expired Maritime dispatches are moved to the terminal `expired` state; their safe dispatch evidence is retained.
- Service heartbeats expired for more than 7 days are deleted in bounded batches.
- Terminal production-schedule runs completed more than 30 days ago are deleted in bounded batches.
- Expired notification leases are reclaimable; a crashed worker cannot strand a delivery indefinitely.
- Cleanup uses one bounded PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`; it never deletes raw listings, source records, provenance, canonical listings, extractions, approvals, source jobs/attempts, or activity events.

Founder-release targets are 14 days for sanitized application logs and 30 daily managed database backups. These are operator targets, not application-enforced guarantees. The configured Maritime/log provider retention and managed PostgreSQL backup retention must be inspected and recorded during live staging. A longer provider setting is a release finding, not permission to describe the shorter target as active.

## Founder data export

There is no self-service export endpoint in this founder release. An operator export is allowed only for the exact authenticated founder UUID:

1. Verify the requester and record a sanitized change reference, exact owner UUID, environment, and time. Do not use display email as the ownership key.
2. Pause the user's production schedules and browser controls so the export has a stable cutoff. Do not disable or delete another tenant's records.
3. Export tenant-owned records through reviewed, owner-predicated repository queries or a reviewed transaction. Include schema/version, UTC cutoff, safe record counts, and hashes in a manifest.
4. Exclude session secrets, OAuth ciphertext, Web Push key material, database credentials, dispatch nonces, gateway credentials, provider response bodies, logs, and internal security controls. Include human-readable Google connection metadata without usable tokens.
5. Encrypt the export outside the repository, deliver it through an approved channel, verify receipt, and delete the operator copy under the recorded retention window.
6. Resume only the controls the user explicitly wants resumed.

Do not run a broad database dump as a user export. Do not expose another user's data to prove completeness.

## Founder deletion, disconnect, and revocation

There is no self-service account-deletion endpoint. A privacy deletion is a separately approved maintenance operation, not a normal repository mutation and not an excuse to weaken append-only enforcement.

1. Verify the exact founder UUID twice and obtain a fresh, explicit approval naming the production environment and deletion scope.
2. Enable global/per-user kill switches, stop user schedules, cancel safe queued work by policy, and revoke the paired browser node/profile authorization. Local browser-profile deletion remains a user-controlled local action.
3. For Google, acquire the same database-backed integration refresh lease used by refresh. Attempt provider revocation first, then delete Vera's encrypted refresh-token material regardless of provider response. Record only the safe outcome and manual Google-account recovery link if revocation is unconfirmed.
4. Remove Web Push subscriptions and revoke provider-side notification credentials where supported.
5. Produce a pre-delete manifest containing only owner-scoped counts and hashes. A second operator or delayed re-verification must confirm the UUID and scope before execution.
6. Run a reviewed, owner-predicated privacy-deletion transaction that follows the actual foreign-key graph. Preserve only data that law or an approved security incident hold requires, document the reason and duration, and never anonymize by inventing replacement facts.
7. Verify all tenant tables return zero for the owner, active sessions fail, no schedule or job can run, credentials cannot decrypt, and no provider grant remains usable. Record safe counts and correlation IDs, never deleted content.
8. Expire primary managed data immediately. Backup copies age out under the verified backup schedule and must not be restored into active service without reapplying the deletion before traffic is enabled.

The absence of self-service export/deletion is accepted only for the single-founder release. It blocks a multi-user beta until the workflow and backup-erasure behavior are implemented and rehearsed.

## Provider outage behavior

- PostgreSQL unavailable: `/api/health` may remain live, `/api/ready` fails, writes stop, and Vera does not fall back to SQLite or memory.
- Maritime unavailable: canonical jobs remain queued in PostgreSQL. Only safe wake/status operations retry; the web process does not invent a second scheduler.
- OpenClaw gateway unavailable or restarting: the job remains retryable/deferred and never becomes an empty capture.
- Browser node stale/offline: state is `deferred_local_node_offline`; no RawListing or success event is created and no source cursor advances.
- Google revoked/expired: connection becomes reconnect-required. Gmail failure is not an empty mailbox; Calendar failure is not a conflict-free interval.
- Notification provider unavailable: delivery remains idempotently queued/retryable and may move to digest; it is not recorded as delivered.
- Logging/metrics unavailable: product work must not block on telemetry, but the outage is operationally visible and the runtime must not buffer unbounded payloads.

## Credential or privacy incident

1. Activate the narrowest kill switch; use the global browser/integration/schedule/notification switches for uncertain scope.
2. Stop new dispatch and provider work while preserving canonical PostgreSQL and sanitized audit evidence.
3. Revoke the affected Google grant, Maritime credential, OpenClaw gateway token/node pairing, Web Push subscription, session, or encryption key.
4. Rotate through protected operator tooling. Never paste raw secrets, browser artifacts, page snapshots, database URLs, or provider payloads into chat or tickets.
5. Preserve source commit, image/config digests, safe correlation IDs, hashes, affected time range, and provider audit references.
6. If an application-encryption key is affected, block decrypting flows, introduce a new key ID, re-encrypt through a separately reviewed procedure, verify every envelope, and retain the old key until no row references it.
7. Restore service only after ownership, policy, replay, configuration, and credential checks pass. Apply any approved user deletion to a restored backup before opening traffic.

## Required operational alerts

Alert on fixed-cardinality metrics and readiness state, never on user IDs, listing IDs, URLs, source names, or raw error text:

- readiness not ready for two consecutive checks or five minutes;
- expected worker or gateway heartbeat stale for more than two minutes;
- oldest runnable job older than ten minutes;
- any permanent/dead-letter job;
- three provider-auth, provider-rate-limit, OAuth, or notification failures within fifteen minutes;
- any browser manual-action surge above the founder's expected single active flow;
- any PostgreSQL pool waiter sustained for five minutes or three connection failures within five minutes;
- cleanup not completed within 24 hours;
- managed backup, restore rehearsal, migration, or rollback validation failure immediately.

Thresholds are founder-release starting points. Tune them only from sanitized aggregate evidence and record the change.

## Release evidence still required

Before founder beta, record without secrets:

- actual managed PostgreSQL backup retention and one provider restore rehearsal;
- runtime versus migration database roles and grants;
- actual Maritime log/diagnostic retention;
- existing Maritime/OpenClaw deployment and immutable version identities;
- least-privilege OpenClaw tool/node/profile configuration;
- sanitized positive and failure-path staging results;
- verified Web Push provider behavior, or keep production push disabled.
