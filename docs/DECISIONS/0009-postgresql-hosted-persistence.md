# ADR 0009: PostgreSQL is the hosted persistence engine

Status: accepted
Date: 2026-07-20

## Context

Vera's deterministic Ship Season demo began on SQLite. The hosted application now needs production identity, sessions, encrypted integration credentials, per-user ownership, concurrent web/worker access, safe job claiming, and PostgreSQL-specific transaction behavior. Adding identity to SQLite and migrating it later would create a second sensitive-data migration boundary and preserve unsafe single-owner assumptions in hosted code.

## Decision

PostgreSQL is the primary and only persistence engine for hosted development, staging, and production. Drizzle owns one canonical PostgreSQL migration history under `packages/db/drizzle`, configured through `DATABASE_URL`.

Every private row is owned by a Vera user. Application repositories are asynchronous and tenant-scoped; composite database foreign keys enforce same-owner relationships. The worker receives only a narrow cross-user claim interface and returns to tenant scope immediately after claiming. Hosted identity uses Better Auth with Google `openid`, `email`, and `profile` only. Sensitive integration credentials are encrypted at the application layer before database insertion.

SQLite remains only as `@vera/db/demo`, an explicit deterministic offline adapter with a fixed synthetic owner, sanitized fixtures, no hosted identity, and no integration credential storage. Hosted startup has no database switch and no fallback.

The founder topology is deliberately small: one region, one web instance, one worker instance, and one managed PostgreSQL database.

## Consequences

- PostgreSQL transaction, constraint, JSONB, timestamp, isolation, and concurrent-claim behavior is tested against PostgreSQL rather than inferred from SQLite.
- `pnpm db:seed` is global-policy-only; private fixture data is demo-only.
- Local hosted development requires Docker Compose and identity configuration; the explicit demo remains credential-free.
- Existing canonical/cluster write contracts temporarily require exactly one profile per user. Supporting multiple active profiles requires explicit profile ownership in those domain inputs.
- Deployment must manage migrations, pool budgets, backups, restore rehearsals, and readiness separately from liveness.

## Rejected alternatives

- A general-purpose dual-database abstraction: it would multiply semantics and conceal the production target.
- Adding hosted identity and OAuth credentials to SQLite first: it would defer the riskiest migration and create sensitive local persistence that the hosted product does not need.
- PostgreSQL row-level security for the founder release: repository scoping plus composite ownership constraints provides the required defense while keeping operations simpler. RLS may be reconsidered with a concrete audited need.
- Redis, Kubernetes, read replicas, sharding, or horizontal scaling: none is required for the single-web/single-worker release.
- A general founder-data importer: existing meaningful data is sanitized fixture/demo data and can be reseeded. Any later real founder-data migration requires a separate reviewed utility with explicit mapping and rollback.
