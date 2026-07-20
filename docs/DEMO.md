# Vera Ship Season demo

Status: deterministic production-path demo contract
Reviewed: 2026-07-20

## What the demo must prove

The demo proves a controlled workflow, not inventory scale:

> Vera notices a strong listing, preserves where its facts came from, recognizes duplicate evidence, explains fit and risk, prepares the right questions, and creates an approved draft and calendar hold without sending or inviting anyone.

The audience should be able to see speed, evidence, uncertainty, and human control at each step.

## Currently implemented demo slice

The automated clean-clone demo currently proves the ingestion, extraction, and deterministic decision foundation:

1. `/` displays eight canonical listings from twelve sanitized source records.
2. `/connectors` shows only the sanitized fixture and manual-capture connectors enabled; platform-label manifests are disabled.
3. `/capture` accepts pasted text or strict structured JSON, optionally with an inert provenance URL.
4. The worker serializes supplied evidence deterministically, runs structured/rule extraction first, and explicitly preserves every unresolved field as unknown.
5. `/captures/[rawListingId]` shows all extraction fields with value or unknown reason, method, confidence, evidence snippet, and a human-readable explanation. Base rent/fees, raw/date availability, cats/dogs, and contacts remain distinct.
6. The default runtime is `deterministic_only` and makes no model request. A live provider is used only when key and environment-selected model are both configured and unresolved fields remain.
7. Repeating the same submission resolves to one immutable raw record, at most one job, one source record, and one immutable extraction run.
8. The activity log records the capture request, exact policy decision, capture result, and normalization result without recording pasted content, prompts, raw model output, evidence snippets, contacts, or credentials.
9. Normalization completion queues a versioned decision job. The same production worker computes duplicate clusters, stitched canonical listings, hard constraints, renormalized ranking factors, separate penalties, and evidence-backed risk indicators.
10. `/` and `/listings/[id]` read the current production-derived score/risk snapshots, show duplicate provenance and unknown facts, and distinguish an ineligible hard-constraint result from a low score.
11. Reconciliation stores immutable input/output hashes and run history, rejects stale corpus revisions, preserves canonical identity where possible, and marks replaced projections as superseded rather than deleting evidence.
12. `/api/dedupe/overrides` records append-only operator merge/split decisions and queues recomputation; `/api/decision-jobs/[id]` exposes the resulting safe job status.

Gmail, Calendar, email-alert acquisition, live Maritime dispatch, and a real OpenClaw bridge remain target MVP work; they are not implemented by this slice.

## P0 decision-cockpit recording path

Use Node 24 and the pinned pnpm version. From the repository root, prepare a clean deterministic dataset and start both the web app and local worker:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm demo:reset
pnpm demo:seed
pnpm demo
```

Leave the final command running and open `http://127.0.0.1:3000`. The reset targets only Vera's dedicated demo-data directory. Demo startup removes live LLM environment variables and uses no credentials or network-backed listing connector.

Record this click path:

1. On `/`, frame the seeded search profile, then select **Run demo search**.
2. Show the **New** inbox, fit ordering, unknown/stale markers, source-observed timing, duplicate badges, and the risk-indicator language.
3. Filter **Source** to Zillow, clear it, and sort by **Price** to demonstrate quick scanning.
4. Open **Inspect Juniper Row one-bedroom**. Show the stitched facts, three preserved source records, field provenance, duplicate evidence, missing-information checklist, deterministic fit reasons, and evidence-backed risk indicators.
5. Select **Add Juniper Row one-bedroom to shortlist**, return to `/`, and open the **Shortlisted** tab.
6. In **New**, select **Dismiss Orchard Lane loft**, then **Confirm**. Open **Archived** to show that dismissal preserves the record.
7. Open **Activity** and show the demo-search, shortlist, and dismissal events. End by noting that **Prepare outreach** is disabled and no message, browser action, or calendar write occurred.

For a clean retake, stop the running process with `Ctrl-C`, then rerun `pnpm demo:reset`, `pnpm demo:seed`, and `pnpm demo`.

## Demo modes

### Deterministic mode

This is the required full clean-clone and automated-test target. The current slice uses sanitized fixtures, manual user-supplied content, deterministic rule extraction and decision evaluation, and a temporary or demo SQLite database. Canonical listings, scores, and risks are computed from seeded evidence through the production worker; they are not hand-authored demo decisions. The deterministic `MockLLMProvider` exists for injected tests, not as a silent product fallback. Future slices may add fake Gmail/Calendar effect adapters. Default demo mode requires no credentials and makes no external network calls.

The implemented sanitized corpus represents four source labels without claiming live connectors:

- Zillow;
- Facebook Marketplace;
- Craigslist;
- Apartments.com.

Fixture acquisition remains explicitly `fixture`. Manual capture is the separate implemented user-authorized path. A sanitized email-alert connector must be labeled unavailable until that adapter exists.

The data should include:

- at least one duplicate cluster spanning channels;
- one high-fit listing with a few unknown fields;
- one evidence-backed risk indicator;
- one stale or hard-constraint-violating listing;
- one landlord-reply fixture with an offered viewing time.

### Connected mode

Connected mode is an opt-in founder acceptance run. It uses a dedicated non-production Google account and locally configured OAuth. It demonstrates one real Gmail alert ingestion, one Gmail draft creation, and one Calendar hold.

External connectors stay disabled until the presenter connects and enables them. The presenter must inspect recipients, subject, body, time zone, event fields, and attendee count before each approval.

