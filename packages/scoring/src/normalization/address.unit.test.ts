import { describe, expect, it } from "vitest";

import { normalizeUsAddress } from "./address.ts";

const emptyAddress = {
  line1: null,
  unit: null,
  city: null,
  region: null,
  postalCode: null,
  countryCode: null
} as const;

describe("normalizeUsAddress", () => {
  it("normalizes US street tokens and extracts an explicit unit", () => {
    expect(
      normalizeUsAddress({
        address: {
          line1: "12 North Main Street Apt. #4B",
          unit: null,
          city: "Boston",
          region: "ma",
          postalCode: "02110 1234",
          countryCode: "us"
        }
      })
    ).toEqual({
      line1: "12 n main st",
      unit: "4b",
      city: "boston",
      region: "MA",
      postalCode: "02110-1234",
      countryCode: "US",
      matchKey: "12 n main st|4b|boston|MA|02110-1234|US",
      reasonCodes: ["address_normalized", "unit_extracted"],
      ambiguous: false
    });
  });

  it("normalizes equivalent abbreviations identically", () => {
    const expanded = normalizeUsAddress({
      address: {
        line1: "90 West Cedar Avenue",
        unit: "Apartment 3-A",
        city: "Cambridge",
        region: "Massachusetts",
        postalCode: "02139",
        countryCode: "US"
      }
    });
    const abbreviated = normalizeUsAddress({
      address: {
        line1: "90 W. Cedar Ave.",
        unit: "#3A",
        city: "CAMBRIDGE",
        region: "MA",
        postalCode: "02139",
        countryCode: "us"
      }
    });

    expect(expanded.matchKey).toBe(abbreviated.matchKey);
    expect(expanded.unit).toBe("3a");
  });

  it("keeps missing unit distinct from a known unit", () => {
    const missing = normalizeUsAddress({
      address: { ...emptyAddress, line1: "1 Example Road", countryCode: "US" }
    });
    const known = normalizeUsAddress({
      address: { ...emptyAddress, line1: "1 Example Road", unit: "2", countryCode: "US" }
    });

    expect(missing.matchKey).toContain("|__unknown_unit__|");
    expect(missing.matchKey).not.toBe(known.matchKey);
  });

  it("preserves ambiguous conflicting unit evidence visibly", () => {
    const normalized = normalizeUsAddress({
      address: {
        ...emptyAddress,
        line1: "7 Oak Road Unit 2",
        unit: "Unit 3",
        countryCode: "US"
      }
    });

    expect(normalized.unit).toBe("3");
    expect(normalized.ambiguous).toBe(true);
    expect(normalized.reasonCodes).toContain("conflicting_unit_evidence");
  });

  it("never invents absent address components", () => {
    expect(normalizeUsAddress({ address: emptyAddress })).toEqual({
      line1: null,
      unit: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
      matchKey: null,
      reasonCodes: ["address_missing"],
      ambiguous: false
    });
  });
});
