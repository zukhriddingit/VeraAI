# PostgreSQL Identity and Tenant Isolation Design

Status: approved
Date: 2026-07-20
Scope: prerequisite hosted persistence and Vera identity milestone before Gmail/Calendar Milestone 6

## Goal

Make PostgreSQL the primary and only hosted persistence engine, establish authenticated Vera users and database-enforced tenant ownership, and preserve the deterministic offline demo through an explicitly isolated SQLite adapter. The milestone must keep one domain model, one asynchronous repository contract, and one application-service layer. It must not implement Gmail alert ingestion, Gmail draft creation, Calendar access, or any other Google data capability.

The approved founder-release topology is one region, one web instance, one worker instance, and one managed PostgreSQL database. Horizontal scaling is not required yet.

## Binding decisions

1. `@vera/db` is PostgreSQL-backed in normal development, staging, and production.
2. Shared repository contracts become asynchronous. Application code does not hide PostgreSQL calls behind blocking wrappers.
3. The existing SQLite adapter moves behind the explicit `@vera/db/demo` export and can be constructed only by a demo-specific composition root.
4. Production web and worker entry points import PostgreSQL composition directly. There is no database-selection environment variable and no PostgreSQL-to-SQLite fallback.
5. Better Auth provides Vera identity and sessions. The first login method is Google Sign-In with only `openid email profile` through a Google Web Application OAuth client dedicated to Vera authentication.
6. Google mailbox and Calendar authorization will use a separate OAuth client and incremental flows in Milestone 6. No Gmail or Calendar scope is requested in this milestone.
7. Every private application row carries tenant ownership. Composite tenant foreign keys prevent a child owned by one user from referencing another user's parent.
8. PostgreSQL row-level security is not added in the founder milestone. Isolation is enforced by scoped repositories, composite constraints, and tests.
9. PostgreSQL migrations are the canonical hosted migration history. The old SQLite migration history remains only with the offline demo adapter.
10. Existing deterministic/content-addressed application IDs remain text. UUIDs are used for new auth, session, integration, and other identities for which UUIDs are intended.

## Current-state inventory

The current Drizzle SQLite schema contains 29 tables, 24 unique indexes, 23 regular indexes, 3 composite primary keys, 36 foreign keys, 91 check constraints, and 45 JSON-as-text columns. Persisted instants are ISO strings in text columns. Money is already integer minor units.

### Current tables

| Area | Tables |
| --- | --- |
| Search and evidence | `search_profiles`, `raw_listings`, `listing_source_records`, `listing_photos`, `field_provenance`, `listing_extractions` |
| Acquisition and normalization | `normalization_jobs`, `source_jobs`, `source_job_attempts`, `browser_nodes` |
| Decision engine | `decision_corpus_state`, `decision_jobs`, `decision_job_attempts`, `decision_runs`, `duplicate_pair_evaluations`, `duplicate_overrides`, `duplicate_override_revocations`, `canonical_decision_runs` |
| Canonical projections | `duplicate_clusters`, `canonical_listings`, `canonical_listing_sources`, `canonical_field_sources`, `listing_scores`, `risk_signals` |
| User actions | `contact_workflows`, `approvals`, `viewings`, `activity_events` |
| Global policy | `source_policy_manifests` |

Append-only SQLite triggers currently reject updates and deletes for raw listings, activity events, source/decision attempts, extraction runs, decision histories, overrides and revocations, scores, and risk snapshots. The PostgreSQL baseline must preserve the same immutability with PostgreSQL trigger functions.

### Current atomic operations

Existing transaction boundaries include:

- fixture/global-policy seeding;
- raw import plus normalization-job enqueue plus audit event;
- normalization completion plus source record, provenance, immutable extraction, decision revision, and audit event;
- decision-job claim, failure, and result application;
- source-job transition plus attempt append;
- shortlist or dismissal lifecycle transition plus activity event;
- duplicate override plus decision-job enqueue.

