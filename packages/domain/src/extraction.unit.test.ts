import { describe, expect, it } from "vitest";

import {
  ExtractionUnknownReasonSchema,
  ExtractedAddressTextSchema,
  ExtractedAmenitiesSchema,
  ExtractedAvailableOnSchema,
  ExtractedAvailabilityRawSchema,
  ExtractedBaseRentSchema,
  ExtractedBathroomsSchema,
  ExtractedBedroomsSchema,
  ExtractedCatsAllowedSchema,
  ExtractedContactChannelSchema,
  ExtractedContactEmailSchema,
  ExtractedContactNameSchema,
  ExtractedContactPhoneSchema,
  ExtractedContactUrlSchema,
  ExtractedDogsAllowedSchema,
  ExtractedLeaseTermMonthsSchema,
  ExtractedPropertyTypeSchema,
  ExtractedRequiredRecurringFeesSchema,
  ExtractedSourcePostedAtSchema,
  ExtractedSquareFeetSchema,
  ExtractedTitleSchema,
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionProviderResultSchema,
  ListingExtractionRequestSchema,
  ListingExtractionRunSchema,
  ListingExtractionSchema,
  MoneyObservationSchema,
  RequiredRecurringFeeSchema
} from "./index.ts";

const hash = "c".repeat(64);
const completedAt = "2026-07-17T14:00:00.000Z";

function known<T>(value: T, evidenceSnippet = "Explicit fixture evidence") {
  return {
    status: "known" as const,
    value,
    confidenceBasisPoints: 9_500,
    evidenceSnippet
  };
}

function unknown(reason = "not_present" as const) {
  return {
    status: "unknown" as const,
    value: null,
    confidenceBasisPoints: 0 as const,
    evidenceSnippet: null,
    reason
  };
}

const baseRent = {
  amountMinorUnits: 245_000,
  currency: "USD",
  billingPeriod: "month",
  rawAmount: "$2,450 per month"
} as const;

const fee = {
  label: "Required parking",
  amount: {
    amountMinorUnits: 15_000,
    currency: "USD",
    billingPeriod: "month",
    rawAmount: "$150 monthly"
  }
} as const;

const extraction = {
  title: known("Sunny studio", "Title: Sunny studio"),
  bedrooms: known(0, "Studio apartment"),
  bathrooms: known(1, "1 bath"),
  addressText: known("101 Juniper Row, Harbor City", "Address: 101 Juniper Row, Harbor City"),
  squareFeet: known(520, "520 square feet"),
  propertyType: known("apartment", "Apartment for rent"),
  baseRent: known(baseRent, "$2,450 per month"),
  requiredRecurringFees: known([fee], "Required parking: $150 monthly"),
  availabilityRaw: known("Available September 1, 2026", "Available September 1, 2026"),
  availableOn: known("2026-09-01", "Available September 1, 2026"),
  leaseTermMonths: known(12, "12-month lease"),
  catsAllowed: known(true, "Cats allowed"),
  dogsAllowed: known(false, "No dogs"),
  amenities: known(["Laundry", "Bike storage"], "Laundry and bike storage"),
  sourcePostedAt: known("2026-07-16T18:30:00.000Z", "Posted 2026-07-16T18:30:00.000Z"),
  contactChannel: known("email", "Email leasing@example.invalid"),
  contactName: known("Casey Example", "Contact Casey Example"),
  contactEmail: known("leasing@example.invalid", "leasing@example.invalid"),
  contactPhone: known("+1 (617) 555-0100", "+1 (617) 555-0100"),
  contactUrl: known("https://example.invalid/contact", "https://example.invalid/contact")
} as const;

const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 } as const;

const providerResult = {
  providerId: "mock-provider",
  model: "mock-model-v1",
  responseId: "response-1",
  extraction,
  usage,
  latencyMilliseconds: 25,
  repairCount: 0
} as const;

