# Calendar Availability and Tentative Holds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated Vera renter define weekly viewing availability, optionally remove primary-calendar conflicts through Google free/busy, and create one private tentative Google Calendar hold only after exact approval and a final conflict recheck.

**Architecture:** Add a narrow `@vera/calendar` package for pure scheduling and Google transport, strict domain contracts and state machines in `@vera/domain`, and additive tenant-owned PostgreSQL persistence beneath the existing repository provider. Hosted Next.js services perform bounded free/busy checks and exact approved inserts; the deterministic demo injects the mock provider and visibly labels Vera-rules-only results.

**Tech Stack:** Node.js 24, TypeScript 6 strict mode, pnpm 11.14.0 workspaces, Next.js 16.2.10, React 19.2.7, PostgreSQL 18.4, Drizzle ORM 0.45.2, Zod 4.4.3, `googleapis` 173.0.0, `@js-temporal/polyfill` 0.5.1, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Calendar conflict checking and Calendar hold creation are independent capabilities.
- Request `https://www.googleapis.com/auth/calendar.freebusy` only when conflict checking is enabled.
- Request `https://www.googleapis.com/auth/calendar.events.owned` only when the user enables or first uses hold creation.
- Never request `calendar`, `calendar.readonly`, `calendar.events`, or `calendar.calendarlist.readonly` in this milestone.
- Founder conflict checks target exactly the connected account's `primary` calendar; never claim that other calendars were checked.
- Free/busy responses are the only Calendar data used for availability checking; never fetch event titles, descriptions, attendees, locations, or organizers.
- Missing scope, disconnection, revocation, stale data, timeout, provider failure, or a per-calendar error must never become an empty or successful Calendar result.
- Every proposed window persists availability source, exact calendars checked, check time, warning requirement, and the versioned Vera rules that produced it.
- Immediately before insertion, recheck the selected interval; a new conflict blocks creation and a failed recheck requires a new explicit override approval.
- Exact approval is bound to a canonical SHA-256 payload hash; changed times, notes, reminders, warnings, or timezone require a new approval.
- Insert only a tentative, private, opaque event on `primary` with no attendees, no conference data, and `sendUpdates=none`.
- Calendar event insertion is idempotent through a deterministic Vera event ID and provider lookup after ambiguous outcomes.
- Reschedule and cancel update Vera first and never patch or delete an external Calendar event.
- Access and refresh tokens, OAuth codes, state values, PKCE verifiers, client secrets, event descriptions, addresses, contact notes, source URLs, and raw free/busy intervals never enter logs or audit metadata.
- PostgreSQL is the only hosted persistence engine. SQLite remains an explicit sanitized demo adapter with no real OAuth credentials or network calls.
- Default unit, integration, E2E, and build commands make no Google request.
- Preserve all current listing/source rows and demo fixtures through additive migrations; do not reset user data.
- Every Calendar API route uses the Node runtime, authenticates before entity parsing, validates input/output with shared strict Zod schemas, returns `Cache-Control: no-store`, and applies tenant-scoped repositories; every mutation except the state-bound OAuth callback enforces same-origin requests.
- Settings and listing pages perform initial reads in server components; only editors, proposal selection, approval, retry, reschedule, cancel, and visible loading/error state use client components.

## Target File Structure

```text
packages/calendar/package.json                         # focused Calendar package manifest
packages/calendar/tsconfig.json                        # strict workspace TypeScript config
packages/calendar/src/contracts.ts                     # transport request/result schemas
packages/calendar/src/errors.ts                        # typed, redacted provider errors
packages/calendar/src/availability.ts                  # Temporal-based deterministic generator
packages/calendar/src/hold-payload.ts                  # canonical payload, hash, event ID
packages/calendar/src/mock-client.ts                   # deterministic no-network client
packages/calendar/src/google-client.ts                 # official Calendar v3 adapter
packages/calendar/src/index.ts                         # public package boundary
packages/domain/src/calendar.ts                        # persisted Calendar/availability contracts
packages/domain/src/calendar-api.ts                    # shared route request/response schemas
packages/domain/src/workflows.ts                       # approval/viewing states and transitions
packages/domain/src/lifecycle.ts                       # reschedule/cancel listing transitions
packages/db/src/repositories.ts                        # availability/OAuth/hold repository contracts
packages/db/src/postgres/schema.ts                     # additive tenant-owned tables/columns
packages/db/src/postgres/calendar-repositories.ts      # tenant-scoped Calendar persistence
packages/db/src/postgres/calendar-transactions.ts      # approval/hold transaction boundaries
packages/db/src/demo/calendar-repositories.ts          # no-credential deterministic demo support
packages/db/drizzle/0001_calendar_availability.sql     # generated additive PostgreSQL migration
apps/web/lib/server/integration-config.ts              # strict integration OAuth/timeout config
apps/web/lib/server/google-integration-oauth.ts         # PKCE, state, callback, refresh/revoke
apps/web/lib/server/calendar-application.ts            # injected provider/service composition
apps/web/lib/calendar-service.ts                       # availability and hold orchestration
apps/web/lib/server/request-security.ts                # same-origin mutation guard
apps/web/app/settings/integrations/*                   # capability/connection UI
apps/web/app/settings/availability/*                   # weekly rules editor
apps/web/app/listings/[id]/viewing-planner.tsx          # listing-detail planner and hold UX
apps/web/app/api/integrations/google/calendar/*         # incremental OAuth routes
apps/web/app/api/availability/rules/route.ts            # current rule read/write
apps/web/app/api/listings/[id]/viewings/route.ts        # generate persisted proposals
apps/web/app/api/viewings/[id]/*                        # select, approve, create, retry, cancel
tests/e2e/calendar-hold.spec.ts                         # deterministic golden and fallback flows
```

---

### Task 1: Establish the narrow Calendar package and strict transport contracts

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/package.json`
- Create: `packages/calendar/package.json`
- Create: `packages/calendar/tsconfig.json`
- Create: `packages/calendar/src/contracts.ts`
- Create: `packages/calendar/src/contracts.unit.test.ts`
- Create: `packages/calendar/src/errors.ts`
- Create: `packages/calendar/src/errors.unit.test.ts`
- Create: `packages/calendar/src/index.ts`

**Interfaces:**
- Consumes: `IsoDateTimeSchema` and `Sha256Schema` from `@vera/domain`.
- Produces: `CalendarClient`, `FreeBusyRequest`, `FreeBusyResult`, `InsertTentativeHoldRequest`, `InsertedCalendarHold`, `CalendarHoldLookup`, `CalendarProviderError`, and `CalendarProviderErrorCode`.

- [ ] **Step 1: Write failing strict-boundary tests**

```ts
import { describe, expect, it } from "vitest";

import {
  FreeBusyRequestSchema,
  InsertTentativeHoldRequestSchema
} from "./contracts.ts";

const interval = {
  startsAt: "2026-11-02T15:00:00.000Z",
  endsAt: "2026-11-02T16:00:00.000Z"
};

