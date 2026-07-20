import type { PetPolicy, RiskSignalV2, ScoreFactorCode, SearchProfile } from "@vera/domain";

export interface SelectedFieldConfidence {
  readonly fieldPath: string;
  readonly confidenceBasisPoints: number;
  readonly provenanceId: string;
}

export interface CanonicalScoreInput {
  readonly canonicalListingId: string;
  readonly monthlyRentCents: number | null;
  readonly recurringFeesCents: number | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly availableOn: string | null;
  readonly petPolicy: PetPolicy | null;
  readonly amenities: readonly string[];
  readonly explicitlyAbsentFeatures: readonly string[];
  readonly freshestObservedAt: string;
  readonly selectedFieldConfidences: readonly SelectedFieldConfidence[];
  readonly commuteMinutesByAnchor: Readonly<Record<string, number>>;
}

export interface RawRankingFactor {
  readonly code: ScoreFactorCode;
  readonly valueStatus: "known" | "unknown";
  readonly inputValue: unknown | null;
  readonly scoreBasisPoints: number | null;
  readonly reasonCodes: readonly string[];
  readonly provenanceIds: readonly string[];
  readonly unknownBehavior: "neutral" | "penalize";
}

export interface RankListingInput {
  readonly profile: SearchProfile;
  readonly listing: CanonicalScoreInput;
  readonly risks: readonly RiskSignalV2[];
  readonly evaluatedAt: string;
}