describe("strict listing extraction fields", () => {
  it("owns the exact 20-field vocabulary and validates every concrete schema", () => {
    expect(ListingExtractionFieldNameSchema.options).toEqual([
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

    const concreteSchemas = [
      ExtractedTitleSchema,
      ExtractedBedroomsSchema,
      ExtractedBathroomsSchema,
      ExtractedAddressTextSchema,
      ExtractedSquareFeetSchema,
      ExtractedPropertyTypeSchema,
      ExtractedBaseRentSchema,
      ExtractedRequiredRecurringFeesSchema,
      ExtractedAvailabilityRawSchema,
      ExtractedAvailableOnSchema,
      ExtractedLeaseTermMonthsSchema,
      ExtractedCatsAllowedSchema,
      ExtractedDogsAllowedSchema,
      ExtractedAmenitiesSchema,
      ExtractedSourcePostedAtSchema,
      ExtractedContactChannelSchema,
      ExtractedContactNameSchema,
      ExtractedContactEmailSchema,
      ExtractedContactPhoneSchema,
      ExtractedContactUrlSchema
    ];
    const values = Object.values(extraction);
    expect(concreteSchemas).toHaveLength(20);
    concreteSchemas.forEach((schema, index) => expect(schema.parse(values[index])).toBeDefined());
    expect(ListingExtractionSchema.parse(extraction)).toEqual(extraction);
  });

  it("requires evidence and positive confidence for known values", () => {
    const knownTitle = known("Sunny studio", "Title: Sunny studio");
    expect(ExtractedTitleSchema.parse(knownTitle)).toEqual(knownTitle);
    expect(() => ExtractedTitleSchema.parse({ ...knownTitle, evidenceSnippet: "" })).toThrow();
    expect(() => ExtractedTitleSchema.parse({ ...knownTitle, confidenceBasisPoints: 0 })).toThrow();
    expect(() =>
      ExtractedTitleSchema.parse({ ...knownTitle, confidenceBasisPoints: 10_001 })
    ).toThrow();
    expect(() => ExtractedTitleSchema.parse({ ...knownTitle, unexpected: true })).toThrow();
  });

  it("requires null evidence/value, zero confidence, and a closed reason for unknowns", () => {
    const unknownTitle = unknown();
    expect(ExtractedTitleSchema.parse(unknownTitle)).toEqual(unknownTitle);
    expect(ExtractionUnknownReasonSchema.options).toEqual([
      "not_present",
      "ambiguous",
      "conflicting_evidence",
      "unrecognized_format"
    ]);
    expect(() => ExtractedTitleSchema.parse({ ...unknownTitle, value: "guess" })).toThrow();
    expect(() =>
      ExtractedTitleSchema.parse({ ...unknownTitle, evidenceSnippet: "maybe" })
    ).toThrow();
    expect(() =>
      ExtractedTitleSchema.parse({ ...unknownTitle, confidenceBasisPoints: 1 })
    ).toThrow();
    expect(() => ExtractedTitleSchema.parse({ ...unknownTitle, reason: "missing" })).toThrow();
  });

  it("preserves strict money observations and labeled recurring fees", () => {
    expect(MoneyObservationSchema.parse(baseRent)).toEqual(baseRent);
    expect(RequiredRecurringFeeSchema.parse(fee)).toEqual(fee);
    expect(() => MoneyObservationSchema.parse({ ...baseRent, amountMinorUnits: 1.5 })).toThrow();
    expect(() => MoneyObservationSchema.parse({ ...baseRent, currency: "usd" })).toThrow();
    expect(() => MoneyObservationSchema.parse({ ...baseRent, billingPeriod: "once" })).toThrow();
    expect(() => MoneyObservationSchema.parse({ ...baseRent, rawAmount: "" })).toThrow();
    expect(() => MoneyObservationSchema.parse({ ...baseRent, unexpected: true })).toThrow();
    expect(() => RequiredRecurringFeeSchema.parse({ ...fee, label: "" })).toThrow();
  });

  it("rejects malformed dates, URLs, contacts, counts, halves, enums, and duplicates", () => {
    expect(() => ExtractedAvailableOnSchema.parse(known("2026-02-30"))).toThrow();
    expect(() => ExtractedSourcePostedAtSchema.parse(known("yesterday"))).toThrow();
    expect(() => ExtractedContactEmailSchema.parse(known("not-an-email"))).toThrow();
    expect(() => ExtractedContactPhoneSchema.parse(known("call-me"))).toThrow();
    for (const unsafeUrl of [
      "file:///tmp/listing",
      "http://localhost/listing",
      "http://127.0.0.1/listing",
      "https://user:pass@example.invalid/listing",
      "https://example.invalid:8443/listing",
      "https://example.invalid/listing#fragment",
      "https://printer.local/listing"
    ]) {
      expect(() => ExtractedContactUrlSchema.parse(known(unsafeUrl))).toThrow();
    }
    expect(() => ExtractedBedroomsSchema.parse(known(1.25))).toThrow();
    expect(() => ExtractedBathroomsSchema.parse(known(-0.5))).toThrow();
    expect(() => ExtractedSquareFeetSchema.parse(known(0))).toThrow();
    expect(() => ExtractedLeaseTermMonthsSchema.parse(known(0))).toThrow();
    expect(() => ExtractedPropertyTypeSchema.parse(known("castle"))).toThrow();
    expect(() => ExtractedContactChannelSchema.parse(known("unknown"))).toThrow();
    expect(() => ExtractedAmenitiesSchema.parse(known(["Laundry", "Laundry"]))).toThrow();
  });
});

describe("listing extraction request and provider result", () => {
  const request = {
    evidenceText: "Sanitized synthetic listing evidence.",
    inputHash: hash,
    fieldRequests: [
      { field: "title", reason: "not_present" },
      { field: "baseRent", reason: "ambiguous" }
    ],
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION
  } as const;

  it("requires unique non-empty field requests and literal versions", () => {
    expect(ListingExtractionRequestSchema.parse(request)).toEqual(request);
    expect(() => ListingExtractionRequestSchema.parse({ ...request, fieldRequests: [] })).toThrow();
    expect(() =>
      ListingExtractionRequestSchema.parse({
        ...request,
        fieldRequests: [request.fieldRequests[0], request.fieldRequests[0]]
      })
    ).toThrow();
    expect(() =>
      ListingExtractionRequestSchema.parse({ ...request, promptVersion: "unreviewed" })
    ).toThrow();
    expect(() => ListingExtractionRequestSchema.parse({ ...request, unexpected: true })).toThrow();
  });

  it("requires exact token totals and zero-or-one repair attempts", () => {
    expect(ListingExtractionProviderResultSchema.parse(providerResult)).toEqual(providerResult);
    expect(() =>
      ListingExtractionProviderResultSchema.parse({
        ...providerResult,
        usage: { ...usage, totalTokens: 151 }
      })
    ).toThrow();
    expect(() =>
      ListingExtractionProviderResultSchema.parse({ ...providerResult, repairCount: 2 })
    ).toThrow();
    expect(() =>
      ListingExtractionProviderResultSchema.parse({ ...providerResult, unexpected: true })
    ).toThrow();
  });
});

describe("immutable listing extraction run", () => {
  const baseRun = {
    id: "extraction-run-1",
    rawListingId: "raw-listing-1",
    listingSourceRecordId: "source-record-1",
    inputHash: hash,
    requestedFields: ["title", "baseRent"],
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION,
    mergedExtraction: extraction,
    completedAt
  } as const;

  it("fixes every provider field and metric to null or zero in deterministic-only mode", () => {
    const deterministicRun = {
      ...baseRun,
      mode: "deterministic_only",
      providerId: null,
      model: null,
      responseId: null,
      providerResult: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMilliseconds: 0,
      repairCount: 0
    } as const;
    expect(ListingExtractionRunSchema.parse(deterministicRun)).toEqual(deterministicRun);
    expect(() =>
      ListingExtractionRunSchema.parse({ ...deterministicRun, providerId: "unexpected" })
    ).toThrow();
    expect(() =>
      ListingExtractionRunSchema.parse({
        ...deterministicRun,
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 }
      })
    ).toThrow();
  });

  it("requires consistent provider metadata and result in LLM-augmented mode", () => {
    const augmentedRun = {
      ...baseRun,
      mode: "llm_augmented",
      providerId: providerResult.providerId,
      model: providerResult.model,
      responseId: providerResult.responseId,
      providerResult,
      usage,
      latencyMilliseconds: providerResult.latencyMilliseconds,
      repairCount: providerResult.repairCount
    } as const;
    expect(ListingExtractionRunSchema.parse(augmentedRun)).toEqual(augmentedRun);
    expect(() => ListingExtractionRunSchema.parse({ ...augmentedRun, model: "other" })).toThrow();
    expect(() =>
      ListingExtractionRunSchema.parse({ ...augmentedRun, providerResult: null })
    ).toThrow();
    expect(() => ListingExtractionRunSchema.parse({ ...augmentedRun, unexpected: true })).toThrow();
  });
});
