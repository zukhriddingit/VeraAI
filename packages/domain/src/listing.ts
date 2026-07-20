import { z } from "zod";

import {
  ConfidenceBasisPointsSchema,
  acquisitionModeForListingCaptureMethod,
  EntityIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  ListingCaptureMethodSchema,
  ListingSourceLabelSchema,
  MoneyCentsSchema,
  PercentageBasisPointsSchema,
  Sha256Schema
} from "./primitives.ts";
import { AcquisitionModeSchema } from "./source-policy.ts";

export const RAW_LISTING_JSON_MAX_BYTES = 250_000;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export const RawListingJsonEvidenceSchema = JsonValueSchema.refine(
  (value) => utf8ByteLength(JSON.stringify(value)) <= RAW_LISTING_JSON_MAX_BYTES,
  `Raw listing JSON cannot exceed ${RAW_LISTING_JSON_MAX_BYTES} serialized bytes.`
);

export const ListingLifecycleStateSchema = z.enum([
  "new",
  "shortlisted",
  "draft_ready",
  "draft_created",
  "draft_rejected",
  "replied",
  "follow_up_due",
  "tour_proposed",
  "tour_scheduled",
  "toured",
  "applying",
  "passed",
  "dismissed",
  "stale",
  "unavailable"
]);

export const ListingAddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(300).nullable(),
    unit: z.string().trim().min(1).max(80).nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    region: z.string().trim().min(1).max(80).nullable(),
    postalCode: z.string().trim().min(1).max(24).nullable(),
    countryCode: z.string().length(2).toUpperCase().nullable()
  })
  .strict();

export const PetPermissionSchema = z.enum(["allowed", "not_allowed", "unknown"]);

export const PetPolicySchema = z
  .object({
    cats: PetPermissionSchema,
    dogs: PetPermissionSchema,
    notes: z.string().trim().min(1).max(500).nullable()
  })
  .strict();

export const ContactChannelSchema = z.enum([
  "email",
  "phone",
  "platform_message",
  "website_form",
  "other",
  "unknown"
]);

export const PropertyTypeSchema = z.enum([
  "apartment",
  "condo",
  "house",
  "townhouse",
  "room",
  "other"
]);

export const RawListingCaptureSchema = z
  .object({
    id: EntityIdSchema,
    source: ListingSourceLabelSchema,
    acquisitionMode: AcquisitionModeSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    sourceUrl: z.string().url().max(2_048).nullable(),
    captureMethod: ListingCaptureMethodSchema,
    observedAt: IsoDateTimeSchema,
    sourcePostedAt: IsoDateTimeSchema.nullable(),
    rawText: z.string().min(1).max(250_000).nullable(),
    rawJson: RawListingJsonEvidenceSchema.nullable(),
    captureMetadata: JsonObjectSchema
  })
  .strict()
  .superRefine((capture, context) => {
    if (capture.rawText === null && capture.rawJson === null) {
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "A raw listing requires raw text or raw JSON evidence."
      });
    }

    const expectedMode = acquisitionModeForListingCaptureMethod(capture.captureMethod);
    if (capture.acquisitionMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["acquisitionMode"],
        message: "Raw-listing acquisition mode must match its capture method."
      });
    }
  });

export const RawListingSchema = RawListingCaptureSchema.extend({
  contentHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  createdAt: IsoDateTimeSchema
}).strict();

export const ListingSourceRecordSchema = z
  .object({
    id: EntityIdSchema,
    rawListingId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    sourceUrl: z.string().url().max(2_048).nullable(),
    sourcePostedAt: IsoDateTimeSchema.nullable(),
    contactChannel: ContactChannelSchema,
    title: z.string().trim().min(1).max(300),
    address: ListingAddressSchema,
    monthlyRentCents: MoneyCentsSchema.nullable(),
    recurringFeesCents: MoneyCentsSchema.nullable(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    latitude: z.number().finite().min(-90).max(90).nullable().default(null),
    longitude: z.number().finite().min(-180).max(180).nullable().default(null),
    propertyType: PropertyTypeSchema.nullable(),
    availableOn: IsoDateSchema.nullable(),
    leaseTermMonths: z.number().int().positive().max(120).nullable(),
    petPolicy: PetPolicySchema.nullable(),
    amenities: z.array(z.string().trim().min(1).max(120)),
    description: z.string().trim().min(1).max(20_000).nullable(),
    extractionConfidenceBasisPoints: ConfidenceBasisPointsSchema,
    completenessBasisPoints: PercentageBasisPointsSchema,
    observedAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((record, context) => {
    if ((record.latitude === null) !== (record.longitude === null)) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Listing coordinates require both latitude and longitude or neither."
      });
    }
  });

