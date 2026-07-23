import { describe, expect, it } from "vitest";

import { AvailabilityRuleSetSchema, type AvailabilityCheckState } from "@vera/domain";

import {
  generateViewingWindows,
  isAvailabilityCheckFresh,
  markStaleWindowAtRead,
  type GenerateViewingWindowsInput
} from "./availability.ts";
import { allBlockedInput, dstRule, mondayRule } from "./availability.test-fixtures.ts";

const NOW = "2026-07-21T12:00:00.000Z";

function degradedInput(state: Exclude<AvailabilityCheckState, "checked" | "stale">) {
  return {
    now: NOW,
    rules: mondayRule(),
    horizonDays: 14,
    availability: {
      state,
      checkId: state === "vera_rules_only" ? null : `availability-check-${state}`,
      checkedAt: state === "vera_rules_only" ? null : NOW,
      calendarIds: []
    }
  } as const satisfies GenerateViewingWindowsInput;
}

describe("generateViewingWindows", () => {
  it("removes a conflict plus travel and buffer on both sides", () => {
    const rules = mondayRule({ travelMinutes: 20, bufferMinutes: 10 });
    const expandedRules = AvailabilityRuleSetSchema.parse({
      ...rules,
      weeklyIntervals: {
        ...rules.weeklyIntervals,
        "1": [{ startsAt: "09:00", endsAt: "14:00" }]
      }
    });
    const windows = generateViewingWindows({
      now: NOW,
      rules: expandedRules,
      horizonDays: 14,
      availability: {
        state: "checked",
        checkId: "availability-check-buffer",
        checkedAt: NOW,
        calendarIds: ["primary"],
        busy: [
          {
            startsAt: "2026-07-27T14:00:00.000Z",
            endsAt: "2026-07-27T15:00:00.000Z"
          }
        ]
      }
    });

    expect(windows[0]?.startsAt).toBe("2026-07-27T15:30:00Z");
    expect(windows.map(({ startsAt }) => startsAt)).not.toContain("2026-07-27T15:00:00Z");
  });

  it.each([
    ["2026-03-08", "America/New_York"],
    ["2026-11-01", "America/New_York"]
  ])("rejects ambiguous or nonexistent local slots on %s", (date, timeZone) => {
    expect(generateViewingWindows(dstRule(date, timeZone))).toEqual([]);
  });

  it("rejects a DST-crossing slot whose elapsed duration differs from the rule", () => {
    const input = dstRule("2026-03-08", "America/New_York");
    const rules = AvailabilityRuleSetSchema.parse({
      ...input.rules,
      durationMinutes: 120,
      weeklyIntervals: {
        ...input.rules.weeklyIntervals,
        "7": [{ startsAt: "00:30", endsAt: "03:30" }]
      }
    });

    expect(generateViewingWindows({ ...input, rules })).toEqual([]);
  });

  it("returns an explicit empty set when all candidates are blocked", () => {
    expect(generateViewingWindows(allBlockedInput())).toEqual([]);
  });

  it("validates provenance even when no candidate window would be returned", () => {
    const blocked = allBlockedInput();
    expect(() =>
      generateViewingWindows({
        ...blocked,
        availability: {
          ...blocked.availability,
          calendarIds: ["not-primary"]
        }
      } as unknown as GenerateViewingWindowsInput)
    ).toThrow(/primary Calendar/u);
    expect(() =>
      generateViewingWindows({
        ...blocked,
        availability: {
          state: "stale",
          checkId: "availability-check-stale",
          checkedAt: NOW,
          calendarIds: ["primary"],
          busy: []
        }
      } as unknown as GenerateViewingWindowsInput)
    ).toThrow(/read-time projection/u);
  });

  it("applies minimum notice to the candidate start", () => {
    const rules = AvailabilityRuleSetSchema.parse({
      ...mondayRule(),
      minimumNoticeMinutes: 120
    });
    const windows = generateViewingWindows({
      now: "2026-07-27T12:00:00.000Z",
      rules,
      horizonDays: 14,
      availability: {
        state: "scope_not_granted",
        checkId: "availability-check-scope",
        checkedAt: "2026-07-27T12:00:00.000Z",
        calendarIds: []
      }
    });

    expect(windows[0]?.startsAt).toBe("2026-07-27T14:00:00Z");
  });

  it("selects the earliest slot on distinct local dates before filling a day", () => {
    const rules = AvailabilityRuleSetSchema.parse({
      ...mondayRule(),
      minimumNoticeMinutes: 0,
      weeklyIntervals: {
        "1": [{ startsAt: "09:00", endsAt: "12:00" }],
        "2": [{ startsAt: "09:00", endsAt: "12:00" }],
        "3": [{ startsAt: "09:00", endsAt: "12:00" }],
        "4": [],
        "5": [],
        "6": [],
        "7": []
      }
    });
    const input = {
      now: "2026-07-27T00:00:00.000Z",
      rules,
      horizonDays: 14,
      availability: {
        state: "vera_rules_only",
        checkId: null,
        checkedAt: null,
        calendarIds: []
      }
    } as const satisfies GenerateViewingWindowsInput;

    const first = generateViewingWindows(input);
    const second = generateViewingWindows(input);
    expect(first).toEqual(second);
    expect(first.map(({ startsAt }) => startsAt)).toEqual([
      "2026-07-27T13:00:00Z",
      "2026-07-28T13:00:00Z",
      "2026-07-29T13:00:00Z"
    ]);
  });

  it.each([
    "scope_not_granted",
    "google_disconnected",
    "google_temporarily_unavailable",
    "vera_rules_only"
  ] as const)("makes %s a visible rules-only result", (state) => {
    const windows = generateViewingWindows(degradedInput(state));

    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({
      availabilitySource: "vera_rules_only",
      state,
      calendarsChecked: [],
      requiresConflictWarning: true,
      rules: {
        durationMinutes: 60,
        minimumNoticeMinutes: 120,
        travelMinutes: 20,
        bufferMinutes: 10
      },
      generatorVersion: "availability.v1"
    });
  });

  it("records complete fresh primary-calendar provenance", () => {
    const windows = generateViewingWindows({
      now: NOW,
      rules: mondayRule(),
      horizonDays: 14,
      availability: {
        state: "checked",
        checkId: "availability-check-fresh",
        checkedAt: NOW,
        calendarIds: ["primary"],
        busy: []
      }
    });

    expect(windows[0]).toMatchObject({
      availabilitySource: "google_freebusy",
      state: "checked",
      availabilityCheckId: "availability-check-fresh",
      checkedAt: NOW,
      calendarsChecked: ["primary"],
      requiresConflictWarning: false
    });
  });

  it("rejects stale checked input instead of silently generating checked windows", () => {
    expect(() =>
      generateViewingWindows({
        now: NOW,
        rules: mondayRule(),
        horizonDays: 14,
        availability: {
          state: "checked",
          checkId: "availability-check-old",
          checkedAt: "2026-07-21T11:54:59.999Z",
          calendarIds: ["primary"],
          busy: []
        }
      })
    ).toThrow(/stale Google result/u);
  });

  it("rejects a future-dated checked result instead of treating it as fresh", () => {
    expect(() =>
      generateViewingWindows({
        now: NOW,
        rules: mondayRule(),
        horizonDays: 14,
        availability: {
          state: "checked",
          checkId: "availability-check-future",
          checkedAt: "2026-07-21T12:00:00.001Z",
          calendarIds: ["primary"],
          busy: []
        }
      })
    ).toThrow(/stale Google result/u);
  });
});

