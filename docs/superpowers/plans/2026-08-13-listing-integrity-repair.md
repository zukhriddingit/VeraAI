# Listing Integrity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Repair Vera's retained listing corpus without deleting evidence, prevent weak cross-source dedupe links, project observed enrichment photos into normal listing media, and make invalid records and enrichment failures visible and recoverable without changing the hardened browser Gateway.

**Architecture:** Add an append-only disposition overlay for source records, apply it at decision and presentation boundaries, and reconcile the retained corpus through the existing deterministic decision worker. Introduce a versioned evidence floor in dedupe v2, a shared source-aware observed-URL classifier, idempotent photo projection, and a preview/apply/verify repair command guarded by an exact corpus revision and hash.

**Tech Stack:** TypeScript, Zod, pnpm workspaces, Drizzle/PostgreSQL, Vitest, Next.js, existing Maritime/OpenClaw interfaces.

## Global constraints

- Work only on `codex/listing-integrity-repair` in `/private/tmp/vera-m13b-pr75-live-20260811`.
- Preserve every `RawListing`, normalized source record, field provenance row, snapshot, score, activity, and decision artifact.
- Preserve the retained PostgreSQL volume and all valid listing data.
- Do not modify, rebuild, redeploy, or replace the Gateway/checkpoint images.
- Do not pair the extension, share a tab, or start browser research while repairing retained data.
- Never print database URLs, pairing material, checkpoint tokens, cookies, or private evidence.
- Treat URL classification `unknown` as eligible. Only `non_listing` is automatically excluded.
- Never fabricate source URLs or image URLs. Never fetch or rehost images in this repair.
- Use bounded retries and keep forbidden browser actions at zero.

## Task 1: Add the append-only source-record disposition model

**Files:**

- Create: `packages/db/drizzle/0006_listing_integrity_repair.sql`
- Create: `packages/db/drizzle/meta/0006_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/domain/src/listing.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/db/src/postgres/schema.ts`
- Modify: `packages/db/src/postgres/row-mappers.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Modify: `packages/db/src/demo/index.ts`
- Create: `packages/db/src/postgres/source-record-disposition-repository.ts`
- Create: `packages/db/src/postgres/source-record-disposition-repository.integration.test.ts`
- Modify: `packages/db/src/postgres/schema.integration.test.ts`

### Step 1: Write the failing domain and repository tests

Add domain schemas for exactly two dispositions and an append-only event:

```ts
export const ListingSourceRecordDispositionSchema = z.enum([
  "accepted",
  "invalid_non_listing",
]);

export const ListingSourceRecordDispositionEventSchema = z.object({
  id: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  listingSourceRecordId: NonEmptyStringSchema,
  disposition: ListingSourceRecordDispositionSchema,
  reasonCode: NonEmptyStringSchema,
  evidence: z.record(z.string(), z.unknown()),
  payloadHash: Sha256HexSchema,
  actor: z.enum(["system", "founder"]),
  observedAt: IsoDateTimeSchema,
});
```

In the PostgreSQL integration test, prove:

1. no event means the record is accepted;
2. the latest appended event is current;
3. appending the same payload hash is idempotent;
4. update and delete are rejected by the append-only trigger;
5. a founder can reverse an invalid disposition only by appending `accepted`.

Run:

```bash
pnpm exec vitest run --project postgres-integration packages/db/src/postgres/source-record-disposition-repository.integration.test.ts
```

Expected: fail because the schema and repository do not exist.

### Step 2: Implement the domain and repository contract

Expose this repository from `UserRepositories`:

```ts
export interface ListingSourceRecordDispositionRepository {
  append(
    event: ListingSourceRecordDispositionEvent,
  ): Promise<{ event: ListingSourceRecordDispositionEvent; inserted: boolean }>;
  getCurrent(
    listingSourceRecordId: string,
  ): Promise<ListingSourceRecordDispositionEvent | null>;
  listCurrent(): Promise<readonly ListingSourceRecordDispositionEvent[]>;
  isEligible(listingSourceRecordId: string): Promise<boolean>;
}
```

`isEligible` returns `true` when no event exists or the latest event is `accepted`. The demo repository uses an in-memory append-only array so existing deterministic tests keep the same default-accepted behavior.

### Step 3: Add the additive migration

Create `listing_source_record_dispositions` with:

- foreign keys to user and listing source record;
- immutable event ID and timestamps;
- `accepted | invalid_non_listing` check constraint;
- unique `(user_id, listing_source_record_id, payload_hash)`;
- index `(user_id, listing_source_record_id, observed_at desc, id desc)`;
- the existing `vera_reject_mutation()` trigger for update and delete.

In the same migration:

- drop `listing_photos_user_source_position_unique`;
- add a partial unique index on `(user_id, listing_source_record_id, source_url, position)` where `source_url is not null`;
- relax the media metadata constraint so width and height must appear together, while byte size and MIME type must appear together only for fetched bytes.

Generate Drizzle metadata, inspect the SQL, and keep the migration filename exactly `0006_listing_integrity_repair.sql`.

Run:

```bash
pnpm db:generate
pnpm exec vitest run --project postgres-integration packages/db/src/postgres/schema.integration.test.ts packages/db/src/postgres/source-record-disposition-repository.integration.test.ts
```

Expected: pass.

### Step 4: Commit the model layer

```bash
git add packages/domain packages/db
git commit -m "feat: add append-only listing dispositions"
```

## Task 2: Centralize source-aware observed URL classification

**Files:**

- Create: `packages/domain/src/source-listing-url.ts`
- Create: `packages/domain/src/source-listing-url.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/listing-enrichment.ts`
- Modify: `packages/domain/src/listing-enrichment.unit.test.ts`
- Modify: `packages/connectors/src/browser-source-adapter.ts`
- Modify: `packages/connectors/src/browser-source-adapter.unit.test.ts`

### Step 1: Write the classification matrix

Define a pure interface:

```ts
export type ObservedListingUrlClassification =
  | "listing"
  | "non_listing"
  | "unknown";

