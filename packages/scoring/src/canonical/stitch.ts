import {
  STITCH_VERSION,
  CanonicalListingPlanSchema,
  type AcquisitionMode,
  type CanonicalListingPlan,
  type DuplicateClusterPlan,
  type FieldExtractionMethod,
  type NormalizedDecisionSource
} from "@vera/domain";

import { sha256Canonical } from "../determinism.ts";
import type { CanonicalIdentityAssignment } from "./identity.ts";

export interface StitchConfig {
  readonly version: typeof STITCH_VERSION;
  readonly acquisitionModeTrustBasisPoints: Readonly<Record<AcquisitionMode, number>>;
  readonly connectorTrustBasisPoints: Readonly<Record<string, number>>;
  readonly extractionMethodPriority: Readonly<Record<FieldExtractionMethod, number>>;
}

export const DEFAULT_STITCH_CONFIG: StitchConfig = {
  version: STITCH_VERSION,
  acquisitionModeTrustBasisPoints: {
    official_api: 9_000,
    email_alert: 8_000,
    user_capture: 7_500,
    local_browser: 6_500,
    fixture: 8_000
  },
  connectorTrustBasisPoints: {},
  extractionMethodPriority: {
    manual: 4,
    fixture_structured: 4,
    rule: 3,
    ai: 2
  }
};

function trust(source: NormalizedDecisionSource, config: StitchConfig): number {
  return (
    config.connectorTrustBasisPoints[source.connectorId] ??
    config.acquisitionModeTrustBasisPoints[source.acquisitionMode]
  );
}

function compareSources(
  left: NormalizedDecisionSource,
  right: NormalizedDecisionSource,
  config: StitchConfig
): number {
  if (left.observedAt !== right.observedAt)
    return right.observedAt.localeCompare(left.observedAt, "en");
  if (left.completenessBasisPoints !== right.completenessBasisPoints) {
    return right.completenessBasisPoints - left.completenessBasisPoints;
  }
  if (left.extractionConfidenceBasisPoints !== right.extractionConfidenceBasisPoints) {
    return right.extractionConfidenceBasisPoints - left.extractionConfidenceBasisPoints;
  }
  const trustDifference = trust(right, config) - trust(left, config);
  return trustDifference === 0
    ? left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
    : trustDifference;
}

function safeSource(source: NormalizedDecisionSource) {
  const { contactFingerprints: _protected, ...safe } = source;
  return safe;
}

export interface StitchCanonicalListingInput {
  readonly cluster: DuplicateClusterPlan;
  readonly identity: CanonicalIdentityAssignment;
  readonly sources: readonly NormalizedDecisionSource[];
  readonly config?: StitchConfig;
}

export function stitchCanonicalListing(input: StitchCanonicalListingInput): CanonicalListingPlan {
  const config = input.config ?? DEFAULT_STITCH_CONFIG;
  if (config.version !== STITCH_VERSION)
    throw new Error("Unsupported stitch configuration version.");
  const memberSet = new Set(input.cluster.memberSourceRecordIds);
  const sources = input.sources
    .filter((source) => memberSet.has(source.sourceRecordId))
    .sort((left, right) => compareSources(left, right, config));
  if (sources.length !== input.cluster.memberSourceRecordIds.length) {
    throw new Error("Canonical stitching requires every cluster source exactly once.");
  }
  const primary = sources[0]!;
  const sourceById = new Map(sources.map((source) => [source.sourceRecordId, source]));
  const fieldPaths = [
    ...new Set(
      sources.flatMap((source) => source.fieldCandidates.map((candidate) => candidate.fieldPath))
    )
  ].sort();
  const selectedFields = fieldPaths.map((fieldPath) => {
    const candidates = sources
      .flatMap((source) => source.fieldCandidates)
      .filter((candidate) => candidate.fieldPath === fieldPath)
      .sort((left, right) => {
        if (left.valueStatus !== right.valueStatus) return left.valueStatus === "known" ? -1 : 1;
        const leftSource = sourceById.get(left.sourceRecordId)!;
        const rightSource = sourceById.get(right.sourceRecordId)!;
        const trustDifference = trust(rightSource, config) - trust(leftSource, config);
        if (trustDifference !== 0) return trustDifference;
        if (left.confidenceBasisPoints !== right.confidenceBasisPoints) {
          return right.confidenceBasisPoints - left.confidenceBasisPoints;
        }
        if (left.observedAt !== right.observedAt) {
          return right.observedAt.localeCompare(left.observedAt, "en");
        }
        const methodDifference =
          config.extractionMethodPriority[right.extractionMethod] -
          config.extractionMethodPriority[left.extractionMethod];
        if (methodDifference !== 0) return methodDifference;
        if (leftSource.completenessBasisPoints !== rightSource.completenessBasisPoints) {
          return rightSource.completenessBasisPoints - leftSource.completenessBasisPoints;
        }
        return left.sourceRecordId.localeCompare(right.sourceRecordId, "en");
      });
    const selected = candidates[0];
    if (selected === undefined || selected.valueStatus === "unknown") {
      return {
        fieldPath,
        valueStatus: "unknown" as const,
        value: null,
        selectedFieldProvenanceId: null,
        selectedSourceRecordId: null,
        reasonCodes: ["all_candidates_unknown"]
      };
    }
    return {
      fieldPath,
      valueStatus: "known" as const,
      value: selected.value,
      selectedFieldProvenanceId: selected.fieldProvenanceId,
      selectedSourceRecordId: selected.sourceRecordId,
      reasonCodes: ["highest_ranked_provenance"]
    };
  });
  const knownCount = selectedFields.filter((field) => field.valueStatus === "known").length;
  const completenessBasisPoints =
    selectedFields.length === 0
      ? Math.max(...sources.map((source) => source.completenessBasisPoints))
      : Math.round((knownCount * 10_000) / selectedFields.length);
  const stitchInputHash = sha256Canonical({
    version: config.version,
    config,
    cluster: input.cluster,
    identity: input.identity,
    sources: sources.map(safeSource)
  });

  return CanonicalListingPlanSchema.parse({
    canonicalListingId: input.identity.canonicalListingId,
    clusterId: sources.length > 1 ? input.cluster.clusterId : null,
    memberSourceRecordIds: [...input.cluster.memberSourceRecordIds].sort(),
    primarySourceRecordId: primary.sourceRecordId,
    priorCanonicalListingIds: [...input.identity.priorCanonicalListingIds].sort(),
    lifecycleState: input.identity.lifecycleState,
    selectedFields,
    completenessBasisPoints,
    freshestObservedAt: sources
      .map((source) => source.observedAt)
      .sort()
      .at(-1)!,
    stitchVersion: config.version,
    stitchInputHash
  });
}
