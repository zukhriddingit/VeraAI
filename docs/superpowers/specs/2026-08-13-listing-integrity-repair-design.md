# Listing Integrity Repair Design

Status: Approved
Date: 2026-08-13

## Purpose

Repair Vera's retained listing corpus and prevent recurrence of the data-quality failures found after the Milestone 13B recording:

- a locationless Craigslist record was linked to unrelated properties using rent and bedroom similarity alone;
- transitive deduplication expanded that false link into a large mixed-property canonical cluster;
- historical BU Off-Campus and Apartments.com navigation/category URLs remained active as if they were listings;
- observed enrichment photos were retained in append-only snapshots but did not reach the normal listing-photo projection;
- enrichment failures and manual blockers were counted together without enough cause-aware recovery behavior;
- records without provider URLs did not clearly distinguish “unavailable” from a broken source-link implementation.

The repair preserves all immutable RawListing, normalization, provenance, enrichment-snapshot, decision-history, and activity evidence. It does not redesign the Gateway, change browser permissions, automate login or blockers, fabricate source URLs, fetch or rehost photos, or require live browser access while Maritime is unavailable.

## Confirmed production failure

The retained PostgreSQL corpus showed that `canonical:fd3b920b96a61afdd4a480a76faec228` contained Craigslist, BU Off-Campus, Apartments.com, and RentCast records for unrelated addresses. The decisive false links involved records with unknown addresses and coordinates. Because only rent and beds/baths were known, their weights were renormalized to 100% and produced automatic-link scores as high as 10,000 basis points. Connected-component clustering then propagated those links across otherwise unrelated properties.

The same cluster contained historical navigation records such as Apartments.com `parking` and `balcony` category URLs and BU `campus-*` navigation URLs. New discovery code rejects these shapes, but the normalized historical records still participate in decision reconciliation.

## Goals

1. Remove known non-listing records from active results without deleting evidence.
2. Prevent cross-source automatic links when evidence consists only of price, rooms, text, or time similarity.
3. Recompute the retained corpus so Craigslist and The Longwood become separate canonical listings while genuine same-property sources remain joined.
4. Project safe observed photo references into normal listing presentation and preserve honest placeholders when no safe photo exists.
5. Make enrichment recovery and reporting distinguish invalid records, manual blockers, retryable transport failures, permanent failures, partial success, and fresh completed work.
6. Make original-link availability explicit without generating or guessing provider URLs.
7. Deliver the repair through one additive migration, one branch, one final PR, focused tests, full CI, and an audited retained-data reconciliation.

## Non-goals

- Live photo backfill before Maritime is repaired and the founder explicitly pairs and shares one tab again.
- Deleting or rewriting RawListing, normalized source records, provenance, snapshots, decisions, or activity events.
- Creating source URLs for RentCast records that did not provide one.
- Raising observed-field completeness by inference, defaults, or synthetic facts.
- Retrying login, CAPTCHA, consent, checkpoint, blocking, or changed-layout states automatically.
- Expanding browser navigation, selectors, JavaScript, concurrency, source limits, or allowed actions.
- Rebuilding or replacing the working signed Gateway image.

## Source-record dispositions

### Persistence

Add an append-only `listing_source_record_dispositions` table. Each row contains:

- tenant `user_id`;
- immutable event `id`;
- `listing_source_record_id`;
- `disposition`: `accepted` or `invalid_non_listing`;
- bounded reason code: `navigation_url`, `category_url`, `missing_listing_identity`, `operator_correction`, or `restored_after_review`;
- optional bounded explanatory note;
- actor: `user` or `system`;
- canonical payload hash;
- `created_at`.

The table has tenant-safe foreign keys, an append-only update/delete rejection trigger, an index ordered by `(user_id, listing_source_record_id, created_at, id)`, a unique event ID, and an idempotency constraint on `(user_id, listing_source_record_id, payload_hash)`. Current disposition is the latest event by `(created_at, id)`. A record with no disposition event is accepted, preserving compatibility with every existing record. Reversal appends `accepted`; it never mutates or deletes the invalidation.

### Product behavior

A source record whose current disposition is `invalid_non_listing` is excluded from:

