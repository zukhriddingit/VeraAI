import { BrowserResearchPlanSchema, type SearchProfile } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  APARTMENTS_BROWSER_SOURCE_ADAPTER,
  FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER,
  signBrowserResearchPlan
} from "./browser-source-adapter.ts";

const issuedAt = new Date("2026-08-04T14:00:00.000Z");
const signingKey = "unit-test-browser-plan-signing-key-000000000000000000";
const startingTabReference = {
  kind: "single_shared_tab" as const,
  value: "explicitly_shared_zillow_rental_tab" as const
};
const searchProfile: SearchProfile = {
  id: "profile-1",
  name: "Boston",
  version: 1,
  locationText: "Boston, MA",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 290_000,
  absoluteMonthlyMaximumCents: 290_000,
  moveInEarliest: null,
  moveInLatest: null,
  petRequirements: [],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [],
  notificationRules: {
    enabled: false,
    minimumScoreBasisPoints: null
  },
  createdAt: issuedAt.toISOString(),
  updatedAt: issuedAt.toISOString()
};

describe("BrowserSourceAdapter", () => {
  it("creates a strict signed Apartments.com plan without arbitrary actions or URLs", () => {
    const plan = APARTMENTS_BROWSER_SOURCE_ADAPTER.createPlan({
      veraRunId: "apartments-run-1",
      profile: searchProfile,
      startingTabReference,
      signingKey,
      issuedAt
    });

    expect(plan).toMatchObject({
      source: "apartments_com",
      allowedHostnames: ["www.apartments.com"],
      maxResults: 10,
      maxDetailPages: 5,
      maxActions: 50,
      maxDurationMilliseconds: 90_000
    });
    expect(plan.signature).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(plan)).not.toMatch(
      /javascript|cssSelector|coordinate|contact|apply|tour|message|phone|email|payment|upload|download/iu
    );
    expect(() =>
      BrowserResearchPlanSchema.parse({ ...plan, arbitraryUrl: "https://example.com" })
    ).toThrow();
    expect(() =>
      BrowserResearchPlanSchema.parse({ ...plan, allowedHostnames: ["apartments.com.evil.test"] })
    ).toThrow();
  });

  it("caps Facebook detail research at three pages", () => {
    expect(() =>
      FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER.createPlan({
        veraRunId: "facebook-run-1",
        profile: searchProfile,
        startingTabReference,
        signingKey,
        issuedAt,
        maxDetailPages: 4
      })
    ).toThrow();
  });

  it("imports only observed Apartments.com facts through a local-browser envelope", () => {
    const url = "https://www.apartments.com/beacon-hill-boston-ma/abc123/";
    const listing = {
      source: "apartments_com" as const,
      sourceListingId: "abc123",
      canonicalObservedUrl: url,
      finalDetailPageUrl: url,
      propertyName: "Beacon Hill Apartments",
      address: "20 Beacon St, Boston, MA 02108",
      rentUsd: 2_750,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 700,
      availability: "Available now",
      amenities: ["Laundry"],
      fees: ["Application fee visible; amount not shown"],
      observedAt: issuedAt.toISOString(),
      sourceFieldProvenance: [
        {
          field: "address" as const,
          observedFrom: "detail_page" as const,
          sourceUrl: url,
          extractionMethod: "openclaw_semantic_snapshot" as const,
          confidenceBasisPoints: 9_500,
          observedAt: issuedAt.toISOString()
        }
      ],
      missingFields: [],
      safeExtractionWarnings: [],
      researchNotes: ["Read-only extraction."]
    };
    const envelope = APARTMENTS_BROWSER_SOURCE_ADAPTER.toEnvelope(listing);

    expect(envelope).toMatchObject({
      connectorId: "apartments-com.browser-research.v1",
      source: "apartments_com",
      acquisitionMode: "local_browser",
      sourceUrl: url,
      rawJson: {
        title: "Beacon Hill Apartments",
        monthlyRentCents: 275_000,
        addressText: "20 Beacon St, Boston, MA 02108"
      }
    });
    expect(JSON.stringify(envelope)).not.toMatch(/cookie|credential|seller|contact|message/iu);
  });

  it("produces a deterministic signature over the strict plan payload", () => {
    const plan = APARTMENTS_BROWSER_SOURCE_ADAPTER.createPlan({
      veraRunId: "apartments-run-signature",
      profile: searchProfile,
      startingTabReference,
      signingKey,
      issuedAt
    });
    const { signature: _signature, ...payload } = plan;
    expect(signBrowserResearchPlan(payload, signingKey)).toEqual(plan);
  });
});
