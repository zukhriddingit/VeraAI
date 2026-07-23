import { z } from "zod";

import {
  EncryptedCredentialEnvelopeSchema,
  IntegrationIdSchema,
  VeraUserIdSchema
} from "./identity.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const PRIMARY_GOOGLE_CALENDAR_ID = "primary" as const;
export const AVAILABILITY_GENERATOR_VERSION = "availability.v1" as const;
export const LEGACY_AVAILABILITY_GENERATOR_VERSION = "legacy.v0" as const;

export const IanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
      return true;
    } catch {
      return false;
    }
  }, "A valid IANA timezone is required.");

export const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const SafeReturnToSchema = z
  .string()
  .min(1)
  .max(2_048)
  .startsWith("/")
  .refine(
    (path) =>
      path === path.trim() &&
      !path.startsWith("//") &&
      !path.includes("\\") &&
      !/%(?:2f|5c)/iu.test(path) &&
      !/[\u0000-\u001f\u007f]/u.test(path),
    { message: "Return paths must remain on the Vera origin." }
  );

export const AvailabilityCheckStateSchema = z.enum([
  "checked",
  "scope_not_granted",
  "google_disconnected",
  "google_temporarily_unavailable",
  "stale",
  "vera_rules_only"
]);

export const AvailabilitySourceSchema = z.enum(["google_freebusy", "vera_rules_only"]);

export const CalendarCapabilitySchema = z.enum([
  "calendar_conflict_checking",
  "calendar_hold_creation"
]);

export const CalendarGoogleScopeSchema = z.enum([
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
]);

export const CalendarApprovalOperationSchema = z.enum([
  "calendar.hold.create",
  "calendar.hold.create_without_conflict_check"
]);

export const CalendarHoldStateSchema = z.enum([
  "approval_pending",
  "approved",
  "creating",
  "created",
  "retryable_failed",
  "permanently_failed",
  "cancelled_internal"
]);

const EmptyCalendarIdsSchema = z.tuple([]);
export const PrimaryCalendarIdsSchema = z.tuple([z.literal(PRIMARY_GOOGLE_CALENDAR_ID)]);
export const CalendarIdsSchema = z.union([EmptyCalendarIdsSchema, PrimaryCalendarIdsSchema]);

export const ReminderMinutesSchema = z
  .array(z.number().int().min(0).max(40_320))
  .max(5)
  .refine((reminders) => new Set(reminders).size === reminders.length, {
    message: "Calendar popup reminders must be unique."
  });

export const WeeklyAvailabilityIntervalSchema = z
  .object({
    startsAt: LocalTimeSchema,
    endsAt: LocalTimeSchema
  })
  .strict()
  .refine((interval) => interval.endsAt > interval.startsAt, {
    message: "A weekly availability interval must end after it starts.",
    path: ["endsAt"]
  });

export const WeeklyAvailabilityIntervalsSchema = z
  .object({
    "1": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "2": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "3": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "4": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "5": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "6": z.array(WeeklyAvailabilityIntervalSchema).max(24),
    "7": z.array(WeeklyAvailabilityIntervalSchema).max(24)
  })
  .strict()
  .superRefine((weeklyIntervals, context) => {
    for (const weekday of ["1", "2", "3", "4", "5", "6", "7"] as const) {
      const sorted = [...weeklyIntervals[weekday]].sort((left, right) =>
        left.startsAt.localeCompare(right.startsAt)
      );

      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous !== undefined && current !== undefined && current.startsAt < previous.endsAt) {
          context.addIssue({
            code: "custom",
            message: "Weekly availability intervals cannot overlap.",
            path: [weekday, index]
          });
        }
      }
    }
  });

function localMinutes(localTime: string): number {
  const [hours = "0", minutes = "0"] = localTime.split(":");
  return Number(hours) * 60 + Number(minutes);
}

