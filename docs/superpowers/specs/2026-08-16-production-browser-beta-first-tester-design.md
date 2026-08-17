# Production Browser Beta and First External Tester

## Status

Approved direction: ship one production release train with two activation waves. The founder passes
the complete browser acceptance first; one isolated external tester follows immediately after that
acceptance and the nonfounder privacy rehearsal pass. Browser access remains private,
`experimental_personal`, user-triggered only, and disabled for every user not explicitly allowlisted.

## Goal

Make the current Vera web application and Browser Connector safe and reliable enough for the
founder and one real external tester without weakening the existing read-only, single-tab browser
boundary.

The release must:

- eliminate the production React hydration failure;
- deploy the merged one-click Browser Connector enrollment implementation and its additive database
  migration safely;
- provide an authenticated, owner-scoped privacy export and two-step account deletion lifecycle;
- publish the verified Browser Connector as a private Chrome Web Store beta;
- release one new signed enrollment-capable Gateway image because the missing bounded enrollment
  primitive is already proven;
- preserve the accepted Gateway images and existing PostgreSQL listing data;
- prove the founder flow first and then the same flow for one isolated external tester;
- leave login, 2FA, CAPTCHA, checkpoint, consent, and blocked layouts manual; and
- keep the forbidden-action count at zero.

This design does not make Vera's browser integration a public production capability. It creates a
controlled two-user private beta with explicit per-user admission, infrastructure, credentials,
revocation, and evidence.

## Current baseline

The current production application is healthy at the HTTP level, but it is behind current `main`.
The deployed web and worker predate the one-click enrollment merge and PostgreSQL migration `0009`.
Running current `main` against the hosted database correctly reports `migration_behind`.

The React hydration error is reproducible when the server renders in UTC and Chrome renders in the
user's local time zone. A listing observed near midnight renders as `Aug 11` on the server and
`Aug 10` in the browser. Several client components instantiate locale formatters without an
explicit `timeZone` or call `toLocaleString()` directly.

Browser Connector version `2.2.0` already implements the approved single-use ticket enrollment
protocol, reconnects through ordinary Chrome/service-worker restarts, and passes its focused tests
and permission verifier. Pairing is not required for each search. A new enrollment is required only
after explicit unpairing, server revocation, credential rotation, extension storage removal, or use
of another Chrome profile or computer.

The authenticated privacy lifecycle is not implemented. Existing operations documentation states
that this absence is acceptable only for a single-founder release and blocks a nonfounder beta.

## Non-goals

- Do not redesign the Gateway or add a second public route.
- Do not replace, relabel, or rebuild an accepted Gateway image in place.
- Do not share a founder Gateway, node, browser profile, Maritime agent, load balancer, container
  set, or credential with the tester.
- Do not add public self-service browser enrollment.
- Do not automatically share a tab or keep background browser polling active.
- Do not automate login, passwords, 2FA, CAPTCHA, checkpoint, consent, or anti-bot recovery.
- Do not add arbitrary JavaScript, selectors, coordinates, shell, filesystem, uploads, downloads,
  contact, application, tour, email, phone, message, or payment actions.
- Do not convert append-only product evidence into mutable normal application data. Owner deletion
  remains a separately authorized privacy operation.
- Do not publish production-support claims for browser sources during this two-user beta.
- Do not provision recurring paid tester infrastructure without separate approval of the exact
  monthly cost.

## Selected release architecture

Use one reviewed application branch and one final PR. The release has a single code state and two
operational activation waves:

```text
reviewed branch and green CI
  -> PostgreSQL backup and additive migrations
  -> deploy paired web + worker with browser gates off
  -> verify health, readiness, privacy lifecycle, and founder access
  -> publish signed Gateway + private extension bytes
  -> activate and accept founder assignment
  -> rehearse nonfounder privacy lifecycle
  -> activate and accept one isolated tester assignment
  -> keep all other users denied
```

This sequence avoids running two different application versions against the same schema and keeps
browser execution fail-closed while application, Store, privacy, or infrastructure gates are
incomplete. It also gives the external tester the same shipped code as the founder without sharing
security boundaries.

## Deterministic server rendering

### Shared formatter boundary

Add one small web formatting module for server-rendered instants. Every formatter used by a
server-rendered React tree must declare `timeZone: "UTC"`. Timestamp labels must include `UTC` when
the time is material. Date-only product values such as a move-in date remain date-only and must not
be converted through a local midnight instant.