export const ListingPhotoSchema = z
  .object({
    id: EntityIdSchema,
    listingSourceRecordId: EntityIdSchema,
    sourceUrl: z.string().url().max(2_048).nullable(),
    fixtureAssetLabel: z.string().trim().min(1).max(300).nullable(),
    byteHash: Sha256Schema.nullable(),
    byteSize: z.number().int().positive().max(10_000_000).nullable().default(null),
    width: z.number().int().positive().max(10_000).nullable().default(null),
    height: z.number().int().positive().max(10_000).nullable().default(null),
    mimeType: z
      .enum(["image/jpeg", "image/png", "image/webp", "image/avif"])
      .nullable()
      .default(null),
    perceptualHash: z
      .string()
      .regex(/^[a-f0-9]{16,128}$/u)
      .nullable(),
    perceptualHashVersion: z.string().trim().min(1).max(100).nullable().default(null),
    position: z.number().int().nonnegative(),
    observedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((photo, context) => {
    if (photo.sourceUrl === null && photo.fixtureAssetLabel === null) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Photo metadata requires an inert URL or fixture asset label."
      });
    }

    const decodedMetadata = [photo.byteSize, photo.width, photo.height, photo.mimeType];
    const metadataCount = decodedMetadata.filter((value) => value !== null).length;
    if (metadataCount !== 0 && metadataCount !== decodedMetadata.length) {
      context.addIssue({
        code: "custom",
        path: ["byteSize"],
        message:
          "Decoded photo metadata must include byte size, dimensions, and MIME type together."
      });
    }
    if ((photo.perceptualHash === null) !== (photo.perceptualHashVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["perceptualHashVersion"],
        message: "Perceptual hashes require a version and vice versa."
      });
    }
  });

export const FieldExtractionMethodSchema = z.enum(["fixture_structured", "manual", "rule", "ai"]);
export const ProvenanceValueStatusSchema = z.enum(["known", "unknown"]);
export const UnknownFieldReasonSchema = z.enum([
  "missing_evidence",
  "unrecognized_format",
  "not_applicable"
]);

export const FieldProvenanceSchema = z
  .object({
    id: EntityIdSchema,
    listingSourceRecordId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    fieldPath: z.string().trim().min(1).max(200),
    extractionMethod: FieldExtractionMethodSchema,
    valueStatus: ProvenanceValueStatusSchema,
    unknownReason: UnknownFieldReasonSchema.nullable(),
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    observedAt: IsoDateTimeSchema,
    evidenceExcerpt: z.string().trim().min(1).max(1_000).nullable()
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.valueStatus === "known" && provenance.unknownReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["unknownReason"],
        message: "Known field provenance cannot carry an unknown reason."
      });
    }

    if (provenance.valueStatus === "unknown") {
      if (provenance.unknownReason === null) {
        context.addIssue({
          code: "custom",
          path: ["unknownReason"],
          message: "Unknown field provenance requires a reason."
        });
      }

      if (provenance.confidenceBasisPoints !== 0) {
        context.addIssue({
          code: "custom",
          path: ["confidenceBasisPoints"],
          message: "Unknown field provenance must have zero confidence."
        });
      }
    }
  });

export const DuplicateClusterSchema = z
  .object({
    id: EntityIdSchema,
    clusterKey: Sha256Schema,
    algorithmVersion: z.string().trim().min(1).max(100),
    reasonCodes: z.array(z.string().trim().min(1).max(100)).min(1),
    memberSourceRecordIds: z.array(EntityIdSchema).min(2),
    createdAt: IsoDateTimeSchema
  })
  .strict();

