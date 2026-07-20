import { describe, expect, it } from "vitest";

import {
  addressSimilarity,
  bedsBathsSimilarity,
  geographicSimilarity,
  photoSimilarity,
  postingTimeSimilarity,
  rentSimilarity,
  squareFeetSimilarity,
  textSimilarity
} from "./features.ts";

describe("dedupe feature functions", () => {
  it("scores normalized address evidence without treating missing as zero", () => {
    expect(addressSimilarity("12 n main st", "12 n main st").scoreBasisPoints).toBe(10_000);
    expect(
      addressSimilarity("12 n main st", "12 north main street").scoreBasisPoints
    ).toBeGreaterThan(5_000);
    expect(addressSimilarity(null, "12 n main st")).toMatchObject({
      status: "unknown",
      scoreBasisPoints: null
    });
  });

  it("uses reviewed geographic distance boundaries", () => {
    expect(geographicSimilarity(42, -71, 42, -71).scoreBasisPoints).toBe(10_000);
    expect(geographicSimilarity(42, -71, 42.01, -71).scoreBasisPoints).toBe(0);
    expect(geographicSimilarity(null, null, 42, -71).status).toBe("unknown");
  });

  it("uses relative rent and square-foot boundaries", () => {
    expect(rentSimilarity(100_000, 102_000).scoreBasisPoints).toBe(10_000);
    expect(rentSimilarity(100_000, 125_000).scoreBasisPoints).toBe(0);
    expect(squareFeetSimilarity(1_000, 1_050).scoreBasisPoints).toBe(10_000);
    expect(squareFeetSimilarity(1_000, 1_500).scoreBasisPoints).toBe(0);
  });

  it("scores beds and baths independently over known values", () => {
    expect(bedsBathsSimilarity(1, 1, 1, 1).scoreBasisPoints).toBe(10_000);
    expect(bedsBathsSimilarity(1, null, 1.5, null).scoreBasisPoints).toBe(5_000);
    expect(bedsBathsSimilarity(null, null, null, null).status).toBe("unknown");
  });

  it("uses deterministic token-Dice text similarity", () => {
    const forward = textSimilarity("Sunny home with laundry", "Laundry in a sunny home");
    const reverse = textSimilarity("Laundry in a sunny home", "Sunny home with laundry");
    expect(forward).toEqual(reverse);
    expect(forward.scoreBasisPoints).toBe(10_000);
  });

  it("uses the minimum photo-hash distance", () => {
    expect(
      photoSimilarity(
        [{ listingPhotoId: "a", hash: "0000000000000000", version: "listing-photo.dhash64.v1" }],
        [{ listingPhotoId: "b", hash: "0000000000000003", version: "listing-photo.dhash64.v1" }]
      ).scoreBasisPoints
    ).toBe(10_000);
    expect(
      photoSimilarity(
        [{ listingPhotoId: "a", hash: "0000000000000000", version: "listing-photo.dhash64.v1" }],
        [{ listingPhotoId: "b", hash: "ffffffffffffffff", version: "listing-photo.dhash64.v1" }]
      ).scoreBasisPoints
    ).toBe(0);
  });

  it("uses absolute posting-time proximity", () => {
    expect(
      postingTimeSimilarity("2026-07-20T00:00:00.000Z", "2026-07-21T00:00:00.000Z").scoreBasisPoints
    ).toBe(10_000);
    expect(
      postingTimeSimilarity("2026-06-01T00:00:00.000Z", "2026-07-20T00:00:00.000Z").scoreBasisPoints
    ).toBe(0);
  });
});
