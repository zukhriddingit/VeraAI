# Milestone 2 domain and persistence design

Status: ready for implementation review  
Date: 2026-07-17

## Goal

Implement Vera's credential-free deterministic core: strict domain contracts, explicit listing state transitions, a migrated SQLite store, transactional repositories, immutable raw evidence and audit events, an idempotent sanitized seed, and a dashboard view over seeded canonical listings.

This milestone performs no platform access. Zillow, Facebook Marketplace, Craigslist, and Apartments.com are fixture source labels only. Fixture URLs use the reserved `example.invalid` domain, contacts are omitted, and no connector, scraper, remote image fetch, OAuth flow, AI call, email action, calendar action, or browser automation is introduced.

## Chosen approach

Use a relational core with Zod-validated JSON columns for bounded composite values.

- Relational tables, foreign keys, unique constraints, checks, and triggers protect identity, membership, lifecycle, idempotency, and append-only invariants.
- JSON text stores values such as preferences, amenities, score factors, evidence, and manifest capabilities when normalizing them into more tables would not improve an MVP query or invariant.
- Every JSON value is parsed through its domain Zod schema at repository boundaries. Repositories never return unchecked decoded JSON.
- The database package owns SQLite and Drizzle. Domain remains persistence-agnostic and depends only on Zod and standard-library types.

Fully normalizing every preference and evidence fragment was rejected as unnecessary schema complexity. A document-first database shape was rejected because it would weaken foreign-key, provenance, lifecycle, and append-only enforcement.

## Domain conventions

- IDs are non-empty opaque strings. Seed IDs are stable and human-readable; runtime IDs are injected by callers.
- Times are UTC ISO 8601 strings validated with offsets.
- Money is integer cents in USD. A missing amount is `null`, never zero.
- Confidence is an integer from 0 through 10,000 basis points.
- Missing facts are represented by `null` or an absent collection entry, never a guessed boolean or empty placeholder.
- Schema objects are strict so unrecognized fields fail validation.
- Serialized hashes are lowercase 64-character SHA-256 hex strings.
- Stored JSON is canonicalized before hashing and validated after reading.

## Domain concepts

### SearchProfile

A versioned renter preference snapshot containing name, location text, bedroom and bathroom minima, target and absolute maximum monthly cost, move-in range, pet requirements, commute anchors, hard constraints, weighted preferences, notification rules, and timestamps. Complex preference collections are strict discriminated objects, not arbitrary dictionaries.

### RawListing

An immutable evidence snapshot containing source label, optional source listing ID, inert source URL, capture method, observed and optional source-posted times, optional raw text, optional raw JSON, capture metadata, deterministic content hash, and deterministic idempotency key. At least one of raw text or raw JSON is required. A URL is provenance only and is never fetched.

### ListingSourceRecord

A normalized interpretation of exactly one RawListing. It stores source identity, title, normalized address and unit, monthly rent and known recurring fees, beds, baths, square feet, property type, availability, lease term, pet policy, amenities, description, completeness, extraction confidence, and timestamps. Unknown normalized fields remain `null`.

### ListingPhoto

Metadata for photo evidence already present in a fixture or explicitly supplied capture. It records the source record, inert URL or fixture asset label, optional byte hash, optional perceptual hash, ordering, and observed time. This milestone does not download images.

### FieldProvenance

One record per normalized field observation. It identifies the ListingSourceRecord, RawListing, field path, extraction method (`fixture_structured`, `manual`, `rule`, or `ai`), confidence basis points, observed time, and optional evidence excerpt. The seed uses only `fixture_structured`.

Canonical field selection is represented separately by a mapping from `(canonicalListingId, fieldPath)` to one FieldProvenance row. This makes the source of every displayed canonical field explicit without a polymorphic foreign key.

### DuplicateCluster

Metadata for a canonical grouping with at least two source records, including algorithm version, deterministic cluster key, reason codes, created time, and member source-record IDs. Source records are referenced through canonical membership rows and are never deleted by clustering.

### CanonicalListing

