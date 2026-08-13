import { z } from "zod";

import { VeraUserIdSchema } from "./identity.ts";
import { ListingSourceRecordDispositionEventSchema } from "./listing.ts";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.ts";

export const ListingIntegrityRepairInputSchema = z
  .object({
    searchProfileId: EntityIdSchema,
    invalidSourceRecordIds: z.array(EntityIdSchema).min(1).max(100),
    assertSeparatedPairs: z
      .array(z.tuple([EntityIdSchema, EntityIdSchema]))
      .max(20)
      .default([]),
    assertJoinedGroups: z.array(z.array(EntityIdSchema).min(2).max(10)).max(20).default([])
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.invalidSourceRecordIds).size !== input.invalidSourceRecordIds.length) {
      context.addIssue({
        code: "custom",
        path: ["invalidSourceRecordIds"],
        message: "Repair source-record IDs must be unique."
      });
    }
  });

export const ListingIntegrityRepairCountsSchema = z
  .object({
    rawListings: z.number().int().nonnegative(),
    sourceRecords: z.number().int().nonnegative(),
    fieldProvenance: z.number().int().nonnegative(),
    activityEvents: z.number().int().nonnegative()
  })
  .strict();

export const ListingIntegrityVisibleMetricsSchema = z
  .object({
    activeListings: z.number().int().nonnegative(),
    cardsWithPhotos: z.number().int().nonnegative(),
    cardsWithSourceLinks: z.number().int().nonnegative(),
    averageDetailCompletenessBasisPoints: z.number().int().min(0).max(10_000),
    perSource: z.record(
      z.string(),
      z
        .object({
          activeRecords: z.number().int().nonnegative(),
          enrichedRecords: z.number().int().nonnegative(),
          sourceLinks: z.number().int().nonnegative()
        })
        .strict()
    )
  })
  .strict();

export const ListingIntegrityRepairPreviewSchema = z
  .object({
    version: z.literal("listing-integrity-repair.v1"),
    userId: VeraUserIdSchema,
    searchProfileId: EntityIdSchema,
    createdAt: IsoDateTimeSchema,
    corpusRevision: z.number().int().nonnegative(),
    corpusHash: z.string().regex(/^[a-f0-9]{64}$/u),
    dispositions: z.array(ListingSourceRecordDispositionEventSchema).min(1).max(100),
    assertSeparatedPairs: z.array(z.tuple([EntityIdSchema, EntityIdSchema])).max(20),
    assertJoinedGroups: z.array(z.array(EntityIdSchema).min(2).max(10)).max(20),
    predictedCanonicalMembers: z.array(
      z
        .object({
          canonicalListingId: EntityIdSchema,
          memberSourceRecordIds: z.array(EntityIdSchema).min(1)
        })
        .strict()
    ),
    preservedCountsBefore: ListingIntegrityRepairCountsSchema,
    visibleMetricsBefore: ListingIntegrityVisibleMetricsSchema
  })
  .strict();

export type ListingIntegrityRepairInput = z.infer<typeof ListingIntegrityRepairInputSchema>;
export type ListingIntegrityRepairPreview = z.infer<typeof ListingIntegrityRepairPreviewSchema>;
export type ListingIntegrityRepairCounts = z.infer<typeof ListingIntegrityRepairCountsSchema>;
export type ListingIntegrityVisibleMetrics = z.infer<typeof ListingIntegrityVisibleMetricsSchema>;
