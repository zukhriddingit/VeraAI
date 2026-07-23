import { Temporal } from "@js-temporal/polyfill";
import {
  AVAILABILITY_GENERATOR_VERSION,
  AvailabilityCheckStateSchema,
  AvailabilityRuleSetSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ProposedViewingWindowSchema,
  type AvailabilityCheckState,
  type AvailabilityRuleSet,
  type AvailabilityRuleSnapshot,
  type ProposedViewingWindow
} from "@vera/domain";

import { FreeBusyIntervalSchema, type FreeBusyInterval } from "./contracts.ts";

const SLOT_INCREMENT_MINUTES = 15;
const MAXIMUM_WINDOW_COUNT = 3;
const DEFAULT_FRESHNESS_MILLISECONDS = 300_000;
const NANOSECONDS_PER_MINUTE = 60_000_000_000n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

type DegradedAvailabilityState = Exclude<AvailabilityCheckState, "checked" | "stale">;

export type CalendarAvailabilityInput =
  | {
      readonly state: "checked";
      readonly checkId: string;
      readonly checkedAt: string;
      readonly calendarIds: readonly ["primary"];
      readonly busy: readonly FreeBusyInterval[];
    }
  | {
      readonly state: DegradedAvailabilityState;
      readonly checkId: string | null;
      readonly checkedAt: string | null;
      readonly calendarIds: readonly [];
    };

export interface GenerateViewingWindowsInput {
  readonly now: string;
  readonly rules: AvailabilityRuleSet;
  readonly horizonDays: 14;
  readonly availability: CalendarAvailabilityInput;
}

interface CandidateWindow {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly localDate: string;
}

function validateAvailabilityInput(input: CalendarAvailabilityInput): CalendarAvailabilityInput {
  const parsedState = AvailabilityCheckStateSchema.parse(input.state);
  if (parsedState === "stale") {
    throw new RangeError("Stale is a read-time projection and cannot be generator input.");
  }

  if ("busy" in input) {
    if (parsedState !== "checked") {
      throw new RangeError("Only checked availability may include busy intervals.");
    }
    if (input.calendarIds.length !== 1 || input.calendarIds[0] !== "primary") {
      throw new RangeError("Checked availability must cover only the primary Calendar.");
    }
    return {
      state: "checked",
      checkId: EntityIdSchema.parse(input.checkId),
      checkedAt: IsoDateTimeSchema.parse(input.checkedAt),
      calendarIds: ["primary"],
      busy: input.busy.map((interval) => FreeBusyIntervalSchema.parse(interval))
    };
  }

  if (parsedState === "checked") {
    throw new RangeError("Checked availability requires free/busy intervals.");
  }
  if (input.calendarIds.length !== 0) {
    throw new RangeError("Degraded availability cannot claim a checked Calendar.");
  }
  return {
    state: parsedState,
    checkId: input.checkId === null ? null : EntityIdSchema.parse(input.checkId),
    checkedAt: input.checkedAt === null ? null : IsoDateTimeSchema.parse(input.checkedAt),
    calendarIds: []
  };
}

function snapshotRules(rules: AvailabilityRuleSet): AvailabilityRuleSnapshot {
  return {
    timeZone: rules.timeZone,
    weeklyIntervals: rules.weeklyIntervals,
    durationMinutes: rules.durationMinutes,
    minimumNoticeMinutes: rules.minimumNoticeMinutes,
    travelMinutes: rules.travelMinutes,
    bufferMinutes: rules.bufferMinutes,
    remindersMinutesBeforeStart: rules.remindersMinutesBeforeStart,
    conflictCheckingEnabled: rules.conflictCheckingEnabled,
    calendarIds: rules.calendarIds,
    schemaVersion: rules.schemaVersion
  };
}

function plainTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === undefined || minutes === undefined) {
    throw new RangeError("A weekly availability time must use HH:mm format.");
  }
  return hours * 60 + minutes;
}

