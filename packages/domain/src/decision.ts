import { z } from "zod";

import {
  FieldExtractionMethodSchema,
  ListingLifecycleStateSchema,
  ProvenanceValueStatusSchema
} from "./listing.ts";
import {
  ConfidenceBasisPointsSchema,
  EntityIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  ListingSourceLabelSchema,
  MoneyCentsSchema,
  PercentageBasisPointsSchema,
  Sha256Schema
} from "./primitives.ts";
import { SearchProfileSchema } from "./search-profile.ts";
import { AcquisitionModeSchema } from "./source-policy.ts";

export const DECISION_NORMALIZATION_VERSION = "decision-normalization.v1" as const;
export const PHOTO_HASH_VERSION = "listing-photo.dhash64.v1" as const;
export const DEDUPE_VERSION = "listing-dedupe.v1" as const;
export const STITCH_VERSION = "canonical-stitch.v1" as const;
export const SCORE_VERSION = "listing-score.v2" as const;
export const RISK_VERSION = "listing-risk.v2" as const;
export const DECISION_PLAN_VERSION = "decision-plan.v1" as const;

export const DecisionNormalizationVersionSchema = z.literal(DECISION_NORMALIZATION_VERSION);
export const PhotoHashVersionSchema = z.literal(PHOTO_HASH_VERSION);
export const DedupeVersionSchema = z.literal(DEDUPE_VERSION);
export const StitchVersionSchema = z.literal(STITCH_VERSION);
export const ScoreVersionSchema = z.literal(SCORE_VERSION);
export const RiskVersionSchema = z.literal(RISK_VERSION);
export const DecisionPlanVersionSchema = z.literal(DECISION_PLAN_VERSION);

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function sortedUniqueEntityIds(minimum: number, maximum = 10_000) {
  return z
    .array(EntityIdSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((values, context) => {
      if (!isSortedUnique(values)) {
        context.addIssue({
          code: "custom",
          message: "Entity IDs must be unique and sorted in ascending order."
        });
      }
    });
}

function uniqueStrings(maximum: number) {
  return z
    .array(z.string().trim().min(1).max(160))
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Values must be unique." });
      }
    });
}

export const DecisionJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "retryable_failed",
  "permanently_failed",
  "cancelled"
]);
export const DecisionJobTriggerSchema = z.enum(["normalization", "manual_recompute", "seed"]);
export const DecisionJobErrorCodeSchema = z.enum([
  "database_busy",
  "lease_lost",
  "stale_corpus_revision",
  "invalid_snapshot",
  "candidate_limit_exceeded",
  "invalid_decision_plan",
  "idempotency_conflict",
  "policy_cancelled",
  "internal_error"
]);

export const PhotoHashSchema = z
  .object({
    listingPhotoId: EntityIdSchema,
    byteHash: Sha256Schema.nullable().optional(),
    hash: z.string().regex(/^[a-f0-9]{16}$/u),
    version: PhotoHashVersionSchema
  })
  .strict();

export const NormalizationReasonCodeSchema = z.enum([
  "address_normalized",
  "unit_extracted",
  "phone_normalized",
  "url_canonicalized",
  "money_normalized",
  "date_normalized",
  "photo_hash_computed",
  "address_ambiguous",
  "url_rejected",
  "contact_normalized",
  "contact_rejected",
  "cost_partial",
  "value_preserved",
  "field_unknown"
]);

export const ProvenancedFieldCandidateSchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(200),
    fieldProvenanceId: EntityIdSchema,
    sourceRecordId: EntityIdSchema,
    extractionMethod: FieldExtractionMethodSchema,
    valueStatus: ProvenanceValueStatusSchema,
    value: JsonValueSchema.nullable(),
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    observedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.valueStatus === "known" && candidate.value === null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Known field candidates require a value."
      });
    }
    if (candidate.valueStatus === "unknown") {
      if (candidate.value !== null) {
        context.addIssue({
          code: "custom",
          path: ["value"],
          message: "Unknown field candidates cannot carry a value."
        });
      }
      if (candidate.confidenceBasisPoints !== 0) {
        context.addIssue({
          code: "custom",
          path: ["confidenceBasisPoints"],
          message: "Unknown field candidates must have zero confidence."
        });
      }
    }
  });

