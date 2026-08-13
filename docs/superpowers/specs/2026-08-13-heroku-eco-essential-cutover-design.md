# Heroku Eco and Essential-0 Cutover Design

Status: Approved by founder
Date: 2026-08-13
Supersedes: the Heroku Postgres Standard-tier and always-on dyno selections in
`2026-08-13-production-domain-data-cutover-design.md`

## Outcome

Run Vera's authenticated product entirely on Heroku with one Eco web process, one Eco worker
process, and one Heroku Postgres Essential-0 database. Keep the existing Vercel marketing site at
`verahousing.app`. Do not change the signed DigitalOcean OpenClaw Gateway, checkpoint, pairing flow,
or browser policy.

The maximum recurring Heroku price is $10 per month: $5 for the shared Eco dyno plan and $5 for
Essential-0. The founder's active GitHub Student benefit currently applies up to $13 of Heroku
platform credit per month, so this topology is currently fully covered. Credits expire and do not
roll over; billing must be reviewed before the student benefit ends.

## Topology

```text
verahousing.app / www.verahousing.app -> Vercel marketing

app.verahousing.app -> Heroku vera-housing-app
  |-- web.1: Eco, Next.js, /api/ready
  |-- worker.1: Eco, deterministic worker, /health and /ready
  `-- DATABASE_URL -> Heroku Postgres Essential-0, same Heroku app

approved browser job -> Maritime -> existing signed DigitalOcean Gateway
                     -> exactly one explicitly shared browser tab
```

Heroku owns the application and PostgreSQL runtime. Vercel receives no application secrets. The
Gateway image, containers, pairing rules, source limits, and forbidden actions are outside this
release and must not change.

## Runtime and cost constraints

- Subscribe the founder's personal Heroku account to one Eco plan: $5 per month for a shared pool of
  1,000 dyno hours.
- Run exactly one `web` and one `worker` process, both on Eco, from the same reviewed source
  revision.
- Provision exactly one `heroku-postgresql:essential-0` database: $5 per month, 1 GB storage, 20
  connections, and a 4,000-table limit.
- Do not provision another paid add-on or allow an automatic plan upgrade.
- Eco and Basic use the same 0.5 GB memory and CPU class. Eco's accepted tradeoff is sleeping: after
  30 minutes without web traffic, both the web process and this app's Eco worker sleep. The first
  request wakes them after a short delay.
- Eco is suitable for the founder demo and intermittent use, not a 24/7 availability claim. Wake the
  app and verify readiness before a scheduled recording.
- The two processes share 1,000 Eco hours. They must be allowed to sleep; a synthetic uptime pinger
  is prohibited because it could exhaust the monthly pool.
- Check Heroku usage monthly and before the student credit expires. Do not imply that the credit is
  permanent.

## Database constraints

- Provision Essential-0 in the Heroku app's US region under the temporary attachment
  `VERA_GREEN_DATABASE`; do not promote it until restore and validation pass.
- Use provider-managed `DATABASE_URL` credentials and Heroku's required TLS. Do not paste,
  reconstruct, log, or commit the URL.
- Set `VERA_DB_POOL_MAX=3` for both web and worker. Their combined six application connections leave
  capacity for migrations and controlled operator access within Essential-0's 20-connection limit.
- The rehearsed retained database is 338,589,375 bytes across 58 tables, so it fits within the 1 GB
  storage limit. Treat 850,000,000 bytes as an operational stop threshold: archive safely or obtain
  explicit approval for a larger plan before reaching it.
- Essential-0 is a shared Essential-tier database with 99.5% expected uptime and no credential
  management, fork/follow, Postgres logs, or announced maintenance guarantee. These limits are
  acceptable for the founder MVP but must not be described as an HA production database.

## Data-preserving cutover

The verified DigitalOcean source dump and retained source database remain the rollback boundary.
Private evidence records:

- 58 application tables;
- a 13,086,720-byte custom-format dump;
- a 338,589,375-byte rehearsed restored database;
- 16 append-only triggers and 63 tenant foreign keys;
- zero forbidden browser actions.

Provision Essential-0 as an unpromoted green attachment. Restore only into the empty target with the
existing guarded transfer script. Compare all table counts, migration hashes, append-only controls,
tenant foreign keys, and forbidden-action totals against the source manifest. Any unexplained
mismatch stops the release.

Run forward-only migrations and the hosted seed against green, then run the seed a second time and
require zero inserts. Validate candidate web readiness and worker readiness with the exact paired
images staged for Heroku. Database validation must not perform browser research, send email, write a
calendar event, make a payment, or cause any other external side effect.

For promotion:

1. Enable Heroku maintenance mode and scale the worker to zero.
2. Promote `VERA_GREEN_DATABASE` to `DATABASE_URL` through Heroku's attachment mechanism.
3. Release the paired `web` and `worker` images together.
4. Set both process types to Eco and scale each to exactly one.
5. Disable maintenance only after process health and `/api/ready` succeed.

If validation or release fails, keep the source database and verified dump intact. Restore into a
new clean target if needed; never overwrite or destructively repair the source evidence.

## Domain cutover

- Keep `app.verahousing.app` pointed at the existing Heroku app.
- Point apex `verahousing.app` to the existing Vercel marketing project.
- Point `www.verahousing.app` to Vercel and retain its permanent redirect to the apex.
- Do not alter the working product subdomain while changing marketing DNS.

## Acceptance

The cutover is complete only when:

- the green restore matches the retained source manifest exactly before migration;
- the current migration is applied and `/api/ready` returns HTTP 200 with `status: ready`;
- web and worker run from one commit on Eco and pass their health checks;
- readiness succeeds ten times across at least five minutes, allowing for an intentional Eco wake;
- retained listing, provenance, and audit counts remain verified and forbidden actions remain zero;
- `verahousing.app` and `www.verahousing.app` serve or redirect to the marketing site with valid TLS;
- `app.verahousing.app` still serves the authenticated product;
- the only paid Heroku products are Eco and Essential-0, capped at $10 per month; and
- no OpenClaw or Gateway build, publish, restart, credential change, or policy relaxation occurred.
