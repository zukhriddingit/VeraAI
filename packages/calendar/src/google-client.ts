import {
  CalendarEventStatusSchema,
  CalendarHoldLookupSchema,
  FreeBusyRequestSchema,
  FreeBusyResultSchema,
  GetTentativeHoldRequestSchema,
  InsertedCalendarHoldSchema,
  InsertTentativeHoldRequestSchema,
  VeraHoldMarkerSchema,
  type CalendarClient,
  type CalendarHoldLookup,
  type FreeBusyInterval,
  type FreeBusyRequest,
  type FreeBusyResult,
  type GetTentativeHoldRequest,
  type InsertedCalendarHold,
  type InsertTentativeHoldRequest
} from "./contracts.ts";
import { CalendarProviderError } from "./errors.ts";
import { google } from "googleapis";
import { z } from "zod";

const GOOGLE_EVENT_FIELDS = "id,status,description,start/dateTime,end/dateTime";
const MAX_TIMEOUT_MILLISECONDS = 30_000;
const VERA_MARKER_PATTERN = /VERA-HOLD:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}/gu;

export interface GoogleFreeBusyQuery {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly timeZone: string;
  readonly items: readonly [{ readonly id: "primary" }];
}

export interface GoogleEventGet {
  readonly calendarId: "primary";
  readonly eventId: string;
}

export interface GoogleEventInsert extends GoogleEventGet {
  readonly sendUpdates: "none";
  readonly requestBody: {
    readonly id: string;
    readonly summary: string;
    readonly location: string;
    readonly description: string;
    readonly status: "tentative";
    readonly visibility: "private";
    readonly transparency: "opaque";
    readonly start: { readonly dateTime: string; readonly timeZone: string };
    readonly end: { readonly dateTime: string; readonly timeZone: string };
    readonly reminders: {
      readonly useDefault: false;
      readonly overrides: readonly {
        readonly method: "popup";
        readonly minutes: number;
      }[];
    };
  };
}

export interface CalendarV3Transport {
  queryFreeBusy(input: GoogleFreeBusyQuery, signal: AbortSignal): Promise<unknown>;
  getEvent(input: GoogleEventGet, signal: AbortSignal): Promise<unknown>;
  insertEvent(input: GoogleEventInsert, signal: AbortSignal): Promise<unknown>;
}

export type GoogleCalendarAuth = InstanceType<typeof google.auth.OAuth2>;

export interface GoogleCalendarClientOptions {
  readonly auth?: GoogleCalendarAuth;
  readonly transport?: CalendarV3Transport;
  readonly timeoutMilliseconds: number;
  readonly clock?: () => string;
}

const GoogleBusyIntervalSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true })
  })
  .refine((interval) => Date.parse(interval.end) > Date.parse(interval.start), {
    message: "A provider busy interval must end after it starts.",
    path: ["end"]
  });

const GoogleCalendarErrorSchema = z.object({
  reason: z.string().max(160).optional()
});

const GoogleFreeBusyCalendarSchema = z.object({
  busy: z.array(GoogleBusyIntervalSchema).max(10_000).optional(),
  errors: z.array(GoogleCalendarErrorSchema).max(20).optional()
});

const GoogleFreeBusyResponseSchema = z.object({
  data: z.object({
    calendars: z.record(z.string(), GoogleFreeBusyCalendarSchema)
  })
});

const GoogleEventResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    description: z.string().max(8_192),
    status: CalendarEventStatusSchema,
    start: z.object({ dateTime: z.string().datetime({ offset: true }) }),
    end: z.object({ dateTime: z.string().datetime({ offset: true }) })
  })
});

const TimeoutMillisecondsSchema = z.number().int().min(1).max(MAX_TIMEOUT_MILLISECONDS);

function providerValidationError(httpStatus = 502): CalendarProviderError {
  return new CalendarProviderError("calendar_validation_failed", false, httpStatus);
}

function providerCollisionError(): CalendarProviderError {
  return new CalendarProviderError("calendar_conflict_detected", false, 409);
}

function unknownInsertOutcomeError(): CalendarProviderError {
  return new CalendarProviderError("calendar_unknown_insert_outcome", true, 503);
}

