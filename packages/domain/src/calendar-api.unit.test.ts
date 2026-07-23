import { describe, expect, it } from "vitest";

import {
  ApproveCalendarHoldRequestSchema,
  ApproveCalendarHoldResponseSchema,
  CalendarCapabilityAuthorizationRequestSchema,
  CalendarHoldApprovalPreviewSchema,
  CalendarHoldConfirmationRequiredResponseSchema,
  CalendarHoldCreatedResponseSchema,
  CalendarHoldEffectPayloadSchema,
  CalendarHoldPreviewResponseSchema,
  CancelViewingRequestSchema,
  CancelViewingResponseSchema,
  CreateApprovedCalendarHoldRequestSchema,
  CreateConflictCheckOverrideResponseSchema,
  CreateConflictCheckOverrideRequestSchema,
  CreateViewingProposalsRequestSchema,
  CreateViewingProposalsResponseSchema,
  PutAvailabilityRulesRequestSchema,
  RescheduleViewingRequestSchema,
  RescheduleViewingResponseSchema,
  SelectViewingWindowRequestSchema
} from "./index.ts";

const createdAt = "2026-07-21T12:00:00.000Z";
const startsAt = "2026-07-27T13:00:00.000Z";
const endsAt = "2026-07-27T14:00:00.000Z";
const payloadHash = "a".repeat(64);

const checkedEffect = {
  holdId: "calendar-hold-1",
  viewingId: "viewing-1",
  veraMarker: "VERA-HOLD:calendar-hold-1",
  title: "Tentative viewing — 12 Cedar St",
  startsAt,
  endsAt,
  timeZone: "America/New_York",
  normalizedAddress: "12 Cedar St, Boston, MA 02108",
  description: "Sanitized listing reference · VERA-HOLD:calendar-hold-1",
  remindersMinutesBeforeStart: [30],
  calendarId: "primary",
  attendeeCount: 0,
  conferencing: false,
  notifications: "none",
  status: "tentative",
  visibility: "private",
  transparency: "opaque",
  finalCheckState: "checked",
  conflictCheckOverride: false,
  warning: null
} as const;

const checkedPreview = {
  ...checkedEffect,
  localTimeLabel: "Monday, July 27, 2026, 9:00–10:00 AM",
  offsetLabel: "EDT (UTC−04:00)",
  payloadHash
} as const;