- decision-corpus snapshots;
- canonical membership and active inbox projections after reconciliation;
- automatic top-three enrichment selection;
- user-triggered enrichment queues and claims;
- photo/source-link coverage denominators for active listings;
- active source counts shown in product reporting.

Its RawListing, normalized record, provenance, photos, enrichment snapshots, source jobs, decision history, and activity history remain queryable for audit and repair tooling. Existing enrichment-state rows may remain as historical current-state storage, but disposed records are ineligible for claims and are excluded from active backlog counts. The disposition application appends an activity event containing IDs, reason, payload hash, and counts, never raw page evidence.

## Listing URL classification

Use one deterministic, source-aware classifier shared by discovery acceptance and reconciliation preview. It validates only observed URLs and returns `listing`, `non_listing`, or `unknown`; it never constructs a URL.

Required positive shapes include:

- BU Off-Campus: `/housing/property/<observed-slug>/<observed-id>` on the configured OffCampusPartners domain;
- Apartments.com: an observed property path ending in a stable property ID shape, not category/facet paths such as `parking` or `balcony`;
- Craigslist: the already accepted `/view/d/<slug>/<opaque-id>` form or the reviewed legacy regional numeric `.html` form;
- Zillow: the existing reviewed rental-detail forms;
- Facebook Marketplace: the existing reviewed marketplace item-detail form;
- custom websites: same configured domain and an observed repeated-card/detail relationship; ambiguous layouts remain `unknown` and use current-page capture rather than automatic invalidation.

Unknown is not invalid. Automated reconciliation may propose invalidation only for deterministic `non_listing` classifications. An operator must explicitly approve the exact IDs before apply.

## Dedupe evidence floor

### Versioning

Bump the deterministic dedupe algorithm/config version. The prior decisions remain immutable history; new decision runs identify the repaired version and its input/output hashes.

### Same-source identity

The following remain hard identity signals when no material conflict exists:

- same source plus exact non-null source listing ID;
- exact canonical observed listing URL;
- exact normalized address and compatible known unit.

Different non-null listing IDs within one source and conflicting known units remain separating conflicts.

### Cross-source identity

Rent, bedrooms/bathrooms, square footage, descriptive text, and posting time are supporting evidence only. They can affect a score after a property anchor exists, but their renormalized score cannot independently produce `link`.

A cross-source automatic link requires at least one strong property anchor:

- compatible normalized address evidence at or above the configured address anchor threshold, with no unit or material location conflict;
- compatible supplied coordinates at or above the geographic anchor threshold;
- exact approved photo byte/perceptual hash, with no material property conflict.

If all property anchors are unknown, the pair is `separate` regardless of a high supporting-feature score. If an anchor is present but evidence is incomplete or contradictory, existing deterministic review/separate rules apply. No LLM participates.

This rule specifically guarantees that a locationless Craigslist record cannot join an unrelated Apartments.com, BU, RentCast, Zillow, Facebook, or custom-site record merely because rent and room counts are similar.

### Clustering and identity

Clustering continues to use deterministic connected components over `link` decisions plus append-only overrides. After invalid records are excluded and false edges disappear, canonical identity assignment follows existing split behavior:

- the component containing the prior primary source record preserves the prior canonical identity;
- other split components receive deterministic new canonical IDs;
- lifecycle/workflow state remains with the preserved canonical;
- every run and supersession remains traceable.

For the retained bad cluster, the Craigslist primary keeps the old canonical ID and The Longwood receives a separate deterministic canonical identity joined only to genuine same-property records.

## Enrichment photos and media safety

### Observed references only

Discovery and enrichment may retain only image URLs that appeared in the bounded semantic snapshot and passed source media policy. They retain source, observed time, ordering, and dimensions when observed. Vera does not use full-page screenshots as photos, include cookies/storage/headers, fetch image bytes by default, or permanently rehost images.

### Validation

Every photo reference must:

- use HTTPS;
- contain no username, password, or fragment;
- contain no sensitive query keys for credentials, tokens, cookies, sessions, or authorization;
- match the reviewed source media hostname rules;
- for a configured custom source, remain on the configured domain or the exact safe media-domain rule carried by that configuration.

Invalid references are dropped and audited only as bounded reason/count metadata. They never fail an otherwise useful listing snapshot.

