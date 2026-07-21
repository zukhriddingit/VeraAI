# Calendar Availability and Tentative Holds Design

Status: proposed for implementation
Date: 2026-07-21
Scope: production-quality Google Calendar free/busy suggestions and user-approved private holds

## Goal

Let an authenticated Vera user define weekly viewing availability, optionally remove conflicts using Google Calendar free/busy, choose one of three provenance-rich windows, and create one private tentative Calendar hold only after approving the exact payload. Calendar access is an enhancement, not a dependency: Vera must continue to suggest windows from its own rules while making every missing, stale, disconnected, or failed conflict check unmistakable.

## Product and safety boundary

This milestone implements:

- a `CalendarClient` contract with deterministic mock and official Google Calendar implementations;
- a separate Google integration OAuth flow, not Better Auth identity OAuth;
- incremental `calendar.freebusy` and `calendar.events.owned` grants;
- a weekly availability editor with an IANA timezone;
- deterministic proposal generation with duration, notice, travel, and buffer rules;
- primary-calendar free/busy checks with no event-detail reads;
- an exact hold preview and payload-bound approval;
- a final conflict recheck before `events.insert`;
- stable provider event identity and idempotent recovery;
- viewing/listing lifecycle transitions, activity events, and internal-first reschedule/cancel controls.

This milestone does not implement:

- Gmail access, Gmail drafts, landlord messaging, or email reply parsing;
- Calendar event attendees, invitations, conferencing, or guest notifications;
- Calendar event update, patch, move, delete, or automatic external cleanup;
- Calendar-list access or multi-calendar selection;
- event title, description, attendee, location, reminder, or organizer reads for conflict checking;
- recurring holds, background Calendar polling, webhooks, a general Google API client, or a generic external-effect framework;
- a real Maritime or OpenClaw integration.

The founder flow can begin from a listing already in `replied` or `tour_proposed`, whether that state came from explicit user input, a sanitized test fixture, or a later Gmail milestone.

## Chosen architecture

Use persisted availability snapshots with synchronous, bounded provider calls.

The web process owns the interactive orchestration because suggestion generation, approval, and final recheck require immediate user feedback. PostgreSQL persists rules, check summaries, proposal provenance, approvals, hold attempts, and audit events. Provider calls occur outside database transactions. The `CalendarClient` hides Google transport details and makes tests deterministic.

Rejected alternatives:

1. Stateless route-only computation cannot prove which Calendar result informed a proposal, detect stale suggestions reliably, or recover an ambiguous event insertion safely.
2. A worker/job architecture adds queue latency and retry machinery without improving the founder interaction. It can be revisited if holds become scheduled or asynchronous.
3. Reusing Better Auth's Google identity grant would mix identity and data authorization, violate incremental consent, and make disconnect/account-linking behavior unsafe.

## Workspace boundaries

### `packages/calendar`

A new focused package owns:

- strict Calendar transport schemas and error types;
- `CalendarClient`;
- `MockCalendarClient`;
- `GoogleCalendarClient` using the official `googleapis` Calendar v3 client;
- the pure availability generator;
- timezone/DST conversion through `@js-temporal/polyfill`;
- canonical hold payload construction and deterministic Google event IDs.

The package exposes no update/delete operation and no generic Google client. Tests inject tokens or a transport double; default tests make no network request.

### `packages/domain`

Domain owns:

- availability rules, check status, window provenance, hold payload, hold state, OAuth capability, and API schemas;
- pure `Viewing` and listing lifecycle transitions;
- approval invariants and canonical effect vocabulary.

### `packages/db`

PostgreSQL owns tenant-scoped persistence, transactions, immutable attempt history, approval consumption, and idempotency uniqueness. The existing demo adapter gains deterministic no-network storage only where the listing-detail E2E flow needs it; it never stores real OAuth credentials and always reports Google disconnected or Vera-rules-only.

### `apps/web`

The web app owns authenticated routes, same-origin mutation checks, OAuth initiation/callback, Settings UI, viewing planner UI, service orchestration, and visible recovery states. Initial page reads remain server-side; weekly editor, selection, approval, retry, and cancel/reschedule controls are client components.

## Google integration authorization

Identity and integration OAuth use different client credentials and environment names:

- `VERA_GOOGLE_INTEGRATION_CLIENT_ID`
- `VERA_GOOGLE_INTEGRATION_CLIENT_SECRET`
- `VERA_GOOGLE_INTEGRATION_REDIRECT_URI`

Production requires an exact HTTPS redirect URI. Loopback HTTP is allowed only in development. The integration client uses the web-server authorization-code flow with PKCE, `access_type=offline`, `include_granted_scopes=true`, and a cryptographically random single-use state.

Each authorization state is bound to:

- authenticated Vera user ID;
- requested capability (`calendar_conflict_checking` or `calendar_hold_creation`);
- exact requested scope set;
- hash of the random state;
- encrypted PKCE verifier;
- creation and expiry times;
- single-use consumed time.

The state expires after ten minutes. Raw state, authorization codes, PKCE verifier, access token, refresh token, client secret, and provider error bodies never enter logs or audit metadata.

The integration flow requests `openid` and `email` to identify the connected Google account plus exactly one incremental Calendar data scope:

- conflict checking: `https://www.googleapis.com/auth/calendar.freebusy`;
- hold creation: `https://www.googleapis.com/auth/calendar.events.owned`.

It does not request event-write access to suggest times. It does not request `calendar`, `calendar.readonly`, `calendar.events`, `calendar.calendarlist.readonly`, or another broader scope.

After every callback Vera verifies the actual grant using the token response and Google's token information response. The persisted `grantedScopes` is the verified set, not the requested set. Partial consent succeeds as a partial connection: granted capabilities work and missing capabilities remain visibly unavailable. If Google does not return a new refresh token during incremental consent, Vera preserves the existing encrypted refresh token; a first connection without refresh material becomes `reconnect_required`.

Refresh tokens use the existing application-layer AES-256-GCM credential envelope. Access tokens exist only in server memory and are refreshed with bounded retries. `invalid_grant`, revocation, or an authorization failure moves the connection to `revoked` or `reconnect_required`; it never becomes an empty Calendar.

The OAuth implementation follows Google's official [web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server) and [incremental authorization guidance](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions).

## Calendar client contract

The narrow interface is:

```ts
interface CalendarClient {
  queryFreeBusy(input: FreeBusyRequest, signal?: AbortSignal): Promise<FreeBusyResult>;
  getTentativeHold(input: GetTentativeHoldRequest, signal?: AbortSignal): Promise<CalendarHoldLookup>;
  insertTentativeHold(
    input: InsertTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<InsertedCalendarHold>;
}
```

`FreeBusyRequest` contains an inclusive query start, exclusive query end, output timezone, and a bounded array of opaque Calendar IDs. The founder implementation accepts exactly `['primary']`. `FreeBusyResult` contains only normalized busy intervals, the exact Calendar IDs successfully checked, and the provider response timestamp. A per-calendar error fails the check; Vera does not accept a partial Calendar result while claiming that calendar was checked.

The Google implementation calls `POST /calendar/v3/freeBusy`, whose official response exposes only busy intervals and per-calendar errors. It never calls events list/get for availability and therefore never receives event titles, descriptions, attendees, or locations. See Google's [freeBusy.query reference](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

`InsertTentativeHoldRequest` is the exact approved provider payload:

- `calendarId: 'primary'`;
- stable Vera-generated event ID;
- summary, location, description;
- exact start/end instants and IANA timezone;
- `status: 'tentative'`;
- `visibility: 'private'`;
- `transparency: 'opaque'`;
- user-selected popup reminders or none;
- `attendees: []`;
- `conferenceData: null`;
- `sendUpdates: 'none'`.

The schema rejects attendees, conference data, a non-primary Calendar ID, notification modes other than `none`, non-tentative status, non-private visibility, and unbounded text/reminders. The Google adapter omits attendees and conferencing from the body and supplies `sendUpdates: 'none'` as the insert query parameter.

