import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import {
  AvailabilityCheckStateSchema,
  CalendarHoldEffectPayloadSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ProposedViewingWindowSchema,
  Sha256Schema,
  VeraUserIdSchema,
  type AvailabilityCheckState,
  type CalendarHoldEffectPayload,
  type ProposedViewingWindow,
  type VeraUserId
} from "@vera/domain";

import {
  CalendarRemindersSchema,
  InsertTentativeHoldRequestSchema,
  type InsertTentativeHoldRequest
} from "./contracts.ts";

export { CalendarHoldEffectPayloadSchema };
export type { CalendarHoldEffectPayload };

const GOOGLE_EVENT_ID_PREFIX = "vera";
const GOOGLE_EVENT_ID_DIGEST_LENGTH = 40;
const HOLD_MARKER_PREFIX = "VERA-HOLD:";

export interface HoldPayloadInput {
  readonly holdId: string;
  readonly userId: VeraUserId;
  readonly viewingId: string;
  readonly shortAddress: string;
  readonly normalizedAddress: string;
  readonly canonicalListingUrl: string | null;
  readonly sourceUrls: readonly string[];
  readonly contactNotes: string | null;
  readonly selectedWindow: ProposedViewingWindow;
  readonly remindersMinutesBeforeStart: readonly number[];
  readonly finalCheckState: AvailabilityCheckState;
  readonly conflictCheckOverride: boolean;
  readonly conflictWarning: string | null;
}

export class CalendarHoldPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarHoldPayloadError";
  }
}

function canonicalValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CalendarHoldPayloadError(`Non-finite number at ${path}.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalValue(entry, `${path}[${String(index)}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CalendarHoldPayloadError(`Non-plain object at ${path}.`);
    }
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) {
        throw new CalendarHoldPayloadError(`Undefined value at ${path}.${key}.`);
      }
      result[key] = canonicalValue(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new CalendarHoldPayloadError(`Unsupported ${typeof value} value at ${path}.`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, "$"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validatedUserApprovedUrl(value: string): string {
  if (value !== value.trim()) {
    throw new CalendarHoldPayloadError("Calendar source URLs cannot contain surrounding space.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CalendarHoldPayloadError("Calendar source URLs must be absolute HTTP(S) URLs.");
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new CalendarHoldPayloadError(
      "Calendar source URLs must use HTTP(S) without credentials or fragments."
    );
  }

  return value;
}

function validateConflictWarning(
  finalCheckState: AvailabilityCheckState,
  conflictCheckOverride: boolean,
  conflictWarning: string | null
): void {
  if (finalCheckState === "checked") {
    if (conflictCheckOverride || conflictWarning !== null) {
      throw new CalendarHoldPayloadError(
        "A successful final Calendar check cannot carry an override or warning."
      );
    }
    return;
  }

  if (!conflictCheckOverride || conflictWarning === null || conflictWarning.trim().length === 0) {
    throw new CalendarHoldPayloadError(
      "Creating without a successful final Calendar check requires an explicit visible warning."
    );
  }
}

function buildDescription(input: {
  readonly canonicalListingUrl: string | null;
  readonly sourceUrls: readonly string[];
  readonly contactNotes: string | null;
  readonly veraMarker: string;
}): string {
  const lines: string[] = [];
  if (input.canonicalListingUrl !== null) {
    lines.push(`Listing: ${validatedUserApprovedUrl(input.canonicalListingUrl)}`);
  }
  for (const sourceUrl of input.sourceUrls) {
    lines.push(`Source: ${validatedUserApprovedUrl(sourceUrl)}`);
  }
  if (input.contactNotes !== null) {
    if (input.contactNotes.trim().length === 0) {
      throw new CalendarHoldPayloadError("Calendar contact notes cannot be whitespace-only.");
    }
    if (input.contactNotes.includes(HOLD_MARKER_PREFIX)) {
      throw new CalendarHoldPayloadError(
        "Calendar contact notes cannot contain Vera's reserved hold marker."
      );
    }
    lines.push(`Contact notes:\n${input.contactNotes}`);
  }
  lines.push(input.veraMarker);
  return lines.join("\n");
}

function providerRequestFromEffect(
  effect: CalendarHoldEffectPayload,
  eventId: string
): InsertTentativeHoldRequest {
  return InsertTentativeHoldRequestSchema.parse({
    calendarId: effect.calendarId,
    eventId,
    veraMarker: effect.veraMarker,
    summary: effect.title,
    location: effect.normalizedAddress,
    description: effect.description,
    startsAt: effect.startsAt,
    endsAt: effect.endsAt,
    timeZone: effect.timeZone,
    remindersMinutesBeforeStart: effect.remindersMinutesBeforeStart,
    status: effect.status,
    visibility: effect.visibility,
    transparency: effect.transparency,
    attendees: [],
    conferenceData: null,
    sendUpdates: effect.notifications
  });
}

export function buildCalendarHoldEffectPayload(input: HoldPayloadInput): CalendarHoldEffectPayload {
  EntityIdSchema.parse(input.holdId);
  VeraUserIdSchema.parse(input.userId);
  EntityIdSchema.parse(input.viewingId);
  const selectedWindow = ProposedViewingWindowSchema.parse(input.selectedWindow);
  const reminders = CalendarRemindersSchema.parse(input.remindersMinutesBeforeStart);
  const finalCheckState = AvailabilityCheckStateSchema.parse(input.finalCheckState);
  validateConflictWarning(finalCheckState, input.conflictCheckOverride, input.conflictWarning);

  const veraMarker = `${HOLD_MARKER_PREFIX}${input.holdId}`;
  const effect = {
    holdId: input.holdId,
    viewingId: input.viewingId,
    veraMarker,
    title: `Tentative viewing — ${input.shortAddress}`,
    normalizedAddress: input.normalizedAddress,
    description: buildDescription({
      canonicalListingUrl: input.canonicalListingUrl,
      sourceUrls: input.sourceUrls,
      contactNotes: input.contactNotes,
      veraMarker
    }),
    startsAt: Temporal.Instant.from(selectedWindow.startsAt).toString(),
    endsAt: Temporal.Instant.from(selectedWindow.endsAt).toString(),
    timeZone: selectedWindow.timeZone,
    remindersMinutesBeforeStart: reminders,
    calendarId: "primary",
    attendeeCount: 0,
    conferencing: false,
    notifications: "none",
    status: "tentative",
    visibility: "private",
    transparency: "opaque",
    finalCheckState,
    conflictCheckOverride: input.conflictCheckOverride,
    warning: input.conflictWarning
  };

  return CalendarHoldEffectPayloadSchema.parse(effect);
}

export function computeCalendarPayloadHash(payload: CalendarHoldEffectPayload): string {
  const effect = CalendarHoldEffectPayloadSchema.parse(payload);
  return Sha256Schema.parse(sha256(canonicalJson(effect)));
}

export function computeGoogleEventId(input: {
  readonly userId: VeraUserId;
  readonly viewingId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly payloadHash: string;
}): string {
  const identity = {
    userId: VeraUserIdSchema.parse(input.userId),
    viewingId: EntityIdSchema.parse(input.viewingId),
    startsAt: Temporal.Instant.from(IsoDateTimeSchema.parse(input.startsAt)).toString(),
    endsAt: Temporal.Instant.from(IsoDateTimeSchema.parse(input.endsAt)).toString(),
    payloadHash: Sha256Schema.parse(input.payloadHash)
  };
  if (Date.parse(identity.endsAt) <= Date.parse(identity.startsAt)) {
    throw new CalendarHoldPayloadError("A Google Calendar event must end after it starts.");
  }

  const digest = sha256(canonicalJson(identity)).slice(0, GOOGLE_EVENT_ID_DIGEST_LENGTH);
  return `${GOOGLE_EVENT_ID_PREFIX}${digest}`;
}

export function buildInsertTentativeHoldRequest(input: {
  readonly effect: CalendarHoldEffectPayload;
  readonly eventId: string;
}): InsertTentativeHoldRequest {
  return providerRequestFromEffect(
    CalendarHoldEffectPayloadSchema.parse(input.effect),
    input.eventId
  );
}