/**
 * Internal evaluator input. `contactFingerprints` are process-local protected data:
 * it must never appear in pair evaluations, plans, logs, metrics, or persistence.
 */
export const NormalizedDecisionSourceSchema = z
  .object({
    sourceRecordId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    connectorId: z.string().trim().min(1).max(120),
    acquisitionMode: AcquisitionModeSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    acquiredAt: IsoDateTimeSchema,
    observedAt: IsoDateTimeSchema,
    postedAt: IsoDateTimeSchema.nullable(),
    title: z.string().trim().min(1).max(300),
    normalizedAddress: z.string().trim().min(1).max(600).nullable(),
    normalizedUnit: z.string().trim().min(1).max(80).nullable(),
    normalizedCity: z.string().trim().min(1).max(120).nullable(),
    normalizedRegion: z.string().trim().min(1).max(80).nullable(),
    normalizedPostalCode: z.string().trim().min(1).max(24).nullable(),
    normalizedCountryCode: z.string().trim().length(2).nullable(),
    addressMatchKey: z.string().trim().min(1).max(1_000).nullable(),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable(),
    canonicalUrl: z.string().url().max(2_048).nullable(),
    rentCents: MoneyCentsSchema.nullable(),
    requiredRecurringFeeCents: MoneyCentsSchema.nullable(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    availableOn: IsoDateSchema.nullable(),
    descriptionText: z.string().max(20_000),
    photoHashes: z.array(PhotoHashSchema).max(50),
    contactFingerprints: z
      .array(Sha256Schema)
      .max(10)
      .superRefine((values, context) => {
        if (!isSortedUnique(values)) {
          context.addIssue({
            code: "custom",
            message: "Contact fingerprints must be unique and sorted."
          });
        }
      }),
    fieldCandidates: z.array(ProvenancedFieldCandidateSchema).max(500),
    normalizationReasonCodes: z.array(NormalizationReasonCodeSchema).max(50)
  })
  .strict()
  .superRefine((source, context) => {
    if ((source.latitude === null) !== (source.longitude === null)) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Decision coordinates must contain both latitude and longitude or neither."
      });
    }
    if (
      new Set(source.photoHashes.map((photo) => photo.listingPhotoId)).size !==
      source.photoHashes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["photoHashes"],
        message: "Photo hashes must reference unique listing photos."
      });
    }
    if (
      source.fieldCandidates.some((candidate) => candidate.sourceRecordId !== source.sourceRecordId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fieldCandidates"],
        message: "Every field candidate must reference its containing source record."
      });
    }
  });

export const DuplicateDecisionSchema = z.enum(["link", "review", "separate"]);
export const DuplicatePairFeatureCodeSchema = z.enum([
  "address",
  "geographic",
  "rent",
  "beds_baths",
  "square_feet",
  "text",
  "photo",
  "posting_time"
]);
export const DuplicateExactReasonCodeSchema = z.enum([
  "same_source_listing_id",
  "exact_canonical_url",
  "exact_normalized_address_unit",
  "exact_contact_match",
  "exact_photo_hash"
]);
export const DuplicateConflictReasonCodeSchema = z.enum([
  "different_source_listing_ids",
  "conflicting_units",
  "material_location_conflict"
]);

export const DuplicatePairFeatureSchema = z
  .object({
    code: DuplicatePairFeatureCodeSchema,
    scoreBasisPoints: PercentageBasisPointsSchema.nullable(),
    weightBasisPoints: PercentageBasisPointsSchema,
    contributionBasisPoints: PercentageBasisPointsSchema.nullable(),
    reasonCode: z.string().trim().min(1).max(160)
  })
  .strict()
  .superRefine((feature, context) => {
    if ((feature.scoreBasisPoints === null) !== (feature.contributionBasisPoints === null)) {
      context.addIssue({
        code: "custom",
        path: ["contributionBasisPoints"],
        message: "Unknown pair features cannot carry a contribution."
      });
    }
  });

