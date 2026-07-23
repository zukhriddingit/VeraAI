import { IanaTimeZoneSchema, IsoDateTimeSchema } from "@vera/domain";
import { z } from "zod";

export { IanaTimeZoneSchema } from "@vera/domain";
export type { IanaTimeZone } from "@vera/domain";

const MAX_BUSY_INTERVALS = 10_000;
const MAX_REMINDERS = 5;
const TENTATIVE_VIEWING_SUMMARY_PREFIX = "Tentative viewing — ";
const C0_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F]/u;
const DESCRIPTION_UNSAFE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B-\u001F]/u;

function hasVisibleText(value: string): boolean {
  return value.trim().length > 0;
}

function doesNotContainC0ControlCharacters(value: string): boolean {
  return !C0_CONTROL_CHARACTER_PATTERN.test(value);
}

function containsOnlySafeDescriptionControls(value: string): boolean {
  return !DESCRIPTION_UNSAFE_CONTROL_CHARACTER_PATTERN.test(value);
}

const CalendarIntervalShape = {
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema
} as const;

function refineExclusiveEnd(
  value: { readonly startsAt: string; readonly endsAt: string },
  context: z.RefinementCtx
): void {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "endsAt must be later than startsAt because the end is exclusive."
    });
  }
}

export const CalendarIntervalSchema = z
  .strictObject(CalendarIntervalShape)
  .superRefine(refineExclusiveEnd);

export const PrimaryCalendarIdsSchema = z.tuple([z.literal("primary")]);

export const FreeBusyRequestSchema = z
  .strictObject({
    ...CalendarIntervalShape,
    timeZone: IanaTimeZoneSchema,
    calendarIds: PrimaryCalendarIdsSchema
  })
  .superRefine(refineExclusiveEnd);

export const FreeBusyIntervalSchema = CalendarIntervalSchema;

export const FreeBusyResultSchema = z
  .strictObject({
    busyIntervals: z.array(FreeBusyIntervalSchema).max(MAX_BUSY_INTERVALS),
    calendarsChecked: PrimaryCalendarIdsSchema,
    checkedAt: IsoDateTimeSchema
  })
  .superRefine((value, context) => {
    for (let index = 1; index < value.busyIntervals.length; index += 1) {
      const previous = value.busyIntervals[index - 1];
      const current = value.busyIntervals[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        Date.parse(current.startsAt) < Date.parse(previous.endsAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["busyIntervals", index],
          message: "Busy intervals must be sorted and non-overlapping."
        });
      }
    }
  });

export const CalendarEventIdSchema = z
  .string()
  .regex(
    /^vera[a-f0-9]{40}$/u,
    "Expected vera followed by exactly 40 lowercase SHA-256 hex characters."
  );

export const VeraHoldMarkerSchema = z
  .string()
  .max(170)
  .regex(/^VERA-HOLD:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u, "Expected an opaque Vera hold marker.");

export const CalendarEventStatusSchema = z.enum(["tentative", "confirmed", "cancelled"]);

export const GetTentativeHoldRequestSchema = z.strictObject({
  calendarId: z.literal("primary"),
  eventId: CalendarEventIdSchema
});

const ExistingCalendarHoldSchema = z
  .strictObject({
    exists: z.literal(true),
    eventId: CalendarEventIdSchema,
    veraMarker: VeraHoldMarkerSchema,
    ...CalendarIntervalShape,
    status: CalendarEventStatusSchema
  })
  .superRefine(refineExclusiveEnd);

const MissingCalendarHoldSchema = z.strictObject({
  exists: z.literal(false)
});

export const CalendarHoldLookupSchema = z.discriminatedUnion("exists", [
  MissingCalendarHoldSchema,
  ExistingCalendarHoldSchema
]);

export const CalendarReminderMinutesSchema = z.number().int().min(0).max(40_320);

export const CalendarRemindersSchema = z
  .array(CalendarReminderMinutesSchema)
  .max(MAX_REMINDERS)
  .superRefine((reminders, context) => {
    if (new Set(reminders).size !== reminders.length) {
      context.addIssue({
        code: "custom",
        message: "Calendar popup reminders must be unique."
      });
    }
  });

export const CalendarSummarySchema = z
  .string()
  .min(TENTATIVE_VIEWING_SUMMARY_PREFIX.length + 1)
  .max(512)
  .startsWith(TENTATIVE_VIEWING_SUMMARY_PREFIX)
  .refine(
    (value) => hasVisibleText(value.slice(TENTATIVE_VIEWING_SUMMARY_PREFIX.length)),
    "The tentative viewing summary must include a visible short address."
  )
  .refine(doesNotContainC0ControlCharacters, "Calendar summaries cannot contain C0 controls.");

export const CalendarLocationSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(hasVisibleText, "Calendar locations cannot be whitespace-only.")
  .refine(doesNotContainC0ControlCharacters, "Calendar locations cannot contain C0 controls.");

export const CalendarDescriptionSchema = z
  .string()
  .min(1)
  .max(8_192)
  .refine(hasVisibleText, "Calendar descriptions cannot be whitespace-only.")
  .refine(
    containsOnlySafeDescriptionControls,
    "Calendar descriptions may use tabs and line feeds, but no other C0 controls."
  );

export const InsertTentativeHoldRequestSchema = z
  .strictObject({
    calendarId: z.literal("primary"),
    eventId: CalendarEventIdSchema,
    veraMarker: VeraHoldMarkerSchema,
    summary: CalendarSummarySchema,
    location: CalendarLocationSchema,
    description: CalendarDescriptionSchema,
    ...CalendarIntervalShape,
    timeZone: IanaTimeZoneSchema,
    remindersMinutesBeforeStart: CalendarRemindersSchema,
    status: z.literal("tentative"),
    visibility: z.literal("private"),
    transparency: z.literal("opaque"),
    attendees: z.tuple([]),
    conferenceData: z.null(),
    sendUpdates: z.literal("none")
  })
  .superRefine((value, context) => {
    refineExclusiveEnd(value, context);
    if (!value.description.includes(value.veraMarker)) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "The description must contain the exact Vera hold marker."
      });
    }
  });

export const InsertedCalendarHoldSchema = z
  .strictObject({
    eventId: CalendarEventIdSchema,
    veraMarker: VeraHoldMarkerSchema,
    ...CalendarIntervalShape,
    status: z.literal("tentative")
  })
  .superRefine(refineExclusiveEnd);

export type CalendarInterval = z.infer<typeof CalendarIntervalSchema>;
export type FreeBusyRequest = z.infer<typeof FreeBusyRequestSchema>;
export type FreeBusyInterval = z.infer<typeof FreeBusyIntervalSchema>;
export type FreeBusyResult = z.infer<typeof FreeBusyResultSchema>;
export type GetTentativeHoldRequest = z.infer<typeof GetTentativeHoldRequestSchema>;
export type CalendarHoldLookup = z.infer<typeof CalendarHoldLookupSchema>;
export type InsertTentativeHoldRequest = z.infer<typeof InsertTentativeHoldRequestSchema>;
export type InsertedCalendarHold = z.infer<typeof InsertedCalendarHoldSchema>;

export interface CalendarClient {
  queryFreeBusy(input: FreeBusyRequest, signal?: AbortSignal): Promise<FreeBusyResult>;
  getTentativeHold(
    input: GetTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<CalendarHoldLookup>;
  insertTentativeHold(
    input: InsertTentativeHoldRequest,
    signal?: AbortSignal
  ): Promise<InsertedCalendarHold>;
}
