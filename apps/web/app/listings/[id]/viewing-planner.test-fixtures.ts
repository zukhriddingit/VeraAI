import {
  AvailabilityCheckSchema,
  AvailabilityRuleSnapshotSchema,
  CalendarHoldApprovalPreviewSchema,
  CalendarHoldSchema,
  CancelViewingResponseSchema,
  CreateViewingProposalsResponseSchema,
  ProposedViewingWindowSchema,
  RescheduleViewingResponseSchema,
  ViewingSchema,
  type AvailabilityCheckState,
  type CreateViewingProposalsResponse,
  type ProposedViewingWindow
} from "@vera/domain";

import type { ViewingPlannerState } from "./viewing-planner-view.ts";

const NOW = "2026-07-21T14:00:00.000Z";
const CHECKED_AT = "2026-07-21T13:59:30.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const weeklyIntervals = {
  "1": [{ startsAt: "18:00", endsAt: "21:00" }],
  "2": [{ startsAt: "18:00", endsAt: "21:00" }],
  "3": [{ startsAt: "18:00", endsAt: "21:00" }],
  "4": [{ startsAt: "18:00", endsAt: "21:00" }],
  "5": [{ startsAt: "18:00", endsAt: "21:00" }],
  "6": [{ startsAt: "10:00", endsAt: "16:00" }],
  "7": [{ startsAt: "10:00", endsAt: "16:00" }]
} as const;

export const availabilityRules = AvailabilityRuleSnapshotSchema.parse({
  timeZone: "America/New_York",
  weeklyIntervals,
  durationMinutes: 45,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 15,
  remindersMinutesBeforeStart: [60, 10],
  conflictCheckingEnabled: true,
  calendarIds: ["primary"],
  schemaVersion: 1
});

function checkedWindow(
  startsAt = "2026-07-28T22:00:00.000Z",
  endsAt = "2026-07-28T22:45:00.000Z"
): ProposedViewingWindow {
  return ProposedViewingWindowSchema.parse({
    startsAt,
    endsAt,
    timeZone: availabilityRules.timeZone,
    availabilitySource: "google_freebusy",
    state: "checked",
    availabilityCheckId: "availability-check-1",
    checkedAt: CHECKED_AT,
    calendarsChecked: ["primary"],
    requiresConflictWarning: false,
    rules: availabilityRules,
    generatorVersion: "availability.v1"
  });
}

function degradedWindow(state: Exclude<AvailabilityCheckState, "checked">) {
  if (state === "stale") {
    return ProposedViewingWindowSchema.parse({
      ...checkedWindow(),
      state,
      requiresConflictWarning: true
    });
  }

  return ProposedViewingWindowSchema.parse({
    ...checkedWindow(),
    availabilitySource: "vera_rules_only",
    state,
    checkedAt: null,
    calendarsChecked: [],
    requiresConflictWarning: true
  });
}

function viewing(windows: readonly ProposedViewingWindow[]) {
  return ViewingSchema.parse({
    id: "viewing-1",
    canonicalListingId: "listing-1",
    proposedWindows: windows,
    selectedWindow: null,
    confirmedWindow: null,
    supersedesViewingId: null,
    timeZone: availabilityRules.timeZone,
    calendarReference: null,
    state: "proposed",
    notes: "Ask whether the building entrance is on Cedar Street.",
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW
  });
}

