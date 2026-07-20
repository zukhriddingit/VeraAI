import {
  ListingScoreV2Schema,
  type ListingScoreV2,
  type ScoreFactorCode,
  type ScoreFactorV2,
  type ScoreReasonCode
} from "@vera/domain";

import { sha256Canonical, stableEntityId } from "../determinism.ts";
import { DEFAULT_RANKING_CONFIG, type RankingConfig, validateRankingConfig } from "./config.ts";
import { evaluateHardConstraints } from "./constraints.ts";
import { explainScore } from "./explanations.ts";
import { evaluateRankingFactors } from "./factors.ts";
import {
  lowConfidencePenaltyBasisPoints,
  riskPenaltyBasisPoints,
  stalePenaltyBasisPoints
} from "./penalties.ts";
import type { RankListingInput, RawRankingFactor } from "./types.ts";

interface Allocation {
  readonly code: ScoreFactorCode;
  value: number;
  readonly remainder: number;
}

function largestRemainder(
  factors: readonly RawRankingFactor[],
  effectiveScores: ReadonlyMap<ScoreFactorCode, number>,
  config: RankingConfig,
  target: "weights" | "contributions",
  totalWeight: number,
  targetTotal: number
): ReadonlyMap<ScoreFactorCode, number> {
  const allocations: Allocation[] = factors.map((factor) => {
    const effectiveScore = effectiveScores.get(factor.code);
    if (effectiveScore === undefined) return { code: factor.code, value: 0, remainder: 0 };
    const numerator =
      target === "weights"
        ? config.factorWeights[factor.code] * 10_000
        : effectiveScore * config.factorWeights[factor.code];
    const exact = numerator / totalWeight;
    const value = Math.floor(exact);
    return { code: factor.code, value, remainder: exact - value };
  });
  let remaining = targetTotal - allocations.reduce((sum, allocation) => sum + allocation.value, 0);
  for (const allocation of [...allocations].sort((left, right) =>
    left.remainder === right.remainder
      ? left.code.localeCompare(right.code, "en")
      : right.remainder - left.remainder
  )) {
    if (remaining <= 0) break;
    allocation.value += 1;
    remaining -= 1;
  }
  return new Map(allocations.map(({ code, value }) => [code, value]));
}

function allocateFactors(
  rawFactors: readonly RawRankingFactor[],
  config: RankingConfig
): { readonly factors: readonly ScoreFactorV2[]; readonly baseScoreBasisPoints: number } {
  const effectiveScores = new Map<ScoreFactorCode, number>();
  for (const factor of rawFactors) {
    if (factor.valueStatus === "known" && factor.scoreBasisPoints !== null) {
      effectiveScores.set(factor.code, factor.scoreBasisPoints);
    } else if (factor.unknownBehavior === "penalize") {
      effectiveScores.set(factor.code, config.unknownPenaltyScoreBasisPoints);
    }
  }
  const totalWeight = [...effectiveScores.keys()].reduce(
    (sum, code) => sum + config.factorWeights[code],
    0
  );
  if (totalWeight === 0) {
    return {
      baseScoreBasisPoints: 0,
      factors: rawFactors.map((factor) => ({
        code: factor.code,
        valueStatus: factor.valueStatus,
        inputValue: factor.inputValue as ScoreFactorV2["inputValue"],
        scoreBasisPoints: factor.scoreBasisPoints,
        configuredWeightBasisPoints: config.factorWeights[factor.code],
        normalizedWeightBasisPoints: 0,
        contributionBasisPoints: 0,
        reasonCodes: [...factor.reasonCodes],
        provenanceIds: [...factor.provenanceIds]
      }))
    };
  }
  const weightedNumerator = [...effectiveScores.entries()].reduce(
    (sum, [code, score]) => sum + score * config.factorWeights[code],
    0
  );
  const baseScoreBasisPoints = Math.round(weightedNumerator / totalWeight);
  const normalizedWeights = largestRemainder(
    rawFactors,
    effectiveScores,
    config,
    "weights",
    totalWeight,
    10_000
  );
  const contributions = largestRemainder(
    rawFactors,
    effectiveScores,
    config,
    "contributions",
    totalWeight,
    baseScoreBasisPoints
  );
  return {
    baseScoreBasisPoints,
    factors: rawFactors.map((factor) => ({
      code: factor.code,
      valueStatus: factor.valueStatus,
      inputValue: factor.inputValue as ScoreFactorV2["inputValue"],
      scoreBasisPoints: factor.scoreBasisPoints,
      configuredWeightBasisPoints: config.factorWeights[factor.code],
      normalizedWeightBasisPoints: normalizedWeights.get(factor.code) ?? 0,
      contributionBasisPoints: contributions.get(factor.code) ?? 0,
      reasonCodes: [...factor.reasonCodes],
      provenanceIds: [...factor.provenanceIds]
    }))
  };
}

