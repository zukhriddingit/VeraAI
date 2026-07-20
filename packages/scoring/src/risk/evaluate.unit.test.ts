import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { evaluateRiskIndicators } from "./evaluate.ts";

const now = "2026-07-20T18:00:00.000Z";

const source: NormalizedDecisionSource = {
  sourceRecordId: "source-a",
  rawListingId: "raw-a",
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
  requiredRecurringFeeCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: null,
  availableOn: null,
  descriptionText: "Send a wire transfer before viewing the apartment.",
  extractionConfidenceBasisPoints: 8_000,
  completenessBasisPoints: 6_000,
  photoHashes: [],
  contactFingerprints: [],
  fieldCandidates: [],
  normalizationReasonCodes: ["address_normalized"]
};

describe("versioned risk evaluation", () => {
  it("deduplicates signals, creates stable keys, and uses non-verdict language", () => {
    const listing = { canonicalListingId: "canonical-a", sources: [source] };
    const first = evaluateRiskIndicators(listing, [listing], now);
    const second = evaluateRiskIndicators(listing, [listing], now);

    expect(first).toEqual(second);
    expect(new Set(first.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(first.length);
    expect(first.map(({ code }) => code)).toEqual([
      "deposit_before_viewing",
      "suspicious_payment_method"
    ]);
    expect(first.every(({ algorithmVersion }) => algorithmVersion === "listing-risk.v2")).toBe(
      true
    );
    const serialized = JSON.stringify(first).toLowerCase();
    expect(serialized).not.toContain("scam");
    expect(serialized).not.toContain("fraud");
    expect(serialized).toContain("risk indicator");
  });
});
