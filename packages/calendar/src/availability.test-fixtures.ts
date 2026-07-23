import { Temporal } from "@js-temporal/polyfill";
import {
  AvailabilityRuleSetSchema,
  type AvailabilityRuleSet,
  type WeeklyAvailabilityIntervals
} from "@vera/domain";

import type { GenerateViewingWindowsInput } from "./availability.ts";

const EMPTY_WEEK = {
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
} as const satisfies WeeklyAvailabilityIntervals;

function rulesWithIntervals(
  weeklyIntervals: WeeklyAvailabilityIntervals,
  overrides: Partial<
    Pick<
      AvailabilityRuleSet,
      "durationMinutes" | "minimumNoticeMinutes" | "travelMinutes" | "bufferMinutes" | "timeZone"
    >
  > = {}
): AvailabilityRuleSet {
  return AvailabilityRuleSetSchema.parse({
    id: "availability-rules-1",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  });
}

export function mondayRule(
  overrides: Partial<Pick<AvailabilityRuleSet, "travelMinutes" | "bufferMinutes">> = {}
): AvailabilityRuleSet {
  return rulesWithIntervals(
    {
      ...EMPTY_WEEK,
      "1": [{ startsAt: "09:00", endsAt: "12:00" }]
    },
    overrides
  );
}

export function dstRule(date: string, timeZone: string): GenerateViewingWindowsInput {
  const transitionDate = Temporal.PlainDate.from(date);
  const weekday = String(transitionDate.dayOfWeek) as keyof WeeklyAvailabilityIntervals;
  const localInterval = date.includes("-03-")
    ? { startsAt: "02:00", endsAt: "03:00" }
    : { startsAt: "01:00", endsAt: "02:00" };
  const weeklyIntervals: WeeklyAvailabilityIntervals = {
    ...EMPTY_WEEK,
    [weekday]: [localInterval]
  };
  const now = transitionDate
    .subtract({ days: 1 })
    .toPlainDateTime("12:00")
    .toZonedDateTime(timeZone)
    .toInstant();
  const laterRecurrenceBlockStart = transitionDate
    .add({ days: 1 })
    .toPlainDateTime("00:00")
    .toZonedDateTime(timeZone)
    .toInstant();
  const laterRecurrenceBlockEnd = transitionDate
    .add({ days: 21 })
    .toPlainDateTime("00:00")
    .toZonedDateTime(timeZone)
    .toInstant();

  return {
    now: now.toString(),
    rules: rulesWithIntervals(weeklyIntervals, {
      timeZone,
      durationMinutes: 60,
      minimumNoticeMinutes: 0,
      travelMinutes: 0,
      bufferMinutes: 0
    }),
    horizonDays: 14,
    availability: {
      state: "checked",
      checkId: "availability-check-dst",
      checkedAt: now.toString(),
      calendarIds: ["primary"],
      busy: [
        {
          startsAt: laterRecurrenceBlockStart.toString(),
          endsAt: laterRecurrenceBlockEnd.toString()
        }
      ]
    }
  };
}

export function allBlockedInput(): GenerateViewingWindowsInput {
  return {
    now: "2026-07-21T12:00:00.000Z",
    rules: mondayRule(),
    horizonDays: 14,
    availability: {
      state: "checked",
      checkId: "availability-check-all-blocked",
      checkedAt: "2026-07-21T12:00:00.000Z",
      calendarIds: ["primary"],
      busy: [
        {
          startsAt: "2026-07-20T00:00:00.000Z",
          endsAt: "2026-08-10T00:00:00.000Z"
        }
      ]
    }
  };
}
