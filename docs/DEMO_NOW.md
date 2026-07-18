# Vera offline Ship Season demo

Status: recording-ready deterministic slice  
Updated: 2026-07-18

## What this demo is

This is an offline, single-user product demonstration backed by sanitized fictional fixtures. It
shows Vera's renter-controlled evidence workflow without internet access, marketplace accounts,
credentials, email, calendar, browser automation, or a live language model.

The banner is the contract:

> Demo mode — sanitized fixture data; no live marketplace accounts connected.

## Exact setup and recording commands

From the repository root, run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

`demo:reset` removes only Vera's separate demo application-data directory. `demo:seed` migrates and
loads the sanitized dataset. `demo` starts the local web app and worker with demo mode enabled and
live-model configuration removed from the child environment.

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/). Do not use a previously running non-demo
server on port 3000.

## Recommended 60–90 second narration

**0–10 seconds — establish trust.** “Vera helps renters find fast and rent safely. This recording is
an honest offline demo: the banner confirms that every marketplace label comes from sanitized
fixture data, not a connected account.”

**10–22 seconds — run the search.** “Here is a preconfigured Harbor City profile with a firm budget,
bedroom, move-in, pet, and amenity criteria. Run demo search sends twelve fixture records through
the same fail-closed source policy and immutable capture boundary.” Click **Run demo search** and
pause on the `12 source records analyzed · 8 homes found · 3 duplicate clusters` summary.

**22–45 seconds — explain the inbox.** “Vera turns the twelve source records into eight homes while
keeping duplicate evidence. Each card shows price, freshness, source labels, fit, the strongest
reason, the main concern, and the number of risk indicators.” Open **Juniper Row one-bedroom**.

**45–65 seconds — inspect evidence.** “The stitched view never destroys the original records. Here
are three retained sources, field-level extraction provenance, four deterministic fit factors, and
evidence-backed warnings that say what to verify instead of declaring a scam.” Show the duplicate
explanation and one risk card.

**65–75 seconds — keep the renter in control.** Click **Add to shortlist**. “Shortlisting persists,
but outreach stays disabled. Vera has no send, application, or payment path in this demo.”

**75–90 seconds — close the audit loop.** Open **View all activity**. “Every material step—policy
authorization, capture, normalization reuse, demo completion, and my shortlist decision—is recorded
as append-only safe metadata.”

## Exact click path

1. Open `/` and point to the demo banner.
2. Briefly show **Harbor City September Search** and its five profile dimensions.
3. Click **Run demo search**.
4. Wait for the completion summary and eight listing cards.
5. On **Juniper Row one-bedroom**, click **View evidence**.
6. Show **Fit explanation**, **Risk indicators**, the duplicate explanation, and the three source
   evidence cards. Expand one **Field provenance** disclosure if time permits.
7. Click **Add to shortlist** and wait for **Remove from shortlist** plus the listing activity entry.
8. Click **View all activity →**.
9. Show `listing.shortlisted`, `demo.search.completed`, `normalization.reused`, and
   `capture.policy_authorized` events.

### Optional manual-capture extension

If the recording can run closer to 90 seconds, click **Capture a listing** and use:

- Listing URL: `https://housing.example/demo/harbor-view`
- Pasted listing text:

```text
Base rent: USD 2725 per month
1 bed
1 bath
Address: 88 Demo Harbor Way, Harbor City, NY
Posted: 2026-07-18
Cats allowed
In-unit laundry
```

Click **Capture supplied evidence**, wait for **Evidence captured**, then open **View extraction
evidence**. Point out that unknown values remain unknown and that the provenance URL was recorded but
never fetched. Use the **Activity** navigation link to finish.

If manual capture is unexpectedly slow or fails, do not improvise or imply success. Return to `/`,
open **Juniper Row one-bedroom**, show its already persisted source and provenance evidence, then use
**View all activity**. The core golden path remains complete without the optional capture extension.

## Fixture-backed versus live capabilities

Safe wording:

- “These are sanitized fictional records carrying Zillow, Facebook Marketplace, Craigslist, and
  Apartments.com source labels.”
- “The demo exercises Vera's existing fixture connector, source-policy evaluation, immutable raw
  capture, persisted canonical records, and audit log.”
- “Manual capture accepts only evidence the renter supplies; Vera does not fetch the URL.”
- “Fit and risk explanations are small deterministic demo algorithms, not a complete production
  ranking or fraud-detection system.”

Do not say that Vera searched a live marketplace, logged into an account, contacted a landlord,
verified a listing, detected fraud, sent a message, or scheduled a viewing.

## Railway demo

The public deployment is one fixture-only Railway service with one `/data` volume and one replica.
Runtime startup validates the volume, forces `VERA_DEMO_MODE=1`, removes live-model configuration,
migrates and idempotently seeds SQLite, then supervises the worker and web server. Missing or
unexpected storage fails startup; there is no ephemeral database fallback.

Build: `pnpm build`  
Start: `pnpm deploy:railway`  
Health: `/api/health`

## Known limitations and next steps

- The profile is preconfigured and read-only for this deadline slice.
- Duplicate relationships, canonical records, scores, and risk snapshots are deterministic fixture
  outputs; new-record probabilistic deduplication and continuous rescoring are not implemented.
- Demo search is intentionally local and idempotent. It performs no network request.
- Manual capture is the only user-authorized ingestion surface; its URL remains inert provenance.
- Maritime remains the future primary orchestrator, and OpenClaw remains the future replaceable local
  browser adapter. Neither is implemented here.
- Gmail drafts, Calendar holds, live marketplace connectors, and all autonomous external actions are
  absent. **Prepare outreach — coming next** is intentionally disabled.

The next product milestone should implement new-record clustering and deterministic score/risk
refresh behind the existing provenance and policy boundaries before adding any live source.

## Acceptance commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The Playwright web server owns a temporary SQLite database, resets and seeds it before the suite, sets
`VERA_DEMO_MODE=1`, and runs Chromium with one worker for a deterministic offline golden path.
