import {
  AvailabilityCheckSchema,
  CalendarHoldSchema,
  ProposedViewingWindowSchema,
  ViewingSchema,
  type AvailabilityCheck,
  type CalendarHold,
  type ProposedViewingWindow,
  type Viewing
} from "@vera/domain";

import { DEMO_AVAILABILITY_RULES } from "./calendar-repositories.ts";

export const DEMO_CALENDAR_TEST_NOW = "2026-07-21T12:00:00.000Z";
export const DEMO_CALENDAR_TEST_LATER = "2026-07-21T12:01:00.000Z";

export const demoAvailabilityCheck: AvailabilityCheck = AvailabilityCheckSchema.parse({
  id: "demo-availability-check-1",
  availabilityRuleSetId: DEMO_AVAILABILITY_RULES.id,
  integrationConnectionId: null,
  state: "vera_rules_only",
  rangeStartsAt: DEMO_CALENDAR_TEST_NOW,
  rangeEndsAt: "2026-08-04T12:00:00.000Z",
  calendarIdsAttempted: [],
  calendarsChecked: [],
  checkedAt: null,
  responseHash: null,
  busyIntervalCount: null,
  safeProviderErrorCode: null,
  correlationId: "demo-calendar-correlation-1",
  createdAt: DEMO_CALENDAR_TEST_NOW
});

export const demoCalendarHold: CalendarHold = CalendarHoldSchema.parse({
  id: "demo-calendar-hold-1",
  viewingId: "demo-viewing-1",
  approvalId: null,
  availabilityCheckId: demoAvailabilityCheck.id,
  payloadHash: "b".repeat(64),
  idempotencyKey: "c".repeat(64),
  googleEventId: `vera${"d".repeat(40)}`,
  providerEventReference: null,
  state: "approval_pending",
  conflictCheckOverride: false,
  conflictCheckOverrideReason: null,
  safeErrorCode: null,
  createdAt: DEMO_CALENDAR_TEST_NOW,
  updatedAt: DEMO_CALENDAR_TEST_NOW,
  completedAt: null
});

function ruleSnapshot() {
  return {
    timeZone: DEMO_AVAILABILITY_RULES.timeZone,
    weeklyIntervals: DEMO_AVAILABILITY_RULES.weeklyIntervals,
    durationMinutes: DEMO_AVAILABILITY_RULES.durationMinutes,
    minimumNoticeMinutes: DEMO_AVAILABILITY_RULES.minimumNoticeMinutes,
    travelMinutes: DEMO_AVAILABILITY_RULES.travelMinutes,
    bufferMinutes: DEMO_AVAILABILITY_RULES.bufferMinutes,
    remindersMinutesBeforeStart: DEMO_AVAILABILITY_RULES.remindersMinutesBeforeStart,
    conflictCheckingEnabled: DEMO_AVAILABILITY_RULES.conflictCheckingEnabled,
    calendarIds: DEMO_AVAILABILITY_RULES.calendarIds,
    schemaVersion: DEMO_AVAILABILITY_RULES.schemaVersion
  };
}

export const demoProposedWindows: readonly ProposedViewingWindow[] = [
  ["2026-07-27T21:30:00.000Z", "2026-07-27T22:30:00.000Z"],
  ["2026-07-28T21:30:00.000Z", "2026-07-28T22:30:00.000Z"]
].map(([startsAt, endsAt]) =>
  ProposedViewingWindowSchema.parse({
    startsAt,
    endsAt,
    timeZone: DEMO_AVAILABILITY_RULES.timeZone,
    availabilitySource: "vera_rules_only",
    state: "vera_rules_only",
    availabilityCheckId: demoAvailabilityCheck.id,
    checkedAt: null,
    calendarsChecked: [],
    requiresConflictWarning: true,
    rules: ruleSnapshot(),
    generatorVersion: "availability.v1"
  })
);

export function demoViewing(canonicalListingId: string): Viewing {
  return ViewingSchema.parse({
    id: "demo-viewing-1",
    canonicalListingId,
    proposedWindows: demoProposedWindows,
    selectedWindow: null,
    confirmedWindow: null,
    supersedesViewingId: null,
    timeZone: DEMO_AVAILABILITY_RULES.timeZone,
    calendarReference: null,
    state: "proposed",
    notes: null,
    metadata: {},
    createdAt: DEMO_CALENDAR_TEST_NOW,
    updatedAt: DEMO_CALENDAR_TEST_NOW
  });
}
