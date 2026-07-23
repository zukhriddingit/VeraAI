# PostgreSQL operations

Status: founder-release runbook
Reviewed: 2026-07-22

## Local setup

```sh
pnpm postgres:up
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:migrate
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:seed
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres
```

`postgres:reset` deletes the local Compose volume. It rejects production, remote hosts, databases/users other than `vera`, and an unexpected Compose project. Use it only when fixture/local development data can be discarded:

```sh
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm postgres:reset
```

## Release migrations

The founder release applies four additive migrations after the baseline:

- `0001_calendar_availability.sql` creates availability rules/checks, Calendar OAuth state/holds, and viewing selection/supersession fields;
- `0002_openclaw_current_tab.sql` creates tenant browser controls and immutable capture acceptance;
- `0003_maritime_execution_plane.sql` creates dispatch attempts, production schedules/runs, deployment/heartbeat projections, Gmail alert state, encrypted Web Push state, and notification delivery state. It upgrades the expected OpenClaw version without deleting a node or browser record.
- `0004_founder_security_hardening.sql` adds tenant-owned Google refresh leases, refuses ambiguous duplicate global schedules or malformed encrypted Web Push material, then enforces null-source schedule uniqueness and exact AES-GCM envelope bounds.

They do not reset or rewrite listings, source evidence, scores, jobs, identity, Calendar history, or demo fixtures.

Before applying them, inspect the `0001` preflight result for duplicate `(user_id, provider)` integration connections. It deliberately stops instead of choosing which encrypted credential should survive. Resolve any duplicate through a reviewed, owner-specific process before retrying. Migration `0003` permits multiple dispatch attempts for one job but enforces globally unique nonce hashes and tenant foreign keys. Migration `0004` performs a read-only preflight and aborts rather than choosing, deleting, or rewriting an ambiguous row.

1. Confirm the application commit and generated SQL were reviewed.
2. Confirm `DATABASE_URL` names the intended environment.
3. Take or verify a recent managed PostgreSQL snapshot immediately before migration and record its identifier.
4. Run `pnpm db:migrate` once as a controlled release step.
5. Run `pnpm db:seed`; this changes global sanitized source policy only. Its JSON result reports the total manifest count and the number actually inserted; a second run must report `inserted: 0` and never create or update a user-owned row.
6. Verify `/api/health` returns 200 and `/api/ready` returns `status: ready` with a current migration.
7. Start one web instance and one worker instance in the same region as the database.

Do not run application instances with a schema behind their expected migration hash.

## Logical backup

Managed snapshots are the primary founder-release recovery mechanism. A portable logical backup can supplement them:

```sh
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=vera.backup
```

Keep backups encrypted, access-controlled, outside the repository, and subject to the same retention/deletion policy as production data. A backup can contain private listing evidence, encrypted Calendar refresh tokens, and encrypted OAuth-state PKCE verifiers. Ciphertext still requires restricted access because the application and a referenced key can decrypt it.

## Restore rehearsal

The executable rehearsal accepts only `TEST_DATABASE_URL` whose database name is exactly `vera_test` plus the built-in `--confirm vera_test` argument. It creates a randomly named temporary database, dumps the application-owned `public` and `drizzle` schemas, restores them, compares application-schema controls and private-table counts, and removes both the database and temporary dump in `finally`:

```sh
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm postgres:backup-rehearsal
```

Install the PostgreSQL 18 `pg_dump`, `pg_restore`, `createdb`, and `dropdb` client tools on the operator host before running it. The script never invokes a shell, never prints a database URL or subprocess arguments, and reports only a redacted host/database label and safe counts. Managed staging restores remain a separate provider-console rehearsal before promotion.

## Rollback

The founder release does not generate automatic down migrations. Choose one of these reviewed paths:

- deploy the prior application only when migrations `0001` through `0003` have been verified backward-compatible with that exact release; or
- place the application in maintenance, restore the recorded pre-release managed snapshot to a new database, run the prior release's readiness check, validate tenant counts and encrypted-integration records, and switch `DATABASE_URL` under change control.

Never point hosted Vera at SQLite as a rollback or failover. Never use the deterministic demo database as production recovery.

## Pool and readiness

Web and worker each create one bounded pool. Set `VERA_DB_POOL_MAX` so their combined maximum stays safely below the managed database limit. The defaults also enforce bounded connection, statement, lock, and idle-transaction timeouts.

`/api/health` proves only that the web process is alive. `/api/ready` proves that PostgreSQL is reachable and the latest Drizzle migration hash is installed. A database outage must leave health at 200 while readiness becomes 503.

## Database roles

Use separate credentials even for the one-region, one-web, one-worker founder topology:

- the migration role may apply reviewed DDL and migrations; bind it only to the controlled migration step;
- the runtime role may connect and perform only the required table/sequence DML; it must not own the database or schema, be a superuser, bypass row-level security, create extensions, create/drop/alter objects, or grant roles;
- managed-provider administrative credentials remain operator-only and never enter application environment variables.

Append-only triggers protect raw and audit evidence from normal application mutation, but an owner or superuser can remove or bypass those controls. Record the actual role names, grants, provider audit setting, and credential locations during staging without copying secrets into this repository.

## Cleanup and retention

The `ephemeral_cleanup` worker lane processes at most 500 records per invocation by default. Its PostgreSQL repository uses one bounded transaction and `FOR UPDATE SKIP LOCKED`. It deletes Gmail OAuth states expired for more than 24 hours, expires unconsumed Maritime dispatches, deletes service heartbeats expired for more than 7 days, and deletes terminal schedule runs completed more than 30 days ago. It never deletes durable listing, provenance, job-attempt, approval, capture, extraction, or activity evidence.

Founder-release operational targets are 14 days for sanitized logs and 30 daily managed snapshots. They are not enforced by application code. Verify and record the actual Maritime/log and managed-PostgreSQL settings before founder beta; a mismatch remains a release finding. See [`PRIVACY_OPERATIONS.md`](./PRIVACY_OPERATIONS.md) for export, deletion, backup-aging, and provider-outage procedures.

## Alerts

Use only fixed-cardinality dimensions. Alert when readiness is not ready for two checks or five minutes; a required worker/gateway heartbeat is stale for two minutes; the oldest runnable job exceeds ten minutes; a permanent/dead-letter job appears; provider-auth, provider-rate, OAuth, or notification failures reach three in fifteen minutes; pool waiters persist for five minutes or connections fail three times in five minutes; cleanup misses 24 hours; or any backup/restore/migration/rollback validation fails. Never label a metric with a user, listing, URL, source, correlation ID, or raw error.

## Incident notes

- Stop the worker before maintenance that must prevent new job claims.
- Preserve append-only audit and raw evidence; do not manually edit them to repair a projection.
- Revoke or rotate an application credential-encryption key through a separately reviewed re-encryption procedure; keep the old key available until every refresh-token and OAuth-state envelope has been re-encrypted and verified, and never delete a still-referenced key.
- Keep connection URLs, authorization codes, token material, raw email bodies, and personal contacts out of tickets and logs.
