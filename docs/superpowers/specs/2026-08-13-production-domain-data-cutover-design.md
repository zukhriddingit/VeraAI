# Production Domain and Data Cutover Design

Status: Proposed — architecture approved in the task; written specification pending review
Date: 2026-08-13

## Purpose

Make Vera's authenticated product production-ready at `https://app.verahousing.app`, restore a
healthy PostgreSQL dependency so `/api/ready` reports ready, and move the existing marketing site to
`https://verahousing.app` without changing Vera's proven browser-security boundary or losing retained
listing data.

The design deliberately co-locates Vera's critical application path on Heroku while keeping the
static marketing surface on Vercel and the signed OpenClaw Gateway on its existing DigitalOcean
infrastructure. “One place” applies to the web/worker/database failure domain, not to components whose
isolation is a safety or availability advantage.

## Confirmed current state

Read-only production inspection on 2026-08-13 established:

- `https://app.verahousing.app` serves the authenticated Heroku application.
- `/api/health` returns HTTP 200, proving only web-process liveness.
- `/api/ready` returns HTTP 503 with PostgreSQL unavailable and migration unknown.
- Heroku `DATABASE_URL` names the external Railway TCP proxy and includes a CA path that is absent
  from the current web image.
- The referenced Railway PostgreSQL deployment is removed. Its approximately 126 MB persistent
  volume remains ready and must not be deleted or overwritten.
- The old Railway web deployment is failed/removed and its public URL returns 404.
- Heroku currently has separate `web` and `worker` processes, but they were not last released from
  the same source revision. A production release must eliminate that drift.
- `https://vera-ai-housing.vercel.app` serves the current marketing site.
- `verahousing.app` and `www.verahousing.app` have no active marketing records. DNS is hosted at
  Name.com. The existing `app.verahousing.app` CNAME is healthy and must remain unchanged.
- The retained accepted listing corpus is in the preserved DigitalOcean PostgreSQL container. The
  local tunnel is not a production dependency and is currently unavailable.
- The accepted OpenClaw Gateway image is signed, verified, and immutable. Browser access is unpaired
  and no tab is shared.

The readiness incident therefore has two independent causes: the target Railway database service is
not running, and the Heroku image cannot satisfy the external Railway CA-file reference. Recreating a
local tunnel would help an operator reach the retained source database, but it would not be an
acceptable production fix.

## Decision

### Runtime topology

```text
verahousing.app / www
        |
        v
Vercel marketing project

app.verahousing.app
        |
        v
Heroku vera-housing-app
  |-- web process (Next.js)
  |-- deterministic worker process
  `-- managed Heroku Postgres, same region
        |
        `-- durable listings, jobs, provenance, decisions, and audit evidence

Approved browser job
        |
        v
Maritime orchestration
        |
        v
existing signed DigitalOcean OpenClaw Gateway
        |
        v
exactly one explicitly shared local browser tab
```

Heroku becomes the application and database failure domain:

- one public `web` process built from `Dockerfile.web`;
- one private deterministic `worker` process built from the repository-root `Dockerfile`;
- one Heroku Postgres Standard-tier-or-higher database in the same region as both processes;
- conservative pools whose combined maximum remains below the database connection limit.

The Heroku worker may claim deterministic PostgreSQL jobs and use the existing Maritime dispatch
contracts. Maritime remains the primary orchestration lifecycle for approved browser work. Browser
sessions, OpenClaw, arbitrary site access, and credentials never move into Heroku.

### Provider boundaries

- **Heroku:** application availability, paired web/worker release, managed PostgreSQL, readiness,
  application logs, and database backups.
- **Vercel:** the existing marketing project only. It never receives Vera application credentials or
  `DATABASE_URL`.
- **DigitalOcean:** the existing hardened OpenClaw Gateway/checkpoint and the retained source
  PostgreSQL container until cutover evidence and the founder's retention requirement are satisfied.