The helper owns the product's display conventions for:

- compact observed dates;
- full timestamps;
- activity timestamps;
- browser heartbeat and capture timestamps;
- schedule and operations timestamps; and
- viewing-planner instants.

Currency and plain-number locale formatting are not timezone-sensitive and can remain locale-based.
Components must not call `Date.prototype.toLocaleString()` directly. A future persisted user time
zone may replace UTC, but guessing the browser zone during SSR is out of scope for this release.

### Hydration regression

Add a regression that renders representative listing and settings data with the Node process in
UTC and loads it in a browser context whose time zone is `America/New_York`. The test fails on any
hydration warning/error and verifies that the server and client display the same value. Unit tests
cover boundary instants on both sides of UTC midnight and confirm date-only values remain stable.

## Authenticated privacy lifecycle

### Export

`GET /api/settings/privacy/export` uses only the authenticated session owner. It accepts no user ID
or account selector. It returns bounded newline-delimited JSON with:

- schema version, authenticated owner UUID, UTC cutoff, safe record counts, and hashes;
- a safe user projection;
- safe provider-connection metadata without usable credentials;
- owner-predicated listing, search, score, provenance, activity, job, approval, schedule,
  notification, and browser-control records; and
- explicit exclusions for sessions, OAuth state, token ciphertext/nonces, Web Push key material,
  dispatch secrets, enrollment tickets, relay/checkpoint material, internal policy secrets, and
  logs.

The response is `application/x-ndjson`, `Cache-Control: no-store`, an attachment, and `nosniff`.
Each record and the total response have fixed size limits. The export is assembled from an explicit
allowlist of safe owner-scoped projections in a repeatable-read, read-only transaction. It is never
a database dump and never selects another owner's rows.

### Two-step deletion

The privacy page separates **Export my Vera data** from **Delete my Vera account**. Deletion first
issues a 15-minute, single-use, owner-bound challenge. The second step requires the user to type the
exact phrase `DELETE MY VERA ACCOUNT`; the UI never prefills it.

Before the owner row is deleted, the server:

1. stops the owner's schedules and prevents new browser work;
2. revokes outstanding Browser Connector tickets, the device, and the assignment;
3. attempts Google provider revocation through the existing narrow disconnect path and removes
   Vera's encrypted token material even when the provider cannot confirm revocation;
4. removes notification subscriptions and active sessions;
5. computes an HMAC digest of the normalized provider subject using a dedicated production secret;
6. records only fixed status codes for external revocation outcomes; and
7. executes one owner-predicated deletion transaction following the current foreign-key graph.

Failures before the deletion transaction leave the account active and retryable. A committed
deletion cannot be rolled back into an active user. The response contains only `deleted` and an
opaque receipt ID.

### Receipt and restored-backup enforcement

The database keeps a non-identifying deletion receipt outside the deleted owner graph. It contains:

- opaque receipt ID and former Vera UUID;
- HMAC provider-subject digest;
- fixed provider and browser revocation statuses;
- completion time;
- verified backup-erasure deadline; and
- optional approved legal-hold deadline.

It contains no email, display name, IP address, URL, credential, or free-form note. A restore-time
operator tool accepts receipts only from a private mode-`0600` file, rejects production database
URLs on the command line, and reapplies owner deletion before restored traffic is enabled. It emits
counts and receipt IDs only.

The lifecycle is complete only after a dedicated nonfounder rehearsal proves owner A can export and
delete without exposing or deleting owner B, active sessions fail, browser dispatch is denied, and
a sanitized pre-deletion backup restored into an isolated database remains deleted after receipt
reapplication.

## Database changes

Migration `0009` remains the exact one-click-enrollment migration already merged. The privacy
lifecycle uses the next additive migration and must not rewrite `0009` or historical migrations.

The new migration adds:

- bounded, expiring privacy-deletion challenges;
- non-identifying privacy-deletion receipts;
- any narrowly required foreign-key adjustments such as nullable `ON DELETE SET NULL` approver
  history; and
- database checks for digest shape, fixed statuses, challenge lifetime, terminal consistency, and
  backup-erasure ordering.

The implementation must inspect the live current schema and maintain an explicit owner-table
registry shared by export, deletion verification, integration tests, and the restore tool. Adding a
new owner-scoped table later must fail a schema-coverage test until its privacy behavior is declared.

