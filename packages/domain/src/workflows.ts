import { z } from "zod";

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

export const ViewingSchema = z
  .object({
    id: EntityIdSchema,
    canonicalListingId: EntityIdSchema,
    proposedWindows: z.array(ViewingWindowSchema),
    confirmedWindow: ViewingWindowSchema.nullable(),
    timeZone: z.string().trim().min(1).max(120),
    calendarReference: z.string().trim().min(1).max(300).nullable(),
    state: ViewingStateSchema,
    notes: z.string().trim().min(1).max(5_000).nullable(),
    metadata: z.record(z.string(), JsonValueSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export type ContactWorkflow = z.infer<typeof ContactWorkflowSchema>;
export type ContactWorkflowState = z.infer<typeof ContactWorkflowStateSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type Viewing = z.infer<typeof ViewingSchema>;
export type ViewingWindow = z.infer<typeof ViewingWindowSchema>;
export type ViewingState = z.infer<typeof ViewingStateSchema>;