const AvailabilityRuleValuesSchema = z
  .object({
    timeZone: IanaTimeZoneSchema,
    weeklyIntervals: WeeklyAvailabilityIntervalsSchema,
    durationMinutes: z.number().int().min(15).max(240),
    minimumNoticeMinutes: z.number().int().min(0).max(10_080),
    travelMinutes: z.number().int().min(0).max(240),
    bufferMinutes: z.number().int().min(0).max(240),
    remindersMinutesBeforeStart: ReminderMinutesSchema,
    conflictCheckingEnabled: z.boolean(),
    calendarIds: CalendarIdsSchema,
    schemaVersion: z.literal(1)
  })
  .strict()
  .superRefine((rules, context) => {
    const expectedCalendarIds = rules.conflictCheckingEnabled ? [PRIMARY_GOOGLE_CALENDAR_ID] : [];
    if (JSON.stringify(rules.calendarIds) !== JSON.stringify(expectedCalendarIds)) {
      context.addIssue({
        code: "custom",
        message:
          "Conflict checking uses only the primary Calendar; disabled checking uses no Calendar IDs.",
        path: ["calendarIds"]
      });
    }

    for (const weekday of ["1", "2", "3", "4", "5", "6", "7"] as const) {
      for (const [index, interval] of rules.weeklyIntervals[weekday].entries()) {
        if (
          localMinutes(interval.endsAt) - localMinutes(interval.startsAt) <
          rules.durationMinutes
        ) {
          context.addIssue({
            code: "custom",
            message: "Each availability interval must fit the configured viewing duration.",
            path: ["weeklyIntervals", weekday, index]
          });
        }
      }
    }
  });

export const AvailabilityRuleSnapshotSchema = AvailabilityRuleValuesSchema;

export const AvailabilityRuleSetSchema = z
  .object({
    id: EntityIdSchema,
    timeZone: IanaTimeZoneSchema,
    weeklyIntervals: WeeklyAvailabilityIntervalsSchema,
    durationMinutes: z.number().int().min(15).max(240),
    minimumNoticeMinutes: z.number().int().min(0).max(10_080),
    travelMinutes: z.number().int().min(0).max(240),
    bufferMinutes: z.number().int().min(0).max(240),
    remindersMinutesBeforeStart: ReminderMinutesSchema,
    conflictCheckingEnabled: z.boolean(),
    calendarIds: CalendarIdsSchema,
    schemaVersion: z.literal(1),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((rules, context) => {
    const valuesResult = AvailabilityRuleValuesSchema.safeParse({
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
    });
    if (!valuesResult.success) {
      for (const issue of valuesResult.error.issues) {
        context.addIssue({ ...issue, path: issue.path });
      }
    }
    if (Date.parse(rules.updatedAt) < Date.parse(rules.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Availability rules cannot be updated before they are created.",
        path: ["updatedAt"]
      });
    }
  });

const ProposedViewingWindowBaseSchema = z
  .object({
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    timeZone: IanaTimeZoneSchema,
    availabilitySource: AvailabilitySourceSchema,
    state: AvailabilityCheckStateSchema,
    availabilityCheckId: EntityIdSchema.nullable(),
    checkedAt: IsoDateTimeSchema.nullable(),
    calendarsChecked: CalendarIdsSchema,
    requiresConflictWarning: z.boolean(),
    rules: AvailabilityRuleSnapshotSchema,
    generatorVersion: z.enum([
      AVAILABILITY_GENERATOR_VERSION,
      LEGACY_AVAILABILITY_GENERATOR_VERSION
    ])
  })
  .strict();

export const ProposedViewingWindowSchema = ProposedViewingWindowBaseSchema.superRefine(
  (window, context) => {
    if (Date.parse(window.endsAt) <= Date.parse(window.startsAt)) {
      context.addIssue({
        code: "custom",
        message: "A proposed viewing window must end after it starts.",
        path: ["endsAt"]
      });
    }

    if (window.state === "checked") {
      if (
        window.availabilitySource !== "google_freebusy" ||
        window.availabilityCheckId === null ||
        window.checkedAt === null ||
        window.calendarsChecked.length !== 1 ||
        window.calendarsChecked[0] !== PRIMARY_GOOGLE_CALENDAR_ID ||
        window.requiresConflictWarning
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A checked window requires successful primary-Calendar provenance and no warning.",
          path: ["state"]
        });
      }
      return;
    }

    if (window.state === "stale") {
      if (
        window.availabilitySource !== "google_freebusy" ||
        window.availabilityCheckId === null ||
        window.checkedAt === null ||
        window.calendarsChecked.length !== 1 ||
        window.calendarsChecked[0] !== PRIMARY_GOOGLE_CALENDAR_ID ||
        !window.requiresConflictWarning
      ) {
        context.addIssue({
          code: "custom",
          message: "A stale window retains its primary-Calendar provenance and requires a warning.",
          path: ["state"]
        });
      }
      return;
    }

    if (
      window.availabilitySource !== "vera_rules_only" ||
      window.calendarsChecked.length !== 0 ||
      !window.requiresConflictWarning
    ) {
      context.addIssue({
        code: "custom",
        message: "A non-checked window must be visibly marked as Vera-rules-only.",
        path: ["state"]
      });
    }
  }
);

const SafeCalendarErrorCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/u);

export const AvailabilityCheckSchema = z
  .object({
    id: EntityIdSchema,
    availabilityRuleSetId: EntityIdSchema,
    integrationConnectionId: IntegrationIdSchema.nullable(),
    state: AvailabilityCheckStateSchema,
    rangeStartsAt: IsoDateTimeSchema,
    rangeEndsAt: IsoDateTimeSchema,
    calendarIdsAttempted: CalendarIdsSchema,
    calendarsChecked: CalendarIdsSchema,
    checkedAt: IsoDateTimeSchema.nullable(),
    responseHash: Sha256Schema.nullable(),
    busyIntervalCount: z.number().int().nonnegative().max(100_000).nullable(),
    safeProviderErrorCode: SafeCalendarErrorCodeSchema.nullable(),
    correlationId: EntityIdSchema,
    createdAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((check, context) => {
    if (check.state === "stale") {
      context.addIssue({
        code: "custom",
        message:
          "Stale is a read-time projection and cannot be persisted as an availability check.",
        path: ["state"]
      });
    }

    if (Date.parse(check.rangeEndsAt) <= Date.parse(check.rangeStartsAt)) {
      context.addIssue({
        code: "custom",
        message: "An availability-check range must end after it starts.",
        path: ["rangeEndsAt"]
      });
    }

    const carriesSuccessfulResult = check.state === "checked" || check.state === "stale";
    if (carriesSuccessfulResult) {
      if (
        check.calendarIdsAttempted.length !== 1 ||
        check.calendarsChecked.length !== 1 ||
        check.checkedAt === null ||
        check.responseHash === null ||
        check.busyIntervalCount === null ||
        check.safeProviderErrorCode !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Checked and stale checks require one complete primary-Calendar result.",
          path: ["state"]
        });
      }
    } else if (
      check.calendarsChecked.length !== 0 ||
      check.checkedAt !== null ||
      check.responseHash !== null ||
      check.busyIntervalCount !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "A degraded availability check cannot carry partial success metadata.",
        path: ["state"]
      });
    }

    if (
      ["scope_not_granted", "google_disconnected", "vera_rules_only"].includes(check.state) &&
      check.calendarIdsAttempted.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "No Calendar may be attempted when checking did not reach Google.",
        path: ["calendarIdsAttempted"]
      });
    }

    if (check.state === "google_temporarily_unavailable" && check.safeProviderErrorCode === null) {
      context.addIssue({
        code: "custom",
        message: "A temporary Google failure requires a safe error code.",
        path: ["safeProviderErrorCode"]
      });
    }

    if (
      check.state !== "google_temporarily_unavailable" &&
      !carriesSuccessfulResult &&
      check.safeProviderErrorCode !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a provider failure may carry a provider error code.",
        path: ["safeProviderErrorCode"]
      });
    }
  });

export const CalendarOAuthStateSchema = z
  .object({
    id: IntegrationIdSchema,
    userId: VeraUserIdSchema,
    stateHash: Sha256Schema,
    capability: CalendarCapabilitySchema,
    requestedCalendarScopes: z.tuple([CalendarGoogleScopeSchema]),
    encryptedPkceVerifier: EncryptedCredentialEnvelopeSchema,
    redirectUriHash: Sha256Schema,
    returnTo: SafeReturnToSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    consumedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((state, context) => {
    const expectedScope =
      state.capability === "calendar_conflict_checking"
        ? "https://www.googleapis.com/auth/calendar.freebusy"
        : "https://www.googleapis.com/auth/calendar.events.owned";
    if (state.requestedCalendarScopes[0] !== expectedScope) {
      context.addIssue({
        code: "custom",
        message: "The requested Calendar scope must match the incremental capability.",
        path: ["requestedCalendarScopes"]
      });
    }
    if (Date.parse(state.expiresAt) <= Date.parse(state.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "OAuth state expiry must follow creation.",
        path: ["expiresAt"]
      });
    }
    if (state.consumedAt !== null && Date.parse(state.consumedAt) < Date.parse(state.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "OAuth state cannot be consumed before it is created.",
        path: ["consumedAt"]
      });
    }
  });

const CalendarHoldOverrideReasonSchema = z.enum([
  "scope_not_granted",
  "google_disconnected",
  "google_temporarily_unavailable",
  "stale",
  "vera_rules_only"
]);