const reservedHold = {
  id: checkedEffect.holdId,
  viewingId: checkedEffect.viewingId,
  approvalId: null,
  availabilityCheckId: "availability-check-1",
  payloadHash,
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

const rules = {
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
  schemaVersion: 1
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
  rules,
  generatorVersion: "availability.v1"
} as const;

const availabilityCheck = {
  id: "availability-check-1",
  availabilityRuleSetId: "availability-rules-1",
  integrationConnectionId: "48e20af4-225b-440a-89bb-a1146294b764",
  state: "checked",
  rangeStartsAt: "2026-07-27T12:00:00.000Z",
  rangeEndsAt: "2026-07-27T15:00:00.000Z",
  calendarIdsAttempted: ["primary"],
  calendarsChecked: ["primary"],
  checkedAt: createdAt,
  responseHash: "d".repeat(64),
  busyIntervalCount: 0,
  safeProviderErrorCode: null,
  correlationId: "correlation-proposal",
  createdAt
} as const;

const proposedViewing = {
  id: "viewing-1",
  canonicalListingId: "listing-1",
  proposedWindows: [checkedWindow],
  selectedWindow: null,
  confirmedWindow: null,
  supersedesViewingId: null,
  timeZone: "America/New_York",
  calendarReference: null,
  state: "proposed",
  notes: null,
  metadata: {},
  createdAt,
  updatedAt: createdAt
} as const;

const noRecovery = {
  action: "none",
  message: "Checked against your primary Google Calendar.",
  authorizationCapability: null
} as const;

describe("Calendar API contracts", () => {
  it("binds approval to the canonical visible effect and excludes provider-derived identity", () => {
    expect(CalendarHoldEffectPayloadSchema.parse(checkedEffect)).toEqual(checkedEffect);
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({
        ...checkedEffect,
        googleEventId: `vera${"d".repeat(40)}`
      })
    ).toThrow();
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({ ...checkedEffect, status: "confirmed" })
    ).toThrow();
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({ ...checkedEffect, visibility: "public" })
    ).toThrow();
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({ ...checkedEffect, transparency: "transparent" })
    ).toThrow();
  });

  it.each([
    ["title", "Tentative viewing — 12 Cedar St\u0000"],
    ["normalizedAddress", "12 Cedar St\nBoston"],
    ["description", "Sanitized\u0007description"]
  ] as const)("rejects C0 controls in effect field %s", (field, value) => {
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({ ...checkedEffect, [field]: value })
    ).toThrow();
  });

  it("permits intentional tabs and line feeds in the approved event description", () => {
    const description = "Listing: https://example.test/listing\n\tVERA-HOLD:calendar-hold-1";
    expect(
      CalendarHoldEffectPayloadSchema.parse({ ...checkedEffect, description }).description
    ).toBe(description);
  });

  it("requires a stable hold marker in the effect and preview", () => {
    expect(CalendarHoldApprovalPreviewSchema.parse(checkedPreview)).toEqual(checkedPreview);
    expect(() =>
      CalendarHoldApprovalPreviewSchema.parse({
        ...checkedPreview,
        veraMarker: "VERA-HOLD:different-hold"
      })
    ).toThrow("reserved hold ID");
    expect(() =>
      CalendarHoldEffectPayloadSchema.parse({
        ...checkedEffect,
        description: "Sanitized listing reference without the reserved marker"
      })
    ).toThrow("exact Vera hold marker");
  });

  it("requires an explicit warning for all non-checked previews", () => {
    expect(
      CalendarHoldApprovalPreviewSchema.parse({
        ...checkedPreview,
        finalCheckState: "google_temporarily_unavailable",
        conflictCheckOverride: true,
        warning: "Google Calendar could not be checked. This hold may conflict."
      }).conflictCheckOverride
    ).toBe(true);
    expect(() =>
      CalendarHoldApprovalPreviewSchema.parse({
        ...checkedPreview,
        finalCheckState: "google_temporarily_unavailable",
        conflictCheckOverride: false,
        warning: "Google Calendar could not be checked. This hold may conflict."
      })
    ).toThrow("requires an explicit override");
    expect(() =>
      CalendarHoldApprovalPreviewSchema.parse({
        ...checkedPreview,
        finalCheckState: "google_temporarily_unavailable",
        conflictCheckOverride: true,
        warning: null
      })
    ).toThrow("visible warning");
    expect(() =>
      CalendarHoldApprovalPreviewSchema.parse({
        ...checkedPreview,
        conflictCheckOverride: true
      })
    ).toThrow("cannot be overridden");
  });

  it("ties a preview response to a reserved approval-pending hold and exact payload hash", () => {
    expect(
      CalendarHoldPreviewResponseSchema.parse({ hold: reservedHold, preview: checkedPreview }).hold
        .state
    ).toBe("approval_pending");
    expect(() =>
      CalendarHoldPreviewResponseSchema.parse({
        hold: { ...reservedHold, payloadHash: "f".repeat(64) },
        preview: checkedPreview
      })
    ).toThrow("bound");
  });

  it("keeps incremental authorization capability-specific and same-origin", () => {
    expect(
      CalendarCapabilityAuthorizationRequestSchema.parse({
        capability: "calendar_conflict_checking",
        returnTo: "/settings/integrations"
      }).capability
    ).toBe("calendar_conflict_checking");
    expect(() =>
      CalendarCapabilityAuthorizationRequestSchema.parse({
        capability: "calendar_hold_creation",
        returnTo: "https://attacker.test/callback"
      })
    ).toThrow();
    expect(() =>
      CalendarCapabilityAuthorizationRequestSchema.parse({
        capability: "calendar_conflict_checking",
        returnTo: "/settings%2Fintegrations"
      })
    ).toThrow("Vera origin");
    expect(() =>
      CalendarCapabilityAuthorizationRequestSchema.parse({
        capability: "calendar_conflict_checking",
        returnTo: "/settings%5Cintegrations"
      })
    ).toThrow("Vera origin");
    expect(() =>
      CalendarCapabilityAuthorizationRequestSchema.parse({
        capability: "calendar_conflict_checking",
        returnTo: "/settings/integrations",
        scope: "https://www.googleapis.com/auth/calendar"
      })
    ).toThrow();
  });

  it("accepts only complete bounded rule settings in the PUT body", () => {
    const input = {
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
      schemaVersion: 1
    } as const;
    expect(PutAvailabilityRulesRequestSchema.parse(input)).toEqual(input);
    expect(() =>
      PutAvailabilityRulesRequestSchema.parse({ ...input, durationMinutes: 5 })
    ).toThrow();
  });

  it("binds proposal top-level data and every window to one exact persisted check", () => {
    const response = {
      state: "checked",
      calendarsChecked: ["primary"],
      checkedAt: createdAt,
      availabilityCheck,
      viewing: proposedViewing,
      windows: [checkedWindow],
      recovery: noRecovery
    } as const;
    expect(CreateViewingProposalsResponseSchema.parse(response).windows).toEqual([checkedWindow]);
    expect(() =>
      CreateViewingProposalsResponseSchema.parse({ ...response, calendarsChecked: [] })
    ).toThrow("Top-level proposal provenance");
    expect(() =>
      CreateViewingProposalsResponseSchema.parse({
        ...response,
        checkedAt: "2026-07-21T12:01:00.000Z"
      })
    ).toThrow("Top-level proposal provenance");

    const mismatchedWindow = {
      ...checkedWindow,
      availabilityCheckId: "availability-check-other"
    } as const;
    expect(() =>
      CreateViewingProposalsResponseSchema.parse({
        ...response,
        windows: [mismatchedWindow],
        viewing: { ...proposedViewing, proposedWindows: [mismatchedWindow] }
      })
    ).toThrow("exact persisted check provenance");
  });

  it("projects stale windows without making the persisted availability check stale", () => {
    const staleWindow = {
      ...checkedWindow,
      state: "stale",
      requiresConflictWarning: true
    } as const;
    const parsed = CreateViewingProposalsResponseSchema.parse({
      state: "stale",
      calendarsChecked: ["primary"],
      checkedAt: createdAt,
      availabilityCheck,
      viewing: { ...proposedViewing, proposedWindows: [staleWindow] },
      windows: [staleWindow],
      recovery: {
        action: "retry",
        message: "The Calendar check is stale.",
        authorizationCapability: null
      }
    });

    expect(parsed.availabilityCheck.state).toBe("checked");
    expect(parsed.windows[0]?.state).toBe("stale");
  });

  it("forbids a silent recovery-free fallback response", () => {
    const fallbackWindow = {
      ...checkedWindow,
      availabilitySource: "vera_rules_only",
      state: "scope_not_granted",
      availabilityCheckId: "availability-check-scope",
      checkedAt: null,
      calendarsChecked: [],
      requiresConflictWarning: true
    } as const;
    const fallbackCheck = {
      ...availabilityCheck,
      id: "availability-check-scope",
      integrationConnectionId: null,
      state: "scope_not_granted",
      calendarIdsAttempted: [],
      calendarsChecked: [],
      checkedAt: null,
      responseHash: null,
      busyIntervalCount: null
    } as const;
    const fallbackResponse = {
      state: "scope_not_granted",
      calendarsChecked: [],
      checkedAt: null,
      availabilityCheck: fallbackCheck,
      viewing: { ...proposedViewing, proposedWindows: [fallbackWindow] },
      windows: [fallbackWindow],
      recovery: {
        action: "connect",
        message: "Calendar conflicts not checked.",
        authorizationCapability: "calendar_conflict_checking"
      }
    } as const;
    expect(CreateViewingProposalsResponseSchema.parse(fallbackResponse).recovery.action).toBe(
      "connect"
    );
    expect(() =>
      CreateViewingProposalsResponseSchema.parse({
        ...fallbackResponse,
        recovery: noRecovery
      })
    ).toThrow("visible recovery action");
  });

  it("uses minimum-necessary route payloads and rejects provider payload injection", () => {
    expect(CreateViewingProposalsRequestSchema.parse({})).toEqual({});
    expect(() => CreateViewingProposalsRequestSchema.parse({ calendarId: "primary" })).toThrow();

    expect(SelectViewingWindowRequestSchema.parse({ startsAt, endsAt })).toEqual({
      startsAt,
      endsAt
    });
    expect(() =>
      SelectViewingWindowRequestSchema.parse({ startsAt, endsAt, sendUpdates: "all" })
    ).toThrow();

    expect(
      ApproveCalendarHoldRequestSchema.parse({
        holdId: checkedEffect.holdId,
        expectedPayloadHash: payloadHash
      }).holdId
    ).toBe(checkedEffect.holdId);
    expect(
      CreateApprovedCalendarHoldRequestSchema.parse({
        approvalId: "approval-1",
        expectedPayloadHash: payloadHash,
        conflictCheckOverride: false,
        correlationId: "correlation-1"
      }).approvalId
    ).toBe("approval-1");
    expect(
      CreateConflictCheckOverrideRequestSchema.parse({
        holdId: checkedEffect.holdId,
        expectedPayloadHash: payloadHash
      }).holdId
    ).toBe(checkedEffect.holdId);
  });

  it("binds an approval response to one exact approved Calendar hold", () => {
    const approval = {
      id: "approval-1",
      actor: "user",
      connectorId: "google-calendar",
      operation: "calendar.hold.create",
      targetType: "calendar_hold",
      targetId: reservedHold.id,
      payloadHash,
      state: "pending",
      createdAt,
      expiresAt: "2026-07-21T12:10:00.000Z",
      usedAt: null
    } as const;
    const approvedHold = {
      ...reservedHold,
      approvalId: approval.id,
      state: "approved"
    } as const;
    expect(
      ApproveCalendarHoldResponseSchema.parse({ approval, hold: approvedHold }).hold.state
    ).toBe("approved");
    expect(() =>
      ApproveCalendarHoldResponseSchema.parse({
        approval: { ...approval, targetId: "calendar-hold-other" },
        hold: approvedHold
      })
    ).toThrow("same exact Calendar effect");
    expect(() =>
      ApproveCalendarHoldResponseSchema.parse({
        approval: { ...approval, operation: "calendar.hold.create_without_conflict_check" },
        hold: approvedHold
      })
    ).toThrow("same exact Calendar effect");
  });

  it("requires created and confirmation-required responses to reflect their exact states", () => {
    const createdHold = {
      ...reservedHold,
      approvalId: "approval-1",
      providerEventReference: "opaque-event-reference",
      state: "created",
      updatedAt: "2026-07-21T12:01:00.000Z",
      completedAt: "2026-07-21T12:01:00.000Z"
    } as const;
    expect(
      CalendarHoldCreatedResponseSchema.parse({
        kind: "created",
        hold: createdHold,
        duplicate: false
      }).hold.state
    ).toBe("created");
    expect(() =>
      CalendarHoldCreatedResponseSchema.parse({
        kind: "created",
        hold: reservedHold,
        duplicate: false
      })
    ).toThrow("created Calendar hold");

    const overridePreview = {
      ...checkedPreview,
      holdId: "calendar-hold-override-confirmation",
      veraMarker: "VERA-HOLD:calendar-hold-override-confirmation",
      description: "Sanitized listing reference · VERA-HOLD:calendar-hold-override-confirmation",
      finalCheckState: "google_temporarily_unavailable",
      conflictCheckOverride: true,
      warning: "Google Calendar could not be checked. This hold may conflict.",
      payloadHash: "e".repeat(64)
    } as const;
    const confirmation = {
      kind: "confirmation_required",
      overridePreview,
      recovery: {
        action: "continue_with_warning",
        message: "Confirm that you want to continue without a final conflict check.",
        authorizationCapability: null
      }
    } as const;
    expect(CalendarHoldConfirmationRequiredResponseSchema.parse(confirmation).kind).toBe(
      "confirmation_required"
    );
    expect(() =>
      CalendarHoldConfirmationRequiredResponseSchema.parse({
        ...confirmation,
        recovery: noRecovery
      })
    ).toThrow("explicit warned override");
  });

  it("defines narrow internal-only reschedule and cancel commands", () => {
    expect(
      RescheduleViewingRequestSchema.parse({ correlationId: "correlation-reschedule" })
    ).toEqual({ correlationId: "correlation-reschedule" });
    expect(CancelViewingRequestSchema.parse({ correlationId: "correlation-cancel" })).toEqual({
      correlationId: "correlation-cancel"
    });
    expect(() =>
      CancelViewingRequestSchema.parse({
        correlationId: "correlation-cancel",
        deleteExternalEvent: true
      })
    ).toThrow();
  });

  it("makes internal reschedule/cancel state and cleanup warnings unambiguous", () => {
    const rescheduledViewing = {
      ...proposedViewing,
      id: "viewing-rescheduled",
      supersedesViewingId: proposedViewing.id
    } as const;
    const rescheduleResponse = {
      viewing: rescheduledViewing,
      externalCleanupRequired: true,
      warning: "The existing external hold must be removed manually."
    } as const;
    expect(RescheduleViewingResponseSchema.parse(rescheduleResponse).viewing.state).toBe(
      "proposed"
    );
    expect(() =>
      RescheduleViewingResponseSchema.parse({ ...rescheduleResponse, warning: null })
    ).toThrow("shown as a warning");

    const cancelledViewing = {
      ...proposedViewing,
      selectedWindow: checkedWindow,
      calendarReference: "opaque-event-reference",
      state: "cancelled",
      updatedAt: "2026-07-21T12:01:00.000Z"
    } as const;
    expect(
      CancelViewingResponseSchema.parse({
        viewing: cancelledViewing,
        externalCleanupRequired: true,
        warning: "The external hold may still exist; remove it manually."
      }).viewing.state
    ).toBe("cancelled");
    expect(() =>
      CancelViewingResponseSchema.parse({
        viewing: proposedViewing,
        externalCleanupRequired: false,
        warning: null
      })
    ).toThrow("internally cancelled Viewing");
  });

  it("requires a newly reserved hold for an explicit failed-check override", () => {
    const overridePreview = {
      ...checkedPreview,
      holdId: "calendar-hold-override-1",
      veraMarker: "VERA-HOLD:calendar-hold-override-1",
      description: "Sanitized listing reference · VERA-HOLD:calendar-hold-override-1",
      finalCheckState: "google_temporarily_unavailable",
      conflictCheckOverride: true,
      warning: "Google Calendar could not be checked. This hold may conflict.",
      payloadHash: "f".repeat(64)
    } as const;
    const overrideHold = {
      ...reservedHold,
      id: overridePreview.holdId,
      payloadHash: overridePreview.payloadHash,
      availabilityCheckId: "availability-check-override-1",
      idempotencyKey: "e".repeat(64),
      googleEventId: `vera${"d".repeat(40)}`,
      conflictCheckOverride: true,
      conflictCheckOverrideReason: "google_temporarily_unavailable"
    } as const;
    expect(
      CreateConflictCheckOverrideResponseSchema.parse({
        hold: overrideHold,
        preview: overridePreview
      }).hold.id
    ).toBe(overridePreview.holdId);
    expect(() =>
      CreateConflictCheckOverrideResponseSchema.parse({
        hold: reservedHold,
        preview: overridePreview
      })
    ).toThrow("newly reserved");
  });
});
