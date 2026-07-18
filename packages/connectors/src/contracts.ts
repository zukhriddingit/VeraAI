import {
  ConfidenceBasisPointsSchema,
  ContactChannelSchema,
  ConnectorStatusSchema,
  EntityIdSchema,
  FieldExtractionMethodSchema,
  FieldProvenanceSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ListingCaptureMethodSchema,
  ListingExtractionFieldNameSchema,
  ListingExtractionSchema,
  ListingSourceLabelSchema,
  ListingSourceRecordSchema,
  MoneyCentsSchema,
  NormalizationJobStateSchema,
  SourceCapabilitySchema,
  UnknownFieldReasonSchema,
  type ContactChannel,
  type ConnectorStatus,
  type FieldExtractionMethod,
  type FieldProvenance,
  type ListingCaptureMethod,
  type ListingExtraction,
  type ListingExtractionFieldName,
  type ListingSourceLabel,
  type ListingSourceRecord,
  type NormalizationJobState,
  type SourceCapability,
  type UnknownFieldReason
} from "@vera/domain";
import type { SourcePolicyRegistry } from "@vera/policy";
import { z } from "zod";

export const STRUCTURED_LISTING_MAX_TITLE_LENGTH = 300;
export const CAPTURE_TEXT_MAX_LENGTH = 250_000;

export const StructuredMoneyObservationSchema = z
  .object({
    amountMinorUnits: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    billingPeriod: z.enum(["day", "week", "month", "year"]),
    rawAmount: z.string().trim().min(1).max(200)
  })
  .strict();

export const StructuredRequiredRecurringFeeSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    amount: StructuredMoneyObservationSchema
  })
  .strict();

const StructuredRequiredRecurringFeesSchema = z
  .array(StructuredRequiredRecurringFeeSchema)
  .max(100)
  .superRefine((fees, context) => {
    const labels = fees.map((fee) => fee.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        message: "Recurring-fee labels must be unique."
      });
    }
  });

