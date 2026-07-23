import { describe, expect, it } from "vitest";

import type { FreeBusyRequest, FreeBusyResult, InsertedCalendarHold } from "./contracts.ts";
import { CalendarProviderError } from "./errors.ts";
import { primaryRequest, safeInsert } from "./google-client.test-fixtures.ts";
import { MockCalendarClient } from "./mock-client.ts";

const freeBusyResult: FreeBusyResult = {
  busyIntervals: [
    {
      startsAt: "2026-11-02T17:00:00.000Z",
      endsAt: "2026-11-02T18:00:00.000Z"
    }
  ],
  calendarsChecked: ["primary"],
  checkedAt: "2026-07-21T15:00:00.000Z"
};

const insertedResult: InsertedCalendarHold = {
  eventId: safeInsert.eventId,
  veraMarker: safeInsert.veraMarker,
  startsAt: safeInsert.startsAt,
  endsAt: safeInsert.endsAt,
  status: "tentative"
};

describe("MockCalendarClient", () => {
  it("returns a validated scripted free/busy result and records the call", async () => {
    const client = new MockCalendarClient({ freeBusy: [freeBusyResult] });

    await expect(client.queryFreeBusy(primaryRequest)).resolves.toEqual(freeBusyResult);
    expect(client.freeBusyCalls).toEqual([primaryRequest]);
  });

  it("does not mutate the caller's immutable script", async () => {
    const outcomes = Object.freeze([freeBusyResult]);
    const client = new MockCalendarClient({ freeBusy: outcomes });
    await client.queryFreeBusy(primaryRequest);
    expect(outcomes).toHaveLength(1);
  });

  it("rejects an unscripted operation with a typed safe error", async () => {
    await expect(new MockCalendarClient().queryFreeBusy(primaryRequest)).rejects.toEqual(
      new CalendarProviderError("calendar_validation_failed", false, 500)
    );
  });

  it("validates inputs before recording or consuming a script", async () => {
    const client = new MockCalendarClient({ freeBusy: [freeBusyResult] });
    const invalid = {
      ...primaryRequest,
      calendarIds: ["private-calendar"]
    } as unknown as FreeBusyRequest;

    await expect(client.queryFreeBusy(invalid)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      httpStatus: 400
    });
    expect(client.freeBusyCalls).toHaveLength(0);
    await expect(client.queryFreeBusy(primaryRequest)).resolves.toEqual(freeBusyResult);
  });

  it("throws scripted typed failures without wrapping provider details", async () => {
    const failure = new CalendarProviderError("calendar_timeout", true, 504);
    const client = new MockCalendarClient({ freeBusy: [failure] });

    await expect(client.queryFreeBusy(primaryRequest)).rejects.toBe(failure);
  });

  it("stores an insertion and resolves an identical retry without consuming another script", async () => {
    const client = new MockCalendarClient({ inserts: [insertedResult] });

    await expect(client.insertTentativeHold(safeInsert)).resolves.toEqual(insertedResult);
    await expect(client.insertTentativeHold(safeInsert)).resolves.toEqual(insertedResult);
    expect(client.insertCalls).toHaveLength(2);
    expect(client.insertedHoldCount).toBe(1);
  });

  it("fails closed when the same event ID is reused for a changed request", async () => {
    const client = new MockCalendarClient({ inserts: [insertedResult] });
    await client.insertTentativeHold(safeInsert);

    await expect(
      client.insertTentativeHold({
        ...safeInsert,
        summary: "Tentative viewing — 99 Changed St"
      })
    ).rejects.toMatchObject({
      code: "calendar_conflict_detected",
      retryable: false,
      httpStatus: 409
    });
    expect(client.insertedHoldCount).toBe(1);
  });

  it("makes a stored insertion available through the bounded lookup projection", async () => {
    const client = new MockCalendarClient({ inserts: [insertedResult] });
    await client.insertTentativeHold(safeInsert);

    await expect(
      client.getTentativeHold({ calendarId: "primary", eventId: safeInsert.eventId })
    ).resolves.toEqual({
      exists: true,
      eventId: safeInsert.eventId,
      veraMarker: safeInsert.veraMarker,
      startsAt: safeInsert.startsAt,
      endsAt: safeInsert.endsAt,
      status: "tentative"
    });
  });

  it("enables idempotent no-network hold creation only in explicit deterministic demo mode", async () => {
    const strict = new MockCalendarClient();
    await expect(
      strict.getTentativeHold({ calendarId: "primary", eventId: safeInsert.eventId })
    ).rejects.toMatchObject({ code: "calendar_validation_failed" });
    await expect(strict.insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_validation_failed"
    });

    const demo = new MockCalendarClient({ deterministicHoldOperations: true });
    await expect(
      demo.getTentativeHold({ calendarId: "primary", eventId: safeInsert.eventId })
    ).resolves.toEqual({ exists: false });
    await expect(demo.insertTentativeHold(safeInsert)).resolves.toEqual(insertedResult);
    await expect(demo.insertTentativeHold(safeInsert)).resolves.toEqual(insertedResult);
    expect(demo.insertedHoldCount).toBe(1);
  });

  it("fails closed when a scripted lookup returns a different deterministic event ID", async () => {
    const client = new MockCalendarClient({
      lookups: [
        {
          exists: true,
          eventId: "vera1111111111111111111111111111111111111111",
          veraMarker: safeInsert.veraMarker,
          startsAt: safeInsert.startsAt,
          endsAt: safeInsert.endsAt,
          status: "tentative"
        }
      ]
    });

    await expect(
      client.getTentativeHold({ calendarId: "primary", eventId: safeInsert.eventId })
    ).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false,
      httpStatus: 500
    });
  });

  it("rejects an invalid scripted insert projection without storing it", async () => {
    const client = new MockCalendarClient({
      inserts: [{ ...insertedResult, eventId: "invalid" } as InsertedCalendarHold]
    });

    await expect(client.insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      httpStatus: 500
    });
    expect(client.insertedHoldCount).toBe(0);
  });

  it("honors cancellation before recording or consuming an operation", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new MockCalendarClient({ freeBusy: [freeBusyResult] });

    await expect(client.queryFreeBusy(primaryRequest, controller.signal)).rejects.toMatchObject({
      code: "calendar_transient_failure",
      retryable: false,
      httpStatus: 499
    });
    expect(client.freeBusyCalls).toHaveLength(0);
    await expect(client.queryFreeBusy(primaryRequest)).resolves.toEqual(freeBusyResult);
  });
});
