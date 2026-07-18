# Offline Ship Season Demo Design

Status: approved design awaiting written-spec review  
Reviewed: 2026-07-18

## Goal

Build the smallest reliable, polished Vera demo that can be recorded without internet access, credentials, live models, live marketplace accounts, or fragile services. The vertical path is:

```text
sanitized search profile
  -> run demo search
  -> fixture records pass the connector and policy boundary
  -> canonical listing inbox
  -> duplicate-source evidence
  -> deterministic fit explanation
  -> evidence-backed risk indicators
  -> persisted shortlist decision
  -> existing manual listing capture
  -> append-only activity log
```

The demo is an honest fixture-backed presentation of Vera's implemented local core. It does not claim Maritime, OpenClaw, Gmail, Google Calendar, a live LLM, or any marketplace integration is running.

## Scope priorities

P0 must work before any polish:

- explicit offline demo mode;
- deterministic reset, seed, and startup commands;
- staged empty inbox followed by an audited demo search;
- eight canonical listings from twelve source records;
- three fixture-declared duplicate clusters;
- canonical detail with source evidence;
- persisted shortlist and removal from shortlist;
- append-only activity log.

P1 follows only after P0 is stable:

- deterministic fit scores and reasons;
- evidence-backed risk indicators;
- manual capture in the recorded path;
- a single Playwright golden path.

P2 is limited to small CSS refinements. No animation, design-system work, or broad UI redesign is required.

## Chosen approach

Use a staged seed with an audited reveal.

`pnpm demo:seed` loads the complete sanitized fixture graph into a dedicated demo database: one search profile, twelve raw/source records, eight canonical listings, three duplicate clusters, deterministic score snapshots, risk signals, policy manifests, and the existing seed event. The records are present so the demo is reliable, but `/api/listings` returns an empty collection in demo mode until the first successful demo search has been recorded.

The user clicks **Run demo search**. The server passes each of the twelve fixture requests through the existing `FixtureConnector`, persisted `SourcePolicyRegistry`, and `captureListing` service. The fixture captures are shaped so their content hashes and source identities resolve to the already staged immutable rows. This exercises the real validation, policy, idempotency, raw-import, and audit boundaries without inventing a second ingestion path or requiring the not-yet-implemented canonicalization worker.

After all fixture requests succeed, the server records honest normalization-reuse events and one stable demo-search completion event. The listing API then reveals the staged canonical results. A second click returns the persisted summary without adding records, memberships, clusters, scores, risks, or another completion event.

This approach is preferable to importing and canonicalizing from an empty database during the click because the repository does not yet implement new-record canonicalization. Implementing that later milestone under the deadline would create unnecessary reliability and scope risk.

## Demo-mode configuration and commands

Demo behavior is enabled only when `VERA_DEMO_MODE=1`. Any demo-only API route denies when the exact flag is absent. Non-demo listing behavior remains unchanged.

The root exposes:

```text
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

Small TypeScript scripts under `scripts/` implement the commands without new dependencies:

- `demo:reset` resolves the dedicated demo data directory and deletes only that explicit directory.
- `demo:seed` sets demo mode, runs migrations, and runs the idempotent sanitized seed against that directory.
- `demo` starts the existing web and worker processes with demo mode and the demo data directory in their environment.

The default demo directory is a sibling of Vera's normal per-user application-data directory, named `Vera Demo` on macOS/Windows or `vera-demo` on Linux. `VERA_DEMO_DATA_DIR` may override it. Reset never targets the normal Vera data directory, repository root, home directory, or an unresolved environment variable.

Demo startup removes `OPENAI_API_KEY`, `VERA_LLM_MODEL`, and `VERA_LLM_TIMEOUT_MS` from the child environment and sets `NEXT_TELEMETRY_DISABLED=1`. The demo connectors perform no network access. No demo command installs dependencies or contacts an external service.

## Sanitized data contract

The current topology already meets the required inventory target and remains intact:

- twelve source records;
- eight canonical listings;
- three duplicate clusters;
- Zillow, Facebook Marketplace, Craigslist, and Apartments.com fixture labels;
- all source URLs under `example.invalid`;
- no live platform access or personal information.

The seed adds one profile designed for the fixture set:

- name: Harbor City September search;
- budget target and maximum appropriate for the seeded prices;
- minimum one bedroom;
- September 2026 move-in window;
- cat required;
- must-haves represented as explicit sanitized constraints/preferences.

The profile is display-only for this deadline. No onboarding or profile editor is added.

## Deterministic fit evaluation

`packages/scoring` gains a small pure demo evaluator. It is explicitly versioned and described as a demo scorer, not the production ranking algorithm.

It evaluates four factors from known profile and listing fields:

- budget fit;
- bedroom fit;
- required-pet compatibility;
- move-in-window compatibility.

Known compatible facts contribute positively. Known hard conflicts contribute negatively. Unknown facts are neutral and produce a visible “needs verification” reason rather than being treated as false. The evaluator returns a bounded score, factor reasons, one top positive reason, and one top concern. The seed persists one deterministic `ListingScore` per canonical listing using existing tables; no migration is needed.

## Risk indicators

The demo uses a few deterministic, evidence-backed rules only:

- payment requested before viewing;
- wire, cryptocurrency, or gift-card payment language;
- conflicting rent or address evidence among source records in one declared duplicate cluster.

Fixture descriptions may be refined with explicitly synthetic evidence where necessary. Every persisted `RiskSignal` includes source-record evidence, confidence, severity, and a verification action. The UI always says “risk indicator,” “needs verification,” or equivalent language; it never labels a listing as a scam or makes a fraud determination.

## API and repository shape

The implementation extends existing boundaries rather than adding a parallel store:

- listing-score and risk repositories gain listing-scoped read methods;
- canonical repositories gain the minimal source/provenance selection reads needed for detail projection;
- search-profile reads use the fixed seeded profile ID;
- activity events remain append-only;
- shortlist writes call the existing canonical lifecycle transition repository.

New strict domain response schemas cover:

- demo status and completion summary;
- canonical listing detail;
- shortlist request/result;
- activity-event presentation.

New routes:

- `GET /api/demo/status` returns demo-mode state, profile, and persisted run summary;
- `POST /api/demo/run` performs or resolves the idempotent fixture search;
- `GET /api/listings/[id]` returns canonical detail, member records, provenance, score, risks, and listing activity;
- `POST /api/listings/[id]/shortlist` requests `shortlisted` or `new` through the domain transition function and appends a decision event;
- `GET /api/activity` returns redacted activity presentation rows.

All routes use the Node runtime, no-store responses, strict Zod parsing, safe errors, and explicit database closure. Demo-only routes fail closed outside demo mode.

The listing collection route behaves as follows:

- outside demo mode: preserve the current seeded-listing behavior;
- in demo mode before completion: return a schema-valid empty collection;
- in demo mode after completion: return the eight canonical summaries.

## Idempotent demo search

The demo completion event has a stable ID and a payload hash bound to the fixture version and expected counts. Its stored metadata is the authoritative summary:

```text
12 source records analyzed · 8 homes found · 3 duplicate clusters
```

The route first checks for a valid existing completion event. If present, it verifies the payload hash and expected counts and returns the stored result. If the event is missing, it processes the fixture batch. Any connector or policy failure returns a safe non-success result and does not create the completion marker or reveal the inbox.

The fixture connector retains `networkAccess: false`. Matching source identity and content produce existing immutable raw records through the repository idempotency key. The action appends capture request, policy authorization, and capture completion events through the existing capture service. Because the staged source records are already normalized, the demo layer appends clearly labeled `normalization.reused` events instead of claiming new normalization work occurred. It finally appends `demo.search.completed`.

Re-running after completion creates no additional domain data or activity events and returns the same summary.

## User interface

The existing Vera visual language remains: forest, mint, paper, coral, serif display type, and the tagline **Find fast. Rent safely.** No component library is added.

Every demo page shows a visible banner:

> Demo mode — sanitized fixture data; no live marketplace accounts connected.

The home page is simplified into a recording cockpit:

1. compact brand/navigation row;
2. demo banner;
3. sanitized search-profile card;
4. prominent Run demo search control with loading, success, and safe-error states;
5. completion summary;
6. renter-facing listing inbox;
7. links to manual capture and activity history.

Before the search, the inbox shows an intentional empty state. After completion, each listing card shows:

- address and title;
- monthly price;
- beds and baths;
- source badges;
- freshness;
- lifecycle/shortlist state;
- duplicate-source count;
- fit score or fit label;
- top positive reason;
- top concern or missing fact;
- risk-indicator count;
- a clear detail link.

The detail page shows:

- canonical values;
- fit factors and version;
- all source records in the duplicate cluster;
- field provenance already stored for those records;
- a deterministic duplicate explanation such as “Same normalized address and unit; listed across Zillow, Craigslist, and Apartments.com fixtures.”;
- evidence-backed risk indicators and verification actions;
- listing-related activity timeline;
- shortlist/remove action;
- disabled “Prepare outreach — coming next” control.

The activity page shows safe action labels, outcome, timestamp, target, and correlation ID. It never renders raw pasted content, credentials, contact details, or full provenance URLs.

## Shortlist behavior

The listing lifecycle remains authoritative. The domain transition map gains the explicit reversible decision transition:

```text
new -> shortlisted
shortlisted -> new
```

Both directions receive unit tests. The API never updates lifecycle state directly. It calls `transitionLifecycle` and appends a payload-hashed `listing.shortlisted` or `listing.shortlist_removed` activity event in one repository transaction. Invalid state requests fail without mutation or success audit.

## Manual capture

The existing `/capture` flow remains the only manual capture implementation. The home and detail navigation surfaces it clearly. It continues to treat URLs as inert provenance, pass through the manual connector and policy registry, enqueue deterministic normalization, and add capture/normalization events.

The recording path may submit the existing sanitized example. The newly captured record links to extraction evidence; it is not falsely shown as a newly canonicalized listing because new-record canonicalization remains a later milestone.

## Error handling and offline guarantees

- Missing or false demo mode denies demo execution.
- Missing, malformed, disabled, or killed fixture policy denies the search.
- A failed fixture batch does not reveal listings or append the completion event.
- Database errors return safe recovery text naming `pnpm demo:reset` and `pnpm demo:seed`, never a filesystem path.
- Client controls expose loading and prevent accidental double submission.
- Stored completion metadata is validated before use; mismatched fixture versions fail visibly.
- Demo scripts remove live-model variables and never enable external connectors.
- No browser automation, marketplace fetch, email, calendar, or external side effect is introduced.

## Testing

Focused tests cover:

- demo-mode parsing and fail-closed route guards;
- safe demo-directory resolution and reset target validation;
- seed counts, profile, scores, risks, and idempotency;
- deterministic score neutrality for unknown facts;
- risk evidence rules;
- `shortlisted -> new` lifecycle transition;
- listing detail and activity response schemas;
- demo-run idempotency, policy denial, completion marker, audit actions, and no-network fixture metadata;
- shortlist persistence and activity append;
- hidden-before-run and visible-after-run listing API behavior.

One Playwright golden path starts from reset/seed and verifies:

1. the exact demo banner and empty inbox;
2. the sanitized search profile;
3. Run demo search and the 12/8/3 summary;
4. eight cards and three duplicate listings;
5. opening a duplicate listing;
6. viewing source evidence and one risk indicator;
7. shortlisting and observing persistence;
8. opening the activity log and seeing the audited search and shortlist actions.

Existing manual-capture E2E coverage remains. The full default unit, integration, and E2E suites, typecheck, lint, and build must pass without API keys or internet access.

## Founder guide

`docs/DEMO_NOW.md` will contain:

- exact reset, seed, and start commands;
- the default route `http://127.0.0.1:3000/`;
- a 60–90 second script;
- exact click sequence;
- manual-capture fallback;
- honest fixture-backed versus future-live language;
- known limitations and next architecture milestones.

## Explicit non-goals

- Maritime or OpenClaw implementation;
- live browser or marketplace integration;
- Gmail, Google Calendar, or OAuth;
- live or mock-silent LLM behavior;
- full canonicalization or probabilistic deduplication;
- outreach generation or sending;
- calendar actions;
- schema redesign or package upgrades;
- platform scraping, automated login, credential handling, or broad crawling;
- a new design system or substantial animation work.

## Acceptance

The design is complete when the three root demo commands work from a migrated workspace; the recording begins with a clearly labeled empty fixture inbox; Run demo search passes the twelve sanitized fixtures through the real connector/policy/capture path; eight canonical homes and three duplicate clusters appear; fit, risk, provenance, shortlist, manual capture, and activity views work; re-running is idempotent; all tests and build pass; and no live network capability, credential, or personal data was added.
