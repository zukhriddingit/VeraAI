import { google } from "googleapis";
import { describe, expect, it } from "vitest";

import { CalendarProviderError } from "./errors.ts";
import {
  createGoogleCalendarV3Transport,
  GoogleCalendarClient,
  type CalendarV3Transport,
  type GoogleEventGet,
  type GoogleEventInsert
} from "./google-client.ts";
import {
  existingEventEnvelope,
  freeBusyEnvelope,
  googleTransport,
  primaryRequest,
  recordingGoogleTransport,
  safeInsert,
  ScriptedTransportError
} from "./google-client.test-fixtures.ts";

const fixedCheckedAt = "2026-07-21T15:00:00.000Z";

function clientWith(transport: CalendarV3Transport, timeoutMilliseconds = 2_000) {
  return new GoogleCalendarClient({
    transport,
    timeoutMilliseconds,
    clock: () => fixedCheckedAt
  });
}

describe("GoogleCalendarClient free/busy", () => {
  it("maps, sorts, and merges only primary-calendar busy intervals", async () => {
    const transport = googleTransport({
      freebusy: freeBusyEnvelope([
        { start: "2026-11-02T16:30:00.000Z", end: "2026-11-02T17:00:00.000Z" },
        { start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T16:00:00.000Z" },
        { start: "2026-11-02T15:30:00.000Z", end: "2026-11-02T16:30:00.000Z" }
      ])
    });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).resolves.toEqual({
      busyIntervals: [
        { startsAt: "2026-11-02T15:00:00.000Z", endsAt: "2026-11-02T16:30:00.000Z" },
        { startsAt: "2026-11-02T16:30:00.000Z", endsAt: "2026-11-02T17:00:00.000Z" }
      ],
      calendarsChecked: ["primary"],
      checkedAt: fixedCheckedAt
    });
    expect(transport.freeBusyCalls).toEqual([
      {
        timeMin: primaryRequest.startsAt,
        timeMax: primaryRequest.endsAt,
        timeZone: primaryRequest.timeZone,
        items: [{ id: "primary" }]
      }
    ]);
  });

  it("fails a per-calendar error closed after one safe retry", async () => {
    const response = {
      data: { calendars: { primary: { errors: [{ reason: "backendError" }] } } }
    };
    const transport = googleTransport({ freebusy: [response, response] });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).rejects.toMatchObject({
      code: "calendar_transient_failure",
      retryable: true
    });
    expect(transport.freeBusyCalls).toHaveLength(2);
  });

  it("retries one transient failure and then succeeds", async () => {
    const transport = googleTransport({
      freebusy: [new ScriptedTransportError(503), freeBusyEnvelope()]
    });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).resolves.toMatchObject({
      busyIntervals: [],
      calendarsChecked: ["primary"]
    });
    expect(transport.freeBusyCalls).toHaveLength(2);
  });

  it.each([
    [401, "calendar_auth_revoked", false, 1],
    [403, "calendar_permission_denied", false, 1],
    [429, "calendar_rate_limited", true, 2],
    [500, "calendar_transient_failure", true, 2]
  ] as const)(
    "maps status %i without exposing provider data",
    async (status, code, retryable, expectedCalls) => {
      const error = new ScriptedTransportError(status);
      const transport = googleTransport({
        freebusy: expectedCalls === 2 ? [error, error] : error
      });

      const caught = await clientWith(transport)
        .queryFreeBusy(primaryRequest)
        .catch((failure: unknown) => failure);
      expect(caught).toMatchObject({ code, retryable, httpStatus: status });
      expect(JSON.stringify(caught)).not.toContain("must-never-escape");
      expect(JSON.stringify(caught)).not.toContain("private provider response");
      expect(JSON.stringify(caught)).not.toContain("private event description");
      expect(transport.freeBusyCalls).toHaveLength(expectedCalls);
    }
  );

  it("times out bounded attempts instead of treating them as an empty calendar", async () => {
    const transport: CalendarV3Transport = {
      queryFreeBusy: () => new Promise(() => undefined),
      getEvent: () => Promise.reject(new Error("unused")),
      insertEvent: () => Promise.reject(new Error("unused"))
    };

    await expect(clientWith(transport, 5).queryFreeBusy(primaryRequest)).rejects.toMatchObject({
      code: "calendar_timeout",
      retryable: true,
      httpStatus: 504
    });
  });

  it("honors caller cancellation without retrying", async () => {
    let calls = 0;
    const transport: CalendarV3Transport = {
      queryFreeBusy: () => {
        calls += 1;
        return Promise.resolve(freeBusyEnvelope());
      },
      getEvent: () => Promise.reject(new Error("unused")),
      insertEvent: () => Promise.reject(new Error("unused"))
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      clientWith(transport).queryFreeBusy(primaryRequest, controller.signal)
    ).rejects.toMatchObject({
      code: "calendar_transient_failure",
      retryable: false,
      httpStatus: 499
    });
    expect(calls).toBe(0);
  });

  it("rejects malformed or partial provider responses without retrying", async () => {
    const transport = googleTransport({ freebusy: { data: { calendars: {} } } });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false
    });
    expect(transport.freeBusyCalls).toHaveLength(1);
  });

  it("does not interpret a missing primary busy array as an empty calendar", async () => {
    const transport = googleTransport({
      freebusy: { data: { calendars: { primary: {} } } }
    });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false
    });
    expect(transport.freeBusyCalls).toHaveLength(1);
  });

  it("rejects reversed provider intervals before sorting or merging", async () => {
    const transport = googleTransport({
      freebusy: freeBusyEnvelope([
        { start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T16:00:00.000Z" },
        { start: "2026-11-02T15:30:00.000Z", end: "2026-11-02T14:30:00.000Z" }
      ])
    });

    await expect(clientWith(transport).queryFreeBusy(primaryRequest)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false
    });
    expect(transport.freeBusyCalls).toHaveLength(1);
  });
});

