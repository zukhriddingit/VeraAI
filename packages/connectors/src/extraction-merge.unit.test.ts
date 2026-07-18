import {
  ListingExtractionProviderResultSchema,
  ListingExtractionSchema,
  type ListingExtraction,
  type ListingExtractionProviderResult
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import type { ConnectorContext, NormalizationContext } from "./contracts.ts";
import { extractDeterministicListing } from "./deterministic-extraction.ts";
import { mergeListingExtraction } from "./extraction-merge.ts";
import { buildListingExtractionRequest } from "./extraction-request.ts";
import { buildListingEvidence } from "./listing-evidence.ts";
import { ManualCaptureConnector } from "./manual-connector.ts";
import { projectListingExtraction } from "./normalizer.ts";

const context: ConnectorContext = {
  correlationId: "correlation-merge",
  now: () => new Date("2026-07-17T15:30:00.000Z"),
  createId: () => "unused"
};

function setup(text: string) {
  const envelope = new ManualCaptureConnector().capture(
    {
      kind: "manual_text",
      sourceUrl: "https://housing.example/listing/merge",
      listingText: text
    },
    context
  );
  const deterministic = extractDeterministicListing(envelope);
  const request = buildListingExtractionRequest(buildListingEvidence(envelope), deterministic);
  if (request === null) throw new Error("Merge fixture unexpectedly needs no provider fields.");
  return { envelope, deterministic, request };
}

function providerResult(extraction: ListingExtraction): ListingExtractionProviderResult {
  return ListingExtractionProviderResultSchema.parse({
    providerId: "mock.provider",
    model: "synthetic-model",
    responseId: "response-synthetic",
    extraction,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMilliseconds: 12,
    repairCount: 0
  });
}

function withField(
  extraction: ListingExtraction,
  field: keyof ListingExtraction,
  value: ListingExtraction[keyof ListingExtraction]
): ListingExtraction {
  return ListingExtractionSchema.parse({ ...extraction, [field]: value });
}

describe("mergeListingExtraction", () => {
  it("fills only a requested unknown field with semantically validated provider evidence", () => {
    const { envelope, deterministic, request } = setup(
      "The home is located at 100 Example Way, Demo City, NY 10001."
    );
    const provider = providerResult(
      withField(deterministic.extraction, "addressText", {
        status: "known",
        value: "100 Example Way, Demo City, NY 10001",
        confidenceBasisPoints: 9_000,
        evidenceSnippet: "100 Example Way, Demo City, NY 10001"
      })
    );
    const merged = mergeListingExtraction({ deterministic, request, providerResult: provider });
    expect(merged.extraction.addressText).toMatchObject({
      status: "known",
      value: "100 Example Way, Demo City, NY 10001"
    });
    expect(merged.extractionMethods.addressText).toBe("ai");
    expect(merged.acceptedProviderFields).toEqual(["addressText"]);
    let nextId = 0;
    const projectionContext: NormalizationContext = {
      rawListingId: "raw-merge-ai",
      now: () => new Date("2026-07-17T15:31:00.000Z"),
      createId: () => `merge-ai-${++nextId}`
    };
    const projected = projectListingExtraction(envelope, merged, projectionContext);
    expect(projected.provenance.find(({ fieldPath }) => fieldPath === "addressText")).toMatchObject(
      {
        extractionMethod: "ai",
        valueStatus: "known",
        confidenceBasisPoints: 9_000,
        evidenceExcerpt: "100 Example Way, Demo City, NY 10001"
      }
    );
  });

  it("never overwrites a deterministic value", () => {
    const { deterministic, request } = setup(
      "Title: Deterministic title\nProvider-looking title: Replacement title"
    );
    const provider = providerResult(
      withField(deterministic.extraction, "title", {
        status: "known",
        value: "Replacement title",
        confidenceBasisPoints: 10_000,
        evidenceSnippet: "Replacement title"
      })
    );
    const merged = mergeListingExtraction({ deterministic, request, providerResult: provider });
    expect(merged.extraction.title).toMatchObject({
      status: "known",
      value: "Deterministic title"
    });
    expect(merged.extractionMethods.title).toBe("rule");
    expect(merged.rejectedProviderFields).toContain("title");
  });

  it("rejects provider confidence below 7,000 and preserves deterministic unknown reason", () => {
    const { deterministic, request } = setup("It has two bedrooms.");
    expect(deterministic.extraction.bedrooms).toMatchObject({
      status: "unknown",
      reason: "not_present"
    });
    const provider = providerResult(
      withField(deterministic.extraction, "bedrooms", {
        status: "known",
        value: 2,
        confidenceBasisPoints: 6_999,
        evidenceSnippet: "two bedrooms"
      })
    );
    const merged = mergeListingExtraction({ deterministic, request, providerResult: provider });
    expect(merged.extraction.bedrooms).toEqual(deterministic.extraction.bedrooms);
    expect(merged.validationIssues).toContainEqual({
      code: "confidence_too_low",
      field: "bedrooms"
    });
  });

  it("rejects provider evidence absent from the immutable input", () => {
    const { deterministic, request } = setup("Synthetic listing without an address.");
    const provider = providerResult(
      withField(deterministic.extraction, "addressText", {
        status: "known",
        value: "999 Invented Street",
        confidenceBasisPoints: 9_500,
        evidenceSnippet: "999 Invented Street"
      })
    );
    const merged = mergeListingExtraction({ deterministic, request, providerResult: provider });
    expect(merged.extraction.addressText).toEqual(deterministic.extraction.addressText);
    expect(merged.validationIssues).toContainEqual({
      code: "evidence_not_found",
      field: "addressText"
    });
  });

  it("ignores every unrequested provider field", () => {
    const { deterministic, request } = setup("Title: Deterministic title");
    const provider = providerResult(
      withField(deterministic.extraction, "title", {
        status: "known",
        value: "Deterministic title",
        confidenceBasisPoints: 10_000,
        evidenceSnippet: "Title: Deterministic title"
      })
    );
    const merged = mergeListingExtraction({ deterministic, request, providerResult: provider });
    expect(merged.extraction.title).toEqual(deterministic.extraction.title);
    expect(merged.validationIssues).toContainEqual({
      code: "unrequested_field",
      field: "title"
    });
  });

  it("keeps contact, money, availability, fee, and pet values closed behind semantic validation", () => {
    const { deterministic, request } = setup(
      [
        "Rent language: USD 2000 per month",
        "Approximate availability around 2026-08-15",
        "Pet friendly",
        "Contact details available after inquiry"
      ].join("\n")
    );
    let extraction = withField(deterministic.extraction, "baseRent", {
      status: "known",
      value: {
        amountMinorUnits: 999_900,
        currency: "USD",
        billingPeriod: "month",
        rawAmount: "USD 2000 per month"
      },
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "USD 2000 per month"
    });
    extraction = withField(extraction, "requiredRecurringFees", {
      status: "known",
      value: [],
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Rent language: USD 2000 per month"
    });
    extraction = withField(extraction, "availableOn", {
      status: "known",
      value: "2026-08-15",
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Approximate availability around 2026-08-15"
    });
    extraction = withField(extraction, "catsAllowed", {
      status: "known",
      value: true,
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Pet friendly"
    });
    extraction = withField(extraction, "contactEmail", {
      status: "known",
      value: "invented@example.invalid",
      confidenceBasisPoints: 9_500,
      evidenceSnippet: "Contact details available after inquiry"
    });
    const merged = mergeListingExtraction({
      deterministic,
      request,
      providerResult: providerResult(extraction)
    });
    expect(merged.extraction.baseRent).toEqual(deterministic.extraction.baseRent);
    expect(merged.extraction.requiredRecurringFees).toEqual(
      deterministic.extraction.requiredRecurringFees
    );
    expect(merged.extraction.availableOn).toEqual(deterministic.extraction.availableOn);
    expect(merged.extraction.catsAllowed).toEqual(deterministic.extraction.catsAllowed);
    expect(merged.extraction.contactEmail).toEqual(deterministic.extraction.contactEmail);
    expect(merged.validationIssues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "money_not_supported",
        "empty_fees_not_supported",
        "availability_not_supported",
        "pet_policy_not_supported",
        "contact_not_found"
      ])
    );
  });

  it("is deterministic for identical validated inputs", () => {
    const { deterministic, request } = setup("The listing has a roof deck.");
    const provider = providerResult(
      withField(deterministic.extraction, "amenities", {
        status: "known",
        value: ["roof deck"],
        confidenceBasisPoints: 9_000,
        evidenceSnippet: "roof deck"
      })
    );
    const input = { deterministic, request, providerResult: provider };
    expect(mergeListingExtraction(input)).toEqual(mergeListingExtraction(input));
  });
});
