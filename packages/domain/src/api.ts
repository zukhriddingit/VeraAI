import { z } from "zod";

import { ListingAddressSchema, ListingLifecycleStateSchema, PetPolicySchema } from "./listing.ts";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  ListingSourceLabelSchema,
  MoneyCentsSchema,
  PercentageBasisPointsSchema
} from "./primitives.ts";

export const CanonicalListingSummarySchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().trim().min(1).max(300),
    address: ListingAddressSchema,
    monthlyRentCents: MoneyCentsSchema.nullable(),
    recurringFeesCents: MoneyCentsSchema.nullable(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    availableOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    leaseTermMonths: z.number().int().positive().max(120).nullable(),
    petPolicy: PetPolicySchema.nullable(),
    lifecycleState: ListingLifecycleStateSchema,
    projectionState: z.enum(["active", "superseded"]).optional(),
    supersededById: EntityIdSchema.nullable().optional(),
    completenessBasisPoints: PercentageBasisPointsSchema,
    freshestObservedAt: IsoDateTimeSchema,
    freshestSourcePostedAt: IsoDateTimeSchema.nullable(),
    alertLatencySeconds: z.number().int().nonnegative().safe().nullable(),
    sourceLabels: z.array(ListingSourceLabelSchema).min(1),
    sourceRecordCount: z.number().int().positive(),
    duplicateCount: z.number().int().nonnegative(),
    unknownFields: z.array(z.string().trim().min(1).max(100)),
    fitScoreBasisPoints: z.number().int().min(-10_000).max(10_000).nullable(),
    eligible: z.boolean().nullable().optional(),
    baseScoreBasisPoints: PercentageBasisPointsSchema.nullable().optional(),
    stalePenaltyBasisPoints: PercentageBasisPointsSchema.nullable().optional(),
    lowConfidencePenaltyBasisPoints: PercentageBasisPointsSchema.nullable().optional(),
    riskPenaltyBasisPoints: PercentageBasisPointsSchema.nullable().optional(),
    fitLabel: z.enum(["strong_fit", "possible_fit", "needs_review"]).nullable(),
    topPositiveReason: z.string().trim().min(1).max(300).nullable(),
    topConcern: z.string().trim().min(1).max(300).nullable(),
    riskIndicatorCount: z.number().int().nonnegative(),
    highestRiskSeverity: z.enum(["info", "low", "medium", "high"]).nullable()
  })
  .strict();

export const CanonicalListingCollectionResponseSchema = z
  .object({
    listings: z.array(CanonicalListingSummarySchema),
    count: z.number().int().nonnegative(),
    generatedAt: IsoDateTimeSchema
  })
  .strict()
  .refine((response) => response.listings.length === response.count, {
    message: "Listing response count does not match its collection.",
    path: ["count"]
  });

export const ListingsUnavailableResponseSchema = z
  .object({
    code: z.literal("database_unavailable"),
    message: z.enum([
      "Local listing data is unavailable. Run pnpm db:migrate and pnpm db:seed.",
      "Hosted listing data is unavailable. Check PostgreSQL readiness.",
      "Demo listing data is unavailable. Run pnpm demo:reset and pnpm demo:seed."
    ]),
    generatedAt: IsoDateTimeSchema
  })
  .strict();

export type CanonicalListingSummary = z.infer<typeof CanonicalListingSummarySchema>;
export type CanonicalListingCollectionResponse = z.infer<
  typeof CanonicalListingCollectionResponseSchema
>;
export type ListingsUnavailableResponse = z.infer<typeof ListingsUnavailableResponseSchema>;
