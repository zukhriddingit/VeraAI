import type {
  Approval,
  AvailabilityCheck,
  AvailabilityRuleSet,
  CalendarHold,
  CanonicalListing,
  ProposedViewingWindow,
  VeraUserId,
  Viewing
} from "@vera/domain";

import { CANONICAL_FIXTURES, DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import type { BeginCalendarHoldCreationInput, UserRepositoryProvider } from "../repositories.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";
import type { PostgresTestContext } from "./testing.ts";

export const CALENDAR_TEST_USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
export const OTHER_CALENDAR_TEST_USER_ID = "028f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
export const CALENDAR_TEST_NOW = "2026-07-21T12:00:00.000Z";
export const CALENDAR_TEST_LATER = "2026-07-21T12:01:00.000Z";

const payloadHash = "e".repeat(64);
const idempotencyKey = "f".repeat(64);

const weeklyIntervals: AvailabilityRuleSet["weeklyIntervals"] = {
  "1": [{ startsAt: "09:00", endsAt: "12:00" }],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
};

export const CALENDAR_TEST_RULE_SET: AvailabilityRuleSet = {
  id: "rules-calendar-1",
  timeZone: "America/New_York",
  weeklyIntervals,
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: true,
  calendarIds: ["primary"],
  schemaVersion: 1,
  createdAt: CALENDAR_TEST_NOW,
  updatedAt: CALENDAR_TEST_NOW
};

export const CALENDAR_TEST_CHECK: AvailabilityCheck = {
  id: "check-calendar-1",
  availabilityRuleSetId: CALENDAR_TEST_RULE_SET.id,
  integrationConnectionId: null,
  state: "checked",
  rangeStartsAt: "2026-07-27T12:00:00.000Z",
  rangeEndsAt: "2026-07-27T18:00:00.000Z",
  calendarIdsAttempted: ["primary"],
  calendarsChecked: ["primary"],
  checkedAt: CALENDAR_TEST_NOW,
  responseHash: "c".repeat(64),
  busyIntervalCount: 1,
  safeProviderErrorCode: null,
  correlationId: "correlation-calendar-check-1",
  createdAt: CALENDAR_TEST_NOW
};

export const CALENDAR_TEST_WINDOW: ProposedViewingWindow = {
  startsAt: "2026-07-27T14:00:00.000Z",
  endsAt: "2026-07-27T15:00:00.000Z",
  timeZone: "America/New_York",
  availabilitySource: "google_freebusy",
  state: "checked",
  availabilityCheckId: CALENDAR_TEST_CHECK.id,
  checkedAt: CALENDAR_TEST_CHECK.checkedAt,
  calendarsChecked: ["primary"],
  requiresConflictWarning: false,
  rules: {
    timeZone: CALENDAR_TEST_RULE_SET.timeZone,
    weeklyIntervals: CALENDAR_TEST_RULE_SET.weeklyIntervals,
    durationMinutes: CALENDAR_TEST_RULE_SET.durationMinutes,
    minimumNoticeMinutes: CALENDAR_TEST_RULE_SET.minimumNoticeMinutes,
    travelMinutes: CALENDAR_TEST_RULE_SET.travelMinutes,
    bufferMinutes: CALENDAR_TEST_RULE_SET.bufferMinutes,
    remindersMinutesBeforeStart: CALENDAR_TEST_RULE_SET.remindersMinutesBeforeStart,
    conflictCheckingEnabled: CALENDAR_TEST_RULE_SET.conflictCheckingEnabled,
    calendarIds: CALENDAR_TEST_RULE_SET.calendarIds,
    schemaVersion: 1
  },
  generatorVersion: "availability.v1"
};

export interface SeededCalendarFixture {
  readonly db: PostgresTestContext["db"];
  readonly provider: UserRepositoryProvider;
  readonly userId: VeraUserId;
  readonly otherUserId: VeraUserId;
  readonly ruleSet: AvailabilityRuleSet;
  readonly check: AvailabilityCheck;
  readonly listing: CanonicalListing;
  readonly viewing: Viewing;
  readonly approval: Approval;
  readonly hold: CalendarHold;
}

export function calendarHoldClaim(
  approval: Approval,
  hold: CalendarHold
): BeginCalendarHoldCreationInput {
  return {
    holdId: hold.id,
    viewingId: hold.viewingId,
    approvalId: approval.id,
    payloadHash: hold.payloadHash,
    idempotencyKey: hold.idempotencyKey,
    selectedWindow: CALENDAR_TEST_WINDOW,
    requestedAt: CALENDAR_TEST_LATER
  };
}

export function withSeededCalendarUser<T>(
  operation: (fixture: SeededCalendarFixture) => Promise<T>
): Promise<T> {
  return withPostgresTestDatabase(async ({ connection, db }) => {
    await db.insert(users).values([
      {
        id: CALENDAR_TEST_USER_ID,
        name: "Calendar User",
        email: "calendar@example.test",
        emailVerified: true
      },
      {
        id: OTHER_CALENDAR_TEST_USER_ID,
        name: "Other Calendar User",
        email: "other-calendar@example.test",
        emailVerified: true
      }
    ]);
    const provider = createPostgresRepositoryProvider(connection);
    const repositories = provider.forUser(CALENDAR_TEST_USER_ID);
    const sourceFixture = SOURCE_FIXTURES[7];
    const baseListing = CANONICAL_FIXTURES[3]?.listing;
    if (!baseListing) throw new Error("Calendar fixture listing is missing.");
    await repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
    await repositories.rawListings.import(sourceFixture.capture);
    await repositories.sourceRecords.insert(sourceFixture.sourceRecord);
    const listing = await repositories.canonicalListings.insert({
      ...baseListing,
      lifecycleState: "tour_proposed",
      updatedAt: CALENDAR_TEST_NOW
    });
    const ruleSet = await repositories.availabilityRuleSets.upsertCurrent(CALENDAR_TEST_RULE_SET);
    const check = await repositories.availabilityChecks.append(CALENDAR_TEST_CHECK);
    const viewing = await repositories.viewings.insert({
      id: "viewing-calendar-1",
      canonicalListingId: listing.id,
      proposedWindows: [CALENDAR_TEST_WINDOW],
      selectedWindow: CALENDAR_TEST_WINDOW,
      confirmedWindow: null,
      supersedesViewingId: null,
      timeZone: "America/New_York",
      calendarReference: null,
      state: "hold_approved",
      notes: null,
      metadata: {},
      createdAt: CALENDAR_TEST_NOW,
      updatedAt: CALENDAR_TEST_NOW
    });
    const approval = await repositories.approvals.insert({
      id: "approval-calendar-1",
      actor: "user",
      connectorId: "google-calendar",
      operation: "calendar.hold.create",
      targetType: "calendar_hold",
      targetId: "hold-calendar-1",
      payloadHash,
      state: "pending",
      createdAt: CALENDAR_TEST_NOW,
      expiresAt: "2026-07-21T12:10:00.000Z",
      usedAt: null
    });
    const hold = await repositories.calendarHolds.insert({
      id: "hold-calendar-1",
      viewingId: viewing.id,
      approvalId: approval.id,
      availabilityCheckId: check.id,
      payloadHash,
      idempotencyKey,
      googleEventId: `vera${"1".repeat(40)}`,
      providerEventReference: null,
      state: "approved",
      conflictCheckOverride: false,
      conflictCheckOverrideReason: null,
      safeErrorCode: null,
      createdAt: CALENDAR_TEST_NOW,
      updatedAt: CALENDAR_TEST_NOW,
      completedAt: null
    });
    return operation({
      db,
      provider,
      userId: CALENDAR_TEST_USER_ID,
      otherUserId: OTHER_CALENDAR_TEST_USER_ID,
      ruleSet,
      check,
      listing,
      viewing,
      approval,
      hold
    });
  });
}
