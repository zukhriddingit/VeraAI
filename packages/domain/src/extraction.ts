import { z } from "zod";

import { ContactChannelSchema, PropertyTypeSchema } from "./listing.ts";
import { EntityIdSchema, IsoDateSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const LISTING_EXTRACTION_PROMPT_VERSION = "listing-extraction.prompt.v1" as const;
export const LISTING_EXTRACTION_VERSION = "listing-extraction.v2" as const;
export const ListingExtractionVersionSchema = z.enum([
  "listing-extraction.v1",
  LISTING_EXTRACTION_VERSION
]);

export const ListingExtractionFieldNameSchema = z.enum([
  "title",
  "bedrooms",
  "bathrooms",
  "addressText",
  "squareFeet",
  "propertyType",
  "baseRent",
  "requiredRecurringFees",
  "availabilityRaw",
  "availableOn",
  "leaseTermMonths",
  "catsAllowed",
  "dogsAllowed",
  "amenities",
  "sourcePostedAt",
  "contactChannel",
  "contactName",
  "contactEmail",
  "contactPhone",
  "contactUrl"
]);

export const ExtractionUnknownReasonSchema = z.enum([
  "not_present",
  "ambiguous",
  "conflicting_evidence",
  "unrecognized_format"
]);

const KnownConfidenceSchema = z.number().int().min(1).max(10_000);
const EvidenceSnippetSchema = z.string().trim().min(1).max(1_000);

export function extractedFieldSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("known"),
        value: valueSchema,
        confidenceBasisPoints: KnownConfidenceSchema,
        evidenceSnippet: EvidenceSnippetSchema
      })
      .strict(),
    z
      .object({
        status: z.literal("unknown"),
        value: z.null(),
        confidenceBasisPoints: z.literal(0),
        evidenceSnippet: z.null(),
        reason: ExtractionUnknownReasonSchema
      })
      .strict()
  ]);
}

export type ExtractedField<Value> =
  | {
      status: "known";
      value: Value;
      confidenceBasisPoints: number;
      evidenceSnippet: string;
    }
  | {
      status: "unknown";
      value: null;
      confidenceBasisPoints: 0;
      evidenceSnippet: null;
      reason: ExtractionUnknownReason;
    };

export const MoneyObservationSchema = z
  .object({
    amountMinorUnits: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    billingPeriod: z.enum(["day", "week", "month", "year"]),
    rawAmount: z.string().trim().min(1).max(200)
  })
  .strict();

export const RequiredRecurringFeeSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    amount: MoneyObservationSchema
  })
  .strict();

const RequiredRecurringFeesSchema = z
  .array(RequiredRecurringFeeSchema)
  .max(100)
  .superRefine((fees, context) => {
    const labels = fees.map((fee) => fee.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Recurring-fee labels must be unique." });
    }
  });

const ExtractionIsoDateSchema = IsoDateSchema.refine((value) => {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}, "Date must be a real ISO calendar date.");

export const SafeExtractionHttpUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .regex(
    /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?][^\s#]*)?$/u,
    "Extraction URLs must use a public HTTP(S) hostname without credentials, ports, or fragments."
  )
  .refine((value) => {
    const hostname = value.slice(value.indexOf("//") + 2).split(/[/?]/u, 1)[0] ?? "";
    return !hostname.endsWith(".local") && !hostname.endsWith(".localhost");
  }, "Extraction URLs cannot target local hostnames.");

const ContactPhoneTextSchema = z
  .string()
  .trim()
  .min(7)
  .max(80)
  .regex(/^\+?[0-9][0-9().\s-]*[0-9]$/u)
  .refine((value) => {
    const digitCount = value.replace(/\D/gu, "").length;
    return digitCount >= 7 && digitCount <= 20;
  }, "Phone text must contain between 7 and 20 digits.");

const AmenitiesSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(200)
  .superRefine((amenities, context) => {
    const labels = amenities.map((amenity) => amenity.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Amenity labels must be unique." });
    }
  });