export function classifyObservedListingUrl(input: {
  source: ListingSource;
  url: string;
  allowedDomain?: string;
}): ObservedListingUrlClassification;
```

Test the retained regressions:

- Apartments.com `/boston-ma/parking/` and `/boston-ma/balcony/` are `non_listing`;
- an Apartments.com property detail URL is `listing`;
- BU campus and neighborhood URLs are `non_listing`;
- a BU `/housing/property/...` detail URL is `listing`;
- exact Craigslist listing URLs are `listing`;
- safe same-domain custom URLs that are not recognizable are `unknown`;
- off-domain, credential-bearing, or unsafe URLs are `non_listing`;
- no classifier constructs or rewrites a URL.

Run:

```bash
pnpm exec vitest run --project unit packages/domain/src/source-listing-url.unit.test.ts
pnpm exec vitest run --project unit packages/connectors/src/browser-source-adapter.unit.test.ts
```

Expected: fail before implementation.

### Step 2: Implement and consume the classifier

Use source-specific path rules only where the repository already has reviewed shapes. Keep all other same-domain paths `unknown` rather than guessing. Replace duplicated BU-only assertions in the browser source adapter with the shared classifier. Discovery rejects only `non_listing` and preserves both `listing` and `unknown` with provenance.

Update `isExpectedSourceUrl` and `isExpectedSourcePhotoUrl` so:

- exact source URLs remain on the expected domain;
- custom-source photos may use the same safe hostname as the observed detail URL;
- data URLs, credential-bearing URLs, unexpected hosts, and unsafe query material fail closed;
- observed dimensions are valid without fetched byte metadata.

Run the focused tests again and expect pass.

### Step 3: Commit the classifier

```bash
git add packages/domain packages/connectors
git commit -m "fix: classify observed listing URLs"
```

## Task 3: Add a strong-anchor evidence floor to dedupe v2

**Files:**

- Modify: `packages/domain/src/decision.ts`
- Modify: `packages/domain/src/decision.unit.test.ts`
- Modify: `packages/scoring/src/dedupe/pair.ts`
- Modify: `packages/scoring/src/dedupe/features.ts`
- Modify: `packages/scoring/src/dedupe/config.ts`
- Modify: `packages/scoring/src/dedupe/pair.unit.test.ts`

### Step 1: Lock the regression with failing tests

Add a fixture matching the retained Craigslist failure: different sources, no address, no coordinates, close rent, exact bedrooms, similar observation time. Assert `separate`, regardless of normalized weighted score.

Also prove:

- exact compatible normalized address is a strong anchor;
- sufficiently close coordinates are a strong anchor;
- exact approved photo hash is a strong anchor when there is no material conflict;
- same-source listing ID, exact URL, and exact address-plus-unit hard identities retain existing behavior;
- address or geographic conflicts still force separation;
- historical `listing-dedupe.v1` decision rows remain schema-readable.

Run:

```bash
pnpm exec vitest run --project unit packages/domain/src/decision.unit.test.ts
pnpm exec vitest run --project unit packages/scoring/src/dedupe/pair.unit.test.ts
```

Expected: the rent-and-bedrooms regression fails under v1 behavior.

### Step 2: Implement the evidence floor and version compatibility

Use:

```ts
export const DEDUPE_VERSION = "listing-dedupe.v2" as const;
export const DedupeVersionSchema = z.enum([
  "listing-dedupe.v1",
  "listing-dedupe.v2",
]);
```

Before weighted automatic linking, require either hard identity or:

```ts
const hasStrongPropertyAnchor =
  knownAtLeast(features.address, 6_000) ||
  knownAtLeast(features.geographic, 5_000) ||
  features.photoHash === "match";
