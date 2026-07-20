import type {
  NormalizedDecisionSource,
  RiskEvidenceV2,
  RiskIndicatorCode,
  RiskSeverityV2
} from "@vera/domain";

export interface RiskListingInput {
  readonly canonicalListingId: string;
  readonly sources: readonly NormalizedDecisionSource[];
}

export interface RiskCandidate {
  readonly code: RiskIndicatorCode;
  readonly severity: RiskSeverityV2;
  readonly confidenceBasisPoints: number;
  readonly evidence: readonly RiskEvidenceV2[];
  readonly verificationAction: string;
}