export const ExtractedTitleSchema = extractedFieldSchema(z.string().trim().min(1).max(300));
export const ExtractedBedroomsSchema = extractedFieldSchema(
  z.number().nonnegative().max(50).multipleOf(0.5)
);
export const ExtractedBathroomsSchema = extractedFieldSchema(
  z.number().nonnegative().max(50).multipleOf(0.5)
);
export const ExtractedAddressTextSchema = extractedFieldSchema(z.string().trim().min(1).max(300));
export const ExtractedSquareFeetSchema = extractedFieldSchema(
  z.number().int().positive().max(1_000_000)
);
export const ExtractedPropertyTypeSchema = extractedFieldSchema(PropertyTypeSchema);
export const ExtractedBaseRentSchema = extractedFieldSchema(MoneyObservationSchema);
export const ExtractedRequiredRecurringFeesSchema = extractedFieldSchema(
  RequiredRecurringFeesSchema
);
export const ExtractedAvailabilityRawSchema = extractedFieldSchema(
  z.string().trim().min(1).max(300)
);
export const ExtractedAvailableOnSchema = extractedFieldSchema(ExtractionIsoDateSchema);
export const ExtractedLeaseTermMonthsSchema = extractedFieldSchema(
  z.number().int().positive().max(120)
);
export const ExtractedCatsAllowedSchema = extractedFieldSchema(z.boolean());
export const ExtractedDogsAllowedSchema = extractedFieldSchema(z.boolean());
export const ExtractedAmenitiesSchema = extractedFieldSchema(AmenitiesSchema);
export const ExtractedSourcePostedAtSchema = extractedFieldSchema(IsoDateTimeSchema);
export const ExtractedContactChannelSchema = extractedFieldSchema(
  ContactChannelSchema.exclude(["unknown"])
);
export const ExtractedContactNameSchema = extractedFieldSchema(z.string().trim().min(1).max(200));
export const ExtractedContactEmailSchema = extractedFieldSchema(z.string().trim().email().max(320));
export const ExtractedContactPhoneSchema = extractedFieldSchema(ContactPhoneTextSchema);
export const ExtractedContactUrlSchema = extractedFieldSchema(SafeExtractionHttpUrlSchema);

export const ListingExtractionSchema = z
  .object({
    title: ExtractedTitleSchema,
    bedrooms: ExtractedBedroomsSchema,
    bathrooms: ExtractedBathroomsSchema,
    addressText: ExtractedAddressTextSchema,
    squareFeet: ExtractedSquareFeetSchema,
    propertyType: ExtractedPropertyTypeSchema,
    baseRent: ExtractedBaseRentSchema,
    requiredRecurringFees: ExtractedRequiredRecurringFeesSchema,
    availabilityRaw: ExtractedAvailabilityRawSchema,
    availableOn: ExtractedAvailableOnSchema,
    leaseTermMonths: ExtractedLeaseTermMonthsSchema,
    catsAllowed: ExtractedCatsAllowedSchema,
    dogsAllowed: ExtractedDogsAllowedSchema,
    amenities: ExtractedAmenitiesSchema,
    sourcePostedAt: ExtractedSourcePostedAtSchema,
    contactChannel: ExtractedContactChannelSchema,
    contactName: ExtractedContactNameSchema,
    contactEmail: ExtractedContactEmailSchema,
    contactPhone: ExtractedContactPhoneSchema,
    contactUrl: ExtractedContactUrlSchema
  })
  .strict();

export const ListingExtractionFieldRequestSchema = z
  .object({
    field: ListingExtractionFieldNameSchema,
    reason: ExtractionUnknownReasonSchema
  })
  .strict();

export const ListingExtractionRequestSchema = z
  .object({
    evidenceText: z.string().min(1).max(300_000),
    inputHash: Sha256Schema,
    fieldRequests: z.array(ListingExtractionFieldRequestSchema).min(1).max(20),
    promptVersion: z.literal(LISTING_EXTRACTION_PROMPT_VERSION),
    extractionVersion: z.literal(LISTING_EXTRACTION_VERSION)
  })
  .strict()
  .superRefine((request, context) => {
    const fields = request.fieldRequests.map((fieldRequest) => fieldRequest.field);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: "custom",
        path: ["fieldRequests"],
        message: "Each extraction field may be requested only once."
      });
    }
  });

