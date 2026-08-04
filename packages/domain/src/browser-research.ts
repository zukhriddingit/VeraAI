import { z } from "zod";

import {
  ZillowRentalResearchProfileSchema,
  ZillowSharedTabReferenceSchema
} from "./zillow-browser-research.ts";
import {
  ConfidenceBasisPointsSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema
} from "./primitives.ts";

export const BROWSER_RESEARCH_TOOL_NAME = "vera_browser_research_v1" as const;
export const BROWSER_RESEARCH_MAX_RESULTS = 10;
export const BROWSER_RESEARCH_MAX_DETAIL_PAGES = 5;
export const BROWSER_RESEARCH_MAX_ACTIONS = 50;
export const BROWSER_RESEARCH_MAX_DURATION_MS = 90_000;

export const BrowserResearchSourceSchema = z.enum([
  "zillow",
  "apartments_com",
  "facebook_marketplace"
]);

export const BrowserResearchSourcePolicy = {
  zillow: {
    hostnames: ["www.zillow.com"],
    urlPatterns: [
      "^https://www\\.zillow\\.com/(?:homes/for_rent|homedetails|apartments)(?:/|\\?|$)"
    ],
    maxDetailPages: 5
  },
  apartments_com: {
    hostnames: ["www.apartments.com"],
    urlPatterns: ["^https://www\\.apartments\\.com/(?:[^?#]+/)?(?:\\?[^#]*)?$"],
    maxDetailPages: 5
  },
  facebook_marketplace: {
    hostnames: ["www.facebook.com"],
    urlPatterns: [
      "^https://www\\.facebook\\.com/marketplace/(?:[a-z0-9-]+/(?:category/propertyrentals|propertyrentals)|item/[0-9]+)(?:/|\\?|$)"
    ],
    maxDetailPages: 3
  }
} as const;

const SafeObservedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), "Observed text cannot contain HTML.");

const ObservedUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    return /^https:\/\/[^/@?#]+(?:\/|\?|$)[^#]*$/u.test(value);
  }, "Observed browser-research URLs must be credential-free HTTPS URLs without fragments.");

export const BrowserResearchSafeActionTypeSchema = z.enum([
  "inspect_shared_tabs",
  "create_source_tab",
  "navigate_same_source",
  "snapshot",
  "scroll_bounded",
  "select_reviewed_filter",
  "fill_approved_search_field",
  "open_observed_listing",
  "return_to_results",
  "extract_observed_facts"
]);

export const BrowserResearchPlanPayloadSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: EntityIdSchema,
    source: BrowserResearchSourceSchema,
    profile: ZillowRentalResearchProfileSchema,
    maxResults: z.number().int().min(1).max(BROWSER_RESEARCH_MAX_RESULTS),
    maxDetailPages: z.number().int().min(0).max(BROWSER_RESEARCH_MAX_DETAIL_PAGES),
    maxActions: z.number().int().min(1).max(BROWSER_RESEARCH_MAX_ACTIONS),
    maxDurationMilliseconds: z.number().int().min(1_000).max(BROWSER_RESEARCH_MAX_DURATION_MS),
    startingTabReference: ZillowSharedTabReferenceSchema,
    allowedHostnames: z.array(z.string().trim().toLowerCase().min(1).max(253)).min(1).max(3),
    allowedUrlPatterns: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
    enabledSafeActionTypes: z.array(BrowserResearchSafeActionTypeSchema).min(1).max(10),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((plan, context) => {
    const policy = BrowserResearchSourcePolicy[plan.source];
    if (JSON.stringify(plan.allowedHostnames) !== JSON.stringify(policy.hostnames)) {
      context.addIssue({
        code: "custom",
        path: ["allowedHostnames"],
        message: "Allowed hostnames must exactly match the reviewed source policy."
      });
    }
    if (JSON.stringify(plan.allowedUrlPatterns) !== JSON.stringify(policy.urlPatterns)) {
      context.addIssue({
        code: "custom",
        path: ["allowedUrlPatterns"],
        message: "Allowed URL patterns must exactly match the reviewed source policy."
      });
    }
    if (plan.maxDetailPages > policy.maxDetailPages) {
      context.addIssue({
        code: "custom",
        path: ["maxDetailPages"],
        message: "Detail-page limit exceeds the reviewed source policy."
      });
    }
    if (new Set(plan.enabledSafeActionTypes).size !== plan.enabledSafeActionTypes.length) {
      context.addIssue({
        code: "custom",
        path: ["enabledSafeActionTypes"],
        message: "Enabled safe action types must be unique."
      });
    }
    const lifetime = Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt);
    if (lifetime <= 0 || lifetime > 120_000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "A research plan must expire within two minutes of issuance."
      });
    }
  });