describe("availability freshness", () => {
  it("uses a five-minute inclusive freshness boundary and rejects future timestamps", () => {
    expect(isAvailabilityCheckFresh("2026-07-21T11:55:00.000Z", NOW)).toBe(true);
    expect(isAvailabilityCheckFresh("2026-07-21T11:54:59.999Z", NOW)).toBe(false);
    expect(isAvailabilityCheckFresh("2026-07-21T12:00:00.001Z", NOW)).toBe(false);
    expect(isAvailabilityCheckFresh("2026-07-21T12:00:00.000000001Z", NOW)).toBe(false);
  });

  it("marks stale at read time while retaining Google provenance and persisted input", () => {
    const original = generateViewingWindows({
      now: NOW,
      rules: mondayRule(),
      horizonDays: 14,
      availability: {
        state: "checked",
        checkId: "availability-check-stale-later",
        checkedAt: NOW,
        calendarIds: ["primary"],
        busy: []
      }
    })[0];
    expect(original).toBeDefined();
    if (original === undefined) throw new Error("Expected a fixture window.");

    const stale = markStaleWindowAtRead({
      window: original,
      now: "2026-07-21T12:05:00.001Z"
    });
    expect(stale).toMatchObject({
      state: "stale",
      availabilitySource: "google_freebusy",
      availabilityCheckId: "availability-check-stale-later",
      checkedAt: NOW,
      calendarsChecked: ["primary"],
      requiresConflictWarning: true
    });
    expect(original.state).toBe("checked");
    expect(markStaleWindowAtRead({ window: original, now: "2026-07-21T12:05:00.000Z" })).toBe(
      original
    );
    expect(() =>
      markStaleWindowAtRead({ window: original, now: "2026-07-21T11:59:59.999Z" })
    ).toThrow(/cannot be in the future/u);
  });
});