export const DuplicatePairEvaluationSchema = z
  .object({
    id: EntityIdSchema,
    leftSourceRecordId: EntityIdSchema,
    rightSourceRecordId: EntityIdSchema,
    algorithmVersion: DedupeVersionSchema,
    inputHash: Sha256Schema,
    decision: DuplicateDecisionSchema,
    scoreBasisPoints: PercentageBasisPointsSchema.nullable(),
    automaticLinkThresholdBasisPoints: PercentageBasisPointsSchema,
    reviewThresholdBasisPoints: PercentageBasisPointsSchema,
    exactReasonCodes: z.array(DuplicateExactReasonCodeSchema).max(5),
    conflictReasonCodes: z.array(DuplicateConflictReasonCodeSchema).max(3),
    contactMatched: z.boolean(),
    features: z.array(DuplicatePairFeatureSchema).max(8),
    evaluatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((pair, context) => {
    if (pair.leftSourceRecordId >= pair.rightSourceRecordId) {
      context.addIssue({
        code: "custom",
        path: ["leftSourceRecordId"],
        message: "Pair source IDs must be distinct and ordered ascending."
      });
    }
    if (pair.reviewThresholdBasisPoints > pair.automaticLinkThresholdBasisPoints) {
      context.addIssue({
        code: "custom",
        path: ["reviewThresholdBasisPoints"],
        message: "Review threshold cannot exceed the automatic-link threshold."
      });
    }
    if (new Set(pair.features.map((feature) => feature.code)).size !== pair.features.length) {
      context.addIssue({
        code: "custom",
        path: ["features"],
        message: "Pair feature codes must be unique."
      });
    }
    if (new Set(pair.exactReasonCodes).size !== pair.exactReasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["exactReasonCodes"],
        message: "Exact reasons must be unique."
      });
    }
    if (new Set(pair.conflictReasonCodes).size !== pair.conflictReasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["conflictReasonCodes"],
        message: "Conflict reasons must be unique."
      });
    }
  });

export const DuplicateOverrideKindSchema = z.enum(["force_merge", "force_split"]);
export const DuplicateOverrideSchema = z
  .object({
    id: EntityIdSchema,
    searchProfileId: EntityIdSchema,
    kind: DuplicateOverrideKindSchema,
    sourceRecordIds: sortedUniqueEntityIds(2, 500),
    survivorCanonicalId: EntityIdSchema.nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    createdBy: z.enum(["user", "system"]),
    createdAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((override, context) => {
    if (override.kind === "force_merge" && override.survivorCanonicalId === null) {
      context.addIssue({
        code: "custom",
        path: ["survivorCanonicalId"],
        message: "Force-merge overrides require a survivor canonical ID."
      });
    }
    if (override.kind === "force_split" && override.survivorCanonicalId !== null) {
      context.addIssue({
        code: "custom",
        path: ["survivorCanonicalId"],
        message: "Force-split overrides cannot select a survivor canonical ID."
      });
    }
  });

export const DuplicateOverrideRevocationSchema = z
  .object({
    id: EntityIdSchema,
    overrideId: EntityIdSchema,
    reason: z.string().trim().min(1).max(500).nullable(),
    createdBy: z.enum(["user", "system"]),
    createdAt: IsoDateTimeSchema
  })
  .strict();

export const BlockedDuplicateEdgeSchema = z
  .object({
    leftSourceRecordId: EntityIdSchema,
    rightSourceRecordId: EntityIdSchema,
    reasonCode: z.literal("blocked_by_force_split"),
    overrideId: EntityIdSchema
  })
  .strict()
  .refine((edge) => edge.leftSourceRecordId < edge.rightSourceRecordId, {
    message: "Blocked-edge source IDs must be ordered.",
    path: ["leftSourceRecordId"]
  });

export const DuplicateClusterPlanSchema = z
  .object({
    clusterId: EntityIdSchema,
    memberSourceRecordIds: sortedUniqueEntityIds(1, 10_000),
    linkedPairEvaluationIds: sortedUniqueEntityIds(0, 10_000),
    appliedOverrideIds: sortedUniqueEntityIds(0, 1_000),
    blockedEdges: z.array(BlockedDuplicateEdgeSchema).max(10_000),
    priorCanonicalListingIds: sortedUniqueEntityIds(0, 1_000),
    primarySourceRecordId: EntityIdSchema,
    reasonCodes: uniqueStrings(100)
  })
  .strict()
  .superRefine((cluster, context) => {
    if (!cluster.memberSourceRecordIds.includes(cluster.primarySourceRecordId)) {
      context.addIssue({
        code: "custom",
        path: ["primarySourceRecordId"],
        message: "Cluster primary source must be a member of the cluster."
      });
    }
  });

export const CanonicalFieldSelectionPlanSchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(200),
    valueStatus: ProvenanceValueStatusSchema,
    value: JsonValueSchema.nullable(),
    selectedFieldProvenanceId: EntityIdSchema.nullable(),
    selectedSourceRecordId: EntityIdSchema.nullable(),
    reasonCodes: uniqueStrings(20)
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.valueStatus === "known") {
      if (
        selection.value === null ||
        selection.selectedFieldProvenanceId === null ||
        selection.selectedSourceRecordId === null
      ) {
        context.addIssue({
          code: "custom",
          message: "Known canonical fields require a value, provenance, and source record."
        });
      }
    } else if (
      selection.value !== null ||
      selection.selectedFieldProvenanceId !== null ||
      selection.selectedSourceRecordId !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unknown canonical fields cannot claim a value or selected provenance."
      });
    }
  });

