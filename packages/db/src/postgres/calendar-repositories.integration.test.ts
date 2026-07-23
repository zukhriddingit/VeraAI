import { sql } from "drizzle-orm";
import type { CalendarOAuthState } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  CALENDAR_TEST_LATER,
  CALENDAR_TEST_NOW,
  OTHER_CALENDAR_TEST_USER_ID,
  withSeededCalendarUser
} from "./calendar-testing.ts";

describe("tenant-scoped Calendar PostgreSQL repositories", () => {
  it("upserts one stable rule set and isolates it by user", async () => {
    await withSeededCalendarUser(async ({ provider, userId, ruleSet }) => {
      const updated = await provider.forUser(userId).availabilityRuleSets.upsertCurrent({
        ...ruleSet,
        bufferMinutes: 20,
        updatedAt: CALENDAR_TEST_LATER
      });
      expect(updated).toMatchObject({ id: ruleSet.id, bufferMinutes: 20 });
      await expect(
        provider.forUser(OTHER_CALENDAR_TEST_USER_ID).availabilityRuleSets.getCurrent()
      ).resolves.toBeNull();
    });
  });

  it("stores checks append-only and round-trips timestamptz instants", async () => {
    await withSeededCalendarUser(async ({ db, provider, userId, check }) => {
      await expect(provider.forUser(userId).availabilityChecks.getById(check.id)).resolves.toEqual(
        check
      );
      expect(await provider.forUser(userId).availabilityChecks.listRecent(10)).toEqual([check]);
      await expect(
        db.execute(sql`
          update availability_checks
          set safe_provider_error_code = 'mutated'
          where user_id = ${userId}::uuid and id = ${check.id}
        `)
      ).rejects.toThrow();
      await expect(provider.forUser(userId).availabilityChecks.getById(check.id)).resolves.toEqual(
        check
      );
    });
  });

  it("consumes OAuth state once and rejects wrong-user or expired consumption", async () => {
    await withSeededCalendarUser(async ({ provider, userId }) => {
      const state: CalendarOAuthState = {
        id: "138f9f64-7b5a-7c91-a12e-123456789abc",
        userId,
        stateHash: "a".repeat(64),
        capability: "calendar_conflict_checking" as const,
        requestedCalendarScopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
        encryptedPkceVerifier: {
          version: 1 as const,
          algorithm: "aes-256-gcm" as const,
          keyId: "calendar-test-key",
          nonce: "AAECAw==",
          ciphertext: "BAUGBw==",
          authenticationTag: "CAkKCw=="
        },
        redirectUriHash: "b".repeat(64),
        returnTo: "/settings/integrations",
        createdAt: CALENDAR_TEST_NOW,
        expiresAt: "2026-07-21T12:10:00.000Z",
        consumedAt: null
      };
      await provider.forUser(userId).calendarOAuthStates.insert(state);
      await expect(
        provider.forUser(OTHER_CALENDAR_TEST_USER_ID).calendarOAuthStates.consume({
          stateHash: state.stateHash,
          consumedAt: CALENDAR_TEST_LATER
        })
      ).rejects.toThrow("another user");
      await expect(
        provider.forUser(userId).calendarOAuthStates.consume({
          stateHash: state.stateHash,
          consumedAt: CALENDAR_TEST_LATER
        })
      ).resolves.toMatchObject({ consumedAt: CALENDAR_TEST_LATER });
      await expect(
        provider.forUser(userId).calendarOAuthStates.consume({
          stateHash: state.stateHash,
          consumedAt: "2026-07-21T12:02:00.000Z"
        })
      ).rejects.toThrow("already consumed");

      const expired = {
        ...state,
        id: "238f9f64-7b5a-7c91-a12e-123456789abc",
        stateHash: "c".repeat(64),
        expiresAt: CALENDAR_TEST_LATER
      };
      await provider.forUser(userId).calendarOAuthStates.insert(expired);
      await expect(
        provider.forUser(userId).calendarOAuthStates.consume({
          stateHash: expired.stateHash,
          consumedAt: CALENDAR_TEST_LATER
        })
      ).rejects.toThrow("expired");
    });
  });

  it("returns an idempotent hold and rejects a different immutable payload", async () => {
    await withSeededCalendarUser(async ({ provider, userId, hold }) => {
      await expect(provider.forUser(userId).calendarHolds.insert(hold)).resolves.toEqual(hold);
      await expect(
        provider.forUser(userId).calendarHolds.insert({
          ...hold,
          id: "hold-calendar-collision",
          payloadHash: "a".repeat(64),
          googleEventId: `vera${"2".repeat(40)}`
        })
      ).rejects.toThrow("different immutable payload");
      await expect(
        provider.forUser(userId).calendarHolds.insert({
          ...hold,
          availabilityCheckId: null
        })
      ).rejects.toThrow("different immutable payload");
    });
  });

  it("uses compare-and-set for Viewing transitions", async () => {
    await withSeededCalendarUser(async ({ provider, userId, viewing }) => {
      const attempts = await Promise.allSettled([
        provider
          .forUser(userId)
          .viewings.transition(viewing.id, "hold_approved", "selected", CALENDAR_TEST_LATER),
        provider
          .forUser(userId)
          .viewings.transition(viewing.id, "hold_approved", "selected", CALENDAR_TEST_LATER)
      ]);
      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    });
  });

  it("maps legacy Viewing intervals without rewriting stored JSON", async () => {
    await withSeededCalendarUser(async ({ db, provider, userId, listing }) => {
      const legacyWindows = [
        {
          startsAt: "2026-07-28T14:00:00.000Z",
          endsAt: "2026-07-28T15:00:00.000Z"
        }
      ];
      await db.execute(sql`
        insert into viewings (
          user_id, id, canonical_listing_id, proposed_windows, selected_window,
          confirmed_window, supersedes_viewing_id, time_zone, calendar_reference,
          state, notes, metadata, created_at, updated_at
        ) values (
          ${userId}::uuid, 'viewing-legacy-read', ${listing.id},
          ${JSON.stringify(legacyWindows)}::jsonb, null, null, null,
          'America/New_York', null, 'proposed', null, '{}'::jsonb,
          ${CALENDAR_TEST_NOW}::timestamptz, ${CALENDAR_TEST_NOW}::timestamptz
        )
      `);
      const mapped = await provider.forUser(userId).viewings.getById("viewing-legacy-read");
      expect(mapped?.proposedWindows[0]).toMatchObject({
        availabilitySource: "vera_rules_only",
        state: "vera_rules_only",
        requiresConflictWarning: true,
        generatorVersion: "legacy.v0"
      });
      const stored = await db.execute<{ proposed_windows: unknown }>(sql`
        select proposed_windows from viewings
        where user_id = ${userId}::uuid and id = 'viewing-legacy-read'
      `);
      expect(stored.rows[0]?.proposed_windows).toEqual(legacyWindows);
    });
  });
});
