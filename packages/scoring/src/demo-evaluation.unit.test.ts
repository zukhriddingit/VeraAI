import { describe, expect, it } from "vitest";

import type { CanonicalListing, ListingSourceRecord, SearchProfile } from "@vera/domain";

import { deriveDemoRiskSignals, scoreDemoListing } from "./demo-evaluation.ts";

const now = "2026-07-17T12:20:00.000Z";
const profile: SearchProfile = {
  id: "profile-test",
  name: "Test search",
  version: 1,
  locationText: "Harbor City",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: null,
  targetMonthlyTotalCents: 260_000,
  absoluteMonthlyMaximumCents: 300_000,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  petRequirements: [{ animal: "cat", required: true, notes: null }],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: now,
  updatedAt: now
};

function listing(overrides: Partial<CanonicalListing> = {}): CanonicalListing {
  return {
    id: "can-test",
    duplicateClusterId: null,
    primarySourceRecordId: "src-test",
    title: "Sanitized test home",
    address: {
      line1: "1 Example Way",
      unit: "1A",
      city: "Harbor City",
      region: "MA",
      postalCode: "00001",
      countryCode: "US"
    },
    monthlyRentCents: 250_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 700,
    propertyType: "apartment",
    availableOn: "2026-09-10",
    leaseTermMonths: 12,
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null },
    amenities: [],
    description: "Synthetic fixture.",
    lifecycleState: "new",
    projectionState: "active",
    supersededById: null,
    stitchVersion: null,
    stitchInputHash: null,
    updatedByDecisionRunId: null,
    completenessBasisPoints: 9_000,
    freshestObservedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function source(
  id: string,
  monthlyRentCents: number,
  description: string,
  unit = "1A"
): ListingSourceRecord {
  return {
    id,
    rawListingId: `raw-${id}`,
    source: "other",
    sourceListingId: id,
    sourceUrl: `https://example.invalid/${id}`,
    sourcePostedAt: null,
    contactChannel: "unknown",
    title: "Synthetic source",
    address: {
      line1: "1 Example Way",
      unit,
      city: "Harbor City",
      region: "MA",
      postalCode: "00001",
      countryCode: "US"
    },
    monthlyRentCents,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    latitude: null,
    longitude: null,
    propertyType: "apartment",
    availableOn: null,
    leaseTermMonths: null,
    petPolicy: null,
    amenities: [],
    description,
    extractionConfidenceBasisPoints: 10_000,
    completenessBasisPoints: 7_000,
    observedAt: now,
    createdAt: now
  };
}

describe("scoreDemoListing", () => {
  it("scores known matches and keeps unknown facts neutral", () => {
    const result = scoreDemoListing(profile, listing({ monthlyRentCents: null }));
    const budget = result.factors.find((entry) => entry.code === "budget_fit");

    expect(budget?.scoreBasisPoints).toBe(0);
    expect(budget?.reasonCode).toBe("budget_unknown");
    expect(result.topConcern).toContain("Rent needs verification");
  });

  it("does not treat unknown pet policy as incompatible", () => {
    const result = scoreDemoListing(profile, listing({ petPolicy: null }));

    expect(
      result.factors.find((entry) => entry.code === "pet_compatibility")?.scoreBasisPoints
    ).toBe(0);
    expect(result.reasonCodes).toContain("pet_policy_unknown");
  });

  it("uses only four equally weighted deterministic factors", () => {
    const result = scoreDemoListing(profile, listing());

    expect(result.factors.map((entry) => entry.code)).toEqual([
      "budget_fit",
      "bedroom_fit",
      "pet_compatibility",
      "move_in_compatibility"
    ]);
    expect(result.factors.every((entry) => entry.weightBasisPoints === 2_500)).toBe(true);
    expect(result.totalScoreBasisPoints).toBeGreaterThan(0);
  });
});

describe("deriveDemoRiskSignals", () => {
  it("creates evidence-backed payment-language and conflicting-rent signals", () => {
    const signals = deriveDemoRiskSignals(
      listing(),
      [
        source("one", 245_000, "Synthetic request: pay a gift card deposit before viewing."),
        source("two", 247_500, "Synthetic duplicate fixture.")
      ],
      now
    );

    expect(signals.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "payment_before_viewing",
        "high_risk_payment_language",
        "conflicting_rent_evidence"
      ])
    );
    expect(signals.every((entry) => entry.evidence.length > 0)).toBe(true);
    expect(JSON.stringify(signals)).not.toMatch(/definitive|scam verdict/iu);
  });

  it("detects conflicting normalized units without inventing a verdict", () => {
    const signals = deriveDemoRiskSignals(
      listing(),
      [
        source("one", 245_000, "Synthetic fixture.", "1A"),
        source("two", 245_000, "Synthetic fixture.", "2B")
      ],
      now
    );

    expect(signals.map((entry) => entry.code)).toContain("conflicting_address_evidence");
  });
});