The deterministic event ID is `vera` plus a truncated lowercase SHA-256 hex digest over user ID, viewing ID, selected interval, and approved payload hash. Those characters fit Google's base32hex-compatible event-ID restrictions. The complete payload also includes an opaque `VERA-HOLD:<hold-id>` description marker. See Google's [events.insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

`getTentativeHold` exists only for idempotency and ambiguous-outcome recovery. It requests the exact deterministic event ID and returns a bounded projection: existence, ID, Vera marker, start/end, and status. It does not expose arbitrary event reads to application code.

## Calendar errors and timeouts

Provider errors are typed:

- `calendar_scope_not_granted`;
- `calendar_disconnected`;
- `calendar_auth_revoked`;
- `calendar_permission_denied`;
- `calendar_transient_failure`;
- `calendar_timeout`;
- `calendar_rate_limited`;
- `calendar_validation_failed`;
- `calendar_conflict_detected`;
- `calendar_unknown_insert_outcome`.

Free/busy has a bounded timeout and at most one safe transient retry. Timeout, rate limit, transport failure, 5xx, or per-calendar error becomes `google_temporarily_unavailable`; it never produces an empty busy array.

Event creation is not blindly retried. Before an insert and after any timeout/unknown outcome, the adapter looks up the deterministic event ID. If a matching Vera marker and exact interval already exist, the operation resolves idempotently as created. If nothing exists, one insert may proceed. A 409 follows the same lookup-and-verify path. An existing mismatched event is a permanent collision and no new event is created.

## Availability rules

`AvailabilityRuleSet` is tenant owned and contains:

- IANA timezone;
- weekly local-time intervals by ISO weekday;
- viewing duration in minutes;
- minimum notice in minutes;
- symmetric travel time in minutes;
- symmetric buffer time in minutes;
- popup reminder offsets;
- conflict checking enabled flag;
- selected Calendar IDs.

Founder constraints:

- selected Calendar IDs must be exactly `['primary']` when conflict checking is enabled;
- multi-calendar selection and `calendar.calendarlist.readonly` are not implemented;
- the UI states plainly that only the connected account's primary Calendar is checked;
- weekly intervals cannot overlap and must be at least the viewing duration;
- duration is 15–240 minutes;
- minimum notice is 0–10,080 minutes;
- travel and buffer are independently 0–240 minutes;
- popup reminders are unique, bounded, and at most five entries.

Travel plus buffer is applied conservatively to both sides of each Google busy interval. A viewing cannot start until `busyEnd + travel + buffer` and must end by `busyStart - travel - buffer`. This supplies deterministic adjacent-event behavior.

## Deterministic window generation

The generator:

1. takes a trusted clock instant, rule set, 14-day planning horizon, and optional successful free/busy result;
2. enumerates weekly local intervals in the configured IANA timezone at 15-minute boundaries;
3. rejects nonexistent or ambiguous local wall-clock times rather than guessing across daylight-saving transitions;
4. removes candidates before the minimum-notice instant;
5. ensures the whole viewing duration fits inside the weekly interval;
6. when a successful free/busy result exists, removes candidates intersecting busy intervals expanded by travel and buffer;
7. returns the earliest three deterministic candidates, with no more than one candidate per local calendar day on the first pass, then fills remaining slots chronologically;
8. returns an empty collection with a visible recovery action when all candidates are blocked.

Every proposed window stores:

- start/end instants and IANA timezone;
- `availabilitySource`: `google_freebusy` or `vera_rules_only`;
- availability state;
- availability check ID when applicable;
- exact Calendar IDs successfully checked;
- check timestamp;
- whether a visible conflict warning is required;
- a versioned snapshot of contributing rules;
- generator version.

No UI or API calls a fallback window conflict-free. Google-checked text is allowed only when the state is `checked`, the primary Calendar is in `calendarsChecked`, and the check is still fresh.

## Availability states

The closed state set is:

- `checked`: the required scope was verified and primary Calendar free/busy succeeded;
- `scope_not_granted`: the Google connection exists but lacks `calendar.freebusy`;
- `google_disconnected`: connection is absent, disconnected, revoked, expired, or reconnect-required;
- `google_temporarily_unavailable`: a transient provider error, timeout, rate limit, or per-calendar failure occurred;
- `stale`: a previous successful check is more than five minutes old;
- `vera_rules_only`: the user intentionally disabled conflict checking.

All states except fresh `checked` set `requiresConflictWarning=true`. The UI copy is exact:

- fresh checked: “Checked against your primary Google Calendar”;
- otherwise: “Calendar conflicts not checked” plus the specific state and Connect, Reconnect, Retry, or Continue-with-warning action.

An existing proposal becomes `stale` at read time five minutes after its successful check. It is not silently rewritten. Final hold creation always performs a new check regardless of proposal freshness.

## Persisted model and migration

Use an additive PostgreSQL Drizzle migration. Do not reset or rewrite existing listing/source/demo data.

### `availability_rule_sets`

Tenant-owned current rule set with timezone, weekly intervals JSONB, duration/notice/travel/buffer integers, reminder JSONB, conflict-check flag, selected Calendar IDs, schema version, and timestamps. One active rule set per user for the founder release.

### `calendar_oauth_states`

Tenant-owned, short-lived authorization states with hashed state, requested capability/scopes, encrypted PKCE verifier envelope, exact redirect URI hash, expiry, consumed time, and timestamps. State rows are single-use and may be deleted after a short security retention window; audit events retain only safe transition metadata.

### `availability_checks`

Tenant-owned append-only summaries with rule-set ID, optional integration ID, state, requested range, Calendar IDs attempted and successfully checked, checked-at, response hash, busy-interval count, safe provider error category, correlation ID, and timestamps. Raw busy intervals and provider responses are not persisted.

### `calendar_holds`

Tenant-owned hold operation with viewing ID, approval ID, availability-check ID, exact payload hash, stable idempotency key, deterministic event ID, opaque provider event reference, state, override flag/reason, safe error category, created/updated/completed times. Unique constraints cover user/idempotency key and user/calendar ID/event ID.

### Existing tables

`viewings` gains:

- versioned provenance in each proposed window;
- `supersedes_viewing_id` for internal reschedule lineage;
- explicit selected/confirmed interval semantics.

`integration_connections` remains the encrypted token and verified-scope source. `approvals` gains repository-controlled state transitions but no arbitrary update method. `activity_events` remains append-only.

Existing demo or founder `Viewing` JSON is read through a compatibility mapper that marks legacy windows `vera_rules_only` with a required warning. The migration preserves rows and does not infer that a historical window was Calendar-checked.

## Repository contracts and transactions

New tenant-scoped repositories expose:

- get/upsert current availability rules;
- append/get availability checks;
- create/get/list/transition viewings;
- create/get/transition Calendar holds;
- create/get/consume/revoke approvals;
- create/consume OAuth states.

No repository accepts a user ID after construction. Same-owner composite foreign keys cover every relationship.

Approval consumption and hold transition to `creating` occur in one PostgreSQL transaction after the final recheck. The transaction validates:

- approval belongs to the same user and viewing;
- state is pending and unexpired;
- operation is `calendar.hold.create` or `calendar.hold.create_without_conflict_check`;
- exact canonical payload hash matches;
- the selected interval and hold idempotency key match;
- no created hold already exists with a different payload.

Provider network calls occur after commit. Provider success writes the reference, transitions the hold/viewing/listing, and appends success events in a second transaction. Provider failure preserves a retryable or terminal hold state and appends a safe failure event; it cannot roll back the already-observed external outcome.

## State machines

### Viewing

Allowed transitions are explicit and tested:

```text
proposed -> selected -> hold_approved -> hold_created -> confirmed -> completed
     |          |             |               |             |
     +----------+-------------+---------------+-------------+-> cancelled
```

Provider or application code cannot assign a state directly.

### Listing lifecycle

- generating the first proposal from `replied` transitions the listing to `tour_proposed`;
- proposal/selection while already `tour_proposed` keeps that state without an arbitrary write;
- a created hold transitions `tour_proposed` to `tour_scheduled`;
- internal reschedule transitions `tour_scheduled` to `tour_proposed` and creates a new Viewing linked to the cancelled prior Viewing;
- internal cancel transitions `tour_scheduled` to `replied` after marking the Viewing cancelled.

The lifecycle does not claim a landlord confirmed the time. `hold_created` means a private tentative hold exists only on the renter's Calendar. `confirmed` requires later explicit user input or reply evidence.

## Final conflict recheck

Immediately before creation, Vera attempts a fresh primary-Calendar free/busy query for the selected interval expanded by travel and buffer.

1. If the result is fresh and free, creation may continue with the existing exact approval.
2. If a conflict now exists, Vera revokes the unused approval, records `calendar.hold_conflict_detected`, creates no event, and offers newly generated replacement windows.
3. If the scope is missing/disconnected or the check is transiently unavailable, Vera revokes the unused approval and returns `confirmation_required`. The UI shows the exact warning and offers Retry or “Create without a final conflict check.”
4. Choosing the warning override creates a new payload containing `conflictCheckOverride=true`, the failure state, and the selected interval. It requires a new approval with operation `calendar.hold.create_without_conflict_check`.
5. The override never changes the availability provenance to checked and remains visible in the hold and activity history.

No prior approval can authorize the changed override payload.

## Exact approval preview

The server computes and returns a canonical preview containing:

- title `Tentative viewing — {short address}`;
- exact local display time and ISO instants;
- IANA timezone and current offset abbreviation;
- normalized full address as location;
- description containing canonical listing URL, retained source links, user-authored contact notes, and the opaque Vera marker;
- popup reminders;
- Calendar ID `primary`;
- attendee count zero;
- conferencing absent;
- notifications `none`;
- final-check state and any override warning;
- canonical payload hash.

The client displays this response but never constructs the provider payload. The approval/create request sends the expected payload hash and editable inputs; the server rebuilds the canonical payload. A mismatch denies before approval insertion or provider access.

Contact notes and source URLs are sent only because the user explicitly approved them in this Calendar payload. They are excluded from logs and audit metadata.

## Idempotency and retry

The hold idempotency key is domain-separated and stable for user, viewing, selected interval, and canonical payload hash. Repeating the same approved operation returns the same `calendar_holds` row and deterministic provider event ID.

Retry rules:

- a known created hold returns success without a provider call;
- a creating or unknown-outcome hold first calls `getTentativeHold`;
- a matching provider event finalizes local state idempotently;
- a missing provider event permits one insert attempt with the same ID;
- a mismatched provider event fails permanently and asks for support/review;
- a changed interval, reminder, description, address, note, warning override, or timezone creates a different payload hash and requires a new approval.

## Internal reschedule and cancel

The Calendar interface intentionally has no update/delete method.

Cancel:

1. transactionally mark the Vera Viewing `cancelled`;
2. transition a scheduled listing back to `replied`;
3. append `viewing.cancelled_internal` with an opaque provider-reference-present flag;
4. show “The Google Calendar hold may still exist; remove it manually.”

Reschedule:

1. transactionally cancel the old Vera Viewing;
2. transition the listing to `tour_proposed`;
3. create a new proposed Viewing with `supersedesViewingId`;
4. generate/select/approve a new hold normally;
5. show the same manual-cleanup warning for the old event.

Neither action updates, deletes, or hides the old external Calendar event.

## API and UI

### Settings

`/settings/integrations` shows the connected Google account and separate Calendar capability cards:

- Conflict checking: granted/missing/revoked/expired, enable, reconnect;
- Private viewing holds: granted/missing/revoked/expired, enable, reconnect;
- plain-language data-use copy and primary-calendar-only disclosure.

`/settings/availability` provides the weekly editor, timezone, duration, minimum notice, travel, buffer, popup reminders, and conflict-check toggle. Enabling the toggle without scope starts incremental free/busy authorization. Saving rules never requests event-write scope.

### Listing detail

A `Plan a viewing` panel appears for `replied`, `tour_proposed`, and `tour_scheduled` states. It shows:

- three selectable windows or a precise empty/recovery state;
- Google-checked or conflict-not-checked provenance on each window;
- primary Calendar disclosure and check time;
- Retry, Connect/Reconnect, edit availability, and explicit warning continuation;
- exact approval preview;
- `Approve and create private hold`;
- after creation, a clear “Tentative hold created—no landlord was invited or notified” confirmation;
- internal Reschedule and Cancel controls with manual Google cleanup warnings.

Loading, validation, unauthenticated, stale, partial, provider-failure, all-blocked, conflict-before-create, confirmation-required, retrying, and duplicate-success states are explicit.

### Route boundary

Routes are Node runtime, authenticated before resource parsing, Zod-validated, tenant-scoped, same-origin protected for mutation, and return typed no-store responses. OAuth callback is the only cross-origin navigation and is protected by session-bound single-use state.

## Activity events

Material transitions append safe events, including:

- `viewing.availability_saved`;
- `calendar.authorization_requested` and safe callback outcome;
- `calendar.freebusy_checked` or `calendar.freebusy_unavailable`;
- `viewing.proposals_created` and `viewing.window_selected`;
- `calendar.hold_approval_recorded`;
- `calendar.hold_final_check_conflict` or `calendar.hold_final_check_unavailable`;
- `calendar.hold_override_approved`;
- `calendar.hold_created` or `calendar.hold_creation_failed`;
- `viewing.reschedule_started` and `viewing.cancelled_internal`.

Metadata may include opaque IDs, scope capability, state, counts, Calendar ID `primary`, check time, payload hash, idempotency key, retryability, and safe error code. It excludes tokens, codes, PKCE values, provider bodies, event details, contact notes, addresses, descriptions, source URLs, and free/busy intervals.

## Testing strategy

### Unit

- domain schema and every allowed/denied Viewing/listing transition;
- timezone and DST spring-forward/fall-back cases;
- minimum notice and weekly-interval boundaries;
- conflict removal and adjacent busy event plus travel/buffer;
- all candidates blocked;
- deterministic proposal order, provenance, payload hash, event ID, and reminders;
- strict provider payload denies attendees, conference data, notifications, and non-primary calendars;
- mock client golden path and typed failures;
- OAuth state mismatch/expiry/wrong user/single use, requested versus granted scopes, partial grants, and missing refresh token;
- no raw secrets or Calendar event details in logs/events.

### PostgreSQL integration

- additive migration and existing-row compatibility;
- per-user isolation and composite foreign keys;
- encrypted refresh-token and PKCE-verifier persistence;
- append-only availability checks and activity events;
- atomic approval consumption and payload mismatch rollback;
- idempotent hold insertion and concurrent duplicate requests;
- state-transition compare-and-set behavior;
- reschedule/cancel transaction rollback;
- timestamptz and timezone round trips.

### Web/service integration

- missing free/busy scope produces visible `scope_not_granted` fallback;
- partial OAuth grant and revoked permission;
- transient Google failure produces `google_temporarily_unavailable`, never checked/empty;
- stale proposal presentation;
- successful primary-calendar intersection;
- conflict appearing at final recheck prevents insert and returns replacements;
- failed final check requires a new explicit override approval;
- duplicate/ambiguous insert resolves by stable event ID;
- no attendee notification by default;
- provider failure leaves recoverable hold and audited outcome;
- unauthenticated/cross-user access returns 401/404 without disclosure.

### E2E

The default Playwright suite uses `MockCalendarClient`, makes no Google request, and covers:

1. edit weekly availability and timezone;
2. generate three windows with a visible Google-checked state;
3. select a window and inspect exact approval details;
4. approve and create one private hold;
5. retry without a duplicate;
6. inspect lifecycle and activity history;
7. cancel internally and see the manual external-cleanup warning.

An opt-in live test may run only with an explicit flag and dedicated non-production Google account. It is never part of default CI.

## Documentation and verification

Update:

- `docs/ARCHITECTURE.md` for the Calendar boundary and data flow;
- `docs/DATA_MODEL.md` and its Mermaid diagram;
- `docs/SECURITY.md` for OAuth, free/busy privacy, approval, and no-notification invariants;
- `docs/DEMO.md` for mock versus connected Calendar mode;
- `.env.example` and deployment docs for the separate integration client;
- Google verification notes for Calendar sensitive scopes.

Acceptance requires format, lint, typecheck, unit, default integration, PostgreSQL integration, Playwright, build, migration/seed verification, secret scan, and static checks proving that Calendar adapter methods and routes contain no update/delete/attendee/invitation capability.

## Deployment assumptions

- one region, one web instance, one worker instance, one managed PostgreSQL database;
- the interactive Calendar provider runs in the web process with a bounded timeout;
- development, staging, and production use different Google integration clients and redirect URIs;
- Calendar scopes require consent-screen configuration and may require Google verification before public use;
- no Calendar credential or event data is stored in the SQLite demo.

## Completion criteria

The milestone is complete only when:

1. Calendar-free suggestion generation works and is visibly labeled.
2. A granted free/busy scope removes conflicts using only primary Calendar busy intervals.
3. Missing, revoked, stale, denied, timed-out, and transient Calendar states never masquerade as checked.
4. Every proposal persists its required provenance.
5. Final conflict appearance prevents creation and offers replacements.
6. Final-check failure requires a new explicit override approval.
7. One exact approved payload creates at most one tentative private Google event.
8. The payload has no attendees/conference data and uses `sendUpdates=none`.
9. Reschedule/cancel updates Vera first and performs no external mutation.
10. Viewing/listing transitions and material actions are audited.
11. Default tests make no external request and the full acceptance gate passes.
