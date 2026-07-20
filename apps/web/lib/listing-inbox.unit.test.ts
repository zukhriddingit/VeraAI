import { CanonicalListingSummarySchema, type CanonicalListingSummary } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LISTING_INBOX_QUERY,
  listingInboxTabCounts,
  listingMonthlyTotalCents,
  refineListingInbox,
  type ListingInboxQuery
} from "./listing-inbox.ts";

function listing(
  id: string,
  overrides: Partial<CanonicalListingSummary> = {}
): CanonicalListingSummary {
  return CanonicalListingSummarySchema.parse({
    id,
    title: `Listing ${id}`,
    address: {
      line1: `${id} Example Way`,
      unit: null,
      city: "Harbor City",
      region: "MA",
      postalCode: null,
      countryCode: "US"
    },
    monthlyRentCents: 200_000,
    recurringFeesCents: 10_000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 700,
    availableOn: "2026-09-01",
    leaseTermMonths: 12,
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null },
    lifecycleState: "new",
    projectionState: "active",
    supersededById: null,
    completenessBasisPoints: 9_000,
    freshestObservedAt: "2026-07-20T12:00:00.000Z",
    freshestSourcePostedAt: "2026-07-20T11:30:00.000Z",
    alertLatencySeconds: 1_800,
    sourceLabels: ["zillow"],
    sourceRecordCount: 1,
    duplicateCount: 0,
    unknownFields: [],
    fitScoreBasisPoints: 8_000,
    eligible: true,
    baseScoreBasisPoints: 8_000,
    stalePenaltyBasisPoints: 0,
    lowConfidencePenaltyBasisPoints: 0,
    riskPenaltyBasisPoints: 0,
    fitLabel: "strong_fit",
    topPositiveReason: "Matches the target monthly cost.",
    topConcern: "No deterministic concern is active.",
    riskIndicatorCount: 0,
    highestRiskSeverity: null,
    ...overrides
  });
}

const corpus = [
  listing("alpha", { fitScoreBasisPoints: 7_000, freshestObservedAt: "2026-07-20T10:00:00.000Z" }),
  listing("bravo", {
    lifecycleState: "shortlisted",
    fitScoreBasisPoints: 9_000,
    monthlyRentCents: 180_000,
    recurringFeesCents: 5_000,
    sourceLabels: ["craigslist", "zillow"],
    sourceRecordCount: 2,
    duplicateCount: 1,
    unknownFields: ["availability"],
    riskIndicatorCount: 2,
    highestRiskSeverity: "medium",
    freshestObservedAt: "2026-07-20T11:00:00.000Z"
  }),
  listing("charlie", {
    lifecycleState: "replied",
    eligible: false,
    fitScoreBasisPoints: 9_500,
    monthlyRentCents: 160_000,
    recurringFeesCents: 0,
    riskIndicatorCount: 1,
    highestRiskSeverity: "high",
    freshestObservedAt: "2026-07-20T13:00:00.000Z"
  }),
  listing("delta", {
    lifecycleState: "tour_scheduled",
    eligible: null,
    fitScoreBasisPoints: null,
    monthlyRentCents: 150_000,
    recurringFeesCents: null,
    sourceLabels: ["apartments_com"],
    unknownFields: ["recurring fees"]
  }),
  listing("echo", {
    lifecycleState: "dismissed",
    riskIndicatorCount: 3,
    highestRiskSeverity: "low"
  })
];

function query(overrides: Partial<ListingInboxQuery>): ListingInboxQuery {
  return { ...DEFAULT_LISTING_INBOX_QUERY, ...overrides };
}

describe("listing inbox refinement", () => {
  it("maps lifecycle states into stable user-facing tabs", () => {
    expect(listingInboxTabCounts(corpus)).toEqual({
      new: 1,
      shortlisted: 1,
      contacted: 1,
      tours: 1,
      archived: 1,
      all: 5
    });
    expect(refineListingInbox(corpus, query({ tab: "contacted" })).map(({ id }) => id)).toEqual([
      "charlie"
    ]);
  });

  it("sorts fit with excluded records behind eligible records", () => {
    expect(
      refineListingInbox(corpus, query({ tab: "all", sort: "fit" })).map(({ id }) => id)
    ).toEqual(["bravo", "echo", "alpha", "delta", "charlie"]);
  });

  it("sorts freshness, known total price, and risk deterministically", () => {
    expect(refineListingInbox(corpus, query({ tab: "all", sort: "freshness" }))[0]?.id).toBe(
      "charlie"
    );
    expect(refineListingInbox(corpus, query({ tab: "all", sort: "price" }))[0]?.id).toBe("charlie");
    expect(refineListingInbox(corpus, query({ tab: "all", sort: "risk" }))[0]?.id).toBe("charlie");
    expect(listingMonthlyTotalCents(corpus[3]!)).toBeNull();
  });

  it("combines hard-constraint, missing, duplicate, and source filters", () => {
    expect(
      refineListingInbox(
        corpus,
        query({
          tab: "all",
          constraint: "eligible",
          missingFactsOnly: true,
          duplicatesOnly: true,
          source: "craigslist"
        })
      ).map(({ id }) => id)
    ).toEqual(["bravo"]);
    expect(
      refineListingInbox(corpus, query({ tab: "all", constraint: "unknown" })).map(({ id }) => id)
    ).toEqual(["delta"]);
  });
});