The PostgreSQL unit-of-work contract must preserve these operations without exposing raw `pg` or Drizzle transaction objects to application services.

### Existing local data

The standard local production SQLite path does not exist. The only discovered database is the deterministic Vera Demo database with one seeded profile, twelve sanitized raw listings, and two activity events. This is reseedable fixture data, not meaningful founder data. No one-time SQLite-to-PostgreSQL importer will be built. This decision must be revisited only if a later pre-cutover inventory finds non-demo data.

## Stable implementation baseline

Versions were verified against the npm registry or authoritative upstream documentation on 2026-07-20:

| Concern | Version |
| --- | --- |
| PostgreSQL | 18.4 for local Docker; managed hosted PostgreSQL 18.x |
| `pg` | 8.22.0 |
| `@types/pg` | 8.20.0 |
| Drizzle ORM | existing 0.45.2 |
| Drizzle Kit | existing 0.31.10 |
| Better Auth | 1.6.23 |
| `@better-auth/drizzle-adapter` | 1.6.23 |

PostgreSQL 18 is the current stable major line, and 18.4 is the current security/bug-fix release. Better Auth 1.6.23 supports Next.js 16, React 19, PostgreSQL, Drizzle 0.45.2, and `better-sqlite3` 12 for the isolated demo tests.

Authoritative references:

