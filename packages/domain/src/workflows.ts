import { z } from "zod";

import { IanaTimeZoneSchema, ProposedViewingWindowSchema } from "./calendar.ts";
import { EntityIdSchema, IsoDateTimeSchema, JsonValueSchema, Sha256Schema } from "./primitives.ts";

export const ContactWorkflowStateSchema = z.enum([
  "not_started",
  "questions_ready",
  "draft_ready",
  "draft_created",
  "reply_received",
  "closed"
]);

export const ContactWorkflowSchema = z
  .object({
    id: EntityIdSchema,
    canonicalListingId: EntityIdSchema,
    channel: z.enum(["email_draft", "platform_draft", "manual"]),
    recipientReference: z.string().trim().min(1).max(300).nullable(),
    missingFactQuestions: z.array(z.string().trim().min(1).max(1_000)),
    draftReference: z.string().trim().min(1).max(300).nullable(),
    state: ContactWorkflowStateSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const ApprovalStateSchema = z.enum(["pending", "used", "expired", "revoked"]);

export const ALLOWED_APPROVAL_TRANSITIONS = {
  pending: ["used", "expired", "revoked"],
  used: [],
  expired: [],
  revoked: []
} as const satisfies Record<
  z.infer<typeof ApprovalStateSchema>,
  readonly z.infer<typeof ApprovalStateSchema>[]
>;

export class InvalidApprovalTransitionError extends Error {
  readonly current: ApprovalState;
  readonly requested: ApprovalState;

  constructor(current: ApprovalState, requested: ApprovalState) {
    super(`Approval cannot transition from ${current} to ${requested}.`);
    this.name = "InvalidApprovalTransitionError";
    this.current = current;
    this.requested = requested;
  }
}

export function transitionApprovalState(
  currentInput: ApprovalState,
  requestedInput: ApprovalState
): ApprovalState {
  const current = ApprovalStateSchema.parse(currentInput);
  const requested = ApprovalStateSchema.parse(requestedInput);
  const allowed: readonly ApprovalState[] = ALLOWED_APPROVAL_TRANSITIONS[current];

  if (!allowed.includes(requested)) {
    throw new InvalidApprovalTransitionError(current, requested);
  }

  return requested;
}

export const ApprovalSchema = z
  .object({
    id: EntityIdSchema,
    actor: z.enum(["user"]),
    connectorId: z.string().trim().min(1).max(120),
    operation: z.string().trim().min(1).max(160),
    targetType: z.string().trim().min(1).max(100),
    targetId: EntityIdSchema,
    payloadHash: Sha256Schema,
    state: ApprovalStateSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    usedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((approval, context) => {
    if (Date.parse(approval.expiresAt) <= Date.parse(approval.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Approval expiry must follow creation."
      });
    }

    if ((approval.state === "used") !== (approval.usedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["usedAt"],
        message: "Only used approvals have a used time."
      });
    }
  });

export const ViewingWindowSchema = z
  .object({
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema
  })
  .strict()
  .refine((window) => Date.parse(window.endsAt) > Date.parse(window.startsAt), {
    message: "Viewing end time must follow start time.",
    path: ["endsAt"]
  });

export const ViewingStateSchema = z.enum([
  "proposed",
  "selected",
  "hold_approved",
  "hold_created",
  "confirmed",
  "completed",
  "cancelled"
]);

function proposedWindowIntervalKey(window: {
  readonly startsAt: string;
  readonly endsAt: string;
}): string {
  return `${window.startsAt}/${window.endsAt}`;
}

function proposedWindowsDeepEqual(
  left: z.infer<typeof ProposedViewingWindowSchema>,
  right: z.infer<typeof ProposedViewingWindowSchema>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const ALLOWED_VIEWING_TRANSITIONS = {
  proposed: ["selected", "cancelled"],
  selected: ["hold_approved", "proposed", "cancelled"],
  hold_approved: ["hold_created", "selected", "cancelled"],
  hold_created: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: []
} as const satisfies Record<
  z.infer<typeof ViewingStateSchema>,
  readonly z.infer<typeof ViewingStateSchema>[]
>;

export class InvalidViewingTransitionError extends Error {
  readonly current: ViewingState;
  readonly requested: ViewingState;

  constructor(current: ViewingState, requested: ViewingState) {
    super(`Viewing cannot transition from ${current} to ${requested}.`);
    this.name = "InvalidViewingTransitionError";
    this.current = current;
    this.requested = requested;
  }
}

export function transitionViewingState(
  currentInput: ViewingState,
  requestedInput: ViewingState
): ViewingState {
  const current = ViewingStateSchema.parse(currentInput);
  const requested = ViewingStateSchema.parse(requestedInput);
  const allowed: readonly ViewingState[] = ALLOWED_VIEWING_TRANSITIONS[current];

  if (!allowed.includes(requested)) {
    throw new InvalidViewingTransitionError(current, requested);
  }

  return requested;
}

export const ViewingSchema = z
  .object({
    id: EntityIdSchema,
    canonicalListingId: EntityIdSchema,
    proposedWindows: z.array(ProposedViewingWindowSchema).max(100),
    selectedWindow: ProposedViewingWindowSchema.nullable(),
    confirmedWindow: ViewingWindowSchema.nullable(),
    supersedesViewingId: EntityIdSchema.nullable(),
    timeZone: IanaTimeZoneSchema,
    calendarReference: z.string().trim().min(1).max(300).nullable(),
    state: ViewingStateSchema,
    notes: z.string().trim().min(1).max(5_000).nullable(),
    metadata: z.record(z.string(), JsonValueSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((viewing, context) => {
    if (viewing.supersedesViewingId === viewing.id) {
      context.addIssue({
        code: "custom",
        message: "A Viewing cannot supersede itself.",
        path: ["supersedesViewingId"]
      });
    }

    const intervalKeys = viewing.proposedWindows.map(proposedWindowIntervalKey);
    if (new Set(intervalKeys).size !== intervalKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Proposed Viewing intervals must be unique.",
        path: ["proposedWindows"]
      });
    }

    for (const [index, window] of viewing.proposedWindows.entries()) {
      if (window.timeZone !== viewing.timeZone) {
        context.addIssue({
          code: "custom",
          message: "Every proposed window must use the Viewing timezone.",
          path: ["proposedWindows", index, "timeZone"]
        });
      }
    }

    const selectedWindowRequired = [
      "selected",
      "hold_approved",
      "hold_created",
      "confirmed",
      "completed"
    ].includes(viewing.state);
    if (
      (selectedWindowRequired && viewing.selectedWindow === null) ||
      (viewing.state === "proposed" && viewing.selectedWindow !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "The Viewing state and selected window must agree.",
        path: ["selectedWindow"]
      });
    }

    if (
      viewing.selectedWindow !== null &&
      !viewing.proposedWindows.some((window) =>
        proposedWindowsDeepEqual(window, viewing.selectedWindow as typeof window)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The selected window must be one of the persisted proposed windows.",
        path: ["selectedWindow"]
      });
    }

    const confirmedWindowRequired = viewing.state === "confirmed" || viewing.state === "completed";
    if (
      (confirmedWindowRequired && viewing.confirmedWindow === null) ||
      (!["confirmed", "completed", "cancelled"].includes(viewing.state) &&
        viewing.confirmedWindow !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a confirmed or completed Viewing requires a confirmed window.",
        path: ["confirmedWindow"]
      });
    }

    const calendarReferenceRequired = ["hold_created", "confirmed", "completed"].includes(
      viewing.state
    );
    if (
      (calendarReferenceRequired && viewing.calendarReference === null) ||
      (["proposed", "selected", "hold_approved"].includes(viewing.state) &&
        viewing.calendarReference !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a Viewing with a created hold requires a Calendar reference.",
        path: ["calendarReference"]
      });
    }

    if (Date.parse(viewing.updatedAt) < Date.parse(viewing.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "A Viewing cannot be updated before it is created.",
        path: ["updatedAt"]
      });
    }
  });

export type ContactWorkflow = z.infer<typeof ContactWorkflowSchema>;
export type ContactWorkflowState = z.infer<typeof ContactWorkflowStateSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type Viewing = z.infer<typeof ViewingSchema>;
export type ViewingWindow = z.infer<typeof ViewingWindowSchema>;
export type ViewingState = z.infer<typeof ViewingStateSchema>;