export const CanonicalListingPlanSchema = z
  .object({
    canonicalListingId: EntityIdSchema,
    clusterId: EntityIdSchema.nullable(),
    memberSourceRecordIds: sortedUniqueEntityIds(1, 10_000),
    primarySourceRecordId: EntityIdSchema,
    priorCanonicalListingIds: sortedUniqueEntityIds(0, 1_000),
    lifecycleState: ListingLifecycleStateSchema,
    selectedFields: z.array(CanonicalFieldSelectionPlanSchema).max(500),
    completenessBasisPoints: PercentageBasisPointsSchema,
    freshestObservedAt: IsoDateTimeSchema,
    stitchVersion: StitchVersionSchema,
    stitchInputHash: Sha256Schema
  })
  .strict()
  .superRefine((plan, context) => {
    if (!plan.memberSourceRecordIds.includes(plan.primarySourceRecordId)) {
      context.addIssue({
        code: "custom",
        path: ["primarySourceRecordId"],
        message: "Canonical primary source must be a member source."
      });
    }
    if (
      new Set(plan.selectedFields.map((field) => field.fieldPath)).size !==
      plan.selectedFields.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedFields"],
        message: "Canonical field selections must have unique paths."
      });
    }
  });

export const CanonicalSupersessionPlanSchema = z
  .object({
    supersededCanonicalListingId: EntityIdSchema,
    survivorCanonicalListingId: EntityIdSchema,
    reasonCode: z.enum(["cluster_merge", "cluster_split", "identity_reconciliation"])
  })
  .strict()
  .refine((plan) => plan.supersededCanonicalListingId !== plan.survivorCanonicalListingId, {
    message: "A canonical listing cannot supersede itself."
  });

export const HardConstraintCodeSchema = z.enum([
  "budget_exceeded",
  "bedrooms_below_minimum",
  "bathrooms_below_minimum",
  "pets_explicitly_disallowed",
  "availability_after_latest_move_in",
  "availability_before_earliest_move_in",
  "required_feature_absent"
]);
export const HardConstraintEvaluationSchema = z
  .object({
    code: HardConstraintCodeSchema,
    passed: z.boolean(),
    observedValue: JsonValueSchema.nullable(),
    requiredValue: JsonValueSchema,
    provenanceIds: sortedUniqueEntityIds(0, 100),
    reasonCode: z.string().trim().min(1).max(160)
  })
  .strict();

