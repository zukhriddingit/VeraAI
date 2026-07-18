# ADR 0002: SQLite, Drizzle, and a leased local worker queue

- Status: Accepted
- Date: 2026-07-17

## Context

Ingestion, extraction, canonicalization, scoring, and connector work need retries, idempotency, and crash recovery. Running those jobs only in Next.js is fragile, while Redis/BullMQ or a hosted queue would add another service to a single-user local product.

The web and worker also need a transactional source of truth for immutable evidence, canonical state, approvals, and activity events.

## Decision

Use SQLite through better-sqlite3 and Drizzle. Use reviewed SQL migrations. Enable foreign keys, WAL mode, and a bounded busy timeout on every connection.

Implement a small database-backed job table with:

- typed job kind and schema-validated payload;
- unique stable idempotency key;
- queued, running, retryable, succeeded, and dead-letter states;
- run-after time and bounded attempts;
- lease owner and lease expiry;
- last typed error metadata.

One local worker atomically claims work in a short immediate transaction, commits before I/O, and completes or reschedules in another short transaction. Expired leases are recoverable after a crash.

Raw evidence and activity-event migrations add triggers that reject updates and deletes.

## Rationale

SQLite already supplies the atomicity and durability Vera needs at MVP scale. A leased table avoids a second datastore and keeps integration tests deterministic. Drizzle supplies typed schema/query support without hiding SQL or migration behavior.

## Consequences

- Only one worker process is supported.
- The database cannot live on a network filesystem.
- Network and LLM calls cannot occur inside transactions.
- Long writes and unbounded polling are prohibited.
- Integration tests use real migrations against isolated temporary databases.
- Job metrics and dead-letter recovery need a local health view.
- Scaling beyond one host will require a new queue/database decision.

## Alternatives rejected

- Next.js-only jobs: rejected because development reloads and request lifetimes are not durable schedulers.
- Redis/BullMQ: rejected as unnecessary operational complexity.
- PostgreSQL: rejected because multi-user/server deployment is outside the MVP.
- An ORM-managed push workflow: rejected because migrations must be explicit and reviewable.
