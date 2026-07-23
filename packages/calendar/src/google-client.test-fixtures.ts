import type { FreeBusyRequest, InsertTentativeHoldRequest } from "./contracts.ts";
import type {
  CalendarV3Transport,
  GoogleEventGet,
  GoogleEventInsert,
  GoogleFreeBusyQuery
} from "./google-client.ts";

export const primaryRequest: FreeBusyRequest = {
  startsAt: "2026-11-02T14:00:00.000Z",
  endsAt: "2026-11-03T02:00:00.000Z",
  timeZone: "America/New_York",
  calendarIds: ["primary"]
};

export const safeInsert: InsertTentativeHoldRequest = {
  calendarId: "primary",
  eventId: "vera0000000000000000000000000000000000000000",
  veraMarker: "VERA-HOLD:hold-1",
  summary: "Tentative viewing — 12 Cedar St",
  location: "12 Cedar St, Boston, MA",
  description: "https://listing.example.test/12-cedar\nVERA-HOLD:hold-1",
  startsAt: "2026-11-02T15:00:00.000Z",
  endsAt: "2026-11-02T16:00:00.000Z",
  timeZone: "America/New_York",
  remindersMinutesBeforeStart: [30],
  status: "tentative",
  visibility: "private",
  transparency: "opaque",
  attendees: [],
  conferenceData: null,
  sendUpdates: "none"
};

export function freeBusyEnvelope(
  busy: readonly { readonly start: string; readonly end: string }[] = []
): unknown {
  return {
    data: {
      calendars: {
        primary: { busy: busy.map((interval) => ({ ...interval })) }
      }
    }
  };
}

export function existingEventEnvelope(
  input: InsertTentativeHoldRequest = safeInsert,
  overrides: Readonly<Record<string, unknown>> = {}
): unknown {
  return {
    data: {
      id: input.eventId,
      description: input.description,
      status: input.status,
      start: { dateTime: input.startsAt },
      end: { dateTime: input.endsAt },
      ...overrides
    }
  };
}

export class ScriptedTransportError extends Error {
  readonly response: { readonly status: number };
  readonly token = "must-never-escape";
  readonly body = "private provider response";
  readonly eventDescription = "private event description";

  constructor(status: number) {
    super("private provider failure");
    this.name = "ScriptedTransportError";
    this.response = { status };
  }
}

type TransportStep = unknown | Error;
type TransportScriptValue = TransportStep | readonly TransportStep[];

export interface GoogleTransportScript {
  readonly freebusy?: TransportScriptValue;
  readonly get?: TransportScriptValue;
  readonly insert?: TransportScriptValue;
}

function queue(value: TransportScriptValue | undefined): TransportStep[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function resolveStep(steps: TransportStep[]): Promise<unknown> {
  const step = steps.shift();
  if (step === undefined) {
    return Promise.reject(new Error("Unscripted test transport operation."));
  }
  return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
}

export class ScriptedCalendarV3Transport implements CalendarV3Transport {
  readonly #freebusySteps: TransportStep[];
  readonly #getSteps: TransportStep[];
  readonly #insertSteps: TransportStep[];
  readonly freeBusyCalls: GoogleFreeBusyQuery[] = [];
  readonly getCalls: GoogleEventGet[] = [];
  readonly insertCalls: GoogleEventInsert[] = [];

  constructor(script: GoogleTransportScript) {
    this.#freebusySteps = queue(script.freebusy);
    this.#getSteps = queue(script.get);
    this.#insertSteps = queue(script.insert);
  }

  get lastInsert(): GoogleEventInsert {
    const last = this.insertCalls.at(-1);
    if (last === undefined) {
      throw new Error("No insert has been recorded.");
    }
    return last;
  }

  async queryFreeBusy(input: GoogleFreeBusyQuery, _signal: AbortSignal): Promise<unknown> {
    this.freeBusyCalls.push(input);
    return resolveStep(this.#freebusySteps);
  }

  async getEvent(input: GoogleEventGet, _signal: AbortSignal): Promise<unknown> {
    this.getCalls.push(input);
    return resolveStep(this.#getSteps);
  }

  async insertEvent(input: GoogleEventInsert, _signal: AbortSignal): Promise<unknown> {
    this.insertCalls.push(input);
    return resolveStep(this.#insertSteps);
  }
}

export function googleTransport(script: GoogleTransportScript): ScriptedCalendarV3Transport {
  return new ScriptedCalendarV3Transport(script);
}

export function recordingGoogleTransport(): ScriptedCalendarV3Transport {
  return googleTransport({
    get: new ScriptedTransportError(404),
    insert: existingEventEnvelope()
  });
}
