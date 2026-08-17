# Privacy operations

Status: founder-release runbook
Reviewed: 2026-08-16

This document describes the data Vera actually handles. Founder core has no browser Gateway. The
separate browser connectivity spike uses one founder account, one dedicated per-user
Maritime-hosted OpenClaw Gateway, and the official Chrome extension connected directly over WSS.
It has no local OpenClaw installation, node, CLI, daemon, Companion, or Vera agent.

## Data inventory and location

| Data | Where it originates | Transit | Persisted location | Default handling |
| --- | --- | --- | --- | --- |
| Vera identity and session state | Vera web | Browser to Vera over HTTPS | PostgreSQL | Server session cookie is secure, HTTP-only, and SameSite=Lax in production. No access token is stored in browser persistent storage. |
| Search profile, shortlist state, and listing decisions | Vera user | Browser to Vera over HTTPS | PostgreSQL | Tenant-owned. Money is integer minor units; persisted instants are `timestamptz`. |
| Listing source evidence and provenance | Deterministic fixture in the explicit offline demo only; hosted user capture, Gmail alert, approved API, or founder browser capture | Connector to Vera worker | PostgreSQL for hosted data; isolated SQLite for the deterministic demo | Raw evidence, source records, provenance, and activity history are append-only. The hosted connector composition and policy seed exclude fixture acquisition. Contact data is excluded from normal logs and audit metadata. |
| Marketplace password, cookie, local/session storage, profile, and password-manager data | User-controlled Chrome profile | Must remain inside Chrome | Local machine only | Vera never asks for, types, uploads, stores, logs, or backs up these artifacts. Manual login, reauthentication, 2FA, CAPTCHA, and consent remain manual. |
| Browser Connector installation and enrollment | Extension and authenticated Vera settings page | Vera web over HTTPS; one exact WSS enrollment exchange with the assigned Gateway | Raw installation ID and relay credential in Chrome local storage; installation/ticket digests and device state in PostgreSQL; relay credential in the assigned Gateway | The Vera page receives only the installation digest. The raw installation ID transits once in the bounded WSS enrollment frame to the internal checkpoint, where it is digested but not stored or logged. A 256-bit one-time ticket expires within 60 seconds and is stored only as a digest. The durable relay credential is never displayed by Vera. Connecting shares no tab and persists only for that Chrome profile until revocation. |
| Remote-extension consent-tab content | One tab explicitly placed in the OpenClaw tab group | Chrome extension over WSS to the dedicated per-user Gateway; minimized result to Vera | Not accepted as listing evidence; connectivity response is ephemeral | The result contains only page origin, sanitized title, at most 24 bounded accessibility lines, safe counts, UTC capture time, and hashes. Full snapshots, screenshots, tab lists, target IDs, query strings, paths, cookies, storage, profile paths, contacts, and credentials are rejected. |
| Legacy local-node current-tab content | Disabled historical adapter | No authorized founder transport | None in the remote-extension spike | The legacy code remains for regression protection and cannot satisfy a remote-extension phase. |
| Google connection | Google OAuth web flow | Browser redirects; server-to-Google code/token exchange | PostgreSQL | Account subject, display email, scopes, status, expiry metadata, and AES-256-GCM-encrypted refresh token only. Authorization codes and access tokens are not durable. |
| Gmail alert state | Google Gmail API | Gmail to worker over HTTPS | PostgreSQL | Narrow sender/subject/label query state, last successful history marker, external message ID, and content/idempotency hashes. Full mailbox messages are not stored as OAuth state or audit data. |
| Calendar availability | Google free/busy API | Calendar to Vera web/worker over HTTPS | PostgreSQL | Only primary-calendar check provenance, interval count/hash, state, time, and rule provenance. Raw busy intervals and event details are not persisted. |
| Jobs, attempts, policy, approvals, leases, and audit | Vera | Web/worker and PostgreSQL | PostgreSQL | Tenant-owned canonical state. Maritime execution status is evidence, not the source of truth. Payload hashes and opaque IDs replace sensitive payloads where possible. |
| Maritime wake data | Vera worker/web | Vera to Maritime API | Maritime control plane | Minimum deployment/agent identifier only. No OAuth token, browser secret, listing/page content, or snapshot belongs in a wake payload. |
| Notification subscription and delivery | User browser and Vera worker | Browser/Vera to Web Push provider | PostgreSQL plus provider transit | Endpoint and key material are encrypted in PostgreSQL. Lock-screen text is generic by default; delivery is idempotent and tenant-owned. |
| Application logs and metrics | Web, worker, PostgreSQL client, adapters | Runtime to configured logging/monitoring service | Hosted logging/monitoring service | Recursive sanitizer removes secret keys, contacts, bearer values, query strings, and bounded nested content. Metrics use a closed label vocabulary and never user, listing, source, URL, or error-text labels. |
| Backups | Managed PostgreSQL | Managed provider snapshot/export path | Managed backup service or encrypted operator storage | Treat as private production data even when application credentials are encrypted. Never place dumps in Git, tickets, chat, or ordinary artifact storage. |
| Privacy deletion receipts | Authenticated account deletion | Application to PostgreSQL | `privacy_deletion_receipts` plus a separately protected operator ledger | Contains an opaque former-user UUID, an HMAC subject digest, revocation states, and retention dates. It never contains email, provider subject, token, credential, URL, or deleted record content. Private receipt ledgers use mode `0600`, remain gitignored, and are never printed. |