### Projection

Completing enrichment writes the append-only enrichment snapshot and idempotently projects each validated ordered reference into `listing_photos`. Projection IDs are deterministic from tenant, source record, observed source URL, and position. The projection stores URL, position, dimensions, observed time, and null byte/perceptual hashes unless bytes were separately supplied under an approved policy. Replays do not duplicate photos. Older snapshots remain immutable.

Cards and details select the first safely displayable ordered source photo. A browser load failure or missing safe URL displays the existing honest placeholder. Tests prove the real-photo path and placeholder path. Live source-photo backfill is deferred until Maritime works and a new one-time pairing/share is explicitly established.

## Source links

Every browser, OffCampusPartners, Craigslist, and custom-site record retains its exact validated observed listing URL. Cards and detail pages expose `View original listing`; duplicate clusters expose every distinct valid member URL with a source badge.

Records such as existing RentCast API results that contain no provider URL show `Original link unavailable from source`. Vera does not infer a URL from address, title, ID, or an LLM. Link-coverage reporting distinguishes:

- eligible records with an observed original URL;
- eligible records whose connector supplied no URL;
- invalid/non-listing records excluded by disposition.

## Enrichment recovery

### Cause-aware classes

Classify current enrichment work as:

- `ineligible`: source record currently disposed as invalid; never claim or requeue;
- `manual`: login, 2FA, CAPTCHA, checkpoint, consent, blocking, layout change, browser offline, tab required, shared-tab change, or cancellation; remains manual until explicit user refresh;
- `retryable_transport`: serialized bridge conflict, transient Gateway/Maritime unavailability, timeout, or other explicitly typed retryable transport error;
- `permanent`: unsafe URL, invalid output, policy denial, unavailable profile provenance, or exhausted bounded retries;
- `partial`: valid snapshot below 8,000 completeness basis points;
- `fresh_complete`: valid fresh enriched/partial snapshot not eligible for redundant automatic work.

### Retry rules

Retryable transport failures use the existing maximum of three listing-enrichment attempts with deterministic bounded backoff and job deduplication. Manual and permanent failures never retry automatically. `Refresh details` may reset a manual/permanent record only through an explicit user request. Invalid records cannot be force-refreshed while disposed. Fresh records are reused until source-specific expiry.

### Completeness

Completeness continues to use only the 15 important observed fields. A missing photo, fee, policy, or availability stays missing. `enriched` requires at least 8,000 basis points; otherwise a successful capture is `partial`. The repair does not promise 80% when the source does not expose enough safe facts.

## Reconciliation command

Add a private-safe operational command with `preview` and `apply` modes.

### Preview

Preview is read-only and emits only bounded identifiers and counts. It:

1. reads a corpus revision and hashes the candidate repair input;
2. classifies exact source-record IDs using the shared URL classifier;
3. lists proposed invalid dispositions with reason codes;
4. simulates the new dedupe plan;
5. reports expected active/invalid counts, split clusters, canonical identities, backlog classes, photo coverage, link coverage, and forbidden-action count;
6. refuses ambiguous `unknown` URL classifications.

### Apply

Apply requires the preview payload hash and exact corpus revision. It refuses stale previews. In bounded transactions it appends disposition and activity rows, updates the corpus revision once, and enqueues normal deterministic reconciliation. It does not directly edit canonical memberships or immutable evidence.

Apply is idempotent: reapplying the same payload returns the prior accepted result without duplicate dispositions, jobs, or activities. The command waits only for the bounded worker/reconciliation completion needed to verify the repair; it never starts browser research.

### Retained-data verification

After apply, verification must prove:

- the accepted Craigslist source record remains active with its exact URL and enriched snapshot;
- The Longwood is active in a different canonical listing;
- genuine same-address The Longwood sources remain joined;
- known BU and Apartments.com navigation/category records are absent from active memberships;
- no RawListing, normalized record, provenance, snapshot, decision-history, or activity evidence was deleted;
- invalid records cannot be enriched or claimed;
- active source-link metrics exclude invalid records and identify no-link RentCast records honestly;
- forbidden browser-action count remains zero.

## UI behavior

