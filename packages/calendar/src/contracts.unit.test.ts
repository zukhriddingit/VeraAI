import { describe, expect, it } from "vitest";

import {
  CalendarDescriptionSchema,
  CalendarEventIdSchema,
  CalendarHoldLookupSchema,
  CalendarLocationSchema,
  CalendarSummarySchema,
  FreeBusyRequestSchema,
  FreeBusyResultSchema,
  GetTentativeHoldRequestSchema,
  IanaTimeZoneSchema,
  InsertTentativeHoldRequestSchema,
  InsertedCalendarHoldSchema
} from "./contracts.ts";

const interval = {
  startsAt: "2026-11-02T15:00:00.000Z",
  endsAt: "2026-11-02T16:00:00.000Z"
} as const;

const eventId = "vera0000000000000000000000000000000000000000";
const veraMarker = "VERA-HOLD:hold-1";

const safeHold = {
  calendarId: "primary",
  eventId,
  veraMarker,
  summary: "Tentative viewing — 12 Cedar St",
  location: "12 Cedar St, Boston, MA",
  description: "Sanitized source references\nVERA-HOLD:hold-1",
  ...interval,
  timeZone: "America/New_York",
  remindersMinutesBeforeStart: [30],
  status: "tentative",
  visibility: "private",
  transparency: "opaque",
  attendees: [],
  conferenceData: null,
  sendUpdates: "none"
} as const;

