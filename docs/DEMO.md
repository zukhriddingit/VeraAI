# Vera Ship Season demo

Status: deterministic production-path demo contract
Reviewed: 2026-07-21

## Persistence isolation

Hosted Vera uses PostgreSQL only. This demo uses SQLite only through `pnpm demo:*`, a fixed synthetic owner, and an explicit launch capability. A generic environment flag or SQLite path is insufficient to select the adapter. The demo schema contains no hosted users, sessions, accounts, verifications, OAuth credentials, browser cookies, or real personal data. Its process-local Calendar sidecar exposes one immutable, no-token capability fixture; it is not a connected Google account and cannot be mutated into one.

The twelve records are sanitized fixtures carrying Zillow, Facebook Marketplace, Craigslist, and Apartments.com source labels. Those labels are evidence metadata, not production connectors and not claims of live retrieval. The demo worker processes only the isolated demo database; normal hosted worker commands require `DATABASE_URL` and cannot fall back to SQLite.

## What the demo must prove

The demo proves a controlled workflow, not inventory scale:

> Vera notices a strong listing, preserves where its facts came from, recognizes duplicate evidence, explains fit and risk, prepares the right questions, and creates an approved draft and calendar hold without sending or inviting anyone.

The audience should be able to see speed, evidence, uncertainty, and human control at each step.

## Currently implemented demo slice

The automated clean-clone demo currently proves the ingestion, extraction, and deterministic decision foundation:

1. `/demo` displays eight canonical listings from twelve sanitized source records.
2. `/connectors` shows only the sanitized fixture and manual-capture connectors enabled; platform-label manifests are disabled.
3. `/capture` accepts pasted text or strict structured JSON, optionally with an inert provenance URL.
4. The worker serializes supplied evidence deterministically, runs structured/rule extraction first, and explicitly preserves every unresolved field as unknown.
5. `/captures/[rawListingId]` shows all extraction fields with value or unknown reason, method, confidence, evidence snippet, and a human-readable explanation. Base rent/fees, raw/date availability, cats/dogs, and contacts remain distinct.
6. The default runtime is `deterministic_only` and makes no model request. A live provider is used only when key and environment-selected model are both configured and unresolved fields remain.
7. Repeating the same submission resolves to one immutable raw record, at most one job, one source record, and one immutable extraction run.
8. The activity log records the capture request, exact policy decision, capture result, and normalization result without recording pasted content, prompts, raw model output, evidence snippets, contacts, or credentials.
9. Normalization completion queues a versioned decision job. The same production worker computes duplicate clusters, stitched canonical listings, hard constraints, renormalized ranking factors, separate penalties, and evidence-backed risk indicators.
10. `/demo` and `/listings/[id]` read the current production-derived score/risk snapshots, show duplicate provenance and unknown facts, and distinguish an ineligible hard-constraint result from a low score.
11. Reconciliation stores immutable input/output hashes and run history, rejects stale corpus revisions, preserves canonical identity where possible, and marks replaced projections as superseded rather than deleting evidence.
12. `/api/dedupe/overrides` records append-only operator merge/split decisions and queues recomputation; `/api/decision-jobs/[id]` exposes the resulting safe job status.

Hosted production now has narrow Gmail alert ingestion, authenticated Maritime dispatch, generic Web Push, and a founder-only OpenClaw current-tab bridge. None is composed into deterministic demo mode. Calendar has production contracts, PostgreSQL state, an incremental OAuth boundary, deterministic availability/hold services, and mock/Google client adapters; the credential-free demo uses only mocks and never treats fixture behavior as a connected provider result.

Gmail draft creation is not implemented in the current repository. ADR 0003 defines its eventual draft-only boundary, but current demo and hosted flows must leave **Prepare outreach** disabled and must not claim that a Gmail draft exists.

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

Leave the final command running and open `http://127.0.0.1:3000/demo`. The public website is available at `/`; the deterministic cockpit and recording flow begin at `/demo`. The landing route has no database, session, or external integration dependency. The reset targets only Vera's dedicated demo-data directory. Demo startup removes live LLM environment variables and uses no credentials or network-backed listing connector.

Record this click path:

1. On `/demo`, frame the seeded search profile, then select **Run demo search**.
2. Show the **New** inbox, fit ordering, unknown/stale markers, source-observed timing, duplicate badges, and the risk-indicator language.
3. Filter **Source** to Zillow, clear it, and sort by **Price** to demonstrate quick scanning.
4. Open **Inspect Juniper Row one-bedroom**. Show the stitched facts, three preserved source records, field provenance, duplicate evidence, missing-information checklist, deterministic fit reasons, and evidence-backed risk indicators.
5. Select **Add Juniper Row one-bedroom to shortlist**, return to `/demo`, and open the **Shortlisted** tab.
6. In **New**, select **Dismiss Orchard Lane loft**, then **Confirm**. Open **Archived** to show that dismissal preserves the record.
7. Open **Inspect Maple Crescent 2B**, then **Suggest three viewing times**. Point out **Calendar conflicts not checked** and the explicit statement that no Google account or API is being used.
8. Select a proposed time, choose **Review time with conflict warning**, and review the exact title, address, timezone, and **Notifications: None** preview.
9. Select **Approve and create private tentative hold**. When the final check cannot run, show that Vera requires a second, explicitly warned approval instead of silently treating the Calendar as empty.
10. Select **Approve and create without a completed final conflict check** and show **Simulated tentative hold created—nothing was written to Google Calendar**.
11. Open **Activity** and show the demo-search, shortlist, dismissal, viewing, approval, and simulated-hold events. End by noting that **Prepare outreach** is disabled and no message, browser action, or real calendar write occurred.

