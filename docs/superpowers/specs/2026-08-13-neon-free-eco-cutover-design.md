# Neon Free and Heroku Eco Cutover Design

Status: Approved by founder
Date: 2026-08-13
Supersedes: the Heroku Postgres Standard-tier and always-on dyno selections in
`2026-08-13-production-domain-data-cutover-design.md`

## Outcome

Keep Vera's authenticated application on Heroku while removing the unapproved paid database plan.
Production uses one Heroku Eco web process, one Heroku Eco worker process, and one Neon Free
PostgreSQL project. The existing Vercel marketing project serves `verahousing.app`; the signed
DigitalOcean OpenClaw Gateway and checkpoint remain unchanged.

This is the lowest-cost viable topology for the founder demo. The active Heroku platform credits
currently cover the $5 monthly Eco subscription. Neon Free requires no database subscription. A
card may be charged after the Heroku credits expire unless the Eco subscription is cancelled or new
credits are available, so credit expiration and monthly usage remain an operator responsibility.

## Topology

```text
verahousing.app / www.verahousing.app -> Vercel marketing

app.verahousing.app -> Heroku vera-housing-app
  |-- web.1: Eco, Next.js, /api/ready
  |-- worker.1: Eco, deterministic worker, /health
  `-- pooled TLS connection -> Neon Free PostgreSQL, AWS US East

approved browser job -> Maritime -> existing signed DigitalOcean Gateway
                     -> exactly one explicitly shared browser tab
```

Heroku remains the only application runtime. Neon is only the PostgreSQL provider. Vercel receives
no application secrets. The Gateway image, containers, pairing rules, source bounds, and forbidden
actions are outside this release and must not change.

## Runtime and cost constraints

- Subscribe the founder's personal Heroku account to one Eco plan: $5 per month for a shared pool of
  1,000 dyno hours.
- Run exactly one `web` and one `worker` process, both on Eco, from the same reviewed source revision.
- Do not provision a Heroku Postgres add-on or any other paid add-on.
- Eco processes may sleep after web inactivity and may have a cold start. Because the application
  includes a web process, its Eco worker sleeps with the app rather than acting as an always-awake
  background worker.
- Eco is appropriate for the founder demo and intermittent product use, not a 24/7 availability
  claim. Operators must wake and verify the app before a scheduled recording.
- The two processes share the 1,000-hour pool. Usage must be checked monthly; this design does not
  promise that two continuously awake processes fit within the pool.

## Database constraints

- Create one Neon Free project in AWS US East, near Heroku's US region.
- Use the direct TLS endpoint only for restore and controlled migrations. Use Neon's pooled TLS
  endpoint for web and worker runtime connections.
- Set `VERA_DB_POOL_MAX=3` so one web and one worker remain within conservative connection bounds.
- Keep `sslmode=require`; do not disable certificate validation or add a CA-file workaround.
- Neon Free currently limits a project to 0.5 GB of storage. The rehearsed retained database is
  338,589,375 bytes across 58 tables, so it fits at cutover but has limited growth headroom.
- Treat 450,000,000 bytes as the operational stop threshold. Before the database reaches it, archive
  safely or obtain explicit approval for a paid migration; never allow an automatic paid upgrade.
- Free-tier scale-to-zero, compute, egress, recovery-window, and no-SLA limits are accepted. These
  limits must be visible in the operator runbook and must not be described as always-on production
  guarantees.

## Data-preserving cutover

The verified DigitalOcean source dump and source database remain the rollback boundary. The current
private evidence records:

- 58 application tables;
- a 13,086,720-byte custom-format dump;
- a 338,589,375-byte rehearsed restored database;
- 16 append-only triggers and 63 tenant foreign keys;
- zero forbidden browser actions.

Create the Neon target without promoting it to Heroku. Restore only into an empty target using the
existing guarded transfer script. Compare all table counts, migration hashes, append-only controls,
tenant foreign keys, and forbidden-action totals against the source manifest. Any unexplained
mismatch stops the release.

Run forward-only migrations and the hosted seed against Neon, then run the seed a second time and
require zero inserts. Validate candidate web readiness and worker health using the exact paired
images already staged for Heroku. No live browser research, email send, calendar write, payment, or
other external action is part of database validation.

For promotion:

1. Enable Heroku maintenance mode and scale the worker to zero.
2. Replace `DATABASE_URL` with the Neon pooled TLS URL through private configuration without
   printing it.
3. Release the paired `web` and `worker` images together.
4. Set both process types to Eco and scale each to exactly one.
5. Disable maintenance only after process health and `/api/ready` succeed.

If validation or release fails, keep the DigitalOcean source database and verified dump intact,
restore into a new clean Neon target if needed, and do not repair or overwrite immutable source
evidence in place.

## Domain cutover

- Keep `app.verahousing.app` pointed at the existing Heroku app.
- Point apex `verahousing.app` to the Vercel marketing project.
- Point `www.verahousing.app` to Vercel and retain its permanent redirect to the apex.
- Do not alter the working product subdomain while changing marketing DNS.

## Acceptance

The cutover is complete only when:

- the Neon restore matches the retained source manifest exactly before migration;
- the current migration is applied and `/api/ready` returns HTTP 200 with `status: ready`;
- web and worker run from one commit on Eco and pass their health checks;
- readiness remains successful across ten checks spanning at least five minutes, allowing for an
  intentional Eco wake-up;
- retained listing/provenance/audit counts remain verified and forbidden actions remain zero;
- `verahousing.app` and `www.verahousing.app` serve/redirect to the marketing site with valid TLS;
- `app.verahousing.app` still serves the authenticated product;
- no Heroku Postgres or other paid add-on exists; and
- no OpenClaw or Gateway build, publish, restart, credential change, or policy relaxation occurred.