describe("Calendar transport contracts", () => {
  it("permits only the primary calendar for the founder release", () => {
    expect(FreeBusyRequestSchema.parse({ ...interval, timeZone: "America/New_York", calendarIds: ["primary"] })).toBeDefined();
    expect(() => FreeBusyRequestSchema.parse({ ...interval, timeZone: "America/New_York", calendarIds: ["work@example.test"] })).toThrow();
  });

  it("rejects notification, attendee, conference, and visibility widening", () => {
    const safe = {
      calendarId: "primary",
      eventId: "vera0123456789abcdef",
      veraMarker: "VERA-HOLD:hold-1",
      summary: "Tentative viewing — 12 Cedar St",
      location: "12 Cedar St, Boston, MA",
      description: "Sanitized source references\nVERA-HOLD:hold-1",
      ...interval,
      timeZone: "America/New_York",
      remindersMinutesBeforeStart: [30],
      status: "tentative",
      visibility: "private",
      transparency: "opaque",
      attendees: [],
      conferenceData: null,
      sendUpdates: "none"
    } as const;
    expect(InsertTentativeHoldRequestSchema.parse(safe)).toEqual(safe);
    expect(() => InsertTentativeHoldRequestSchema.parse({ ...safe, attendees: [{ email: "landlord@example.test" }] })).toThrow();
    expect(() => InsertTentativeHoldRequestSchema.parse({ ...safe, sendUpdates: "all" })).toThrow();
    expect(() => InsertTentativeHoldRequestSchema.parse({ ...safe, visibility: "public" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and confirm missing-module failures**

Run: `pnpm vitest run packages/calendar/src/contracts.unit.test.ts packages/calendar/src/errors.unit.test.ts`

Expected: FAIL because `packages/calendar/src/contracts.ts` and `errors.ts` do not exist.

- [ ] **Step 3: Add the package manifest and closed interface**

Use these dependencies and exports:

```json
{
  "name": "@vera/calendar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@js-temporal/polyfill": "0.5.1",
    "@vera/domain": "workspace:*",
    "googleapis": "173.0.0",
    "zod": "4.4.3"
  }
}
```

Define the public interface exactly as:

```ts
export interface CalendarClient {
  queryFreeBusy(input: FreeBusyRequest, signal?: AbortSignal): Promise<FreeBusyResult>;
  getTentativeHold(input: GetTentativeHoldRequest, signal?: AbortSignal): Promise<CalendarHoldLookup>;
  insertTentativeHold(input: InsertTentativeHoldRequest, signal?: AbortSignal): Promise<InsertedCalendarHold>;
}
```

Use strict Zod schemas with an exclusive end time, IANA timezone validation, `calendarIds: z.tuple([z.literal("primary")])`, bounded text, no more than five unique popup reminders, and the exact constants shown in the tests. `CalendarHoldLookup` exposes only `exists`, provider event ID, Vera marker, interval, and status. It cannot expose a general event resource.

Define redacted error codes:

```ts
export const CalendarProviderErrorCodeSchema = z.enum([
  "calendar_scope_not_granted",
  "calendar_disconnected",
  "calendar_auth_revoked",
  "calendar_permission_denied",
  "calendar_transient_failure",
  "calendar_timeout",
  "calendar_rate_limited",
  "calendar_validation_failed",
  "calendar_conflict_detected",
  "calendar_unknown_insert_outcome"
]);

export class CalendarProviderError extends Error {
  constructor(
    readonly code: CalendarProviderErrorCode,
    readonly retryable: boolean,
    readonly httpStatus: number
  ) {
    super(`Calendar provider operation failed: ${code}.`);
    this.name = "CalendarProviderError";
  }
}
```

The error must not retain a provider body, token, URL, event description, or cause with raw response data.

- [ ] **Step 4: Install and pass focused tests and typecheck**

Run: `pnpm install && pnpm vitest run packages/calendar/src/contracts.unit.test.ts packages/calendar/src/errors.unit.test.ts && pnpm --filter @vera/calendar typecheck`

Expected: dependencies pinned in `pnpm-lock.yaml`; focused tests and package typecheck PASS.

- [ ] **Step 5: Commit the package boundary**

```bash
git add package.json pnpm-lock.yaml apps/web/package.json packages/calendar
git commit -m "feat(calendar): define safe provider contracts"
```

---

### Task 2: Add strict availability, approval, hold, and lifecycle domain contracts

**Files:**
- Create: `packages/domain/src/calendar.ts`
- Create: `packages/domain/src/calendar.unit.test.ts`
- Create: `packages/domain/src/calendar-api.ts`
- Create: `packages/domain/src/calendar-api.unit.test.ts`
- Modify: `packages/domain/src/workflows.ts`
- Create: `packages/domain/src/workflows.unit.test.ts`
- Modify: `packages/domain/src/lifecycle.ts`
- Modify: `packages/domain/src/lifecycle.unit.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: existing `EntityIdSchema`, `IsoDateTimeSchema`, `Sha256Schema`, `JsonObjectSchema`, `Approval`, `Viewing`, and listing lifecycle.
- Produces: `AvailabilityRuleSet`, `AvailabilityCheck`, `ProposedViewingWindow`, `CalendarHold`, `CalendarOAuthState`, route schemas, `transitionViewingState`, and `transitionApprovalState`.

- [ ] **Step 1: Write failing schema and transition tests**

```ts
import { describe, expect, it } from "vitest";

import {
  AvailabilityCheckStateSchema,
  AvailabilityRuleSetSchema,
  InvalidApprovalTransitionError,
  InvalidViewingTransitionError,
  transitionApprovalState,
  transitionViewingState
} from "./index.ts";

const baseRules = {
  id: "availability-rules-1",
  timeZone: "America/New_York",
  weeklyIntervals: {
    "1": [{ startsAt: "09:00", endsAt: "12:00" }],
    "2": [],
    "3": [],
    "4": [],
    "5": [],
    "6": [],
    "7": []
  },
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: true,
  calendarIds: ["primary"],
  schemaVersion: 1,
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z"
} as const;

describe("Calendar domain", () => {
  it("supports the six explicit availability states", () => {
    expect(AvailabilityCheckStateSchema.options).toEqual([
      "checked",
      "scope_not_granted",
      "google_disconnected",
      "google_temporarily_unavailable",
      "stale",
      "vera_rules_only"
    ]);
  });

  it("rejects overlapping weekly rules and non-primary selection", () => {
    expect(() => AvailabilityRuleSetSchema.parse({ ...baseRules, calendarIds: ["work"] })).toThrow();
    expect(() => AvailabilityRuleSetSchema.parse({
      ...baseRules,
      weeklyIntervals: {
        ...baseRules.weeklyIntervals,
        "1": [
          { startsAt: "09:00", endsAt: "11:00" },
          { startsAt: "10:30", endsAt: "12:00" }
        ]
      }
    })).toThrow();
  });

  it("allows only explicit viewing and approval transitions", () => {
    expect(transitionViewingState("proposed", "selected")).toBe("selected");
    expect(transitionViewingState("selected", "hold_approved")).toBe("hold_approved");
    expect(() => transitionViewingState("proposed", "hold_created")).toThrow(InvalidViewingTransitionError);
    expect(transitionApprovalState("pending", "used")).toBe("used");
    expect(() => transitionApprovalState("revoked", "used")).toThrow(InvalidApprovalTransitionError);
  });
});
```

- [ ] **Step 2: Verify the tests fail at the missing contracts**

Run: `pnpm vitest run packages/domain/src/calendar.unit.test.ts packages/domain/src/calendar-api.unit.test.ts packages/domain/src/workflows.unit.test.ts packages/domain/src/lifecycle.unit.test.ts`

Expected: FAIL because the Calendar schemas and transition functions are not exported.

- [ ] **Step 3: Implement closed schemas and state machines**

Use these central shapes:

```ts
export const AvailabilityCheckStateSchema = z.enum([
  "checked",
  "scope_not_granted",
  "google_disconnected",
  "google_temporarily_unavailable",
  "stale",
  "vera_rules_only"
]);

export const AvailabilitySourceSchema = z.enum(["google_freebusy", "vera_rules_only"]);
export const CalendarCapabilitySchema = z.enum([
  "calendar_conflict_checking",
  "calendar_hold_creation"
]);
export const CalendarGoogleScopeSchema = z.enum([
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
]);
export type CalendarGoogleScope = z.infer<typeof CalendarGoogleScopeSchema>;
export const CalendarHoldStateSchema = z.enum([
  "approval_pending",
  "approved",
  "creating",
  "created",
  "retryable_failed",
  "permanently_failed",
  "cancelled_internal"
]);
```

`AvailabilityRuleSet` includes `id`, `timeZone`, `weeklyIntervals` keyed by ISO weekday `"1"` through `"7"` with arrays of `{ startsAt: "HH:mm", endsAt: "HH:mm" }`, duration, notice, travel, buffer, unique popup reminders, `conflictCheckingEnabled`, `calendarIds`, `schemaVersion: 1`, and timestamps. Bounds are duration 15–240, notice 0–10,080, travel/buffer 0–240, at most five reminders, non-overlapping weekly intervals, and exactly `['primary']` only when checking is enabled.

`ProposedViewingWindow` contains interval, timezone, `availabilitySource`, state, nullable check ID/time, exact checked IDs, warning flag, complete contributing-rule snapshot, and `generatorVersion: "availability.v1"`. Require `checked` to carry source `google_freebusy`, `['primary']`, a check ID/time, and no warning. Every other state uses `vera_rules_only` and requires a warning.

Define the exact approval projection in `calendar-api.ts`:

```ts
export interface CalendarHoldApprovalPreview {
  readonly viewingId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly localTimeLabel: string;
  readonly timeZone: string;
  readonly offsetLabel: string;
  readonly normalizedAddress: string;
  readonly description: string;
  readonly remindersMinutesBeforeStart: readonly number[];
  readonly calendarId: "primary";
  readonly attendeeCount: 0;
  readonly conferencing: false;
  readonly notifications: "none";
  readonly finalCheckState: AvailabilityCheckState;
  readonly conflictCheckOverride: boolean;
  readonly warning: string | null;
  readonly payloadHash: string;
}
```

The matching strict Zod schema caps every text/array field, validates the hash and interval, requires a warning for every non-checked final state, and rejects unknown keys.

Extend `Viewing` with a nullable `selectedWindow`, `supersedesViewingId`, and provenance-rich proposed windows. The row compatibility parser accepts legacy `{startsAt, endsAt}` windows only at the database mapper and upgrades them to `vera_rules_only`; the public schema remains strict.

Define transition maps:

```ts
export const ALLOWED_VIEWING_TRANSITIONS = {
  proposed: ["selected", "cancelled"],
  selected: ["hold_approved", "proposed", "cancelled"],
  hold_approved: ["hold_created", "selected", "cancelled"],
  hold_created: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: []
} as const;

export const ALLOWED_APPROVAL_TRANSITIONS = {
  pending: ["used", "expired", "revoked"],
  used: [],
  expired: [],
  revoked: []
} as const;
```

Add listing transitions `tour_scheduled -> tour_proposed` and `tour_scheduled -> replied` only for the repository-controlled reschedule/cancel services; do not permit a general route to choose an arbitrary state.

Route schemas must cover rule read/write, capability authorization, proposal generation, selection, preview, approval, hold creation, explicit failed-check override, reschedule, cancel, and typed recovery responses. The preview response includes exact title, instants, local label, timezone, address, description, reminders, `primary`, attendee count zero, conferencing false, notifications `none`, final-check state, warning, and payload hash.

- [ ] **Step 4: Pass domain tests and typecheck**

Run: `pnpm vitest run packages/domain/src/calendar.unit.test.ts packages/domain/src/calendar-api.unit.test.ts packages/domain/src/workflows.unit.test.ts packages/domain/src/lifecycle.unit.test.ts && pnpm --filter @vera/domain typecheck`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the domain boundary**

```bash
git add packages/domain/src
git commit -m "feat(domain): model viewing availability and holds"
```

---

### Task 3: Build deterministic timezone-safe suggestion and payload engines

**Files:**
- Create: `packages/calendar/src/availability.ts`
- Create: `packages/calendar/src/availability.unit.test.ts`
- Create: `packages/calendar/src/availability.test-fixtures.ts`
- Create: `packages/calendar/src/hold-payload.ts`
- Create: `packages/calendar/src/hold-payload.unit.test.ts`
- Modify: `packages/calendar/src/index.ts`

**Interfaces:**
- Consumes: `AvailabilityRuleSet`, `AvailabilityCheckState`, busy intervals, trusted clock, user/viewing/listing inputs.
- Produces: `CalendarAvailabilityInput`, `generateViewingWindows`, `isAvailabilityCheckFresh`, `HoldPayloadInput`, `TentativeHoldPayload`, `buildTentativeHoldPayload`, `computeCalendarPayloadHash`, and `computeGoogleEventId`.

- [ ] **Step 1: Write the labeled fixture matrix for scheduling and DST**

```ts
import { describe, expect, it } from "vitest";

import { generateViewingWindows } from "./availability.ts";
import {
  allBlockedInput,
  dstRule,
  mondayRule
} from "./availability.test-fixtures.ts";

describe("generateViewingWindows", () => {
  it("removes a conflict plus travel and buffer on both sides", () => {
    const windows = generateViewingWindows({
      now: "2026-07-21T12:00:00.000Z",
      rules: mondayRule({ travelMinutes: 20, bufferMinutes: 10 }),
      horizonDays: 14,
      freeBusy: {
        calendarIds: ["primary"],
        checkedAt: "2026-07-21T12:00:01.000Z",
        busy: [{ startsAt: "2026-07-27T14:00:00.000Z", endsAt: "2026-07-27T15:00:00.000Z" }]
      }
    });
    expect(windows.map(({ startsAt }) => startsAt)).not.toContain("2026-07-27T15:00:00.000Z");
  });

  it.each([
    ["2026-03-08", "America/New_York"],
    ["2026-11-01", "America/New_York"]
  ])("rejects ambiguous or nonexistent local slots on %s", (date, timeZone) => {
    expect(generateViewingWindows(dstRule(date, timeZone))).toEqual([]);
  });

  it("returns an explicit empty set when all candidates are blocked", () => {
    expect(generateViewingWindows(allBlockedInput())).toEqual([]);
  });
});
```

Add tests for missing scope, disconnected/revoked, provider failure, stale results, minimum notice, deterministic order, one-per-day first pass, and every provenance field. Add payload tests proving equivalent inputs hash identically, any approved field changes the hash, and the event ID matches `/^vera[a-f0-9]{40}$/`.

The test-fixture module contains only sanitized deterministic builders with these complete signatures:

```ts
export function mondayRule(
  overrides: Partial<Pick<AvailabilityRuleSet, "travelMinutes" | "bufferMinutes">> = {}
): AvailabilityRuleSet;
export function dstRule(date: string, timeZone: string): GenerateViewingWindowsInput;
export function allBlockedInput(): GenerateViewingWindowsInput;
```

`mondayRule` returns the `baseRules` values from Task 2. `dstRule` constructs a one-day rule whose only local interval crosses 02:00 on spring-forward or 01:00 on fall-back and uses `disambiguation: "reject"` behavior. `allBlockedInput` supplies a busy interval covering the complete 14-day rule horizon.

- [ ] **Step 2: Run focused tests and confirm missing implementation failures**

Run: `pnpm vitest run packages/calendar/src/availability.unit.test.ts packages/calendar/src/hold-payload.unit.test.ts`

Expected: FAIL because the generator and payload builder do not exist.

- [ ] **Step 3: Implement the pure generator with Temporal**

Expose:

```ts
export type CalendarAvailabilityInput =
  | {
      readonly state: "checked";
      readonly checkId: string;
      readonly checkedAt: string;
      readonly calendarIds: readonly ["primary"];
      readonly busy: readonly FreeBusyInterval[];
    }
  | {
      readonly state: Exclude<AvailabilityCheckState, "checked">;
      readonly checkId: string | null;
      readonly checkedAt: string | null;
      readonly calendarIds: readonly [];
    };

export interface GenerateViewingWindowsInput {
  readonly now: string;
  readonly rules: AvailabilityRuleSet;
  readonly horizonDays: 14;
  readonly availability: CalendarAvailabilityInput;
}

export function generateViewingWindows(
  input: GenerateViewingWindowsInput
): readonly ProposedViewingWindow[];

export function isAvailabilityCheckFresh(
  checkedAt: string,
  now: string,
  maximumAgeMilliseconds: 300_000
): boolean;
```

Enumerate wall-clock slots at 15-minute boundaries using `Temporal.PlainDate`, `Temporal.PlainTime`, and the configured IANA zone. Convert with `disambiguation: "reject"`; do not guess at duplicated or skipped wall times. Expand each busy interval by `travelMinutes + bufferMinutes` before intersection. Sort by instant, pick one candidate per local date, then fill remaining positions chronologically, returning at most three.

For a fresh successful check, use `google_freebusy`, `checked`, `['primary']`, no warning, and the persisted check ID. Every other availability input generates from rules only with the exact failure state and `requiresConflictWarning: true`.

- [ ] **Step 4: Implement canonical payloads and deterministic identity**

Canonicalize JSON by recursively sorting object keys, preserving array order, and UTF-8 hashing the result. Build:

```ts
export type TentativeHoldPayload = InsertTentativeHoldRequest;
export interface HoldPayloadInput {
  readonly holdId: string;
  readonly userId: VeraUserId;
  readonly viewingId: string;
  readonly shortAddress: string;
  readonly normalizedAddress: string;
  readonly canonicalListingUrl: string | null;
  readonly sourceUrls: readonly string[];
  readonly contactNotes: string | null;
  readonly selectedWindow: ProposedViewingWindow;
  readonly remindersMinutesBeforeStart: readonly number[];
}

export function buildTentativeHoldPayload(input: HoldPayloadInput): TentativeHoldPayload;
export function computeCalendarPayloadHash(payload: TentativeHoldPayload): string;
export function computeGoogleEventId(input: {
  userId: VeraUserId;
  viewingId: string;
  startsAt: string;
  endsAt: string;
  payloadHash: string;
}): string;
```

The title is `Tentative viewing — {short address}`. The description contains only the user-approved canonical listing URL, retained source URLs, contact notes, and `VERA-HOLD:{holdId}`. Reject URLs with credentials, non-HTTP(S) schemes, or fragments. The provider payload always fixes primary/tentative/private/opaque/no attendees/no conference/none notifications.

- [ ] **Step 5: Pass deterministic engine tests**

Run: `pnpm vitest run packages/calendar/src/availability.unit.test.ts packages/calendar/src/hold-payload.unit.test.ts && pnpm --filter @vera/calendar typecheck`

Expected: all deterministic, DST, warning, provenance, and hash tests PASS.

- [ ] **Step 6: Commit deterministic engines**

```bash
git add packages/calendar/src
git commit -m "feat(calendar): generate explainable viewing windows"
```

---

### Task 4: Implement mock and official Google Calendar clients

**Files:**
- Create: `packages/calendar/src/mock-client.ts`
- Create: `packages/calendar/src/mock-client.unit.test.ts`
- Create: `packages/calendar/src/google-client.ts`
- Create: `packages/calendar/src/google-client.unit.test.ts`
- Create: `packages/calendar/src/google-client.test-fixtures.ts`
- Modify: `packages/calendar/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `CalendarClient` and strict schemas plus an injected `OAuth2Client`-compatible transport.
- Produces: `MockCalendarClient`, `GoogleCalendarClient`, `GoogleCalendarClientOptions`, and no-network contract coverage.

- [ ] **Step 1: Write failing provider contract tests**

```ts
import {
  googleTransport,
  primaryRequest,
  recordingGoogleTransport,
  safeInsert
} from "./google-client.test-fixtures.ts";

it("maps only free/busy intervals and fails a per-calendar error closed", async () => {
  const transport = googleTransport({
    freebusy: { data: { calendars: { primary: { errors: [{ reason: "backendError" }] } } } }
  });
  const client = new GoogleCalendarClient({ transport, timeoutMilliseconds: 2_000 });
  await expect(client.queryFreeBusy(primaryRequest)).rejects.toMatchObject({
    code: "calendar_transient_failure",
    retryable: true
  });
});

it("inserts with sendUpdates none and no attendee or conference body", async () => {
  const transport = recordingGoogleTransport();
  await new GoogleCalendarClient({ transport, timeoutMilliseconds: 2_000 }).insertTentativeHold(safeInsert);
  expect(transport.lastInsert).toMatchObject({
    calendarId: "primary",
    sendUpdates: "none",
    requestBody: { status: "tentative", visibility: "private", transparency: "opaque" }
  });
  expect(transport.lastInsert.requestBody).not.toHaveProperty("attendees");
  expect(transport.lastInsert.requestBody).not.toHaveProperty("conferenceData");
});
```

Add tests for timeout, cancellation, 401/revocation, 403, 429, 5xx, malformed response, 404 lookup, matching/mismatched lookup projection, 409 recovery, and error serialization free of raw response/token/event text.

The test-fixture transport is a local structural double for this adapter seam:

```ts
export interface GoogleFreeBusyQuery {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly timeZone: string;
  readonly items: readonly [{ readonly id: "primary" }];
}
export interface GoogleEventGet {
  readonly calendarId: "primary";
  readonly eventId: string;
}
export interface GoogleEventInsert extends GoogleEventGet {
  readonly sendUpdates: "none";
  readonly requestBody: {
    readonly id: string;
    readonly summary: string;
    readonly location: string;
    readonly description: string;
    readonly status: "tentative";
    readonly visibility: "private";
    readonly transparency: "opaque";
    readonly start: { readonly dateTime: string; readonly timeZone: string };
    readonly end: { readonly dateTime: string; readonly timeZone: string };
    readonly reminders: {
      readonly useDefault: false;
      readonly overrides: readonly {
        readonly method: "popup";
        readonly minutes: number;
      }[];
    };
  };
}
export interface GoogleTransportScript {
  readonly freebusy?: unknown | Error;
  readonly get?: unknown | Error;
  readonly insert?: unknown | Error;
}
export interface CalendarV3Transport {
  queryFreeBusy(input: GoogleFreeBusyQuery, signal: AbortSignal): Promise<unknown>;
  getEvent(input: GoogleEventGet, signal: AbortSignal): Promise<unknown>;
  insertEvent(input: GoogleEventInsert, signal: AbortSignal): Promise<unknown>;
}

export const primaryRequest: FreeBusyRequest;
export const safeInsert: InsertTentativeHoldRequest;
export function googleTransport(script: GoogleTransportScript): CalendarV3Transport;
export function recordingGoogleTransport(): CalendarV3Transport & {
  readonly lastInsert: GoogleEventInsert;
};
```

`GoogleTransportScript` contains one optional response or typed throw for each operation. `GoogleEventInsert` fixes `calendarId`, `sendUpdates`, and a bounded `requestBody`; it has no generic property bag.

- [ ] **Step 2: Verify provider tests fail**

Run: `pnpm vitest run packages/calendar/src/mock-client.unit.test.ts packages/calendar/src/google-client.unit.test.ts`

Expected: FAIL because both clients are missing.

- [ ] **Step 3: Implement the deterministic mock**

`MockCalendarClient` accepts an immutable script of free/busy results, lookup results, inserted results, and typed failures. It records validated calls, supports abort signals, rejects unscripted calls, and stores inserted holds by deterministic event ID so repeated inserts resolve without duplication. It has no network import.

- [ ] **Step 4: Implement the Google v3 adapter**

Construct `google.calendar({ version: "v3", auth })` behind an injected factory. `queryFreeBusy` calls `freebusy.query` with `timeMin`, `timeMax`, `timeZone`, and `items: [{id: "primary"}]`; map only busy start/end values. Use an abort-controller timeout and merge caller cancellation. Permit one free/busy retry only for typed transient/429/5xx errors.

`getTentativeHold` calls `events.get` only with the deterministic event ID and projects existence, ID, Vera marker, interval, and status. `insertTentativeHold` first performs that exact lookup, inserts only when absent, and on timeout/409 performs one lookup to resolve an ambiguous outcome. Do not blindly repeat `events.insert`.

- [ ] **Step 5: Pass provider tests, typecheck, and static capability scan**

Run: `pnpm vitest run packages/calendar/src/mock-client.unit.test.ts packages/calendar/src/google-client.unit.test.ts && pnpm --filter @vera/calendar typecheck && ! rg -n "events\.(delete|patch|update|move)|calendarList|sendUpdates:\s*['\"](all|externalOnly)" packages/calendar/src`

Expected: tests/typecheck PASS and the forbidden-capability scan returns no matches.

- [ ] **Step 6: Commit provider clients**

```bash
git add packages/calendar/src
git commit -m "feat(calendar): add mock and Google providers"
```

---

### Task 5: Add the additive PostgreSQL Calendar schema and migration

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Modify: `packages/db/src/postgres/schema.integration.test.ts`
- Modify: `packages/db/src/postgres/migrations.integration.test.ts`
- Create: `packages/db/drizzle/0001_calendar_availability.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0001_snapshot.json`

**Interfaces:**
- Consumes: Task 2 persisted domain types and the existing tenant-owned `users`, `integration_connections`, `canonical_listings`, `approvals`, and `viewings` tables.
- Produces: `availabilityRuleSets`, `calendarOauthStates`, `availabilityChecks`, `calendarHolds`, and additive Viewing columns.

- [ ] **Step 1: Write migration and ownership tests before changing schema**

```ts
it("adds tenant-owned Calendar tables with PostgreSQL-native types", async () => {
  await withPostgresTestDatabase(async ({ db }) => {
    const result = await db.execute(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = current_schema()
        and table_name in ('availability_rule_sets','calendar_oauth_states','availability_checks','calendar_holds')
    `);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: "availability_rule_sets", column_name: "weekly_intervals", data_type: "jsonb" }),
      expect.objectContaining({ table_name: "availability_checks", column_name: "checked_at", data_type: "timestamp with time zone" }),
      expect.objectContaining({ table_name: "calendar_holds", column_name: "user_id", data_type: "uuid" })
    ]));
  });
});
```

Add assertions for composite ownership foreign keys, one active rule set per user, unique state hash, append-only availability checks, unique `(user_id,idempotency_key)`, unique provider event identity, encrypted verifier all-or-none columns, allowed-state checks, and legacy Viewing rows preserved.

- [ ] **Step 2: Run the PostgreSQL schema tests and confirm missing-table failures**

Run: `pnpm postgres:up && pnpm vitest run --project postgres-integration packages/db/src/postgres/schema.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