For a clean retake, stop the running process with `Ctrl-C`, then rerun `pnpm demo:reset`, `pnpm demo:seed`, and `pnpm demo`.

## Demo modes

### Deterministic mode

This is the required full clean-clone and automated-test target. The current slice uses sanitized fixtures, manual user-supplied content, deterministic rule extraction and decision evaluation, and a temporary or demo SQLite database. Canonical listings, scores, and risks are computed from seeded evidence through the production worker; they are not hand-authored demo decisions. The deterministic `MockLLMProvider` exists for injected tests, not as a silent product fallback. The process-owned `MockCalendarClient` supplies deterministic free/busy and hold outcomes only when demo composition explicitly injects it. Default demo mode requires no credentials and makes no external network calls.

Mock Calendar results must be labeled **Simulated Calendar check** or **Simulated tentative hold**. They must never display the connected copy **Checked against your Google Calendar**. A rules-only proposal is instead labeled **Calendar conflicts not checked** and retains its warning.

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

Connected mode is an opt-in founder acceptance run. It uses a dedicated non-production Google account and separately configured identity and integration OAuth clients. The Calendar acceptance path may demonstrate a real primary-calendar free/busy check and one approved tentative hold; Gmail acceptance remains a separate integration milestone until its production adapter is present.

External connectors stay disabled until the presenter connects and enables them. The presenter must inspect recipients, subject, body, time zone, event fields, and attendee count before each approval.

Connected mode currently has no Gmail draft operation and never adds a Calendar attendee.

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
3. Enable Calendar conflict checking first and grant `calendar.freebusy`; grant `calendar.events.owned` separately only when testing hold creation.
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
13. Leave **Prepare outreach** disabled. Draft-only Gmail creation remains a later implementation and no sent state or send control exists.
14. Load the sanitized reply or enter a viewing window explicitly. Show three proposals derived from Vera's weekly rules.
15. In connected mode, show **Checked against your primary Google Calendar** and the check time. In demo or degraded mode, show **Calendar conflicts not checked** (or the explicit simulated label) and never call the windows conflict-free.
16. Review the exact time zone, start/end, tentative/private state, empty attendee list, no conferencing, and no notifications. Approve the payload, run the final conflict recheck, create the mock or real hold, and show that retrying does not duplicate it.
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
- “Gmail draft creation is not implemented yet, and Vera has no send path.”
- “This check covered only the connected account's primary calendar.”
- “The calendar event is private and tentative, has no attendees, and sent no notifications.”
- “The demo Calendar result is simulated and made no Google request.”
- “Every external connector started disabled and passed the same policy gate.”

## Expected denial demonstrations

At least one deterministic test or optional demo beat should show:

- a missing manifest is denied;
- a manual URL produces no network request;
- no Gmail draft or send route exists;
- a Calendar payload with an attendee is denied;
- a prompt-injection sentence in listing text is preserved as data and cannot change policy;
- a browser capture request is denied because its manifest is disabled.

## Failure and fallback plan

- If live OAuth fails, remain in deterministic mode. Do not weaken scopes or hard-code tokens.
- If the worker is interrupted, restart it and show lease recovery and idempotent processing.
- If a provider create has an ambiguous outcome, look up the deterministic provider ID before retrying.
- If AI output is invalid twice, show the visible dead-letter extraction failure and recovery action; do not substitute guessed data or fall back to a mock.
- If Google Calendar permission is absent or revoked, show `scope_not_granted` or `google_disconnected`, generate rules-only windows, label them **Calendar conflicts not checked**, and expose Connect/Reconnect.
- If Google Calendar times out or fails transiently, show `google_temporarily_unavailable`, expose Retry, and allow rules-only continuation only with an explicit conflict warning. Do not silently substitute the mock in hosted mode.
- If the final conflict recheck fails, require a new exact override approval. If it finds a conflict, create no hold and offer replacements.
- Use the mock Calendar adapter only in explicit deterministic demo/test composition and label it clearly.

Fixture fallback is a product reliability feature, not a reason to imply that a live integration succeeded.

## Reset and cleanup

After deterministic mode, stop processes and remove only the explicitly selected temporary/demo database through the documented demo reset command added during implementation.

After connected mode:

- delete the created tentative event manually if desired;
- disconnect test integrations, revoke test grants, and verify Vera cleared the encrypted local credential material;
- remember that founder-release cancel/reschedule updates Vera only, so delete or edit a real Google event manually;
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
- Gmail alert ingestion remains read-only; draft creation and all send paths are absent.
- Calendar hold has no attendees or conferencing and is idempotent.
- Primary-calendar free/busy is the only connected conflict source, and raw busy intervals are not retained.
- Every rules-only fallback is visibly warned; transient failure is never treated as an empty calendar.
- The final recheck blocks a new conflict and requires a new explicit override approval when it cannot complete.
- The deterministic Calendar path makes no network request and is visibly simulated.
- Activity history is append-only and complete.
- External connectors default to disabled.
- No platform scraping occurs.
- Automated tests complete without live side effects.