export const StructuredListingInputSchema = z
  .object({
    source: ListingSourceLabelSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullish(),
    title: z.string().trim().min(1).max(STRUCTURED_LISTING_MAX_TITLE_LENGTH).nullish(),
    url: z.string().trim().min(1).max(2_048).nullish(),
    monthlyRentCents: MoneyCentsSchema.nullish(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullish(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullish(),
    addressText: z.string().trim().min(1).max(300).nullish(),
    squareFeet: z.number().int().positive().max(1_000_000).nullish(),
    propertyType: z.enum(["apartment", "condo", "house", "townhouse", "room", "other"]).nullish(),
    baseRent: StructuredMoneyObservationSchema.nullish(),
    requiredRecurringFees: StructuredRequiredRecurringFeesSchema.nullish(),
    availabilityRaw: z.string().trim().min(1).max(300).nullish(),
    availableOn: IsoDateSchema.nullish(),
    leaseTermMonths: z.number().int().positive().max(120).nullish(),
    catsAllowed: z.boolean().nullish(),
    dogsAllowed: z.boolean().nullish(),
    amenities: z.array(z.string().trim().min(1).max(120)).max(200).nullish(),
    sourcePostedAt: IsoDateTimeSchema.nullish(),
    contactChannel: ContactChannelSchema.nullish(),
    contactName: z.string().trim().min(1).max(200).nullish(),
    contactEmail: z.email().max(320).nullish(),
    contactPhone: z
      .string()
      .trim()
      .min(7)
      .max(80)
      .regex(/^\+?[0-9][0-9().\s-]*[0-9]$/u)
      .nullish(),
    contactUrl: z
      .string()
      .url()
      .max(2_048)
      .regex(/^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?][^\s#]*)?$/u)
      .nullish()
  })
  .strict();

export type StructuredListingInput = z.infer<typeof StructuredListingInputSchema>;

export const FixtureCaptureRequestSchema = z
  .object({
    kind: z.literal("fixture"),
    sanitized: z.literal(true),
    listing: StructuredListingInputSchema
  })
  .strict();

export const ManualTextCaptureRequestSchema = z
  .object({
    kind: z.literal("manual_text"),
    sourceUrl: z.string().trim().min(1).max(2_048),
    listingText: z.string().min(1).max(CAPTURE_TEXT_MAX_LENGTH)
  })
  .strict();

export const ManualStructuredCaptureRequestSchema = z
  .object({
    kind: z.literal("manual_structured"),
    sourceUrl: z.string().trim().min(1).max(2_048).optional(),
    listing: StructuredListingInputSchema
  })
  .strict();

export const CaptureRequestSchema = z.discriminatedUnion("kind", [
  FixtureCaptureRequestSchema,
  ManualTextCaptureRequestSchema,
  ManualStructuredCaptureRequestSchema
]);

export type FixtureCaptureRequest = z.infer<typeof FixtureCaptureRequestSchema>;
export type ManualTextCaptureRequest = z.infer<typeof ManualTextCaptureRequestSchema>;
export type ManualStructuredCaptureRequest = z.infer<typeof ManualStructuredCaptureRequestSchema>;
export type ManualCaptureRequest = ManualTextCaptureRequest | ManualStructuredCaptureRequest;
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const BrowserAccessDispositionSchema = z.enum([
  "policy_entry_present",
  "manual_policy_required",
  "not_applicable"
]);

export type BrowserAccessDisposition = z.infer<typeof BrowserAccessDispositionSchema>;

export const CaptureMetadataSchema = z
  .object({
    networkAccess: z.literal(false),
    untrustedContent: z.literal(true),
    browserAccess: BrowserAccessDispositionSchema
  })
  .strict();

export interface RawListingEnvelope {
  readonly connectorId: string;
  readonly capability: "fixture.read" | "manual.capture";
  readonly source: ListingSourceLabel;
  readonly sourceListingId: string | null;
  readonly sourceUrl: string | null;
  readonly captureMethod: ListingCaptureMethod;
  readonly observedAt: string;
  readonly sourcePostedAt: string | null;
  readonly rawText: string | null;
  readonly rawJson: StructuredListingInput | null;
  readonly captureMetadata: {
    readonly networkAccess: false;
    readonly untrustedContent: true;
    readonly browserAccess: BrowserAccessDisposition;
  };
}

export const RawListingEnvelopeSchema: z.ZodType<RawListingEnvelope> = z
  .object({
    connectorId: EntityIdSchema,
    capability: SourceCapabilitySchema.extract(["fixture.read", "manual.capture"]),
    source: ListingSourceLabelSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    sourceUrl: z.string().url().max(2_048).nullable(),
    captureMethod: ListingCaptureMethodSchema,
    observedAt: IsoDateTimeSchema,
    sourcePostedAt: IsoDateTimeSchema.nullable(),
    rawText: z.string().min(1).max(CAPTURE_TEXT_MAX_LENGTH).nullable(),
    rawJson: StructuredListingInputSchema.nullable(),
    captureMetadata: CaptureMetadataSchema
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.rawText === null && envelope.rawJson === null) {
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "A raw listing envelope requires text or structured evidence."
      });
    }
  });

export const NormalizationStateSchema = NormalizationJobStateSchema;

export type NormalizationState = NormalizationJobState;

export interface CaptureResult {
  readonly correlationId: string;
  readonly rawListingId: string;
  readonly contentHash: string;
  readonly inserted: boolean;
  readonly duplicate: boolean;
  readonly normalizationJobId: string | null;
  readonly normalizationState: NormalizationState;
}

export const CaptureResultSchema: z.ZodType<CaptureResult> = z
  .object({
    correlationId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inserted: z.boolean(),
    duplicate: z.boolean(),
    normalizationJobId: EntityIdSchema.nullable(),
    normalizationState: NormalizationStateSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (result.inserted === result.duplicate) {
      context.addIssue({
        code: "custom",
        path: ["duplicate"],
        message: "Inserted and duplicate must be logical opposites."
      });
    }
  });

export const ConnectorHealthSchema = ConnectorStatusSchema;

export type ConnectorHealth = ConnectorStatus;

export interface ConnectorContext {
  readonly correlationId: string;
  now(): Date;
  createId(): string;
}

export interface SourceConnector<Request extends CaptureRequest = CaptureRequest> {
  readonly connectorId: string;
  readonly displayName: string;
  readonly capability: "fixture.read" | "manual.capture";
  supports(request: CaptureRequest): request is Request;
  capture(request: Request, context: ConnectorContext): RawListingEnvelope;
  health(registry: SourcePolicyRegistry): ConnectorHealth;
}