Expected: FAIL because the Calendar tables and migration do not exist.

- [ ] **Step 3: Define the additive schema**

Add:

- `availability_rule_sets`: tenant key, timezone, weekly JSONB, duration/notice/travel/buffer integers, reminders JSONB, conflict flag, selected IDs JSONB, schema version, created/updated; unique user.
- `calendar_oauth_states`: tenant key, state hash, capability, requested scopes JSONB, encrypted verifier envelope columns, redirect URI hash, expires/consumed/created timestamps; unique hash and same-owner key.
- `availability_checks`: tenant key, rule-set and nullable integration same-owner FKs, state, requested range, attempted/successful calendar IDs JSONB, checked time, response hash, busy count, safe provider error, correlation ID, created time.
- `calendar_holds`: tenant key, viewing/approval/check same-owner FKs, payload hash, idempotency key, deterministic event ID, provider reference, hold state, override flag/reason, safe error, timestamps; unique idempotency and provider identity.
- `viewings`: nullable selected-window JSONB and nullable `supersedes_viewing_id` with a same-owner self-FK.

Create an append-only trigger for `availability_checks`, matching the existing raw/activity trigger style. All state/check constraints use the exact Task 2 enums.

- [ ] **Step 4: Generate and inspect migration SQL**

Run: `DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:generate`

