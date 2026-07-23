import { z } from "zod";

import {
  AvailabilityCheckSchema,
  AvailabilityCheckStateSchema,
  AvailabilityRuleSetSchema,
  AvailabilityRuleSnapshotSchema,
  CalendarCapabilitySchema,
  CalendarHoldSchema,
  IanaTimeZoneSchema,
  PRIMARY_GOOGLE_CALENDAR_ID,
  ProposedViewingWindowSchema,
  ReminderMinutesSchema,
  SafeReturnToSchema
} from "./calendar.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";
import { ApprovalSchema, ViewingSchema } from "./workflows.ts";

const EffectTitleSchema = z
  .string()
  .min(1)
  .max(300)
  .startsWith("Tentative viewing — ")
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Calendar titles cannot contain control characters or surrounding whitespace."
  });

const EffectAddressSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), {
    message: "Calendar addresses cannot contain control characters or surrounding whitespace."
  });

const EffectDescriptionSchema = z
  .string()
  .min(1)
  .max(8_192)
  .refine((value) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value), {
    message: "Calendar descriptions may contain tabs and line feeds but no other controls."
  });

const CalendarHoldEffectPayloadFields = {
  holdId: EntityIdSchema,
  viewingId: EntityIdSchema,
  veraMarker: z.string().trim().min(1).max(220),
  title: EffectTitleSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  timeZone: IanaTimeZoneSchema,
  normalizedAddress: EffectAddressSchema,
  description: EffectDescriptionSchema,
  remindersMinutesBeforeStart: ReminderMinutesSchema,
  calendarId: z.literal(PRIMARY_GOOGLE_CALENDAR_ID),
  attendeeCount: z.literal(0),
  conferencing: z.literal(false),
  notifications: z.literal("none"),
  status: z.literal("tentative"),
  visibility: z.literal("private"),
  transparency: z.literal("opaque"),
  finalCheckState: AvailabilityCheckStateSchema,
  conflictCheckOverride: z.boolean(),
  warning: z.string().trim().min(1).max(1_000).nullable()
} as const;

/**
 * The approval hash binds to this exact user-visible effect. Provider-only derived
 * fields such as the deterministic Google event ID are intentionally excluded.
 */
export const CalendarHoldEffectPayloadSchema = z
  .object(CalendarHoldEffectPayloadFields)
  .strict()
  .superRefine((payload, context) => {
    if (Date.parse(payload.endsAt) <= Date.parse(payload.startsAt)) {
      context.addIssue({
        code: "custom",
        message: "A Calendar hold must end after it starts.",
        path: ["endsAt"]
      });
    }
    if (payload.veraMarker !== `VERA-HOLD:${payload.holdId}`) {
      context.addIssue({
        code: "custom",
        message: "The Vera marker must be bound to the reserved hold ID.",
        path: ["veraMarker"]
      });
    }
    if (!payload.description.includes(payload.veraMarker)) {
      context.addIssue({
        code: "custom",
        message: "The Calendar description must contain the exact Vera hold marker.",
        path: ["description"]
      });
    }
    if ((payload.finalCheckState === "checked") !== (payload.warning === null)) {
      context.addIssue({
        code: "custom",
        message: "Every non-checked final state requires a visible warning.",
        path: ["warning"]
      });
    }
    if (payload.conflictCheckOverride !== (payload.finalCheckState !== "checked")) {
      context.addIssue({
        code: "custom",
        message:
          "A successful final check cannot be overridden, and every failed final check requires an explicit override.",
        path: ["conflictCheckOverride"]
      });
    }
  });

