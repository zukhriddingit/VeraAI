import { describe, expect, it } from "vitest";

import {
  AvailabilityCheckSchema,
  AvailabilityCheckStateSchema,
  AvailabilityRuleSetSchema,
  CalendarHoldSchema,
  CalendarOAuthStateSchema,
  ProposedViewingWindowSchema,
  SafeReturnToSchema
} from "./index.ts";

const createdAt = "2026-07-21T12:00:00.000Z";
const startsAt = "2026-07-27T13:00:00.000Z";
const endsAt = "2026-07-27T14:00:00.000Z";
const hash = "a".repeat(64);

const weeklyIntervals = {
  "1": [{ startsAt: "09:00", endsAt: "12:00" }],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
} as const;

const baseRuleValues = {
  timeZone: "America/New_York",
  weeklyIntervals,
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: true,
  calendarIds: ["primary"],
  schemaVersion: 1
} as const;

const baseRules = {
  id: "availability-rules-1",
  ...baseRuleValues,
  createdAt,
  updatedAt: createdAt
} as const;

const checkedWindow = {
  startsAt,
  endsAt,
  timeZone: "America/New_York",
  availabilitySource: "google_freebusy",
  state: "checked",
  availabilityCheckId: "availability-check-1",
  checkedAt: createdAt,
  calendarsChecked: ["primary"],
  requiresConflictWarning: false,
  rules: baseRuleValues,
  generatorVersion: "availability.v1"
} as const;

const fallbackWindow = {
  ...checkedWindow,
  availabilitySource: "vera_rules_only",
  state: "google_temporarily_unavailable",
  availabilityCheckId: "availability-check-2",
  checkedAt: null,
  calendarsChecked: [],
  requiresConflictWarning: true
} as const;

const encryptedVerifier = {
  version: 1,
  algorithm: "aes-256-gcm",
  keyId: "key-v1",
  nonce: "MTIzNDU2Nzg5MDEy",
  ciphertext: "MTIzNDU2Nzg5MDEy",
  authenticationTag: "MTIzNDU2Nzg5MDEy"
} as const;