export interface KnownNormalizedField<T> {
  readonly status: "known";
  readonly value: T;
  readonly extractionMethod: FieldExtractionMethod;
  readonly confidenceBasisPoints: number;
  readonly observedAt: string;
  readonly evidenceExcerpt: string | null;
}

export interface UnknownNormalizedField {
  readonly status: "unknown";
  readonly value: null;
  readonly extractionMethod: FieldExtractionMethod;
  readonly confidenceBasisPoints: 0;
  readonly observedAt: string;
  readonly unknownReason: UnknownFieldReason;
  readonly evidenceExcerpt: null;
}

export type NormalizedField<T> = KnownNormalizedField<T> | UnknownNormalizedField;

export interface NormalizedListingFields {
  readonly title: NormalizedField<string>;
  readonly url: NormalizedField<string>;
  readonly source: NormalizedField<ListingSourceLabel>;
  readonly monthlyRentCents: NormalizedField<number>;
  readonly bedrooms: NormalizedField<number>;
  readonly bathrooms: NormalizedField<number>;
  readonly addressText: NormalizedField<string>;
  readonly sourcePostedAt: NormalizedField<string>;
  readonly contactChannel: NormalizedField<ContactChannel>;
}

const UnknownNormalizedFieldSchema = z
  .object({
    status: z.literal("unknown"),
    value: z.null(),
    extractionMethod: z.enum(["fixture_structured", "manual", "rule", "ai"]),
    confidenceBasisPoints: z.literal(0),
    observedAt: IsoDateTimeSchema,
    unknownReason: UnknownFieldReasonSchema,
    evidenceExcerpt: z.null()
  })
  .strict();

function normalizedFieldSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("known"),
        value: valueSchema,
        extractionMethod: z.enum(["fixture_structured", "manual", "rule", "ai"]),
        confidenceBasisPoints: ConfidenceBasisPointsSchema.refine((value) => value > 0),
        observedAt: IsoDateTimeSchema,
        evidenceExcerpt: z.string().trim().min(1).max(1_000).nullable()
      })
      .strict(),
    UnknownNormalizedFieldSchema
  ]);
}

export const NormalizedListingFieldsSchema = z
  .object({
    title: normalizedFieldSchema(z.string().trim().min(1).max(300)),
    url: normalizedFieldSchema(z.string().url().max(2_048)),
    source: normalizedFieldSchema(ListingSourceLabelSchema),
    monthlyRentCents: normalizedFieldSchema(MoneyCentsSchema),
    bedrooms: normalizedFieldSchema(z.number().nonnegative().max(50).multipleOf(0.5)),
    bathrooms: normalizedFieldSchema(z.number().nonnegative().max(50).multipleOf(0.5)),
    addressText: normalizedFieldSchema(z.string().trim().min(1).max(300)),
    sourcePostedAt: normalizedFieldSchema(IsoDateTimeSchema),
    contactChannel: normalizedFieldSchema(ContactChannelSchema)
  })
  .strict();

export interface NormalizationResult {
  readonly sourceRecord: ListingSourceRecord;
  readonly fields: NormalizedListingFields;
  readonly extraction: ListingExtraction;
  readonly extractionMethods: Readonly<Record<ListingExtractionFieldName, FieldExtractionMethod>>;
  readonly provenance: readonly FieldProvenance[];
}

export const ExtractionMethodMapSchema = z.record(
  ListingExtractionFieldNameSchema,
  FieldExtractionMethodSchema
);

export const NormalizationResultSchema: z.ZodType<NormalizationResult> = z
  .object({
    sourceRecord: ListingSourceRecordSchema,
    fields: NormalizedListingFieldsSchema,
    extraction: ListingExtractionSchema,
    extractionMethods: ExtractionMethodMapSchema,
    provenance: z.array(FieldProvenanceSchema).length(22)
  })
  .strict();

export interface NormalizationContext {
  readonly rawListingId: string;
  createId(): string;
  now(): Date;
}

export type ConnectorCapability = Extract<SourceCapability, "fixture.read" | "manual.capture">;
