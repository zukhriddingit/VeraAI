import type { z } from "zod";

import {
  CalendarHoldLookupSchema,
  FreeBusyRequestSchema,
  FreeBusyResultSchema,
  GetTentativeHoldRequestSchema,
  InsertedCalendarHoldSchema,
  InsertTentativeHoldRequestSchema,
  type CalendarClient,
  type CalendarHoldLookup,
  type FreeBusyRequest,
  type FreeBusyResult,
  type GetTentativeHoldRequest,
  type InsertedCalendarHold,
  type InsertTentativeHoldRequest
} from "./contracts.ts";
import { CalendarProviderError } from "./errors.ts";

type MockOutcome<T> = T | CalendarProviderError;

export interface MockCalendarClientScript {
  readonly freeBusy?: readonly MockOutcome<FreeBusyResult>[];
  readonly lookups?: readonly MockOutcome<CalendarHoldLookup>[];
  readonly inserts?: readonly MockOutcome<InsertedCalendarHold>[];
  /** Enables deterministic no-network hold lookup/insertion for the explicit demo runtime. */
  readonly deterministicHoldOperations?: boolean;
}

interface StoredMockHold {
  readonly request: InsertTentativeHoldRequest;
  readonly result: InsertedCalendarHold;
}

function validationError(httpStatus: number): CalendarProviderError {
  return new CalendarProviderError("calendar_validation_failed", false, httpStatus);
}

function parseBoundary<T>(schema: z.ZodType<T>, value: unknown, httpStatus: number): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(httpStatus);
  }
  return result.data;
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new CalendarProviderError("calendar_transient_failure", false, 499);
  }
}

function readScriptedOutcome<T>(outcomes: MockOutcome<T>[], schema: z.ZodType<T>): T {
  const outcome = outcomes.shift();
  if (outcome === undefined) {
    throw validationError(500);
  }
  if (outcome instanceof CalendarProviderError) {
    throw outcome;
  }
  return parseBoundary(schema, outcome, 500);
}

function insertedResultMatchesRequest(
  result: InsertedCalendarHold,
  request: InsertTentativeHoldRequest
): boolean {
  return (
    result.eventId === request.eventId &&
    result.veraMarker === request.veraMarker &&
    Date.parse(result.startsAt) === Date.parse(request.startsAt) &&
    Date.parse(result.endsAt) === Date.parse(request.endsAt) &&
    result.status === "tentative"
  );
}

export class MockCalendarClient implements CalendarClient {
  readonly #freeBusyOutcomes: MockOutcome<FreeBusyResult>[];
  readonly #lookupOutcomes: MockOutcome<CalendarHoldLookup>[];
  readonly #insertOutcomes: MockOutcome<InsertedCalendarHold>[];
  readonly #freeBusyCalls: FreeBusyRequest[] = [];
  readonly #lookupCalls: GetTentativeHoldRequest[] = [];
  readonly #insertCalls: InsertTentativeHoldRequest[] = [];
  readonly #storedHolds = new Map<string, StoredMockHold>();
  readonly #deterministicHoldOperations: boolean;

  constructor(script: MockCalendarClientScript = {}) {
    this.#freeBusyOutcomes = [...(script.freeBusy ?? [])];
    this.#lookupOutcomes = [...(script.lookups ?? [])];
    this.#insertOutcomes = [...(script.inserts ?? [])];
    this.#deterministicHoldOperations = script.deterministicHoldOperations ?? false;
  }

  get freeBusyCalls(): readonly FreeBusyRequest[] {
    return [...this.#freeBusyCalls];
  }

  get lookupCalls(): readonly GetTentativeHoldRequest[] {
    return [...this.#lookupCalls];
  }

  get insertCalls(): readonly InsertTentativeHoldRequest[] {
    return [...this.#insertCalls];
  }

  get insertedHoldCount(): number {
    return this.#storedHolds.size;
  }

  async queryFreeBusy(input: FreeBusyRequest, signal?: AbortSignal): Promise<FreeBusyResult> {
    ensureNotAborted(signal);
    const request = parseBoundary(FreeBusyRequestSchema, input, 400);
    this.#freeBusyCalls.push(request);
    return readScriptedOutcome(this.#freeBusyOutcomes, FreeBusyResultSchema);
  }

  async getTentativeHold(
    input: GetTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<CalendarHoldLookup> {
    ensureNotAborted(signal);
    const request = parseBoundary(GetTentativeHoldRequestSchema, input, 400);
    this.#lookupCalls.push(request);
    const stored = this.#storedHolds.get(request.eventId);
    if (stored !== undefined) {
      return parseBoundary(
        CalendarHoldLookupSchema,
        {
          exists: true,
          eventId: stored.result.eventId,
          veraMarker: stored.result.veraMarker,
          startsAt: stored.result.startsAt,
          endsAt: stored.result.endsAt,
          status: stored.result.status
        },
        500
      );
    }
    if (this.#lookupOutcomes.length === 0 && this.#deterministicHoldOperations) {
      return { exists: false };
    }
    const result = readScriptedOutcome(this.#lookupOutcomes, CalendarHoldLookupSchema);
    if (result.exists && result.eventId !== request.eventId) {
      throw validationError(500);
    }
    return result;
  }

  async insertTentativeHold(
    input: InsertTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<InsertedCalendarHold> {
    ensureNotAborted(signal);
    const request = parseBoundary(InsertTentativeHoldRequestSchema, input, 400);
    this.#insertCalls.push(request);
    const stored = this.#storedHolds.get(request.eventId);
    if (stored !== undefined) {
      if (JSON.stringify(stored.request) !== JSON.stringify(request)) {
        throw new CalendarProviderError("calendar_conflict_detected", false, 409);
      }
      return stored.result;
    }

    const result =
      this.#insertOutcomes.length === 0 && this.#deterministicHoldOperations
        ? InsertedCalendarHoldSchema.parse({
            eventId: request.eventId,
            veraMarker: request.veraMarker,
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            status: "tentative"
          })
        : readScriptedOutcome(this.#insertOutcomes, InsertedCalendarHoldSchema);
    if (!insertedResultMatchesRequest(result, request)) {
      throw validationError(500);
    }
    this.#storedHolds.set(request.eventId, { request, result });
    return result;
  }
}