Connected mode never sends the Gmail draft and never adds a Calendar attendee.

## Prerequisites

For deterministic mode:

1. Install the documented Node 24 LTS and pinned pnpm version.
2. Install locked dependencies.
3. Run migrations against a demo database.
4. Run the root `pnpm db:seed`; it seeds only sanitized evidence and executes the bounded production worker pass.
5. Start web and worker.
6. Confirm the connector-health view shows external connectors disabled.
7. Confirm both live LLM variables are unset so the worker reports deterministic-only mode.

For connected mode, also:

1. Use a dedicated Google test account with no sensitive mailbox data.
2. Configure OAuth outside the repository.
3. Connect Gmail read, Gmail compose, and Calendar capabilities incrementally.
4. Confirm each manifest is still disabled until explicitly enabled.
5. Send a sanitized test alert to the dedicated account.

Never place credentials, real landlord contact information, or personal listing data in screenshots, fixtures, logs, recordings, or commits.

## Golden demo flow

1. Open the dashboard and show the active search profile.
2. Submit the sanitized manual listing and follow `View extraction evidence` to `/captures/[rawListingId]`.
3. Point out observed time, source-posted time when known, deterministic-only mode, and prompt/extraction versions.
4. Show base rent separately from required recurring fees, raw availability beside any justified date, cats separately from dogs, and contacts only when explicitly present.
5. Show that a missing fee and move-in date are “unknown,” not “no fee” or “unavailable,” and expand the field explanation/evidence.
6. Trigger the implemented fixture/manual channels; add the sanitized-email-alert channel only after its fake or connected adapter exists.
7. Open a computed duplicate cluster. Show every source record, field provenance, freshness, and the canonical stitched values. For a new manual capture, follow its normalization and decision-job status until the production reconciliation pass completes.
8. Open the deterministic score explanation: hard constraints, active weights, factor values, penalties, reason codes, and score version.
9. Open a risk indicator and its exact evidence. Read the verification action, not a scam verdict.
10. Shortlist the strongest match.
11. Generate outreach from known facts and missing questions.
12. Edit one sentence. Show that a prior approval would be invalidated, then approve the final recipients, subject, and body.
13. Create the fake or real Gmail draft. Show the state “draft created” and verify that no sent state or send control exists.
14. Load the sanitized reply or enter a viewing window explicitly.
15. Review time zone, start/end, tentative state, empty attendee list, and no conferencing. Approve the hold.
16. Create the fake or real calendar event and show that retrying does not duplicate it.
17. Open the activity log. Trace requested, policy-authorized, approval, succeeded, and any intentionally denied events by correlation ID.
18. Open connector health and demonstrate that platform-label manifests and unimplemented external connectors remain disabled.
19. End with the measurable outcome: time saved, a viewing prepared, or a risky inconsistency caught.

## Safety beats

The presenter should explicitly say:

- “Vera did not fetch or scrape the manually entered URL.”
- “Deterministic rules ran first. A model can fill only requested gaps and cannot overwrite stronger evidence.”
- “The default demo made no model request; unknown still means unknown.”
- “These are risk indicators with evidence, not a fraud verdict.”
- “The AI proposed structured content; deterministic code validated it.”
- “This approval is bound to the exact payload and cannot be reused after an edit.”
- “Gmail contains a draft. Vera has no send path.”
- “The calendar event has no attendees, so the landlord was not invited.”
- “Every external connector started disabled and passed the same policy gate.”

## Expected denial demonstrations

At least one deterministic test or optional demo beat should show:

- a missing manifest is denied;
- a manual URL produces no network request;
- a Gmail draft request with an expired or mismatched approval is denied;
- a Calendar payload with an attendee is denied;
- a prompt-injection sentence in listing text is preserved as data and cannot change policy;
- a browser capture request is denied because its manifest is disabled.

## Failure and fallback plan

- If live OAuth fails, remain in deterministic mode. Do not weaken scopes or hard-code tokens.
- If the worker is interrupted, restart it and show lease recovery and idempotent processing.
- If a provider create has an ambiguous outcome, look up the deterministic provider ID before retrying.
- If AI output is invalid twice, show the visible dead-letter extraction failure and recovery action; do not substitute guessed data or fall back to a mock.
- If Calendar or Gmail is unavailable, use the fake adapter and label it clearly.

Fixture fallback is a product reliability feature, not a reason to imply that a live integration succeeded.

## Reset and cleanup

After deterministic mode, stop processes and remove only the explicitly selected temporary/demo database through the documented demo reset command added during implementation.

After connected mode:

- delete the created Gmail draft and tentative event manually if desired;
- disconnect test connectors and revoke test tokens;
- remove local test-account tokens through TokenStore;
- inspect logs for accidental personal data;
- never commit the local database or OAuth configuration.

## Demo acceptance checklist

- Clean clone works without credentials.
- Seeded canonical listings, scores, and risks are production-evaluator output rather than fixture-authored decisions.
- Capture evidence detail shows known/unknown, evidence, method, confidence, and extraction mode.
- Default demo and automated tests make no live model request.
- Four sanitized source labels are visible without implying live platform access.
- One real Gmail alert can be ingested in the separate connected acceptance run.
- Duplicate provenance, unknown fields, score reasons, risk evidence, and latency are visible.
- Gmail creation ends in draft state with no send path.
- Calendar hold has no attendees or conferencing and is idempotent.
- Activity history is append-only and complete.
- External connectors default to disabled.
- No platform scraping occurs.
- Automated tests complete without live side effects.