describe("GoogleCalendarClient lookup and insertion", () => {
  it("maps a 404 lookup to the strict missing projection", async () => {
    const transport = googleTransport({ get: new ScriptedTransportError(404) });
    await expect(
      clientWith(transport).getTentativeHold({
        calendarId: "primary",
        eventId: safeInsert.eventId
      })
    ).resolves.toEqual({ exists: false });
  });

  it("projects only event identity, marker, interval, and status", async () => {
    const transport = googleTransport({
      get: existingEventEnvelope(safeInsert, {
        summary: "private title",
        attendees: [{ email: "private@example.test" }],
        location: "private location",
        htmlLink: "https://calendar.example.test/private"
      })
    });

    const result = await clientWith(transport).getTentativeHold({
      calendarId: "primary",
      eventId: safeInsert.eventId
    });
    expect(result).toEqual({
      exists: true,
      eventId: safeInsert.eventId,
      veraMarker: safeInsert.veraMarker,
      startsAt: safeInsert.startsAt,
      endsAt: safeInsert.endsAt,
      status: "tentative"
    });
    expect(result).not.toHaveProperty("summary");
    expect(result).not.toHaveProperty("attendees");
    expect(result).not.toHaveProperty("location");
  });

  it("fails closed when an exact event lacks one valid Vera marker", async () => {
    const transport = googleTransport({
      get: existingEventEnvelope(safeInsert, { description: "No Vera marker" })
    });
    await expect(
      clientWith(transport).getTentativeHold({
        calendarId: "primary",
        eventId: safeInsert.eventId
      })
    ).rejects.toMatchObject({ code: "calendar_validation_failed" });
  });

  it("fails closed when the provider returns a different deterministic event ID", async () => {
    const transport = googleTransport({
      get: existingEventEnvelope(safeInsert, {
        id: "vera1111111111111111111111111111111111111111"
      })
    });
    await expect(
      clientWith(transport).getTentativeHold({
        calendarId: "primary",
        eventId: safeInsert.eventId
      })
    ).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false
    });
  });

  it("fails closed when an event repeats its Vera marker", async () => {
    const transport = googleTransport({
      get: existingEventEnvelope(safeInsert, {
        description: `${safeInsert.veraMarker}\n${safeInsert.veraMarker}`
      })
    });
    await expect(
      clientWith(transport).getTentativeHold({
        calendarId: "primary",
        eventId: safeInsert.eventId
      })
    ).rejects.toMatchObject({ code: "calendar_validation_failed" });
  });

  it("looks up first, then inserts with no attendee, conference, or notifications", async () => {
    const transport = recordingGoogleTransport();
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).resolves.toEqual({
      eventId: safeInsert.eventId,
      veraMarker: safeInsert.veraMarker,
      startsAt: safeInsert.startsAt,
      endsAt: safeInsert.endsAt,
      status: "tentative"
    });

    expect(transport.getCalls).toHaveLength(1);
    expect(transport.insertCalls).toHaveLength(1);
    expect(transport.lastInsert).toMatchObject({
      calendarId: "primary",
      eventId: safeInsert.eventId,
      sendUpdates: "none",
      requestBody: {
        id: safeInsert.eventId,
        status: "tentative",
        visibility: "private",
        transparency: "opaque"
      }
    });
    expect(transport.lastInsert.requestBody).not.toHaveProperty("attendees");
    expect(transport.lastInsert.requestBody).not.toHaveProperty("conferenceData");
  });

  it("returns a matching pre-existing event without inserting", async () => {
    const transport = googleTransport({ get: existingEventEnvelope() });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).resolves.toMatchObject({
      eventId: safeInsert.eventId,
      veraMarker: safeInsert.veraMarker
    });
    expect(transport.insertCalls).toHaveLength(0);
  });

  it("fails a mismatched deterministic-ID collision without inserting", async () => {
    const transport = googleTransport({
      get: existingEventEnvelope(safeInsert, {
        description: "VERA-HOLD:different-hold"
      })
    });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_conflict_detected",
      retryable: false,
      httpStatus: 409
    });
    expect(transport.insertCalls).toHaveLength(0);
  });

  it.each([408, 409, 429, 503] as const)(
    "resolves an ambiguous status %i through one exact lookup",
    async (status) => {
      const transport = googleTransport({
        get: [new ScriptedTransportError(404), existingEventEnvelope()],
        insert: new ScriptedTransportError(status)
      });
      await expect(clientWith(transport).insertTentativeHold(safeInsert)).resolves.toMatchObject({
        eventId: safeInsert.eventId
      });
      expect(transport.insertCalls).toHaveLength(1);
      expect(transport.getCalls).toHaveLength(2);
    }
  );

  it("recovers a malformed insert response through the deterministic lookup", async () => {
    const transport = googleTransport({
      get: [new ScriptedTransportError(404), existingEventEnvelope()],
      insert: { data: {} }
    });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).resolves.toMatchObject({
      eventId: safeInsert.eventId
    });
    expect(transport.insertCalls).toHaveLength(1);
  });

  it("reports an unknown outcome when recovery finds no event and never retries insert", async () => {
    const transport = googleTransport({
      get: [new ScriptedTransportError(404), new ScriptedTransportError(404)],
      insert: new ScriptedTransportError(503)
    });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_unknown_insert_outcome",
      retryable: true
    });
    expect(transport.insertCalls).toHaveLength(1);
    expect(transport.getCalls).toHaveLength(2);
  });

  it("does not perform recovery reads for a definite authorization rejection", async () => {
    const transport = googleTransport({
      get: new ScriptedTransportError(404),
      insert: new ScriptedTransportError(401)
    });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_auth_revoked",
      retryable: false
    });
    expect(transport.insertCalls).toHaveLength(1);
    expect(transport.getCalls).toHaveLength(1);
  });

  it("does not perform recovery reads or retries for a definite request rejection", async () => {
    const transport = googleTransport({
      get: new ScriptedTransportError(404),
      insert: new ScriptedTransportError(400)
    });
    await expect(clientWith(transport).insertTentativeHold(safeInsert)).rejects.toMatchObject({
      code: "calendar_validation_failed",
      retryable: false,
      httpStatus: 400
    });
    expect(transport.insertCalls).toHaveLength(1);
    expect(transport.getCalls).toHaveLength(1);
  });
});

