# Vera Milestone 1 Skeleton Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session. Steps use checkbox syntax for tracking.

**Goal:** Build a production-quality pnpm TypeScript monorepo whose web health slice, worker lifecycle, tests, CI, and clean-clone commands all pass without credentials.

**Architecture:** Next.js runs the loopback dashboard and typed health route. A separate Node worker owns lifecycle and no-op job behavior, while internal packages establish source-level workspace boundaries; esbuild bundles the worker into production ESM. Vitest separates unit and integration projects, and Playwright verifies the browser-visible health slice.

**Tech Stack:** Node 24 LTS target, pnpm 11.14.0, Next.js 16.2.10, React 19.2.7, TypeScript 6.0.3, Zod 4.4.3, Pino 10.3.1, Vitest 4.1.10, Playwright 1.61.1, ESLint 9.39.5, Prettier 3.9.5, esbuild 0.28.1.

## Global Constraints

- Keep all external connectors, OAuth, database domain work, cloud deployment, browser automation, and LLM calls out of Milestone 1.
- Use strict TypeScript and no explicit any.
- Bind local web services to 127.0.0.1.
- Make every test deterministic and credential-free.
- Keep package versions exact and commit the generated pnpm lockfile when a Git repository exists.
- Preserve all product and safety documents.

## File map

- Root configuration: package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs, prettier.config.mjs, vitest.config.ts, playwright.config.ts.
- Safety/contributor files: .env.example, .gitignore, README.md, .github/workflows/ci.yml.
- Web slice: apps/web/package.json, apps/web/tsconfig.json, apps/web/next.config.ts, apps/web/app/layout.tsx, apps/web/app/page.tsx, apps/web/app/dashboard-health.tsx, apps/web/app/globals.css, apps/web/app/api/health/route.ts.
- Worker slice: apps/worker/package.json, apps/worker/tsconfig.json, apps/worker/src/index.ts, apps/worker/src/cli.ts, apps/worker/src/lifecycle.ts, apps/worker/src/logger.ts.
- Shared contract: packages/domain/package.json, packages/domain/tsconfig.json, packages/domain/src/health.ts, packages/domain/src/index.ts.
- Empty package boundaries: packages/db, packages/connectors, packages/ai, packages/policy, packages/scoring, and packages/testing, each with package.json, tsconfig.json, and src/index.ts.
- Tests: apps/web/app/api/health/route.integration.test.ts, apps/worker/src/lifecycle.unit.test.ts, tests/e2e/dashboard.spec.ts.

---

### Task 1: Workspace and shared tooling

**Interfaces:**

- Produces root commands dev, build, lint, typecheck, test, test:unit, test:integration, test:e2e, format, format:check, worker:health, worker:noop, and worker:start.
- Produces TypeScript aliases and workspace package discovery for apps/* and packages/*.

- [ ] Create the root package manifest with exact versions and the command contract from ADR 0005.
- [ ] Create pnpm-workspace.yaml, strict tsconfig.base.json, flat ESLint config, Prettier config, named Vitest projects, and Playwright configuration.
- [ ] Create safe .env.example and comprehensive .gitignore.
- [ ] Run pnpm install and verify a lockfile is generated.

Expected verification:

~~~bash
pnpm install
pnpm exec tsc --version
pnpm exec vitest --version
~~~

Expected versions include TypeScript 6.0.3 and Vitest 4.1.10.

### Task 2: Shared domain health contract and package boundaries

**Interfaces:**

- Produces createHealthReport(input: HealthReportInput): HealthReport.
- Produces HealthReportSchema and HealthReport types.
- Produces importable @vera/domain, @vera/db, @vera/connectors, @vera/ai, @vera/policy, @vera/scoring, and @vera/testing boundaries.

- [ ] Define a Zod health schema with service, status, version, checkedAt, and runtime.node fields.
- [ ] Implement createHealthReport with injected time, service, version, and Node version.
- [ ] Create all remaining package manifests, strict tsconfigs, and intentionally empty public entrypoints.
- [ ] Run package typechecks.

Expected verification:

~~~bash
pnpm -r --filter "./packages/**" run typecheck
~~~

Expected result: all package typechecks exit successfully.

### Task 3: Web health vertical slice

**Interfaces:**

- GET /api/health returns HealthReport with service vera-web.
- DashboardHealth fetches /api/health, validates it, and renders loading, online, or unavailable state.

- [ ] Write the route integration test that calls GET, expects status 200, parses the payload with HealthReportSchema, and confirms vera-web/ok.
- [ ] Implement the Node-runtime route with no caching and typed JSON.
- [ ] Build the accessible dashboard shell with semantic headings, visible local-only status, and an aria-live health region.
- [ ] Add responsive CSS without a component framework.
- [ ] Run the integration test.

Expected verification:

~~~bash
pnpm test:integration
~~~

Expected result: the health route integration test passes.

### Task 4: Worker lifecycle and no-op job

**Interfaces:**

- createWorkerLifecycle(dependencies) returns start, runNoopJob, stop, and isRunning.
- installGracefulShutdown(source, shutdown) registers SIGINT and SIGTERM and returns cleanup.
- CLI commands health and noop terminate; the default command waits for graceful shutdown.

- [ ] Write unit tests for start/no-op/stop events, correlation IDs, invalid lifecycle ordering, and signal-triggered shutdown.
- [ ] Implement Pino JSON logging with safe base fields and redaction paths.
- [ ] Implement the lifecycle with injected logger, clock, and ID generator.
- [ ] Implement CLI commands health, noop, and long-running start without process.exit.
- [ ] Bundle worker production ESM with esbuild and run narrow tests.

Expected verification:

~~~bash
pnpm test:unit
pnpm worker:health
pnpm worker:noop
pnpm --filter @vera/worker run build
pnpm worker:start -- health
~~~

Expected result: tests pass; health and no-op commands emit JSON; the built command exits successfully.

### Task 5: E2E, CI, README, and completion audit

**Interfaces:**

- Playwright starts the web app on 127.0.0.1 and verifies the dashboard reaches Online.
- CI executes install, format check, lint, typecheck, test, and build on Node 24.
- README provides exact clean-clone and daily commands.

- [ ] Write the Playwright dashboard smoke test.
- [ ] Add the GitHub Actions workflow with pinned major action versions and Chromium installation.
- [ ] Write README setup, architecture, command, environment, and troubleshooting instructions.
- [ ] Install Chromium and run the E2E test.
- [ ] Run formatting, lint, typecheck, all tests, build, worker commands, and an HTTP smoke check.
- [ ] Scan the resulting tree for secrets, forbidden integrations, explicit any, placeholders, and generated artifacts.

Expected acceptance:

~~~bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
~~~

Every command must exit zero from the repository root.
