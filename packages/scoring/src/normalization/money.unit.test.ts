import { describe, expect, it } from "vitest";

import { normalizeHousingCosts, parseUsdMajorUnitsToCents } from "./money.ts";

describe("parseUsdMajorUnitsToCents", () => {
  it.each([
    ["$2,450", 245_000],
    ["2450.5", 245_050],
    ["0.09", 9],
    [" 1,200.00 USD ", 120_000]
  ] as const)("parses %s with decimal arithmetic", (input, expected) => {
    expect(parseUsdMajorUnitsToCents(input)).toBe(expected);
  });

  it.each(["", "12.345", "-$1", "1e3", "USD unknown"])("rejects %s", (input) => {
    expect(parseUsdMajorUnitsToCents(input)).toBeNull();
  });
});

describe("normalizeHousingCosts", () => {
  it("separates rent and required recurring fees", () => {
    expect(
      normalizeHousingCosts({
        baseRent: { cents: 245_000, currency: "USD", billingPeriod: "month" },
        requiredRecurringFees: [
          { cents: 5_000, currency: "USD", billingPeriod: "month" },
          { cents: 2_500, currency: "USD", billingPeriod: "month" }
        ],
        requiredRecurringFeesKnown: true
      })
    ).toEqual({
      baseRentCents: 245_000,
      requiredRecurringFeeCents: 7_500,
      knownMonthlyTotalCents: 252_500,
      currency: "USD",
      billingPeriod: "month",
      status: "complete"
    });
  });

  it("keeps unknown fees unknown instead of coercing them to zero", () => {
    const result = normalizeHousingCosts({
      baseRent: { cents: 245_000, currency: "USD", billingPeriod: "month" },
      requiredRecurringFees: [],
      requiredRecurringFeesKnown: false
    });

    expect(result.requiredRecurringFeeCents).toBeNull();
    expect(result.knownMonthlyTotalCents).toBeNull();
    expect(result.status).toBe("partial");
  });

  it("preserves non-monthly observations without converting them", () => {
    expect(
      normalizeHousingCosts({
        baseRent: { cents: 80_000, currency: "USD", billingPeriod: "week" },
        requiredRecurringFees: [],
        requiredRecurringFeesKnown: true
      })
    ).toMatchObject({
      baseRentCents: 80_000,
      billingPeriod: "week",
      knownMonthlyTotalCents: null,
      status: "partial"
    });
  });
});