export const CalendarHoldApprovalPreviewSchema = z
  .object({
    ...CalendarHoldEffectPayloadFields,
    localTimeLabel: z.string().trim().min(1).max(300),
    offsetLabel: z.string().trim().min(1).max(120),
    payloadHash: Sha256Schema
  })
  .strict()
  .superRefine((preview, context) => {
    const effectResult = CalendarHoldEffectPayloadSchema.safeParse({
      holdId: preview.holdId,
      viewingId: preview.viewingId,
      veraMarker: preview.veraMarker,
      title: preview.title,
      startsAt: preview.startsAt,
      endsAt: preview.endsAt,
      timeZone: preview.timeZone,
      normalizedAddress: preview.normalizedAddress,
      description: preview.description,
      remindersMinutesBeforeStart: preview.remindersMinutesBeforeStart,
      calendarId: preview.calendarId,
      attendeeCount: preview.attendeeCount,
      conferencing: preview.conferencing,
      notifications: preview.notifications,
      status: preview.status,
      visibility: preview.visibility,
      transparency: preview.transparency,
      finalCheckState: preview.finalCheckState,
      conflictCheckOverride: preview.conflictCheckOverride,
      warning: preview.warning
    });
    if (!effectResult.success) {
      for (const issue of effectResult.error.issues) {
        context.addIssue({ ...issue, path: issue.path });
      }
    }
  });

export const CalendarRecoveryActionSchema = z.enum([
  "none",
  "connect",
  "reconnect",
  "retry",
  "continue_with_warning",
  "choose_replacement"
]);

export const CalendarRecoverySchema = z
  .object({
    action: CalendarRecoveryActionSchema,
    message: z.string().trim().min(1).max(1_000),
    authorizationCapability: CalendarCapabilitySchema.nullable()
  })
  .strict();

export const GetAvailabilityRulesResponseSchema = z
  .object({
    rules: AvailabilityRuleSetSchema.nullable(),
    generatedAt: IsoDateTimeSchema
  })
  .strict();

export const PutAvailabilityRulesRequestSchema = AvailabilityRuleSnapshotSchema;

export const PutAvailabilityRulesResponseSchema = z
  .object({ rules: AvailabilityRuleSetSchema })
  .strict();

export const CalendarCapabilityAuthorizationRequestSchema = z
  .object({
    capability: CalendarCapabilitySchema,
    returnTo: SafeReturnToSchema
  })
  .strict();

export const CalendarCapabilityAuthorizationResponseSchema = z
  .object({ authorizationUrl: z.url().max(4_096) })
  .strict();

export const CalendarCapabilityGrantStateSchema = z.enum([
  "granted",
  "missing",
  "expired",
  "revoked",
  "disconnected",
  "unconfigured"
]);

export const CalendarCapabilityStatusSchema = z
  .object({
    capability: CalendarCapabilitySchema,
    state: CalendarCapabilityGrantStateSchema,
    accountEmail: z.email().max(320).nullable(),
    lastSuccessfulUseAt: IsoDateTimeSchema.nullable()
  })
  .strict();

export const CalendarIntegrationStatusResponseSchema = z
  .object({
    conflictChecking: CalendarCapabilityStatusSchema,
    holdCreation: CalendarCapabilityStatusSchema,
    primaryCalendarOnly: z.literal(true),
    generatedAt: IsoDateTimeSchema
  })
  .strict();

export const CreateViewingProposalsRequestSchema = z.object({}).strict();