Expected: one new `0001_*.sql` migration and matching snapshot. Rename the SQL to `0001_calendar_availability.sql` only if the journal entry is updated to the same tag. Inspect that it contains only additive tables, columns, constraints, indexes, triggers, and foreign keys; it must contain no `DROP TABLE`, `TRUNCATE`, or destructive column rewrite.

- [ ] **Step 5: Apply from baseline and pass migration tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/schema.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

Expected: both suites PASS, including preservation of a pre-migration Viewing row.

- [ ] **Step 6: Commit the additive migration**

```bash
git add packages/db/src/postgres/schema.ts packages/db/src/postgres/schema.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts packages/db/drizzle
git commit -m "feat(db): migrate Calendar availability state"
```

---

### Task 6: Implement tenant-scoped Calendar repositories and atomic approval/hold transactions

**Files:**
- Modify: `packages/db/src/repositories.ts`
- Create: `packages/db/src/postgres/calendar-repositories.ts`
- Create: `packages/db/src/postgres/calendar-repositories.integration.test.ts`
- Create: `packages/db/src/postgres/calendar-testing.ts`
- Create: `packages/db/src/postgres/calendar-transactions.ts`
- Create: `packages/db/src/postgres/calendar-transactions.integration.test.ts`
- Modify: `packages/db/src/postgres/row-mappers.ts`
- Modify: `packages/db/src/postgres/repositories.ts`
- Modify: `packages/db/src/postgres/standard-repositories.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: Task 5 tables and existing `UserRepositoryProvider.transaction(userId, operation)`.
- Produces: tenant-scoped repositories plus `approveCalendarHold`, `beginCalendarHoldCreation`, `finalizeCalendarHoldCreation`, `failCalendarHoldCreation`, `cancelViewingInternally`, and `startViewingReschedule`.

- [ ] **Step 1: Write PostgreSQL integration tests for invariants and concurrency**

```ts
import {
  calendarHoldClaim,
  withSeededCalendarUser
} from "./calendar-testing.ts";

it("consumes one exact approval and claims one hold creation under concurrency", async () => {
  await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
    const attempts = await Promise.allSettled([
      beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold)),
      beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold))
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect((await provider.forUser(userId).approvals.getById(approval.id))?.state).toBe("used");
  });
});

it("rolls back approval consumption on payload mismatch", async () => {
  await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
    const claimInput = calendarHoldClaim(approval, hold);
    await expect(beginCalendarHoldCreation(provider, userId, {
      ...claimInput,
      payloadHash: "b".repeat(64)
    })).rejects.toThrow("payload");
    expect((await provider.forUser(userId).approvals.getById(approval.id))?.state).toBe("pending");
  });
});
```

Add tests for per-user isolation, append-only checks, OAuth state one-time consumption, expired state, wrong user, rule upsert, stale mapping, viewing transition compare-and-set, idempotent hold insert, different-payload collision, provider success transaction, retryable failure, audit persistence, reschedule lineage, cancel rollback, and timestamptz round-trip.

`calendar-testing.ts` wraps `withPostgresTestDatabase`, inserts two Better Auth users plus the minimum same-owner search profile/listing/viewing/approval/hold graph, and exports:

```ts
export function withSeededCalendarUser<T>(
  operation: (fixture: SeededCalendarFixture) => Promise<T>
): Promise<T>;
export function calendarHoldClaim(
  approval: Approval,
  hold: CalendarHold
): BeginCalendarHoldCreationInput;
```

The returned fixture exposes the `UserRepositoryProvider`, primary user ID, second user ID, validated rule set, listing, viewing, approval, and hold. All identifiers and timestamps are fixed sanitized values.

- [ ] **Step 2: Run focused PostgreSQL tests and confirm repository failures**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/calendar-repositories.integration.test.ts packages/db/src/postgres/calendar-transactions.integration.test.ts`

Expected: FAIL because repository contracts and implementations are absent.

- [ ] **Step 3: Add exact repository interfaces**

```ts
export interface CalendarHoldTransitionPatch {
  readonly providerEventReference?: string | null;
  readonly availabilityCheckId?: string | null;
  readonly safeErrorCode?: string | null;
  readonly completedAt?: string | null;
}
export interface ViewingTransitionPatch {
  readonly selectedWindow?: ProposedViewingWindow | null;
  readonly confirmedWindow?: ViewingWindow | null;
  readonly calendarReference?: string | null;
  readonly supersedesViewingId?: string | null;
}
export interface BeginCalendarHoldCreationInput {
  readonly holdId: string;
  readonly viewingId: string;
  readonly approvalId: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly selectedWindow: ProposedViewingWindow;
  readonly requestedAt: string;
}
export interface AvailabilityRuleSetRepository {
  upsertCurrent(value: AvailabilityRuleSet): AvailabilityRuleSet;
  getCurrent(): AvailabilityRuleSet | null;
}
export interface CalendarOAuthStateRepository {
  insert(value: CalendarOAuthState): CalendarOAuthState;
  consume(input: { stateHash: string; consumedAt: string }): CalendarOAuthState;
}
export interface AvailabilityCheckRepository {
  append(value: AvailabilityCheck): AvailabilityCheck;
  getById(id: string): AvailabilityCheck | null;
  listRecent(limit: number): readonly AvailabilityCheck[];
}
export interface CalendarHoldRepository {
  insert(value: CalendarHold): CalendarHold;
  getById(id: string): CalendarHold | null;
  getByIdempotencyKey(key: string): CalendarHold | null;
  transition(id: string, expected: CalendarHoldState, requested: CalendarHoldState, at: string, patch: CalendarHoldTransitionPatch): CalendarHold;
}
```