export const BrowserResearchPlanSchema = BrowserResearchPlanPayloadSchema.extend({
  signature: Sha256Schema
}).strict();

export const BrowserResearchPageStateSchema = z.enum([
  "ready",
  "login_required",
  "two_factor_required",
  "captcha_required",
  "checkpoint_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "no_results"
]);

export const BrowserResearchCompletionStateSchema = z.enum([
  "completed",
  "partial",
  "no_results",
  "failed",
  "manual_action_required"
]);

export const BrowserResearchManualActionSchema = z.enum([
  "login_required",
  "two_factor_required",
  "captcha_required",
  "checkpoint_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "browser_offline",
  "tab_required",
  "multiple_shared_tabs",
  "shared_tab_changed",
  "cancelled"
]);

export const BrowserResearchObservedFieldSchema = z.enum([
  "source_listing_id",
  "canonical_observed_url",
  "final_detail_page_url",
  "property_name",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities",
  "fees"
]);

export const BrowserResearchMissingFieldSchema = z.enum([
  "source_listing_id",
  "property_name",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities",
  "fees"
]);

export const BrowserResearchFieldProvenanceSchema = z
  .object({
    field: BrowserResearchObservedFieldSchema,
    observedFrom: z.enum(["result_card", "detail_page"]),
    sourceUrl: ObservedUrlSchema,
    extractionMethod: z.literal("openclaw_semantic_snapshot"),
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserResearchObservedListingSchema = z
  .object({
    source: BrowserResearchSourceSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    canonicalObservedUrl: ObservedUrlSchema,
    finalDetailPageUrl: ObservedUrlSchema.nullable(),
    propertyName: SafeObservedTextSchema.max(300).nullable(),
    address: SafeObservedTextSchema.max(300).nullable(),
    rentUsd: z.number().int().nonnegative().max(1_000_000).nullable(),
    bedrooms: z.number().nonnegative().max(20).nullable(),
    bathrooms: z.number().nonnegative().max(20).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    availability: SafeObservedTextSchema.max(300).nullable(),
    amenities: z.array(SafeObservedTextSchema.max(160)).max(30),
    fees: z.array(SafeObservedTextSchema.max(200)).max(20),
    observedAt: IsoDateTimeSchema,
    sourceFieldProvenance: z.array(BrowserResearchFieldProvenanceSchema).max(40),
    missingFields: z.array(BrowserResearchMissingFieldSchema).max(10),
    safeExtractionWarnings: z.array(SafeObservedTextSchema.max(240)).max(20),
    researchNotes: z.array(SafeObservedTextSchema.max(240)).max(20)
  })
  .strict()
  .superRefine((listing, context) => {
    const policy = BrowserResearchSourcePolicy[listing.source];
    for (const [path, value] of [
      ["canonicalObservedUrl", listing.canonicalObservedUrl],
      ["finalDetailPageUrl", listing.finalDetailPageUrl]
    ] as const) {
      if (value === null) continue;
      const hostname = value.match(/^https:\/\/([^/?#]+)(?:\/|\?|$)/u)?.[1] ?? "";
      if (!policy.hostnames.includes(hostname as never)) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Observed listing URL hostname does not match the source policy."
        });
      }
    }
    const fields = listing.sourceFieldProvenance.map((entry) => entry.field);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceFieldProvenance"],
        message: "A listing may contain only one provenance record per observed field."
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

export const BrowserResearchSafeActionAuditEntrySchema = z
  .object({
    action: BrowserResearchSafeActionTypeSchema,
    hostname: z.string().trim().toLowerCase().min(1).max(253),
    observedReferenceHash: Sha256Schema.nullable(),
    result: z.enum(["allowed", "completed", "stopped"]),
    occurredAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserResearchCheckpointRequestSchema = z
  .object({
    version: z.literal("1"),
    plan: BrowserResearchPlanSchema,
    action: BrowserResearchSafeActionTypeSchema,
    activeTabReference: ZillowSharedTabReferenceSchema,
    sharedTabCount: z.number().int().nonnegative().max(100),
    hostname: z.string().trim().toLowerCase().min(1).max(253),
    elapsedMilliseconds: z.number().int().nonnegative().max(900_000),
    resultCardsObserved: z.number().int().nonnegative().max(1_000),
    detailPagesOpened: z.number().int().nonnegative().max(1_000),
    actionsUsed: z.number().int().nonnegative().max(1_000),
    requestedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserResearchCheckpointDenialReasonSchema = z.enum([
  "founder_denied",
  "source_disabled",
  "user_trigger_required",
  "browser_kill_switch_active",
  "run_not_active",
  "cancelled",
  "plan_expired",
  "plan_signature_invalid",
  "single_shared_tab_required",
  "shared_tab_mismatch",
  "hostname_not_allowed",
  "action_not_enabled",
  "run_limit_exceeded",
  "source_policy_denied"
]);

export const BrowserResearchCheckpointResponseSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.union([z.literal("allowed"), BrowserResearchCheckpointDenialReasonSchema]),
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

export const BrowserResearchOutputSchema = z
  .object({
    version: z.literal("1"),
    veraRunId: EntityIdSchema,
    source: BrowserResearchSourceSchema,
    state: BrowserResearchCompletionStateSchema,
    pageState: BrowserResearchPageStateSchema,
    manualAction: BrowserResearchManualActionSchema.nullable(),
    listings: z.array(BrowserResearchObservedListingSchema).max(BROWSER_RESEARCH_MAX_RESULTS),
    resultCardsObserved: z.number().int().nonnegative().max(BROWSER_RESEARCH_MAX_RESULTS),
    detailPagesOpened: z.number().int().nonnegative().max(BROWSER_RESEARCH_MAX_DETAIL_PAGES),
    actionsUsed: z.number().int().nonnegative().max(BROWSER_RESEARCH_MAX_ACTIONS),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    safeActionTrail: z
      .array(BrowserResearchSafeActionAuditEntrySchema)
      .max(BROWSER_RESEARCH_MAX_ACTIONS),
    warnings: z.array(SafeObservedTextSchema.max(240)).max(20)
  })
  .strict()
  .superRefine((output, context) => {
    if (output.listings.some((listing) => listing.source !== output.source)) {
      context.addIssue({
        code: "custom",
        path: ["listings"],
        message: "Every listing must match the output source."
      });
    }
    if (output.state === "manual_action_required" && output.manualAction === null) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Manual action requires a reason."
      });
    }
    if (output.state !== "manual_action_required" && output.manualAction !== null) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Only manual-action output may include a reason."
      });
    }
    if (Date.parse(output.completedAt) < Date.parse(output.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion cannot precede start."
      });
    }
  });

export type BrowserResearchSource = z.infer<typeof BrowserResearchSourceSchema>;
export type BrowserResearchSafeActionType = z.infer<typeof BrowserResearchSafeActionTypeSchema>;
export type BrowserResearchPlanPayload = z.infer<typeof BrowserResearchPlanPayloadSchema>;
export type BrowserResearchPlan = z.infer<typeof BrowserResearchPlanSchema>;
export type BrowserResearchPageState = z.infer<typeof BrowserResearchPageStateSchema>;
export type BrowserResearchCompletionState = z.infer<typeof BrowserResearchCompletionStateSchema>;
export type BrowserResearchManualAction = z.infer<typeof BrowserResearchManualActionSchema>;
export type BrowserResearchObservedListing = z.infer<typeof BrowserResearchObservedListingSchema>;
export type BrowserResearchCheckpointRequest = z.infer<
  typeof BrowserResearchCheckpointRequestSchema
>;
export type BrowserResearchCheckpointDenialReason = z.infer<
  typeof BrowserResearchCheckpointDenialReasonSchema
>;
export type BrowserResearchCheckpointResponse = z.infer<
  typeof BrowserResearchCheckpointResponseSchema
>;
export type BrowserResearchOutput = z.infer<typeof BrowserResearchOutputSchema>;