export const CreateViewingProposalsResponseSchema = z
  .object({
    state: AvailabilityCheckStateSchema,
    calendarsChecked: z.union([z.tuple([]), z.tuple([z.literal("primary")])]),
    checkedAt: IsoDateTimeSchema.nullable(),
    availabilityCheck: AvailabilityCheckSchema,
    viewing: ViewingSchema,
    windows: z.array(ProposedViewingWindowSchema).max(3),
    recovery: CalendarRecoverySchema
  })
  .strict()
  .superRefine((response, context) => {
    const persistedCheckState = response.state === "stale" ? "checked" : response.state;
    if (
      persistedCheckState !== response.availabilityCheck.state ||
      JSON.stringify(response.calendarsChecked) !==
        JSON.stringify(response.availabilityCheck.calendarsChecked) ||
      response.checkedAt !== response.availabilityCheck.checkedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Top-level proposal provenance must exactly match its availability check.",
        path: ["state"]
      });
    }
    if (
      response.viewing.state !== "proposed" ||
      JSON.stringify(response.windows) !== JSON.stringify(response.viewing.proposedWindows)
    ) {
      context.addIssue({
        code: "custom",
        message: "Response windows must exactly match the persisted proposed Viewing.",
        path: ["windows"]
      });
    }

    for (const [index, window] of response.windows.entries()) {
      if (
        window.state !== response.state ||
        window.availabilityCheckId !== response.availabilityCheck.id ||
        window.checkedAt !== response.availabilityCheck.checkedAt ||
        JSON.stringify(window.calendarsChecked) !==
          JSON.stringify(response.availabilityCheck.calendarsChecked)
      ) {
        context.addIssue({
          code: "custom",
          message: "Every proposed window must carry the exact persisted check provenance.",
          path: ["windows", index]
        });
      }
    }

    if (
      (response.state === "checked" && response.recovery.action !== "none") ||
      (response.state !== "checked" && response.recovery.action === "none")
    ) {
      context.addIssue({
        code: "custom",
        message: "Degraded proposal responses require a visible recovery action.",
        path: ["recovery", "action"]
      });
    }
  });

export const SelectViewingWindowRequestSchema = z
  .object({
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema
  })
  .strict()
  .refine((interval) => Date.parse(interval.endsAt) > Date.parse(interval.startsAt), {
    message: "A selected viewing window must end after it starts.",
    path: ["endsAt"]
  });

export const SelectViewingWindowResponseSchema = z.object({ viewing: ViewingSchema }).strict();

export const CreateCalendarHoldPreviewRequestSchema = z
  .object({
    contactNotes: z.string().trim().min(1).max(5_000).nullable(),
    remindersMinutesBeforeStart: ReminderMinutesSchema
  })
  .strict();

export const CalendarHoldPreviewResponseSchema = z
  .object({
    hold: CalendarHoldSchema,
    preview: CalendarHoldApprovalPreviewSchema
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.hold.id !== response.preview.holdId ||
      response.hold.viewingId !== response.preview.viewingId ||
      response.hold.payloadHash !== response.preview.payloadHash ||
      response.hold.state !== "approval_pending"
    ) {
      context.addIssue({
        code: "custom",
        message: "The preview must be bound to its reserved approval-pending hold.",
        path: ["hold"]
      });
    }
  });

export const ApproveCalendarHoldRequestSchema = z
  .object({
    holdId: EntityIdSchema,
    expectedPayloadHash: Sha256Schema
  })
  .strict();

export const ApproveCalendarHoldResponseSchema = z
  .object({
    approval: ApprovalSchema,
    hold: CalendarHoldSchema
  })
  .strict()
  .superRefine((response, context) => {
    const expectedOperation = response.hold.conflictCheckOverride
      ? "calendar.hold.create_without_conflict_check"
      : "calendar.hold.create";
    if (
      response.approval.state !== "pending" ||
      response.hold.state !== "approved" ||
      response.hold.approvalId !== response.approval.id ||
      response.approval.targetType !== "calendar_hold" ||
      response.approval.targetId !== response.hold.id ||
      response.approval.payloadHash !== response.hold.payloadHash ||
      response.approval.operation !== expectedOperation
    ) {
      context.addIssue({
        code: "custom",
        message: "Approval and approved hold must be bound to the same exact Calendar effect.",
        path: ["approval"]
      });
    }
  });

export const CreateApprovedCalendarHoldRequestSchema = z
  .object({
    approvalId: EntityIdSchema,
    expectedPayloadHash: Sha256Schema,
    conflictCheckOverride: z.boolean(),
    correlationId: EntityIdSchema
  })
  .strict();

export const CalendarHoldCreatedResponseSchema = z
  .object({
    kind: z.literal("created"),
    hold: CalendarHoldSchema,
    duplicate: z.boolean()
  })
  .strict()
  .refine((response) => response.hold.state === "created", {
    message: "A created response requires a created Calendar hold.",
    path: ["hold", "state"]
  });