The inbox and details continue to emphasize active canonical listings. Disposed source records do not appear as active cards or duplicate badges. Audit/history views may show that a source record was excluded as `Not a listing` with its reason and timestamp.

Photo-less listings show the honest placeholder. Failed source-image rendering falls back without exposing the failed URL in diagnostics. Duplicate-source sections show all valid source links and label unavailable links rather than rendering inert or fabricated actions.

Enrichment status copy distinguishes partial detail, manual action required, retrying a transient connection, permanent failure, and fresh details. Invalid records do not inflate the failed/backlog count.

## Migration and rollout

1. Add one forward-only PostgreSQL migration for source-record dispositions, constraints, indexes, and append-only trigger.
2. Add domain schemas and tenant-scoped repository operations.
3. Add URL classification and discovery guards.
4. Bump the dedupe version and implement the cross-source evidence floor.
5. Exclude disposed records from decision snapshots, enrichment, and active presentation.
6. Project validated enrichment photos idempotently.
7. Add cause-aware backlog reporting and the preview/apply reconciliation command.
8. Run focused unit and PostgreSQL integration tests.
9. Run lint, typecheck, affected workspace tests, and the full PostgreSQL suite.
10. Run retained-data preview and inspect every proposed ID.
11. Apply the exact approved payload, run reconciliation, and verify all retained-data invariants.
12. Push one branch, open one final PR, run full CI once, and merge only when green.

PostgreSQL data and live infrastructure remain preserved. The Gateway/checkpoint containers and signed Gateway image are not changed. Browser access stays unpaired and unshared throughout this repair.

## Test strategy

### Unit tests

- URL classifier accepts reviewed detail shapes and rejects BU campus/neighborhood and Apartments.com category/facet shapes.
- Unknown custom layouts stay unknown rather than invalid.
- A locationless cross-source pair with matching rent and bedrooms is separate.
- Genuine same-address The Longwood records remain linkable.
- Same-source ID/URL replay remains linkable.
- Exact approved photo hash can anchor a link absent a material conflict.
- Photo validation rejects unsafe schemes, credentials, fragments, sensitive query keys, and unreviewed hosts.
- Completeness remains observed-only.
- Retry classification and bounded retry rules are deterministic.

### PostgreSQL integration tests

- disposition events are append-only, tenant-owned, ordered, reversible by append, and idempotent;
- invalid records are excluded from snapshots, active canonicals, source counts, enrichment queue/claim, and photo/link denominators;
- raw/provenance/snapshot/history rows remain present;
- enrichment completion persists ordered safe photo projections exactly once;
- reconciliation splits a reproduced mixed transitive cluster and preserves valid canonical identity/workflow rules;
- preview/apply rejects a stale corpus revision and an altered payload hash;
- rerunning apply creates no duplicate events or jobs.

### UI and regression tests

- cards/detail pages render safe photos and honest placeholders;
- all eligible observed source links are available and no-link sources are labeled;
- invalid historical records disappear from active cards and duplicate-source differences;
- partial, manual, retrying, failed, and fresh status copy is distinct;
- forbidden browser actions remain impossible and the count stays zero.

## Acceptance

The repair is complete when all of the following are proven in the current branch and retained environment:

1. The real Craigslist record and The Longwood no longer share a canonical ID.
2. Genuine The Longwood sources remain deduplicated.
3. Known historical BU and Apartments.com navigation/category records have append-only invalid dispositions and do not appear in active results.
4. A regression test proves rent/rooms alone cannot cross-source auto-link.
5. Safe observed enrichment photos project to listing photos in tests; photo-less records show honest placeholders.
6. Real photo backfill is explicitly deferred until Maritime and fresh pairing are available.
7. Eligible browser/custom records retain exact original links; no-link API records are labeled without fabricated URLs.
8. Invalid records leave active enrichment backlog metrics, manual blockers stay manual, retryable failures remain bounded, and fresh results are reused.
9. Selected completeness remains its true observed value and is not inflated to 80%.
10. Raw evidence, provenance, snapshots, decision history, and listing data are preserved.
11. Existing source flows and browser safety rules remain intact.
12. Forbidden-action count is zero.
13. Focused tests, lint, typecheck, PostgreSQL integration tests, and final CI pass.
