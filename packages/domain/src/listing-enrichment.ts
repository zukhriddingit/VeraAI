import { z } from "zod";

import { ContactChannelSchema, PetPolicySchema, PropertyTypeSchema } from "./listing.ts";
import {
  EntityIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ListingSourceLabelSchema,
  MoneyCentsSchema,
  PercentageBasisPointsSchema,
  Sha256Schema,
  type ListingSourceLabel
} from "./primitives.ts";

const ContactFreeListingTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value) &&
      !/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/u.test(value),
    "Enrichment text cannot retain email addresses or phone numbers."
  );

export const ListingEnrichmentStateSchema = z.enum([
  "not_requested",
  "queued",
  "enriching",
  "enriched",
  "partial",
  "blocked_manual_action",
  "stale",
  "failed"
]);

export const ListingEnrichmentReasonSchema = z.enum([
  "search_top_three",
  "listing_opened",
  "listing_shortlisted",
  "user_refresh"
]);

export const ListingEnrichmentManualActionSchema = z.enum([
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

export const ListingFeeSchema = z
  .object({
    kind: z.enum([
      "required_recurring",
      "deposit",
      "application",
      "broker",
      "pet",
      "parking",
      "other"
    ]),
    label: z.string().trim().min(1).max(160),
    amountCents: MoneyCentsSchema.nullable(),
    cadence: z.enum(["month", "one_time", "year", "unknown"]),
    required: z.boolean()
  })
  .strict();

export const ListingParkingSchema = z
  .object({
    availability: z.enum(["available", "not_available", "unknown"]),
    description: z.string().trim().min(1).max(500).nullable(),
    monthlyCostCents: MoneyCentsSchema.nullable()
  })
  .strict();

export const ListingPetDetailsSchema = z
  .object({
    policy: PetPolicySchema,
    fees: z.array(ListingFeeSchema).max(10)
  })
  .strict();

export const ListingLaundrySchema = z.enum([
  "in_unit",
  "in_building",
  "hookups",
  "none",
  "unknown"
]);

export const ListingFurnishedStatusSchema = z.enum([
  "furnished",
  "unfurnished",
  "partially_furnished",
  "unknown"
]);

export const ListingDetailFieldsSchema = z
  .object({
    sourceUrl: z.string().url().max(2_048),
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    propertyName: z.string().trim().min(1).max(300).nullable(),
    description: ContactFreeListingTextSchema.max(20_000).nullable(),
    baseRentCents: MoneyCentsSchema.nullable(),
    fees: z.array(ListingFeeSchema).max(30),
    estimatedTotalMonthlyCostCents: MoneyCentsSchema.nullable(),
    depositCents: MoneyCentsSchema.nullable(),
    applicationFeeCents: MoneyCentsSchema.nullable(),
    brokerFeeCents: MoneyCentsSchema.nullable(),
    availableOn: IsoDateSchema.nullable(),
    availabilityText: z.string().trim().min(1).max(500).nullable(),
    leaseDurationText: z.string().trim().min(1).max(300).nullable(),
    leaseTermMonths: z.number().int().positive().max(120).nullable(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    propertyType: PropertyTypeSchema.nullable(),
    petDetails: ListingPetDetailsSchema.nullable(),
    parking: ListingParkingSchema.nullable(),
    utilitiesIncluded: z.array(z.string().trim().min(1).max(120)).max(20),
    laundry: ListingLaundrySchema,
    furnishedStatus: ListingFurnishedStatusSchema,
    amenities: z.array(z.string().trim().min(1).max(160)).max(50),
    propertyManagerName: ContactFreeListingTextSchema.max(300).nullable(),
    allowedContactChannel: ContactChannelSchema,
    sourceUpdatedAt: IsoDateTimeSchema.nullable()
  })
  .strict();

export const ListingDetailPhotoSchema = z
  .object({
    sourceUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => /^https:\/\//u.test(value), "Photo URLs must use HTTPS."),
    position: z.number().int().nonnegative().max(99),
    width: z.number().int().positive().max(20_000).nullable(),
    height: z.number().int().positive().max(20_000).nullable(),
    safeContentHash: Sha256Schema.nullable(),
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const ListingEnrichmentFieldProvenanceSchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(200),
    sourceUrl: z.string().url().max(2_048),
    extractionMethod: z.literal("openclaw_semantic_snapshot"),
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const ListingDetailCompletenessSchema = z
  .object({
    basisPoints: PercentageBasisPointsSchema,
    observedImportantFields: z.number().int().nonnegative(),
    importantFieldCount: z.literal(15),
    missingImportantFields: z.array(z.string().trim().min(1).max(120)).max(15)
  })
  .strict();

export const ListingEnrichmentSnapshotSchema = z
  .object({
    id: EntityIdSchema,
    listingSourceRecordId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    details: ListingDetailFieldsSchema,
    photos: z.array(ListingDetailPhotoSchema).max(30),
    fieldProvenance: z.array(ListingEnrichmentFieldProvenanceSchema).max(80),
    completeness: ListingDetailCompletenessSchema,
    observedAt: IsoDateTimeSchema,
    freshUntil: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (!isExpectedSourceUrl(snapshot.source, snapshot.details.sourceUrl)) {
      context.addIssue({
        code: "custom",
        path: ["details", "sourceUrl"],
        message: "Enrichment evidence must retain an exact reviewed source link."
      });
    }
    for (const [index, photo] of snapshot.photos.entries()) {
      if (!isExpectedSourcePhotoUrl(snapshot.source, photo.sourceUrl)) {
        context.addIssue({
          code: "custom",
          path: ["photos", index, "sourceUrl"],
          message: "Listing photos must remain on reviewed source media domains."
        });
      }
    }
    for (const [index, entry] of snapshot.fieldProvenance.entries()) {
      if (!isExpectedSourceUrl(snapshot.source, entry.sourceUrl)) {
        context.addIssue({
          code: "custom",
          path: ["fieldProvenance", index, "sourceUrl"],
          message: "Enrichment provenance must remain on the reviewed source domain."
        });
      }
    }
    const positions = snapshot.photos.map(({ position }) => position);
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: "custom",
        path: ["photos"],
        message: "Photo ordering positions must be unique."
      });
    }
    if (Date.parse(snapshot.freshUntil) <= Date.parse(snapshot.observedAt)) {
      context.addIssue({
        code: "custom",
        path: ["freshUntil"],
        message: "Enrichment freshness must end after observation."
      });
    }
  });

export const ListingEnrichmentRecordSchema = z
  .object({
    listingSourceRecordId: EntityIdSchema,
    state: ListingEnrichmentStateSchema,
    requestedReason: ListingEnrichmentReasonSchema.nullable(),
    attemptCount: z.number().int().nonnegative().max(10),
    availableAt: IsoDateTimeSchema.nullable(),
    leaseOwner: z.string().trim().min(1).max(160).nullable(),
    leaseExpiresAt: IsoDateTimeSchema.nullable(),
    currentSnapshotId: EntityIdSchema.nullable(),
    manualAction: ListingEnrichmentManualActionSchema.nullable(),
    lastErrorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,99}$/u)
      .nullable(),
    requestedAt: IsoDateTimeSchema.nullable(),
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const EnrichmentRequestSchema = z
  .object({
    force: z.boolean().default(false)
  })
  .strict();

export const EnrichmentResponseSchema = z
  .object({
    listingId: EntityIdSchema,
    state: ListingEnrichmentStateSchema,
    queuedSourceRecordIds: z.array(EntityIdSchema),
    reusedFreshSourceRecordIds: z.array(EntityIdSchema),
    requestedAt: IsoDateTimeSchema
  })
  .strict();

export const EnrichmentBatchResponseSchema = z
  .object({ queuedCount: z.number().int().nonnegative().max(30) })
  .strict();

const IMPORTANT_FIELDS = [
  [
    "source link",
    (fields: ListingDetailFields, _photos: readonly ListingDetailPhoto[]) => fields.sourceUrl
  ],
  [
    "primary photo",
    (_fields: ListingDetailFields, photos: readonly ListingDetailPhoto[]) =>
      photos[0]?.sourceUrl ?? null
  ],
  ["base rent", (fields: ListingDetailFields) => fields.baseRentCents],
  [
    "required fees",
    (fields: ListingDetailFields) =>
      fields.fees.some((fee) => fee.required && fee.cadence === "month") ? true : null
  ],
  ["availability", (fields: ListingDetailFields) => fields.availableOn ?? fields.availabilityText],
  [
    "lease duration",
    (fields: ListingDetailFields) => fields.leaseTermMonths ?? fields.leaseDurationText
  ],
  ["bedrooms", (fields: ListingDetailFields) => fields.bedrooms],
  ["bathrooms", (fields: ListingDetailFields) => fields.bathrooms],
  ["square footage", (fields: ListingDetailFields) => fields.squareFeet],
  ["pet policy", (fields: ListingDetailFields) => fields.petDetails],
  ["parking", (fields: ListingDetailFields) => fields.parking],
  ["utilities", (fields: ListingDetailFields) => fields.utilitiesIncluded[0] ?? null],
  [
    "laundry",
    (fields: ListingDetailFields) => (fields.laundry === "unknown" ? null : fields.laundry)
  ],
  ["amenities", (fields: ListingDetailFields) => fields.amenities[0] ?? null],
  ["description", (fields: ListingDetailFields) => fields.description]
] as const;

export function computeListingDetailCompleteness(
  input: ListingDetailFields,
  photosInput: readonly ListingDetailPhoto[] = []
): ListingDetailCompleteness {
  const fields = ListingDetailFieldsSchema.parse(input);
  const photos = z.array(ListingDetailPhotoSchema).max(30).parse(photosInput);
  const missingImportantFields = IMPORTANT_FIELDS.filter(([, read]) => {
    const value = read(fields, photos);
    return value === null || value === undefined || value === "";
  }).map(([label]) => label);
  const observedImportantFields = IMPORTANT_FIELDS.length - missingImportantFields.length;
  return ListingDetailCompletenessSchema.parse({
    basisPoints: Math.round((observedImportantFields / IMPORTANT_FIELDS.length) * 10_000),
    observedImportantFields,
    importantFieldCount: IMPORTANT_FIELDS.length,
    missingImportantFields
  });
}

export function expectedSourceHostname(source: ListingSourceLabel): string | null {
  switch (source) {
    case "zillow":
      return "www.zillow.com";
    case "apartments_com":
      return "www.apartments.com";
    case "facebook_marketplace":
      return "www.facebook.com";
    case "bu_off_campus":
      return "offcampus.bu.edu";
    case "custom_website":
      return null;
    case "craigslist":
      return null;
    case "rentcast":
      return null;
    case "other":
      return null;
  }
}

export function isExpectedSourceUrl(source: ListingSourceLabel, value: string): boolean {
  const hostname = expectedSourceHostname(source);
  const match = value.match(/^https:\/\/([^/?#:@]+)([^#]*)$/u);
  const suffix = match?.[2] ?? "";
  if (source === "craigslist") {
    return (
      match?.[1] !== undefined &&
      match[1].endsWith(".craigslist.org") &&
      /\/\d+\.html(?:\?|$)/u.test(suffix) &&
      safeSourceQuery(suffix)
    );
  }
  if (source === "custom_website") {
    return (
      match?.[1] !== undefined &&
      match[1].includes(".") &&
      !match[1].endsWith(".local") &&
      match[1] !== "localhost" &&
      safeSourceQuery(suffix)
    );
  }
  if (hostname === null) return false;
  return (
    match?.[1] === hostname &&
    (suffix === "" || suffix.startsWith("/") || suffix.startsWith("?")) &&
    safeSourceQuery(suffix)
  );
}

export function isExpectedSourcePhotoUrl(source: ListingSourceLabel, value: string): boolean {
  const match = value.match(/^https:\/\/([^/?#:@]+)([^#]*)$/u);
  const hostname = match?.[1];
  const suffix = match?.[2] ?? "";
  if (
    hostname === undefined ||
    !(suffix === "" || suffix.startsWith("/") || suffix.startsWith("?")) ||
    !safeSourceQuery(suffix)
  ) {
    return false;
  }
  if (source === "zillow") return hostname === "photos.zillowstatic.com";
  if (source === "apartments_com") {
    return hostname === "images1.apartments.com" || hostname.endsWith(".apartments.com");
  }
  if (source === "facebook_marketplace") {
    return hostname === "scontent.xx.fbcdn.net" || hostname.endsWith(".fbcdn.net");
  }
  if (source === "bu_off_campus") return hostname === "offcampus.bu.edu";
  if (source === "craigslist") return hostname === "images.craigslist.org";
  return false;
}

function safeSourceQuery(pathAndQuery: string): boolean {
  const query = pathAndQuery.split("?", 2)[1];
  if (query === undefined) return true;
  try {
    return query.split("&").every((part) => {
      const key = decodeURIComponent(part.split("=", 1)[0] ?? "");
      return !/^(?:password|token|access_token|refresh_token|authorization|secret|cookie|session|sessionid)$/iu.test(
        key
      );
    });
  } catch {
    return false;
  }
}

export type ListingEnrichmentState = z.infer<typeof ListingEnrichmentStateSchema>;
export type ListingEnrichmentReason = z.infer<typeof ListingEnrichmentReasonSchema>;
export type ListingFee = z.infer<typeof ListingFeeSchema>;
export type ListingDetailFields = z.infer<typeof ListingDetailFieldsSchema>;
export type ListingDetailPhoto = z.infer<typeof ListingDetailPhotoSchema>;
export type ListingDetailCompleteness = z.infer<typeof ListingDetailCompletenessSchema>;
export type ListingEnrichmentFieldProvenance = z.infer<
  typeof ListingEnrichmentFieldProvenanceSchema
>;
export type ListingEnrichmentSnapshot = z.infer<typeof ListingEnrichmentSnapshotSchema>;
export type ListingEnrichmentRecord = z.infer<typeof ListingEnrichmentRecordSchema>;
export type EnrichmentRequest = z.infer<typeof EnrichmentRequestSchema>;
export type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;
export type EnrichmentBatchResponse = z.infer<typeof EnrichmentBatchResponseSchema>;
