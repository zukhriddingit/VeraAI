# Vera

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

## Persistence boundaries

- `@vera/db` exposes PostgreSQL configuration, connection, migration, repository, policy, encryption, and worker-queue boundaries.
- Every private PostgreSQL aggregate carries `user_id`. Composite foreign keys prevent a child owned by one user from referencing another user's parent.
- Application services receive repositories already bound to the authenticated session user; route bodies and query parameters cannot select an owner.
- Worker claim methods are the only cross-user interface. They return the owning user with one leased job, then processing narrows to that user's repositories.
- Raw listings, activity events, job attempts, decision histories, and other evidentiary rows are append-only where required.
- `@vera/db/demo` is the explicit deterministic SQLite adapter. It has one fixed synthetic owner and no hosted identity or integration-credential tables.

See [OpenClaw founder setup](docs/OPENCLAW_FOUNDER_SETUP.md), [Google integration setup](docs/GOOGLE_INTEGRATION_SETUP.md), [PostgreSQL operations](docs/POSTGRES_OPERATIONS.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), and [security](docs/SECURITY.md).

The first real browser path is an unsupported, disabled-by-default founder experiment: an authenticated user may capture one already-open exact Zillow listing tab through a selected local OpenClaw `2026.6.33` node/profile. It performs no navigation or site action. Use `pnpm verify:browser-boundaries` to check the static safety surface; the default test suite never invokes OpenClaw.

## Deployment assumptions

The active `founder_core` release uses one region, one hosted web instance, one private Maritime
worker, one managed PostgreSQL database, and no OpenClaw gateway or browser node. Railway or Vercel
may host the authenticated web application only; the already deployed
`https://vera-ai-housing.vercel.app` landing page is separate marketing, not application staging:

- web: `pnpm --filter @vera/web start:hosted`, readiness `/api/ready`;
- worker: deploy the immutable root `Dockerfile` image to Maritime and run `serve`;
- browser: keep `VERA_BROWSER_DISABLED=1` and gateway variables absent.

Run `pnpm db:migrate` as a controlled release step and `pnpm db:seed` after the first migration.
Configure the supported five-minute non-browser reconciliation trigger in the Maritime dashboard
and validate it with `maritime triggers list vera-worker --json`. The separate
`founder_browser_experimental` profile remains `no_go` under ADR 0012. Keep the sum of both bounded
pools below the managed database connection limit. See
[the founder-core staging runbook](docs/FOUNDER_CORE_STAGING_RUNBOOK.md) and
[the Maritime runbook](infra/maritime/README.md). Horizontal scaling, Redis, Kubernetes, replicas,
sharding, and PostgreSQL row-level security are outside the founder-release boundary.

## Safety

No platform scraping, credential login, CAPTCHA bypass, autonomous sending, rental applications, deposits, or payments are implemented. Fixture source labels do not imply live access. Unknown facts remain unknown, deterministic code owns hard constraints, and risk outputs are indicators rather than scam verdicts. Calendar suggestions degrade visibly to Vera's weekly rules when Google cannot be checked; a private tentative hold still requires an exact payload-bound approval and never adds attendees or notifications.
