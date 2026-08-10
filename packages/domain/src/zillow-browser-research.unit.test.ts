import { describe, expect, it } from "vitest";

import {
  ZILLOW_RESEARCH_MAX_DETAIL_PAGES,
  ZILLOW_RESEARCH_MAX_RESULTS,
  ZillowObservedListingSchema,
  ZillowRentalResearchInputSchema,
  ZillowRentalResearchOutputSchema
} from "./zillow-browser-research.ts";

const validInput = {
  version: "1",
  veraRunId: "run_01",
  profile: {
    location: "Boston, MA",
    maximumRentUsd: 3_500,
    minimumBedrooms: 2,
    minimumBathrooms: 1
  },
  maxResults: ZILLOW_RESEARCH_MAX_RESULTS,
  maxDetailPages: ZILLOW_RESEARCH_MAX_DETAIL_PAGES,
  startingTabReference: { kind: "target_id", value: "tab-reviewed-1" }
} as const;

const observedAt = "2026-07-30T12:00:00.000Z";
const observedUrl = "https://www.zillow.com/homedetails/1-Boston-St-Boston-MA/123_zpid/";
const baseListing = {
  sourceListingId: null,
  canonicalObservedUrl: observedUrl,
  finalDetailPageUrl: null,
  address: null,
  rentUsd: null,
  bedrooms: null,
  bathrooms: null,
  squareFeet: null,
  availability: null,
  amenities: [],
  observedAt,
  sourceFieldProvenance: [],
  missingFields: ["source_listing_id", "address", "rent"],
  safeExtractionWarnings: [],
  researchNotes: []
} as const;

describe("ZillowRentalResearchInputSchema", () => {
  it("accepts only explicit bounded profile input and a safe tab reference", () => {
    expect(ZillowRentalResearchInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects model-generated URLs, selectors, scripts, and excess limits", () => {
    for (const forbidden of [
      { url: "https://www.zillow.com/boston-ma/rentals/" },
      { selector: ".search-button" },
      { javascript: "document.body.innerText" },
      { actions: [{ kind: "click", x: 1, y: 1 }] },
      { credentials: { password: "not-accepted" } }
    ]) {
      expect(
        ZillowRentalResearchInputSchema.safeParse({ ...validInput, ...forbidden }).success
      ).toBe(false);
    }

    expect(
      ZillowRentalResearchInputSchema.safeParse({
        ...validInput,
        maxResults: ZILLOW_RESEARCH_MAX_RESULTS + 1
      }).success
    ).toBe(false);
    expect(
      ZillowRentalResearchInputSchema.safeParse({
        ...validInput,
        maxDetailPages: ZILLOW_RESEARCH_MAX_DETAIL_PAGES + 1
      }).success
    ).toBe(false);
  });
});

describe("ZillowObservedListingSchema", () => {
  it("preserves observed evidence, missing fields, and field provenance", () => {
    const listing = ZillowObservedListingSchema.parse({
      sourceListingId: "123",
      canonicalObservedUrl: observedUrl,
      finalDetailPageUrl: observedUrl,
      address: "1 Boston St, Boston, MA",
      rentUsd: 3_200,
      bedrooms: 2,
      bathrooms: 1,
      squareFeet: null,
      availability: null,
      amenities: ["Laundry in unit"],
      observedAt,
      sourceFieldProvenance: [
        {
          field: "address",
          observedFrom: "detail_page",
          sourceUrl: observedUrl,
          extractionMethod: "openclaw_semantic_snapshot",
          confidenceBasisPoints: 10_000,
          observedAt
        }
      ],
      missingFields: ["square_footage", "availability"],
      safeExtractionWarnings: [],
      researchNotes: ["One bounded detail page was inspected."]
    });

    expect(listing.address).toBe("1 Boston St, Boston, MA");
    expect(listing.missingFields).toEqual(["square_footage", "availability"]);
  });

  it("rejects off-host URLs and duplicate field provenance", () => {
    expect(
      ZillowObservedListingSchema.safeParse({
        ...baseListing,
        canonicalObservedUrl: "https://example.com/homedetails/123/"
      }).success
    ).toBe(false);
    expect(
      ZillowObservedListingSchema.safeParse({
        ...baseListing,
        sourceFieldProvenance: [
          {
            field: "address",
            observedFrom: "result_card",
            sourceUrl: observedUrl,
            extractionMethod: "openclaw_semantic_snapshot",
            confidenceBasisPoints: 9_000,
            observedAt
          },
          {
            field: "address",
            observedFrom: "detail_page",
            sourceUrl: observedUrl,
            extractionMethod: "openclaw_semantic_snapshot",
            confidenceBasisPoints: 10_000,
            observedAt
          }
        ]
      }).success
    ).toBe(false);
  });

  it("accepts only Zillow's reviewed apartment-bedroom and building-unit fragments", () => {
    for (const url of [
      "https://www.zillow.com/apartments/the-lola/boston-ma/5XjVQx/#bedrooms-2",
      "https://www.zillow.com/b/the-lola-boston-ma/5XjVQx/#unit-2"
    ]) {
      expect(
        ZillowObservedListingSchema.safeParse({
          ...baseListing,
          canonicalObservedUrl: url,
          finalDetailPageUrl: url
        }).success
      ).toBe(true);
    }

    expect(
      ZillowObservedListingSchema.safeParse({
        ...baseListing,
        canonicalObservedUrl: "https://www.zillow.com/apartments/the-lola/boston-ma/5XjVQx/#contact"
      }).success
    ).toBe(false);
  });
});

describe("ZillowRentalResearchOutputSchema", () => {
  it("requires a reason when manual action is required", () => {
    const output = {
      version: "1",
      veraRunId: "run_01",
      state: "manual_action_required",
      pageState: "captcha_required",
      manualAction: null,
      listings: [],
      resultCardsObserved: 0,
      detailPagesOpened: 0,
      resultPageExpansions: 0,
      startedAt: observedAt,
      completedAt: observedAt,
      safeActionTrail: [],
      warnings: []
    } as const;

    expect(ZillowRentalResearchOutputSchema.safeParse(output).success).toBe(false);
    expect(
      ZillowRentalResearchOutputSchema.parse({
        ...output,
        manualAction: "captcha_required"
      }).manualAction
    ).toBe("captcha_required");
  });
});
