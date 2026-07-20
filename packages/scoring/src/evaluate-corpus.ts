import {
  DECISION_NORMALIZATION_VERSION,
  DECISION_PLAN_VERSION,
  DEDUPE_VERSION,
  DecisionCorpusSnapshotSchema,
  DecisionPlanSchema,
  RISK_VERSION,
  SCORE_VERSION,
  STITCH_VERSION,
  PetPolicySchema,
  type CanonicalListingPlan,
  type DecisionCorpusSnapshot,
  type DecisionPlan,
  type JsonValue,
  type NormalizedDecisionSource
} from "@vera/domain";

import { planCanonicalReconciliation } from "./canonical/plan.ts";
import { DEFAULT_STITCH_CONFIG, type StitchConfig } from "./canonical/stitch.ts";
import { generateCandidatePairs } from "./dedupe/candidates.ts";
import { DEFAULT_DEDUPE_CONFIG, type DedupeConfig } from "./dedupe/config.ts";
import { resolveActiveOverrides } from "./dedupe/overrides.ts";
import { evaluateDuplicatePair } from "./dedupe/pair.ts";
import { sha256Canonical } from "./determinism.ts";
import { DEFAULT_RANKING_CONFIG, type RankingConfig } from "./ranking/config.ts";
import { rankListing } from "./ranking/score.ts";
import type { CanonicalScoreInput } from "./ranking/types.ts";
import { DEFAULT_RISK_CONFIG, type RiskConfig } from "./risk/config.ts";
import { evaluateRiskIndicators } from "./risk/evaluate.ts";
import type { RiskListingInput } from "./risk/types.ts";

export type DecisionEvaluationErrorCode =
  "candidate_limit_exceeded" | "invalid_canonical_field" | "invalid_snapshot";

export class DecisionEvaluationError extends Error {
  readonly code: DecisionEvaluationErrorCode;
  readonly retryable: boolean;

  constructor(code: DecisionEvaluationErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "DecisionEvaluationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface EvaluateCorpusDependencies {
  readonly now: string;
  readonly dedupeConfig?: DedupeConfig;
  readonly stitchConfig?: StitchConfig;
  readonly rankingConfig?: RankingConfig;
  readonly riskConfig?: RiskConfig;
}

function sortSource(source: NormalizedDecisionSource): NormalizedDecisionSource {
  return {
    ...source,
    photoHashes: [...source.photoHashes].sort((left, right) =>
      left.listingPhotoId.localeCompare(right.listingPhotoId, "en")
    ),
    contactFingerprints: [...source.contactFingerprints].sort(),
    fieldCandidates: [...source.fieldCandidates].sort((left, right) =>
      left.fieldPath === right.fieldPath
        ? left.fieldProvenanceId.localeCompare(right.fieldProvenanceId, "en")
        : left.fieldPath.localeCompare(right.fieldPath, "en")
    )
  };
}

function canonicalSnapshot(snapshot: DecisionCorpusSnapshot): DecisionCorpusSnapshot {
  try {
    return DecisionCorpusSnapshotSchema.parse({
      ...snapshot,
      sourceRecords: [...snapshot.sourceRecords]
        .map(sortSource)
        .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId, "en")),
      activeOverrides: [...snapshot.activeOverrides].sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id, "en")
          : left.createdAt.localeCompare(right.createdAt, "en")
      ),
      priorCanonicals: [...snapshot.priorCanonicals].sort((left, right) =>
        left.canonicalListingId.localeCompare(right.canonicalListingId, "en")
      )
    });
  } catch {
    throw new DecisionEvaluationError(
      "invalid_snapshot",
      "Decision corpus snapshot failed strict validation.",
      false
    );
  }
}

function safeSource(source: NormalizedDecisionSource) {
  const { contactFingerprints: _protected, ...safe } = source;
  return safe;
}

