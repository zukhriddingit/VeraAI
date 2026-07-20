import { DEDUPE_VERSION, type DuplicatePairFeatureCode } from "@vera/domain";

export type DedupeWeights = Readonly<Record<DuplicatePairFeatureCode, number>>;

export interface DedupeConfig {
  readonly version: typeof DEDUPE_VERSION;
  readonly automaticLinkThresholdBasisPoints: number;
  readonly reviewThresholdBasisPoints: number;
  readonly maxCandidatePairs: number;
  readonly fallbackBlockSize: number;
  readonly weights: DedupeWeights;
}

export const DEFAULT_DEDUPE_CONFIG: DedupeConfig = {
  version: DEDUPE_VERSION,
  automaticLinkThresholdBasisPoints: 7_500,
  reviewThresholdBasisPoints: 6_000,
  maxCandidatePairs: 2_000,
  fallbackBlockSize: 250,
  weights: {
    address: 2_500,
    geographic: 1_000,
    rent: 1_500,
    beds_baths: 1_000,
    square_feet: 750,
    text: 1_250,
    photo: 1_500,
    posting_time: 500
  }
};

export class DedupeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DedupeConfigurationError";
  }
}

export function validateDedupeConfig(config: DedupeConfig): DedupeConfig {
  if (config.version !== DEDUPE_VERSION) {
    throw new DedupeConfigurationError("Unsupported dedupe configuration version.");
  }
  for (const [name, value] of Object.entries(config.weights)) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
      throw new DedupeConfigurationError(`${name} weight must be an integer from 0 to 10,000.`);
    }
  }
  const weightTotal = Object.values(config.weights).reduce((sum, value) => sum + value, 0);
  if (weightTotal !== 10_000) {
    throw new DedupeConfigurationError("Default dedupe weights must total exactly 10,000.");
  }
  if (
    !Number.isSafeInteger(config.reviewThresholdBasisPoints) ||
    !Number.isSafeInteger(config.automaticLinkThresholdBasisPoints) ||
    config.reviewThresholdBasisPoints < 0 ||
    config.automaticLinkThresholdBasisPoints > 10_000 ||
    config.reviewThresholdBasisPoints > config.automaticLinkThresholdBasisPoints
  ) {
    throw new DedupeConfigurationError("Dedupe thresholds are invalid.");
  }
  if (
    !Number.isSafeInteger(config.maxCandidatePairs) ||
    config.maxCandidatePairs < 1 ||
    config.maxCandidatePairs > 1_000_000 ||
    !Number.isSafeInteger(config.fallbackBlockSize) ||
    config.fallbackBlockSize < 2 ||
    config.fallbackBlockSize > 1_000
  ) {
    throw new DedupeConfigurationError("Dedupe candidate limits are unsafe.");
  }
  return config;
}