function minutesToPlainTime(totalMinutes: number): Temporal.PlainTime {
  return Temporal.PlainTime.from({
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60
  });
}

function firstQuarterHourAtOrAfter(totalMinutes: number): number {
  return Math.ceil(totalMinutes / SLOT_INCREMENT_MINUTES) * SLOT_INCREMENT_MINUTES;
}

function toInstantRejectingDst(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string
): Temporal.Instant | null {
  try {
    return date
      .toPlainDateTime(time)
      .toZonedDateTime(timeZone, { disambiguation: "reject" })
      .toInstant();
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function expandedBusyIntervals(
  busy: readonly FreeBusyInterval[],
  expansionMinutes: number
): readonly { readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant }[] {
  return busy.map((untrustedInterval) => {
    const interval = FreeBusyIntervalSchema.parse(untrustedInterval);
    return {
      startsAt: Temporal.Instant.from(interval.startsAt).subtract({ minutes: expansionMinutes }),
      endsAt: Temporal.Instant.from(interval.endsAt).add({ minutes: expansionMinutes })
    };
  });
}

function intersectsBusyInterval(
  candidateStartsAt: Temporal.Instant,
  candidateEndsAt: Temporal.Instant,
  busy: readonly { readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant }[]
): boolean {
  return busy.some(
    (interval) =>
      Temporal.Instant.compare(candidateStartsAt, interval.endsAt) < 0 &&
      Temporal.Instant.compare(candidateEndsAt, interval.startsAt) > 0
  );
}

function selectDeterministicCandidates(
  candidates: readonly CandidateWindow[]
): readonly CandidateWindow[] {
  const selected: CandidateWindow[] = [];
  const selectedStartsAt = new Set<string>();
  const selectedDates = new Set<string>();

  for (const candidate of candidates) {
    if (selectedDates.has(candidate.localDate)) continue;
    selected.push(candidate);
    selectedStartsAt.add(candidate.startsAt);
    selectedDates.add(candidate.localDate);
    if (selected.length === MAXIMUM_WINDOW_COUNT) return selected;
  }

  for (const candidate of candidates) {
    if (selectedStartsAt.has(candidate.startsAt)) continue;
    selected.push(candidate);
    if (selected.length === MAXIMUM_WINDOW_COUNT) break;
  }

  return selected;
}

function toProposedWindow(
  candidate: CandidateWindow,
  rules: AvailabilityRuleSet,
  availability: CalendarAvailabilityInput
): ProposedViewingWindow {
  const checked = availability.state === "checked";
  return ProposedViewingWindowSchema.parse({
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    timeZone: rules.timeZone,
    availabilitySource: checked ? "google_freebusy" : "vera_rules_only",
    state: availability.state,
    availabilityCheckId: availability.checkId,
    checkedAt: availability.checkedAt,
    calendarsChecked: availability.calendarIds,
    requiresConflictWarning: !checked,
    rules: snapshotRules(rules),
    generatorVersion: AVAILABILITY_GENERATOR_VERSION
  });
}

export function isAvailabilityCheckFresh(
  checkedAt: string,
  now: string,
  maximumAgeMilliseconds = DEFAULT_FRESHNESS_MILLISECONDS
): boolean {
  if (!Number.isSafeInteger(maximumAgeMilliseconds) || maximumAgeMilliseconds < 0) {
    throw new RangeError("Availability freshness must be a non-negative integer duration.");
  }
  const checkedInstant = Temporal.Instant.from(checkedAt);
  const nowInstant = Temporal.Instant.from(now);
  const ageNanoseconds = nowInstant.epochNanoseconds - checkedInstant.epochNanoseconds;
  return (
    ageNanoseconds >= 0 &&
    ageNanoseconds <= BigInt(maximumAgeMilliseconds) * NANOSECONDS_PER_MILLISECOND
  );
}

export function markStaleWindowAtRead(input: {
  readonly window: ProposedViewingWindow;
  readonly now: string;
  readonly maximumAgeMilliseconds?: number;
}): ProposedViewingWindow {
  const window = ProposedViewingWindowSchema.parse(input.window);
  if (window.state !== "checked" || window.checkedAt === null) return input.window;

  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(window.checkedAt),
      Temporal.Instant.from(input.now)
    ) > 0
  ) {
    throw new RangeError("An availability check timestamp cannot be in the future.");
  }

  if (
    isAvailabilityCheckFresh(
      window.checkedAt,
      input.now,
      input.maximumAgeMilliseconds ?? DEFAULT_FRESHNESS_MILLISECONDS
    )
  ) {
    return input.window;
  }

  return ProposedViewingWindowSchema.parse({
    ...window,
    state: "stale",
    requiresConflictWarning: true
  });
}