- **Maritime:** approved orchestration and browser-dispatch boundary. A vendor outage may make browser
  research visibly unavailable but must not make the product inbox or deterministic worker
  unavailable.
- **Railway:** no longer part of the production request path. Its old database volume remains
  preserved as recovery evidence until a later explicit cleanup task.

This is intentionally not a broad replatform. Moving the authenticated Next.js application to
Vercel, rebuilding the Gateway, changing the browser transport, or reviving the failed Railway web
service are outside scope.

## Managed PostgreSQL design

### Production database

Provision a new Heroku Postgres database on a Standard tier or higher. Standard-and-higher Heroku
Postgres provides continuous protection; the exact available plan and region must be inspected at
provision time rather than hard-coded in the repository. The selected plan must provide:

- enough storage for the restored corpus plus at least 4x current logical size;
- enough connections for one web and one worker pool plus migrations and operator access;
- automatic continuous protection and manual logical backups;
- the same region as the Heroku dynos;
- a documented maintenance window and retention setting.

The new database is attached under a non-primary color attachment and remains unpromoted while data,
migrations, and application compatibility are verified. The current broken `DATABASE_URL` is not
edited in place and is not used as a restore target.

### Connection and credentials

The application consumes only the provider-managed attachment URL. It must not retain Railway host,
port, certificate, or `sslrootcert` query parameters after promotion. TLS remains enabled; the release
must not use `rejectUnauthorized: false`, disable SSL, or add an unverified certificate workaround.

Use separate migration and runtime credentials when the selected Heroku plan supports managed
credentials. The migration credential is present only during the controlled migration step. The
runtime credential can perform the required table and sequence DML but must not be used as a general
operator credential. Secrets remain in provider configuration and permission-restricted operator
files; they are never copied into Git, logs, screenshots, PR text, or evidence summaries.

## Data-preserving cutover

### 1. Freeze and inventory

Before the final source backup:

1. Confirm the extension is unpaired, shared-tab count is zero, and future browser work is denied.
2. Stop every local or hosted web/worker process whose configuration targets the retained
   DigitalOcean database, then prove there are no active application sessions writing to it.
3. Stop the current Heroku worker from claiming new work and place the public app in maintenance
   before its database target changes. Its current 503 readiness is evidence of an outage, not a
   write-freeze mechanism.
4. Record the candidate Git commit, current Heroku web and worker releases, retained DigitalOcean
   container identity, old Railway volume identity, and UTC cutover start.
5. Query the retained source database for safe per-table counts and immutable evidence totals. Do not
   quote cached demo totals as current facts.

The safe count manifest contains table names, counts, migration hashes, and a manifest hash only. It
contains no rows, URLs, addresses, contacts, tokens, or raw payloads.

### 2. Back up retained DigitalOcean PostgreSQL

Open operator access through a temporary exact `/32` SSH firewall rule only after confirming the
Droplet, firewall, and source container identities. Take a PostgreSQL custom-format logical backup
with `--no-owner --no-privileges`, store it in a permission-restricted private evidence location, and
record its SHA-256 hash and byte size. Keep the backup encrypted at rest and never place it in the
repository or a public object URL.

Verify the dump with `pg_restore --list` and a restore rehearsal before touching production. Remove
the temporary SSH rule immediately after the required operator transfer and health checks. Do not
restart, replace, reset, or delete the retained source database merely to obtain the dump.

### 3. Restore into an unpromoted Heroku database

Restore the verified dump into the new non-primary Heroku database. The target is disposable until
promotion; the source backup and source database remain unchanged. A failed restore is discarded by
provisioning another target rather than repairing partially restored immutable evidence in place.

After restore:

1. compare every pre-migration table count and migration hash against the source manifest;
2. verify append-only trigger definitions and critical unique/foreign-key constraints;
3. verify RawListing, field provenance, source records, canonical memberships, decisions,
   enrichment snapshots, photos, source dispositions, jobs, OAuth/integration envelopes, and activity
   evidence were restored;