export const ScoreFactorCodeSchema = z.enum([
  "monthly_housing_cost",
  "bedrooms",
  "bathrooms",
  "move_in_timing",
  "pet_policy",
  "commute",
  "must_haves",
  "nice_to_haves"
]);
export const ScoreFactorV2Schema = z
  .object({
    code: ScoreFactorCodeSchema,
    valueStatus: ProvenanceValueStatusSchema,
    inputValue: JsonValueSchema.nullable(),
    scoreBasisPoints: PercentageBasisPointsSchema.nullable(),
    configuredWeightBasisPoints: PercentageBasisPointsSchema,
    normalizedWeightBasisPoints: PercentageBasisPointsSchema,
    contributionBasisPoints: PercentageBasisPointsSchema,
    reasonCodes: uniqueStrings(20),
    provenanceIds: sortedUniqueEntityIds(0, 100)
  })
  .strict()
  .superRefine((factor, context) => {
    if (factor.valueStatus === "known" && factor.scoreBasisPoints === null) {
      context.addIssue({
        code: "custom",
        path: ["scoreBasisPoints"],
        message: "Known score factors require a score."
      });
    }
    if (factor.valueStatus === "unknown" && factor.inputValue !== null) {
      context.addIssue({
        code: "custom",
        path: ["inputValue"],
        message: "Unknown score factors cannot carry an input value."
      });
    }
  });

export const ScoreReasonCodeSchema = z.enum([
  "eligible",
  "hard_constraint_failed",
  "unknown_neutral",
  "unknown_penalized",
  "stale_penalty_applied",
  "low_confidence_penalty_applied",
  "risk_penalty_applied",
  "strongest_positive_factor",
  "needs_verification"
]);

export const ListingScoreV2Schema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(2),
    canonicalListingId: EntityIdSchema,
    searchProfileId: EntityIdSchema,
    algorithmVersion: ScoreVersionSchema,
    inputHash: Sha256Schema,
    eligible: z.boolean(),
    hardConstraints: z.array(HardConstraintEvaluationSchema).max(100),
    factors: z.array(ScoreFactorV2Schema).max(20),
    baseScoreBasisPoints: PercentageBasisPointsSchema,
    stalePenaltyBasisPoints: PercentageBasisPointsSchema,
    lowConfidencePenaltyBasisPoints: PercentageBasisPointsSchema,
    riskPenaltyBasisPoints: PercentageBasisPointsSchema,
    finalScoreBasisPoints: PercentageBasisPointsSchema,
    reasonCodes: z.array(ScoreReasonCodeSchema).max(100),
    explanation: z.string().trim().min(1).max(2_000),
    computedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((score, context) => {
    const expected = Math.max(
      0,
      score.baseScoreBasisPoints -
        score.stalePenaltyBasisPoints -
        score.lowConfidencePenaltyBasisPoints -
        score.riskPenaltyBasisPoints
    );
    if (score.finalScoreBasisPoints !== expected) {
      context.addIssue({
        code: "custom",
        path: ["finalScoreBasisPoints"],
        message: "Final score must equal the clamped base score after all separate penalties."
      });
    }
    if (new Set(score.factors.map((factor) => factor.code)).size !== score.factors.length) {
      context.addIssue({
        code: "custom",
        path: ["factors"],
        message: "Score factor codes must be unique."
      });
    }
    if (new Set(score.reasonCodes).size !== score.reasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Score reason codes must be unique."
      });
    }
  });

export const RiskIndicatorCodeSchema = z.enum([
  "suspicious_payment_method",
  "deposit_before_viewing",
  "out_of_country_courier_keys",
  "pressure_or_refusal_to_show",
  "suspicious_off_platform_contact",
  "reused_photos_different_addresses",
  "material_duplicate_inconsistency",
  "unusual_external_link",
  "missing_address_extreme_low_price"
]);
export const RiskSeverityV2Schema = z.enum(["informational", "low", "medium", "high"]);
export const RiskEvidenceV2Schema = z
  .object({
    sourceRecordId: EntityIdSchema,
    fieldPath: z.string().trim().min(1).max(200).nullable(),
    summary: z.string().trim().min(1).max(1_000),
    excerpt: z.string().trim().min(1).max(240)
  })
  .strict();

