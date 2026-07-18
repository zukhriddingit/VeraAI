# Vera

Vera is a local-first, renter-controlled housing-search copilot. This repository implements Milestones 1 and 2 plus provider-neutral Milestone 3 extraction: a Next.js dashboard, typed health boundary, separate Node worker, strict domain model, migrated SQLite store, transactional repositories, sanitized provenance-preserving fixtures, fail-closed source policy, local fixture/manual capture, deterministic-first structured extraction, and field-level evidence explanations.

The fixture source labels and manual provenance URLs do not access Zillow, Facebook Marketplace, Craigslist, or Apartments.com. The only enabled source connectors read sanitized local fixtures or content pasted/entered by the user. No OAuth flow, browser automation, external action, or arbitrary URL fetch is implemented. Live model extraction is optional and fail-closed; the default runtime performs deterministic extraction with zero model calls.

## Requirements

- Node.js 24 LTS
- pnpm 11.14.0
- Chromium installed through Playwright for browser tests

The repository includes .node-version for version managers that support it.

Verify the runtime before installing:

```bash
node --version
pnpm --version
```

The expected major versions are Node 24 and pnpm 11.14. If pnpm is unavailable, install the pinned version with your preferred version manager or:

```bash
npm install --global pnpm@11.14.0
```

## Clean-clone setup

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The application and automated tests require no credentials. Keep local environment files outside Git; .env.example contains the only supported names for this milestone.

## Run locally

Start the dashboard and worker together:

```bash
pnpm dev
```

Open http://127.0.0.1:3000. The dashboard displays eight canonical listings stitched from twelve sanitized source records. Use `/capture` to submit user-supplied text or structured JSON and `/connectors` to inspect the enabled, disabled, or policy-denied state of every persisted manifest. Captures are accepted by `POST /api/captures`; `GET /api/captures/{rawListingId}` exposes safe processing status and `/captures/{rawListingId}` explains each known or unknown field, evidence snippet, method, and confidence. New captures remain source records; this milestone does not fabricate canonical listings.

Run the worker's finite diagnostic commands:

```bash
pnpm worker:health
pnpm worker:noop
pnpm worker:run-once
```

Run the compiled worker after a build:

```bash
pnpm build
pnpm worker:start -- health
```

The default compiled worker command is long-running and stops gracefully on SIGINT or SIGTERM:

```bash
pnpm worker:start
```

## Root commands

| Command               | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| pnpm dev              | Run the local web and polling worker processes                        |
| pnpm build            | Build every buildable workspace project                               |
| pnpm lint             | Run ESLint with zero warnings allowed                                 |
| pnpm typecheck        | Typecheck root configuration and every workspace project              |
| pnpm format           | Format supported files with Prettier                                  |
| pnpm format:check     | Verify formatting without writing                                     |
| pnpm test             | Run unit, integration, and Playwright tests                           |
| pnpm test:unit        | Run domain, policy, connector, hashing, and worker unit tests         |
| pnpm test:integration | Run SQLite, capture-route, and normalization-worker integration tests |
| pnpm test:e2e         | Run dashboard and manual-capture browser tests                        |
| pnpm db:generate      | Generate a Drizzle SQL migration for review                           |
| pnpm db:migrate       | Create or upgrade the configured SQLite database                      |
| pnpm db:seed          | Insert idempotent sanitized fixtures and policy manifests             |
| pnpm worker:health    | Emit a typed worker health report and exit                            |
| pnpm worker:noop      | Run one no-op job with a correlation ID and exit                      |
| pnpm worker:run-once  | Process at most one normalization job and exit                        |
| pnpm worker:start     | Start the compiled polling worker                                     |

## Workspace

```text
apps/
  web/          Next.js App Router dashboard and local route handlers
  worker/       separate Node lifecycle and durable normalization jobs
packages/
  domain/       Zod schemas and shared domain contracts
  db/           Drizzle schema, migrations, repositories, and fixtures
  connectors/   fixture/manual capture contracts and deterministic normalization
  ai/           provider-neutral contracts, deterministic mock, evidence validation, OpenAI adapter
  policy/       fail-closed manifest registry, kill switches, and domain classification
  scoring/      deterministic scoring boundary
  testing/      sanitized fixture and test-helper boundary
tests/e2e/      Playwright browser tests
docs/           product, safety, architecture, and decision records
```

Internal packages expose TypeScript source to the applications. Next.js transpiles the domain and database runtime packages while keeping the native SQLite driver external. The web route imports the narrow `@vera/db/runtime` subpath, so production builds cannot reach migrations or seed behavior. Esbuild bundles the worker and its internal workspace imports into production ESM.