Extend approval and viewing repositories only with named transitions; expose no arbitrary update:

```ts
transition(id: string, expected: ApprovalState, requested: ApprovalState, at: string): Approval;
transition(id: string, expected: ViewingState, requested: ViewingState, at: string, patch: ViewingTransitionPatch): Viewing;
listByCanonicalListingId(id: string): readonly Viewing[];
```

- [ ] **Step 4: Implement repositories and compatibility mapping**

Use tenant predicates on every select/update. OAuth state consumption is `UPDATE ... WHERE consumed_at IS NULL AND expires_at > consumedAt RETURNING *`. Availability checks expose append/read only. Compare-and-set transitions include current state in the `WHERE` clause. A legacy Viewing window maps to provenance `{availabilitySource:'vera_rules_only', state:'vera_rules_only', requiresConflictWarning:true, generatorVersion:'legacy.v0'}` without rewriting stored history.

- [ ] **Step 5: Implement transaction services**

`beginCalendarHoldCreation` validates same owner, pending/unexpired approval, operation vocabulary, viewing/selected interval, exact payload hash, and idempotency before consuming approval and moving hold to `creating` in one transaction. Provider calls are forbidden inside the transaction callback.

`finalizeCalendarHoldCreation` transactionally records the opaque provider reference, advances hold/viewing/listing states, and appends safe activity. Failure records a safe category and retryability without provider body. Internal cancel/reschedule update the Viewing/listing and append audit before returning a manual-cleanup warning; neither accepts a Calendar client.

Use the closed activity vocabulary `viewing.availability_saved`, `calendar.authorization_requested`, `calendar.authorization_completed`, `calendar.authorization_denied`, `calendar.freebusy_checked`, `calendar.freebusy_unavailable`, `viewing.proposals_created`, `viewing.window_selected`, `calendar.hold_approval_recorded`, `calendar.hold_final_check_conflict`, `calendar.hold_final_check_unavailable`, `calendar.hold_override_approved`, `calendar.hold_created`, `calendar.hold_creation_failed`, `viewing.reschedule_started`, and `viewing.cancelled_internal`. Metadata is limited to opaque entity IDs, capability, state, counts, `primary`, timestamps, hashes, idempotency keys, retryability, and safe error codes.

- [ ] **Step 6: Pass repository and transaction tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/calendar-repositories.integration.test.ts packages/db/src/postgres/calendar-transactions.integration.test.ts && pnpm --filter @vera/db typecheck`

Expected: all isolation, concurrency, rollback, append-only, transition, and idempotency tests PASS.

- [ ] **Step 7: Commit persistence behavior**

```bash
git add packages/db/src
git commit -m "feat(db): persist Calendar holds transactionally"
```

---

### Task 7: Implement secure incremental Google integration OAuth

**Files:**
- Create: `apps/web/lib/server/integration-config.ts`
- Create: `apps/web/lib/server/integration-config.unit.test.ts`
- Create: `apps/web/lib/server/google-integration-oauth.ts`
- Create: `apps/web/lib/server/google-integration-oauth.unit.test.ts`
- Create: `apps/web/lib/server/google-integration-oauth.test-fixtures.ts`
- Create: `apps/web/lib/server/calendar-application.ts`
- Create: `apps/web/lib/server/calendar-application.unit.test.ts`
- Create: `apps/web/lib/server/request-security.ts`
- Create: `apps/web/lib/server/request-security.unit.test.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/demo-application.ts`
- Create: `apps/web/app/api/integrations/google/calendar/authorize/route.ts`
- Create: `apps/web/app/api/integrations/google/calendar/authorize/route.integration.test.ts`
- Create: `apps/web/app/api/integrations/google/calendar/callback/route.ts`
- Create: `apps/web/app/api/integrations/google/calendar/callback/route.integration.test.ts`
- Create: `apps/web/app/api/integrations/google/disconnect/route.ts`
- Create: `apps/web/app/api/integrations/google/disconnect/route.integration.test.ts`

**Interfaces:**
- Consumes: Task 6 OAuth/integration repositories, credential cipher, authenticated request context, and separate Google web-app credentials.
- Produces: `GoogleIntegrationOAuth`, strict config, incremental authorize/callback/disconnect routes, and verified capability state.

- [ ] **Step 1: Write OAuth security tests**

```ts
import {
  callbackFixture,
  runCallback
} from "./google-integration-oauth.test-fixtures.ts";

it.each([
  "state_mismatch",
  "expired_state",
  "wrong_vera_user",
  "reused_state"
])("rejects %s before exchanging a code", async (failure) => {
  const result = await runCallback(callbackFixture(failure));
  expect(result.codeExchangeCalls).toBe(0);
  expect(result.response.status).toBe(400);
});

it("persists actual partial grants rather than requested scopes", async () => {
  const result = await runCallback(callbackFixture("partial_grant"));
  expect(result.connection.grantedScopes).toEqual(["email", "openid"]);
  expect(result.connection.status).toBe("partial");
});
```

Add tests for denied consent, missing first refresh token, preserving an existing refresh token during incremental consent, invalid_grant/revocation, encrypted verifier/token persistence, tokens absent from captured logs, capability-specific requested scopes, exact redirect matching, HTTPS production enforcement, same-origin POST rejection, and disconnect revocation plus credential deletion.

The test-fixture module builds a temporary PostgreSQL repository fixture, fixed authenticated Vera user, capturing redacted logger, deterministic clock/random values, and a scripted OAuth transport:

```ts
export type CallbackFailure =
  | "state_mismatch"
  | "expired_state"
  | "wrong_vera_user"
  | "reused_state"
  | "partial_grant";
export function callbackFixture(kind: CallbackFailure): GoogleCallbackFixture;
export function runCallback(fixture: GoogleCallbackFixture): Promise<GoogleCallbackTestResult>;
```

`GoogleCallbackTestResult` contains the HTTP response, persisted connection, code-exchange call count, revocation call count, encrypted database rows, and captured safe logs. No test fixture contains a real email, token, code, client secret, or Google response.

- [ ] **Step 2: Verify security tests fail**

Run: `pnpm vitest run apps/web/lib/server/integration-config.unit.test.ts apps/web/lib/server/google-integration-oauth.unit.test.ts apps/web/lib/server/calendar-application.unit.test.ts apps/web/lib/server/request-security.unit.test.ts apps/web/app/api/integrations/google/calendar/authorize/route.integration.test.ts apps/web/app/api/integrations/google/calendar/callback/route.integration.test.ts apps/web/app/api/integrations/google/disconnect/route.integration.test.ts`

Expected: FAIL because integration OAuth is absent.

- [ ] **Step 3: Add strict hosted configuration and key parsing**

Parse an optional, fail-closed integration configuration:

```ts
export interface GoogleIntegrationEnvironment {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly publicBaseUrl: string;
  readonly oauthStateTtlMilliseconds: 600_000;
  readonly providerTimeoutMilliseconds: number;
  readonly credentialKeyProvider: CredentialKeyProvider;
}
```

Environment names are `VERA_GOOGLE_INTEGRATION_CLIENT_ID`, `VERA_GOOGLE_INTEGRATION_CLIENT_SECRET`, `VERA_GOOGLE_INTEGRATION_REDIRECT_URI`, `VERA_PUBLIC_BASE_URL`, `VERA_GOOGLE_TIMEOUT_MS`, `VERA_CREDENTIAL_KEY_ID`, and `VERA_CREDENTIAL_KEYS_JSON`. When all three Google integration values are absent, return `null` and expose Calendar as `unconfigured`; when only some are present, fail startup rather than constructing a partial client. Require an exact HTTPS callback outside loopback development and a 1,000–20,000 ms timeout.

- [ ] **Step 4: Implement capability-specific PKCE OAuth**

Expose:

```ts
interface GoogleIntegrationOAuth {
  createAuthorization(input: { userId: VeraUserId; capability: CalendarCapability; returnTo: string }): Promise<{ authorizationUrl: string }>;
  handleCallback(input: { userId: VeraUserId; state: string; code: string }): Promise<IntegrationConnection>;
  refreshAccessToken(input: { userId: VeraUserId; requiredScope: string; signal?: AbortSignal }): Promise<string>;
  disconnect(input: { userId: VeraUserId }): Promise<void>;
}
```

Generate 32 random state bytes and an RFC 7636 S256 verifier/challenge. Store only state SHA-256 and an encrypted verifier using the OAuth state UUID as the credential-context integration ID. Request `openid email` plus exactly one Calendar scope, `access_type=offline`, `include_granted_scopes=true`, `prompt=consent` only when a refresh token is missing, and no identity `profile` scope.

On callback, consume the state before exchange, verify its session user, exchange server-side, verify the ID token audience/issuer/subject/email, verify actual granted scopes with token info, and persist only the encrypted refresh token plus safe metadata. Preserve existing encrypted refresh material if incremental consent omits a new token. Missing first refresh material becomes `reconnect_required`.

Refresh access tokens only in memory with one bounded transient retry. `invalid_grant` transitions to revoked/reconnect-required. Disconnect calls Google's revocation endpoint through the injected transport, then deletes the stored credential even if revocation reports already-invalid; append only safe audited state changes.

`calendar-application.ts` owns the composition boundary:

```ts
export interface CalendarApplicationDependencies {
  readonly configurationState: "configured" | "unconfigured" | "demo";
  readonly oauth: GoogleIntegrationOAuth | null;
  createClient(
    userId: VeraUserId,
    requiredScope: CalendarGoogleScope,
    signal?: AbortSignal
  ): Promise<CalendarClient>;
}
```

Hosted mode creates a `GoogleCalendarClient` only after resolving a verified scoped access token. Demo mode returns the process-owned `MockCalendarClient`. Add this dependency to `VeraApplication` so routes never instantiate Google clients directly.

- [ ] **Step 5: Add authenticated, same-origin routes**

The authorize POST accepts only `{capability, returnTo}` through shared Zod, calls `assertSameOriginMutation`, and returns a redirect URL. The callback GET requires the bound Vera session and the exact state/code pair; denied consent returns a safe settings redirect. Disconnect POST requires same origin. Demo mode returns a typed `google_disconnected` response and never constructs an OAuth client.

- [ ] **Step 6: Pass OAuth tests and secret scan**

Run: `pnpm vitest run apps/web/lib/server/integration-config.unit.test.ts apps/web/lib/server/google-integration-oauth.unit.test.ts apps/web/lib/server/calendar-application.unit.test.ts apps/web/lib/server/request-security.unit.test.ts apps/web/app/api/integrations/google/calendar/authorize/route.integration.test.ts apps/web/app/api/integrations/google/calendar/callback/route.integration.test.ts apps/web/app/api/integrations/google/disconnect/route.integration.test.ts`

Expected: all tests PASS, including the assertions that captured logs contain no token, code, verifier, secret, or provider body.

- [ ] **Step 7: Commit incremental authorization**

```bash
git add apps/web/lib/server apps/web/app/api/integrations
git commit -m "feat(web): add incremental Calendar authorization"
```

---

### Task 8: Build the availability service, routes, and settings experience

**Files:**
- Create: `apps/web/lib/calendar-service.ts`
- Create: `apps/web/lib/calendar-service.unit.test.ts`
- Create: `apps/web/lib/calendar-service.test-fixtures.ts`
- Create: `apps/web/app/api/availability/rules/route.ts`
- Create: `apps/web/app/api/availability/rules/route.integration.test.ts`
- Create: `apps/web/app/settings/integrations/page.tsx`
- Create: `apps/web/app/settings/integrations/integration-cards.tsx`
- Create: `apps/web/app/settings/availability/page.tsx`
- Create: `apps/web/app/settings/availability/availability-editor.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: Calendar client/OAuth composition, Task 3 generator, Task 6 repositories, authenticated user.
- Produces: saved weekly rules, capability health read model, visible connected/fallback states, and `CalendarAvailabilityService.propose`.

