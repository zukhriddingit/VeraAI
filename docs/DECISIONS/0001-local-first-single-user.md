# ADR 0001: Local-first single-user architecture

- Status: Accepted
- Date: 2026-07-17

## Context

Vera must prove that one renter can move from fragmented listing evidence to a safe, approved action faster. It does not yet need tenancy, billing, hosted browser sessions, or marketplace-scale inventory.

The realistic alternatives are:

1. A local web application plus a local worker and database.
2. A single Next.js process that also runs background jobs.
3. A hosted multi-service system with a remote queue and database.

## Decision

Build a pnpm TypeScript monorepo for one local user. Run the Next.js dashboard and route handlers as one Node process, a durable worker as a second Node process, and SQLite as the shared per-user store.

Bind local services to loopback. Keep personal data, OAuth tokens, and any future browser profile on the user's machine. Use official OAuth integrations only when the user connects and enables them.

Cloud deployment, multi-user identity, billing, and hosted browser execution are deferred.

## Rationale

This shape preserves the product's human-control and privacy promise while keeping the worker lifecycle independent from Next.js development reloads. It also exercises boundaries that could later move to hosted infrastructure without paying that cost during product discovery.

## Consequences

- The MVP supports one machine, one user, and one active worker.
- Next.js must use the Node runtime, not Edge.
- The worker and web app communicate through repositories and durable jobs, not in-process callbacks.
- SQLite and OS credential-store behavior are part of the supported local environment.
- Remote access, collaboration, and mobile sync are unavailable.
- A clean clone remains useful with sanitized fixtures and no credentials.

## Revisit when

Revisit only after repeated user value, a sustainable source-access strategy, and a concrete multi-device or multi-user requirement are demonstrated.
