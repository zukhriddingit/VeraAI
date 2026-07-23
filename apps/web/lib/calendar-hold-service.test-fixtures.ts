import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CalendarProviderError,
  MockCalendarClient,
  type FreeBusyResult,
  type MockCalendarClientScript
} from "@vera/calendar";
import {
  DEMO_AVAILABILITY_RULES,
  DEMO_USER_ID,
  createDemoCalendarSidecar,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "@vera/db/demo";
import type { UserRepositoryProvider } from "@vera/db";
import { AvailabilityCheckSchema, ProposedViewingWindowSchema, ViewingSchema } from "@vera/domain";

import { createCalendarHoldService } from "./calendar-hold-service.ts";
import { createDemoCalendarApplication } from "./server/demo-calendar-application.ts";
import type { CalendarApplicationDependencies } from "./server/calendar-application.ts";

export const HOLD_TEST_NOW = "2026-07-21T12:05:00.000Z";

const fixtureCheck = AvailabilityCheckSchema.parse({
  id: "demo-hold-service-check-1",
  availabilityRuleSetId: DEMO_AVAILABILITY_RULES.id,
  integrationConnectionId: null,
  state: "vera_rules_only",
  rangeStartsAt: "2026-07-21T12:00:00.000Z",
  rangeEndsAt: "2026-08-04T12:00:00.000Z",
  calendarIdsAttempted: [],
  calendarsChecked: [],
  checkedAt: null,
  responseHash: null,
  busyIntervalCount: null,
  safeProviderErrorCode: null,
  correlationId: "demo-hold-service-check-correlation",
  createdAt: "2026-07-21T12:00:00.000Z"
});

const fixtureWindow = ProposedViewingWindowSchema.parse({
  startsAt: "2026-07-27T21:30:00.000Z",
  endsAt: "2026-07-27T22:30:00.000Z",
  timeZone: DEMO_AVAILABILITY_RULES.timeZone,
  availabilitySource: "vera_rules_only",
  state: "vera_rules_only",
  availabilityCheckId: fixtureCheck.id,
  checkedAt: null,
  calendarsChecked: [],
  requiresConflictWarning: true,
  rules: {
    timeZone: DEMO_AVAILABILITY_RULES.timeZone,
    weeklyIntervals: DEMO_AVAILABILITY_RULES.weeklyIntervals,
    durationMinutes: DEMO_AVAILABILITY_RULES.durationMinutes,
    minimumNoticeMinutes: DEMO_AVAILABILITY_RULES.minimumNoticeMinutes,
    travelMinutes: DEMO_AVAILABILITY_RULES.travelMinutes,
    bufferMinutes: DEMO_AVAILABILITY_RULES.bufferMinutes,
    remindersMinutesBeforeStart: DEMO_AVAILABILITY_RULES.remindersMinutesBeforeStart,
    conflictCheckingEnabled: false,
    calendarIds: [],
    schemaVersion: 1
  },
  generatorVersion: "availability.v1"
});

export const initiallyFree: FreeBusyResult = {
  busyIntervals: [],
  calendarsChecked: ["primary"],
  checkedAt: HOLD_TEST_NOW
};

export const nowBusy: FreeBusyResult = {
  busyIntervals: [
    {
      startsAt: fixtureWindow.startsAt,
      endsAt: fixtureWindow.endsAt
    }
  ],
  calendarsChecked: ["primary"],
  checkedAt: HOLD_TEST_NOW
};

export const temporarilyUnavailable = new CalendarProviderError("calendar_timeout", true, 504);

async function advanceListingToTourProposed(
  repositories: ReturnType<ReturnType<typeof createDemoRepositoryProvider>["forUser"]>
) {
  const listing = await repositories.canonicalListings.getById("can-cedar-flat");
  if (listing === null) throw new Error("Expected the sanitized Cedar listing fixture.");
  const transitions = [
    "shortlisted",
    "draft_ready",
    "draft_created",
    "replied",
    "tour_proposed"
  ] as const;
  let current = listing;
  for (const state of transitions) {
    current = await repositories.canonicalListings.transitionLifecycle(
      current.id,
      state,
      HOLD_TEST_NOW
    );
  }
  return current;
}

export interface CalendarHoldServiceFixture {
  readonly service: ReturnType<typeof createCalendarHoldService>;
  readonly repositories: ReturnType<ReturnType<typeof createDemoRepositoryProvider>["forUser"]>;
  readonly client: MockCalendarClient;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly calendar: CalendarApplicationDependencies;
  readonly listingId: string;
  readonly viewingId: string;
  close(): void;
}

export async function holdServiceFixture(
  finalCheckScript: readonly (FreeBusyResult | CalendarProviderError)[],
  options: {
    readonly conflictCheckingEnabled?: boolean;
    readonly clientScript?: Omit<MockCalendarClientScript, "freeBusy">;
  } = {}
): Promise<CalendarHoldServiceFixture> {
  const directory = mkdtempSync(join(tmpdir(), "vera-calendar-hold-service-"));
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  seedDatabase(createSqliteRepositories(connection));
  const sidecar = createDemoCalendarSidecar();
  const provider = createDemoRepositoryProvider(connection, { calendarSidecar: sidecar });
  const repositories = provider.forUser(DEMO_USER_ID);
  const listing = await advanceListingToTourProposed(repositories);
  const conflictCheckingEnabled = options.conflictCheckingEnabled ?? true;
  await repositories.availabilityRuleSets.upsertCurrent({
    ...DEMO_AVAILABILITY_RULES,
    conflictCheckingEnabled,
    calendarIds: conflictCheckingEnabled ? ["primary"] : [],
    updatedAt: "2026-07-21T12:02:00.000Z"
  });
  await repositories.availabilityChecks.append(fixtureCheck);
  const viewing = await repositories.viewings.insert(
    ViewingSchema.parse({
      id: "demo-hold-service-viewing-1",
      canonicalListingId: listing.id,
      proposedWindows: [fixtureWindow],
      selectedWindow: null,
      confirmedWindow: null,
      supersedesViewingId: null,
      timeZone: DEMO_AVAILABILITY_RULES.timeZone,
      calendarReference: null,
      state: "proposed",
      notes: null,
      metadata: {},
      createdAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z"
    })
  );
  const selectedWindow = fixtureWindow;
  await repositories.viewings.transition(
    viewing.id,
    "proposed",
    "selected",
    "2026-07-21T12:03:00.000Z",
    { selectedWindow }
  );
  const client = new MockCalendarClient({
    ...options.clientScript,
    freeBusy: finalCheckScript,
    deterministicHoldOperations: true
  });
  const calendar = createDemoCalendarApplication(client);
  const service = createCalendarHoldService({
    userId: DEMO_USER_ID,
    repositories,
    repositoryProvider: provider,
    calendar,
    clock: () => HOLD_TEST_NOW
  });
  return {
    service,
    repositories,
    client,
    repositoryProvider: provider,
    calendar,
    listingId: listing.id,
    viewingId: viewing.id,
    close() {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export async function approveNormalPreview(fixture: CalendarHoldServiceFixture) {
  const prepared = await fixture.service.createPreview({
    viewingId: fixture.viewingId,
    contactNotes: "Ask whether keys can be collected at the leasing office.",
    remindersMinutesBeforeStart: [30]
  });
  const approved = await fixture.service.approvePreview({
    viewingId: fixture.viewingId,
    holdId: prepared.hold.id,
    expectedPayloadHash: prepared.preview.payloadHash,
    correlationId: "correlation-calendar-approval-test"
  });
  return { prepared, approved };
}
