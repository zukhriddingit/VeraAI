import { describe, expect, it } from "vitest";

import { DEFAULT_DEDUPE_CONFIG, validateDedupeConfig } from "./config.ts";

describe("dedupe configuration", () => {
  it("uses reviewed weights totaling exactly ten thousand", () => {
    expect(validateDedupeConfig(DEFAULT_DEDUPE_CONFIG)).toBe(DEFAULT_DEDUPE_CONFIG);
    expect(
      Object.values(DEFAULT_DEDUPE_CONFIG.weights).reduce((sum, value) => sum + value, 0)
    ).toBe(10_000);
  });

  it("rejects invalid thresholds, weights, and safety bounds", () => {
    expect(() =>
      validateDedupeConfig({
        ...DEFAULT_DEDUPE_CONFIG,
        reviewThresholdBasisPoints: 8_000,
        automaticLinkThresholdBasisPoints: 7_000
      })
    ).toThrow(/threshold/iu);
    expect(() =>
      validateDedupeConfig({
        ...DEFAULT_DEDUPE_CONFIG,
        weights: { ...DEFAULT_DEDUPE_CONFIG.weights, address: -1 }
      })
    ).toThrow(/weight/iu);
    expect(() => validateDedupeConfig({ ...DEFAULT_DEDUPE_CONFIG, maxCandidatePairs: 0 })).toThrow(
      /limit/iu
    );
  });
});
