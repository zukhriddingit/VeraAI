# Heroku Eco and Essential-0 Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Vera's retained PostgreSQL data and run the production product on one Heroku Eco web dyno, one Eco worker dyno, and Heroku Postgres Essential-0 for at most $10 per month while preserving all OpenClaw boundaries.

**Architecture:** Heroku runs the paired application images and owns the attached Essential-0 database. Vercel continues to serve only the marketing domain, while Maritime and the immutable DigitalOcean Gateway retain the existing bounded browser path. The cutover restores into an unpromoted green attachment, verifies exact data controls, promotes through Heroku, and releases both process types together.

**Tech Stack:** TypeScript, pnpm, Vitest, Docker/OCI, Heroku Common Runtime and Container Registry, Heroku Postgres Essential-0, PostgreSQL client tools, Vercel, Name.com DNS.

## Global Constraints

- Maximum recurring Heroku price: $10 per month, comprising Eco at $5 and Essential-0 at $5.
- Run exactly one Eco `web` and one Eco `worker` process from the same reviewed source revision.
- Provision exactly one `heroku-postgresql:essential-0` database under `VERA_GREEN_DATABASE` until validation passes.
- Set `VERA_DB_POOL_MAX=3`; never disable PostgreSQL TLS or print a database URL.
- Preserve the DigitalOcean source database, verified private dump, Railway recovery volume, PostgreSQL data, and all listing evidence.
- Do not build, publish, restart, reconfigure, pair, or weaken OpenClaw or the Gateway.
- Do not perform browser research, email sends, calendar writes, payments, uploads, downloads, or other external actions during validation.
- Do not use an uptime pinger; Eco web and worker must be allowed to sleep.
- Keep `app.verahousing.app` on Heroku and move only apex/www marketing DNS to Vercel.

---

### Task 1: Enforce the approved production contract

**Files:**
- Modify: `infra/heroku/production-manifest.json`
- Modify: `scripts/verify-heroku-production.ts`
- Modify: `scripts/verify-heroku-production.unit.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `docs/RELEASE_READINESS.md`

**Interfaces:**
- Consumes: `findHerokuProductionViolations()` and the non-secret Heroku production manifest.
- Produces: CI-enforced Eco and Essential-0 topology with explicit cost, storage, connection, and safety limits.

- [ ] **Step 1: Change the unit-test fixture first**

Use this manifest shape:

```ts
processes: {
  web: { dockerfile: "Dockerfile.web", quantity: 1, dynoSize: "eco", readinessPath: "/api/ready" },
  worker: { dockerfile: "Dockerfile", quantity: 1, dynoSize: "eco", readinessPath: "/health" }
},
database: {
  provider: "heroku-postgresql",
  plan: "essential-0",
  attachment: "VERA_GREEN_DATABASE",
  sameRegion: true,
  storageBytes: 1_000_000_000,
  connectionLimit: 20,
  poolMaxPerProcess: 3
},
billing: { maximumMonthlyUsd: 10, automaticUpgrade: false }
```

Add negative fixtures for Basic dynos, a non-Essential plan, more than $10, automatic upgrade, and a pool greater than three.

- [ ] **Step 2: Run the focused test and require failure**

```sh
pnpm vitest run --project unit scripts/verify-heroku-production.unit.test.ts
```

Expected: FAIL because the verifier and manifest still encode the old Standard-tier topology.

- [ ] **Step 3: Implement the manifest and verifier change**

Extend `HerokuProductionManifest` with `dynoSize`, `plan`, numeric database limits, and billing. Reject unless it specifies Eco/Eco, Essential-0, the green attachment, same region, 1,000,000,000 storage bytes, 20 connections, pool maximum three, $10 maximum monthly price, and no automatic upgrade.

- [ ] **Step 4: Update operator documentation**

Replace Standard-0 provisioning with:

```sh
heroku addons:create heroku-postgresql:essential-0 --app vera-housing-app --as VERA_GREEN_DATABASE --wait
```

Document `VERA_DB_POOL_MAX=3`, the 850,000,000-byte stop threshold, Eco sleep/wake behavior, the ban on synthetic pingers, the $10 ceiling, and Essential-tier limitations.

- [ ] **Step 5: Verify and commit**

```sh
pnpm vitest run --project unit scripts/verify-heroku-production.unit.test.ts
pnpm verify:heroku-production
pnpm format:check
git add infra/heroku/production-manifest.json scripts/verify-heroku-production.ts scripts/verify-heroku-production.unit.test.ts docs/ARCHITECTURE.md docs/POSTGRES_OPERATIONS.md docs/RELEASE_READINESS.md
git commit -m "build: enforce Eco and Essential-0 production"
```

Expected: all checks exit zero before commit.

### Task 2: Review, publish, and merge the follow-up contract

**Files:**
- Inspect: all changes since `origin/main`

**Interfaces:**
- Consumes: the reviewed production contract and focused tests.
- Produces: one merged source revision as the application-release authority.

- [ ] **Step 1: Run repository gates**

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
git diff --check origin/main...HEAD
```