export const RiskSignalV2Schema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(2),
    canonicalListingId: EntityIdSchema,
    algorithmVersion: RiskVersionSchema,
    inputHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    code: RiskIndicatorCodeSchema,
    severity: RiskSeverityV2Schema,
    confidenceBasisPoints: ConfidenceBasisPointsSchema,
    evidence: z.array(RiskEvidenceV2Schema).min(1).max(100),
    needsVerification: z.literal(true),
    verificationAction: z.string().trim().min(1).max(1_000),
    status: z.enum(["open", "verified", "dismissed"]),
    createdAt: IsoDateTimeSchema
  })
  .strict();

export const PriorCanonicalIdentitySchema = z
  .object({
    canonicalListingId: EntityIdSchema,
    memberSourceRecordIds: sortedUniqueEntityIds(1, 10_000),
    primarySourceRecordId: EntityIdSchema,
    lifecycleState: ListingLifecycleStateSchema,
    createdAt: IsoDateTimeSchema
  })
  .strict()
  .refine((identity) => identity.memberSourceRecordIds.includes(identity.primarySourceRecordId), {
    message: "Prior canonical primary source must be a member source.",
    path: ["primarySourceRecordId"]
  });

export const DecisionCorpusSnapshotSchema = z
  .object({
    searchProfile: SearchProfileSchema,
    corpusRevision: z.number().int().nonnegative(),
    sourceRecords: z.array(NormalizedDecisionSourceSchema).max(50_000),
    activeOverrides: z.array(DuplicateOverrideSchema).max(10_000),
    priorCanonicals: z.array(PriorCanonicalIdentitySchema).max(50_000)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const sourceIds = snapshot.sourceRecords.map((source) => source.sourceRecordId);
    if (!isSortedUnique(sourceIds)) {
      context.addIssue({
        code: "custom",
        path: ["sourceRecords"],
        message: "Snapshot sources must be unique and sorted."
      });
    }
    const canonicalIds = snapshot.priorCanonicals.map((canonical) => canonical.canonicalListingId);
    if (!isSortedUnique(canonicalIds)) {
      context.addIssue({
        code: "custom",
        path: ["priorCanonicals"],
        message: "Prior canonicals must be unique and sorted."
      });
    }
  });