function selectedValue(canonical: CanonicalListingPlan, fieldPath: string): JsonValue | null {
  const selection = canonical.selectedFields.find((field) => field.fieldPath === fieldPath);
  return selection?.valueStatus === "known" ? selection.value : null;
}

function nullableNumber(value: JsonValue | null, fieldPath: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DecisionEvaluationError(
      "invalid_canonical_field",
      `Canonical ${fieldPath} is not a finite number.`,
      false
    );
  }
  return value;
}

function nullableString(value: JsonValue | null, fieldPath: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new DecisionEvaluationError(
      "invalid_canonical_field",
      `Canonical ${fieldPath} is not a string.`,
      false
    );
  }
  return value;
}

function stringArray(value: JsonValue | null, fieldPath: string): string[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new DecisionEvaluationError(
      "invalid_canonical_field",
      `Canonical ${fieldPath} is not a string array.`,
      false
    );
  }
  return value.filter((entry): entry is string => typeof entry === "string").sort();
}

function canonicalScoreInput(
  canonical: CanonicalListingPlan,
  sourcesById: ReadonlyMap<string, NormalizedDecisionSource>
): CanonicalScoreInput {
  const confidences = canonical.selectedFields.flatMap((selection) => {
    if (selection.selectedFieldProvenanceId === null || selection.selectedSourceRecordId === null) {
      return [];
    }
    const source = sourcesById.get(selection.selectedSourceRecordId);
    const candidate = source?.fieldCandidates.find(
      (field) => field.fieldProvenanceId === selection.selectedFieldProvenanceId
    );
    if (candidate === undefined) {
      throw new DecisionEvaluationError(
        "invalid_canonical_field",
        "Selected canonical provenance is missing from its source input.",
        false
      );
    }
    return [
      {
        fieldPath: selection.fieldPath,
        confidenceBasisPoints: candidate.confidenceBasisPoints,
        provenanceId: candidate.fieldProvenanceId
      }
    ];
  });
  const petValue = selectedValue(canonical, "petPolicy");
  const parsedPet = petValue === null ? null : PetPolicySchema.safeParse(petValue);
  if (parsedPet !== null && !parsedPet.success) {
    throw new DecisionEvaluationError(
      "invalid_canonical_field",
      "Canonical pet policy is invalid.",
      false
    );
  }
  return {
    canonicalListingId: canonical.canonicalListingId,
    monthlyRentCents: nullableNumber(
      selectedValue(canonical, "monthlyRentCents"),
      "monthlyRentCents"
    ),
    recurringFeesCents: nullableNumber(
      selectedValue(canonical, "recurringFeesCents"),
      "recurringFeesCents"
    ),
    bedrooms: nullableNumber(selectedValue(canonical, "bedrooms"), "bedrooms"),
    bathrooms: nullableNumber(selectedValue(canonical, "bathrooms"), "bathrooms"),
    availableOn: nullableString(selectedValue(canonical, "availableOn"), "availableOn"),
    petPolicy: parsedPet?.success === true ? parsedPet.data : null,
    amenities: stringArray(selectedValue(canonical, "amenities"), "amenities"),
    explicitlyAbsentFeatures: [],
    freshestObservedAt: canonical.freshestObservedAt,
    selectedFieldConfidences: confidences,
    commuteMinutesByAnchor: {}
  };
}