Expected: all commands exit zero.

- [ ] **Step 2: Audit the diff**

Search for credentials, database URLs, tokens, OpenClaw mutations, plans above the ceiling, disabled TLS, browser-policy changes, and unrelated code. Remove every finding before publishing.

- [ ] **Step 3: Push and open one ready PR**

```sh
git push -u origin codex/heroku-eco-essential-cutover
gh pr create --base main --head codex/heroku-eco-essential-cutover --title "build: deploy Vera on Eco and Essential-0" --body-file /private/tmp/vera-production-cutover/pr-body.md
```

Expected: one ready PR describing cost, data, sleep, rollback, and OpenClaw exclusions.

- [ ] **Step 4: Require green CI and merge**

```sh
gh pr checks --watch PR_NUMBER
gh pr merge PR_NUMBER --merge --delete-branch=false
```

Expected: every required check passes and GitHub returns a merge commit.

### Task 3: Provision the approved Heroku resources

**Files:**
- Private write: `/private/tmp/vera-production-cutover/green-database-url.txt`
- Private evidence: `/private/tmp/vera-production-cutover/heroku-pre-cutover.json`

**Interfaces:**
- Consumes: merged source SHA, active student credit, existing Heroku app, verified source dump.
- Produces: Eco entitlement and an empty, unpromoted Essential-0 database.

- [ ] **Step 1: Capture current non-secret state**

Record app identity, region, release, formations, add-on inventory, domain status, and billing product names. Confirm there is no Heroku Postgres add-on before creating one.

- [ ] **Step 2: Subscribe to Eco**

Use the founder's personal-account billing flow to subscribe to the $5 Eco plan. Stop if the displayed price differs, a Team is selected, or checkout introduces another product.

- [ ] **Step 3: Provision green Essential-0**

```sh
heroku addons:create heroku-postgresql:essential-0 --app vera-housing-app --as VERA_GREEN_DATABASE --wait
heroku pg:wait --app vera-housing-app
```

Stop if Heroku quotes anything other than Essential-0 at maximum $5 per month.

- [ ] **Step 4: Save the green URL privately**

Under `umask 077`, write `VERA_GREEN_DATABASE_URL` to the private file without echoing it and set mode `0600`. Assert it is non-empty and no secret reached terminal output or Git.

### Task 4: Restore and validate retained data

**Files:**
- Read: `/private/tmp/vera-production-cutover/source.dump`
- Read: `/private/tmp/vera-production-cutover/source-manifest.json`
- Private write: `/private/tmp/vera-production-cutover/restore-verification.json`

**Interfaces:**
- Consumes: verified custom-format dump and empty green Essential-0 database.
- Produces: exact pre-migration copy, current schema, idempotent hosted seed, and candidate runtime evidence.

- [ ] **Step 1: Verify evidence integrity**

Recompute the dump SHA-256 and compare it with `cec182cf8c97b62551b6155bafbefa1f47a0360de99b713fd4a8fd5407738f3c`. Require file modes `0600`, list the dump, and refuse a target with application tables.

- [ ] **Step 2: Restore through the guard**

