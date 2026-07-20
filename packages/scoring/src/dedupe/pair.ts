import {
  DuplicatePairEvaluationSchema,
  type DuplicateConflictReasonCode,
  type DuplicateExactReasonCode,
  type DuplicatePairEvaluation,
  type DuplicatePairFeature,
  type NormalizedDecisionSource
} from "@vera/domain";

import { sha256Canonical, stableEntityId } from "../determinism.ts";
import { type DedupeConfig, validateDedupeConfig } from "./config.ts";
import { evaluatePairFeatures, type PairFeatureScore } from "./features.ts";

function intersect(left: readonly string[], right: readonly string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function hasExactPhotoMatch(
  left: NormalizedDecisionSource,
  right: NormalizedDecisionSource
): boolean {
  const leftByteHashes = left.photoHashes.flatMap((photo) =>
    photo.byteHash === null || photo.byteHash === undefined ? [] : [photo.byteHash]
  );
  const rightByteHashes = right.photoHashes.flatMap((photo) =>
    photo.byteHash === null || photo.byteHash === undefined ? [] : [photo.byteHash]
  );
  return (
    intersect(leftByteHashes, rightByteHashes) ||
    intersect(
      left.photoHashes.map((photo) => photo.hash),
      right.photoHashes.map((photo) => photo.hash)
    )
  );
}

function featureByCode(
  features: readonly PairFeatureScore[],
  code: PairFeatureScore["code"]
): PairFeatureScore {
  const feature = features.find((candidate) => candidate.code === code);
  if (feature === undefined) throw new Error(`Missing dedupe feature ${code}.`);
  return feature;
}

function knownAtLeast(feature: PairFeatureScore, threshold: number): boolean {
  return feature.status === "known" && feature.scoreBasisPoints >= threshold;
}

function persistedFeatures(
  features: readonly PairFeatureScore[],
  config: DedupeConfig
): { readonly features: DuplicatePairFeature[]; readonly scoreBasisPoints: number | null } {
  const knownWeight = features.reduce(
    (sum, feature) => (feature.status === "known" ? sum + config.weights[feature.code] : sum),
    0
  );
  if (knownWeight === 0) {
    return {
      scoreBasisPoints: null,
      features: features.map((feature) => ({
        code: feature.code,
        scoreBasisPoints: null,
        weightBasisPoints: 0,
        contributionBasisPoints: null,
        reasonCode: feature.reasonCode
      }))
    };
  }
  const numerator = features.reduce(
    (sum, feature) =>
      feature.status === "known"
        ? sum + feature.scoreBasisPoints * config.weights[feature.code]
        : sum,
    0
  );
  return {
    scoreBasisPoints: Math.round(numerator / knownWeight),
    features: features.map((feature) => {
      if (feature.status === "unknown") {
        return {
          code: feature.code,
          scoreBasisPoints: null,
          weightBasisPoints: 0,
          contributionBasisPoints: null,
          reasonCode: feature.reasonCode
        };
      }
      return {
        code: feature.code,
        scoreBasisPoints: feature.scoreBasisPoints,
        weightBasisPoints: Math.round((config.weights[feature.code] * 10_000) / knownWeight),
        contributionBasisPoints: Math.round(
          (feature.scoreBasisPoints * config.weights[feature.code]) / knownWeight
        ),
        reasonCode: feature.reasonCode
      };
    })
  };
}

function safeHashSource(
  source: NormalizedDecisionSource
): Omit<NormalizedDecisionSource, "contactFingerprints"> {
  const { contactFingerprints: _protected, ...safe } = source;
  return safe;
}

export interface EvaluateDuplicatePairInput {
  readonly left: NormalizedDecisionSource;
  readonly right: NormalizedDecisionSource;
  readonly config: DedupeConfig;
  readonly evaluatedAt: string;
}

export function evaluateDuplicatePair(input: EvaluateDuplicatePairInput): DuplicatePairEvaluation {
  const config = validateDedupeConfig(input.config);
  const [left, right] =
    input.left.sourceRecordId < input.right.sourceRecordId
      ? [input.left, input.right]
      : [input.right, input.left];
  if (left.sourceRecordId === right.sourceRecordId) {
    throw new Error("A source record cannot be compared with itself.");
  }

  const rawFeatures = evaluatePairFeatures(left, right);
  const address = featureByCode(rawFeatures, "address");
  const geographic = featureByCode(rawFeatures, "geographic");
  const rent = featureByCode(rawFeatures, "rent");
  const bedsBaths = featureByCode(rawFeatures, "beds_baths");
  const squareFeet = featureByCode(rawFeatures, "square_feet");
  const exactReasonCodes: DuplicateExactReasonCode[] = [];
  const conflictReasonCodes: DuplicateConflictReasonCode[] = [];

  const sameSourceListingId =
    left.source === right.source &&
    left.sourceListingId !== null &&
    left.sourceListingId === right.sourceListingId;
  const differentSourceListingIds =
    left.source === right.source &&
    left.sourceListingId !== null &&
    right.sourceListingId !== null &&
    left.sourceListingId !== right.sourceListingId;
  const exactUrl = left.canonicalUrl !== null && left.canonicalUrl === right.canonicalUrl;
  const exactAddressUnit =
    left.normalizedAddress !== null &&
    left.normalizedAddress === right.normalizedAddress &&
    left.normalizedUnit !== null &&
    left.normalizedUnit === right.normalizedUnit;
  const conflictingUnits =
    left.normalizedAddress !== null &&
    left.normalizedAddress === right.normalizedAddress &&
    left.normalizedUnit !== null &&
    right.normalizedUnit !== null &&
    left.normalizedUnit !== right.normalizedUnit;
  const contactMatched = intersect(left.contactFingerprints, right.contactFingerprints);
  const photoMatched = hasExactPhotoMatch(left, right);
  const materialLocationConflict =
    address.status === "known" &&
    address.scoreBasisPoints < 2_500 &&
    (geographic.status === "unknown" || geographic.scoreBasisPoints === 0);

  if (sameSourceListingId) exactReasonCodes.push("same_source_listing_id");
  if (exactUrl) exactReasonCodes.push("exact_canonical_url");
  if (exactAddressUnit) exactReasonCodes.push("exact_normalized_address_unit");
  if (contactMatched) exactReasonCodes.push("exact_contact_match");
  if (photoMatched) exactReasonCodes.push("exact_photo_hash");
  if (differentSourceListingIds) conflictReasonCodes.push("different_source_listing_ids");
  if (conflictingUnits) conflictReasonCodes.push("conflicting_units");
  if (materialLocationConflict) conflictReasonCodes.push("material_location_conflict");

  const weighted = persistedFeatures(rawFeatures, config);
  const hardIdentity = sameSourceListingId || exactUrl || exactAddressUnit;
  const materialPropertyConflict =
    materialLocationConflict ||
    (rent.status === "known" && rent.scoreBasisPoints === 0) ||
    (bedsBaths.status === "known" && bedsBaths.scoreBasisPoints === 0) ||
    (geographic.status === "known" && geographic.scoreBasisPoints === 0);
  const compatiblePropertyFeature =
    knownAtLeast(address, 6_000) ||
    knownAtLeast(geographic, 5_000) ||
    knownAtLeast(rent, 7_500) ||
    knownAtLeast(bedsBaths, 5_000) ||
    knownAtLeast(squareFeet, 5_000);

  let decision: DuplicatePairEvaluation["decision"];
  if (differentSourceListingIds || conflictingUnits) decision = "separate";
  else if (hardIdentity && materialPropertyConflict) decision = "review";
  else if (hardIdentity) decision = "link";
  else if (materialLocationConflict) {
    decision =
      weighted.scoreBasisPoints !== null &&
      weighted.scoreBasisPoints >= config.reviewThresholdBasisPoints
        ? "review"
        : "separate";
  } else if (
    (contactMatched || photoMatched) &&
    !materialLocationConflict &&
    compatiblePropertyFeature
  ) {
    decision = "link";
  } else if (
    weighted.scoreBasisPoints !== null &&
    weighted.scoreBasisPoints >= config.automaticLinkThresholdBasisPoints
  ) {
    decision = "link";
  } else if (
    weighted.scoreBasisPoints !== null &&
    weighted.scoreBasisPoints >= config.reviewThresholdBasisPoints
  ) {
    decision = "review";
  } else {
    decision = "separate";
  }

  const inputHash = sha256Canonical({
    version: config.version,
    config,
    left: safeHashSource(left),
    right: safeHashSource(right),
    contactMatched
  });

  return DuplicatePairEvaluationSchema.parse({
    id: stableEntityId("pair", [left.sourceRecordId, right.sourceRecordId, config.version]),
    leftSourceRecordId: left.sourceRecordId,
    rightSourceRecordId: right.sourceRecordId,
    algorithmVersion: config.version,
    inputHash,
    decision,
    scoreBasisPoints: weighted.scoreBasisPoints,
    automaticLinkThresholdBasisPoints: config.automaticLinkThresholdBasisPoints,
    reviewThresholdBasisPoints: config.reviewThresholdBasisPoints,
    exactReasonCodes,
    conflictReasonCodes,
    contactMatched,
    features: weighted.features,
    evaluatedAt: input.evaluatedAt
  });
}