export const CanonicalListingSchema = z
  .object({
    id: EntityIdSchema,
    duplicateClusterId: EntityIdSchema.nullable(),
    primarySourceRecordId: EntityIdSchema,
    title: z.string().trim().min(1).max(300),
    address: ListingAddressSchema,
    monthlyRentCents: MoneyCentsSchema.nullable(),
    recurringFeesCents: MoneyCentsSchema.nullable(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    propertyType: PropertyTypeSchema.nullable(),
    availableOn: IsoDateSchema.nullable(),
    leaseTermMonths: z.number().int().positive().max(120).nullable(),
    petPolicy: PetPolicySchema.nullable(),
    amenities: z.array(z.string().trim().min(1).max(120)),
    description: z.string().trim().min(1).max(20_000).nullable(),
    lifecycleState: ListingLifecycleStateSchema,
    projectionState: z.enum(["active", "superseded"]).default("active"),
    supersededById: EntityIdSchema.nullable().default(null),
    stitchVersion: z.string().trim().min(1).max(100).nullable().default(null),
    stitchInputHash: Sha256Schema.nullable().default(null),
    updatedByDecisionRunId: EntityIdSchema.nullable().default(null),
    completenessBasisPoints: PercentageBasisPointsSchema,
    freshestObservedAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((listing, context) => {
    if (listing.projectionState === "active" && listing.supersededById !== null) {
      context.addIssue({
        code: "custom",
        path: ["supersededById"],
        message: "Active canonical listings cannot redirect to a survivor."
      });
    }
    if (listing.projectionState === "superseded" && listing.supersededById === null) {
      context.addIssue({
        code: "custom",
        path: ["supersededById"],
        message: "Superseded canonical listings require a survivor redirect."
      });
    }
    if ((listing.stitchVersion === null) !== (listing.stitchInputHash === null)) {
      context.addIssue({
        code: "custom",
        path: ["stitchInputHash"],
        message: "Canonical stitch version and input hash must be set together."
      });
    }
  });

export const CanonicalListingSourceSchema = z
  .object({
    canonicalListingId: EntityIdSchema,
    listingSourceRecordId: EntityIdSchema,
    isPrimary: z.boolean()
  })
  .strict();

export const CanonicalFieldSourceSchema = z
  .object({
    canonicalListingId: EntityIdSchema,
    fieldPath: z.string().trim().min(1).max(200),
    fieldProvenanceId: EntityIdSchema
  })
  .strict();

export const ScoreFactorSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    scoreBasisPoints: z.number().int().min(-10_000).max(10_000),
    weightBasisPoints: PercentageBasisPointsSchema,
    reasonCode: z.string().trim().min(1).max(100)
  })
  .strict();

export const ListingScoreSchema = z
  .object({
    id: EntityIdSchema,
    canonicalListingId: EntityIdSchema,
    searchProfileId: EntityIdSchema.nullable(),
    algorithmVersion: z.string().trim().min(1).max(100),
    inputHash: Sha256Schema,
    totalScoreBasisPoints: z.number().int().min(-10_000).max(10_000),
    factors: z.array(ScoreFactorSchema),
    reasonCodes: z.array(z.string().trim().min(1).max(100)),
    computedAt: IsoDateTimeSchema
  })
  .strict();

export const RiskEvidenceSchema = z
  .object({
    sourceRecordId: EntityIdSchema,
    fieldPath: z.string().trim().min(1).max(200).nullable(),
    summary: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const RiskSignalSchema = z
  .object({
    id: EntityIdSchema,
    canonicalListingId: EntityIdSchema,
    code: z.string().trim().min(1).max(100),
    severity: z.enum(["info", "low", "medium", "high"]),
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    evidence: z.array(RiskEvidenceSchema).min(1),
    verificationAction: z.string().trim().min(1).max(1_000),
    status: z.enum(["open", "verified", "dismissed"]),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export type ListingLifecycleState = z.infer<typeof ListingLifecycleStateSchema>;
export type ListingAddress = z.infer<typeof ListingAddressSchema>;
export type PetPolicy = z.infer<typeof PetPolicySchema>;
export type ContactChannel = z.infer<typeof ContactChannelSchema>;
export type PropertyType = z.infer<typeof PropertyTypeSchema>;
export type RawListingCapture = z.infer<typeof RawListingCaptureSchema>;
export type RawListing = z.infer<typeof RawListingSchema>;
export type ListingSourceRecord = z.infer<typeof ListingSourceRecordSchema>;
export type ListingPhoto = z.infer<typeof ListingPhotoSchema>;
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;
export type FieldExtractionMethod = z.infer<typeof FieldExtractionMethodSchema>;
export type ProvenanceValueStatus = z.infer<typeof ProvenanceValueStatusSchema>;
export type UnknownFieldReason = z.infer<typeof UnknownFieldReasonSchema>;
export type DuplicateCluster = z.infer<typeof DuplicateClusterSchema>;
export type CanonicalListing = z.infer<typeof CanonicalListingSchema>;
export type CanonicalListingSource = z.infer<typeof CanonicalListingSourceSchema>;
export type CanonicalFieldSource = z.infer<typeof CanonicalFieldSourceSchema>;
export type ListingScore = z.infer<typeof ListingScoreSchema>;
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;
export type RiskSignal = z.infer<typeof RiskSignalSchema>;
export type RiskEvidence = z.infer<typeof RiskEvidenceSchema>;