export const CalendarHoldConflictResponseSchema = z
  .object({
    kind: z.literal("conflict_detected"),
    replacementViewingId: EntityIdSchema,
    replacementWindows: z.array(ProposedViewingWindowSchema).max(3),
    recovery: CalendarRecoverySchema
  })
  .strict()
  .refine((response) => response.recovery.action === "choose_replacement", {
    message: "A detected conflict must offer replacement windows.",
    path: ["recovery", "action"]
  });

export const CalendarHoldConfirmationRequiredResponseSchema = z
  .object({
    kind: z.literal("confirmation_required"),
    overridePreview: CalendarHoldApprovalPreviewSchema,
    recovery: CalendarRecoverySchema
  })
  .strict()
  .refine(
    (response) =>
      response.overridePreview.conflictCheckOverride &&
      response.overridePreview.finalCheckState !== "checked" &&
      response.recovery.action === "continue_with_warning",
    {
      message: "Confirmation requires an explicit warned override preview.",
      path: ["overridePreview"]
    }
  );

export const CreateApprovedCalendarHoldResponseSchema = z.discriminatedUnion("kind", [
  CalendarHoldCreatedResponseSchema,
  CalendarHoldConflictResponseSchema,
  CalendarHoldConfirmationRequiredResponseSchema
]);

export const CreateConflictCheckOverrideRequestSchema = z
  .object({
    holdId: EntityIdSchema,
    expectedPayloadHash: Sha256Schema
  })
  .strict();

export const CreateConflictCheckOverrideResponseSchema = z
  .object({
    hold: CalendarHoldSchema,
    preview: CalendarHoldApprovalPreviewSchema
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.hold.id !== response.preview.holdId ||
      response.hold.viewingId !== response.preview.viewingId ||
      response.hold.payloadHash !== response.preview.payloadHash ||
      response.hold.state !== "approval_pending" ||
      !response.preview.conflictCheckOverride
    ) {
      context.addIssue({
        code: "custom",
        message: "An override preview requires a newly reserved approval-pending hold.",
        path: ["hold"]
      });
    }
  });

export const RescheduleViewingRequestSchema = z.object({ correlationId: EntityIdSchema }).strict();

export const CancelViewingRequestSchema = z.object({ correlationId: EntityIdSchema }).strict();

const InternalViewingMutationResponseFields = {
  viewing: ViewingSchema,
  externalCleanupRequired: z.boolean(),
  warning: z.string().trim().min(1).max(1_000).nullable()
} as const;

export const RescheduleViewingResponseSchema = z
  .object(InternalViewingMutationResponseFields)
  .strict()
  .superRefine((response, context) => {
    if (response.viewing.state !== "proposed" || response.viewing.supersedesViewingId === null) {
      context.addIssue({
        code: "custom",
        message: "Rescheduling must create a proposed Viewing with supersession lineage.",
        path: ["viewing"]
      });
    }
    if (response.externalCleanupRequired !== (response.warning !== null)) {
      context.addIssue({
        code: "custom",
        message: "External cleanup requirements must always be shown as a warning.",
        path: ["warning"]
      });
    }
  });
export const CancelViewingResponseSchema = z
  .object(InternalViewingMutationResponseFields)
  .strict()
  .superRefine((response, context) => {
    if (response.viewing.state !== "cancelled") {
      context.addIssue({
        code: "custom",
        message: "A cancel response requires an internally cancelled Viewing.",
        path: ["viewing", "state"]
      });
    }
    if (response.externalCleanupRequired !== (response.warning !== null)) {
      context.addIssue({
        code: "custom",
        message: "External cleanup requirements must always be shown as a warning.",
        path: ["warning"]
      });
    }
  });

