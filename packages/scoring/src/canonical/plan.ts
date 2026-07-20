import type {
  CanonicalListingPlan,
  CanonicalSupersessionPlan,
  DuplicateClusterPlan,
  DuplicateOverride,
  DuplicatePairEvaluation,
  NormalizedDecisionSource,
  PriorCanonicalIdentity
} from "@vera/domain";

import { clusterDuplicateSources } from "../dedupe/cluster.ts";
import { assignCanonicalIdentities } from "./identity.ts";
import { DEFAULT_STITCH_CONFIG, stitchCanonicalListing, type StitchConfig } from "./stitch.ts";

export interface PlanCanonicalReconciliationInput {
  readonly sources: readonly NormalizedDecisionSource[];
  readonly pairEvaluations: readonly DuplicatePairEvaluation[];
  readonly activeOverrides: readonly DuplicateOverride[];
  readonly priorCanonicals: readonly PriorCanonicalIdentity[];
  readonly createdAt: string;
  readonly stitchConfig?: StitchConfig;
}

export interface CanonicalReconciliationPlan {
  readonly clusterPlans: readonly DuplicateClusterPlan[];
  readonly canonicalPlans: readonly CanonicalListingPlan[];
  readonly supersessions: readonly CanonicalSupersessionPlan[];
}

export function planCanonicalReconciliation(
  input: PlanCanonicalReconciliationInput
): CanonicalReconciliationPlan {
  const sourceRecordIds = input.sources.map((source) => source.sourceRecordId);
  const initialClusters = clusterDuplicateSources({
    sourceRecordIds,
    pairEvaluations: input.pairEvaluations,
    activeOverrides: input.activeOverrides,
    priorCanonicals: input.priorCanonicals
  });
  const identities = assignCanonicalIdentities({
    clusters: initialClusters,
    priorCanonicals: input.priorCanonicals,
    activeOverrides: input.activeOverrides,
    createdAt: input.createdAt
  });
  const identityByCluster = new Map(
    identities.assignments.map((assignment) => [assignment.clusterId, assignment])
  );
  const canonicalPlans = initialClusters.map((cluster) => {
    const identity = identityByCluster.get(cluster.clusterId);
    if (identity === undefined) throw new Error("Canonical identity assignment is missing.");
    return stitchCanonicalListing({
      cluster,
      identity,
      sources: input.sources,
      config: input.stitchConfig ?? DEFAULT_STITCH_CONFIG
    });
  });
  const canonicalByCluster = new Map(
    canonicalPlans.map((canonical) => [
      canonical.clusterId ?? canonical.memberSourceRecordIds[0]!,
      canonical
    ])
  );
  const clusterPlans = initialClusters.map((cluster) => {
    const canonical =
      canonicalByCluster.get(cluster.clusterId) ??
      canonicalPlans.find(
        (candidate) =>
          candidate.clusterId === null &&
          candidate.memberSourceRecordIds.length === 1 &&
          candidate.memberSourceRecordIds[0] === cluster.memberSourceRecordIds[0]
      );
    if (canonical === undefined) throw new Error("Canonical stitch plan is missing for cluster.");
    return {
      ...cluster,
      primarySourceRecordId: canonical.primarySourceRecordId,
      priorCanonicalListingIds: canonical.priorCanonicalListingIds
    };
  });

  return {
    clusterPlans,
    canonicalPlans,
    supersessions: identities.supersessions
  };
}