```

If two cross-source records lack a strong property anchor, return `separate` with reason code `insufficient_property_anchor`. Rent, bedroom count, bathroom count, square footage, text similarity, and time proximity remain supporting features but cannot create the anchor.

Run focused tests and expect pass.

### Step 3: Commit dedupe v2

```bash
git add packages/domain packages/scoring
git commit -m "fix: require strong property anchors for dedupe"
```

## Task 4: Apply dispositions to reconciliation and presentation

**Files:**

- Modify: `packages/db/src/postgres/decision-reconciliation.ts`
- Modify: `packages/db/src/postgres/decision-reconciliation.integration.test.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `packages/db/src/postgres/repositories.integration.test.ts`
- Modify: `packages/domain/src/api.ts`

### Step 1: Add failing reconciliation tests

Create an integration corpus with:

- one mixed canonical whose current primary remains accepted;
- one invalid member;
- one all-invalid historical canonical;
- one accepted sibling that must split into a new canonical;
- one genuine same-address duplicate that must remain joined.

Assert:

1. invalid records are absent from `normalizedDecisionSources`;
2. accepted prior primaries preserve their canonical IDs;
3. if a prior primary is invalid, the first stable accepted member becomes the effective prior primary;
4. an all-invalid canonical becomes a non-presentable audit shell without deleting history or demanding a fabricated redirect;
5. active summaries and source-record detail queries contain only accepted records;
6. summaries with zero accepted members are omitted.

Run:

```bash
pnpm exec vitest run --project postgres-integration packages/db/src/postgres/decision-reconciliation.integration.test.ts packages/db/src/postgres/repositories.integration.test.ts
```

Expected: fail because current reads ignore dispositions.

### Step 2: Filter only projection boundaries

Add one bulk current-disposition query and create an accepted-ID set. Use it in:

- decision snapshot source records;
- prior canonical effective memberships;
- listing summaries;
- canonical detail source records;
- active metrics and enrichment candidate selection.

Do not mutate or delete the underlying memberships. Teach `applyPlan` to tolerate a prior canonical absent from the new plan only when every prior member is currently invalid. It remains a historical audit shell and is never returned by active listing reads.

When an invalid primary has accepted members, choose the lexicographically stable accepted member for identity resolution; do not generate a URL, score, or address.

Run focused tests and expect pass.

### Step 3: Commit projection filtering

```bash
git add packages/db packages/domain
git commit -m "fix: exclude invalid records from active listings"
```

## Task 5: Make enrichment eligibility, retries, and photos durable

**Files:**

