import { describe, expect, it } from "vitest";

import {
  CanonicalListingPlanSchema,
  DECISION_NORMALIZATION_VERSION,
  DECISION_PLAN_VERSION,
  DEDUPE_VERSION,
  DecisionJobSchema,
  DecisionJobStatusSchema,
  DecisionPlanSchema,
  DuplicateClusterPlanSchema,
  DuplicateOverrideSchema,
  DuplicatePairEvaluationSchema,
  ListingScoreV2Schema,
  PHOTO_HASH_VERSION,
  RISK_VERSION,
  RiskSignalV2Schema,
  SCORE_VERSION,
  STITCH_VERSION,
  NormalizedDecisionSourceSchema
} from "./decision.ts";
import { SearchProfileSchema } from "./search-profile.ts";

const now = "2026-07-20T16:00:00.000Z";
const later = "2026-07-20T16:01:00.000Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

const normalizedSource = {
  sourceRecordId: "source-a",
  rawListingId: "raw-a",
  source: "zillow",
  connectorId: "fixture.official-api.v1",
  acquisitionMode: "fixture",
  sourceListingId: "listing-a",
  acquiredAt: now,
  observedAt: now,
  postedAt: null,
  title: "Synthetic apartment",
  normalizedAddress: "12 n main st",
  normalizedUnit: "4b",
  normalizedCity: "boston",
  normalizedRegion: "MA",
  normalizedPostalCode: "02110",
  normalizedCountryCode: "US",
  addressMatchKey: "12 n main st|4b|boston|MA|02110|US",
  latitude: 42.36,
  longitude: -71.06,
  canonicalUrl: "https://example.invalid/listing-a",
  rentCents: 245_000,
  requiredRecurringFeeCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 680,
  availableOn: "2026-09-01",
  descriptionText: "Sanitized synthetic listing text.",
  photoHashes: [
    {
      listingPhotoId: "photo-a",
      hash: "0123456789abcdef",
      version: PHOTO_HASH_VERSION
    }
  ],
  contactFingerprints: [hashA],
  fieldCandidates: [
    {
      fieldPath: "monthlyRentCents",
      fieldProvenanceId: "provenance-a-rent",
      sourceRecordId: "source-a",
      extractionMethod: "fixture_structured",
      valueStatus: "known",
      value: 245_000,
      confidenceBasisPoints: 10_000,
      observedAt: now
    }
  ],
  normalizationReasonCodes: ["address_normalized"]
} as const;

const pairEvaluation = {
  id: "pair-source-a-source-b",
  leftSourceRecordId: "source-a",
  rightSourceRecordId: "source-b",
  algorithmVersion: DEDUPE_VERSION,
  inputHash: hashA,
  decision: "link",
  scoreBasisPoints: 8_200,
  automaticLinkThresholdBasisPoints: 7_500,
  reviewThresholdBasisPoints: 6_000,
  exactReasonCodes: ["exact_normalized_address_unit"],
  conflictReasonCodes: [],
  contactMatched: false,
  features: [],
  evaluatedAt: now
} as const;

const canonicalPlan = {
  canonicalListingId: "canonical-a",
  clusterId: "cluster-a",
  memberSourceRecordIds: ["source-a", "source-b"],
  primarySourceRecordId: "source-a",
  priorCanonicalListingIds: [],
  lifecycleState: "new",
  selectedFields: [
    {
      fieldPath: "monthlyRentCents",
      valueStatus: "known",
      value: 245_000,
      selectedFieldProvenanceId: "provenance-a-rent",
      selectedSourceRecordId: "source-a",
      reasonCodes: ["highest_ranked_provenance"]
    }
  ],
  completenessBasisPoints: 8_000,
  freshestObservedAt: now,
  stitchVersion: STITCH_VERSION,
  stitchInputHash: hashA
} as const;

const score = {
  id: "score-canonical-a-v2",
  schemaVersion: 2,
  canonicalListingId: "canonical-a",
  searchProfileId: "profile-primary",
  algorithmVersion: SCORE_VERSION,
  inputHash: hashA,
  eligible: true,
  hardConstraints: [],
  factors: [],
  baseScoreBasisPoints: 8_000,
  stalePenaltyBasisPoints: 250,
  lowConfidencePenaltyBasisPoints: 500,
  riskPenaltyBasisPoints: 750,
  finalScoreBasisPoints: 6_500,
  reasonCodes: ["stale_penalty_applied", "risk_penalty_applied"],
  explanation: "Good fit, with freshness and risk evidence that needs verification.",
  computedAt: now
} as const;

