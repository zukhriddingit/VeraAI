import { SCORE_VERSION, type RiskSeverityV2, type ScoreFactorCode } from "@vera/domain";

export interface StalePenaltyBand {
  readonly olderThanDays: number;
  readonly penaltyBasisPoints: number;
}

export interface RankingConfig {
  readonly version: typeof SCORE_VERSION;
  readonly factorWeights: Readonly<Record<ScoreFactorCode, number>>;
  readonly unknownPenaltyScoreBasisPoints: number;
  readonly staleBands: readonly StalePenaltyBand[];
  readonly lowConfidenceFloorBasisPoints: number;
  readonly maxLowConfidencePenaltyBasisPoints: number;
  readonly riskSeverityPenaltyBasisPoints: Readonly<Record<RiskSeverityV2, number>>;
  readonly maxRiskPenaltyBasisPoints: number;
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  version: SCORE_VERSION,
  factorWeights: {
    monthly_housing_cost: 3_000,
    bedrooms: 1_000,
    bathrooms: 750,
    move_in_timing: 1_250,
    pet_policy: 1_000,
    commute: 1_000,
    must_haves: 1_000,
    nice_to_haves: 1_000
  },
  unknownPenaltyScoreBasisPoints: 2_500,
  staleBands: [
    { olderThanDays: 30, penaltyBasisPoints: 1_500 },
    { olderThanDays: 14, penaltyBasisPoints: 750 },
    { olderThanDays: 7, penaltyBasisPoints: 250 }
  ],
  lowConfidenceFloorBasisPoints: 7_000,
  maxLowConfidencePenaltyBasisPoints: 1_500,
  riskSeverityPenaltyBasisPoints: {
    informational: 0,
    low: 250,
    medium: 750,
    high: 1_500
  },
  maxRiskPenaltyBasisPoints: 3_000
};

export class RankingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankingConfigurationError";
  }
}

function basisPoints(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
}

export function validateRankingConfig(config: RankingConfig): RankingConfig {
  if (config.version !== SCORE_VERSION) {
    throw new RankingConfigurationError("Unsupported ranking configuration version.");
  }
  if (Object.values(config.factorWeights).some((value) => !basisPoints(value))) {
    throw new RankingConfigurationError("Ranking factor weights must be basis points.");
  }
  if (Object.values(config.factorWeights).reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new RankingConfigurationError("Ranking factor weights must total exactly 10,000.");
  }
  if (
    !basisPoints(config.unknownPenaltyScoreBasisPoints) ||
    !basisPoints(config.lowConfidenceFloorBasisPoints) ||
    !basisPoints(config.maxLowConfidencePenaltyBasisPoints) ||
    !basisPoints(config.maxRiskPenaltyBasisPoints) ||
    Object.values(config.riskSeverityPenaltyBasisPoints).some((value) => !basisPoints(value))
  ) {
    throw new RankingConfigurationError("Ranking penalty configuration is invalid.");
  }
  let previousDays = Number.POSITIVE_INFINITY;
  for (const band of config.staleBands) {
    if (
      !Number.isSafeInteger(band.olderThanDays) ||
      band.olderThanDays < 0 ||
      band.olderThanDays >= previousDays ||
      !basisPoints(band.penaltyBasisPoints)
    ) {
      throw new RankingConfigurationError("Stale penalty bands must be descending and bounded.");
    }
    previousDays = band.olderThanDays;
  }
  return config;
}