export function generateViewingWindows(
  untrustedInput: GenerateViewingWindowsInput
): readonly ProposedViewingWindow[] {
  const rules = AvailabilityRuleSetSchema.parse(untrustedInput.rules);
  if (untrustedInput.horizonDays !== 14) {
    throw new RangeError("The founder-release planning horizon must be exactly 14 days.");
  }

  const now = Temporal.Instant.from(untrustedInput.now);
  const availability = validateAvailabilityInput(untrustedInput.availability);
  if (
    availability.state === "checked" &&
    !isAvailabilityCheckFresh(availability.checkedAt, untrustedInput.now)
  ) {
    throw new RangeError(
      "A stale Google result cannot be used to generate conflict-checked viewing windows."
    );
  }

  const busy =
    availability.state === "checked"
      ? expandedBusyIntervals(availability.busy, rules.travelMinutes + rules.bufferMinutes)
      : [];
  const minimumStart = now.add({ minutes: rules.minimumNoticeMinutes });
  const firstLocalDate = now.toZonedDateTimeISO(rules.timeZone).toPlainDate();
  const candidates: CandidateWindow[] = [];

  for (let dayOffset = 0; dayOffset < untrustedInput.horizonDays; dayOffset += 1) {
    const date = firstLocalDate.add({ days: dayOffset });
    const weekday = String(date.dayOfWeek) as keyof typeof rules.weeklyIntervals;

    for (const interval of rules.weeklyIntervals[weekday]) {
      const intervalStartMinutes = plainTimeToMinutes(interval.startsAt);
      const intervalEndMinutes = plainTimeToMinutes(interval.endsAt);
      const latestStartMinutes = intervalEndMinutes - rules.durationMinutes;

      for (
        let candidateMinutes = firstQuarterHourAtOrAfter(intervalStartMinutes);
        candidateMinutes <= latestStartMinutes;
        candidateMinutes += SLOT_INCREMENT_MINUTES
      ) {
        const localStart = minutesToPlainTime(candidateMinutes);
        const localEnd = minutesToPlainTime(candidateMinutes + rules.durationMinutes);
        const startsAt = toInstantRejectingDst(date, localStart, rules.timeZone);
        const endsAt = toInstantRejectingDst(date, localEnd, rules.timeZone);

        if (startsAt === null || endsAt === null) continue;
        if (Temporal.Instant.compare(endsAt, startsAt) <= 0) continue;
        if (
          endsAt.epochNanoseconds - startsAt.epochNanoseconds !==
          BigInt(rules.durationMinutes) * NANOSECONDS_PER_MINUTE
        ) {
          continue;
        }
        if (Temporal.Instant.compare(startsAt, minimumStart) < 0) continue;
        if (intersectsBusyInterval(startsAt, endsAt, busy)) continue;

        candidates.push({
          startsAt: startsAt.toString(),
          endsAt: endsAt.toString(),
          localDate: date.toString()
        });
      }
    }
  }

  candidates.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return selectDeterministicCandidates(candidates).map((candidate) =>
    toProposedWindow(candidate, rules, availability)
  );
}