export function checkedFixture(): ViewingPlannerState {
  const windows = [checkedWindow()];
  const availabilityCheck = AvailabilityCheckSchema.parse({
    id: "availability-check-1",
    availabilityRuleSetId: "availability-rules-1",
    integrationConnectionId: "11111111-1111-4111-8111-111111111111",
    state: "checked",
    rangeStartsAt: "2026-07-28T20:00:00.000Z",
    rangeEndsAt: "2026-08-04T02:00:00.000Z",
    calendarIdsAttempted: ["primary"],
    calendarsChecked: ["primary"],
    checkedAt: CHECKED_AT,
    responseHash: HASH_A,
    busyIntervalCount: 2,
    safeProviderErrorCode: null,
    correlationId: "correlation-1",
    createdAt: CHECKED_AT
  });
  const result = CreateViewingProposalsResponseSchema.parse({
    state: "checked",
    calendarsChecked: ["primary"],
    checkedAt: CHECKED_AT,
    availabilityCheck,
    viewing: viewing(windows),
    windows,
    recovery: {
      action: "none",
      message: "Google Calendar was checked successfully.",
      authorizationCapability: null
    }
  });
  return { kind: "proposals", result };
}

function degradedRecovery(state: Exclude<AvailabilityCheckState, "checked">) {
  if (state === "scope_not_granted") {
    return {
      action: "connect" as const,
      message: "Connect Calendar conflict checking to check these times.",
      authorizationCapability: "calendar_conflict_checking" as const
    };
  }
  if (state === "google_disconnected") {
    return {
      action: "reconnect" as const,
      message: "Reconnect Google Calendar to check these times.",
      authorizationCapability: "calendar_conflict_checking" as const
    };
  }
  if (state === "google_temporarily_unavailable" || state === "stale") {
    return {
      action: "retry" as const,
      message: "Retry the Google Calendar conflict check.",
      authorizationCapability: null
    };
  }
  return {
    action: "continue_with_warning" as const,
    message: "Continue using Vera's weekly availability rules only.",
    authorizationCapability: null
  };
}

export function fallbackFixture(
  state: Exclude<AvailabilityCheckState, "checked">
): ViewingPlannerState {
  const windows = [degradedWindow(state)];
  const calendarIdsAttempted: [] | ["primary"] =
    state === "google_temporarily_unavailable" || state === "stale" ? ["primary"] : [];
  const calendarsChecked: [] | ["primary"] = state === "stale" ? ["primary"] : [];
  const availabilityCheck = {
    id: "availability-check-1",
    availabilityRuleSetId: "availability-rules-1",
    integrationConnectionId:
      state === "scope_not_granted" ||
      state === "google_disconnected" ||
      state === "vera_rules_only"
        ? null
        : "11111111-1111-4111-8111-111111111111",
    state,
    rangeStartsAt: "2026-07-28T20:00:00.000Z",
    rangeEndsAt: "2026-08-04T02:00:00.000Z",
    calendarIdsAttempted,
    calendarsChecked,
    checkedAt: state === "stale" ? CHECKED_AT : null,
    responseHash: state === "stale" ? HASH_A : null,
    busyIntervalCount: state === "stale" ? 2 : null,
    safeProviderErrorCode: state === "google_temporarily_unavailable" ? "calendar_timeout" : null,
    correlationId: "correlation-1",
    createdAt: CHECKED_AT
  } as const;

  const candidate: CreateViewingProposalsResponse = {
    state,
    calendarsChecked,
    checkedAt: state === "stale" ? CHECKED_AT : null,
    availabilityCheck,
    viewing: viewing(windows),
    windows,
    recovery: degradedRecovery(state)
  };

  // Staleness is a read-time projection over a valid persisted check, so it is
  // intentionally not accepted by AvailabilityCheckSchema for storage.
  const result =
    state === "stale" ? candidate : CreateViewingProposalsResponseSchema.parse(candidate);
  return { kind: "proposals", result };
}

export function allBlockedFixture(): ViewingPlannerState {
  const base = checkedFixture();
  if (base.kind !== "proposals") throw new Error("Checked fixture must contain proposals.");
  const result = CreateViewingProposalsResponseSchema.parse({
    ...base.result,
    viewing: viewing([]),
    windows: []
  });
  return { kind: "proposals", result };
}