The internet-reachable OpenClaw Gateway is a transit boundary, not a credential vault. Its hosted
log, diagnostic, proxy, and service-retention behavior must be verified against the dedicated
deployment before browser acceptance. Until verified, do not enable the spike or claim that selected
page content is never retained by the platform.

## Retention and cleanup

Vera distinguishes durable evidence from disposable control state:

- Durable listing evidence, field provenance, score/risk inputs, job attempts, approvals, Calendar check provenance, capture acceptances, and activity events are retained for the founder account until a reviewed owner-deletion operation. Append-only means normal repositories cannot rewrite or silently erase history; it does not prohibit a separately authorized privacy deletion.
- Expired Gmail OAuth state older than 24 hours is deleted in bounded batches.
- Expired Maritime dispatches are moved to the terminal `expired` state; their safe dispatch evidence is retained.
- Service heartbeats expired for more than 7 days are deleted in bounded batches.
- Terminal production-schedule runs completed more than 30 days ago are deleted in bounded batches.
- Expired issued Browser Connector tickets are moved to terminal `expired` state in bounded batches;
  consumed ticket evidence is retained without the raw ticket.
- Expired notification leases are reclaimable; a crashed worker cannot strand a delivery indefinitely.
- Account-deletion challenges expire within 15 minutes, are stored only as SHA-256 digests, and are single-use.
- Privacy deletion receipts survive owner deletion. They are retained so a restored backup can be checked before traffic and do not authorize direct mutation of append-only evidence.
- Cleanup uses one bounded PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`; it never deletes raw listings, source records, provenance, canonical listings, extractions, approvals, source jobs/attempts, or activity events.

Founder-release targets are 14 days for sanitized application logs and 30 daily managed database backups. These are operator targets, not application-enforced guarantees. The configured Maritime/log provider retention and managed PostgreSQL backup retention must be inspected and recorded during live staging. A longer provider setting is a release finding, not permission to describe the shorter target as active.

## Authenticated owner export

Signed-in hosted users export their own data from **Settings → Privacy**. The authenticated
`GET /api/settings/privacy/export` route derives the owner only from the server session and runs a
repeatable-read owner-scoped export. It returns one bounded NDJSON attachment with a leading
versioned manifest, per-table counts and SHA-256 hashes, `no-store`, and `nosniff`.

The export includes reviewed user/listing/search/decision/activity records and safe projections of
integration and browser state. It excludes passwords, sessions, OAuth ciphertext, Web Push key
material, database and Gateway credentials, provider subjects, relay/checkpoint material, and
internal security controls. Unknown listing facts remain unknown. Do not run a broad database dump
as a user export and never accept an owner ID from the request.

## Authenticated deletion, disconnect, and revocation

Account deletion is a two-step, owner-derived operation:

1. The signed-in user starts deletion in **Settings → Privacy**.
   `POST /api/settings/privacy/deletion-request` requires the exact configured origin and a bounded,
   strict body. Vera returns one raw 256-bit challenge only to that browser; PostgreSQL stores its
   digest and 15-minute expiry. The raw value stays only in React state and never enters a URL,
   storage, analytics, logs, or an activity event.
2. The user types `DELETE MY VERA ACCOUNT` exactly.
   `DELETE /api/settings/privacy/account` authenticates again, checks the same origin before parsing
   at most 1,024 bytes, derives the owner from the session, and atomically consumes the one-time
   challenge.
3. Vera revokes the user's Browser Gateway assignment and Browser Connector enrollments before
   owner deletion. The page asks the current extension to clear its local relay credential on a
   best-effort basis; if the extension is unreachable, server revocation still prevents future work
   and local removal remains a manual user action.
4. Vera attempts Google provider revocation and always removes its local encrypted Google
   credential. A provider `unconfirmed` result is recorded in the deletion receipt and the owner
   deletion continues; any other pre-delete failure stops before the owner transaction.
5. In one PostgreSQL transaction, Vera locks the consumed challenge and owner, inserts or validates
   the durable receipt, deletes matching non-owner identity rows, deletes the user through the
   reviewed foreign-key graph, and verifies every registered `user_id` table has zero rows.
6. The receipt-gated append-only exception applies only to nested `DELETE` triggers during that
   foreign-key cascade (`pg_trigger_depth() > 1`). Updates and direct deletes remain rejected even
   when a receipt exists. Another owner remains untouched.
7. After commit, Better Auth expires the development `vera.*` or production `__Secure-vera.*`
   session cookies. The response contains only `status` and an opaque receipt ID.

Managed backups do not disappear instantaneously. `backup_erase_after` uses the verified provider
retention interval, and any legal/security hold requires an explicit future date. Keep an encrypted,
mode-`0600` JSON-array ledger of strict deletion receipts outside Git and ordinary release
artifacts. It may be populated only through a reviewed operator projection of
`privacy_deletion_receipts`; do not add email, provider subject, connection strings, deleted rows,
or other identity-bearing fields.

## Restore-before-traffic enforcement

After restoring any backup and before starting web or worker traffic, load `DATABASE_URL` through
the protected environment and run:

```sh
pnpm privacy:reapply-deletions --confirm <exact-database-name> --receipt-file <private-mode-0600-json-file>
```

The CLI refuses database URLs in arguments, requires `--confirm` to equal the database name in the
environment URL, rejects symlinks/non-regular files and any mode other than `0600`, validates strict
receipts, rejects duplicate receipt/owner IDs and extra identity-bearing fields, sorts receipts
deterministically, and uses one reviewed transaction per receipt. It stops after the first failure,
returns nonzero, and prints only:

```json
{"checked":2,"absent":1,"reapplied":1,"failed":0}
```

Do not enable traffic unless `failed` is zero and every expected receipt was checked. Store only
that count object and the receipt-file content hash in `release-evidence/private/`; never store or
print a receipt, subject digest, database URL, user identity, or deleted content. A restored owner
is removed again through the same receipt-gated cascade. An already-absent owner is counted without
mutation.

## Provider outage behavior

- PostgreSQL unavailable: `/api/health` may remain live, `/api/ready` fails, writes stop, and Vera does not fall back to SQLite or memory.
- Maritime unavailable: canonical jobs remain queued in PostgreSQL. Only safe wake/status operations retry; the web process does not invent a second scheduler.
- OpenClaw Gateway or extension unavailable: the request returns a typed safe failure and never
  becomes an empty snapshot or RawListing. Legacy `deferred_local_node_offline` behavior remains a
  regression invariant, not the selected architecture.
- Google revoked/expired: connection becomes reconnect-required. Gmail failure is not an empty mailbox; Calendar failure is not a conflict-free interval.
- Notification provider unavailable: delivery remains idempotently queued/retryable and may move to digest; it is not recorded as delivered.
- Logging/metrics unavailable: product work must not block on telemetry, but the outage is operationally visible and the runtime must not buffer unbounded payloads.

## Credential or privacy incident

1. Activate the narrowest kill switch; use the global browser/integration/schedule/notification switches for uncertain scope.
2. Stop new dispatch and provider work while preserving canonical PostgreSQL and sanitized audit evidence.
3. Revoke the affected Google grant, dedicated Maritime browser credential, OpenClaw Gateway
   token/extension relay credential, Web Push subscription, session, or encryption key.
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
- dedicated Maritime/OpenClaw deployment and immutable version identities;
- least-privilege OpenClaw tool, extension-profile, enrollment, and per-user Gateway configuration;
- sanitized positive and failure-path staging results;
- verified Web Push provider behavior, or keep production push disabled.