describe("Calendar domain contracts", () => {
  it("supports only the six explicit availability states", () => {
    expect(AvailabilityCheckStateSchema.options).toEqual([
      "checked",
      "scope_not_granted",
      "google_disconnected",
      "google_temporarily_unavailable",
      "stale",
      "vera_rules_only"
    ]);
  });

  it("accepts complete founder availability rules", () => {
    expect(AvailabilityRuleSetSchema.parse(baseRules)).toEqual(baseRules);
  });

  it("rejects overlapping intervals and intervals shorter than the duration", () => {
    expect(() =>
      AvailabilityRuleSetSchema.parse({
        ...baseRules,
        weeklyIntervals: {
          ...weeklyIntervals,
          "1": [
            { startsAt: "09:00", endsAt: "11:00" },
            { startsAt: "10:30", endsAt: "12:00" }
          ]
        }
      })
    ).toThrow("overlap");
    expect(() =>
      AvailabilityRuleSetSchema.parse({
        ...baseRules,
        weeklyIntervals: {
          ...weeklyIntervals,
          "1": [{ startsAt: "09:00", endsAt: "09:30" }]
        }
      })
    ).toThrow("viewing duration");
  });

  it("enforces primary-only IDs when enabled and an empty list when disabled", () => {
    expect(() =>
      AvailabilityRuleSetSchema.parse({ ...baseRules, calendarIds: ["work"] })
    ).toThrow();
    expect(() =>
      AvailabilityRuleSetSchema.parse({ ...baseRules, conflictCheckingEnabled: false })
    ).toThrow("disabled checking");
    expect(
      AvailabilityRuleSetSchema.parse({
        ...baseRules,
        conflictCheckingEnabled: false,
        calendarIds: []
      }).calendarIds
    ).toEqual([]);
  });

  it("rejects invalid timezones, duplicate reminders, and backwards timestamps", () => {
    expect(() =>
      AvailabilityRuleSetSchema.parse({ ...baseRules, timeZone: "Mars/Olympus" })
    ).toThrow("IANA");
    expect(() =>
      AvailabilityRuleSetSchema.parse({ ...baseRules, remindersMinutesBeforeStart: [30, 30] })
    ).toThrow("unique");
    expect(() =>
      AvailabilityRuleSetSchema.parse({
        ...baseRules,
        updatedAt: "2026-07-20T12:00:00.000Z"
      })
    ).toThrow("updated");
  });

  it.each(["Etc/UTC", "US/Eastern", "GMT"])(
    "accepts and preserves Intl-supported timezone alias %s",
    (timeZone) => {
      expect(AvailabilityRuleSetSchema.parse({ ...baseRules, timeZone }).timeZone).toBe(timeZone);
    }
  );

  it("does not silently trim a timezone before an approval payload is hashed", () => {
    expect(() =>
      AvailabilityRuleSetSchema.parse({ ...baseRules, timeZone: " America/New_York " })
    ).toThrow("IANA");
  });

  it("requires exact successful provenance for a checked proposal", () => {
    expect(ProposedViewingWindowSchema.parse(checkedWindow)).toEqual(checkedWindow);
    expect(() =>
      ProposedViewingWindowSchema.parse({ ...checkedWindow, requiresConflictWarning: true })
    ).toThrow("checked window");
    expect(() =>
      ProposedViewingWindowSchema.parse({ ...checkedWindow, calendarsChecked: [] })
    ).toThrow("checked window");
  });

  it("makes every degraded proposal Vera-rules-only with a visible warning", () => {
    expect(ProposedViewingWindowSchema.parse(fallbackWindow)).toEqual(fallbackWindow);
    expect(() =>
      ProposedViewingWindowSchema.parse({ ...fallbackWindow, requiresConflictWarning: false })
    ).toThrow("visibly marked");
    expect(() =>
      ProposedViewingWindowSchema.parse({
        ...fallbackWindow,
        availabilitySource: "google_freebusy"
      })
    ).toThrow("Vera-rules-only");
  });

  it("retains successful Google provenance when a checked proposal becomes stale", () => {
    const stale = {
      ...checkedWindow,
      state: "stale",
      requiresConflictWarning: true
    } as const;
    expect(ProposedViewingWindowSchema.parse(stale)).toEqual(stale);
    expect(() =>
      ProposedViewingWindowSchema.parse({
        ...stale,
        availabilitySource: "vera_rules_only",
        calendarsChecked: []
      })
    ).toThrow("retains its primary-Calendar provenance");
  });

  it("stores successful availability summaries without raw busy intervals", () => {
    const check = AvailabilityCheckSchema.parse({
      id: "availability-check-1",
      availabilityRuleSetId: baseRules.id,
      integrationConnectionId: "e6d3ddbd-c22a-4cbc-b3d7-4fda56a127af",
      state: "checked",
      rangeStartsAt: startsAt,
      rangeEndsAt: endsAt,
      calendarIdsAttempted: ["primary"],
      calendarsChecked: ["primary"],
      checkedAt: createdAt,
      responseHash: hash,
      busyIntervalCount: 2,
      safeProviderErrorCode: null,
      correlationId: "correlation-1",
      createdAt
    });
    expect(check.busyIntervalCount).toBe(2);
    expect(check).not.toHaveProperty("busy");
  });

  it("never treats provider failure as an empty successful result", () => {
    const unavailable = AvailabilityCheckSchema.parse({
      id: "availability-check-2",
      availabilityRuleSetId: baseRules.id,
      integrationConnectionId: "e6d3ddbd-c22a-4cbc-b3d7-4fda56a127af",
      state: "google_temporarily_unavailable",
      rangeStartsAt: startsAt,
      rangeEndsAt: endsAt,
      calendarIdsAttempted: ["primary"],
      calendarsChecked: [],
      checkedAt: null,
      responseHash: null,
      busyIntervalCount: null,
      safeProviderErrorCode: "calendar_timeout",
      correlationId: "correlation-2",
      createdAt
    });
    expect(unavailable.state).toBe("google_temporarily_unavailable");
    expect(() =>
      AvailabilityCheckSchema.parse({
        ...unavailable,
        state: "checked",
        safeProviderErrorCode: null
      })
    ).toThrow("complete primary-Calendar result");
    expect(() =>
      AvailabilityCheckSchema.parse({
        ...unavailable,
        responseHash: hash,
        busyIntervalCount: 0
      })
    ).toThrow("partial success metadata");
  });

  it("keeps stale as a read-time projection instead of a persisted check state", () => {
    expect(() =>
      AvailabilityCheckSchema.parse({
        id: "availability-check-stale",
        availabilityRuleSetId: baseRules.id,
        integrationConnectionId: "e6d3ddbd-c22a-4cbc-b3d7-4fda56a127af",
        state: "stale",
        rangeStartsAt: startsAt,
        rangeEndsAt: endsAt,
        calendarIdsAttempted: ["primary"],
        calendarsChecked: ["primary"],
        checkedAt: createdAt,
        responseHash: hash,
        busyIntervalCount: 0,
        safeProviderErrorCode: null,
        correlationId: "correlation-stale",
        createdAt
      })
    ).toThrow("read-time projection");
  });

  it.each([
    ["scope_not_granted", [], null],
    ["google_disconnected", [], null],
    ["google_temporarily_unavailable", ["primary"], "calendar_timeout"],
    ["vera_rules_only", [], null]
  ] as const)("enforces degraded availability matrix for %s", (state, attempted, errorCode) => {
    const parsed = AvailabilityCheckSchema.parse({
      id: `availability-check-${state}`,
      availabilityRuleSetId: baseRules.id,
      integrationConnectionId: null,
      state,
      rangeStartsAt: startsAt,
      rangeEndsAt: endsAt,
      calendarIdsAttempted: attempted,
      calendarsChecked: [],
      checkedAt: null,
      responseHash: null,
      busyIntervalCount: null,
      safeProviderErrorCode: errorCode,
      correlationId: `correlation-${state}`,
      createdAt
    });
    expect(parsed.state).toBe(state);
  });

  it("rejects a Calendar attempt when scope, connection, or user intent prevented one", () => {
    expect(() =>
      AvailabilityCheckSchema.parse({
        id: "availability-check-scope-missing",
        availabilityRuleSetId: baseRules.id,
        integrationConnectionId: null,
        state: "scope_not_granted",
        rangeStartsAt: startsAt,
        rangeEndsAt: endsAt,
        calendarIdsAttempted: ["primary"],
        calendarsChecked: [],
        checkedAt: null,
        responseHash: null,
        busyIntervalCount: null,
        safeProviderErrorCode: null,
        correlationId: "correlation-scope-missing",
        createdAt
      })
    ).toThrow("did not reach Google");
  });

  it("binds single-use OAuth state to a user, UUID AAD context, and one capability scope", () => {
    const oauthState = {
      id: "58c2e751-4195-4502-a7ec-595979eed3ae",
      userId: "18377ca1-0cb4-4e4a-851a-8c31070602b7",
      stateHash: hash,
      capability: "calendar_conflict_checking",
      requestedCalendarScopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
      encryptedPkceVerifier: encryptedVerifier,
      redirectUriHash: "b".repeat(64),
      returnTo: "/settings/integrations",
      createdAt,
      expiresAt: "2026-07-21T12:10:00.000Z",
      consumedAt: null
    } as const;
    expect(CalendarOAuthStateSchema.parse(oauthState)).toEqual(oauthState);
    expect(() => CalendarOAuthStateSchema.parse({ ...oauthState, id: "oauth-state-1" })).toThrow();
    expect(() =>
      CalendarOAuthStateSchema.parse({
        ...oauthState,
        requestedCalendarScopes: ["https://www.googleapis.com/auth/calendar.events.owned"]
      })
    ).toThrow("incremental capability");
    expect(() =>
      CalendarOAuthStateSchema.parse({ ...oauthState, returnTo: "//attacker.test" })
    ).toThrow("Vera origin");
  });

  it("shares one non-transforming same-origin return-path schema", () => {
    expect(SafeReturnToSchema.parse("/settings/integrations?capability=calendar")).toBe(
      "/settings/integrations?capability=calendar"
    );
    expect(() => SafeReturnToSchema.parse(" /settings/integrations ")).toThrow("Vera origin");
    expect(() => SafeReturnToSchema.parse("/settings%2Fintegrations")).toThrow("Vera origin");
  });

  it("reserves an approval-pending hold before preview and requires approval afterward", () => {
    const reserved = {
      id: "calendar-hold-1",
      viewingId: "viewing-1",
      approvalId: null,
      availabilityCheckId: "availability-check-1",
      payloadHash: hash,
      idempotencyKey: "b".repeat(64),
      googleEventId: `vera${"c".repeat(40)}`,
      providerEventReference: null,
      state: "approval_pending",
      conflictCheckOverride: false,
      conflictCheckOverrideReason: null,
      safeErrorCode: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null
    } as const;
    expect(CalendarHoldSchema.parse(reserved)).toEqual(reserved);
    expect(() =>
      CalendarHoldSchema.parse({ ...reserved, state: "approved", approvalId: null })
    ).toThrow("later states require one");
    expect(
      CalendarHoldSchema.parse({
        ...reserved,
        approvalId: "approval-1",
        providerEventReference: "opaque-provider-reference",
        state: "created",
        completedAt: "2026-07-21T12:01:00.000Z",
        updatedAt: "2026-07-21T12:01:00.000Z"
      }).state
    ).toBe("created");

    expect(
      CalendarHoldSchema.parse({
        ...reserved,
        approvalId: "approval-1",
        providerEventReference: "opaque-provider-reference",
        state: "cancelled_internal",
        completedAt: "2026-07-21T12:02:00.000Z",
        updatedAt: "2026-07-21T12:02:00.000Z"
      }).providerEventReference
    ).toBe("opaque-provider-reference");

    expect(
      CalendarHoldSchema.parse({
        ...reserved,
        state: "cancelled_internal",
        completedAt: "2026-07-21T12:01:00.000Z",
        updatedAt: "2026-07-21T12:01:00.000Z"
      }).approvalId
    ).toBeNull();
    expect(() =>
      CalendarHoldSchema.parse({
        ...reserved,
        state: "cancelled_internal",
        providerEventReference: "impossible-external-reference",
        completedAt: "2026-07-21T12:01:00.000Z",
        updatedAt: "2026-07-21T12:01:00.000Z"
      })
    ).toThrow("unapproved cancelled reservation");
    expect(() =>
      CalendarHoldSchema.parse({
        ...reserved,
        state: "cancelled_internal",
        completedAt: "2026-07-21T11:59:00.000Z"
      })
    ).toThrow("between creation");
  });
});
