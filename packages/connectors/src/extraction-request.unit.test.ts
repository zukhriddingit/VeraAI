import { ListingExtractionFieldNameSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import type { ConnectorContext } from "./contracts.ts";
import { extractDeterministicListing } from "./deterministic-extraction.ts";
import { buildListingExtractionRequest } from "./extraction-request.ts";
import { buildListingEvidence } from "./listing-evidence.ts";
import { ManualCaptureConnector } from "./manual-connector.ts";

const context: ConnectorContext = {
  correlationId: "correlation-request",
  now: () => new Date("2026-07-17T15:30:00.000Z"),
  createId: () => "unused"
};

function pipeline(listingText: string) {
  const envelope = new ManualCaptureConnector().capture(
    {
      kind: "manual_text",
      sourceUrl: "https://housing.example/listing/request",
      listingText
    },
    context
  );
  const deterministic = extractDeterministicListing(envelope);
  return {
    deterministic,
    request: buildListingExtractionRequest(buildListingEvidence(envelope), deterministic)
  };
}

describe("buildListingExtractionRequest", () => {
  it("requests every and only unknown field in the closed schema order", () => {
    const { deterministic, request } = pipeline("Title: Sparse synthetic listing");
    const expected = ListingExtractionFieldNameSchema.options.filter((field) => field !== "title");
    expect(request?.fieldRequests.map(({ field }) => field)).toEqual(expected);
    expect(request?.fieldRequests).toHaveLength(19);
    for (const { field, reason } of request?.fieldRequests ?? []) {
      expect(deterministic.extraction[field]).toMatchObject({ status: "unknown", reason });
    }
  });

  it("preserves deterministic ambiguous, conflicting, and format reasons exactly", () => {
    const { request } = pipeline(
      ["Base rent: $2400 per month", "Availability: next month", "2 beds and 3 beds"].join("\n")
    );
    expect(request?.fieldRequests).toEqual(
      expect.arrayContaining([
        { field: "baseRent", reason: "ambiguous" },
        { field: "availableOn", reason: "ambiguous" },
        { field: "bedrooms", reason: "conflicting_evidence" }
      ])
    );
  });

  it("never requests strict structured values already known", () => {
    const envelope = new ManualCaptureConnector().capture(
      {
        kind: "manual_structured",
        listing: {
          source: "other",
          title: "Structured synthetic listing",
          bedrooms: 2,
          baseRent: {
            amountMinorUnits: 250_000,
            currency: "USD",
            billingPeriod: "month",
            rawAmount: "USD 2500 per month"
          },
          requiredRecurringFees: [],
          catsAllowed: true
        }
      },
      context
    );
    const deterministic = extractDeterministicListing(envelope);
    const request = buildListingExtractionRequest(buildListingEvidence(envelope), deterministic);
    expect(request?.fieldRequests.map(({ field }) => field)).not.toEqual(
      expect.arrayContaining([
        "title",
        "bedrooms",
        "baseRent",
        "requiredRecurringFees",
        "catsAllowed"
      ])
    );
  });

  it("returns null when the complete golden record needs no provider help", () => {
    const fullText = [
      "Title: Bright synthetic apartment",
      "2 beds and 1.5 baths",
      "Address: 100 Example Way, Demo City, NY 10001",
      "950 sq ft",
      "Property type: apartment",
      "Base rent: USD 2450 per month",
      "Required parking fee: USD 100 per month",
      "Availability: 2026-08-15",
      "Lease term: 12 months",
      "Cats allowed",
      "Dogs not allowed",
      "Amenities: Laundry, Dishwasher",
      "Posted: 2026-07-16T12:00:00Z",
      "Contact channel: email",
      "Contact name: Avery Example",
      "Email avery@example.invalid",
      "Phone 212-555-0100",
      "Contact URL: https://contact.example/listing/synthetic"
    ].join("\n");
    expect(pipeline(fullText).request).toBeNull();
  });

  it("cannot silently omit or duplicate an unknown field", () => {
    const { deterministic, request } = pipeline("Unlabeled synthetic evidence");
    expect(request?.fieldRequests.map(({ field }) => field)).toEqual(
      ListingExtractionFieldNameSchema.options
    );
    expect(new Set(request?.fieldRequests.map(({ field }) => field)).size).toBe(20);
    expect(Object.keys(deterministic.extraction)).toEqual(ListingExtractionFieldNameSchema.options);
  });
});