export const CalendarApiErrorCodeSchema = z.enum([
  "unauthorized",
  "cross_origin_request",
  "invalid_request",
  "not_found",
  "policy_denied",
  "calendar_creation_failed",
  "calendar_not_configured",
  "calendar_scope_not_granted",
  "calendar_disconnected",
  "calendar_temporarily_unavailable",
  "availability_stale",
  "viewing_conflict_detected",
  "approval_required",
  "approval_expired",
  "approval_payload_mismatch",
  "invalid_state_transition",
  "validation_failed"
]);

export const CalendarApiErrorResponseSchema = z
  .object({
    code: CalendarApiErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    recovery: CalendarRecoverySchema,
    generatedAt: IsoDateTimeSchema
  })
  .strict();

export type CalendarHoldEffectPayload = z.infer<typeof CalendarHoldEffectPayloadSchema>;
export type CalendarHoldApprovalPreview = z.infer<typeof CalendarHoldApprovalPreviewSchema>;
export type CalendarRecoveryAction = z.infer<typeof CalendarRecoveryActionSchema>;
export type CalendarRecovery = z.infer<typeof CalendarRecoverySchema>;
export type GetAvailabilityRulesResponse = z.infer<typeof GetAvailabilityRulesResponseSchema>;
export type PutAvailabilityRulesRequest = z.infer<typeof PutAvailabilityRulesRequestSchema>;
export type PutAvailabilityRulesResponse = z.infer<typeof PutAvailabilityRulesResponseSchema>;
export type CalendarCapabilityAuthorizationRequest = z.infer<
  typeof CalendarCapabilityAuthorizationRequestSchema
>;
export type CalendarCapabilityAuthorizationResponse = z.infer<
  typeof CalendarCapabilityAuthorizationResponseSchema
>;
export type CalendarCapabilityGrantState = z.infer<typeof CalendarCapabilityGrantStateSchema>;
export type CalendarCapabilityStatus = z.infer<typeof CalendarCapabilityStatusSchema>;
export type CalendarIntegrationStatusResponse = z.infer<
  typeof CalendarIntegrationStatusResponseSchema
>;
export type CreateViewingProposalsRequest = z.infer<typeof CreateViewingProposalsRequestSchema>;
export type CreateViewingProposalsResponse = z.infer<typeof CreateViewingProposalsResponseSchema>;
export type SelectViewingWindowRequest = z.infer<typeof SelectViewingWindowRequestSchema>;
export type SelectViewingWindowResponse = z.infer<typeof SelectViewingWindowResponseSchema>;
export type CreateCalendarHoldPreviewRequest = z.infer<
  typeof CreateCalendarHoldPreviewRequestSchema
>;
export type CalendarHoldPreviewResponse = z.infer<typeof CalendarHoldPreviewResponseSchema>;
export type ApproveCalendarHoldRequest = z.infer<typeof ApproveCalendarHoldRequestSchema>;
export type ApproveCalendarHoldResponse = z.infer<typeof ApproveCalendarHoldResponseSchema>;
export type CreateApprovedCalendarHoldRequest = z.infer<
  typeof CreateApprovedCalendarHoldRequestSchema
>;
export type CreateApprovedCalendarHoldResponse = z.infer<
  typeof CreateApprovedCalendarHoldResponseSchema
>;
export type CreateConflictCheckOverrideRequest = z.infer<
  typeof CreateConflictCheckOverrideRequestSchema
>;
export type CreateConflictCheckOverrideResponse = z.infer<
  typeof CreateConflictCheckOverrideResponseSchema
>;
export type RescheduleViewingRequest = z.infer<typeof RescheduleViewingRequestSchema>;
export type RescheduleViewingResponse = z.infer<typeof RescheduleViewingResponseSchema>;
export type CancelViewingRequest = z.infer<typeof CancelViewingRequestSchema>;
export type CancelViewingResponse = z.infer<typeof CancelViewingResponseSchema>;
export type CalendarApiErrorCode = z.infer<typeof CalendarApiErrorCodeSchema>;
export type CalendarApiErrorResponse = z.infer<typeof CalendarApiErrorResponseSchema>;
