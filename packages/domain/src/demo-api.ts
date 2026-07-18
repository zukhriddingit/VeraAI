import { z } from "zod";

import { ActivityOutcomeSchema, PolicyDecisionSchema } from "./activity.ts";
import { CanonicalListingSummarySchema } from "./api.ts";
import {
  CanonicalListingSchema,
  FieldProvenanceSchema,
  ListingScoreSchema,
  ListingSourceRecordSchema,
  RiskSignalSchema
} from "./listing.ts";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.ts";
import { SearchProfileSchema } from "./search-profile.ts";

export const DEMO_SEARCH_COMPLETION_SUMMARY =
  "12 source records analyzed · 8 homes found · 3 duplicate clusters";

export const DemoRunResponseSchema = z
  .object({
    status: z.literal("completed"),
    sourceRecordsAnalyzed: z.literal(12),
    homesFound: z.literal(8),
    duplicateClusters: z.literal(3),
    summary: z.literal(DEMO_SEARCH_COMPLETION_SUMMARY),
    completedAt: IsoDateTimeSchema,
    idempotentReplay: z.boolean()
  })
  .strict();

export const DemoStatusResponseSchema = z
  .object({
    demoMode: z.literal(true),
    status: z.enum(["not_run", "completed"]),
    profile: SearchProfileSchema,
    run: DemoRunResponseSchema.nullable(),
    generatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((status, context) => {
    if ((status.status === "completed") !== (status.run !== null)) {
      context.addIssue({
        code: "custom",
        path: ["run"],
        message: "Demo completion status and run summary must agree."
      });
    }
  });

export const DemoUnavailableResponseSchema = z
  .object({
    code: z.enum(["demo_mode_disabled", "demo_unavailable", "demo_state_invalid"]),
    message: z.string().trim().min(1).max(300)
  })
  .strict();

export const ActivityPresentationSchema = z
  .object({
    id: EntityIdSchema,
    correlationId: EntityIdSchema,
    action: z.string().trim().min(1).max(160),
    targetType: z.string().trim().min(1).max(100),
    targetId: EntityIdSchema,
    policyDecision: PolicyDecisionSchema,
    outcome: ActivityOutcomeSchema,
    detail: z.string().trim().min(1).max(300).nullable(),
    occurredAt: IsoDateTimeSchema
  })
  .strict();

export const ActivityCollectionResponseSchema = z
  .object({
    events: z.array(ActivityPresentationSchema),
    count: z.number().int().nonnegative(),
    generatedAt: IsoDateTimeSchema
  })
  .strict()
  .refine((response) => response.events.length === response.count, {
    message: "Activity response count does not match its collection.",
    path: ["count"]
  });

export const ListingSourceEvidenceSchema = z
  .object({
    record: ListingSourceRecordSchema,
    provenance: z.array(FieldProvenanceSchema)
  })
  .strict();

export const CanonicalListingDetailResponseSchema = z
  .object({
    canonical: CanonicalListingSchema,
    summary: CanonicalListingSummarySchema,
    sources: z.array(ListingSourceEvidenceSchema).min(1),
    duplicateExplanation: z.string().trim().min(1).max(500).nullable(),
    score: ListingScoreSchema.nullable(),
    risks: z.array(RiskSignalSchema),
    activity: z.array(ActivityPresentationSchema),
    generatedAt: IsoDateTimeSchema
  })
  .strict();

export const ShortlistRequestSchema = z
  .object({
    shortlisted: z.boolean()
  })
  .strict();

export const ShortlistResponseSchema = z
  .object({
    listingId: EntityIdSchema,
    lifecycleState: z.enum(["new", "shortlisted"]),
    shortlisted: z.boolean(),
    activityEventId: EntityIdSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .refine((response) => response.shortlisted === (response.lifecycleState === "shortlisted"), {
    message: "Shortlist boolean and lifecycle state must agree.",
    path: ["shortlisted"]
  });

export const ListingActionErrorResponseSchema = z
  .object({
    code: z.enum(["not_found", "invalid_transition", "malformed_request", "database_unavailable"]),
    message: z.string().trim().min(1).max(300)
  })
  .strict();

export type DemoRunResponse = z.infer<typeof DemoRunResponseSchema>;
export type DemoStatusResponse = z.infer<typeof DemoStatusResponseSchema>;
export type ActivityPresentation = z.infer<typeof ActivityPresentationSchema>;
export type ActivityCollectionResponse = z.infer<typeof ActivityCollectionResponseSchema>;
export type ListingSourceEvidence = z.infer<typeof ListingSourceEvidenceSchema>;
export type CanonicalListingDetailResponse = z.infer<typeof CanonicalListingDetailResponseSchema>;
export type ShortlistRequest = z.infer<typeof ShortlistRequestSchema>;
export type ShortlistResponse = z.infer<typeof ShortlistResponseSchema>;
