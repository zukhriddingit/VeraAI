import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { DEFAULT_RISK_CONFIG } from "./config.ts";
import { evaluateComparativeRiskCandidates } from "./comparative-rules.ts";
import type { RiskListingInput } from "./types.ts";

const now = "2026-07-20T18:00:00.000Z";

function source(
  id: string,
  overrides: Partial<NormalizedDecisionSource> = {}
): NormalizedDecisionSource {
  return {
    sourceRecordId: id,
    rawListingId: `raw-${id}`,
    source: "other",
    connectorId: "fixture.v1",
    acquisitionMode: "fixture",
    sourceListingId: null,
    acquiredAt: now,
    observedAt: now,
    postedAt: null,
    title: "Synthetic listing",
    normalizedAddress: "12 n main st",
    normalizedUnit: "1",
    normalizedCity: "boston",
    normalizedRegion: "MA",
    normalizedPostalCode: "02110",
    normalizedCountryCode: "US",
    addressMatchKey: "12 n main st|1|boston|MA|02110|US",
    latitude: null,
    longitude: null,
    canonicalUrl: null,
    rentCents: 250_000,
    requiredRecurringFeeCents: 5_000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    availableOn: null,
    descriptionText: "",
    extractionConfidenceBasisPoints: 8_000,
    completenessBasisPoints: 6_000,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["address_normalized"],
    ...overrides
  };
}

function listing(id: string, sources: NormalizedDecisionSource[]): RiskListingInput {
  return { canonicalListingId: id, sources };
}

describe("comparative risk indicators", () => {
  it("finds reused near-identical photos at different addresses", () => {
    const evaluated = listing("canonical-a", [
      source("source-a", {
        photoHashes: [
          {
            listingPhotoId: "photo-a",
            hash: "0000000000000000",
            version: "listing-photo.dhash64.v1"
          }
        ]
      })
    ]);
    const other = listing("canonical-b", [
      source("source-b", {
        normalizedAddress: "900 distant ave",
        addressMatchKey: "900 distant ave|1|boston|MA|02110|US",
        photoHashes: [
          {
            listingPhotoId: "photo-b",
            hash: "0000000000000003",
            version: "listing-photo.dhash64.v1"
          }
        ]
      })
    ]);
    expect(
      evaluateComparativeRiskCandidates(evaluated, [evaluated, other], DEFAULT_RISK_CONFIG).map(
        ({ code }) => code
      )
    ).toContain("reused_photos_different_addresses");
  });

  it("finds material inconsistencies inside a duplicate cluster", () => {
    const evaluated = listing("canonical-a", [
      source("source-a"),
      source("source-b", { rentCents: 320_000, bedrooms: 2 })
    ]);
    expect(
      evaluateComparativeRiskCandidates(evaluated, [evaluated], DEFAULT_RISK_CONFIG).map(
        ({ code }) => code
      )
    ).toContain("material_duplicate_inconsistency");
  });

  it("requires five comparable listings plus both robust outlier gates", () => {
    const evaluated = listing("canonical-a", [
      source("source-a", { normalizedAddress: null, addressMatchKey: null, rentCents: 90_000 })
    ]);
    const resultSet = [evaluated, 240_000, 245_000, 250_000, 255_000].map((entry, index) =>
      typeof entry === "number"
        ? listing(`canonical-${String(index + 2)}`, [
            source(`source-${String(index + 2)}`, { rentCents: entry })
          ])
        : entry
    );
    expect(
      evaluateComparativeRiskCandidates(evaluated, resultSet, DEFAULT_RISK_CONFIG).map(
        ({ code }) => code
      )
    ).toContain("missing_address_extreme_low_price");
    expect(
      evaluateComparativeRiskCandidates(evaluated, resultSet.slice(0, 4), DEFAULT_RISK_CONFIG).map(
        ({ code }) => code
      )
    ).not.toContain("missing_address_extreme_low_price");
  });
});