export function evaluateCorpus(
  inputSnapshot: DecisionCorpusSnapshot,
  dependencies: EvaluateCorpusDependencies
): DecisionPlan {
  const snapshot = canonicalSnapshot(inputSnapshot);
  const dedupeConfig = dependencies.dedupeConfig ?? DEFAULT_DEDUPE_CONFIG;
  const stitchConfig = dependencies.stitchConfig ?? DEFAULT_STITCH_CONFIG;
  const rankingConfig = dependencies.rankingConfig ?? DEFAULT_RANKING_CONFIG;
  const riskConfig = dependencies.riskConfig ?? DEFAULT_RISK_CONFIG;
  const activeOverrides = resolveActiveOverrides(snapshot.activeOverrides);
  const candidates = generateCandidatePairs(snapshot.sourceRecords, dedupeConfig);
  if (candidates.wasTruncated) {
    throw new DecisionEvaluationError(
      "candidate_limit_exceeded",
      `Duplicate candidate generation exceeded the ${String(candidates.limit)} pair safety limit.`,
      true
    );
  }
  const sourceById = new Map(
    snapshot.sourceRecords.map((source) => [source.sourceRecordId, source])
  );
  const pairEvaluations = candidates.pairs.map((pair) => {
    const left = sourceById.get(pair.leftSourceRecordId);
    const right = sourceById.get(pair.rightSourceRecordId);
    if (left === undefined || right === undefined) {
      throw new DecisionEvaluationError(
        "invalid_snapshot",
        "Candidate pair references a missing source.",
        false
      );
    }
    return evaluateDuplicatePair({
      left,
      right,
      config: dedupeConfig,
      evaluatedAt: dependencies.now
    });
  });
  const canonical = planCanonicalReconciliation({
    sources: snapshot.sourceRecords,
    pairEvaluations,
    activeOverrides,
    priorCanonicals: snapshot.priorCanonicals,
    createdAt: dependencies.now,
    stitchConfig
  });
  const riskListings: RiskListingInput[] = canonical.canonicalPlans.map((plan) => ({
    canonicalListingId: plan.canonicalListingId,
    sources: plan.memberSourceRecordIds.map((id) => sourceById.get(id)!)
  }));
  const riskSignals = riskListings
    .flatMap((listing) =>
      evaluateRiskIndicators(listing, riskListings, dependencies.now, riskConfig)
    )
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const risksByCanonical = new Map<string, typeof riskSignals>();
  for (const risk of riskSignals) {
    risksByCanonical.set(risk.canonicalListingId, [
      ...(risksByCanonical.get(risk.canonicalListingId) ?? []),
      risk
    ]);
  }
  const scoreSnapshots = canonical.canonicalPlans
    .map((plan) =>
      rankListing(
        {
          profile: snapshot.searchProfile,
          listing: canonicalScoreInput(plan, sourceById),
          risks: risksByCanonical.get(plan.canonicalListingId) ?? [],
          evaluatedAt: dependencies.now
        },
        rankingConfig
      )
    )
    .sort((left, right) => left.canonicalListingId.localeCompare(right.canonicalListingId, "en"));
  const inputHash = sha256Canonical({
    versions: {
      plan: DECISION_PLAN_VERSION,
      normalization: DECISION_NORMALIZATION_VERSION,
      dedupe: DEDUPE_VERSION,
      stitch: STITCH_VERSION,
      score: SCORE_VERSION,
      risk: RISK_VERSION
    },
    corpusRevision: snapshot.corpusRevision,
    profile: snapshot.searchProfile,
    sources: snapshot.sourceRecords.map(safeSource),
    activeOverrides,
    priorCanonicals: snapshot.priorCanonicals,
    configs: { dedupeConfig, stitchConfig, rankingConfig, riskConfig },
    evaluatedAt: dependencies.now
  });

  return DecisionPlanSchema.parse({
    version: DECISION_PLAN_VERSION,
    normalizationVersion: DECISION_NORMALIZATION_VERSION,
    dedupeVersion: DEDUPE_VERSION,
    stitchVersion: STITCH_VERSION,
    scoreVersion: SCORE_VERSION,
    riskVersion: RISK_VERSION,
    corpusRevision: snapshot.corpusRevision,
    inputHash,
    pairEvaluations,
    clusterPlans: canonical.clusterPlans,
    canonicalPlans: canonical.canonicalPlans,
    supersessions: canonical.supersessions,
    scoreSnapshots,
    riskSignals,
    computedAt: dependencies.now
  });
}