- Modify: `packages/domain/src/listing-enrichment.ts`
- Modify: `packages/domain/src/listing-enrichment.unit.test.ts`
- Modify: `packages/db/src/repositories.ts`
- Modify: `packages/db/src/postgres/enrichment-repositories.ts`
- Modify: `packages/db/src/postgres/enrichment-repositories.integration.test.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `apps/web/lib/listing-enrichment-service.ts`
- Modify: `apps/web/lib/listing-enrichment-service.unit.test.ts`
- Create: `apps/web/lib/enrichment-presentation.ts`
- Create: `apps/web/lib/enrichment-presentation.unit.test.ts`

### Step 1: Write failing eligibility and media tests

Prove:

- invalid source records cannot be queued, claimed, or force-refreshed;
- completing an enrichment snapshot inserts observed photo references into `listing_photos` in source order;
- rerunning the same enrichment is idempotent by source URL and position;
- safe content hashes and observed dimensions are preserved;
- no bytes, screenshot, signed header, cookie, or rehosted URL is created;
- missing or unsafe photos produce no media row and the UI retains an honest placeholder;
- retryable transport failures retry at most three times;
- manual blockers and permanent failures never auto-retry;
- partial and fresh states remain distinct;
- completeness uses observed important fields only and is not the Vera fit score.

Run:

```bash
pnpm exec vitest run --project postgres-integration packages/db/src/postgres/enrichment-repositories.integration.test.ts
pnpm exec vitest run --project unit apps/web/lib/listing-enrichment-service.unit.test.ts apps/web/lib/enrichment-presentation.unit.test.ts
```

Expected: fail before the repository transaction projects photos and consults dispositions.

### Step 2: Project safe observed photos transactionally

Extend the photo repository with:

```ts
listBySourceRecordId(
  listingSourceRecordId: string,
): Promise<readonly ListingPhoto[]>;
```

During `listingEnrichments.complete`, map each validated detail photo to a deterministic `ListingPhoto`:

```ts
{
  id: stableId(userId, listingSourceRecordId, photo.sourceUrl, position),
  listingSourceRecordId,
  sourceUrl: photo.sourceUrl,
  fixturePath: null,
  byteHash: photo.safeContentHash ?? null,
  byteSize: null,
  mimeType: null,
  width: photo.width ?? null,
  height: photo.height ?? null,
  perceptualHash: null,
  position,
  observedAt: snapshot.observedAt,
}
```

Insert them in the same PostgreSQL transaction as the append-only enrichment snapshot and state transition. Rely on the new URL-position unique index for idempotency.

### Step 3: Centralize recovery classification

Implement:

```ts
export type EnrichmentPresentationState =
  | "not_requested"
  | "queued"
  | "retrying"
  | "enriching"
  | "partial"
  | "enriched"
  | "stale"
  | "manual_action_required"
  | "failed";

export function presentEnrichmentState(
  record: ListingEnrichmentRecord,
): EnrichmentPresentationState;
```

The worker/service classifies known Maritime/OpenClaw transport codes as retryable, caps attempts at three, and preserves typed manual-action outcomes for login, CAPTCHA, consent, checkpoint, blocked layout, and no shared tab. Invalid records are ineligible rather than failed.

Run focused tests and expect pass.

### Step 4: Commit enrichment integrity

```bash
git add packages/domain packages/db apps/web/lib
git commit -m "feat: make listing enrichment durable and recoverable"
```

## Task 6: Repair card/detail presentation and original-link copy

**Files:**

- Modify: `packages/domain/src/api.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `apps/web/app/listing-dashboard.tsx`
- Create: `apps/web/app/listing-dashboard.unit.test.tsx`
- Modify: `apps/web/app/listings/[id]/listing-detail.tsx`
- Create: `apps/web/app/listings/[id]/listing-detail.unit.test.tsx`
- Modify: `apps/web/lib/listing-presentation.ts`
- Modify: `apps/web/lib/listing-presentation.unit.test.ts`
- Modify: `apps/web/lib/listing-presentation.integration.test.ts`

### Step 1: Add failing presentation tests

Assert:

- every accepted source with an observed safe original URL exposes that exact URL;
- duplicate detail pages expose every accepted original source link;
- all links remain on the expected source domain;
- RentCast null URLs render `Original link unavailable from source`;
- no URL is synthesized from source ID, address, title, or an LLM;
- cards use the first safe enrichment photo, then safe discovery photo, then placeholder;
- detail galleries preserve safe observed ordering;
- invalid records cannot contribute badges, links, photos, fees, or completeness;
- retrying, manual action, partial, stale, and failed render as distinct states.

Run:

```bash
pnpm exec vitest run --project unit apps/web/app/listing-dashboard.unit.test.tsx 'apps/web/app/listings/[id]/listing-detail.unit.test.tsx' apps/web/lib/listing-presentation.unit.test.ts
pnpm exec vitest run --project integration apps/web/lib/listing-presentation.integration.test.ts
```

Expected: fail on copy and the new presentation state.

### Step 2: Implement the smallest UI changes

Add `enrichmentPresentationState` to `CanonicalListingSummarySchema` and calculate it from the primary accepted source record. Keep `enrichmentState` for API compatibility. Change only presentation and repository aggregation; do not change source acquisition or fit scoring.