```sh
pnpm postgres:production-transfer restore --database-url-file /private/tmp/vera-production-cutover/green-database-url.txt --dump-file /private/tmp/vera-production-cutover/source.dump --confirm-empty-target
```

Expected: restore completes without a destructive source operation.

- [ ] **Step 3: Compare the exact manifest**

```sh
pnpm postgres:production-manifest compare --database-url-file /private/tmp/vera-production-cutover/green-database-url.txt --expected-file /private/tmp/vera-production-cutover/source-manifest.json --output-file /private/tmp/vera-production-cutover/restore-verification.json
```

Expected: 58 tables match, with 16 append-only triggers, 63 tenant foreign keys, and zero forbidden browser actions.

- [ ] **Step 4: Migrate, seed, and validate candidate images**

Load `DATABASE_URL` process-locally from the private file without printing it. Run `pnpm db:migrate`, then `pnpm db:seed` twice and require the second seed to report `inserted: 0`. Run reviewed web and worker images against green with integrations/browser work disabled; require web `/api/ready`, worker `/ready`, and one deterministic no-side-effect job.

### Task 5: Promote and release atomically

**Files:**
- Private evidence: `/private/tmp/vera-production-cutover/heroku-promotion.json`

**Interfaces:**
- Consumes: verified green database and paired images labeled with the merged SHA.
- Produces: live Eco web and worker on promoted Essential-0.

- [ ] **Step 1: Reconcile staged image revision**

If staged images are not labeled with the merged SHA, rebuild and push only `Dockerfile.web` and repository-root `Dockerfile` for `linux/amd64`, Docker V2 media types, and the same revision label. Never build or publish OpenClaw/Gateway.

- [ ] **Step 2: Enter maintenance and stop worker**

```sh
heroku maintenance:on --app vera-housing-app
heroku ps:scale worker=0 --app vera-housing-app
```

- [ ] **Step 3: Set the pool, promote, release, and scale Eco**

```sh
heroku config:set VERA_DB_POOL_MAX=3 --app vera-housing-app
heroku pg:promote VERA_GREEN_DATABASE --app vera-housing-app
heroku container:release web worker --app vera-housing-app
heroku ps:type web=eco worker=eco --app vera-housing-app
heroku ps:scale web=1 worker=1 --app vera-housing-app
```

Expected: `DATABASE_URL` is provider-managed without being printed, one release contains both process types, and both are Eco.

- [ ] **Step 4: Exit maintenance after readiness**

Wait for both processes. Require worker `/ready` and product `/api/ready` to succeed before `heroku maintenance:off`.

### Task 6: Complete domains and production acceptance

**Files:**
- Private evidence: `/private/tmp/vera-production-cutover/final-acceptance.json`

**Interfaces:**
- Consumes: ready Heroku product, Vercel domain configuration, and Name.com DNS authority.
- Produces: final evidence for product, marketing, data, billing, and browser safety.

- [ ] **Step 1: Apply only required marketing DNS**

At Name.com set apex `A` to `216.198.79.1` and `www` CNAME to `e265c493acf12116.vercel-dns-017.com`. Preserve the `app` CNAME. Never request, type, or retain a Name.com password.

- [ ] **Step 2: Verify readiness across five minutes**

Request `https://app.verahousing.app/api/ready` ten times across at least five minutes. Require HTTP 200, `status: ready`, database available, and current migration every time after the initial intentional wake.

- [ ] **Step 3: Verify product, data, domains, billing, and exclusions**

Confirm founder authentication, inbox, listing detail, photos/placeholders, original links, provenance, activity history, one idempotent deterministic worker result, safe table/control counts, and forbidden actions zero. Require apex marketing, permanent `www` redirect, product at `app`, and valid TLS. Confirm only Eco and Essential-0 recur for at most $10/month. Confirm OpenClaw/Gateway image, containers, pairing, and browser policies were not mutated and shared tabs/connections remain zero.

- [ ] **Step 4: Report acceptance**

Report the interactive URL, database verification, process topology, readiness window, marketing domains, forbidden-action count, PR and merge commit, monthly maximum, Eco cold-start caveat, and recording readiness. Retain the private dump and DigitalOcean source database until separately authorized for cleanup.