- [ ] **Step 1: Write service tests for graceful degradation**

```ts
import {
  busyResult,
  calendarFailure,
  proposalInput,
  serviceWith
} from "./calendar-service.test-fixtures.ts";

it("never treats a transient Google failure as an empty checked calendar", async () => {
  const fixture = serviceWith(calendarFailure("calendar_timeout"));
  const result = await fixture.service.propose(proposalInput);
  expect(result.state).toBe("google_temporarily_unavailable");
  expect(result.windows.every((window) => window.requiresConflictWarning)).toBe(true);
  expect(result.windows.every((window) => window.availabilitySource === "vera_rules_only")).toBe(true);
});

it("persists only a summary of a successful primary-calendar check", async () => {
  const fixture = serviceWith(busyResult);
  const result = await fixture.service.propose(proposalInput);
  expect(result.state).toBe("checked");
  expect(result.calendarsChecked).toEqual(["primary"]);
  expect(fixture.persistedChecks[0]).not.toHaveProperty("busy");
});
```

Add missing-scope, partial-grant, revoked, disconnected, intentionally-disabled, stale-at-read, conflict-removal, adjacent-buffer, all-blocked, and timezone tests.

The fixture module exports a fully validated fixed rule/listing/user input, a scripted provider result/failure, and an in-memory implementation of the same async repository interfaces:

```ts
export const proposalInput: CreateViewingProposalsInput;
export const busyResult: FreeBusyResult;
export function calendarFailure(code: CalendarProviderErrorCode): CalendarProviderError;
export function serviceWith(
  script: FreeBusyResult | CalendarProviderError
): {
  readonly service: CalendarAvailabilityService;
  readonly persistedChecks: readonly AvailabilityCheck[];
};
```

- [ ] **Step 2: Run tests and confirm service/UI gaps**

Run: `pnpm vitest run apps/web/lib/calendar-service.unit.test.ts apps/web/app/api/availability/rules/route.integration.test.ts`

Expected: FAIL because availability orchestration and the rule route are absent.

- [ ] **Step 3: Implement visible graceful degradation**

`CalendarAvailabilityService.propose` loads current rules and integration. If conflict checking is off, append `vera_rules_only`. If the connection/scope is missing, append the exact corresponding failure check and generate warning windows. If scope exists, refresh a short-lived access token, query only `primary`, append a safe check summary with response hash and count, then generate checked windows. A provider failure appends `google_temporarily_unavailable` and generates warning windows; it never supplies `busy: []` to the checked generator.

Expose the service contract as:

```ts
export interface CreateViewingProposalsInput {
  readonly userId: VeraUserId;
  readonly canonicalListingId: string;
  readonly now: string;
  readonly correlationId: string;
}
export interface ViewingProposalResult {
  readonly state: AvailabilityCheckState;
  readonly calendarsChecked: readonly string[];
  readonly checkedAt: string | null;
  readonly windows: readonly ProposedViewingWindow[];
}
export interface CalendarAvailabilityService {
  propose(input: CreateViewingProposalsInput): Promise<ViewingProposalResult>;
}
```

At read time, convert a successful check older than 300,000 ms to `stale` without changing stored history. UI text is exactly `Checked against your primary Google Calendar` only for fresh checked windows; every other result says `Calendar conflicts not checked` with Connect, Reconnect, Retry, or Continue-with-warning.

- [ ] **Step 4: Add the weekly rules route and settings pages**

The rule route supports authenticated GET and same-origin PUT only. The editor uses native time inputs and a timezone select driven by `Intl.supportedValuesOf("timeZone")`; it validates with shared schemas before sending. Fields are weekday intervals, duration, minimum notice, travel, buffer, reminders, and conflict-check toggle.

Enabling conflict checking without verified free/busy scope starts the capability-specific authorize route; saving rules alone never requests write scope. Integration cards display connected Google email, health, granted/missing/revoked/expired status for each capability, scope descriptions, primary-calendar disclosure, enable/reconnect, and disconnect.

- [ ] **Step 5: Add settings navigation and responsive styling**

Add `Settings` navigation from the inbox and listing detail. Reuse Vera's paper/forest/coral visual language; use fieldsets, legends, explicit labels, keyboard-visible focus, error summary, saving state, and status text not encoded by color alone. Do not introduce a dashboard component library.

- [ ] **Step 6: Pass service/route tests and web typecheck**

Run: `pnpm vitest run apps/web/lib/calendar-service.unit.test.ts apps/web/app/api/availability/rules/route.integration.test.ts && pnpm --filter @vera/web typecheck`

Expected: all focused tests PASS and settings pages typecheck.

- [ ] **Step 7: Commit availability settings**

```bash
git add apps/web/lib apps/web/app/api/availability apps/web/app/settings apps/web/app/globals.css apps/web/app/page.tsx apps/web/app/listings/[id]/page.tsx
git commit -m "feat(web): add Calendar-aware availability settings"
```

---

### Task 9: Implement proposal, exact approval, final recheck, and idempotent hold orchestration

**Files:**
- Modify: `apps/web/lib/calendar-service.ts`
- Create: `apps/web/lib/calendar-hold-service.unit.test.ts`
- Create: `apps/web/lib/calendar-hold-service.integration.test.ts`
- Create: `apps/web/lib/calendar-hold-service.test-fixtures.ts`
- Create: `apps/web/app/api/listings/[id]/viewings/route.ts`
- Create: `apps/web/app/api/listings/[id]/viewings/route.integration.test.ts`
- Create: `apps/web/app/api/viewings/[id]/select/route.ts`
- Create: `apps/web/app/api/viewings/[id]/approval/route.ts`
- Create: `apps/web/app/api/viewings/[id]/hold/route.ts`
- Create: `apps/web/app/api/viewings/[id]/hold/route.integration.test.ts`
- Create: `apps/web/app/api/viewings/[id]/reschedule/route.ts`
- Create: `apps/web/app/api/viewings/[id]/cancel/route.ts`

**Interfaces:**
- Consumes: proposal engine, Calendar provider, repositories/transactions, canonical listing/source read model, and shared API schemas.
- Produces: `CalendarHoldService`, stateful viewing routes, exact preview/approval, conflict replacement, explicit unavailable override, and internal-only reschedule/cancel.

- [ ] **Step 1: Write hold golden-path and failure-recovery tests**

```ts
import {
  holdServiceFixture,
  initiallyFree,
  nowBusy,
  temporarilyUnavailable
} from "./calendar-hold-service.test-fixtures.ts";

it("blocks insertion when a conflict appears during the final recheck", async () => {
  const fixture = holdServiceFixture([initiallyFree, nowBusy]);
  const result = await fixture.service.createApprovedHold(fixture.request);
  expect(result.kind).toBe("conflict_detected");
  expect(result.replacementWindows).toHaveLength(3);
  expect(fixture.client.insertCalls).toHaveLength(0);
  expect((await fixture.approvals.getById(fixture.request.approvalId))?.state).toBe("revoked");
});

it("requires a new approval after a failed final check", async () => {
  const fixture = holdServiceFixture([initiallyFree, temporarilyUnavailable]);
  const first = await fixture.service.createApprovedHold(fixture.request);
  expect(first.kind).toBe("confirmation_required");
  await expect(fixture.service.createApprovedHold({
    ...fixture.request,
    conflictCheckOverride: true
  })).rejects.toThrow("new approval");
  const override = await fixture.service.approveOverride(first.overridePreview);
  expect(override.operation).toBe("calendar.hold.create_without_conflict_check");
});
```

Add exact payload mismatch, expired/revoked approval, no write scope, duplicate request, concurrent request, ambiguous insert recovery, mismatched existing event, no attendees/notifications, provider failure audit, listing/viewing transitions, and internal cancel/reschedule tests.

`calendar-hold-service.test-fixtures.ts` creates a fixed same-owner listing/viewing/approval graph and scripted mock client:

```ts
export const initiallyFree: FreeBusyResult;
export const nowBusy: FreeBusyResult;
export const temporarilyUnavailable: CalendarProviderError;
export function holdServiceFixture(
  finalCheckScript: readonly (FreeBusyResult | CalendarProviderError)[]
): CalendarHoldServiceFixture;
```

The returned fixture exposes the service, exact create request, approval repository, mock client call log, clock, ID factory, and append-only activity sink.

- [ ] **Step 2: Verify the hold tests fail**

Run: `pnpm vitest run apps/web/lib/calendar-hold-service.unit.test.ts apps/web/lib/calendar-hold-service.integration.test.ts apps/web/app/api/listings/[id]/viewings/route.integration.test.ts apps/web/app/api/viewings/[id]/hold/route.integration.test.ts`

Expected: FAIL because the orchestration and routes do not exist.

- [ ] **Step 3: Implement proposal, selection, and preview**

Expose the orchestration boundary as:

```ts
export interface CreateApprovedHoldRequest {
  readonly viewingId: string;
  readonly approvalId: string;
  readonly expectedPayloadHash: string;
  readonly conflictCheckOverride: boolean;
  readonly correlationId: string;
}
export type CalendarHoldCreationResult =
  | { readonly kind: "created"; readonly hold: CalendarHold; readonly duplicate: boolean }
  | { readonly kind: "conflict_detected"; readonly replacementWindows: readonly ProposedViewingWindow[] }
  | { readonly kind: "confirmation_required"; readonly overridePreview: CalendarHoldApprovalPreview };
export interface CalendarHoldService {
  createApprovedHold(input: CreateApprovedHoldRequest): Promise<CalendarHoldCreationResult>;
  approveOverride(preview: CalendarHoldApprovalPreview): Promise<Approval>;
}
```

Proposal creation is allowed only for listing states `replied`, `tour_proposed`, or `tour_scheduled`. It persists windows plus provenance and advances `replied -> tour_proposed`. Selection validates the exact persisted interval and transitions `proposed -> selected`.

The approval preview is rebuilt server-side from the canonical listing, retained source URLs, selected interval, timezone, user notes, reminders, and warning state. The client receives the canonical preview/hash but cannot submit a provider payload. Approval POST rebuilds and hashes again, rejects mismatches, and inserts a 10-minute pending approval for `calendar.hold.create` or the explicit override operation.

- [ ] **Step 4: Implement final recheck and create flow**

For normal creation, query free/busy immediately for the selected interval expanded by travel+buffer. If busy, revoke approval, append safe conflict audit, create no event, and return replacement proposals. If the check fails or scope/connection disappears, revoke approval and return `confirmation_required`; the override request rebuilds a different payload, hash, operation, and approval.

After a free recheck or valid override, call `beginCalendarHoldCreation`, resolve deterministic-ID lookup, insert at most once, and call `finalizeCalendarHoldCreation`. The created event has exact approved content, no attendees/conference, `sendUpdates=none`, and configurable popup reminders. Creation moves Viewing to `hold_created` and listing to `tour_scheduled`; it never claims landlord confirmation.

- [ ] **Step 5: Implement internal-first reschedule and cancel**

Reschedule cancels the current Viewing locally, moves `tour_scheduled -> tour_proposed`, creates a new proposed Viewing with `supersedesViewingId`, and returns `externalCleanupRequired: true` when the old hold had a provider reference. Cancel moves the Viewing to cancelled and listing to replied, appends audit, and returns the same cleanup warning. Neither route imports or invokes `CalendarClient`.

- [ ] **Step 6: Pass hold orchestration tests and forbidden-route scan**

Run: `pnpm vitest run apps/web/lib/calendar-hold-service.unit.test.ts apps/web/lib/calendar-hold-service.integration.test.ts apps/web/app/api/listings/[id]/viewings/route.integration.test.ts apps/web/app/api/viewings/[id]/hold/route.integration.test.ts && ! rg -n "events\.(delete|patch|update|move)|sendUpdates.*(all|externalOnly)|attendees" apps/web/app/api/viewings apps/web/lib/calendar-service.ts`

Expected: all tests PASS and no external update/delete/notification path exists.

- [ ] **Step 7: Commit viewing orchestration**

```bash
git add apps/web/lib/calendar-service.ts apps/web/lib/calendar-hold-service* apps/web/app/api/listings/[id]/viewings apps/web/app/api/viewings
git commit -m "feat(web): create approved tentative viewing holds"
```

---

### Task 10: Add the renter-facing viewing planner and recovery UI

**Files:**
- Create: `apps/web/app/listings/[id]/viewing-planner.tsx`
- Create: `apps/web/app/listings/[id]/viewing-planner-view.ts`
- Create: `apps/web/app/listings/[id]/viewing-planner.unit.test.ts`
- Create: `apps/web/app/listings/[id]/viewing-planner.test-fixtures.ts`
- Modify: `apps/web/app/listings/[id]/listing-detail.tsx`
- Modify: `apps/web/app/listings/[id]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 9 route responses and the existing listing evidence view.
- Produces: visible three-window selection, provenance, exact approval preview, hold confirmation, retry/reconnect/override, and internal reschedule/cancel UI.

- [ ] **Step 1: Write component-state tests**

```ts
import { presentViewingPlanner } from "./viewing-planner-view.ts";
import {
  approvalFixture,
  fallbackFixture
} from "./viewing-planner.test-fixtures.ts";

it("never labels fallback windows conflict-free", () => {
  const view = presentViewingPlanner(fallbackFixture("google_temporarily_unavailable"));
  expect(view.availabilityHeading).toBe("Calendar conflicts not checked");
  expect(view.recoveryAction).toBe("continue_with_warning");
  expect(view.availabilityHeading).not.toContain("Checked against");
});

it("shows the exact side effect next to approval", () => {
  const view = presentViewingPlanner(approvalFixture());
  expect(view.preview?.title).toBe("Tentative viewing — 12 Cedar St");
  expect(view.sideEffectDisclosure).toBe("No landlord will be invited or notified");
  expect(view.preview?.notifications).toBe("none");
});
```

Add checked-primary, all-blocked, stale, missing scope, revoked, retrying, conflict-before-create, failed-final-check, duplicate-success, and manual-cleanup warning tests.

The view module is pure and maps validated planner state to copy/actions. The two modules export:

```ts
export type PlannerRecoveryAction =
  | "connect"
  | "reconnect"
  | "retry"
  | "edit_availability"
  | "continue_with_warning";
export type ViewingPlannerState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading_proposals" }
  | { readonly kind: "proposals"; readonly result: ViewingProposalResult }
  | { readonly kind: "loading_preview"; readonly viewingId: string }
  | { readonly kind: "preview"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "approving"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "creating"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "confirmation_required"; readonly preview: CalendarHoldApprovalPreview }
  | { readonly kind: "conflict_detected"; readonly windows: readonly ProposedViewingWindow[] }
  | { readonly kind: "created"; readonly hold: CalendarHold; readonly duplicate: boolean }
  | { readonly kind: "error"; readonly message: string; readonly recoveryAction: PlannerRecoveryAction };
export interface ViewingPlannerView {
  readonly availabilityHeading: string;
  readonly availabilityDetail: string;
  readonly recoveryAction: PlannerRecoveryAction | null;
  readonly preview: CalendarHoldApprovalPreview | null;
  readonly sideEffectDisclosure: string;
  readonly liveRegionMessage: string;
  readonly externalCleanupWarning: string | null;
}
export function fallbackFixture(
  state: Exclude<AvailabilityCheckState, "checked">
): ViewingPlannerState;
export function approvalFixture(): ViewingPlannerState;
export function presentViewingPlanner(state: ViewingPlannerState): ViewingPlannerView;
```

`ViewingPlannerView` contains availability heading/detail, recovery action, selected-window labels, nullable approval preview, side-effect disclosure, live-region message, and external-cleanup warning. The React component renders only this view model and dispatches typed route actions.

- [ ] **Step 2: Run the component tests and confirm missing component failure**

Run: `pnpm vitest run apps/web/app/listings/[id]/viewing-planner.unit.test.ts`

Expected: FAIL because `viewing-planner.tsx` does not exist.

- [ ] **Step 3: Implement the planner state machine**

Use client state variants `idle`, `loading_proposals`, `proposals`, `loading_preview`, `preview`, `approving`, `creating`, `confirmation_required`, `conflict_detected`, `created`, and `error`. Parse every response with shared Zod schemas. Abort superseded requests. Disable duplicate actions while pending and preserve typed recovery actions.

Each window displays local date/time/timezone, Google primary-calendar check timestamp or `Calendar conflicts not checked`, and a warning badge when required. The preview displays exact title/time/timezone/address/notes/reminders, no attendee, no notification, and final-check behavior adjacent to `Approve and create private hold`.

If `calendar.events.owned` is missing when the user first opens or submits the hold preview, show `Enable private viewing holds` and invoke only the hold-creation authorization capability. Never request write scope during proposal generation or free/busy retry.

After creation, display `Tentative hold created—no landlord was invited or notified`. Reschedule/cancel show `The Google Calendar hold may still exist; remove it manually.` Do not add links that imply Vera changed the old external event.

- [ ] **Step 4: Integrate with listing detail and style accessibly**

Render the planner only in `replied`, `tour_proposed`, and `tour_scheduled`. Preserve evidence, risk, and activity sections. Add mobile stacking, minimum 44px actions, focus-visible outlines, `aria-live` for status, fieldset/radio semantics for windows, and non-color warning text.

- [ ] **Step 5: Pass component tests and web typecheck**

Run: `pnpm vitest run apps/web/app/listings/[id]/viewing-planner.unit.test.ts && pnpm --filter @vera/web typecheck`

Expected: component tests and typecheck PASS.

- [ ] **Step 6: Commit the viewing UI**

```bash
git add apps/web/app/listings/[id] apps/web/app/globals.css
git commit -m "feat(web): add approved viewing planner"
```

---

### Task 11: Preserve deterministic demo mode and cover the end-to-end flow

**Files:**
- Create: `packages/db/src/demo/calendar-repositories.ts`
- Create: `packages/db/src/demo/calendar-repositories.integration.test.ts`
- Create: `packages/db/src/demo/calendar-repositories.test-fixtures.ts`
- Modify: `packages/db/src/demo/index.ts`
- Modify: `apps/web/lib/server/demo-application.ts`
- Modify: `apps/web/test-support/demo-runtime.ts`
- Modify: `scripts/demo-seed.ts`
- Create: `tests/e2e/calendar-hold.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: existing isolated SQLite demo provider and `MockCalendarClient`.
- Produces: deterministic seeded availability, no-credential mock Calendar composition, and golden/fallback E2E proof.

