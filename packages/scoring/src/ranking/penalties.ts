import type { RiskSignalV2 } from "@vera/domain";

import type { RankingConfig } from "./config.ts";
import type { CanonicalScoreInput } from "./types.ts";

const millisecondsPerDay = 86_400_000;

export function stalePenaltyBasisPoints(
  freshestObservedAt: string,
  evaluatedAt: string,
  config: RankingConfig
): number {
  const observed = Date.parse(freshestObservedAt);
  const evaluated = Date.parse(evaluatedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(evaluated)) {
    throw new Error("Ranking timestamps must be valid ISO instants.");
  }
  const ageDays = Math.max(0, (evaluated - observed) / millisecondsPerDay);
  return config.staleBands.find((band) => ageDays > band.olderThanDays)?.penaltyBasisPoints ?? 0;
}

export function lowConfidencePenaltyBasisPoints(
  listing: CanonicalScoreInput,
  config: RankingConfig
): number {
  if (listing.selectedFieldConfidences.length === 0) {
    return config.maxLowConfidencePenaltyBasisPoints;
  }
  const average = Math.round(
    listing.selectedFieldConfidences.reduce((sum, field) => sum + field.confidenceBasisPoints, 0) /
      listing.selectedFieldConfidences.length
  );
  if (average >= config.lowConfidenceFloorBasisPoints) return 0;
  return Math.min(
    config.maxLowConfidencePenaltyBasisPoints,
    Math.round(
      ((config.lowConfidenceFloorBasisPoints - average) / config.lowConfidenceFloorBasisPoints) *
        config.maxLowConfidencePenaltyBasisPoints
    )
  );
}

export function riskPenaltyBasisPoints(
  risks: readonly RiskSignalV2[],
  config: RankingConfig
): number {
  const active = risks.filter(({ status }) => status === "open");
  const total = active.reduce(
    (sum, risk) => sum + config.riskSeverityPenaltyBasisPoints[risk.severity],
    0
  );
  return Math.min(config.maxRiskPenaltyBasisPoints, total);
}