4. verify forbidden browser-action count remains zero;
5. record only safe counts and hashes in release evidence.

Any unexplained mismatch stops the cutover.

### 4. Migrate and validate

Run the repository's forward-only migrations exactly once with the migration credential, then run the
hosted global policy seed twice. The first seed may insert missing global policy rows; the second must
report zero inserts. Do not delete a historical row or overwrite user-owned policy.

Run the release candidate web and worker images against the unpromoted database. Verification must
cover:

- bounded PostgreSQL connection and clean shutdown;
- current Drizzle migration hash;
- `/api/ready` reporting `ready` from a candidate web process;
- authenticated founder session and listing inbox read;
- one deterministic, non-browser worker job claimed and completed idempotently;
- no email send, calendar write, browser research, or other external side effect;
- compatibility of the previous production image with the additive migrated schema, or an explicit
  decision that database restore—not image rollback—is the only safe rollback.

Take a new Heroku logical backup after migration and verification but before promotion.

### 5. Promote and release atomically

Enter Heroku maintenance mode and keep the worker scaled to zero. Promote the verified database
attachment to `DATABASE_URL`; do not paste or reconstruct its URL manually. Push the web and worker
images built from one reviewed Git commit, then release both process types in one Heroku container
release so they cannot drift by source revision.

Scale exactly one web and one worker process, disable maintenance mode, and monitor readiness. Browser
dispatch remains disabled/unavailable unless Maritime is healthy and the founder separately performs
the existing fresh pairing and single-tab sharing flow.

## Readiness and production acceptance

`/api/health` remains dependency-free liveness. `/api/ready` remains the only production readiness
claim and must prove both PostgreSQL connectivity and the current migration hash.

The cutover passes only when all of the following are directly observed:

- `https://app.verahousing.app/api/health` returns HTTP 200;
- `https://app.verahousing.app/api/ready` returns HTTP 200 with `status: ready` and a current
  migration for ten consecutive checks across at least five minutes;
- the Heroku `web` and `worker` process images identify the same reviewed source commit;
- founder authentication succeeds without changing the public base URL or OAuth callback host;
- the interactive inbox, one listing detail, source links, and activity history load from PostgreSQL;
- one deterministic worker job completes and does not duplicate an existing canonical listing;
- restored immutable-table counts match the source manifest and post-migration differences are fully
  explained by additive migrations or explicitly triggered deterministic work;
- forbidden external browser-action count remains zero;
- unpaired/unshared browser state still prevents future enrichment;
- the old Railway volume and DigitalOcean source database remain preserved.

A healthy landing page or `/api/health` alone cannot satisfy this gate.

## Domain cutover

The canonical marketing URL is the founder-requested apex `https://verahousing.app`.
`https://www.verahousing.app` redirects permanently to the apex. Although Vercel documents `www` as
its preferred primary shape, it supports an apex primary through its Anycast network.

Sequence:

1. Identify the existing Vercel marketing project that serves
   `https://vera-ai-housing.vercel.app` and confirm its latest production deployment.
2. Add both `verahousing.app` and `www.verahousing.app` to that project before changing DNS.
3. Configure the Vercel project-level redirect from `www` to the apex.
4. Inspect the exact project-specific DNS records Vercel requests at change time. Do not assume or
   hard-code the general-purpose A/CNAME values.
5. Export the current Name.com DNS record inventory, then add only the required apex and `www`
   records. Preserve the existing `app` CNAME and every MX, TXT, CAA, and verification record.
6. Verify authoritative DNS, Vercel ownership, TLS issuance, apex marketing response, permanent
   `www` redirect, and continued `app.verahousing.app` product behavior.

Name.com password entry remains a manual founder action. Vera/Codex never asks for, records, types,
or stores the password. GitHub or Vercel sign-in may use an already authenticated user-controlled
session, but no credential is copied into the repository or command output.

Changing the marketing domain does not change `VERA_PUBLIC_BASE_URL`, Better Auth's product origin,
Google OAuth redirect URIs, browser connector callback host, or the existing Heroku custom domain.