Use `SafePhoto` for all media and keep its existing failure placeholder. Change both card and detail null-link copy to exactly `Original link unavailable from source`.

Run focused tests and expect pass.

### Step 3: Commit presentation repair

```bash
git add packages/domain packages/db apps/web
git commit -m "fix: present verified listing details and links"
```

## Task 7: Add the preview/apply/verify retained-data repair command

**Files:**

- Create: `scripts/listing-integrity-repair-lib.ts`
- Create: `scripts/listing-integrity-repair.ts`
- Create: `scripts/listing-integrity-repair.unit.test.ts`
- Modify: `package.json`
- Modify: `README.md`

### Step 1: Write failing command tests

Use a fake repository boundary to prove:

- preview is read-only and emits exact source-record IDs, classifications, current corpus revision, corpus hash, proposed dispositions, and predicted canonical changes;
- apply requires the exact preview revision and hash;
- apply rejects stale previews before mutation;
- reapplying an already applied preview is idempotent;
- apply appends dispositions, an audit activity, bumps the corpus revision, and enqueues exactly one decision job in one transaction;
- verify checks the exact source-record and canonical invariants;
- no command invokes a browser, Gateway, URL fetch, image fetch, shell, contact, or message action;
- output redacts connection strings and private tokens.

Define the service boundary:

```ts
export interface ListingIntegrityRepairStore {
  inspectCorpus(input: { userId: string }): Promise<RepairCorpusSnapshot>;
  applyPlan(input: {
    userId: string;
    preview: ListingIntegrityRepairPreview;
    actor: "founder";
  }): Promise<{ insertedDispositionIds: readonly string[]; decisionJobId: string }>;
  inspectResult(input: { userId: string }): Promise<RepairCorpusSnapshot>;
}
```

Run:

```bash
pnpm exec vitest run scripts/listing-integrity-repair.unit.test.ts
```

Expected: fail before the command exists.

### Step 2: Implement a file-input, bounded CLI

Add:

```json
"listing-integrity:repair": "tsx scripts/listing-integrity-repair.ts"
```

Supported modes:

```text
preview --database-url-file PATH --user-id-file PATH --source-record-ids-file PATH --output-file PATH
apply   --database-url-file PATH --user-id-file PATH --preview-file PATH --output-file PATH
verify  --database-url-file PATH --user-id-file PATH --preview-file PATH --output-file PATH
```

All paths must resolve outside tracked source files. The source-record input contains only explicit retained IDs and reason codes. Preview simulates `evaluateCorpus` after excluding proposed invalid records. Apply does not edit canonical rows directly; it appends disposition/audit rows and enqueues one normal deterministic reconciliation job. Verify polls that exact job for no more than 60 seconds, then checks:

- Craigslist `b45d49d4-75c5-434a-8dca-e0579151d545` is accepted and no longer canonicalized with The Longwood;
- BU The Longwood `4de501a3-fea8-42f2-9093-2ebe4fe26bc3` remains accepted;
- the genuine same-property Longwood sources remain joined;
- specified BU/Apartments navigation records are invalid and absent from active results;
- raw/provenance/history counts did not decrease;
- forbidden-action count remains zero.

Never embed production IDs in general domain logic; these IDs belong only in the private repair input and verification expectations.

Run focused tests and expect pass.

### Step 3: Commit the repair tooling

```bash
git add scripts package.json README.md
git commit -m "feat: add guarded listing integrity repair"
```

## Task 8: Run focused verification before touching retained data

### Step 1: Run package checks

```bash
pnpm exec vitest run --project unit packages/domain packages/scoring packages/connectors apps/web
pnpm run test:integration:postgres
pnpm run lint
pnpm run typecheck
pnpm run format:check
pnpm run verify:browser-boundaries
pnpm run verify:web-image-boundaries
pnpm run verify:web-mutation-boundaries
```

Expected: all pass before production mutation.

### Step 2: Inspect the diff and migration