export const DecisionPlanSchema = z
  .object({
    version: DecisionPlanVersionSchema,
    normalizationVersion: DecisionNormalizationVersionSchema,
    dedupeVersion: DedupeVersionSchema,
    stitchVersion: StitchVersionSchema,
    scoreVersion: ScoreVersionSchema,
    riskVersion: RiskVersionSchema,
    corpusRevision: z.number().int().nonnegative(),
    inputHash: Sha256Schema,
    pairEvaluations: z.array(DuplicatePairEvaluationSchema).max(2_000_000),
    clusterPlans: z.array(DuplicateClusterPlanSchema).max(50_000),
    canonicalPlans: z.array(CanonicalListingPlanSchema).max(50_000),
    supersessions: z.array(CanonicalSupersessionPlanSchema).max(50_000),
    scoreSnapshots: z.array(ListingScoreV2Schema).max(50_000),
    riskSignals: z.array(RiskSignalV2Schema).max(500_000),
    computedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((plan, context) => {
    const uniqueCollections: ReadonlyArray<readonly string[]> = [
      plan.pairEvaluations.map((pair) => pair.id),
      plan.clusterPlans.map((cluster) => cluster.clusterId),
      plan.canonicalPlans.map((canonical) => canonical.canonicalListingId),
      plan.scoreSnapshots.map((score) => score.canonicalListingId),
      plan.riskSignals.map((risk) => risk.idempotencyKey)
    ];
    if (uniqueCollections.some((values) => new Set(values).size !== values.length)) {
      context.addIssue({
        code: "custom",
        message: "Decision-plan result identities must be unique."
      });
    }
    const canonicalIds = new Set(
      plan.canonicalPlans.map((canonical) => canonical.canonicalListingId)
    );
    if (plan.scoreSnapshots.some((score) => !canonicalIds.has(score.canonicalListingId))) {
      context.addIssue({
        code: "custom",
        path: ["scoreSnapshots"],
        message: "Every score must reference a planned canonical listing."
      });
    }
    if (plan.riskSignals.some((risk) => !canonicalIds.has(risk.canonicalListingId))) {
      context.addIssue({
        code: "custom",
        path: ["riskSignals"],
        message: "Every risk signal must reference a planned canonical listing."
      });
    }
  });

export const DecisionJobSchema = z
  .object({
    id: EntityIdSchema,
    searchProfileId: EntityIdSchema,
    targetCorpusRevision: z.number().int().nonnegative(),
    trigger: DecisionJobTriggerSchema,
    status: DecisionJobStatusSchema,
    inputHash: Sha256Schema.nullable(),
    outputHash: Sha256Schema.nullable(),
    attemptCount: z.number().int().nonnegative().max(100),
    availableAt: IsoDateTimeSchema,
    leaseOwner: z.string().trim().min(1).max(160).nullable(),
    leaseExpiresAt: IsoDateTimeSchema.nullable(),
    errorCode: DecisionJobErrorCodeSchema.nullable(),
    errorMessage: z.string().trim().min(1).max(500).nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((job, context) => {
    if (job.updatedAt < job.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Job update time cannot precede creation."
      });
    }
    if ((job.leaseOwner === null) !== (job.leaseExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["leaseOwner"],
        message: "Lease owner and expiry must be set together."
      });
    }
    if (job.status === "running" && job.leaseOwner === null) {
      context.addIssue({
        code: "custom",
        path: ["leaseOwner"],
        message: "Running jobs require a lease."
      });
    }
    if (
      job.status === "succeeded" &&
      (job.inputHash === null || job.outputHash === null || job.completedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Successful jobs require input/output hashes and completion time."
      });
    }
    if (job.status === "succeeded" && (job.errorCode !== null || job.errorMessage !== null)) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Successful jobs cannot carry an error."
      });
    }
    if (
      (job.status === "retryable_failed" || job.status === "permanently_failed") &&
      (job.errorCode === null || job.errorMessage === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Failed jobs require a typed error."
      });
    }
    if (
      (job.status === "permanently_failed" || job.status === "cancelled") &&
      job.completedAt === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Terminal jobs require completion time."
      });
    }
  });

export const DecisionJobAttemptOutcomeSchema = z.enum([
  "succeeded",
  "retryable_failed",
  "permanently_failed",
  "cancelled",
  "lease_lost"
]);
export const DecisionJobAttemptSchema = z
  .object({
    id: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptNumber: z.number().int().positive().max(100),
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.nullable(),
    outcome: DecisionJobAttemptOutcomeSchema.nullable(),
    errorCode: DecisionJobErrorCodeSchema.nullable(),
    durationMilliseconds: z.number().int().nonnegative().safe().nullable()
  })
  .strict()
  .superRefine((attempt, context) => {
    const completedValues = [attempt.finishedAt, attempt.outcome, attempt.durationMilliseconds];
    const populated = completedValues.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== completedValues.length) {
      context.addIssue({
        code: "custom",
        message: "Attempt completion metadata must be written together."
      });
    }
  });

export const DecisionJobSummarySchema = z
  .object({
    id: EntityIdSchema,
    searchProfileId: EntityIdSchema,
    targetCorpusRevision: z.number().int().nonnegative(),
    status: DecisionJobStatusSchema,
    attemptCount: z.number().int().nonnegative().max(100),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    errorCode: DecisionJobErrorCodeSchema.nullable()
  })
  .strict();

export const CreateDuplicateOverrideRequestSchema = z
  .object({
    kind: DuplicateOverrideKindSchema,
    sourceRecordIds: sortedUniqueEntityIds(2, 500),
    survivorCanonicalId: EntityIdSchema.nullable(),
    reason: z.string().trim().min(1).max(500).nullable()
  })
  .strict()
  .superRefine((request, context) => {
    if (request.kind === "force_merge" && request.survivorCanonicalId === null) {
      context.addIssue({
        code: "custom",
        path: ["survivorCanonicalId"],
        message: "Force merge requires a survivor."
      });
    }
    if (request.kind === "force_split" && request.survivorCanonicalId !== null) {
      context.addIssue({
        code: "custom",
        path: ["survivorCanonicalId"],
        message: "Force split cannot select a survivor."
      });
    }
  });

