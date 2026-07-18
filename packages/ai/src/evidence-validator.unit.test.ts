import {
  ListingExtractionRequestSchema,
  type ExtractionUnknownReason,
  type ListingExtractionFieldName
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import { validateExtractionEvidence } from "./evidence-validator.ts";
import {
  GOLDEN_LISTING_EVIDENCE,
  GOLDEN_LISTING_EXTRACTION,
  GOLDEN_LISTING_REQUEST,
  createUnknownListingExtraction
} from "./testing-fixtures.ts";

function requestFor(
  evidenceText: string,
  field: ListingExtractionFieldName,
  reason: ExtractionUnknownReason
) {
  return ListingExtractionRequestSchema.parse({
    ...GOLDEN_LISTING_REQUEST,
    evidenceText,
    fieldRequests: [{ field, reason }]
  });
}

describe("validateExtractionEvidence", () => {
  it("accepts the sanitized golden extraction", () => {
    expect(validateExtractionEvidence(GOLDEN_LISTING_REQUEST, GOLDEN_LISTING_EXTRACTION)).toEqual(
      []
    );
  });

  it("rejects a known field that was not requested", () => {
    const request = {
      ...GOLDEN_LISTING_REQUEST,
      fieldRequests: GOLDEN_LISTING_REQUEST.fieldRequests.filter(({ field }) => field !== "title")
    };
    expect(validateExtractionEvidence(request, GOLDEN_LISTING_EXTRACTION)).toContainEqual({
      code: "unrequested_field",
      field: "title"
    });
  });

  it("rejects low confidence and evidence not present in the record", () => {
    const extraction = structuredClone(GOLDEN_LISTING_EXTRACTION);
    extraction.title = {
      status: "known",
      value: "Invented title",
      confidenceBasisPoints: 6_999,
      evidenceSnippet: "Invented title"
    };
    expect(validateExtractionEvidence(GOLDEN_LISTING_REQUEST, extraction)).toEqual(
      expect.arrayContaining([
        { code: "confidence_too_low", field: "title" },
        { code: "evidence_not_found", field: "title" }
      ])
    );
  });

  it("rejects contact values that do not exactly occur in evidence", () => {
    const extraction = structuredClone(GOLDEN_LISTING_EXTRACTION);
    extraction.contactEmail = {
      status: "known",
      value: "invented@example.invalid",
      confidenceBasisPoints: 9_900,
      evidenceSnippet: "leasing@example.invalid"
    };
    expect(validateExtractionEvidence(GOLDEN_LISTING_REQUEST, extraction)).toContainEqual({
      code: "contact_not_found",
      field: "contactEmail"
    });
  });

  it("rejects a locale-assumed currency, wrong amount, or wrong billing period", () => {
    const extraction = createUnknownListingExtraction();
    extraction.baseRent = {
      status: "known",
      value: {
        amountMinorUnits: 245_000,
        currency: "USD",
        billingPeriod: "month",
        rawAmount: "$2450 per month"
      },
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "$2450 per month"
    };
    const request = requestFor("$2450 per month", "baseRent", "ambiguous");
    expect(validateExtractionEvidence(request, extraction)).toContainEqual({
      code: "money_not_supported",
      field: "baseRent"
    });
  });

  it("requires explicit evidence before accepting an empty recurring-fee list", () => {
    const extraction = createUnknownListingExtraction();
    extraction.requiredRecurringFees = {
      status: "known",
      value: [],
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Rent includes heat"
    };
    const request = requestFor("Rent includes heat", "requiredRecurringFees", "not_present");
    expect(validateExtractionEvidence(request, extraction)).toContainEqual({
      code: "empty_fees_not_supported",
      field: "requiredRecurringFees"
    });
  });

  it("does not derive an exact availability date from approximate language", () => {
    const extraction = createUnknownListingExtraction();
    extraction.availableOn = {
      status: "known",
      value: "2026-09-15",
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Available mid-September 2026"
    };
    const request = requestFor("Available mid-September 2026", "availableOn", "ambiguous");
    expect(validateExtractionEvidence(request, extraction)).toContainEqual({
      code: "availability_not_supported",
      field: "availableOn"
    });
  });

  it("rejects an exact-date substring when its supplied evidence line is qualified", () => {
    const extraction = createUnknownListingExtraction();
    extraction.availableOn = {
      status: "known",
      value: "2026-09-15",
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "2026-09-15"
    };
    const request = requestFor("Available around 2026-09-15", "availableOn", "ambiguous");
    expect(validateExtractionEvidence(request, extraction)).toContainEqual({
      code: "availability_not_supported",
      field: "availableOn"
    });
  });

  it("does not turn generic pet-friendly wording into species permission", () => {
    const extraction = createUnknownListingExtraction();
    extraction.catsAllowed = {
      status: "known",
      value: true,
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Pet friendly"
    };
    const request = requestFor("Pet friendly", "catsAllowed", "ambiguous");
    expect(validateExtractionEvidence(request, extraction)).toContainEqual({
      code: "pet_policy_not_supported",
      field: "catsAllowed"
    });
  });

  it("normalizes line endings and whitespace only for evidence matching", () => {
    const extraction = createUnknownListingExtraction();
    extraction.title = {
      status: "known",
      value: "Sunny studio",
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Title: Sunny studio"
    };
    const request = requestFor("Title:\r\n  Sunny   studio", "title", "not_present");
    expect(validateExtractionEvidence(request, extraction)).toEqual([]);
  });

  it("leaves every absent field explicitly unknown", () => {
    const extraction = createUnknownListingExtraction();
    expect(Object.keys(extraction)).toHaveLength(20);
    expect(
      Object.values(extraction).every(
        (field) =>
          field.status === "unknown" &&
          field.value === null &&
          field.confidenceBasisPoints === 0 &&
          field.evidenceSnippet === null
      )
    ).toBe(true);
    expect(GOLDEN_LISTING_EVIDENCE).not.toContain("sk-");
  });
});
