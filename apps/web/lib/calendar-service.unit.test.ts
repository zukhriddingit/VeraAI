import { AvailabilityRuleSetSchema, IntegrationConnectionSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  getCalendarIntegrationStatus,
  markViewingProposalStaleAtRead
} from "./calendar-service.ts";
import {
  FIXED_NOW,
  availabilityRules,
  busyResult,
  calendarFailure,
  googleConnection,
  proposalInput,
  serviceWith
} from "./calendar-service.test-fixtures.ts";

describe("CalendarAvailabilityService", () => {
  it("never treats a transient Google failure as an empty checked calendar", async () => {
    const fixture = serviceWith(calendarFailure("calendar_timeout"));
    const result = await fixture.service.propose(proposalInput);

    expect(result.state).toBe("google_temporarily_unavailable");
    expect(result.calendarsChecked).toEqual([]);
    expect(result.windows).toHaveLength(3);
    expect(result.windows.every((window) => window.requiresConflictWarning)).toBe(true);
    expect(result.windows.every((window) => window.availabilitySource === "vera_rules_only")).toBe(
      true
    );
    expect(fixture.client.freeBusyCalls).toHaveLength(1);
  });

  it("persists only a summary of a successful primary-calendar check", async () => {
    const fixture = serviceWith(busyResult);
    const result = await fixture.service.propose(proposalInput);

    expect(result.state).toBe("checked");
    expect(result.calendarsChecked).toEqual(["primary"]);
    expect(result.checkedAt).toBe(FIXED_NOW);
    expect(fixture.persistedChecks).toHaveLength(1);
    expect(fixture.persistedChecks[0]).toMatchObject({
      state: "checked",
      calendarsChecked: ["primary"],
      busyIntervalCount: 1,
      safeProviderErrorCode: null
    });
    expect(fixture.persistedChecks[0]).not.toHaveProperty("busy");
    expect(fixture.persistedChecks[0]).not.toHaveProperty("busyIntervals");
    expect(fixture.client.lookupCalls).toEqual([]);
    expect(fixture.client.insertCalls).toEqual([]);
  });

  it("removes conflicts plus the configured adjacent travel and buffer", async () => {
    const result = await serviceWith(busyResult).service.propose(proposalInput);

    expect(result.windows[0]?.startsAt).toBe("2026-07-27T15:30:00Z");
    expect(result.windows.map((window) => window.startsAt)).not.toContain("2026-07-27T15:00:00Z");
  });

  it("returns an explicit checked empty result when every candidate is blocked", async () => {
    const result = await serviceWith({
      ...busyResult,
      busyIntervals: [
        {
          startsAt: "2026-07-21T12:00:00.000Z",
          endsAt: "2026-08-04T12:00:00.000Z"
        }
      ]
    }).service.propose(proposalInput);

    expect(result).toMatchObject({ state: "checked", calendarsChecked: ["primary"], windows: [] });
  });

  it("fails visibly without free/busy scope and never constructs a Calendar client", async () => {
    const partial = IntegrationConnectionSchema.parse({
      ...googleConnection,
      grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
      status: "partial"
    });
    const fixture = serviceWith(busyResult, { connection: partial });
    const result = await fixture.service.propose(proposalInput);

    expect(result.state).toBe("scope_not_granted");
    expect(result.windows.every((window) => window.requiresConflictWarning)).toBe(true);
    expect(fixture.client.freeBusyCalls).toHaveLength(0);
  });

  it.each(["revoked", "expired", "disconnected", "reconnect_required"] as const)(
    "falls back visibly for a %s Google connection",
    async (status) => {
      const connection = IntegrationConnectionSchema.parse({
        ...googleConnection,
        encryptedRefreshToken:
          status === "disconnected" ? null : googleConnection.encryptedRefreshToken,
        status
      });
      const fixture = serviceWith(busyResult, { connection });

      await expect(fixture.service.propose(proposalInput)).resolves.toMatchObject({
        state: "google_disconnected",
        calendarsChecked: []
      });
      expect(fixture.client.freeBusyCalls).toHaveLength(0);
    }
  );

  it("turns provider-reported revocation into a visible disconnected fallback", async () => {
    const fixture = serviceWith(calendarFailure("calendar_auth_revoked"));
    const result = await fixture.service.propose(proposalInput);

    expect(result).toMatchObject({ state: "google_disconnected", calendarsChecked: [] });
    expect(result.windows.every((window) => window.requiresConflictWarning)).toBe(true);
    expect(fixture.persistedChecks[0]?.calendarIdsAttempted).toEqual([]);
  });

  it("uses Vera rules only when conflict checking is intentionally disabled", async () => {
    const disabledRules = AvailabilityRuleSetSchema.parse({
      ...availabilityRules,
      conflictCheckingEnabled: false,
      calendarIds: []
    });
    const fixture = serviceWith(busyResult, { rules: disabledRules });
    const result = await fixture.service.propose(proposalInput);

    expect(result.state).toBe("vera_rules_only");
    expect(result.windows.every((window) => window.requiresConflictWarning)).toBe(true);
    expect(fixture.client.freeBusyCalls).toHaveLength(0);
  });

  it("marks a successful result stale at read time without changing persisted provenance", async () => {
    const result = await serviceWith(busyResult).service.propose(proposalInput);
    const stale = markViewingProposalStaleAtRead(result, "2026-07-21T12:05:00.001Z");

    expect(stale.state).toBe("stale");
    expect(stale.calendarsChecked).toEqual(["primary"]);
    expect(stale.checkedAt).toBe(FIXED_NOW);
    expect(stale.windows[0]).toMatchObject({
      state: "stale",
      availabilitySource: "google_freebusy",
      calendarsChecked: ["primary"],
      checkedAt: FIXED_NOW,
      requiresConflictWarning: true
    });
    expect(result.state).toBe("checked");
    expect(result.windows[0]?.state).toBe("checked");
  });

  it("projects granted, missing, expired, and revoked capabilities independently", async () => {
    const repositories = serviceWith(busyResult, {
      connection: IntegrationConnectionSchema.parse({
        ...googleConnection,
        status: "partial",
        grantedScopes: ["https://www.googleapis.com/auth/calendar.freebusy"]
      })
    }).repositories;
    await expect(
      getCalendarIntegrationStatus(repositories, "configured", FIXED_NOW)
    ).resolves.toMatchObject({
      conflictChecking: { state: "granted", accountEmail: "renter@example.test" },
      holdCreation: { state: "missing", accountEmail: "renter@example.test" },
      primaryCalendarOnly: true
    });

    for (const state of ["expired", "revoked"] as const) {
      const statusRepositories = serviceWith(busyResult, {
        connection: IntegrationConnectionSchema.parse({ ...googleConnection, status: state })
      }).repositories;
      const statusResult = await getCalendarIntegrationStatus(
        statusRepositories,
        "configured",
        FIXED_NOW
      );
      expect(statusResult.conflictChecking.state).toBe(state);
      expect(statusResult.holdCreation.state).toBe(state);
    }
  });

  it("does not present a disconnected stored account as currently connected", async () => {
    const repositories = serviceWith(busyResult, {
      connection: IntegrationConnectionSchema.parse({
        ...googleConnection,
        encryptedRefreshToken: null,
        grantedScopes: [],
        status: "disconnected"
      })
    }).repositories;

    await expect(
      getCalendarIntegrationStatus(repositories, "configured", FIXED_NOW)
    ).resolves.toMatchObject({
      conflictChecking: {
        state: "disconnected",
        accountEmail: null,
        lastSuccessfulUseAt: null
      },
      holdCreation: {
        state: "disconnected",
        accountEmail: null,
        lastSuccessfulUseAt: null
      }
    });
  });
});