Review:

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- packages/db/drizzle/0006_listing_integrity_repair.sql
git diff origin/main...HEAD | rg -n "pairing|checkpoint.*token|cookie|password|BEGIN.*PRIVATE|ghp_"
```

Expected: additive migration, no secret material, no Gateway change, no weakened browser policy.

## Task 9: Preview, apply, reconcile, and verify retained PostgreSQL data

### Step 1: Re-establish only the local database tunnel if needed

Check health before changing anything. Reuse the retained infrastructure, current containers, SSH control socket, and PostgreSQL volume. If the local tunnel is down, recreate only the tunnel to the current PostgreSQL container address. Do not recreate PostgreSQL, Gateway, or checkpoint containers.

### Step 2: Apply the additive migration

Load the database URL from the existing private file or process environment without printing it, then run the repository's normal migration command. Record only migration version and success in private evidence.

### Step 3: Create the explicit private repair input

In the gitignored private evidence directory, create an input containing only the exact historical navigation/category source-record IDs verified by query, their observed URLs, and deterministic reason codes. Include the known malformed BU ID `aa78c821-d4b6-4616-b65e-3591639075b4`; discover the exact Apartments.com navigation IDs by URL classification query instead of matching titles.

### Step 4: Preview and independently inspect

Run `listing-integrity:repair preview`, then verify:

- every proposed invalid record classifies `non_listing`;
- no `unknown` record is proposed invalid;
- Craigslist and The Longwood split in the simulated v2 graph;
- The Longwood keeps genuine same-address duplicates;
- raw/provenance/history deletion counts are zero.

Do not apply if any check differs.

### Step 5: Apply and let normal reconciliation run

Run `listing-integrity:repair apply` using the exact preview artifact. Wait only for its exact bounded decision job. Do not enqueue browser or enrichment jobs during this step.

### Step 6: Verify retained acceptance metrics

Run `listing-integrity:repair verify` and query the current application repositories for:

- active listing count;
- active source-record count by source;
- enriched listings per source;
- photo coverage and honest-placeholder coverage;
- observed source-link coverage by source;
- average important-field completeness before and after;
- exact Craigslist completeness remains honest at `66.67%` unless new observed data already exists;
- zero forbidden actions;
- raw/provenance/history counts preserved or increased;
- browser shared-tab count zero and established extension connection count zero.

Save outputs only in the gitignored private evidence directory.

## Task 10: Final CI, PR, merge, and handoff

### Step 1: Run the full repository suite once

Run the repository-level equivalents of the `verify` job in `.github/workflows/ci.yml`:

```bash
pnpm format:check
pnpm verify:calendar-boundaries
pnpm verify:db-boundaries
pnpm verify:browser-boundaries
pnpm verify:vera-openclaw-extension
pnpm verify:gmail-boundaries
pnpm verify:web-mutation-boundaries
pnpm verify:web-runtime-boundaries
pnpm verify:web-image-boundaries
pnpm verify:maritime-boundaries
pnpm maritime:validate
pnpm verify:worker-image-boundaries
pnpm verify:worker-release-workflow
pnpm verify:openclaw-config
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm verify:gateway-release-workflow
pnpm verify:gateway-registry-workflow
pnpm verify:gateway-runtime-attestation-workflow
pnpm verify:digitalocean-browser-gateway
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration:postgres
pnpm build
```

Fix failures with focused tests, then rerun this full sequence once after the last code change. Let hosted CI perform its normal local image-build verification; do not publish or deploy either image.

### Step 2: Final audit

Confirm:

- `git status` is clean;
- no private evidence is tracked;
- no raw data or PostgreSQL volume was deleted;
- no Gateway/checkpoint/image file changed;
- no browser was paired or shared;
- no forbidden action occurred;
- all source URLs and photos are observed and domain-validated.

### Step 3: Commit final integration changes if any

Inspect `git status --short`, stage each remaining reviewed file by its exact path with `git add --`, and commit:

```bash
git commit -m "feat: repair listing integrity and enrichment media"
```

Skip this commit when the tree is already clean. Never use `git add .` for the retained worktree.

### Step 4: Push one branch and open one final PR

```bash
git push origin codex/listing-integrity-repair
gh pr create --base main --head codex/listing-integrity-repair --title "feat: repair listing integrity and enrichment media" --body-file /private/tmp/vera-listing-integrity-pr-body.md
```

Wait for full CI once, review the complete diff, merge only when green, and record the PR number and merge commit. Do not publish a Gateway image.

### Step 5: Concise completion report

Report:

- interactive URL;
- active listings and enriched listings per source;
- real-photo and honest-placeholder coverage;
- exact observed source-link coverage;
- average important-field completeness before and after;
- forbidden-action verification;
- preserved raw/provenance/history counts;
- PR and merge commit;
- whether the repaired product is ready to record;
- the deferred next action: after Maritime is repaired, create a fresh pairing credential and run a bounded real enrichment backfill.
