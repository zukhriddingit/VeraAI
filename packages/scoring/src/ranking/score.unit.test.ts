import { describe, expect, it } from "vitest";

import type { RiskSignalV2, SearchProfile } from "@vera/domain";

import { DEFAULT_RANKING_CONFIG } from "./config.ts";
import { rankListing } from "./score.ts";
import type { CanonicalScoreInput } from "./types.ts";

const now = "2026-07-20T18:00:00.000Z";

function profile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    id: "profile-primary",
    name: "Primary search",
    version: 1,
    locationText: "Boston, MA",
    centerLatitude: null,
    centerLongitude: null,
    radiusKilometers: null,
    minimumBedrooms: 1,
    minimumBathrooms: 1,
    targetMonthlyTotalCents: 250_000,
    absoluteMonthlyMaximumCents: 300_000,
    moveInEarliest: "2026-08-01",
    moveInLatest: "2026-09-30",
    petRequirements: [{ animal: "cat", required: true, notes: null }],
    commuteAnchors: [],
    hardConstraints: [],
    weightedPreferences: [],
    notificationRules: { enabled: false, minimumScoreBasisPoints: null },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function listing(overrides: Partial<CanonicalScoreInput> = {}): CanonicalScoreInput {
  return {
    canonicalListingId: "canonical-a",
    monthlyRentCents: 240_000,
    recurringFeesCents: 5_000,
    bedrooms: 1,
    bathrooms: 1,
    availableOn: "2026-09-01",
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null },
    amenities: [],
    explicitlyAbsentFeatures: [],
    freshestObservedAt: now,
    selectedFieldConfidences: [
      {
        fieldPath: "monthlyRentCents",
        confidenceBasisPoints: 9_000,
        provenanceId: "provenance-rent"
      }
    ],
    commuteMinutesByAnchor: {},
    ...overrides
  };
}

function risk(severity: RiskSignalV2["severity"]): RiskSignalV2 {
  return {
    id: `risk-${severity}`,
    schemaVersion: 2,
    canonicalListingId: "canonical-a",
    algorithmVersion: "listing-risk.v2",
    inputHash: "a".repeat(64),
    idempotencyKey: (severity === "high" ? "b" : severity === "medium" ? "c" : "d").repeat(64),
    code: "deposit_before_viewing",
    severity,
    confidenceBasisPoints: 9_000,
    evidence: [
      {
        sourceRecordId: "source-a",
        fieldPath: "description",
        summary: "Synthetic payment-before-viewing evidence.",
        excerpt: "deposit before viewing"
      }
    ],
    needsVerification: true,
    verificationAction: "Verify before any payment.",
    status: "open",
    createdAt: now
  };
}

describe("versioned deterministic ranking", () => {
  it("produces a hand-checkable golden score with one weighted factor", () => {
    const config = {
      ...DEFAULT_RANKING_CONFIG,
      factorWeights: {
        monthly_housing_cost: 10_000,
        bedrooms: 0,
        bathrooms: 0,
        move_in_timing: 0,
        pet_policy: 0,
        commute: 0,
        must_haves: 0,
        nice_to_haves: 0
      }
    } as const;
    const score = rankListing(
      { profile: profile(), listing: listing(), risks: [], evaluatedAt: now },
      config
    );

    expect(score).toMatchObject({
      algorithmVersion: "listing-score.v2",
      eligible: true,
      baseScoreBasisPoints: 10_000,
      stalePenaltyBasisPoints: 0,
      lowConfidencePenaltyBasisPoints: 0,
      riskPenaltyBasisPoints: 0,
      finalScoreBasisPoints: 10_000
    });
    expect(score.factors.reduce((sum, factor) => sum + factor.contributionBasisPoints, 0)).toBe(
      score.baseScoreBasisPoints
    );
  });

  it("fails hard constraints only on explicit contradictory evidence", () => {
    const failed = rankListing({
      profile: profile(),
      listing: listing({
        monthlyRentCents: 310_000,
        bedrooms: 0,
        petPolicy: { cats: "not_allowed", dogs: "unknown", notes: null }
      }),
      risks: [],
      evaluatedAt: now
    });
    expect(failed.eligible).toBe(false);
    expect(
      failed.hardConstraints.filter(({ status }) => status === "failed").map(({ code }) => code)
    ).toEqual(
      expect.arrayContaining([
        "budget_exceeded",
        "bedrooms_below_minimum",
        "pets_explicitly_disallowed"
      ])
    );

    const unknown = rankListing({
      profile: profile(),
      listing: listing({ monthlyRentCents: null, bedrooms: null, petPolicy: null }),
      risks: [],
      evaluatedAt: now
    });
    expect(unknown.eligible).toBe(true);
    expect(unknown.hardConstraints.every(({ status }) => status !== "failed")).toBe(true);
    expect(unknown.reasonCodes).toContain("needs_verification");
  });

  it("keeps unknown nice-to-haves neutral unless that preference says penalize", () => {
    const neutralProfile = profile({
      weightedPreferences: [
        {
          code: "laundry",
          weightBasisPoints: 10_000,
          unknownBehavior: "neutral",
          description: "Laundry"
        }
      ]
    });
    const penalizedProfile = profile({
      weightedPreferences: [
        {
          code: "laundry",
          weightBasisPoints: 10_000,
          unknownBehavior: "penalize",
          description: "Laundry"
        }
      ]
    });
    const neutral = rankListing({
      profile: neutralProfile,
      listing: listing(),
      risks: [],
      evaluatedAt: now
    });
    const penalized = rankListing({
      profile: penalizedProfile,
      listing: listing(),
      risks: [],
      evaluatedAt: now
    });

    expect(penalized.baseScoreBasisPoints).toBeLessThan(neutral.baseScoreBasisPoints);
    expect(neutral.reasonCodes).toContain("unknown_neutral");
    expect(penalized.reasonCodes).toContain("unknown_penalized");
  });

  it("persists stale, low-confidence, and risk penalties separately", () => {
    const score = rankListing({
      profile: profile(),
      listing: listing({
        freshestObservedAt: "2026-06-01T00:00:00.000Z",
        selectedFieldConfidences: [
          {
            fieldPath: "monthlyRentCents",
            confidenceBasisPoints: 3_500,
            provenanceId: "provenance-low-confidence"
          }
        ]
      }),
      risks: [risk("high"), risk("medium")],
      evaluatedAt: now
    });

    expect(score.stalePenaltyBasisPoints).toBe(1_500);
    expect(score.lowConfidencePenaltyBasisPoints).toBeGreaterThan(0);
    expect(score.riskPenaltyBasisPoints).toBe(2_250);
    expect(score.finalScoreBasisPoints).toBe(
      Math.max(
        0,
        score.baseScoreBasisPoints -
          score.stalePenaltyBasisPoints -
          score.lowConfidencePenaltyBasisPoints -
          score.riskPenaltyBasisPoints
      )
    );
    expect(score.explanation).toContain("risk indicators");
  });

  it("is byte-for-byte deterministic for identical versioned inputs", () => {
    const input = { profile: profile(), listing: listing(), risks: [], evaluatedAt: now };
    expect(rankListing(input)).toEqual(rankListing(input));
  });
});