- [PostgreSQL 18.4 documentation](https://www.postgresql.org/docs/current/)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth database schema](https://better-auth.com/docs/concepts/database)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth account token encryption and database-backed OAuth state](https://better-auth.com/docs/reference/options)

## Package and composition boundaries

### Shared contracts

`packages/db/src/repositories.ts` remains free of PostgreSQL, SQLite, Drizzle, and driver types. All repository methods return promises. Representative shapes are:

```ts
export interface SearchProfileRepository {
  insert(profile: SearchProfile): Promise<SearchProfile>;
  getById(id: string): Promise<SearchProfile | null>;
  list(): Promise<readonly SearchProfile[]>;
  count(): Promise<number>;
}

export interface UserUnitOfWork {
  readonly searchProfiles: SearchProfileRepository;
  readonly rawListings: RawListingRepository;
  readonly canonicalListings: CanonicalListingRepository;
  readonly approvals: ApprovalRepository;
  readonly activityEvents: ActivityEventRepository;
  // Remaining user-owned repositories follow the same boundary.
}

export interface UserRepositoryProvider {
  forUser(userId: VeraUserId): UserUnitOfWork;
  transaction<T>(
    userId: VeraUserId,
    operation: (repositories: UserUnitOfWork) => Promise<T>
  ): Promise<T>;
}
```

The exact final names may follow existing repository conventions, but these properties are normative:

- a user ID is captured when scoped repositories are constructed;
- normal application methods do not accept an arbitrary user ID;
- transaction callbacks receive only the same user's repositories;
- every write is awaited;
- application and domain packages import no database library types.

### System worker boundary

The worker needs a narrowly scoped system interface to claim the next runnable job across tenants. It does not receive an unscoped general repository collection.

```ts
export interface WorkerQueueRepository {
  claimNextNormalizationJob(input: ClaimNormalizationJob): Promise<OwnedNormalizationJob | null>;
  claimNextDecisionJob(input: ClaimDecisionJob): Promise<OwnedDecisionJob | null>;
  claimNextSourceJob(input: ClaimSourceJob): Promise<OwnedSourceJob | null>;
}
```

Each claimed record includes its immutable owning user ID. The worker then constructs that user's scoped unit of work for subsequent reads and writes.

### Explicit composition roots

The implementation creates three explicit constructors:

- `createPostgresApplication(...)`: hosted web, Better Auth, pooled PostgreSQL, tenant-scoped services;
- `createPostgresWorker(...)`: hosted worker, PostgreSQL queue claims, graceful shutdown;
- `createDemoApplication(...)`: deterministic local demo, explicit SQLite demo adapter.

Production web and worker modules import only the first two. `createDemoApplication` asserts an explicit demo invocation token supplied by the demo entry point; setting a generic database environment variable cannot activate it.

The normal production composition performs no conditional database selection. A missing or unreachable PostgreSQL database fails startup readiness and never creates a SQLite file.

## Tenant ownership model

### Authentication tables

Better Auth owns these PostgreSQL tables, using plural names and UUID primary keys:

- `users`;
- `sessions`;
- `accounts`;
- `verifications`.

The user row is the canonical tenant identity. Email comparison uses a normalized unique value appropriate to Better Auth's verified Google identity flow. Session and account foreign keys use database enforcement.

### Private application tables

Every current table except `source_policy_manifests` receives `user_id`. New `integration_connections` rows are also user-owned. Parent tables expose a unique `(user_id, id)` key, and private child relations use composite `(user_id, parent_id)` foreign keys.

This intentionally duplicates `user_id` onto child rows. It is not denormalized authorization truth; it is a database-enforced ownership constraint that prevents cross-tenant graphs even if application code is wrong.

Private repository queries always include the captured `user_id`. A request for another user's identifier returns not found rather than revealing that the row exists. No admin or cross-tenant browser is included.

### Global policy

`source_policy_manifests` remains global, immutable/versioned policy configuration. It defines a capability ceiling and cannot grant a user integration. User-specific connection and capability state belongs to `integration_connections` and later integration-specific policy state. A user setting can narrow global policy, never broaden it.

## PostgreSQL type mapping

| SQLite representation | PostgreSQL representation | Notes |
| --- | --- | --- |
| ISO instant in `text` | `timestamptz` | Row mappers convert `Date` to the domain's ISO string at the repository boundary. |
| ISO calendar date in `text` | `date` | Search move-in and justified availability dates remain date-only. |
| JSON serialized in `text` | `jsonb` | Used for schema-validated structured values that are not relational query keys. |
| Boolean integer | `boolean` | No integer/boolean arithmetic checks. |
| Money integer | `integer` or `bigint` minor units | No floating point. Current validated range fits PostgreSQL integer; any expansion requires an explicit domain change. |
| Half-unit rooms | `smallint` half-units | Domain row mappers preserve half-unit semantics. |
| Microdegrees/meters/basis points | integer | Existing deterministic representation remains. |
| Deterministic application IDs | `text` | Content-addressed and fixture IDs are intentionally not rewritten as UUIDs. |
| Auth/integration IDs | `uuid` | Database or application-generated UUIDs as configured through Better Auth and domain schemas. |
| Scope sets | `text[]` | Unique, sorted, schema-validated scope strings. |
| Encrypted bytes | `bytea` | Ciphertext, nonce, and authentication tag are separate from metadata. |

Closed lifecycle/status vocabularies continue as text plus database check constraints rather than PostgreSQL enum types. This preserves explicit validation while avoiding difficult enum rollback and expansion semantics.

All uniqueness and foreign-key rules remain database enforced. SQLite-specific boolean arithmetic, lexical timestamp checks, and table-recreation assumptions are rewritten for PostgreSQL semantics.

## Identity and hosted route protection

Better Auth configuration is server-only and uses:

- Google Web Application authorization-code flow;
- only `openid`, `email`, and `profile` scopes;
- a Google OAuth client dedicated to Vera authentication;
- exact environment-specific base URL, redirect URI, and trusted origin configuration;
- database-backed OAuth state;
- encrypted account OAuth tokens;
- server-side callback exchange;
- secure, HTTP-only, same-site cookies in production;
- account linking restricted to the trusted Google provider with different-email linking disabled;
- no client-side ID-token sign-in escape hatch;
- no offline access request for identity login.

Public hosted routes are limited to sign-in/auth callbacks, liveness/readiness, and required public legal pages. Every other server component and API route validates the database session before using private data. A proxy may perform an optimistic cookie redirect, but it is not authorization; the route/service performs the authoritative database session check.

Authentication and Google data access use different client IDs and environment-variable namespaces. Login success cannot grant Gmail or Calendar access.

`VERA_DEMO_MODE=1` remains insufficient to activate the SQLite adapter through hosted entry points. The demo script invokes a separate entry point that supplies the explicit demo capability. Demo repositories bind all fixture behavior to a deterministic demo-user context but persist no hosted user, session, account, or integration credential table.

## Integration credential encryption boundary

The identity migration establishes the persistence and crypto boundary needed by Milestone 6 without contacting Gmail or Calendar.

`integration_connections` stores only:

- Vera user ID;
- provider and provider subject ID;
- display email where appropriate;
- encrypted refresh-token material;
- granted scopes;
- access-token expiry metadata;
- connection status;
- last successful use;
- created and updated timestamps.

No Gmail message, authorization code, client secret, plaintext access token, or mailbox body belongs in this table.

### Encryption

A `CredentialKeyProvider` supplies versioned 256-bit keys from the hosted secret manager. The production environment provides a current key ID and a key map; neither values nor derived keys are logged. Tests use an in-memory provider.

Refresh-token material is encrypted with AES-256-GCM. The authenticated associated data binds the envelope to the Vera user ID, integration ID, provider, and envelope version so ciphertext cannot be moved to another tenant or row. PostgreSQL stores:

- algorithm version;
- key ID;
- nonce;
- ciphertext;
- authentication tag.

Decryption failures return a typed authentication/reconnect state without exposing cryptographic details. Raw SQL integration tests confirm that a synthetic plaintext token is absent from every stored column and captured log.

Better Auth's account token storage separately enables `account.encryptOAuthTokens`. The identity provider is not configured for offline access, so it should not receive a Google refresh token; any account token Better Auth persists is encrypted before it reaches PostgreSQL.

## PostgreSQL connection and transaction behavior

### Pooling

Each hosted web or worker process creates one module-level `pg.Pool`. Pool limits, connection timeout, statement timeout, lock timeout, and idle-in-transaction timeout are parsed from bounded configuration. Requests never create pools or direct database connections.

Founder defaults are deliberately small because the topology has one web and one worker instance. The sum of both pool maxima must remain below the managed database connection limit with operational headroom.

SIGINT and SIGTERM stop new work, await active work within a bounded grace period, and call `pool.end()`. The worker stops polling before closing its pool.

### Transactions and concurrency

Transactions are short and never wrap network or AI calls. The scoped unit-of-work callback is the only application-facing transaction mechanism.

- Lifecycle transitions select/lock the canonical listing, validate the domain transition, update with the expected current state, and append the audit event atomically.
- Raw ingestion relies on tenant-scoped idempotency uniqueness and resolves a unique conflict to the existing row.
- Normalization and decision apply operations preserve their existing all-or-nothing groups.
- Worker claims use `FOR UPDATE SKIP LOCKED` inside the status transition transaction so concurrent workers cannot lease the same job.
- Source-job transition plus immutable attempt append remains atomic.
- Serialization/deadlock errors are typed and retried only at explicitly safe, idempotent boundaries with a bounded attempt count.

## Health, readiness, and failure model

`GET /api/health` reports process liveness without claiming database readiness. `GET /api/ready` performs a bounded PostgreSQL probe and confirms the expected migration state. It returns 503 with safe metadata when the database is missing, unavailable, timed out, or behind the required schema.

Hosted deployment health checks use `/api/ready`. Missing or malformed `DATABASE_URL`, failed migration readiness, or initial connection failure prevents readiness and causes hosted startup/restart behavior. No failure path opens SQLite.

Database errors are mapped to typed categories:

- configuration;
- unavailable/timeout;
- validation;
- not found;
- conflict/idempotency;
- foreign-key/ownership violation;
- transaction serialization/deadlock;
- internal.

Logs contain category, correlation ID, safe operation name, and retryability only. SQL parameter values, connection URLs, credentials, private content, and provider tokens are excluded. Cross-user lookups return the same not-found response as missing rows.

## Migration history and cutover

PostgreSQL receives a new canonical Drizzle migration history under the normal `packages/db/drizzle` path. The existing six SQLite migrations and snapshots move under a demo-only path exported by `@vera/db/demo`; documentation does not present them as hosted migrations.

The initial PostgreSQL baseline creates auth identities, tenant-owned application tables, global policy manifests, indexes, checks, composite foreign keys, and immutable trigger functions. No production identity data is inserted until the complete tenant schema has migrated successfully.

Cutover sequence:

1. Inventory synchronous repository calls and atomic use cases.
2. Convert contracts, services, routes, workers, seeds, scripts, and test doubles to awaited asynchronous APIs.
3. Implement and test the PostgreSQL schema and repositories.
4. Switch hosted web and worker composition roots to PostgreSQL.
5. Add Better Auth and protect hosted routes.
6. Move SQLite code and history behind `@vera/db/demo`.
7. Update demo commands to use the demo composition root.
8. Enforce import boundaries and remove remaining production `better-sqlite3` imports.
9. Run PostgreSQL migrations, contract/parity tests, concurrency tests, full tests, typecheck, lint, and build.

There is no dual write and no automatic import. Because only reseedable demo data exists, PostgreSQL development starts from migrations plus global policy seed. If meaningful founder data appears before cutover, implementation stops and adds a separately reviewed one-time importer rather than silently dropping it.

## Local development, seed, and reset

`compose.yaml` provides pinned PostgreSQL 18.4 development and test services with health checks. The root exposes one startup command:

```sh
pnpm postgres:up
```

The documented hosted-development sequence is:

```sh
cp .env.example .env.local
pnpm postgres:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:seed` inserts only global policy templates idempotently. It does not create a fake hosted user. An explicit development-only fixture command may seed a named existing user and must reject production environments.

Database reset is development-only, explicit, and restricted to the Compose database. It is never a generic `DATABASE_URL` destructive command. The deterministic demo retains its separate exact commands:

```sh
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

The demo commands import only `@vera/db/demo` and visibly label SQLite as sanitized offline storage.

## Test design

### Shared contract suite

A shared repository-contract suite accepts an adapter fixture. It runs against PostgreSQL and the SQLite demo subset for:

- create/read/update behavior;
- uniqueness and foreign-key enforcement;
- idempotent raw ingestion;
- lifecycle/shortlist transitions;
- activity ordering;
- transaction rollback;
- canonical/source membership relationships.

PostgreSQL is authoritative when database-specific behavior differs.

### PostgreSQL integration suite

Persistence-sensitive tests run against real PostgreSQL 18.4, not mocks or SQLite. Test setup creates an isolated schema/database namespace, applies canonical migrations, and tears it down. CI starts the same major version as a service.

Required coverage:

- unique, check, and foreign-key constraints;
- composite per-user ownership rejection and scoped not-found behavior;
- transaction rollback;
- idempotent ingestion under concurrent attempts;
- concurrent shortlist/lifecycle transitions with one legal outcome per transition;
- concurrent job claiming without duplicate execution;
- append-only audit and decision history;
- JSONB round-trip and strict schema parsing;
- timestamptz round-trip across non-UTC process time zones;
- encrypted credential persistence and ciphertext ownership binding;
- bounded pool configuration and graceful shutdown;
- liveness versus readiness behavior;
- PostgreSQL connection failure with no SQLite fallback.

### Identity and boundary tests

- unauthenticated hosted pages redirect or APIs return 401;
- expired/revoked sessions fail;
- a request cannot choose a user ID;
- another user's identifier returns not found;
- Google login configuration contains only identity scopes;
- Better Auth account token encryption is enabled;
- demo startup rejects normal hosted composition;
- production imports cannot reference `@vera/db/demo` or `better-sqlite3`;
- application/domain packages cannot import `pg`, Drizzle, or database schema modules.

ESLint restricted-import rules and a small boundary verification script enforce these import constraints without adding a general architecture framework.

The existing deterministic Playwright flow remains credential-free. Hosted auth tests use local test doubles or seeded Better Auth sessions and never call Google.

## Deployment, backup, and rollback

Hosted assumptions:

- one region;
- one web instance;
- one worker instance;
- one managed PostgreSQL 18 database;
- TLS database connection required outside local Compose;
- migrations run as a release step before readiness;
- no Redis, replica, sharding, Kubernetes, or horizontal scaling.

Backups use managed daily snapshots plus a documented periodic `pg_dump --format=custom --no-owner` export. Restore documentation uses a new or maintenance database and `pg_restore`; a restore rehearsal is required before public production. Logs and backup artifacts are treated as sensitive.

Drizzle migrations are forward migrations. Before a destructive migration, take and verify a snapshot. Rollback means deploying compatible application code and, when the schema is not backward compatible, restoring the pre-migration snapshot. This founder release does not build a complex zero-downtime or automatic down-migration system.

Railway or another host must provide `DATABASE_URL`, Better Auth secrets, authentication Google client credentials, exact public base URL, and encryption key configuration through environment-specific secret management. Development, staging, and production use separate databases and separate OAuth clients.

## Documentation changes

Implementation updates:

- `.env.example`;
- `README.md`;
- `docs/ARCHITECTURE.md`;
- `docs/DATA_MODEL.md` and its Mermaid diagram;
- `docs/SECURITY.md`;
- `docs/SOURCE_POLICY.md` where identity affects policy evaluation;
- `docs/DEMO.md` and `docs/DEMO_NOW.md`;
- deployment documentation and `railway.toml`;
- a PostgreSQL operations document covering local startup, migration, backup, restore, and rollback;
- an ADR recording PostgreSQL as hosted persistence and SQLite as demo-only.

Production documentation must not advertise SQLite as a supported hosted database.

## Non-goals

- Gmail alert ingestion, Gmail drafts, Calendar scopes, or Google data OAuth;
- multi-provider Vera login;
- user invitation, organizations, teams, roles, or admin impersonation;
- row-level security;
- Redis or external queues;
- read replicas, sharding, multi-region, or horizontal scaling;
- automatic SQLite-to-PostgreSQL data import;
- a generic dual-database abstraction;
- zero-downtime schema migration machinery.

## Acceptance criteria

The milestone is complete only when:

1. Hosted web and worker import and construct PostgreSQL directly.
2. A missing/unready PostgreSQL database fails readiness with no SQLite fallback.
3. All shared repository contracts are asynchronous and every consumer awaits them.
4. Private data access is scoped by authenticated user and protected by composite tenant constraints.
5. Better Auth Google login requests only identity scopes and persists encrypted provider token material.
6. Credential envelope tests prove plaintext tokens are absent from PostgreSQL and logs.
7. PostgreSQL-specific rollback, concurrency, job claim, timezone, JSONB, immutability, and idempotency tests pass.
8. The shared repository contract suite passes for PostgreSQL and the approved SQLite demo subset.
9. SQLite imports exist only under the demo adapter and explicit demo composition.
10. Deterministic demo startup and E2E flow remain working without credentials.
11. Local Compose startup, migrations, global seed, hosted development, and demo commands are documented and verified.
12. Lint, typecheck, unit tests, PostgreSQL integration tests, E2E tests, and production build pass.

## Following milestone

After this milestone is verified, Gmail/Calendar Milestone 6 receives a separate design and implementation plan on top of the secured tenant foundation. That milestone will add `/settings/integrations`, incremental Google data authorization, Gmail alert ingestion, payload-bound draft approval, `drafts.create` only, disconnect/revocation, and Google verification documentation. It will not reuse Vera login grants or broaden identity scopes.