function appendReason(reasons: ScoreReasonCode[], reason: ScoreReasonCode): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function rankListing(
  input: RankListingInput,
  inputConfig: RankingConfig = DEFAULT_RANKING_CONFIG
): ListingScoreV2 {
  const config = validateRankingConfig(inputConfig);
  const constraints = evaluateHardConstraints(input.profile, input.listing);
  const eligible = !constraints.some(({ status }) => status === "failed");
  const rawFactors = evaluateRankingFactors(input.profile, input.listing, constraints, config);
  const allocation = allocateFactors(rawFactors, config);
  const stalePenalty = stalePenaltyBasisPoints(
    input.listing.freshestObservedAt,
    input.evaluatedAt,
    config
  );
  const confidencePenalty = lowConfidencePenaltyBasisPoints(input.listing, config);
  const riskPenalty = riskPenaltyBasisPoints(input.risks, config);
  const finalScore = Math.max(
    0,
    allocation.baseScoreBasisPoints - stalePenalty - confidencePenalty - riskPenalty
  );
  const reasons: ScoreReasonCode[] = [];
  appendReason(reasons, eligible ? "eligible" : "hard_constraint_failed");
  if (rawFactors.some((factor) => factor.valueStatus === "unknown")) {
    appendReason(reasons, "unknown_neutral");
    appendReason(reasons, "needs_verification");
  }
  if (rawFactors.some((factor) => factor.reasonCodes.includes("nice_to_haves_unknown_penalized"))) {
    appendReason(reasons, "unknown_penalized");
  }
  if (stalePenalty > 0) appendReason(reasons, "stale_penalty_applied");
  if (confidencePenalty > 0) appendReason(reasons, "low_confidence_penalty_applied");
  if (riskPenalty > 0) appendReason(reasons, "risk_penalty_applied");
  if (allocation.factors.some(({ contributionBasisPoints }) => contributionBasisPoints > 0)) {
    appendReason(reasons, "strongest_positive_factor");
  }
  const explanation = explainScore({
    eligible,
    constraints,
    factors: allocation.factors,
    stalePenaltyBasisPoints: stalePenalty,
    lowConfidencePenaltyBasisPoints: confidencePenalty,
    riskPenaltyBasisPoints: riskPenalty
  });
  const inputHash = sha256Canonical({
    version: config.version,
    config,
    profile: input.profile,
    listing: input.listing,
    risks: input.risks.map((risk) => ({
      code: risk.code,
      severity: risk.severity,
      idempotencyKey: risk.idempotencyKey,
      status: risk.status
    })),
    evaluatedAt: input.evaluatedAt
  });

  return ListingScoreV2Schema.parse({
    id: stableEntityId("score", [
      input.listing.canonicalListingId,
      input.profile.id,
      config.version,
      inputHash
    ]),
    schemaVersion: 2,
    canonicalListingId: input.listing.canonicalListingId,
    searchProfileId: input.profile.id,
    algorithmVersion: config.version,
    inputHash,
    eligible,
    hardConstraints: constraints,
    factors: allocation.factors,
    baseScoreBasisPoints: allocation.baseScoreBasisPoints,
    stalePenaltyBasisPoints: stalePenalty,
    lowConfidencePenaltyBasisPoints: confidencePenalty,
    riskPenaltyBasisPoints: riskPenalty,
    finalScoreBasisPoints: finalScore,
    reasonCodes: reasons,
    explanation,
    computedAt: input.evaluatedAt
  });
}
