import { z } from "zod";

import {
  ConfidenceBasisPointsSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema
} from "./primitives.ts";

export const ZILLOW_RESEARCH_TOOL_NAME = "vera_zillow_rental_research_v1" as const;
export const ZILLOW_RESEARCH_MAX_RESULTS = 10;
export const ZILLOW_RESEARCH_MAX_DETAIL_PAGES = 5;
export const ZILLOW_RESEARCH_MAX_EXPANSIONS = 2;
export const ZILLOW_RESEARCH_MAX_DURATION_MS = 90_000;

const ZillowHostnameSchema = z.literal("www.zillow.com");
function isReviewedZillowObservedUrl(value: string): boolean {
  return (
    /^https:\/\/www\.zillow\.com\/[^\s#]*$/u.test(value) ||
    /^https:\/\/www\.zillow\.com\/apartments\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9]+\/?(?:\?[^\s#]*)?#bedrooms-[1-9][0-9]*$/u.test(
      value
    ) ||
    /^https:\/\/www\.zillow\.com\/b\/[a-z0-9-]+\/[A-Za-z0-9]+\/?(?:\?[^\s#]*)?#unit-[1-9][0-9]*$/u.test(
      value
    )
  );
}

const ZillowObservedUrlSchema = z
  .url()
  .max(2_048)
  .refine(
    isReviewedZillowObservedUrl,
    "Observed Zillow URLs must use the reviewed HTTPS hostname and only reviewed listing-unit fragments."
  );

const SafeObservedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), "Observed text cannot contain HTML.");

export const ZillowRentalPropertyTypeSchema = z.enum(["apartment", "house", "townhouse", "condo"]);

export const ZillowRentalResearchProfileSchema = z
  .object({
    location: z.string().trim().min(1).max(160),
    maximumRentUsd: z.number().int().positive().max(1_000_000),
    minimumBedrooms: z.number().nonnegative().max(20),
    minimumBathrooms: z.number().nonnegative().max(20).optional(),
    rentalPropertyType: ZillowRentalPropertyTypeSchema.optional()
  })
  .strict();

export const ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE =
  "explicitly_shared_zillow_rental_tab" as const;

export const ZillowSharedTabReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("target_id"),
      value: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .regex(
          /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u,
          "The approved shared-tab reference must be an opaque identifier."
        )
    })
    .strict(),
  z
    .object({
      kind: z.literal("single_shared_tab"),
      value: z.literal(ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE)
    })
    .strict()
]);

export const ZillowRentalResearchInputSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: EntityIdSchema,
    profile: ZillowRentalResearchProfileSchema,
    maxResults: z.number().int().min(1).max(ZILLOW_RESEARCH_MAX_RESULTS),
    maxDetailPages: z.number().int().min(0).max(ZILLOW_RESEARCH_MAX_DETAIL_PAGES),
    startingTabReference: ZillowSharedTabReferenceSchema
  })
  .strict();

export const ZillowResearchPageStateSchema = z.enum([
  "ready",
  "login_required",
  "two_factor_required",
  "captcha_required",
  "consent_required",
  "blocked",
  "layout_changed"
]);

export const ZillowResearchCompletionStateSchema = z.enum([
  "completed",
  "partial",
  "failed",
  "manual_action_required"
]);

export const ZillowResearchManualActionSchema = z.enum([
  "login_required",
  "two_factor_required",
  "captcha_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "browser_offline",
  "no_shared_tab",
  "multiple_shared_tabs",
  "shared_tab_changed",
  "cancelled"
]);

export const ZillowResearchProgressPhaseSchema = z.enum([
  "connecting",
  "checking_login",
  "searching",
  "opening_details",
  "importing",
  "deduplicating",
  "ranking",
  "completed"
]);

export const ZillowObservedFieldSchema = z.enum([
  "source_listing_id",
  "canonical_observed_url",
  "final_detail_page_url",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities"
]);

export const ZillowMissingFieldSchema = z.enum([
  "source_listing_id",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities"
]);

export const ZillowFieldProvenanceSchema = z
  .object({
    field: ZillowObservedFieldSchema,
    observedFrom: z.enum(["result_card", "detail_page"]),
    sourceUrl: ZillowObservedUrlSchema,
    extractionMethod: z.literal("openclaw_semantic_snapshot"),
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const ZillowObservedListingSchema = z
  .object({
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    canonicalObservedUrl: ZillowObservedUrlSchema,
    finalDetailPageUrl: ZillowObservedUrlSchema.nullable(),
    address: SafeObservedTextSchema.max(300).nullable(),
    rentUsd: z.number().int().nonnegative().max(1_000_000).nullable(),
    bedrooms: z.number().nonnegative().max(20).nullable(),
    bathrooms: z.number().nonnegative().max(20).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    availability: SafeObservedTextSchema.max(200).nullable(),
    amenities: z.array(SafeObservedTextSchema.max(160)).max(30),
    observedAt: IsoDateTimeSchema,
    sourceFieldProvenance: z.array(ZillowFieldProvenanceSchema).max(30),
    missingFields: z.array(ZillowMissingFieldSchema).max(ZillowMissingFieldSchema.options.length),
    safeExtractionWarnings: z.array(SafeObservedTextSchema.max(240)).max(20),
    researchNotes: z.array(SafeObservedTextSchema.max(240)).max(20)
  })
  .strict()
  .superRefine((listing, context) => {
    const fields = listing.sourceFieldProvenance.map((entry) => entry.field);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceFieldProvenance"],
        message: "A listing can contain only one provenance record per observed field."
      });
    }
    if (new Set(listing.missingFields).size !== listing.missingFields.length) {
      context.addIssue({
        code: "custom",
        path: ["missingFields"],
        message: "Missing fields must be unique."
      });
    }
  });