## Browser Connector, Gateway, and Store

### Extension distribution

Package the exact verified version `2.2.0` bytes after the final source review. The permission set
must remain exactly `alarms`, `debugger`, `storage`, `tabGroups`, and `tabs`. Publish initially as a
private Chrome Web Store item restricted to the founder and exact external tester accounts. The
marketing site may link approved users to that private item, but must describe access as a private
beta and show a clean waitlist path to everyone else.

Chrome Web Store submission and tester-list changes are human-confirmed external actions. Store
review delay is a typed operational wait state, not permission to distribute secrets or bypass
review.

### Gateway release

Enrollment is an objectively missing primitive in the accepted Gateway, so one new image is
allowed. Build it from the final merged source commit through the manual release workflow. Record
the immutable digest and verify:

- signature;
- SBOM;
- provenance bound to the exact commit and workflow;
- pinned runtime/lockfile evidence; and
- zero HIGH and zero CRITICAL vulnerabilities.

The accepted Milestone 13B image
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde`
and 13A rollback image
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd`
remain immutable and available for rollback.

### Assignment isolation

Each user has exactly one Vera owner, approved node/profile, Maritime agent, Gateway/checkpoint
container set, load-balancer path, relay credential, checkpoint credential, bootstrap seed,
plan-signing key, and secret namespace. PostgreSQL stores routing identities, safe secret
references, and SHA-256 digests only. The web runtime never receives raw relay credentials.

The first tester is not placed on founder infrastructure. Exact recurring tester infrastructure
cost must be shown and approved before provisioning. Existing Heroku Eco web, Eco worker, and
Essential-0 PostgreSQL remain the selected shared application footprint; browser-session
infrastructure stays per tester.

## Feature gates and deployment configuration

The application deploys with these controls denying browser work:

```dotenv
VERA_BROWSER_DISABLED=1
VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0
VERA_BROWSER_ENROLLMENT_ENABLED=0
VERA_BROWSER_BETA_USER_IDS=
```

Enrollment and browser search are separate gates. During connection acceptance, enrollment may be
enabled for one exact user while `VERA_BROWSER_DISABLED=1` still denies all listing research.
Browser work is enabled only for the bounded live-acceptance window after the assignment and
connector are healthy.

The deployed web and worker must use the same source release. `/api/ready` must prove PostgreSQL
connectivity and the exact current migration before either process receives traffic or jobs.

## Application and support copy

Replace obsolete pairing-string instructions with the actual flow:

```text
Install Browser Connector
  -> sign in to Vera
  -> Connect this browser
  -> confirm the read-only boundary
  -> prepare and share one dedicated Vera Search tab
```

Copy must explain that connection persists on that Chrome profile through ordinary restarts, while
sharing a tab is always a separate explicit action. Unshare stops access to the page immediately.
Revoke/Unpair clears access and intentionally requires a new connection. Another computer requires
explicit replacement of the existing approved device.

Privacy and support pages must accurately describe retained records, export, deletion, backup
aging, manual login blockers, private-beta status, and how to revoke access. No page may describe
the connector as public production automation.

## Release sequence

### Code and data release

1. Implement on one branch, run focused tests while iterating, and run full CI once on the final
   branch state.
2. Review the diff for secrets, cross-owner access, raw browser material, forbidden actions,
   permission changes, and migration compatibility.
3. Merge one final PR.
4. Turn on the global browser kill switch and prove zero queued, dispatched, or running browser
   jobs.
5. Record safe database counts and create a recoverable PostgreSQL backup without exporting private
   contents to Git or logs.
6. Apply additive migrations `0009` and the privacy migration; verify the migration ledger and
   record preservation.
7. Deploy the paired web and worker release with every browser gate off.
8. Verify `/api/health`, `/api/ready`, authentication, existing listings, source controls, privacy
   routes, worker health, and no hydration errors.

### Founder activation

1. Publish and verify the new immutable Gateway image and private Store extension.
2. Rotate fresh founder relay, checkpoint, bootstrap, signing, and Maritime credentials without
   printing them.
3. Recreate only stateless founder Gateway/checkpoint containers using the new image; preserve
   PostgreSQL and all listing data.
4. Activate the exact founder assignment while browser jobs remain disabled.
5. Install the Store extension, click **Connect this browser**, restart Chrome/extension, and prove
   reconnection with zero shared tabs.
