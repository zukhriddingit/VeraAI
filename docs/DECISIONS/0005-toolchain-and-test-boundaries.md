# ADR 0005: Stable TypeScript toolchain and test boundaries

- Status: Accepted, amended by ADR 0009 for hosted persistence and PostgreSQL integration tests
- Date: 2026-07-17

## Context

The repository is empty apart from planning files, so the first scaffold must choose a reproducible package baseline and exact command contract. “Latest” is not sufficient when peers are incompatible.

On 2026-07-17, TypeScript 7.0.2 was the registry latest, but typescript-eslint 8.64.0 declared support for TypeScript versions below 6.1. Node 26 was Current while Node 24 was LTS.

## Decision

Target Node 24 LTS and pnpm 11.14.0. Pin exact direct dependency versions in the first scaffold and commit pnpm-lock.yaml.

Use:

- Next.js 16.2.10 App Router with React 19.2.7;
- TypeScript 6.0.3 in strict mode;
- Zod 4.4.3;
- PostgreSQL 18.4 with pg 8.16.3, Drizzle ORM 0.45.2, and Drizzle Kit 0.31.10 for hosted environments; SQLite with better-sqlite3 12.11.1 only for the deterministic offline demo;
- tsx 4.23.1 for worker and migration development commands;
- Vitest 4.1.10 for unit and integration projects;
- Playwright 1.61.1 for end-to-end tests;
- ESLint 9.39.5, eslint-config-next 16.2.10, typescript-eslint 8.64.0, and Prettier 3.9.5;
- Pino 10.3.1 for structured, redacted logging;
- openai 6.48.0 and googleapis 173.0.0 only behind provider interfaces.

Do not add Turborepo. Use pnpm recursive scripts and workspace dependency ordering.

The root command contract is:

~~~json
{
  "dev": "pnpm -r --parallel --stream --filter @vera/web --filter @vera/worker run dev",
  "build": "pnpm -r --if-present run build",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "pnpm -r --if-present run typecheck",
  "test": "pnpm run test:unit && pnpm run test:integration && pnpm run test:e2e",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test:e2e": "playwright test",
  "db:generate": "pnpm --filter @vera/db run db:generate",
  "db:migrate": "pnpm --filter @vera/db run db:migrate",
  "db:seed": "pnpm --filter @vera/db run db:seed",
  "worker:start": "pnpm --filter @vera/worker run start"
}
~~~

Vitest unit tests do not use network or persistent developer storage. Persistence-sensitive integration tests apply real migrations to isolated PostgreSQL schemas; explicit demo-adapter tests use temporary SQLite databases. Connector contract tests use sanitized fixtures and fake provider clients. Playwright owns a seeded demo database and fake effects. Live provider checks are opt-in, separately named, and never part of test or CI.

## Rationale

This is the smallest stack that satisfies the requested web, worker, persistence, validation, and test boundaries. Pinning TypeScript 6 avoids a known current peer-range mismatch. Pinning ESLint 9 avoids the current ESLint 10 incompatibility in the import, React, and accessibility plugins consumed by eslint-config-next. Node 24 LTS is a safer project baseline than a Current runtime.

## Consequences

- Dependency upgrades require compatibility review and lockfile diff review.
- Next.js linting uses the ESLint CLI; Next build is not treated as a lint command.
- The PostgreSQL service version must be kept aligned across Compose and CI; the native SQLite driver is required only by the demo adapter and must still be verified on demo platforms.
- Each workspace package owns typecheck and build scripts; root scripts provide the stable contributor interface.
- Live tests cannot be required for a clean clone or CI.