export const ZillowSafeActionKindSchema = z.enum([
  "verify_shared_tab",
  "snapshot",
  "set_reviewed_filter",
  "navigate_observed",
  "scroll_bounded",
  "open_observed_listing",
  "return_to_results"
]);

export const ZillowSafeActionAuditEntrySchema = z
  .object({
    action: ZillowSafeActionKindSchema,
    hostname: ZillowHostnameSchema,
    observedReferenceHash: Sha256Schema.nullable(),
    result: z.enum(["allowed", "completed", "stopped"]),
    occurredAt: IsoDateTimeSchema
  })
  .strict();

export const ZillowResearchCheckpointRequestSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: EntityIdSchema,
    action: ZillowSafeActionKindSchema,
    startingTabReference: ZillowSharedTabReferenceSchema,
    activeTabReference: ZillowSharedTabReferenceSchema,
    sharedTabCount: z.number().int().nonnegative().max(100),
    hostname: z.string().trim().toLowerCase().min(1).max(253),
    elapsedMilliseconds: z.number().int().nonnegative().max(900_000),
    resultCardsObserved: z.number().int().nonnegative().max(1_000),
    detailPagesOpened: z.number().int().nonnegative().max(1_000),
    resultPageExpansions: z.number().int().nonnegative().max(1_000),
    observedReferenceHash: Sha256Schema.nullable(),
    requestedAt: IsoDateTimeSchema
  })
  .strict();

export const ZillowResearchCheckpointDenialReasonSchema = z.enum([
  "founder_denied",
  "source_disabled",
  "user_trigger_required",
  "browser_kill_switch_active",
  "run_not_active",
  "cancelled",
  "single_shared_tab_required",
  "shared_tab_mismatch",
  "hostname_not_allowed",
  "run_limit_exceeded",
  "source_policy_denied"
]);

export const ZillowResearchCheckpointResponseSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.union([z.literal("allowed"), ZillowResearchCheckpointDenialReasonSchema]),
    checkedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((response, context) => {
    if (response.allowed !== (response.reason === "allowed")) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Checkpoint decisions must pair allowed=true only with the allowed reason."
      });
    }
  });

export const ZillowRentalResearchOutputSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: EntityIdSchema,
    state: ZillowResearchCompletionStateSchema,
    pageState: ZillowResearchPageStateSchema,
    manualAction: ZillowResearchManualActionSchema.nullable(),
    listings: z.array(ZillowObservedListingSchema).max(ZILLOW_RESEARCH_MAX_RESULTS),
    resultCardsObserved: z.number().int().nonnegative().max(ZILLOW_RESEARCH_MAX_RESULTS),
    detailPagesOpened: z.number().int().nonnegative().max(ZILLOW_RESEARCH_MAX_DETAIL_PAGES),
    resultPageExpansions: z.number().int().nonnegative().max(ZILLOW_RESEARCH_MAX_EXPANSIONS),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    safeActionTrail: z.array(ZillowSafeActionAuditEntrySchema).max(100),
    warnings: z.array(SafeObservedTextSchema.max(240)).max(20)
  })
  .strict()
  .superRefine((output, context) => {
    if (output.state === "manual_action_required" && output.manualAction === null) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Manual-action completion requires a manual-action reason."
      });
    }
    if (output.state !== "manual_action_required" && output.manualAction !== null) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Only manual-action completion may include a manual-action reason."
      });
    }
    if (Date.parse(output.completedAt) < Date.parse(output.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Research completion cannot precede its start."
      });
    }
  });

export type ZillowRentalPropertyType = z.infer<typeof ZillowRentalPropertyTypeSchema>;
export type ZillowRentalResearchProfile = z.infer<typeof ZillowRentalResearchProfileSchema>;
export type ZillowSharedTabReference = z.infer<typeof ZillowSharedTabReferenceSchema>;
export type ZillowRentalResearchInput = z.infer<typeof ZillowRentalResearchInputSchema>;
export type ZillowResearchPageState = z.infer<typeof ZillowResearchPageStateSchema>;
export type ZillowResearchCompletionState = z.infer<typeof ZillowResearchCompletionStateSchema>;
export type ZillowResearchManualAction = z.infer<typeof ZillowResearchManualActionSchema>;
export type ZillowResearchProgressPhase = z.infer<typeof ZillowResearchProgressPhaseSchema>;
export type ZillowObservedField = z.infer<typeof ZillowObservedFieldSchema>;
export type ZillowMissingField = z.infer<typeof ZillowMissingFieldSchema>;
export type ZillowFieldProvenance = z.infer<typeof ZillowFieldProvenanceSchema>;
export type ZillowObservedListing = z.infer<typeof ZillowObservedListingSchema>;
export type ZillowSafeActionKind = z.infer<typeof ZillowSafeActionKindSchema>;
export type ZillowSafeActionAuditEntry = z.infer<typeof ZillowSafeActionAuditEntrySchema>;
export type ZillowResearchCheckpointRequest = z.infer<typeof ZillowResearchCheckpointRequestSchema>;
export type ZillowResearchCheckpointDenialReason = z.infer<
  typeof ZillowResearchCheckpointDenialReasonSchema
>;
export type ZillowResearchCheckpointResponse = z.infer<
  typeof ZillowResearchCheckpointResponseSchema
>;
export type ZillowRentalResearchOutput = z.infer<typeof ZillowRentalResearchOutputSchema>;
