import { RISK_VERSION } from "@vera/domain";

export interface RiskConfig {
  readonly version: typeof RISK_VERSION;
  readonly evidenceWindowCharacters: number;
  readonly reusedPhotoMaximumHammingDistance: number;
  readonly rentInconsistencyMinimumCents: number;
  readonly rentInconsistencyPercent: number;
  readonly feeInconsistencyMinimumCents: number;
  readonly feeInconsistencyPercent: number;
  readonly roomInconsistencyMinimum: number;
  readonly outlierMinimumComparableListings: number;
  readonly outlierMaximumMedianRatioPercent: number;
  readonly outlierModifiedZThresholdTimesTenThousand: number;
  readonly shortenerHosts: readonly string[];
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  version: RISK_VERSION,
  evidenceWindowCharacters: 240,
  reusedPhotoMaximumHammingDistance: 4,
  rentInconsistencyMinimumCents: 25_000,
  rentInconsistencyPercent: 10,
  feeInconsistencyMinimumCents: 10_000,
  feeInconsistencyPercent: 20,
  roomInconsistencyMinimum: 1,
  outlierMinimumComparableListings: 5,
  outlierMaximumMedianRatioPercent: 60,
  outlierModifiedZThresholdTimesTenThousand: 30_000,
  shortenerHosts: ["bit.ly", "cutt.ly", "goo.gl", "is.gd", "rebrand.ly", "t.co", "tinyurl.com"]
};

export function validateRiskConfig(config: RiskConfig): RiskConfig {
  const positiveIntegers = [
    config.evidenceWindowCharacters,
    config.rentInconsistencyMinimumCents,
    config.rentInconsistencyPercent,
    config.feeInconsistencyMinimumCents,
    config.feeInconsistencyPercent,
    config.roomInconsistencyMinimum,
    config.outlierMinimumComparableListings,
    config.outlierMaximumMedianRatioPercent,
    config.outlierModifiedZThresholdTimesTenThousand
  ];
  if (
    config.version !== RISK_VERSION ||
    positiveIntegers.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    config.evidenceWindowCharacters > 240 ||
    !Number.isSafeInteger(config.reusedPhotoMaximumHammingDistance) ||
    config.reusedPhotoMaximumHammingDistance < 0 ||
    config.reusedPhotoMaximumHammingDistance > 64 ||
    config.outlierMaximumMedianRatioPercent >= 100 ||
    new Set(config.shortenerHosts).size !== config.shortenerHosts.length
  ) {
    throw new Error("Risk configuration is invalid.");
  }
  return config;
}
