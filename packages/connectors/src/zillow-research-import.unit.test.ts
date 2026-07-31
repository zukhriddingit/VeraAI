import type { ZillowObservedListing } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { extractDeterministicListing } from "./deterministic-extraction.ts";
import {
  zillowObservedListingToEnvelope,
  zillowResearchSafeCaptureMetadata
} from "./zillow-research-import.ts";

const observedAt = "2026-07-30T12:00:00.000Z";
const url = "https://www.zillow.com/homedetails/12-Beacon-St-Boston-MA-02108/123_zpid/";
const listing: ZillowObservedListing = {
  sourceListingId: "123",
  canonicalObservedUrl: url,
  finalDetailPageUrl: url,
  address: "12 Beacon St, Boston, MA 02108",
  rentUsd: 3_200,
  bedrooms: 2,
  bathrooms: 1,
  squareFeet: 900,
  availability: "Available now",
  amenities: ["In-unit laundry", "Dishwasher"],
  observedAt,
  sourceFieldProvenance: [
    {
      field: "address",
      observedFrom: "detail_page",
      sourceUrl: url,
      extractionMethod: "openclaw_semantic_snapshot",
      confidenceBasisPoints: 9_500,
      observedAt
    }
  ],
  missingFields: [],
  safeExtractionWarnings: [],
  researchNotes: ["Opened one bounded same-tab Zillow listing detail page."]
};

describe("Zillow research RawListing import", () => {
  it("maps only observed listing evidence into a local-browser envelope", () => {
    const envelope = zillowObservedListingToEnvelope(listing);
    expect(envelope).toMatchObject({
      connectorId: "zillow.browser-research.v1",
      capability: "browser.capture",
      acquisitionMode: "local_browser",
      source: "zillow",
      sourceListingId: "123",
      sourceUrl: url,
      captureMethod: "local_browser",
      observedAt,
      sourcePostedAt: null,
      rawText: null,
      captureMetadata: {
        networkAccess: true,
        untrustedContent: true,
        browserAccess: "policy_entry_present"
      },
      rawJson: {
        source: "zillow",
        sourceListingId: "123",
        url,
        monthlyRentCents: 320_000,
        bedrooms: 2,
        bathrooms: 1,
        addressText: "12 Beacon St, Boston, MA 02108",
        squareFeet: 900,
        availabilityRaw: "Available now",
        amenities: ["In-unit laundry", "Dishwasher"]
      }
    });
    expect(JSON.stringify(envelope)).not.toMatch(/cookie|credential|snapshot|contact|apply|tour/iu);
  });

  it("enters the existing deterministic normalizer with unknown facts left unknown", () => {
    const extraction = extractDeterministicListing(zillowObservedListingToEnvelope(listing));
    expect(extraction.extraction.baseRent).toMatchObject({
      status: "known",
      value: { amountMinorUnits: 320_000, currency: "USD", billingPeriod: "month" }
    });
    expect(extraction.extraction.addressText).toMatchObject({
      status: "known",
      value: "12 Beacon St, Boston, MA 02108"
    });
    expect(extraction.extraction.catsAllowed).toMatchObject({
      status: "unknown",
      value: null
    });
    expect(extraction.extraction.contactChannel).toMatchObject({
      status: "unknown",
      value: null
    });
  });

  it("preserves safe observed-field provenance and research notes outside raw page data", () => {
    expect(
      zillowResearchSafeCaptureMetadata(listing, {
        veraRunId: "run-1",
        searchProfileId: "profile-1"
      })
    ).toEqual({
      connectorId: "zillow.browser-research.v1",
      capability: "browser.capture",
      searchProfileId: "profile-1",
      veraRunId: "run-1",
      extractionMethod: "openclaw_semantic_snapshot",
      missingFields: [],
      safeExtractionWarnings: [],
      researchNotes: ["Opened one bounded same-tab Zillow listing detail page."],
      sourceFieldProvenance: listing.sourceFieldProvenance
    });
  });
});