6. Explicitly share one dedicated Vera Search tab and run the approved bounded source flow.
7. Unshare and prove a subsequent run returns `tab_required`/`no_shared_tab` with zero imports.
8. Revoke from Vera, clear local extension access, rotate/delete raw credentials, and verify zero
   shared tabs, connections, clipboard bytes, and forbidden actions.

### First external tester activation

1. Complete the nonfounder privacy export/deletion/restore rehearsal and keep its evidence private.
2. Obtain separate approval for the exact recurring tester infrastructure cost.
3. Add only the exact tester account to the private Store tester list and Vera beta membership.
4. Provision a completely isolated tester assignment and fresh secret namespace.
5. Repeat connection acceptance with browser jobs disabled, including restart persistence and zero
   automatically shared tabs.
6. Enable browser work only for that user's bounded acceptance window.
7. Prove exact-owner routing, wrong-owner denial, a real listing import, source failure isolation,
   unshare stop, server revocation, local credential clearing, and zero forbidden actions.
8. Leave every other user and all scheduled/background browser work disabled.

## Failure and rollback behavior

- Migration failure: do not deploy code; retain backup and existing release.
- Readiness failure: do not route traffic or enable browser gates.
- Hydration failure: fail the browser acceptance and roll back the paired app release.
- Store review pending: keep enrollment and browser gates off; do not side-load secrets to the
  external tester.
- Privacy rehearsal failure: founder-only operation may continue behind existing controls, but the
  external tester is not activated.
- Gateway or checkpoint failure: return typed unavailable/manual-action state; never fall back to a
  global or founder assignment.
- Login, CAPTCHA, consent, checkpoint, rate limit, block, redirect, or changed layout: stop visibly
  without bypass.
- Application rollback: restore the exact compatible web/worker release and flags. Do not delete
  additive rows or PostgreSQL listing data.
- Gateway rollback: disable browser routing, restore an immutable accepted image, and create fresh
  credentials before any later reactivation. Never restore an old ticket or credential.
- Owner deletion after backup restore: reapply deletion receipts before enabling traffic.

## Automated verification

The final branch must pass:

- formatter unit tests and cross-timezone hydration E2E;
- privacy domain, repository, route, owner-isolation, size-limit, challenge replay, provider
  failure, deletion, and restored-backup tests;
- migration tests from both the current production migration and an empty database;
- one-click enrollment domain, repository, route, checkpoint, extension, and reconnect tests;
- Browser Connector permission/package verification;
- Gateway route-filter security, bounded-frame, replay, timeout, and upstream-isolation tests;
- existing four-source, normalized pipeline, dedupe, scoring, source-failure isolation,
  forbidden-action, unshare, and revocation regressions;
- web mutation-boundary verification, lint, typecheck, builds, and the repository's full CI.

Tests must use sanitized fixtures and fake providers. Live browser and privacy rehearsals are
separate opt-in acceptance and must not expose credentials or private content in CI.

## Live acceptance evidence

Record only safe IDs, counts, timestamps, hashes, action types, image/config digests, and typed
states in the gitignored private evidence directory.

The release is ready for the first tester only when evidence proves:

- production `/api/ready` is ready on the merged release and current migration;
- no React hydration warning/error occurs across the authenticated product routes;
- owner export contains the requesting owner's safe records and no other owner or credential data;
- two-step deletion revokes sessions, provider/browser access, and owner rows, and survives a
  sanitized backup-restore rehearsal;
- the extension is the privately published verified `2.2.0` package with unchanged permissions;
- the new Gateway image is signed, attested, and has zero HIGH/CRITICAL findings;
- founder connection persists through restart and shares zero tabs automatically;
- founder and tester each import through their own assignment and cannot access the other's;
- existing four-source behavior and deterministic pipeline remain intact;
- unsharing prevents future browser work and revocation clears transport access;
- shared tab count, established connections, and clipboard bytes are zero after revocation; and
- forbidden external action count is zero for both users.

## Completion boundary

The code release is not the product outcome by itself. Completion requires the merged and deployed
application, current migrations, live privacy rehearsal, private Store availability, signed Gateway
release, founder acceptance, and one isolated external-tester acceptance. Any missing external gate
must remain a visible blocker; it must not be papered over by enabling a feature flag or weakening a
policy check.
