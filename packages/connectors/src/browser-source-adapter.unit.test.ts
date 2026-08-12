import {
  BOSTON_CRAIGSLIST_CONFIGURATION,
  BrowserResearchPlanSchema,
  BU_OFF_CAMPUS_CONFIGURATION,
  type SearchProfile
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  APARTMENTS_BROWSER_SOURCE_ADAPTER,
  CRAIGSLIST_BROWSER_SOURCE_ADAPTER,
  GenericHousingSourceAdapter,
  OffCampusPartnersAdapter,
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
  it("creates BU and a second Off Campus Partners adapter from configuration only", () => {
    const bu = new OffCampusPartnersAdapter(BU_OFF_CAMPUS_CONFIGURATION);
    const second = new OffCampusPartnersAdapter({
      ...BU_OFF_CAMPUS_CONFIGURATION,
      sourceId: "second_off_campus",
      displayName: "Second Off-Campus Portal",
      startingUrl: "https://housing.example.edu/search",
      allowedDomain: "housing.example.edu"
    });

    expect(
      bu.createPlan({
        veraRunId: "bu-run-1",
        profile: searchProfile,
        startingTabReference,
        signingKey,
        issuedAt
      })
    ).toMatchObject({
      source: "bu_off_campus",
      allowedHostnames: ["offcampus.bu.edu"],
      sourceConfiguration: BU_OFF_CAMPUS_CONFIGURATION
    });
    expect(
      second.createPlan({
        veraRunId: "second-run-1",
        profile: searchProfile,
        startingTabReference,
        signingKey,
        issuedAt
      })
    ).toMatchObject({
      allowedHostnames: ["housing.example.edu"],
      sourceConfiguration: { sourceId: "second_off_campus" }
    });
  });

  it("rejects Off Campus Partners navigation links while preserving property-detail listings", () => {
    const adapter = new OffCampusPartnersAdapter(BU_OFF_CAMPUS_CONFIGURATION);
    const propertyUrl = "https://offcampus.bu.edu/housing/property/the-longwood/c4n4rhf";
    const listing = {
      source: "bu_off_campus" as const,
      sourceConfiguration: BU_OFF_CAMPUS_CONFIGURATION,
      sourceListingId: "c4n4rhf",
      canonicalObservedUrl: propertyUrl,
      finalDetailPageUrl: propertyUrl,
      propertyName: "The Longwood",
      address: "1575 Tremont St, Boston, MA 02120",
      rentUsd: 2_613,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: null,
      availability: null,
      amenities: [],
      fees: [],
      observedAt: issuedAt.toISOString(),
      sourceFieldProvenance: [],
      missingFields: ["square_footage" as const, "availability" as const],
      safeExtractionWarnings: [],
      researchNotes: ["Read-only extraction."]
    };

    expect(adapter.toEnvelope(listing)).toMatchObject({
      sourceListingId: "c4n4rhf",
      sourceUrl: propertyUrl,
      rawJson: { title: "The Longwood" }
    });
    for (const navigationUrl of [
      "https://offcampus.bu.edu/housing/neighborhood-Allston",
      "https://offcampus.bu.edu/housing/campus-Charles-River-Campus",
      "https://offcampus.bu.edu/housing"
    ]) {
      expect(() =>
        adapter.toEnvelope({
          ...listing,
          canonicalObservedUrl: navigationUrl,
          finalDetailPageUrl: navigationUrl
        })
      ).toThrow("offcampus_partners_property_url_required");
    }
  });

  it("creates a navigation-free current-page fallback for a custom public site", () => {
    const source = new GenericHousingSourceAdapter({
      sourceId: "example_housing",
      displayName: "Example Housing",
      adapterKind: "generic",
      startingUrl: "https://housing.example.org/rentals",
      allowedDomain: "housing.example.org",
      loginRequired: "no",
      defaultInclude: false
    });
    const plan = source.createPlan({
      veraRunId: "custom-current-page-1",
      profile: searchProfile,
      startingTabReference,
      signingKey,
      issuedAt,
      mode: "current_page"
    });

    expect(plan).toMatchObject({
      source: "custom_website",
      mode: "current_page",
      maxResults: 1,
      maxDetailPages: 1,
      enabledSafeActionTypes: ["inspect_shared_tabs", "snapshot", "extract_observed_facts"]
    });
    expect(JSON.stringify(plan)).not.toMatch(/navigate|scroll|selector|javascript|submit/iu);
  });

  it("limits Craigslist to the observed Boston search and detail routes", () => {
    const plan = CRAIGSLIST_BROWSER_SOURCE_ADAPTER.createPlan({
      veraRunId: "craigslist-boston-redirect-1",
      profile: searchProfile,
      startingTabReference,
      signingKey,
      issuedAt,
      maxDetailPages: 5
    });

    expect(plan).toMatchObject({
      source: "craigslist",
      allowedHostnames: ["www.craigslist.org"],
      sourceConfiguration: BOSTON_CRAIGSLIST_CONFIGURATION
    });
    expect(plan.allowedUrlPatterns).toHaveLength(2);
    const [searchPattern, detailPattern] = plan.allowedUrlPatterns;
    expect(
      new RegExp(searchPattern!).test(
        "https://www.craigslist.org/search/area/boston?cat=apa#search=2~gallery~0"
      )
    ).toBe(true);
    expect(
      new RegExp(detailPattern!).test(
        "https://www.craigslist.org/view/d/somerville-laundry-in-unit/1Dn8j1xVrmWNhxYMAKRmmE"
      )
    ).toBe(true);
    for (const url of [
      "https://www.craigslist.org/search/area/newyork?cat=apa",
      "https://www.craigslist.org/about/help",
      "https://www.craigslist.org/reply/bos/apa/123",
      "https://boston.craigslist.org/search/apa"
    ]) {
      expect(plan.allowedUrlPatterns.some((pattern) => new RegExp(pattern).test(url))).toBe(false);
    }
  });

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
      maxDetailPages: 0,
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

  it("separates exact adjacent Facebook price and bedroom markers", () => {
    const url = "https://www.facebook.com/marketplace/item/123456789/";
    const listing = {
      source: "facebook_marketplace" as const,
      sourceListingId: "123456789",
      canonicalObservedUrl: url,
      finalDetailPageUrl: null,
      propertyName: "$1,0502 Beds 1 Bath HouseSomerville, MA",
      address: null,
      rentUsd: 10_502,
      bedrooms: 2,
      bathrooms: 1,
      squareFeet: null,
      availability: null,
      amenities: [],
      fees: [],
      observedAt: issuedAt.toISOString(),
      sourceUpdatedAt: "2026-08-04T13:30:00.000Z",
      sourceFieldProvenance: [],
      missingFields: ["address" as const],
      safeExtractionWarnings: [],
      researchNotes: ["Read-only extraction."]
    };

    expect(FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER.toEnvelope(listing)).toMatchObject({
      rawJson: {
        monthlyRentCents: 105_000,
        bedrooms: 2,
        baseRent: { amountMinorUnits: 105_000, rawAmount: "$1,050/month" }
      }
    });
    expect(
      FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER.safeCaptureMetadata(listing, {
        veraRunId: "facebook-run-1",
        searchProfileId: searchProfile.id
      })
    ).toMatchObject({
      safeExtractionWarnings: [
        "Separated exact adjacent Facebook price and bedroom markers from visible evidence."
      ]
    });
    expect(() =>
      FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER.toEnvelope({
        ...listing,
        description: "Call 617-555-1212 for this apartment."
      })
    ).toThrow(/phone numbers/iu);
  });

  it("recovers exact visible Facebook card facts when separate fields are missing", () => {
    const url = "https://www.facebook.com/marketplace/item/987654321/";
    const listing = {
      source: "facebook_marketplace" as const,
      sourceListingId: "987654321",
      canonicalObservedUrl: url,
      finalDetailPageUrl: null,
      propertyName: "$1,2155 Beds 5.5 Baths ApartmentSomerville, MA",
      address: null,
      rentUsd: 12_155,
      bedrooms: null,
      bathrooms: null,
      squareFeet: null,
      availability: null,
      amenities: [],
      fees: [],
      observedAt: issuedAt.toISOString(),
      sourceFieldProvenance: [],
      missingFields: ["address" as const, "bedrooms" as const, "bathrooms" as const],
      safeExtractionWarnings: [],
      researchNotes: ["Read-only extraction."]
    };

    expect(FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER.toEnvelope(listing)).toMatchObject({
      rawJson: {
        monthlyRentCents: 121_500,
        bedrooms: 5,
        bathrooms: 5.5,
        baseRent: { amountMinorUnits: 121_500, rawAmount: "$1,215/month" }
      }
    });
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
      sourceUpdatedAt: "2026-08-04T13:30:00.000Z",
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
      sourcePostedAt: "2026-08-04T13:30:00.000Z",
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
