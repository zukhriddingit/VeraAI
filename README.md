# Vera

Public surfaces are intentionally split: `apps/marketing` serves `verahousing.app`, while
`apps/web` serves the PostgreSQL-backed product at `app.verahousing.app`. The public product demo at
`/demo` is a statically rendered, sanitized fixture walkthrough with no authentication, API,
connector, email, calendar, or browser side effects. See `docs/MARKETING_RELEASE.md` for build,
smoke, and rollback steps.

Vera is a renter-controlled housing-search copilot: it preserves listing evidence, normalizes and deduplicates records, ranks homes against explicit preferences, surfaces evidence-backed risk indicators, and keeps every external action under user control.

Hosted Vera uses PostgreSQL as its only persistence engine. Better Auth provides hosted identity with Google `openid`, `email`, and `profile` scopes only. Calendar uses a separate Google Web Application OAuth client and requests free/busy and owned-event access incrementally; access to either capability is optional. The sanitized offline demo remains available through an explicit SQLite-only launch path and is never a hosted fallback.

## Requirements

- Node.js 24 LTS
- pnpm 11.14.0
- Docker with Compose for local PostgreSQL
- Playwright Chromium for browser tests

Install dependencies and Chromium:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

## Deterministic demo

The fastest credential-free path uses only sanitized fixtures:

```sh
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

Open <http://127.0.0.1:3000>. The explicit demo launcher injects a one-process launch capability; setting `VERA_DEMO_MODE=1` or `VERA_DEMO_DATA_DIR` by itself cannot activate SQLite from a hosted entry point.

## Hosted local development

Start the local database, migrate, and seed global source policies:

```sh
pnpm postgres:up
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:migrate
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:seed
```

Configure the hosted server in your shell or secret manager:

```sh
export DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export VERA_PUBLIC_BASE_URL=http://127.0.0.1:3000
export VERA_AUTH_GOOGLE_CLIENT_ID=your-development-web-client-id
export VERA_AUTH_GOOGLE_CLIENT_SECRET=your-development-web-client-secret
pnpm dev
```

Use separate Google Web Application clients for Vera identity and integration access. Register the exact Calendar callback `http://127.0.0.1:3000/api/integrations/google/calendar/callback`, configure the `VERA_GOOGLE_INTEGRATION_*` values and credential-encryption key described in [Google integration setup](docs/GOOGLE_INTEGRATION_SETUP.md), and never reuse production credentials locally. `pnpm db:seed` creates no user, session, search profile, listing, job, or activity event.

## Commands

