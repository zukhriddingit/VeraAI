import type { ActivityEvent, AvailabilityRuleSet, VeraUserId } from "@vera/domain";
import {
  GetAvailabilityRulesResponseSchema,
  PutAvailabilityRulesResponseSchema
} from "@vera/domain";
import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  availabilityRules,
  FIXED_USER_ID
} from "../../../../lib/calendar-service.test-fixtures.ts";
import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../../lib/server/application-registry.ts";
import { createUnconfiguredCalendarApplication } from "../../../../lib/server/calendar-application.ts";
import { GET, PUT } from "./route.ts";

interface MemoryFixture {
  readonly activities: ActivityEvent[];
  readonly provider: UserRepositoryProvider;
  readonly rules: () => AvailabilityRuleSet | null;
}

function memoryFixture(): MemoryFixture {
  let current: AvailabilityRuleSet | null = null;
  const activities: ActivityEvent[] = [];
  const repositories = {
    availabilityRuleSets: {
      async upsertCurrent(value: AvailabilityRuleSet) {
        current = value;
        return value;
      },
      async getCurrent() {
        return current;
      }
    },
    activityEvents: {
      async append(value: ActivityEvent) {
        activities.push(value);
        return value;
      }
    }
  } as unknown as UserRepositories;
  const provider: UserRepositoryProvider = {
    forUser(userId) {
      if (userId !== FIXED_USER_ID) throw new Error("Wrong fixture owner.");
      return repositories;
    },
    async transaction(userId, operation) {
      if (userId !== FIXED_USER_ID) throw new Error("Wrong fixture owner.");
      return operation(repositories);
    }
  };
  return { activities, provider, rules: () => current };
}

function registerFixture(fixture: MemoryFixture, sessionUserId: VeraUserId | null = FIXED_USER_ID) {
  const application: VeraApplication = {
    mode: "hosted",
    repositoryProvider: fixture.provider,
    auth: {
      api: {
        getSession: vi.fn(async () =>
          sessionUserId === null ? null : { user: { id: sessionUserId }, session: {} }
        )
      }
    } as unknown as VeraApplication["auth"],
    calendar: createUnconfiguredCalendarApplication(),
    gmailOAuth: null,
    demoUserId: null,
    readiness: vi.fn(),
    close: vi.fn()
  };
  registerApplication(application);
}

const snapshot = {
  timeZone: availabilityRules.timeZone,
  weeklyIntervals: availabilityRules.weeklyIntervals,
  durationMinutes: availabilityRules.durationMinutes,
  minimumNoticeMinutes: availabilityRules.minimumNoticeMinutes,
  travelMinutes: availabilityRules.travelMinutes,
  bufferMinutes: availabilityRules.bufferMinutes,
  remindersMinutesBeforeStart: availabilityRules.remindersMinutesBeforeStart,
  conflictCheckingEnabled: availabilityRules.conflictCheckingEnabled,
  calendarIds: availabilityRules.calendarIds,
  schemaVersion: availabilityRules.schemaVersion
};

function request(method: "GET" | "PUT", body?: unknown, includeOrigin = true): Request {
  return new Request("http://127.0.0.1/api/availability/rules", {
    method,
    headers: {
      ...(includeOrigin ? { Origin: "http://127.0.0.1" } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

afterEach(() => {
  clearApplicationForTesting();
});

describe.sequential("/api/availability/rules", () => {
  it("requires an authenticated Vera user before reading rules", async () => {
    const fixture = memoryFixture();
    registerFixture(fixture, null);

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  it("returns the current user-owned rules with no-store headers", async () => {
    const fixture = memoryFixture();
    registerFixture(fixture);

    const emptyResponse = await GET(request("GET"));
    const empty = GetAvailabilityRulesResponseSchema.parse(await emptyResponse.json());
    expect(empty.rules).toBeNull();
    expect(emptyResponse.headers.get("cache-control")).toContain("no-store");

    await PUT(request("PUT", snapshot));
    const response = await GET(request("GET"));
    const result = GetAvailabilityRulesResponseSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(result.rules).toMatchObject(snapshot);
  });

  it("validates, saves, and audits a same-origin rule update atomically", async () => {
    const fixture = memoryFixture();
    registerFixture(fixture);

    const response = await PUT(request("PUT", snapshot));
    const result = PutAvailabilityRulesResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.rules).toMatchObject(snapshot);
    expect(fixture.rules()).toEqual(result.rules);
    expect(fixture.activities).toHaveLength(1);
    expect(fixture.activities[0]).toMatchObject({
      action: "viewing.availability_saved",
      actor: "user",
      targetType: "availability_rule_set",
      targetId: result.rules.id,
      policyDecision: "not_applicable",
      outcome: "recorded"
    });
    expect(fixture.activities[0]?.metadata).toEqual({
      primaryCalendarOnly: true,
      state: "conflict_checking_enabled"
    });
    expect(JSON.stringify(fixture.activities[0]?.metadata)).not.toContain("America/New_York");
  });

  it("rejects cross-origin and invalid rule updates without persistence", async () => {
    const fixture = memoryFixture();
    registerFixture(fixture);

    const noOrigin = await PUT(request("PUT", snapshot, false));
    expect(noOrigin.status).toBe(403);

    const invalid = await PUT(
      request("PUT", {
        ...snapshot,
        weeklyIntervals: {
          ...snapshot.weeklyIntervals,
          "1": [
            { startsAt: "09:00", endsAt: "12:00" },
            { startsAt: "11:00", endsAt: "13:00" }
          ]
        }
      })
    );
    expect(invalid.status).toBe(400);
    expect(fixture.rules()).toBeNull();
    expect(fixture.activities).toEqual([]);
  });
});
