import { z } from "zod";

import { EntityIdSchema, IsoDateTimeSchema, JsonObjectSchema, Sha256Schema } from "./primitives.ts";

export const ActivityActorSchema = z.enum(["user", "vera", "connector", "system"]);
export const PolicyDecisionSchema = z.enum(["not_applicable", "authorized", "denied"]);
export const ActivityOutcomeSchema = z.enum([
  "recorded",
  "authorized",
  "denied",
  "succeeded",
  "failed"
]);
export const ErrorCategorySchema = z.enum([
  "validation",
  "policy_denial",
  "approval_required",
  "approval_expired",
  "manual_action_required",
  "authentication",
  "rate_limit",
  "transient_provider",
  "permanent_provider",
  "conflict",
  "internal"
]);

export const ActivityEventSchema = z
  .object({
    id: EntityIdSchema,
    correlationId: EntityIdSchema,
    causationId: EntityIdSchema.nullable(),
    actor: ActivityActorSchema,
    action: z.string().trim().min(1).max(160),
    targetType: z.string().trim().min(1).max(100),
    targetId: EntityIdSchema,
    policyDecision: PolicyDecisionSchema,
    approvalId: EntityIdSchema.nullable(),
    payloadHash: Sha256Schema,
    outcome: ActivityOutcomeSchema,
    errorCategory: ErrorCategorySchema.nullable(),
    metadata: JsonObjectSchema,
    occurredAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (event.outcome === "failed" && event.errorCategory === null) {
      context.addIssue({
        code: "custom",
        path: ["errorCategory"],
        message: "Failed events require an error category."
      });
    }

    if (event.outcome !== "failed" && event.errorCategory !== null) {
      context.addIssue({
        code: "custom",
        path: ["errorCategory"],
        message: "Only failed events may carry an error category."
      });
    }
  });

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type ActivityActor = z.infer<typeof ActivityActorSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ActivityOutcome = z.infer<typeof ActivityOutcomeSchema>;
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
