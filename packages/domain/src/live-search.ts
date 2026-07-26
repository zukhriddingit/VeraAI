import { z } from "zod";

import {
  EntityIdSchema,
  IsoDateTimeSchema,
  PercentageBasisPointsSchema,
  Sha256Schema
} from "./primitives.ts";

export const LIVE_RENTAL_SEARCH_MAX_RESULTS = 10;

const AgentTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), "Agent text cannot contain HTML.")
  .refine((value) => !/\bhttps?:\/\/|\bwww\./iu.test(value), "Agent text cannot contain URLs.");

export const AgentRentalRecommendationSchema = z
  .object({
    providerListingId: z.string().trim().min(1).max(200),
    recommended: z.boolean(),
    confidence: z.number().min(0).max(1),
    summary: AgentTextSchema.max(300),
    strengths: z.array(AgentTextSchema.max(200)).max(5),
    watchouts: z.array(AgentTextSchema.max(200)).max(5),
    missingFacts: z.array(AgentTextSchema.max(200)).max(5)
  })
  .strict();

const PolicyViolatingAgentLanguage =
  /\b(?:racial|ethnic|religious|national origin|disabled people|families with children|safe neighborhood|unsafe neighborhood|crime[- ]free|definitely (?:safe|legitimate)|guaranteed (?:safe|legitimate)|contact (?:the )?(?:agent|landlord|owner)|call|email|text (?:the )?(?:agent|landlord|owner))\b/iu;

export const AgentRentalAnalysisSchema = z
  .object({
    schemaVersion: z.literal("1"),
    searchRunId: EntityIdSchema,
    recommendations: z.array(AgentRentalRecommendationSchema).max(LIVE_RENTAL_SEARCH_MAX_RESULTS)
  })
  .strict()
  .superRefine((analysis, context) => {
    const ids = analysis.recommendations.map((recommendation) => recommendation.providerListingId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["recommendations"],
        message: "Agent recommendations must use unique provider listing IDs."
      });
    }

    analysis.recommendations.forEach((recommendation, index) => {
      const text = [
        recommendation.summary,
        ...recommendation.strengths,
        ...recommendation.watchouts,
        ...recommendation.missingFacts
      ].join(" ");
      if (PolicyViolatingAgentLanguage.test(text)) {
        context.addIssue({
          code: "custom",
          path: ["recommendations", index],
          message: "Agent analysis contains prohibited steering, certainty, or contact language."
        });
      }
    });
  });

export function validateAgentRentalAnalysis(
  input: unknown,
  expectedSearchRunId: string,
  candidateProviderListingIds: readonly string[]
) {
  const analysis = AgentRentalAnalysisSchema.parse(input);
  if (analysis.searchRunId !== expectedSearchRunId) {
    throw new Error("Agent analysis search-run ID does not match the request.");
  }

  const candidateIds = new Set(candidateProviderListingIds);
  const unknownId = analysis.recommendations.find(
    (recommendation) => !candidateIds.has(recommendation.providerListingId)
  )?.providerListingId;
  if (unknownId !== undefined) {
    throw new Error("Agent analysis references a listing outside the supplied candidate set.");
  }
  return analysis;
}

export const LiveSearchResultStateSchema = z.enum([
  "queued",
  "retrieving",
  "analyzing",
  "importing",
  "provider_unavailable",
  "provider_auth_failed",
  "provider_rate_limited",
  "maritime_unavailable",
  "agent_timeout",
  "agent_invalid_response",
  "no_matching_live_results",
  "completed"
]);

export const LiveSearchStatusSchema = z
  .object({
    searchRunId: EntityIdSchema,
    searchProfileId: EntityIdSchema,
    state: LiveSearchResultStateSchema,
    dataProvider: z.literal("RentCast"),
    maritimeAgent: z.literal("OpenClaw on Maritime"),
    retrievedCount: z.number().int().nonnegative().max(LIVE_RENTAL_SEARCH_MAX_RESULTS),
    importedCount: z.number().int().nonnegative().max(LIVE_RENTAL_SEARCH_MAX_RESULTS),
    rejectedCount: z.number().int().nonnegative().max(LIVE_RENTAL_SEARCH_MAX_RESULTS),
    retrievalLatencyMilliseconds: z.number().int().nonnegative().nullable(),
    agentLatencyMilliseconds: z.number().int().nonnegative().nullable(),
    totalLatencyMilliseconds: z.number().int().nonnegative().nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    queryHash: Sha256Schema.nullable(),
    promptVersion: z.string().trim().min(1).max(80),
    agentSchemaVersion: z.literal("1")
  })
  .strict();

export const RunLiveSearchRequestSchema = z
  .object({
    searchProfileId: EntityIdSchema,
    confirmedExternalUsage: z.literal(true),
    retryOfSearchRunId: EntityIdSchema.optional()
  })
  .strict();

export const LiveListingEvidenceSchema = z
  .object({
    provider: z.literal("rentcast"),
    providerListingId: z.string().trim().min(1).max(200),
    queryHash: Sha256Schema,
    observedAt: IsoDateTimeSchema,
    activeStatus: z.literal("Active"),
    addressComponents: z
      .object({
        line1: z.string().trim().min(1).max(200).nullable(),
        line2: z.string().trim().min(1).max(100).nullable(),
        city: z.string().trim().min(1).max(100).nullable(),
        state: z.string().trim().min(1).max(100).nullable(),
        postalCode: z.string().trim().min(1).max(20).nullable()
      })
      .strict(),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable(),
    listedAt: IsoDateTimeSchema.nullable(),
    lastSeenAt: IsoDateTimeSchema.nullable(),
    daysOnMarket: z.number().int().nonnegative().nullable(),
    mlsName: z.string().trim().min(1).max(160).nullable(),
    mlsNumber: z.string().trim().min(1).max(160).nullable(),
    listingOfficeName: z.string().trim().min(1).max(200).nullable(),
    listingOfficeWebsite: z.string().url().max(2_048).nullable(),
    agentAnalysis: AgentRentalRecommendationSchema.nullable()
  })
  .strict();

export const LiveSearchAgentCriteriaSchema = z
  .object({
    locationText: z.string().trim().min(1).max(300),
    minimumBedrooms: z.number().nonnegative().max(20).nullable(),
    minimumBathrooms: z.number().nonnegative().max(20).nullable(),
    targetMonthlyTotalCents: z.number().int().nonnegative().nullable(),
    absoluteMonthlyMaximumCents: z.number().int().nonnegative().nullable(),
    moveInEarliest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    moveInLatest: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    requiredPets: z.array(z.enum(["cat", "dog", "other"])).max(3),
    preferences: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(100),
            weightBasisPoints: PercentageBasisPointsSchema,
            description: z.string().trim().min(1).max(500)
          })
          .strict()
      )
      .max(30)
  })
  .strict();

export type AgentRentalAnalysis = z.infer<typeof AgentRentalAnalysisSchema>;
export type AgentRentalRecommendation = z.infer<typeof AgentRentalRecommendationSchema>;
export type LiveSearchResultState = z.infer<typeof LiveSearchResultStateSchema>;
export type LiveSearchStatus = z.infer<typeof LiveSearchStatusSchema>;
export type LiveListingEvidence = z.infer<typeof LiveListingEvidenceSchema>;