The user-facing stitched record. It stores selected values, freshness, completeness, an explicit listing lifecycle state, an optional duplicate cluster, a primary source record, and timestamps. Every canonical listing has one or more source memberships. Selected canonical fields have canonical field-source mappings.

### ListingScore

An immutable, versioned score snapshot containing the canonical listing, optional search profile, algorithm version, input hash, total score basis points, factor results, reason codes, and computation time. This milestone validates and persists scores but does not implement ranking algorithms.

### RiskSignal

An evidence-backed indicator containing code, severity, confidence, evidence items, source-record references, a verification action, status, and timestamps. The vocabulary avoids definitive fraud or scam verdicts. This milestone validates and persists signals but does not calculate them.

### ContactWorkflow

A workflow state holder for a canonical listing with channel, recipient reference, missing-fact questions, draft reference, explicit state, and timestamps. Recipient references must be opaque; seed data contains none. No external effect method is added.

### Approval

A single-use, payload-bound approval record containing actor, connector, operation, target, canonical payload hash, created time, expiry time, optional use time, and state. This milestone stores the concept only; it does not authorize an effect.

### Viewing

A proposed or confirmed viewing record with canonical listing, candidate windows, optional confirmed window, IANA time zone, optional opaque calendar reference, explicit state, notes, and timestamps. The schema cannot represent attendees or provider notification behavior in this milestone.

### ActivityEvent

An append-only event containing correlation and optional causation IDs, actor, action, target, policy decision, optional approval ID, payload hash, outcome, optional typed error category, safe metadata, and occurrence time. Raw message bodies, contacts, credentials, and tokens are excluded.

### SourcePolicyManifest

A strict, versioned, fail-closed manifest containing connector ID, source label, enabled flag, execution mode, closed namespaced capabilities, user-session and approval requirements, minimum interval, allowlisted domains, kill-switch state, and notes. The fixture seed does not enable platform connectors. Missing, malformed, unknown, or disabled capability state is a denial for later policy work.

## Listing lifecycle

The canonical listing state vocabulary is:

```text
new
shortlisted
draft_ready
draft_created
draft_rejected
replied
follow_up_due
tour_proposed
tour_scheduled
toured
applying
passed
dismissed
stale
unavailable
```

Allowed transitions are explicit:

| From | To |
| --- | --- |
| `new` | `shortlisted`, `dismissed`, `stale`, `unavailable` |
| `shortlisted` | `draft_ready`, `dismissed`, `stale`, `unavailable` |
| `draft_ready` | `draft_created`, `draft_rejected`, `dismissed`, `stale`, `unavailable` |
| `draft_rejected` | `draft_ready`, `dismissed`, `stale`, `unavailable` |
| `draft_created` | `replied`, `follow_up_due`, `dismissed`, `stale`, `unavailable` |
| `follow_up_due` | `replied`, `dismissed`, `stale`, `unavailable` |
| `replied` | `tour_proposed`, `dismissed`, `stale`, `unavailable` |
| `tour_proposed` | `tour_scheduled`, `replied`, `dismissed`, `stale`, `unavailable` |
| `tour_scheduled` | `toured`, `dismissed`, `unavailable` |
| `toured` | `applying`, `passed` |
| `applying` | `passed` |
| terminal states | no transitions |

Terminal states are `passed`, `dismissed`, `stale`, and `unavailable`.

`transitionListingLifecycle(current, next)` returns the validated next state or a typed `InvalidListingTransitionError`. Repositories expose a transition method that reads the current state and applies this function in a transaction. They expose no general lifecycle update method. The dashboard is read-only in this milestone.

## Deterministic hashing and import idempotency

The database package implements a small canonical JSON serializer that recursively sorts object keys, preserves array order, rejects non-JSON values, and emits UTF-8 JSON. The raw content hash is SHA-256 over a versioned canonical object containing only exact captured evidence:

```text
raw-content:v1:{canonical JSON of rawText, rawJson, and captureMetadata}
```

The raw import idempotency key is SHA-256 over:

```text
raw-import:v1:{sourceLabel}:{sourceListingId-or-sourceUrl-or-none}:{contentHash}
```