- [ ] **Step 1: Write demo isolation and E2E tests**

```ts
import {
  demoGoogleConnection,
  withDemoCalendarFixture
} from "./calendar-repositories.test-fixtures.ts";

it("cannot persist a hosted Google credential in demo mode", async () => {
  await withDemoCalendarFixture(async ({ repositories }) => {
    await expect(repositories.integrationConnections.upsert(demoGoogleConnection)).rejects.toThrow("unavailable in offline demo mode");
  });
});
```

The fixture helper opens a temporary migrated/seeded demo database, closes and removes it in `finally`, and exports a schema-valid synthetic integration value whose ciphertext is inert test data:

```ts
export const demoGoogleConnection: IntegrationConnection;
export function withDemoCalendarFixture<T>(
  operation: (fixture: DemoCalendarFixture) => Promise<T>
): Promise<T>;
```

The Playwright golden test must: open a replied seeded listing, see `Demo Calendar fixture—no Google account or API is being used`, generate three mock-checked windows labeled `Checked against the simulated primary Calendar fixture`, select one, inspect exact preview, approve/create, see `Simulated tentative hold created—nothing was written to Google Calendar`, retry without duplication, inspect activity, cancel locally, and see the simulated cleanup state. A second test scripts provider timeout and verifies `Calendar conflicts not checked`, retry, and explicit warning continuation.

- [ ] **Step 2: Run demo tests and confirm missing behavior**

Run: `pnpm vitest run packages/db/src/demo/calendar-repositories.integration.test.ts && pnpm test:e2e --grep "Calendar hold"`

Expected: FAIL until the demo repository and mock composition are wired.

- [ ] **Step 3: Add narrow demo persistence**

Use a process-owned in-memory Calendar sidecar for the current rule, safe availability summaries, and hold operation records; continue to persist viewings, approvals, listing lifecycle, and activity through the existing SQLite repositories. Do not add a SQLite migration, OAuth state table, token table, or a general second database implementation, and keep `integrationConnections.upsert` fail-closed. The sidecar is scoped to `DEMO_USER_ID`, seeded at demo application construction, and reset when the process restarts. The demo application always injects `MockCalendarClient`; it never reads integration OAuth environment variables.

Seed one replied sanitized listing, a weekly `America/New_York` rule set, and scripted primary-calendar busy intervals. Reset restores the same state and IDs on every run.

The mock may exercise the same strict `checked` contract, but `demoMode` changes all provider-facing copy and confirmations so a fixture can never be mistaken for a connected production Google account or a real external event.

- [ ] **Step 4: Pass demo repository and E2E tests**

Run: `pnpm demo:reset && pnpm demo:seed && pnpm vitest run packages/db/src/demo/calendar-repositories.integration.test.ts && pnpm test:e2e --grep "Calendar hold"`

Expected: deterministic repository tests and both Calendar E2E scenarios PASS with no external request.

- [ ] **Step 5: Commit demo support**

```bash
git add packages/db/src/demo apps/web/lib/server/demo-application.ts apps/web/test-support/demo-runtime.ts scripts/demo-seed.ts tests/e2e/calendar-hold.spec.ts playwright.config.ts
git commit -m "test(calendar): cover deterministic viewing flow"
```

---

### Task 12: Update operations, security, data-model, and verification documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `docs/DECISIONS/0003-approved-drafts-and-calendar-holds.md`
- Create: `docs/GOOGLE_INTEGRATION_SETUP.md`
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/verify-calendar-boundaries.ts`
- Create: `scripts/verify-calendar-boundaries.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: all completed behavior and exact runtime commands.
- Produces: developer/production setup, verification checklist, Mermaid model, rollback notes, demo boundary, and static safety gate.

- [ ] **Step 1: Write the failing static boundary verifier test**

```ts
it("rejects Calendar send, attendee, broad-scope, event-mutation, and event-list capabilities", () => {
  for (const forbidden of [
    "events.send",
    "events.delete",
    "events.update",
    "events.patch",
    "events.list",
    "calendar.calendarlist.readonly",
    "sendUpdates: all",
    "attendees:"
  ]) {
    expect(() => verifyCalendarSource(`export const unsafe = ${JSON.stringify(forbidden)};`)).toThrow(forbidden);
  }
});
```

- [ ] **Step 2: Implement the static verifier and root command**

Scan `packages/calendar/src` and Calendar integration/viewing routes. Allow `attendees: []` only in the strict request schema/test fixture; reject provider-body attendees, broader scopes, event list, delete/update/patch/move, invitation notifications, token logging, and OAuth secrets in fixtures. Add root script `verify:calendar-boundaries`.

Add `pnpm verify:calendar-boundaries` to CI before lint/typecheck. Keep PostgreSQL 18.4 as the persistence service and keep live Google credentials absent from CI.

- [ ] **Step 3: Update environment and operational documentation**

Document exact development values without secrets:

```text
VERA_GOOGLE_INTEGRATION_CLIENT_ID=
VERA_GOOGLE_INTEGRATION_CLIENT_SECRET=
VERA_GOOGLE_INTEGRATION_REDIRECT_URI=http://127.0.0.1:3000/api/integrations/google/calendar/callback
VERA_GOOGLE_TIMEOUT_MS=5000
```

Document separate development/staging/production web-app clients, exact redirect URIs, HTTPS production callbacks, verified domains, consent-screen branding, privacy policy, terms, scope justifications, deletion/disconnect behavior, restricted/sensitive scope verification implications, test users, verification demo video, key rotation, database backup before migration, `pnpm db:migrate`, rollback by restoring the pre-migration backup plus prior release, and primary-calendar-only disclosure.

- [ ] **Step 4: Update architecture/data model/security/demo docs**

Add the OAuth -> rules -> free/busy summary -> proposals -> exact approval -> final recheck -> idempotent insert flow. Extend the Mermaid ER diagram with availability rules, checks, OAuth states, viewings, approvals, and holds. State explicitly that raw busy intervals are not stored, event details are not read for checking, demo uses a mock, and cancel/reschedule do not mutate the provider.

- [ ] **Step 5: Run documentation and safety checks**

Run: `pnpm vitest run scripts/verify-calendar-boundaries.unit.test.ts && pnpm verify:calendar-boundaries && pnpm format:check`

Expected: verifier test PASS, source scan PASS, and documentation formatting PASS.

- [ ] **Step 6: Commit documentation and gate**

```bash
git add .env.example README.md docs package.json .github/workflows/ci.yml scripts/verify-calendar-boundaries.ts scripts/verify-calendar-boundaries.unit.test.ts
git commit -m "docs: document safe Calendar operations"
```

---

### Task 13: Run the complete acceptance gate and audit every requirement

**Files:**
- Review: all files changed by Tasks 1–12
- Review: `pnpm-lock.yaml`
- Review: generated migration and Drizzle snapshot

**Interfaces:**
- Consumes: the completed milestone.
- Produces: evidence that every specified safety, persistence, UI, provider, demo, and test requirement is satisfied.

- [ ] **Step 1: Start PostgreSQL and migrate both development databases**

Run: `pnpm postgres:up && DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:migrate && TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres`

Expected: PostgreSQL is healthy, migration applies without reset, and PostgreSQL integration tests PASS.

- [ ] **Step 2: Run formatting, static safety gates, lint, and typecheck**

Run: `pnpm format:check && pnpm verify:db-boundaries && pnpm verify:calendar-boundaries && pnpm lint && pnpm typecheck`

Expected: every command exits 0 with no warnings.

- [ ] **Step 3: Run unit and non-PostgreSQL integration tests**

Run: `pnpm test:unit && pnpm test:integration`

Expected: all unit and default integration tests PASS without network access.

- [ ] **Step 4: Run deterministic E2E and production build**

Run: `pnpm test:e2e && pnpm build`

Expected: all Playwright Chromium scenarios PASS and every workspace builds.

- [ ] **Step 5: Audit side-effect and secret boundaries**

Run: `git diff --check && ! git diff -- . ':!pnpm-lock.yaml' | rg -i "(ya29\.|1//[A-Za-z0-9_-]{20,}|BEGIN PRIVATE KEY|client_secret\s*[:=]\s*['\"][^'\"]+)" && ! rg -n "events\.(delete|patch|update|move|list)|sendUpdates.*(all|externalOnly)|calendar\.calendarlist\.readonly|https://www\.googleapis\.com/auth/calendar['\"]" packages/calendar apps/web`

Expected: clean diff and no secret, broad scope, external event mutation, event-list, attendee-notification, or calendar-list capability.

- [ ] **Step 6: Perform the requirement-by-requirement completion audit**

Record evidence for: free/busy conflict removal; adjacent buffer; all blocked; missing/partial/revoked scope; transient failure; stale state; visible non-silent fallback; final new conflict; explicit failed-check override; timezone/DST; duplicate hold prevention; exact approval mismatch; no attendee/notification; viewing/activity transitions; internal-only cancel/reschedule; primary-calendar disclosure; no event details; encrypted credentials; demo no-network; additive migration; lint/typecheck/tests/build.

- [ ] **Step 7: Close the acceptance audit without a synthetic commit**

Run: `git status --short && git log --oneline -13`

Expected: only pre-existing unrelated worktree changes remain, and Tasks 1–12 are represented by focused commits. If a gate failed, return to the task that owns that invariant, add its named regression test there, repeat that task's focused command, and rerun Steps 1–6. Do not hide a failing invariant in an acceptance-only commit and do not create an empty commit.