describe("production decision domain", () => {
  it("keeps algorithm versions closed and explicit", () => {
    expect([
      DECISION_NORMALIZATION_VERSION,
      PHOTO_HASH_VERSION,
      DEDUPE_VERSION,
      STITCH_VERSION,
      SCORE_VERSION,
      RISK_VERSION,
      DECISION_PLAN_VERSION
    ]).toEqual([
      "decision-normalization.v1",
      "listing-photo.dhash64.v1",
      "listing-dedupe.v1",
      "canonical-stitch.v1",
      "listing-score.v2",
      "listing-risk.v2",
      "decision-plan.v1"
    ]);
  });

  it("accepts only the closed decision-job states", () => {
    expect(DecisionJobStatusSchema.options).toEqual([
      "queued",
      "running",
      "succeeded",
      "retryable_failed",
      "permanently_failed",
      "cancelled"
    ]);
    expect(DecisionJobStatusSchema.safeParse("completed").success).toBe(false);
  });

  it("defaults unknown weighted preferences to neutral and rejects duplicate codes", () => {
    const profile = {
      id: "profile-primary",
      name: "Primary search",
      version: 1,
      locationText: "Boston, MA",
      centerLatitude: null,
      centerLongitude: null,
      radiusKilometers: null,
      minimumBedrooms: 1,
      minimumBathrooms: null,
      targetMonthlyTotalCents: 260_000,
      absoluteMonthlyMaximumCents: 300_000,
      moveInEarliest: null,
      moveInLatest: null,
      petRequirements: [],
      commuteAnchors: [],
      hardConstraints: [],
      weightedPreferences: [
        {
          code: "laundry",
          weightBasisPoints: 5_000,
          description: "Laundry access"
        }
      ],
      notificationRules: { enabled: false, minimumScoreBasisPoints: null },
      createdAt: now,
      updatedAt: now
    } as const;

    expect(SearchProfileSchema.parse(profile).weightedPreferences[0]?.unknownBehavior).toBe(
      "neutral"
    );
    expect(() =>
      SearchProfileSchema.parse({
        ...profile,
        weightedPreferences: [
          ...profile.weightedPreferences,
          { ...profile.weightedPreferences[0], description: "Duplicate preference" }
        ]
      })
    ).toThrow(/unique/iu);
  });

  it("validates normalized sources strictly and requires coordinate pairs", () => {
    expect(NormalizedDecisionSourceSchema.parse(normalizedSource).sourceRecordId).toBe("source-a");
    expect(() =>
      NormalizedDecisionSourceSchema.parse({ ...normalizedSource, unexpected: true })
    ).toThrow();
    expect(() =>
      NormalizedDecisionSourceSchema.parse({ ...normalizedSource, longitude: null })
    ).toThrow(/coordinates/iu);
    expect(() =>
      NormalizedDecisionSourceSchema.parse({
        ...normalizedSource,
        fieldCandidates: [
          {
            ...normalizedSource.fieldCandidates[0],
            sourceRecordId: "source-b"
          }
        ]
      })
    ).toThrow(/source record/iu);
  });

  it("requires ordered pairs and never accepts protected fingerprints in pair output", () => {
    expect(DuplicatePairEvaluationSchema.parse(pairEvaluation).decision).toBe("link");
    expect(() =>
      DuplicatePairEvaluationSchema.parse({
        ...pairEvaluation,
        leftSourceRecordId: "source-b",
        rightSourceRecordId: "source-a"
      })
    ).toThrow(/ordered/iu);
    expect(() =>
      DuplicatePairEvaluationSchema.parse({ ...pairEvaluation, contactFingerprint: hashA })
    ).toThrow();
  });

  it("requires sorted unique cluster members", () => {
    const plan = {
      clusterId: "cluster-a",
      memberSourceRecordIds: ["source-a", "source-b"],
      linkedPairEvaluationIds: [pairEvaluation.id],
      appliedOverrideIds: [],
      blockedEdges: [],
      priorCanonicalListingIds: [],
      primarySourceRecordId: "source-a",
      reasonCodes: ["automatic_connected_component"]
    } as const;

    expect(DuplicateClusterPlanSchema.parse(plan).memberSourceRecordIds).toHaveLength(2);
    expect(() =>
      DuplicateClusterPlanSchema.parse({
        ...plan,
        memberSourceRecordIds: ["source-b", "source-a"]
      })
    ).toThrow(/sorted/iu);
  });

  it("enforces force-merge and force-split override invariants", () => {
    const base = {
      id: "override-a-b",
      searchProfileId: "profile-primary",
      sourceRecordIds: ["source-a", "source-b"],
      reason: "Reviewed duplicate evidence.",
      createdBy: "user",
      createdAt: now
    } as const;

    expect(
      DuplicateOverrideSchema.parse({
        ...base,
        kind: "force_merge",
        survivorCanonicalId: "canonical-a"
      }).kind
    ).toBe("force_merge");
    expect(() =>
      DuplicateOverrideSchema.parse({
        ...base,
        kind: "force_merge",
        survivorCanonicalId: null
      })
    ).toThrow(/survivor/iu);
    expect(() =>
      DuplicateOverrideSchema.parse({
        ...base,
        kind: "force_split",
        survivorCanonicalId: "canonical-a"
      })
    ).toThrow(/survivor/iu);
  });

  it("validates canonical membership and score arithmetic", () => {
    expect(CanonicalListingPlanSchema.parse(canonicalPlan).primarySourceRecordId).toBe("source-a");
    expect(() =>
      CanonicalListingPlanSchema.parse({
        ...canonicalPlan,
        primarySourceRecordId: "source-c"
      })
    ).toThrow(/primary/iu);

    expect(ListingScoreV2Schema.parse(score).finalScoreBasisPoints).toBe(6_500);
    expect(() => ListingScoreV2Schema.parse({ ...score, finalScoreBasisPoints: 6_501 })).toThrow(
      /penalties/iu
    );
    expect(
      ListingScoreV2Schema.parse({
        ...score,
        baseScoreBasisPoints: 1_000,
        stalePenaltyBasisPoints: 2_000,
        lowConfidencePenaltyBasisPoints: 0,
        riskPenaltyBasisPoints: 0,
        finalScoreBasisPoints: 0
      }).finalScoreBasisPoints
    ).toBe(0);
  });

  it("requires bounded evidence for v2 risk indicators", () => {
    const risk = {
      id: "risk-canonical-a-payment",
      schemaVersion: 2,
      canonicalListingId: "canonical-a",
      algorithmVersion: RISK_VERSION,
      inputHash: hashA,
      idempotencyKey: hashB,
      code: "deposit_before_viewing",
      severity: "high",
      confidenceBasisPoints: 9_500,
      evidence: [
        {
          sourceRecordId: "source-a",
          fieldPath: "description",
          summary: "The text asks for a deposit before any viewing.",
          excerpt: "deposit before viewing"
        }
      ],
      needsVerification: true,
      verificationAction: "Do not pay before verifying the listing and viewing process.",
      status: "open",
      createdAt: now
    } as const;

    expect(RiskSignalV2Schema.parse(risk).code).toBe("deposit_before_viewing");
    expect(() =>
      RiskSignalV2Schema.parse({
        ...risk,
        evidence: [{ ...risk.evidence[0], excerpt: "x".repeat(241) }]
      })
    ).toThrow();
  });

  it("validates complete version-linked decision plans", () => {
    const clusterPlan = {
      clusterId: "cluster-a",
      memberSourceRecordIds: ["source-a", "source-b"],
      linkedPairEvaluationIds: [pairEvaluation.id],
      appliedOverrideIds: [],
      blockedEdges: [],
      priorCanonicalListingIds: [],
      primarySourceRecordId: "source-a",
      reasonCodes: ["automatic_connected_component"]
    } as const;

    const plan = {
      version: DECISION_PLAN_VERSION,
      normalizationVersion: DECISION_NORMALIZATION_VERSION,
      dedupeVersion: DEDUPE_VERSION,
      stitchVersion: STITCH_VERSION,
      scoreVersion: SCORE_VERSION,
      riskVersion: RISK_VERSION,
      corpusRevision: 4,
      inputHash: hashA,
      pairEvaluations: [pairEvaluation],
      clusterPlans: [clusterPlan],
      canonicalPlans: [canonicalPlan],
      supersessions: [],
      scoreSnapshots: [score],
      riskSignals: [],
      computedAt: now
    } as const;

    expect(DecisionPlanSchema.parse(plan).version).toBe(DECISION_PLAN_VERSION);
    expect(() => DecisionPlanSchema.parse({ ...plan, scoreVersion: "listing-score.v1" })).toThrow();
  });

  it("enforces state-specific decision-job completion metadata", () => {
    const queued = {
      id: "decision-job-a",
      searchProfileId: "profile-primary",
      targetCorpusRevision: 4,
      trigger: "normalization",
      status: "queued",
      inputHash: null,
      outputHash: null,
      attemptCount: 0,
      availableAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    } as const;

    expect(DecisionJobSchema.parse(queued).status).toBe("queued");
    expect(
      DecisionJobSchema.parse({
        ...queued,
        status: "succeeded",
        inputHash: hashA,
        outputHash: hashB,
        attemptCount: 1,
        updatedAt: later,
        completedAt: later
      }).status
    ).toBe("succeeded");
    expect(() => DecisionJobSchema.parse({ ...queued, status: "succeeded" })).toThrow(
      /successful/iu
    );
  });
});