Vercel's current domain instructions are the source of truth for the exact records:

- <https://vercel.com/docs/domains/set-up-custom-domain>
- <https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting>

## Rollback

Rollback is fail-closed and never uses an in-place destructive database restore.

### Before database promotion

Nothing public has changed. Discard the unpromoted target, preserve its failure evidence, and keep
the broken production state visible while a new target is prepared. Do not point the app back to the
removed Railway service as a claimed recovery.

### After database promotion, before stable acceptance

1. Enable maintenance mode and scale the worker to zero.
2. If the database is healthy and the fault is application-only, release the last image proven
   compatible with the migrated schema.
3. If the database is suspect, restore the recorded pre-migration dump to a new Heroku database,
   validate it with the compatible image, and promote that replacement.
4. Re-enable traffic only after `/api/ready` and the safe count manifest pass.

The old Railway volume, DigitalOcean database, and encrypted logical backups remain recovery sources.
No down migration is run against production.

### Domain rollback

If Vercel verification, TLS, marketing rendering, or redirect behavior fails, revert only the newly
added apex/`www` records using the saved DNS inventory. Never alter the working `app` CNAME as part of
a marketing rollback.

## OpenClaw and AI boundary

This release does not build, push, restart, reconfigure, or replace OpenClaw. It does not rotate or
recover a pairing credential. The accepted signed Gateway digest and its browser-action deny rules
remain unchanged.

The Gateway exposes only Vera's bounded deterministic browser tools; its chat-completions and
responses endpoints remain disabled and no model/provider is configured. The successful live browser
acceptance therefore did not depend on an LLM inside OpenClaw. Vera's optional provider-neutral LLM
path also remains disabled unless both an API key and an explicit model name are configured. This
cutover does not add either setting.

## Security and privacy gates

- Never print, recover, or reuse an old pairing value, database URL, provider token, OAuth secret,
  browser credential, cookie, signed header, or raw listing payload.
- Do not commit dumps, `.env` files, provider exports, private evidence, infrastructure addresses, or
  live user/listing data.
- Preserve RawListing and audit evidence; unknown remains unknown.
- Do not enable automated login, CAPTCHA handling, outreach sending, calendar writes, contact actions,
  payments, uploads, downloads, or background browser polling.
- Do not weaken TLS, hostname restrictions, one-tab sharing, cancellation, source limits, or
  forbidden-action checks to make readiness pass.
- Every provider mutation is preceded by read-only identity and current-state verification and is
  followed by a bounded acceptance check.

## Implementation and release scope

The implementation plan derived from this design may change only the minimum repository surfaces
needed to make the chosen topology explicit and testable:

- hosted PostgreSQL connection/configuration tests if Heroku attachment behavior exposes a generic
  portability gap;
- deployment verification that binds web and worker images to the same commit;
- deployment/runbook documentation that replaces obsolete Railway production assumptions;
- safe release verification scripts that output counts and hashes only;
- no Gateway/browser code unless an objectively missing existing bounded primitive is proven.

Use one branch and one final PR. Run focused tests while iterating, then lint, typecheck, affected
PostgreSQL integration tests, full CI once, and container-image builds before merge. Production
provider changes occur only after the PR is green and merged.

## Definition of done

The release is complete only when:

1. the application critical path is Heroku web + Heroku worker + managed Heroku Postgres;
2. retained PostgreSQL data is restored and proven by source/destination counts and hashes;
3. `/api/ready` is continuously healthy with the current migration;
4. web and worker run the same reviewed source commit;
5. `verahousing.app` serves the existing marketing deployment and `www` redirects to it;
6. `app.verahousing.app` still serves the authenticated product;
7. the Railway database volume and DigitalOcean source database remain preserved;
8. the signed OpenClaw Gateway and all browser safety rules remain unchanged;
9. forbidden external actions remain zero; and
10. rollback artifacts and safe evidence are recorded outside public Git history.