export const CalendarHoldSchema = z
  .object({
    id: EntityIdSchema,
    viewingId: EntityIdSchema,
    approvalId: EntityIdSchema.nullable(),
    availabilityCheckId: EntityIdSchema.nullable(),
    payloadHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    googleEventId: z.string().regex(/^vera[a-f0-9]{40}$/u),
    providerEventReference: z.string().trim().min(1).max(300).nullable(),
    state: CalendarHoldStateSchema,
    conflictCheckOverride: z.boolean(),
    conflictCheckOverrideReason: CalendarHoldOverrideReasonSchema.nullable(),
    safeErrorCode: SafeCalendarErrorCodeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((hold, context) => {
    if (Date.parse(hold.updatedAt) < Date.parse(hold.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "A Calendar hold cannot be updated before it is created.",
        path: ["updatedAt"]
      });
    }

    if (hold.conflictCheckOverride !== (hold.conflictCheckOverrideReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "A conflict-check override requires its visible availability reason.",
        path: ["conflictCheckOverrideReason"]
      });
    }

    const approvalMayBeMissing =
      hold.state === "approval_pending" || hold.state === "cancelled_internal";
    if (!approvalMayBeMissing && hold.approvalId === null) {
      context.addIssue({
        code: "custom",
        message: "A reserved approval-pending hold has no approval; later states require one.",
        path: ["approvalId"]
      });
    }
    if (hold.state === "approval_pending" && hold.approvalId !== null) {
      context.addIssue({
        code: "custom",
        message: "A reserved approval-pending hold cannot already reference an approval.",
        path: ["approvalId"]
      });
    }
    if (
      hold.state === "cancelled_internal" &&
      hold.approvalId === null &&
      hold.providerEventReference !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "An unapproved cancelled reservation cannot reference an external event.",
        path: ["providerEventReference"]
      });
    }

    const failed = hold.state === "retryable_failed" || hold.state === "permanently_failed";
    if (failed !== (hold.safeErrorCode !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only failed Calendar holds carry a safe error code.",
        path: ["safeErrorCode"]
      });
    }

    const terminal = ["created", "permanently_failed", "cancelled_internal"].includes(hold.state);
    if (terminal !== (hold.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Terminal Calendar holds require a completion time.",
        path: ["completedAt"]
      });
    }

    if (
      hold.completedAt !== null &&
      (Date.parse(hold.completedAt) < Date.parse(hold.createdAt) ||
        Date.parse(hold.completedAt) > Date.parse(hold.updatedAt))
    ) {
      context.addIssue({
        code: "custom",
        message: "Hold completion must occur between creation and the latest update.",
        path: ["completedAt"]
      });
    }

    const providerReferenceRequired = hold.state === "created";
    const providerReferenceForbidden = [
      "approval_pending",
      "approved",
      "creating",
      "retryable_failed",
      "permanently_failed"
    ].includes(hold.state);
    if (
      (providerReferenceRequired && hold.providerEventReference === null) ||
      (providerReferenceForbidden && hold.providerEventReference !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Created holds require a provider reference; internally cancelled holds may preserve it for manual cleanup.",
        path: ["providerEventReference"]
      });
    }
  });

export type AvailabilityCheckState = z.infer<typeof AvailabilityCheckStateSchema>;
export type AvailabilitySource = z.infer<typeof AvailabilitySourceSchema>;
export type CalendarCapability = z.infer<typeof CalendarCapabilitySchema>;
export type CalendarGoogleScope = z.infer<typeof CalendarGoogleScopeSchema>;
export type CalendarApprovalOperation = z.infer<typeof CalendarApprovalOperationSchema>;
export type CalendarHoldState = z.infer<typeof CalendarHoldStateSchema>;
export type IanaTimeZone = z.infer<typeof IanaTimeZoneSchema>;
export type LocalTime = z.infer<typeof LocalTimeSchema>;
export type WeeklyAvailabilityInterval = z.infer<typeof WeeklyAvailabilityIntervalSchema>;
export type WeeklyAvailabilityIntervals = z.infer<typeof WeeklyAvailabilityIntervalsSchema>;
export type AvailabilityRuleSnapshot = z.infer<typeof AvailabilityRuleSnapshotSchema>;
export type AvailabilityRuleSet = z.infer<typeof AvailabilityRuleSetSchema>;
export type ProposedViewingWindow = z.infer<typeof ProposedViewingWindowSchema>;
export type AvailabilityCheck = z.infer<typeof AvailabilityCheckSchema>;
export type CalendarOAuthState = z.infer<typeof CalendarOAuthStateSchema>;
export type CalendarHold = z.infer<typeof CalendarHoldSchema>;
