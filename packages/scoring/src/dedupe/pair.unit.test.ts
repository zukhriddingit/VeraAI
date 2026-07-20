import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { DEFAULT_DEDUPE_CONFIG } from "./config.ts";
import { evaluateDuplicatePair } from "./pair.ts";

const now = "2026-07-20T18:00:00.000Z";
const hashA = "a".repeat(64);

function source(
  id: string,
  overrides: Partial<NormalizedDecisionSource> = {}
): NormalizedDecisionSource {
  return {
    sourceRecordId: id,
    rawListingId: `raw-${id}`,
    source: id.endsWith("a") ? "zillow" : "craigslist",
    connectorId: "fixture.official-api.v1",
    acquisitionMode: "fixture",
    sourceListingId: `listing-${id}`,
    acquiredAt: now,
    observedAt: now,
    postedAt: now,
    title: "Synthetic apartment",
    normalizedAddress: "12 n main st",
    normalizedUnit: "4b",
    normalizedCity: "boston",
    normalizedRegion: "MA",
    normalizedPostalCode: "02110",
    normalizedCountryCode: "US",
    addressMatchKey: "12 n main st|4b|boston|MA|02110|US",
    latitude: null,
    longitude: null,
    canonicalUrl: `https://example.invalid/${id}`,
    rentCents: 245_000,
    requiredRecurringFeeCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 680,
    availableOn: "2026-09-01",
    descriptionText: "Sunny synthetic home with laundry and bicycle storage.",
    extractionConfidenceBasisPoints: 9_000,
    completenessBasisPoints: 8_000,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["address_normalized"],
    ...overrides
  };
}

function evaluate(left: NormalizedDecisionSource, right: NormalizedDecisionSource) {
  return evaluateDuplicatePair({ left, right, config: DEFAULT_DEDUPE_CONFIG, evaluatedAt: now });
}

describe("duplicate pair evaluation", () => {
  it("links exact source identity, canonical URL, and known address plus unit", () => {
    const left = source("source-a", { source: "zillow", sourceListingId: "z-1" });
    const right = source("source-b", {
      source: "zillow",
      sourceListingId: "z-1",
      canonicalUrl: left.canonicalUrl
    });
    const pair = evaluate(left, right);

    expect(pair.decision).toBe("link");
    expect(pair.exactReasonCodes).toEqual([
      "same_source_listing_id",
      "exact_canonical_url",
      "exact_normalized_address_unit"
    ]);
  });

  it("keeps different known units separate", () => {
    const pair = evaluate(source("source-a"), source("source-b", { normalizedUnit: "5c" }));
    expect(pair.decision).toBe("separate");
    expect(pair.conflictReasonCodes).toContain("conflicting_units");
  });

  it("requires an additional property feature for contact-only links", () => {
    const left = source("source-a", {
      normalizedAddress: null,
      normalizedUnit: null,
      addressMatchKey: null,
      rentCents: null,
      bedrooms: null,
      bathrooms: null,
      squareFeet: null,
      descriptionText: "",
      postedAt: null,
      contactFingerprints: [hashA]
    });
    const right = source("source-b", {
      normalizedAddress: null,
      normalizedUnit: null,
      addressMatchKey: null,
      rentCents: null,
      bedrooms: null,
      bathrooms: null,
      squareFeet: null,
      descriptionText: "",
      postedAt: null,
      contactFingerprints: [hashA]
    });

    expect(evaluate(left, right)).toMatchObject({
      decision: "separate",
      contactMatched: true,
      exactReasonCodes: ["exact_contact_match"]
    });
    expect(evaluate(left, { ...right, rentCents: 250_000 }).decision).toBe("separate");
    expect(
      evaluate({ ...left, rentCents: 248_000 }, { ...right, rentCents: 250_000 }).decision
    ).toBe("link");
  });

  it("does not merge a reused photo across materially different addresses", () => {
    const photo = {
      listingPhotoId: "photo-a",
      hash: "0123456789abcdef",
      version: "listing-photo.dhash64.v1" as const
    };
    const pair = evaluate(
      source("source-a", { photoHashes: [photo] }),
      source("source-b", {
        normalizedAddress: "900 faraway ave",
        normalizedUnit: "1",
        normalizedCity: "new york",
        addressMatchKey: "900 faraway ave|1|new york|NY|10001|US",
        descriptionText: "Different synthetic listing description.",
        photoHashes: [{ ...photo, listingPhotoId: "photo-b" }]
      })
    );

    expect(pair.decision).not.toBe("link");
    expect(pair.exactReasonCodes).toContain("exact_photo_hash");
    expect(pair.conflictReasonCodes).toContain("material_location_conflict");
  });

  it("turns hard identity plus material property conflicts into review", () => {
    const left = source("source-a", { canonicalUrl: "https://example.invalid/shared" });
    const right = source("source-b", {
      canonicalUrl: "https://example.invalid/shared",
      rentCents: 400_000,
      bedrooms: 3
    });
    expect(evaluate(left, right).decision).toBe("review");
  });

  it("is input-order deterministic and never serializes contact fingerprints", () => {
    const left = source("source-a", { contactFingerprints: [hashA] });
    const right = source("source-b", { contactFingerprints: [hashA] });
    const forward = evaluate(left, right);
    const reverse = evaluate(right, left);

    expect(forward).toEqual(reverse);
    expect(JSON.stringify(forward)).not.toContain(hashA);
    expect(forward.inputHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
