import { z } from "zod";

import { ErrorCategorySchema } from "./activity.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const NormalizationJobStateSchema = z.enum([
  "queued",
  "leased",
  "completed",
  "retryable",
  "dead_letter"
]);

export const NormalizationJobSchema = z
  .object({
    id: EntityIdSchema,
    rawListingId: EntityIdSchema,
    idempotencyKey: Sha256Schema,
    jobType: z.literal("normalize_listing"),
    state: NormalizationJobStateSchema,
    availableAt: IsoDateTimeSchema,
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(100),
    leaseOwner: EntityIdSchema.nullable(),
    leaseExpiresAt: IsoDateTimeSchema.nullable(),
    lastErrorCode: z.string().trim().min(1).max(120).nullable(),
    lastErrorCategory: ErrorCategorySchema.nullable(),
    correlationId: EntityIdSchema,
    causationId: EntityIdSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((job, context) => {
    const hasLease = job.leaseOwner !== null && job.leaseExpiresAt !== null;
    const hasPartialLease = (job.leaseOwner === null) !== (job.leaseExpiresAt === null);
    if (hasPartialLease || (job.state === "leased") !== hasLease) {
      context.addIssue({
        code: "custom",
        path: ["leaseOwner"],
        message: "Only leased jobs may have a complete lease."
      });
    }

    if ((job.state === "completed") !== (job.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Only completed jobs have a completion time."
      });
    }

    if ((job.lastErrorCode === null) !== (job.lastErrorCategory === null)) {
      context.addIssue({
        code: "custom",
        path: ["lastErrorCode"],
        message: "Stored job errors require both a safe code and category."
      });
    }

    if (["queued", "completed"].includes(job.state) && job.lastErrorCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["lastErrorCode"],
        message: "Queued and completed jobs cannot carry an error."
      });
    }

    if (["retryable", "dead_letter"].includes(job.state) && job.lastErrorCode === null) {
      context.addIssue({
        code: "custom",
        path: ["lastErrorCode"],
        message: "Failed jobs require a safe error."
      });
    }

    if (job.attempts > job.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "Job attempts cannot exceed the configured maximum."
      });
    }

    if (job.state === "queued" && job.attempts !== 0) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "A newly queued job has not been attempted."
      });
    }

    if (
      ["leased", "completed", "retryable", "dead_letter"].includes(job.state) &&
      job.attempts < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "A processed job requires at least one attempt."
      });
    }

    if (job.state === "retryable" && job.attempts >= job.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "A job at its attempt limit must be dead-lettered."
      });
    }

    if (job.updatedAt < job.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Job update time cannot precede creation time."
      });
    }
  });

export type NormalizationJobState = z.infer<typeof NormalizationJobStateSchema>;
export type NormalizationJob = z.infer<typeof NormalizationJobSchema>;