export const ListingExtractionUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().safe(),
    outputTokens: z.number().int().nonnegative().safe(),
    totalTokens: z.number().int().nonnegative().safe()
  })
  .strict()
  .refine((usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens, {
    message: "Total tokens must equal input plus output tokens.",
    path: ["totalTokens"]
  });

export const ListingExtractionProviderResultSchema = z
  .object({
    providerId: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(300),
    responseId: z.string().trim().min(1).max(500).nullable(),
    extraction: ListingExtractionSchema,
    usage: ListingExtractionUsageSchema,
    latencyMilliseconds: z.number().int().nonnegative().safe(),
    repairCount: z.number().int().min(0).max(1)
  })
  .strict();

export const ListingExtractionModeSchema = z.enum(["deterministic_only", "llm_augmented"]);

const UniqueRequestedFieldsSchema = z
  .array(ListingExtractionFieldNameSchema)
  .max(20)
  .superRefine((fields, context) => {
    if (new Set(fields).size !== fields.length) {
      context.addIssue({ code: "custom", message: "Requested extraction fields must be unique." });
    }
  });

export const ListingExtractionRunSchema = z
  .object({
    id: EntityIdSchema,
    rawListingId: EntityIdSchema,
    listingSourceRecordId: EntityIdSchema,
    mode: ListingExtractionModeSchema,
    inputHash: Sha256Schema,
    requestedFields: UniqueRequestedFieldsSchema,
    providerId: z.string().trim().min(1).max(160).nullable(),
    model: z.string().trim().min(1).max(300).nullable(),
    responseId: z.string().trim().min(1).max(500).nullable(),
    promptVersion: z.literal(LISTING_EXTRACTION_PROMPT_VERSION),
    extractionVersion: ListingExtractionVersionSchema,
    providerResult: ListingExtractionProviderResultSchema.nullable(),
    mergedExtraction: ListingExtractionSchema,
    usage: ListingExtractionUsageSchema,
    latencyMilliseconds: z.number().int().nonnegative().safe(),
    repairCount: z.number().int().min(0).max(1),
    completedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((run, context) => {
    if (run.mode === "deterministic_only") {
      const hasProviderMetadata =
        run.providerId !== null ||
        run.model !== null ||
        run.responseId !== null ||
        run.providerResult !== null;
      const hasProviderMetrics =
        run.usage.inputTokens !== 0 ||
        run.usage.outputTokens !== 0 ||
        run.usage.totalTokens !== 0 ||
        run.latencyMilliseconds !== 0 ||
        run.repairCount !== 0;
      if (hasProviderMetadata || hasProviderMetrics) {
        context.addIssue({
          code: "custom",
          path: ["mode"],
          message: "Deterministic-only runs cannot contain provider metadata or usage."
        });
      }
      return;
    }

    if (run.requestedFields.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requestedFields"],
        message: "LLM-augmented runs require at least one requested field."
      });
    }
    if (run.providerId === null || run.model === null || run.providerResult === null) {
      context.addIssue({
        code: "custom",
        path: ["providerResult"],
        message: "LLM-augmented runs require provider metadata and a validated result."
      });
      return;
    }

    const result = run.providerResult;
    const metadataMatches =
      run.providerId === result.providerId &&
      run.model === result.model &&
      run.responseId === result.responseId;
    const metricsMatch =
      run.usage.inputTokens === result.usage.inputTokens &&
      run.usage.outputTokens === result.usage.outputTokens &&
      run.usage.totalTokens === result.usage.totalTokens &&
      run.latencyMilliseconds === result.latencyMilliseconds &&
      run.repairCount === result.repairCount;
    if (!metadataMatches || !metricsMatch) {
      context.addIssue({
        code: "custom",
        path: ["providerResult"],
        message: "Run provider metadata and metrics must match the validated provider result."
      });
    }
  });

export type ListingExtractionFieldName = z.infer<typeof ListingExtractionFieldNameSchema>;
export type ListingExtractionVersion = z.infer<typeof ListingExtractionVersionSchema>;
export type ExtractionUnknownReason = z.infer<typeof ExtractionUnknownReasonSchema>;
export type MoneyObservation = z.infer<typeof MoneyObservationSchema>;
export type RequiredRecurringFee = z.infer<typeof RequiredRecurringFeeSchema>;
export type ExtractedTitle = z.infer<typeof ExtractedTitleSchema>;
export type ExtractedBedrooms = z.infer<typeof ExtractedBedroomsSchema>;
export type ExtractedBathrooms = z.infer<typeof ExtractedBathroomsSchema>;
export type ExtractedAddressText = z.infer<typeof ExtractedAddressTextSchema>;
export type ExtractedSquareFeet = z.infer<typeof ExtractedSquareFeetSchema>;
export type ExtractedPropertyType = z.infer<typeof ExtractedPropertyTypeSchema>;
export type ExtractedBaseRent = z.infer<typeof ExtractedBaseRentSchema>;
export type ExtractedRequiredRecurringFees = z.infer<typeof ExtractedRequiredRecurringFeesSchema>;
export type ExtractedAvailabilityRaw = z.infer<typeof ExtractedAvailabilityRawSchema>;
export type ExtractedAvailableOn = z.infer<typeof ExtractedAvailableOnSchema>;
export type ExtractedLeaseTermMonths = z.infer<typeof ExtractedLeaseTermMonthsSchema>;
export type ExtractedCatsAllowed = z.infer<typeof ExtractedCatsAllowedSchema>;
export type ExtractedDogsAllowed = z.infer<typeof ExtractedDogsAllowedSchema>;
export type ExtractedAmenities = z.infer<typeof ExtractedAmenitiesSchema>;
export type ExtractedSourcePostedAt = z.infer<typeof ExtractedSourcePostedAtSchema>;
export type ExtractedContactChannel = z.infer<typeof ExtractedContactChannelSchema>;
export type ExtractedContactName = z.infer<typeof ExtractedContactNameSchema>;
export type ExtractedContactEmail = z.infer<typeof ExtractedContactEmailSchema>;
export type ExtractedContactPhone = z.infer<typeof ExtractedContactPhoneSchema>;
export type ExtractedContactUrl = z.infer<typeof ExtractedContactUrlSchema>;
export type ListingExtraction = z.infer<typeof ListingExtractionSchema>;
export type ListingExtractionFieldRequest = z.infer<typeof ListingExtractionFieldRequestSchema>;
export type ListingExtractionRequest = z.infer<typeof ListingExtractionRequestSchema>;
export type ListingExtractionUsage = z.infer<typeof ListingExtractionUsageSchema>;
export type ListingExtractionProviderResult = z.infer<typeof ListingExtractionProviderResultSchema>;
export type ListingExtractionMode = z.infer<typeof ListingExtractionModeSchema>;
export type ListingExtractionRun = z.infer<typeof ListingExtractionRunSchema>;