export const CreateDuplicateOverrideResponseSchema = z
  .object({
    override: DuplicateOverrideSchema,
    decisionJob: DecisionJobSummarySchema
  })
  .strict();

export type DecisionJobStatus = z.infer<typeof DecisionJobStatusSchema>;
export type DecisionJobTrigger = z.infer<typeof DecisionJobTriggerSchema>;
export type DecisionJobErrorCode = z.infer<typeof DecisionJobErrorCodeSchema>;
export type PhotoHash = z.infer<typeof PhotoHashSchema>;
export type NormalizationReasonCode = z.infer<typeof NormalizationReasonCodeSchema>;
export type ProvenancedFieldCandidate = z.infer<typeof ProvenancedFieldCandidateSchema>;
export type NormalizedDecisionSource = z.infer<typeof NormalizedDecisionSourceSchema>;
export type DuplicateDecision = z.infer<typeof DuplicateDecisionSchema>;
export type DuplicateExactReasonCode = z.infer<typeof DuplicateExactReasonCodeSchema>;
export type DuplicateConflictReasonCode = z.infer<typeof DuplicateConflictReasonCodeSchema>;
export type DuplicatePairFeatureCode = z.infer<typeof DuplicatePairFeatureCodeSchema>;
export type DuplicatePairFeature = z.infer<typeof DuplicatePairFeatureSchema>;
export type DuplicatePairEvaluation = z.infer<typeof DuplicatePairEvaluationSchema>;
export type DuplicateOverrideKind = z.infer<typeof DuplicateOverrideKindSchema>;
export type DuplicateOverride = z.infer<typeof DuplicateOverrideSchema>;
export type DuplicateOverrideRevocation = z.infer<typeof DuplicateOverrideRevocationSchema>;
export type DuplicateClusterPlan = z.infer<typeof DuplicateClusterPlanSchema>;
export type CanonicalFieldSelectionPlan = z.infer<typeof CanonicalFieldSelectionPlanSchema>;
export type CanonicalListingPlan = z.infer<typeof CanonicalListingPlanSchema>;
export type CanonicalSupersessionPlan = z.infer<typeof CanonicalSupersessionPlanSchema>;
export type HardConstraintCode = z.infer<typeof HardConstraintCodeSchema>;
export type HardConstraintEvaluation = z.infer<typeof HardConstraintEvaluationSchema>;
export type ScoreFactorCode = z.infer<typeof ScoreFactorCodeSchema>;
export type ScoreFactorV2 = z.infer<typeof ScoreFactorV2Schema>;
export type ScoreReasonCode = z.infer<typeof ScoreReasonCodeSchema>;
export type ListingScoreV2 = z.infer<typeof ListingScoreV2Schema>;
export type RiskIndicatorCode = z.infer<typeof RiskIndicatorCodeSchema>;
export type RiskSeverityV2 = z.infer<typeof RiskSeverityV2Schema>;
export type RiskEvidenceV2 = z.infer<typeof RiskEvidenceV2Schema>;
export type RiskSignalV2 = z.infer<typeof RiskSignalV2Schema>;
export type PriorCanonicalIdentity = z.infer<typeof PriorCanonicalIdentitySchema>;
export type DecisionCorpusSnapshot = z.infer<typeof DecisionCorpusSnapshotSchema>;
export type DecisionPlan = z.infer<typeof DecisionPlanSchema>;
export type DecisionJob = z.infer<typeof DecisionJobSchema>;
export type DecisionJobAttempt = z.infer<typeof DecisionJobAttemptSchema>;
export type DecisionJobSummary = z.infer<typeof DecisionJobSummarySchema>;
export type CreateDuplicateOverrideRequest = z.infer<typeof CreateDuplicateOverrideRequestSchema>;
export type CreateDuplicateOverrideResponse = z.infer<typeof CreateDuplicateOverrideResponseSchema>;