describe("official Calendar v3 transport boundary", () => {
  it("constructs only the three narrow operations without making a request", () => {
    const auth = new google.auth.OAuth2();
    const transport = createGoogleCalendarV3Transport(auth);

    expect(Object.keys(transport).sort()).toEqual(["getEvent", "insertEvent", "queryFreeBusy"]);
    expect(transport).not.toHaveProperty("listEvents");
    expect(transport).not.toHaveProperty("updateEvent");
    expect(transport).not.toHaveProperty("deleteEvent");
  });

  it("retains no raw provider payload in mapped errors", async () => {
    const transport: CalendarV3Transport = {
      queryFreeBusy: () => Promise.reject(new ScriptedTransportError(500)),
      getEvent: (_input: GoogleEventGet) => Promise.reject(new Error("unused")),
      insertEvent: (_input: GoogleEventInsert) => Promise.reject(new Error("unused"))
    };
    const caught = await clientWith(transport)
      .queryFreeBusy(primaryRequest)
      .catch((failure: unknown) => failure);

    expect(caught).toBeInstanceOf(CalendarProviderError);
    expect(caught).not.toHaveProperty("cause");
    expect(String(caught)).not.toContain("private provider failure");
    expect(JSON.stringify(caught)).not.toContain("must-never-escape");
  });

  it("maps hostile error getters without retaining their thrown content", async () => {
    const hostile = Object.create(null) as object;
    Object.defineProperty(hostile, "response", {
      get() {
        throw new Error("secret getter content");
      }
    });
    const transport: CalendarV3Transport = {
      queryFreeBusy: () => Promise.reject(hostile),
      getEvent: () => Promise.reject(new Error("unused")),
      insertEvent: () => Promise.reject(new Error("unused"))
    };
    const caught = await clientWith(transport)
      .queryFreeBusy(primaryRequest)
      .catch((failure: unknown) => failure);

    expect(caught).toMatchObject({ code: "calendar_transient_failure", retryable: true });
    expect(String(caught)).not.toContain("secret getter content");
  });
});
