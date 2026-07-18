import {
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionProviderResultSchema,
  ListingExtractionRequestSchema,
  ListingExtractionSchema,
  type ExtractedField,
  type ExtractionUnknownReason,
  type ListingExtraction,
  type ListingExtractionProviderResult,
  type ListingExtractionRequest
} from "@vera/domain";

export const SYNTHETIC_INPUT_HASH = "a".repeat(64);

export function unknownExtractedField<T>(
  reason: ExtractionUnknownReason = "not_present"
): ExtractedField<T> {
  return {
    status: "unknown",
    value: null,
    confidenceBasisPoints: 0,
    evidenceSnippet: null,
    reason
  };
}

function known<T>(value: T, evidenceSnippet: string): ExtractedField<T> {
  return {
    status: "known",
    value,
    confidenceBasisPoints: 9_500,
    evidenceSnippet
  };
}

export function createUnknownListingExtraction(): ListingExtraction {
  const unknown = unknownExtractedField;
  return ListingExtractionSchema.parse({
    title: unknown<string>(),
    bedrooms: unknown<number>(),
    bathrooms: unknown<number>(),
    addressText: unknown<string>(),
    squareFeet: unknown<number>(),
    propertyType: unknown<string>(),
    baseRent: unknown<object>(),
    requiredRecurringFees: unknown<readonly object[]>(),
    availabilityRaw: unknown<string>(),
    availableOn: unknown<string>(),
    leaseTermMonths: unknown<number>(),
    catsAllowed: unknown<boolean>(),
    dogsAllowed: unknown<boolean>(),
    amenities: unknown<readonly string[]>(),
    sourcePostedAt: unknown<string>(),
    contactChannel: unknown<string>(),
    contactName: unknown<string>(),
    contactEmail: unknown<string>(),
    contactPhone: unknown<string>(),
    contactUrl: unknown<string>()
  });
}

export const GOLDEN_LISTING_EVIDENCE = `Title: Sunny studio
Property type: apartment
Studio apartment with 1 bath and 520 square feet.
Address: 101 Juniper Row, Harbor City
Base rent: USD 2450 per month
Required parking: USD 150 per month
Availability: Available September 1, 2026
Lease term: 12 months
Cats allowed. Dogs are not allowed.
Amenities: Laundry, Bike storage
Posted: 2026-07-16T18:30:00.000Z
Contact Casey Example by email at leasing@example.invalid or +1 (617) 555-0100.
Contact form: https://example.invalid/contact`;

export const GOLDEN_LISTING_EXTRACTION: ListingExtraction = ListingExtractionSchema.parse({
  title: known("Sunny studio", "Title: Sunny studio"),
  bedrooms: known(0, "Studio apartment"),
  bathrooms: known(1, "1 bath"),
  addressText: known("101 Juniper Row, Harbor City", "Address: 101 Juniper Row, Harbor City"),
  squareFeet: known(520, "520 square feet"),
  propertyType: known("apartment", "Property type: apartment"),
  baseRent: known(
    {
      amountMinorUnits: 245_000,
      currency: "USD",
      billingPeriod: "month",
      rawAmount: "USD 2450 per month"
    },
    "Base rent: USD 2450 per month"
  ),
  requiredRecurringFees: known(
    [
      {
        label: "Required parking",
        amount: {
          amountMinorUnits: 15_000,
          currency: "USD",
          billingPeriod: "month",
          rawAmount: "USD 150 per month"
        }
      }
    ],
    "Required parking: USD 150 per month"
  ),
  availabilityRaw: known(
    "Available September 1, 2026",
    "Availability: Available September 1, 2026"
  ),
  availableOn: known("2026-09-01", "Available September 1, 2026"),
  leaseTermMonths: known(12, "Lease term: 12 months"),
  catsAllowed: known(true, "Cats allowed"),
  dogsAllowed: known(false, "Dogs are not allowed"),
  amenities: known(["Laundry", "Bike storage"], "Amenities: Laundry, Bike storage"),
  sourcePostedAt: known("2026-07-16T18:30:00.000Z", "Posted: 2026-07-16T18:30:00.000Z"),
  contactChannel: known("email", "email at leasing@example.invalid"),
  contactName: known("Casey Example", "Contact Casey Example"),
  contactEmail: known("leasing@example.invalid", "leasing@example.invalid"),
  contactPhone: known("+1 (617) 555-0100", "+1 (617) 555-0100"),
  contactUrl: known("https://example.invalid/contact", "https://example.invalid/contact")
});

export const GOLDEN_LISTING_REQUEST: ListingExtractionRequest =
  ListingExtractionRequestSchema.parse({
    evidenceText: GOLDEN_LISTING_EVIDENCE,
    inputHash: SYNTHETIC_INPUT_HASH,
    fieldRequests: ListingExtractionFieldNameSchema.options.map((field) => ({
      field,
      reason: "not_present" as const
    })),
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION
  });

export function createGoldenProviderResult(
  overrides: Partial<ListingExtractionProviderResult> = {}
): ListingExtractionProviderResult {
  return ListingExtractionProviderResultSchema.parse({
    providerId: "mock",
    model: "mock-v1",
    responseId: "synthetic-response-id",
    extraction: GOLDEN_LISTING_EXTRACTION,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    latencyMilliseconds: 25,
    repairCount: 0,
    ...overrides
  });
}
