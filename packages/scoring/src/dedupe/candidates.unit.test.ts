import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { generateCandidatePairs } from "./candidates.ts";
import { DEFAULT_DEDUPE_CONFIG } from "./config.ts";

const now = "2026-07-20T18:00:00.000Z";

function source(
  id: string,
  overrides: Partial<NormalizedDecisionSource> = {}
): NormalizedDecisionSource {
  return {
    sourceRecordId: id,
    rawListingId: `raw-${id}`,
    source: "other",
    connectorId: "fixture.official-api.v1",
    acquisitionMode: "fixture",
    sourceListingId: null,
    acquiredAt: now,
    observedAt: now,
    postedAt: null,
    title: "Synthetic listing",
    normalizedAddress: null,
    normalizedUnit: null,
    normalizedCity: null,
    normalizedRegion: null,
    normalizedPostalCode: null,
    normalizedCountryCode: null,
    addressMatchKey: null,
    latitude: null,
    longitude: null,
    canonicalUrl: null,
    rentCents: null,
    requiredRecurringFeeCents: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    availableOn: null,
    descriptionText: "",
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["field_unknown"],
    ...overrides
  };
}

describe("bounded duplicate candidate generation", () => {
  it("blocks by source ID, URL, address, contact, and photo evidence", () => {
    const sharedContact = "a".repeat(64);
    const sharedPhoto = "0123456789abcdef";
    const records = [
      source("a", { source: "zillow", sourceListingId: "same" }),
      source("b", { source: "zillow", sourceListingId: "same" }),
      source("c", { canonicalUrl: "https://example.invalid/shared" }),
      source("d", { canonicalUrl: "https://example.invalid/shared" }),
      source("e", {
        normalizedAddress: "12 n main st",
        normalizedUnit: "4b",
        normalizedCity: "boston"
      }),
      source("f", {
        normalizedAddress: "12 n main st",
        normalizedUnit: "4b",
        normalizedCity: "boston"
      }),
      source("g", { contactFingerprints: [sharedContact] }),
      source("h", { contactFingerprints: [sharedContact] }),
      source("i", {
        photoHashes: [
          { listingPhotoId: "photo-i", hash: sharedPhoto, version: "listing-photo.dhash64.v1" }
        ]
      }),
      source("j", {
        photoHashes: [
          { listingPhotoId: "photo-j", hash: sharedPhoto, version: "listing-photo.dhash64.v1" }
        ]
      })
    ];

    const result = generateCandidatePairs(records, DEFAULT_DEDUPE_CONFIG);
    expect(result.wasTruncated).toBe(false);
    expect(result.pairs).toEqual(
      expect.arrayContaining([
        { leftSourceRecordId: "a", rightSourceRecordId: "b" },
        { leftSourceRecordId: "c", rightSourceRecordId: "d" },
        { leftSourceRecordId: "e", rightSourceRecordId: "f" },
        { leftSourceRecordId: "g", rightSourceRecordId: "h" },
        { leftSourceRecordId: "i", rightSourceRecordId: "j" }
      ])
    );
  });

  it("uses deterministic fallback chunks only for records with no useful block", () => {
    const records = [source("a"), source("b"), source("c")];
    const result = generateCandidatePairs(records, {
      ...DEFAULT_DEDUPE_CONFIG,
      fallbackBlockSize: 2
    });
    expect(result.pairs).toEqual([{ leftSourceRecordId: "a", rightSourceRecordId: "b" }]);
  });

  it("is input-order deterministic", () => {
    const records = [
      source("a", { normalizedPostalCode: "02110" }),
      source("b", { normalizedPostalCode: "02110" }),
      source("c", { normalizedPostalCode: "02110" })
    ];
    expect(generateCandidatePairs(records, DEFAULT_DEDUPE_CONFIG)).toEqual(
      generateCandidatePairs([...records].reverse(), DEFAULT_DEDUPE_CONFIG)
    );
  });

  it("fails visibly at the configured safety limit", () => {
    const records = ["a", "b", "c", "d"].map((id) => source(id, { normalizedPostalCode: "02110" }));
    const result = generateCandidatePairs(records, {
      ...DEFAULT_DEDUPE_CONFIG,
      maxCandidatePairs: 2
    });

    expect(result).toMatchObject({
      pairs: [
        { leftSourceRecordId: "a", rightSourceRecordId: "b" },
        { leftSourceRecordId: "a", rightSourceRecordId: "c" }
      ],
      wasTruncated: true,
      candidateCountBeforeLimit: null,
      candidateCountLowerBound: 3,
      limit: 2
    });
  });
});