| Command                           | Purpose                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm postgres:up`                | Start the local PostgreSQL 18.4 container                                      |
| `pnpm postgres:down`              | Stop local Compose services without deleting the volume                        |
| `pnpm postgres:reset`             | Guarded destructive reset of the exact local `vera` Compose database           |
| `pnpm db:generate`                | Generate a reviewed PostgreSQL Drizzle migration                               |
| `pnpm db:migrate`                 | Apply canonical PostgreSQL migrations from `packages/db/drizzle`               |
| `pnpm db:seed`                    | Idempotently upsert global source-policy manifests only                        |
| `pnpm dev`                        | Start hosted web and PostgreSQL worker processes                               |
| `pnpm worker:start`               | Start the compiled PostgreSQL worker                                           |
| `pnpm verify:db-boundaries`       | Reject hosted imports of the SQLite demo adapter                               |
| `pnpm verify:calendar-boundaries` | Reject broad Calendar scopes, notifications, and unsupported event methods     |
| `pnpm verify:browser-boundaries`  | Reject OpenClaw navigation, side-effect, secret, and demo-boundary regressions |
| `pnpm verify:maritime-boundaries` | Reject Maritime payload, version, runtime-CLI, and client-secret regressions   |
| `pnpm maritime:validate`          | Validate pinned worker/gateway deployment assets without network access        |
| `pnpm openclaw:version`           | Verify the pinned OpenClaw `2026.6.33` CLI                                     |
| `pnpm openclaw:register-node`     | Synchronize one manually verified founder node/profile; source stays disabled  |
| `pnpm lint`                       | Run ESLint with zero warnings                                                  |
| `pnpm typecheck`                  | Typecheck every workspace                                                      |
| `pnpm test:unit`                  | Run deterministic unit tests                                                   |
| `pnpm test:integration`           | Run explicit SQLite/demo and web contract tests                                |
| `pnpm test:integration:postgres`  | Run PostgreSQL constraints, isolation, transactions, and concurrency tests     |
| `pnpm test:e2e`                   | Run the deterministic Playwright flow                                          |
| `pnpm build`                      | Build the Next.js web app and Node worker                                      |
| `pnpm listing-integrity:repair`   | Preview/apply/verify an exact append-only private corpus repair                |
| `pnpm privacy:reapply-deletions`  | Reapply strict deletion receipts to an operator-confirmed restored database    |

## Persistence boundaries

- `@vera/db` exposes PostgreSQL configuration, connection, migration, repository, policy, encryption, and worker-queue boundaries.
- Every private PostgreSQL aggregate carries `user_id`. Composite foreign keys prevent a child owned by one user from referencing another user's parent.
- Application services receive repositories already bound to the authenticated session user; route bodies and query parameters cannot select an owner.
- Worker claim methods are the only cross-user interface. They return the owning user with one leased job, then processing narrows to that user's repositories.
- Raw listings, activity events, job attempts, decision histories, and other evidentiary rows are append-only where required.
- Authenticated users can export or delete only their own account under **Settings → Privacy**.
  Deletion uses a one-time challenge and a receipt-gated owner cascade; restored databases remain
  offline until the protected receipt ledger is reapplied.
- `@vera/db/demo` is the explicit deterministic SQLite adapter. It has one fixed synthetic owner and no hosted identity or integration-credential tables.

See [OpenClaw founder setup](docs/OPENCLAW_FOUNDER_SETUP.md), [Google integration setup](docs/GOOGLE_INTEGRATION_SETUP.md), [PostgreSQL operations](docs/POSTGRES_OPERATIONS.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), and [security](docs/SECURITY.md).

The real browser path remains a disabled-by-default founder experiment for Zillow, Apartments.com,
Facebook Marketplace, configurable Off Campus Partners portals, custom public housing sites, and
Craigslist. BU Off-Campus is the first registered Off Campus Partners configuration. Custom source
configuration stays in the founder's browser and each run carries an exact signed start URL and
allowed domain. A user-triggered search first imports result-card evidence without waiting for detail
pages. Vera may then enrich the top three records per enabled browser source, an opened or shortlisted
listing, or an explicit **Refresh details** request. Enrichment is limited to exact observed
same-source listing URLs, at most two concurrent detail jobs, bounded retries, and read-only semantic
snapshots. It stops for an unshared tab, login, 2FA, CAPTCHA, checkpoint, consent, rate limit,
blocking, redirect, or unrecognized layout, and it never selects contact, reply, application, tour,
message, payment, upload, or download controls. Source-hosted photo URLs are validated but are not
downloaded or rehosted. Craigslist alert-email and manual-capture paths remain available. Use `pnpm
verify:browser-boundaries` to check the static safety surface; the default test suite never invokes a
live browser or consumer site.

Retained-data corrections use `pnpm listing-integrity:repair` in three explicit modes: `preview`,
`apply`, and `verify`. The command accepts the database URL, user ID, reviewed source-record IDs, and
preview artifact only through permission-restricted files under `/private/tmp` or
`release-evidence/private`. Preview is read-only and binds the exact corpus revision and hash; apply
appends dispositions and audit evidence before enqueueing normal deterministic reconciliation;
verify proves counts did not decrease and forbidden browser actions remain zero. The command never
deletes source evidence, invokes a browser, fetches a URL or image, or edits canonical rows directly.

## Production topology

The production application critical path is one Heroku app and one same-region managed Heroku
Postgres database. The desired state is machine-checked by `pnpm verify:heroku-production` against
`infra/heroku/production-manifest.json`:

- marketing: `https://verahousing.app` on the existing Vercel project, with `www` redirected to the
  apex;
- product: `https://app.verahousing.app` on Heroku, readiness `/api/ready`;
- web: exactly one `Dockerfile.web` process;
- deterministic worker: exactly one repository-root `Dockerfile` process, released with web from the
  same reviewed commit;
- persistence: Heroku Postgres Essential-0 in the same region, with controlled migrations, managed
  backups, and portable logical backups;
- approved browser work: Heroku worker → Maritime orchestration → unchanged signed DigitalOcean
  OpenClaw Gateway → exactly one explicitly shared local tab.

Maritime remains the browser-orchestration and dispatch boundary; consumer browser sessions and
credentials never enter Heroku. A Maritime outage makes browser research visibly unavailable but
does not take down the inbox or deterministic PostgreSQL work. A normal application release never
builds, pushes, restarts, or reconfigures OpenClaw.

`railway.toml` is retained as historical/recovery configuration. Railway is not in the production
request path, and its removed web/database deployments must not be described as live. Run
`pnpm db:migrate` and `pnpm db:seed` as controlled steps against an unpromoted database, then release
the verified Heroku web and worker images together. Keep the combined bounded pools below the
managed database connection limit. See [PostgreSQL operations](docs/POSTGRES_OPERATIONS.md) and the
[Maritime browser runbook](infra/maritime/README.md).

## Safety

No platform scraping, credential login, CAPTCHA bypass, autonomous sending, rental applications, deposits, or payments are implemented. Fixture source labels do not imply live access. Unknown facts remain unknown, deterministic code owns hard constraints, and risk outputs are indicators rather than scam verdicts. Calendar suggestions degrade visibly to Vera's weekly rules when Google cannot be checked; a private tentative hold still requires an exact payload-bound approval and never adds attendees or notifications.