## Selected versions

Direct versions are exact in package.json and pnpm-lock.yaml.

| Tool              | Version |
| ----------------- | ------- |
| pnpm              | 11.14.0 |
| Next.js           | 16.2.10 |
| React / React DOM | 19.2.7  |
| TypeScript        | 6.0.3   |
| Zod               | 4.4.3   |
| better-sqlite3    | 12.11.1 |
| Drizzle ORM       | 0.45.2  |
| Drizzle Kit       | 0.31.10 |
| Pino              | 10.3.1  |
| OpenAI SDK        | 6.48.0  |
| Vitest            | 4.1.10  |
| Playwright        | 1.61.1  |
| ESLint            | 9.39.5  |
| Prettier          | 3.9.5   |
| esbuild           | 0.28.1  |

TypeScript 6.0.3 is intentional: the current lint toolchain does not yet declare TypeScript 7 support. ESLint 9.39.5 is the newest stable ESLint line supported by every plugin bundled with the selected Next.js configuration. Node 24 is the project target because it is the LTS line documented in ADR 0005.

## Local database

The database filename is `vera.sqlite`. By default it is stored in the current user's application-data directory:

- macOS: `~/Library/Application Support/Vera`
- Windows: `%APPDATA%/Vera`
- Linux: `$XDG_DATA_HOME/vera` or `~/.local/share/vera`

Set `VERA_DATA_DIR` to use another directory. Keep personal databases outside this repository. The connection initializer verifies foreign keys, WAL mode, and a five-second busy timeout.

Migrate before seeding:

```bash
pnpm db:migrate
pnpm db:seed
```

The seed is offline, sanitized, deterministic, and idempotent. Running `pnpm db:seed` twice keeps the same 12 raw records, 12 source records, 8 canonical listings, 3 duplicate clusters, provenance rows, audit-event count, and policy-manifest versions. Later manual captures add immutable raw rows and idempotent normalization jobs without changing the fixture topology.

## Environment

Copy .env.example to an untracked local environment file only when a documented option is needed. Vera recognizes:

- VERA_LOG_LEVEL for structured worker log verbosity.
- VERA_DATA_DIR as an optional SQLite application-data directory.
- VERA_ACTIVE_KILL_SWITCHES as an optional comma-separated set of exact manifest kill-switch keys. For example, `integrations.disabled` denies every connector.
- OPENAI_API_KEY and VERA_LLM_MODEL together enable the live OpenAI Responses provider. If both are absent, Vera is deterministic-only; supplying only one is an error. No model name is hardcoded.
- VERA_LLM_TIMEOUT_MS sets the live request timeout from 1,000 through 30,000 milliseconds and defaults to 20,000.
- VERA_RUN_LIVE_LLM_TESTS must be exactly `1`, in addition to a key and model, for the opt-in live integration test. Merely having credentials never enables a live test.

Do not add API keys, OAuth tokens, browser profiles, cookies, real listing contacts, or personal mailbox data to this repository. Prompts, raw model output, evidence snippets, contacts, credentials, and full URLs are excluded from logs and activity metadata.

## Test boundaries

- Unit tests cover domain schemas, lifecycle transitions, hashing, connector contracts, deterministic normalization, provider configuration, evidence validation, prompt injection, strict OpenAI response parsing, one repair attempt, typed errors, URL classification, fail-closed policy, worker lifecycle, correlation IDs, and graceful signals.
- Integration tests use migrated temporary file databases for pragmas, repositories, idempotency, append-only triggers, rollback, immutable extraction runs, seed cardinality/provenance, capture routes, audit redaction, and provider-aware normalization jobs. The live OpenAI integration is skipped unless all explicit opt-in conditions are present.
- Playwright owns a migrated and seeded artifact database, starts the loopback Next.js and worker processes, confirms the dashboard fixtures, completes one manual text capture without external access, and opens its extraction-evidence detail page.
- CI installs Chromium, runs formatting, linting, typechecking, all tests, and the production build on Node 24.

Tests make no external requests or side effects.

## Troubleshooting

If Playwright reports a missing browser executable:

```bash
pnpm exec playwright install chromium
```

If pnpm reports an unsupported Node engine, switch to Node 24 LTS. Do not weaken the engine range to accommodate an unreviewed runtime.

If port 3000 is already in use, stop the existing process before running pnpm dev or pnpm test:e2e; the supported local URL is intentionally fixed to loopback port 3000.

## Next milestone

Milestone 4 can add deterministic duplicate candidates and canonicalization for newly captured source records. It must retain every source record and field provenance, keep model output out of policy decisions, and continue treating manual URL provenance as inert text rather than a network-fetch instruction.