describe("Calendar transport contracts", () => {
  it("permits only the primary calendar for the founder release", () => {
    expect(
      FreeBusyRequestSchema.parse({
        ...interval,
        timeZone: "America/New_York",
        calendarIds: ["primary"]
      })
    ).toBeDefined();
    expect(() =>
      FreeBusyRequestSchema.parse({
        ...interval,
        timeZone: "America/New_York",
        calendarIds: ["work@example.test"]
      })
    ).toThrow();
  });

  it("requires a supported IANA timezone and an exclusive end", () => {
    expect(() =>
      FreeBusyRequestSchema.parse({
        ...interval,
        timeZone: "not/a-zone",
        calendarIds: ["primary"]
      })
    ).toThrow();
    expect(() =>
      FreeBusyRequestSchema.parse({
        startsAt: interval.startsAt,
        endsAt: interval.startsAt,
        timeZone: "UTC",
        calendarIds: ["primary"]
      })
    ).toThrow(/exclusive/u);
    expect(() =>
      FreeBusyRequestSchema.parse({
        startsAt: interval.endsAt,
        endsAt: interval.startsAt,
        timeZone: "UTC",
        calendarIds: ["primary"]
      })
    ).toThrow(/exclusive/u);
  });

  it("accepts valid IANA aliases through the canonical domain schema", () => {
    expect(IanaTimeZoneSchema.parse("US/Eastern")).toBe("US/Eastern");
    expect(IanaTimeZoneSchema.parse("GMT")).toBe("GMT");
    expect(
      FreeBusyRequestSchema.parse({
        ...interval,
        timeZone: "US/Eastern",
        calendarIds: ["primary"]
      }).timeZone
    ).toBe("US/Eastern");
  });

  it("rejects unknown boundary fields", () => {
    expect(() =>
      FreeBusyRequestSchema.parse({
        ...interval,
        timeZone: "UTC",
        calendarIds: ["primary"],
        eventDetails: true
      })
    ).toThrow();
  });

  it("accepts only normalized free/busy projections", () => {
    const result = {
      busyIntervals: [interval],
      calendarsChecked: ["primary"],
      checkedAt: "2026-11-01T12:00:00.000Z"
    } as const;
    expect(FreeBusyResultSchema.parse(result)).toEqual(result);
    expect(() => FreeBusyResultSchema.parse({ ...result, eventTitles: ["Private"] })).toThrow();
    expect(() => FreeBusyResultSchema.parse({ ...result, calendarsChecked: [] })).toThrow();
    expect(() =>
      FreeBusyResultSchema.parse({
        ...result,
        busyIntervals: [
          interval,
          {
            startsAt: "2026-11-02T15:30:00.000Z",
            endsAt: "2026-11-02T16:30:00.000Z"
          }
        ]
      })
    ).toThrow(/sorted and non-overlapping/u);
  });

  it("allows adjacent busy intervals and rejects out-of-order intervals", () => {
    const first = interval;
    const adjacent = {
      startsAt: interval.endsAt,
      endsAt: "2026-11-02T17:00:00.000Z"
    } as const;
    const base = {
      calendarsChecked: ["primary"],
      checkedAt: "2026-11-01T12:00:00.000Z"
    } as const;

    expect(
      FreeBusyResultSchema.parse({ ...base, busyIntervals: [first, adjacent] }).busyIntervals
    ).toHaveLength(2);
    expect(() => FreeBusyResultSchema.parse({ ...base, busyIntervals: [adjacent, first] })).toThrow(
      /sorted and non-overlapping/u
    );
  });

  it("enforces the bounded free/busy interval count", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const busyIntervals = Array.from({ length: 10_000 }, (_, index) => ({
      startsAt: new Date(start + index * 60_000).toISOString(),
      endsAt: new Date(start + (index + 1) * 60_000).toISOString()
    }));
    const result = {
      busyIntervals,
      calendarsChecked: ["primary"],
      checkedAt: "2025-12-31T12:00:00.000Z"
    } as const;

    expect(FreeBusyResultSchema.parse(result).busyIntervals).toHaveLength(10_000);
    expect(() =>
      FreeBusyResultSchema.parse({
        ...result,
        busyIntervals: [
          ...busyIntervals,
          {
            startsAt: new Date(start + 10_000 * 60_000).toISOString(),
            endsAt: new Date(start + 10_001 * 60_000).toISOString()
          }
        ]
      })
    ).toThrow();
  });

  it("requires the exact 40-character lowercase hex event digest", () => {
    expect(CalendarEventIdSchema.parse(eventId)).toBe(eventId);
    expect(() => CalendarEventIdSchema.parse(`vera${"0".repeat(39)}`)).toThrow();
    expect(() => CalendarEventIdSchema.parse(`vera${"0".repeat(41)}`)).toThrow();
    expect(() => CalendarEventIdSchema.parse(`vera${"A".repeat(40)}`)).toThrow();
    expect(() => CalendarEventIdSchema.parse(`vera${"g".repeat(40)}`)).toThrow();
    expect(() => CalendarEventIdSchema.parse("0".repeat(40))).toThrow();
  });

  it("rejects notification, attendee, conference, and visibility widening", () => {
    expect(InsertTentativeHoldRequestSchema.parse(safeHold)).toEqual(safeHold);
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        attendees: [{ email: "landlord@example.test" }]
      })
    ).toThrow();
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({ ...safeHold, sendUpdates: "all" })
    ).toThrow();
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({ ...safeHold, visibility: "public" })
    ).toThrow();
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({ ...safeHold, conferenceData: {} })
    ).toThrow();
  });

  it("requires a bounded unique reminder set and the exact marker in the description", () => {
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        remindersMinutesBeforeStart: [30, 30]
      })
    ).toThrow(/unique/u);
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        remindersMinutesBeforeStart: [5, 10, 15, 30, 60, 120]
      })
    ).toThrow();
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        description: "The marker is missing"
      })
    ).toThrow(/marker/u);
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        eventId: "veranot-a-digest"
      })
    ).toThrow(/SHA-256/u);
  });

  it("rejects blank text and unsafe C0 controls while permitting description tabs and lines", () => {
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        summary: "Tentative viewing —     "
      })
    ).toThrow(/visible short address/u);
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({ ...safeHold, summary: `${safeHold.summary}\n` })
    ).toThrow(/C0 controls/u);
    expect(() => InsertTentativeHoldRequestSchema.parse({ ...safeHold, location: "   " })).toThrow(
      /whitespace-only/u
    );
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({ ...safeHold, location: "12 Cedar\u0000St" })
    ).toThrow(/C0 controls/u);
    expect(
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        description: `Source:\tfixture\n${veraMarker}`
      }).description
    ).toBe(`Source:\tfixture\n${veraMarker}`);
    for (const unsafeControl of ["\u0000", "\u0007", "\u000b", "\r"] as const) {
      expect(() =>
        InsertTentativeHoldRequestSchema.parse({
          ...safeHold,
          description: `Source${unsafeControl}\n${veraMarker}`
        })
      ).toThrow(/no other C0 controls/u);
    }
  });

  it("enforces exact text and reminder maxima", () => {
    const summaryAtMaximum = `Tentative viewing — ${"A".repeat(512 - "Tentative viewing — ".length)}`;
    const locationAtMaximum = "L".repeat(1_024);
    const descriptionAtMaximum = `${veraMarker}\n${"D".repeat(8_192 - veraMarker.length - 1)}`;

    expect(CalendarSummarySchema.parse(summaryAtMaximum)).toHaveLength(512);
    expect(() => CalendarSummarySchema.parse(`${summaryAtMaximum}A`)).toThrow();
    expect(CalendarLocationSchema.parse(locationAtMaximum)).toHaveLength(1_024);
    expect(() => CalendarLocationSchema.parse(`${locationAtMaximum}L`)).toThrow();
    expect(CalendarDescriptionSchema.parse(descriptionAtMaximum)).toHaveLength(8_192);
    expect(() => CalendarDescriptionSchema.parse(`${descriptionAtMaximum}D`)).toThrow();
    expect(
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        remindersMinutesBeforeStart: [0, 15, 30, 60, 40_320]
      }).remindersMinutesBeforeStart
    ).toHaveLength(5);
    expect(() =>
      InsertTentativeHoldRequestSchema.parse({
        ...safeHold,
        remindersMinutesBeforeStart: [0, 5, 15, 30, 60, 120]
      })
    ).toThrow();
  });

  it("exposes only the exact-event lookup projection", () => {
    const lookupRequest = {
      calendarId: "primary",
      eventId: safeHold.eventId
    } as const;
    expect(GetTentativeHoldRequestSchema.parse(lookupRequest)).toEqual(lookupRequest);
    expect(CalendarHoldLookupSchema.parse({ exists: false })).toEqual({ exists: false });
    expect(
      CalendarHoldLookupSchema.parse({
        exists: true,
        eventId: safeHold.eventId,
        veraMarker: safeHold.veraMarker,
        ...interval,
        status: "tentative"
      })
    ).toBeDefined();
    expect(() =>
      CalendarHoldLookupSchema.parse({
        exists: true,
        eventId: safeHold.eventId,
        veraMarker: safeHold.veraMarker,
        ...interval,
        status: "tentative",
        description: "must not cross the provider boundary"
      })
    ).toThrow();
    expect(() =>
      CalendarHoldLookupSchema.parse({
        exists: false,
        eventId: safeHold.eventId
      })
    ).toThrow();
    expect(() =>
      CalendarHoldLookupSchema.parse({
        exists: true,
        eventId: safeHold.eventId,
        ...interval,
        status: "tentative"
      })
    ).toThrow();
  });

  it("validates the bounded inserted-hold projection", () => {
    const inserted = {
      eventId: safeHold.eventId,
      veraMarker: safeHold.veraMarker,
      ...interval,
      status: "tentative"
    } as const;
    expect(InsertedCalendarHoldSchema.parse(inserted)).toEqual(inserted);
    expect(() =>
      InsertedCalendarHoldSchema.parse({ ...inserted, htmlLink: "https://example.test" })
    ).toThrow();
  });
});