`raw_listings.idempotency_key` is unique. Reimporting identical evidence returns the existing RawListing and `inserted: false`; it does not append a duplicate activity event or recreate downstream records. New evidence for the same source listing receives a new content hash and snapshot.

## SQLite schema

The first reviewed migration creates:

- `search_profiles`
- `raw_listings`
- `listing_source_records`
- `listing_photos`
- `field_provenance`
- `duplicate_clusters`
- `canonical_listings`
- `canonical_listing_sources`
- `canonical_field_sources`
- `listing_scores`
- `risk_signals`
- `contact_workflows`
- `approvals`
- `viewings`
- `activity_events`
- `source_policy_manifests`

Foreign keys use restrictive deletes for evidence and audit relationships. Required checks cover confidence ranges, non-negative monetary values, lifecycle/state vocabularies, source membership, and valid optional-field combinations. Unique indexes cover raw idempotency keys, cluster keys, source-record-to-canonical membership, canonical field selections, and manifest connector/version identity.

SQLite triggers reject every `UPDATE` and `DELETE` against `raw_listings` and `activity_events`. Repository interfaces also omit update/delete methods for both concepts. The trigger layer protects the invariant even if future code bypasses the repository.

Every connection executes:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Initialization verifies that foreign keys are enabled and that file-backed databases entered WAL mode. Integration tests use unique temporary file databases because SQLite in-memory databases cannot exercise WAL behavior faithfully.

## Database location and commands

`VERA_DATA_DIR` selects an explicit data directory. Without it, the default is the current user's application-data directory:

- macOS: `~/Library/Application Support/Vera`
- Windows: `%APPDATA%/Vera`
- Linux: `$XDG_DATA_HOME/vera` or `~/.local/share/vera`

The database filename is `vera.sqlite`. The directory is created with owner-only permissions where the platform supports POSIX modes. Database files remain ignored by Git.

Commands:

```text
pnpm db:generate  # generate a reviewed Drizzle SQL migration
pnpm db:migrate   # initialize the configured database and apply migrations
pnpm db:seed      # apply the idempotent sanitized fixture seed transaction
```

Migration and seed entrypoints return a non-zero exit code on validation or persistence failure and never fall back to another path.

## Repository design

`packages/db` exports repository interfaces plus a SQLite implementation constructed from an initialized database connection.

The interfaces are grouped by invariant rather than exposing a generic table gateway:

- `RawListingRepository.import` and `getById`
- `ActivityEventRepository.append` and ordered read methods
- `ListingRepository.getCanonical`, `listCanonical`, and `transitionLifecycle`
- repositories for profiles, source records/provenance, scores, risks, workflows, approvals, viewings, and manifests with only domain-appropriate operations
- `VeraRepositories.transaction`, which supplies transaction-bound repositories to one synchronous callback

The SQLite implementation parses all inputs and outputs with domain schemas. It uses Drizzle for typed queries and explicit SQL only for connection pragmas, migrations, trigger verification, and transaction behavior not represented by the query builder.

Seed ingestion is one transaction. A thrown error rolls back raw listings, source records, provenance, canonical listings, memberships, clusters, and activity events together. No network or asynchronous external operation runs inside a transaction.

## Sanitized seed topology

The seed contains exactly 12 RawListing rows and 12 ListingSourceRecord rows producing exactly 8 CanonicalListing rows.

| Canonical fixture | Member count | Source labels | Purpose |
| --- | ---: | --- | --- |
| `can-juniper-1a` | 3 | Zillow, Craigslist, Apartments.com | duplicate cluster with differing price/fee freshness |
| `can-harbor-studio` | 2 | Facebook Marketplace, Craigslist | duplicate cluster with missing unit and square footage |
| `can-maple-2b` | 2 | Zillow, Apartments.com | duplicate cluster with incomplete pet policy |
| `can-orchard-loft` | 1 | Facebook Marketplace | singleton with unknown availability |
| `can-cedar-flat` | 1 | Craigslist | singleton with unknown recurring fees |
| `can-river-house` | 1 | Zillow | singleton with incomplete square footage |
| `can-pine-studio` | 1 | Apartments.com | singleton with unknown pet policy |
| `can-market-3c` | 1 | Facebook Marketplace | singleton with unknown lease term |