function preview(finalCheckState: "checked" | "google_temporarily_unavailable") {
  const overridden = finalCheckState !== "checked";
  const holdId = overridden ? "calendar-hold-override-1" : "calendar-hold-1";
  return CalendarHoldApprovalPreviewSchema.parse({
    holdId,
    viewingId: "viewing-1",
    veraMarker: `VERA-HOLD:${holdId}`,
    title: "Tentative viewing — 12 Cedar St",
    startsAt: "2026-07-28T22:00:00.000Z",
    endsAt: "2026-07-28T22:45:00.000Z",
    timeZone: "America/New_York",
    normalizedAddress: "12 Cedar St, Boston, MA 02130",
    description: `Ask whether the building entrance is on Cedar Street.\nVERA-HOLD:${holdId}`,
    remindersMinutesBeforeStart: [60, 10],
    calendarId: "primary",
    attendeeCount: 0,
    conferencing: false,
    notifications: "none",
    status: "tentative",
    visibility: "private",
    transparency: "opaque",
    finalCheckState,
    conflictCheckOverride: overridden,
    warning: overridden
      ? "Google Calendar could not be rechecked. Continue only after reviewing the conflict warning."
      : null,
    localTimeLabel: "Tuesday, July 28, 6:00–6:45 PM",
    offsetLabel: "EDT · UTC−04:00",
    payloadHash: overridden ? HASH_B : HASH_A
  });
}

export function approvalFixture(): ViewingPlannerState {
  return { kind: "preview", preview: preview("checked") };
}

export function confirmationRequiredFixture(): ViewingPlannerState {
  return {
    kind: "confirmation_required",
    preview: preview("google_temporarily_unavailable")
  };
}

export function conflictFixture(withReplacements = true): ViewingPlannerState {
  const windows = withReplacements
    ? [
        checkedWindow("2026-07-29T22:00:00.000Z", "2026-07-29T22:45:00.000Z"),
        checkedWindow("2026-07-30T22:00:00.000Z", "2026-07-30T22:45:00.000Z")
      ]
    : [];
  return {
    kind: "conflict_detected",
    replacementViewingId: "viewing-replacement-1",
    windows
  };
}

export function createdFixture(duplicate = false): ViewingPlannerState {
  const hold = CalendarHoldSchema.parse({
    id: "calendar-hold-1",
    viewingId: "viewing-1",
    approvalId: "approval-1",
    availabilityCheckId: "availability-check-final-1",
    payloadHash: HASH_A,
    idempotencyKey: HASH_B,
    googleEventId: `vera${"c".repeat(40)}`,
    providerEventReference: "google-event-reference-1",
    state: "created",
    conflictCheckOverride: false,
    conflictCheckOverrideReason: null,
    safeErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW
  });
  return { kind: "created", hold, duplicate };
}

export function internalUpdateFixture(
  operation: "cancelled" | "rescheduled",
  externalCleanupRequired = true
): ViewingPlannerState {
  const warning = externalCleanupRequired
    ? "The Google Calendar hold may still exist; remove it manually."
    : null;

  if (operation === "rescheduled") {
    const result = RescheduleViewingResponseSchema.parse({
      viewing: {
        ...viewing([checkedWindow()]),
        id: "viewing-2",
        supersedesViewingId: "viewing-1"
      },
      externalCleanupRequired,
      warning
    });
    return { kind: "rescheduled", result };
  }

  const result = CancelViewingResponseSchema.parse({
    viewing: {
      ...viewing([checkedWindow()]),
      selectedWindow: checkedWindow(),
      calendarReference: "google-event-reference-1",
      state: "cancelled"
    },
    externalCleanupRequired,
    warning
  });
  return { kind: "cancelled", result };
}

export function loadingFixture(): ViewingPlannerState {
  return { kind: "loading_proposals" };
}

export function errorFixture(): ViewingPlannerState {
  return {
    kind: "error",
    message: "Google Calendar could not be checked right now.",
    recoveryAction: "retry"
  };
}
