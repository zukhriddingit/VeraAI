import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SOURCE_FIXTURES } from "../fixtures.ts";
import {
  DEMO_USER_ID,
  DemoTenantMismatchError,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "./index.ts";
import { DEMO_AVAILABILITY_RULES, DEMO_GOOGLE_INTEGRATION } from "./calendar-repositories.ts";
import {
  DEMO_CALENDAR_TEST_LATER,
  demoAvailabilityCheck,
  demoCalendarHold,
  demoProposedWindows,
  demoViewing
} from "./calendar-repositories.test-fixtures.ts";

const directories: string[] = [];

function database() {
  const directory = mkdtempSync(join(tmpdir(), "vera-demo-calendar-"));
  directories.push(directory);
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  return { connection, provider: createDemoRepositoryProvider(connection) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("demo Calendar sidecar integration", () => {
  it("is fixed to DEMO_USER_ID and exposes only a no-credential synthetic Google read state", async () => {
    const { connection, provider } = database();
    try {
      expect(() => provider.forUser("018f9f64-7b5a-7c91-a12e-999999999999")).toThrow(
        DemoTenantMismatchError
      );
      await expect(provider.forUser(DEMO_USER_ID).integrationConnections.list()).resolves.toEqual([
        DEMO_GOOGLE_INTEGRATION
      ]);
      expect(DEMO_GOOGLE_INTEGRATION).toMatchObject({
        displayEmail: null,
        encryptedRefreshToken: null,
        grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned"]
      });
      expect(DEMO_GOOGLE_INTEGRATION.grantedScopes).not.toContain(
        "https://www.googleapis.com/auth/calendar.freebusy"
      );
      await expect(
        provider.forUser(DEMO_USER_ID).integrationConnections.upsert(DEMO_GOOGLE_INTEGRATION)
      ).rejects.toThrow("unavailable in offline demo mode");
      await expect(
        provider.forUser(DEMO_USER_ID).calendarOAuthStates.insert({} as never)
      ).rejects.toThrow("OAuth is unavailable");
    } finally {
      connection.close();
    }
  });

  it("rolls sidecar and SQLite mutations back together", async () => {
    const { connection, provider } = database();
    try {
      await expect(
        provider.transaction(DEMO_USER_ID, async (repositories) => {
          await repositories.availabilityRuleSets.upsertCurrent({
            ...DEMO_AVAILABILITY_RULES,
            bufferMinutes: 35,
            updatedAt: DEMO_CALENDAR_TEST_LATER
          });
          await repositories.availabilityChecks.append(demoAvailabilityCheck);
          await repositories.calendarHolds.insert(demoCalendarHold);
          await repositories.rawListings.import(SOURCE_FIXTURES[0].capture);
          throw new Error("synthetic mixed rollback");
        })
      ).rejects.toThrow("synthetic mixed rollback");

      const repositories = provider.forUser(DEMO_USER_ID);
      await expect(repositories.availabilityRuleSets.getCurrent()).resolves.toEqual(
        DEMO_AVAILABILITY_RULES
      );
      await expect(repositories.availabilityChecks.listRecent(10)).resolves.toEqual([]);
      await expect(repositories.calendarHolds.getById(demoCalendarHold.id)).resolves.toBeNull();
      await expect(repositories.rawListings.count()).resolves.toBe(0);
    } finally {
      connection.close();
    }
  });

  it("keeps committed sidecar state for the provider lifetime but not a replacement provider", async () => {
    const { connection, provider } = database();
    try {
      await provider.forUser(DEMO_USER_ID).availabilityChecks.append(demoAvailabilityCheck);
      await expect(
        provider.forUser(DEMO_USER_ID).availabilityChecks.listRecent(10)
      ).resolves.toEqual([demoAvailabilityCheck]);

      const resetProvider = createDemoRepositoryProvider(connection);
      await expect(
        resetProvider.forUser(DEMO_USER_ID).availabilityChecks.listRecent(10)
      ).resolves.toEqual([]);
      await expect(
        resetProvider.forUser(DEMO_USER_ID).availabilityRuleSets.getCurrent()
      ).resolves.toEqual(DEMO_AVAILABILITY_RULES);
    } finally {
      connection.close();
    }
  });

  it("keeps Calendar Viewing preparation and transitions in the existing SQLite adapter", async () => {
    const { connection, provider } = database();
    try {
      seedDatabase(createSqliteRepositories(connection));
      const repositories = provider.forUser(DEMO_USER_ID);
      const listing = (await repositories.canonicalListings.list())[0];
      if (!listing) throw new Error("Expected a seeded demo listing.");
      const viewing = demoViewing(listing.id);
      const selectedWindow = demoProposedWindows[1];
      if (!selectedWindow) throw new Error("Expected a second demo viewing window.");
      await repositories.viewings.insert(viewing);

      const selected = await repositories.viewings.transition(
        viewing.id,
        "proposed",
        "selected",
        DEMO_CALENDAR_TEST_LATER,
        { selectedWindow }
      );
      expect(selected.selectedWindow).toEqual(selectedWindow);

      const prepared = await repositories.viewings.prepareCalendarHold(
        viewing.id,
        "selected",
        "Ask whether the move-in date is flexible.",
        [30, 120],
        "2026-07-21T12:02:00.000Z"
      );
      expect(prepared).toMatchObject({
        notes: "Ask whether the move-in date is flexible.",
        selectedWindow,
        metadata: { calendarHoldRemindersMinutesBeforeStart: [30, 120] }
      });

      const attempts = await Promise.allSettled([
        repositories.viewings.transition(
          viewing.id,
          "selected",
          "hold_approved",
          "2026-07-21T12:03:00.000Z"
        ),
        repositories.viewings.transition(
          viewing.id,
          "selected",
          "hold_approved",
          "2026-07-21T12:03:00.000Z"
        )
      ]);
      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
      await expect(repositories.viewings.getById(viewing.id)).resolves.toMatchObject({
        state: "hold_approved",
        selectedWindow
      });
    } finally {
      connection.close();
    }
  });
});