All street names and facts are synthetic. URLs use `https://example.invalid/fixtures/...`; raw fixture payloads state that they are sanitized synthetic data. No email address, phone number, account identifier, tracking parameter, credential, or real-person name is present.

Every normalized non-null field has at least one FieldProvenance row. Every displayed canonical field maps to one of those provenance rows. The three duplicate clusters retain all seven member source records; the five singletons retain their own source records.

Seeding is idempotent. Stable fixture IDs and uniqueness constraints allow a second `pnpm db:seed` to complete without changing row counts or event counts.

## Dashboard data flow

The web application depends on `@vera/db` only from a Node-runtime route handler. A typed, read-only `GET /api/listings` endpoint opens the configured database, reads canonical listings with source labels and duplicate counts, validates the response with a domain schema, and returns `Cache-Control: no-store`.

The dashboard client validates the response before rendering listing cards. Cards show title, location, known rent, beds/baths, lifecycle, freshness, source labels, duplicate count, and explicit `Unknown` labels for missing fields. No action or lifecycle mutation control is added.

If the database is absent, unmigrated, malformed, or unreadable, the endpoint returns a typed 503 response without a filesystem path or internal error detail. The dashboard shows a safe local setup message containing only `pnpm db:migrate` and `pnpm db:seed`. It does not auto-migrate, auto-seed, substitute fixture JSON, or silently use another database.

Playwright uses an isolated data directory under its test artifacts. Its web-server command migrates and seeds that database before starting Next.js. Production build does not open or mutate the database.

## Testing strategy

### Unit

- Every required domain schema accepts a representative valid object and rejects unknown properties or invalid ranges.
- Nullable listing facts preserve unknown rather than coercing values.
- Every allowed lifecycle edge succeeds.
- Representative skipped, reversed, and terminal-state transitions throw the typed transition error.
- Canonical JSON and hashes are stable across object-key order and change when evidence changes.

### Repository integration

Each test creates a unique temporary directory and file database, initializes pragmas, and applies the real migration.

- WAL mode and foreign keys are active.
- Valid records round-trip through Zod-validated repositories.
- Identical raw imports return the existing ID and do not increase row counts.
- Changed evidence creates a new immutable snapshot.
- Repository interfaces expose no raw/event update or delete operation.
- Direct SQL updates and deletes against raw listings and activity events fail through triggers.
- Invalid foreign keys fail.
- A deliberately thrown transaction error leaves every involved table unchanged.
- Invalid lifecycle transitions leave state unchanged.
- Running the seed twice preserves 12 raw rows, 12 source rows, 8 canonical rows, 3 clusters, all provenance mappings, and the original event count.

### API and browser

- The listings route returns a response conforming to the shared schema for a seeded temporary database.
- The route returns a safe 503 for an uninitialized database.
- Chromium confirms the dashboard displays eight canonical cards, three duplicate badges, all four source labels, and an explicit unknown-field label while the existing health status remains online.

All tests are credential-free, deterministic, and offline.

## Documentation changes

- Create `docs/DATA_MODEL.md` as the durable model reference with table descriptions, lifecycle rules, append-only behavior, seed topology, and a Mermaid entity diagram.
- Update `docs/ARCHITECTURE.md` to reflect the implemented Milestone 2 state rather than the pre-scaffold readiness wording.
- Update `README.md` with migration, seed, database-path, dashboard, and test instructions.
- Preserve existing source-policy and security decisions; this milestone does not grant a source capability.

## Acceptance evidence

Implementation is complete only when all of the following pass from the root:

```text
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test
pnpm build
```

The final audit must also inspect row counts and provenance coverage in the seeded database, confirm the immutable triggers exist, scan fixtures for credential or personal-data patterns, and verify that no AI, Gmail, Calendar, browser-automation, or platform-access dependency or code path was added.