function parseBoundary<T>(schema: z.ZodType<T>, value: unknown, httpStatus: number): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw providerValidationError(httpStatus);
  }
  return result.data;
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    const directStatus = Reflect.get(error, "status");
    if (typeof directStatus === "number" && Number.isInteger(directStatus)) {
      return directStatus;
    }

    const response = Reflect.get(error, "response");
    if (typeof response === "object" && response !== null) {
      const responseStatus = Reflect.get(response, "status");
      if (typeof responseStatus === "number" && Number.isInteger(responseStatus)) {
        return responseStatus;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  try {
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function mapTransportError(error: unknown): CalendarProviderError {
  if (error instanceof CalendarProviderError) {
    return error;
  }

  const status = extractStatus(error);
  if (status === 401) {
    return new CalendarProviderError("calendar_auth_revoked", false, 401);
  }
  if (status === 403) {
    return new CalendarProviderError("calendar_permission_denied", false, 403);
  }
  if (status === 408) {
    return new CalendarProviderError("calendar_timeout", true, 408);
  }
  if (status === 409) {
    return providerCollisionError();
  }
  if (status === 429) {
    return new CalendarProviderError("calendar_rate_limited", true, 429);
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return new CalendarProviderError("calendar_transient_failure", true, status);
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return providerValidationError(status);
  }

  const code = extractErrorCode(error);
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new CalendarProviderError("calendar_timeout", true, 504);
  }

  return new CalendarProviderError("calendar_transient_failure", true, 503);
}

function isSafeFreeBusyRetry(error: CalendarProviderError): boolean {
  return (
    error.retryable &&
    (error.code === "calendar_transient_failure" ||
      error.code === "calendar_timeout" ||
      error.code === "calendar_rate_limited")
  );
}

function mapPerCalendarError(reasons: readonly (string | undefined)[]): CalendarProviderError {
  const normalized = reasons.map((reason) => reason?.toLowerCase() ?? "");
  if (normalized.some((reason) => reason.includes("ratelimit"))) {
    return new CalendarProviderError("calendar_rate_limited", true, 429);
  }
  if (
    normalized.some((reason) => reason.includes("forbidden") || reason.includes("permissiondenied"))
  ) {
    return new CalendarProviderError("calendar_permission_denied", false, 403);
  }
  return new CalendarProviderError("calendar_transient_failure", true, 503);
}

function normalizeBusyIntervals(
  intervals: readonly z.infer<typeof GoogleBusyIntervalSchema>[]
): FreeBusyInterval[] {
  const sorted = intervals
    .map((interval) => ({ startsAt: interval.start, endsAt: interval.end }))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const normalized: FreeBusyInterval[] = [];

  for (const interval of sorted) {
    const previous = normalized.at(-1);
    if (previous !== undefined && Date.parse(interval.startsAt) < Date.parse(previous.endsAt)) {
      if (Date.parse(interval.endsAt) > Date.parse(previous.endsAt)) {
        normalized[normalized.length - 1] = {
          startsAt: previous.startsAt,
          endsAt: interval.endsAt
        };
      }
      continue;
    }
    normalized.push(interval);
  }

  return normalized;
}

function projectFreeBusyResult(raw: unknown, checkedAt: string): FreeBusyResult {
  const response = parseBoundary(GoogleFreeBusyResponseSchema, raw, 502);
  const calendarKeys = Object.keys(response.data.calendars);
  if (calendarKeys.length !== 1 || calendarKeys[0] !== "primary") {
    throw providerValidationError();
  }

  const primary = response.data.calendars.primary;
  if (primary === undefined) {
    throw providerValidationError();
  }
  if ((primary.errors?.length ?? 0) > 0) {
    throw mapPerCalendarError(primary.errors?.map((error) => error.reason) ?? []);
  }
  if (primary.busy === undefined) {
    throw providerValidationError();
  }

  return parseBoundary(
    FreeBusyResultSchema,
    {
      busyIntervals: normalizeBusyIntervals(primary.busy),
      calendarsChecked: ["primary"],
      checkedAt
    },
    502
  );
}

function extractVeraMarker(description: string): string {
  const matches = description.match(VERA_MARKER_PATTERN) ?? [];
  const validMarkers = matches.filter(
    (candidate) => VeraHoldMarkerSchema.safeParse(candidate).success
  );
  if (validMarkers.length !== 1) {
    throw providerValidationError();
  }
  const marker = validMarkers[0];
  if (marker === undefined) {
    throw providerValidationError();
  }
  return marker;
}

function projectExistingEvent(raw: unknown): Exclude<CalendarHoldLookup, { exists: false }> {
  const response = parseBoundary(GoogleEventResponseSchema, raw, 502);
  return parseBoundary(
    CalendarHoldLookupSchema,
    {
      exists: true,
      eventId: response.data.id,
      veraMarker: extractVeraMarker(response.data.description),
      startsAt: response.data.start.dateTime,
      endsAt: response.data.end.dateTime,
      status: response.data.status
    },
    502
  ) as Exclude<CalendarHoldLookup, { exists: false }>;
}

function eventMatchesRequest(
  event: Exclude<CalendarHoldLookup, { exists: false }>,
  request: InsertTentativeHoldRequest
): boolean {
  return (
    event.eventId === request.eventId &&
    event.veraMarker === request.veraMarker &&
    Date.parse(event.startsAt) === Date.parse(request.startsAt) &&
    Date.parse(event.endsAt) === Date.parse(request.endsAt) &&
    event.status === "tentative"
  );
}

function insertedFromMatchingEvent(
  event: Exclude<CalendarHoldLookup, { exists: false }>,
  request: InsertTentativeHoldRequest
): InsertedCalendarHold {
  if (!eventMatchesRequest(event, request)) {
    throw providerCollisionError();
  }
  return parseBoundary(
    InsertedCalendarHoldSchema,
    {
      eventId: request.eventId,
      veraMarker: request.veraMarker,
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      status: "tentative"
    },
    502
  );
}

export function createGoogleCalendarV3Transport(auth: GoogleCalendarAuth): CalendarV3Transport {
  const calendar = google.calendar({ version: "v3", auth });

  return {
    async queryFreeBusy(input, signal) {
      return calendar.freebusy.query(
        {
          fields: "calendars",
          requestBody: {
            timeMin: input.timeMin,
            timeMax: input.timeMax,
            timeZone: input.timeZone,
            items: input.items.map((item) => ({ id: item.id }))
          }
        },
        { signal }
      );
    },
    async getEvent(input, signal) {
      return calendar.events.get(
        {
          calendarId: input.calendarId,
          eventId: input.eventId,
          fields: GOOGLE_EVENT_FIELDS
        },
        { signal }
      );
    },
    async insertEvent(input, signal) {
      return calendar.events.insert(
        {
          calendarId: input.calendarId,
          sendUpdates: input.sendUpdates,
          fields: GOOGLE_EVENT_FIELDS,
          requestBody: {
            id: input.requestBody.id,
            summary: input.requestBody.summary,
            location: input.requestBody.location,
            description: input.requestBody.description,
            status: input.requestBody.status,
            visibility: input.requestBody.visibility,
            transparency: input.requestBody.transparency,
            start: { ...input.requestBody.start },
            end: { ...input.requestBody.end },
            reminders: {
              useDefault: input.requestBody.reminders.useDefault,
              overrides: input.requestBody.reminders.overrides.map((reminder) => ({ ...reminder }))
            }
          }
        },
        { signal }
      );
    }
  };
}

export class GoogleCalendarClient implements CalendarClient {
  readonly #transport: CalendarV3Transport;
  readonly #timeoutMilliseconds: number;
  readonly #clock: () => string;

  constructor(options: GoogleCalendarClientOptions) {
    this.#timeoutMilliseconds = TimeoutMillisecondsSchema.parse(options.timeoutMilliseconds);
    this.#clock = options.clock ?? (() => new Date().toISOString());
    if (options.transport !== undefined) {
      this.#transport = options.transport;
      return;
    }
    if (options.auth === undefined) {
      throw providerValidationError(500);
    }
    this.#transport = createGoogleCalendarV3Transport(options.auth);
  }

  async queryFreeBusy(input: FreeBusyRequest, signal?: AbortSignal): Promise<FreeBusyResult> {
    const request = parseBoundary(FreeBusyRequestSchema, input, 400);
    const transportInput: GoogleFreeBusyQuery = {
      timeMin: request.startsAt,
      timeMax: request.endsAt,
      timeZone: request.timeZone,
      items: [{ id: "primary" }]
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.#runBounded(
          (attemptSignal) => this.#transport.queryFreeBusy(transportInput, attemptSignal),
          signal
        );
        return projectFreeBusyResult(raw, this.#clock());
      } catch (error) {
        const mapped = mapTransportError(error);
        if (attempt === 0 && isSafeFreeBusyRetry(mapped)) {
          continue;
        }
        throw mapped;
      }
    }

    throw new CalendarProviderError("calendar_transient_failure", true, 503);
  }

  async getTentativeHold(
    input: GetTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<CalendarHoldLookup> {
    const request = parseBoundary(GetTentativeHoldRequestSchema, input, 400);
    try {
      const raw = await this.#runBounded(
        (attemptSignal) => this.#transport.getEvent(request, attemptSignal),
        signal
      );
      const event = projectExistingEvent(raw);
      if (event.eventId !== request.eventId) {
        throw providerValidationError();
      }
      return event;
    } catch (error) {
      if (extractStatus(error) === 404) {
        return { exists: false };
      }
      throw mapTransportError(error);
    }
  }

  async insertTentativeHold(
    input: InsertTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<InsertedCalendarHold> {
    const request = parseBoundary(InsertTentativeHoldRequestSchema, input, 400);
    const lookupRequest: GetTentativeHoldRequest = {
      calendarId: "primary",
      eventId: request.eventId
    };
    const existing = await this.getTentativeHold(lookupRequest, signal);
    if (existing.exists) {
      return insertedFromMatchingEvent(existing, request);
    }

    const transportInput: GoogleEventInsert = {
      calendarId: "primary",
      eventId: request.eventId,
      sendUpdates: "none",
      requestBody: {
        id: request.eventId,
        summary: request.summary,
        location: request.location,
        description: request.description,
        status: "tentative",
        visibility: "private",
        transparency: "opaque",
        start: { dateTime: request.startsAt, timeZone: request.timeZone },
        end: { dateTime: request.endsAt, timeZone: request.timeZone },
        reminders: {
          useDefault: false,
          overrides: request.remindersMinutesBeforeStart.map((minutes) => ({
            method: "popup" as const,
            minutes
          }))
        }
      }
    };

    let raw: unknown;
    try {
      raw = await this.#runBounded(
        (attemptSignal) => this.#transport.insertEvent(transportInput, attemptSignal),
        signal
      );
    } catch (error) {
      const mapped = mapTransportError(error);
      if (
        mapped.httpStatus !== 409 &&
        mapped.code !== "calendar_timeout" &&
        mapped.code !== "calendar_rate_limited" &&
        mapped.code !== "calendar_transient_failure"
      ) {
        throw mapped;
      }
      return this.#resolveUnknownInsert(lookupRequest, request, signal);
    }

    try {
      return insertedFromMatchingEvent(projectExistingEvent(raw), request);
    } catch {
      return this.#resolveUnknownInsert(lookupRequest, request, signal);
    }
  }

  async #resolveUnknownInsert(
    lookupRequest: GetTentativeHoldRequest,
    request: InsertTentativeHoldRequest,
    signal: AbortSignal | undefined
  ): Promise<InsertedCalendarHold> {
    try {
      const existing = await this.getTentativeHold(lookupRequest, signal);
      if (!existing.exists) {
        throw unknownInsertOutcomeError();
      }
      return insertedFromMatchingEvent(existing, request);
    } catch (error) {
      if (error instanceof CalendarProviderError && error.code === "calendar_conflict_detected") {
        throw error;
      }
      throw unknownInsertOutcomeError();
    }
  }

  async #runBounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    callerSignal: AbortSignal | undefined
  ): Promise<T> {
    if (callerSignal?.aborted === true) {
      throw new CalendarProviderError("calendar_transient_failure", false, 499);
    }

    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", onCallerAbort);
        callback();
      };
      const onCallerAbort = (): void => {
        controller.abort();
        finish(() => reject(new CalendarProviderError("calendar_transient_failure", false, 499)));
      };
      const timeout = setTimeout(() => {
        controller.abort();
        finish(() => reject(new CalendarProviderError("calendar_timeout", true, 504)));
      }, this.#timeoutMilliseconds);

      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
      Promise.resolve()
        .then(() => operation(controller.signal))
        .then(
          (value) => finish(() => resolve(value)),
          (error: unknown) => finish(() => reject(error))
        );
    });
  }
}
