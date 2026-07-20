import {
  CanonicalSupersessionPlanSchema,
  type CanonicalSupersessionPlan,
  type DuplicateClusterPlan,
  type DuplicateOverride,
  type ListingLifecycleState,
  type PriorCanonicalIdentity
} from "@vera/domain";

import { stableEntityId } from "../determinism.ts";

export class CanonicalIdentityError extends Error {
  readonly code: "invalid_survivor" | "ambiguous_canonical_identity";

  constructor(code: "invalid_survivor" | "ambiguous_canonical_identity", message: string) {
    super(message);
    this.name = "CanonicalIdentityError";
    this.code = code;
  }
}

export interface CanonicalIdentityAssignment {
  readonly clusterId: string;
  readonly canonicalListingId: string;
  readonly priorCanonicalListingIds: readonly string[];
  readonly lifecycleState: ListingLifecycleState;
  readonly createdAt: string;
  readonly identityReasonCode:
    | "new_canonical"
    | "preserved_canonical"
    | "split_primary_preserved"
    | "split_new_canonical"
    | "merge_override_survivor"
    | "merge_oldest_survivor";
}

export interface AssignCanonicalIdentitiesInput {
  readonly clusters: readonly DuplicateClusterPlan[];
  readonly priorCanonicals: readonly PriorCanonicalIdentity[];
  readonly activeOverrides: readonly DuplicateOverride[];
  readonly createdAt: string;
}

export interface CanonicalIdentityPlan {
  readonly assignments: readonly CanonicalIdentityAssignment[];
  readonly supersessions: readonly CanonicalSupersessionPlan[];
}

function overlap(cluster: DuplicateClusterPlan, prior: PriorCanonicalIdentity): boolean {
  const members = new Set(cluster.memberSourceRecordIds);
  return prior.memberSourceRecordIds.some((id) => members.has(id));
}

function oldestCanonical(canonicals: readonly PriorCanonicalIdentity[]): PriorCanonicalIdentity {
  return [...canonicals].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.canonicalListingId.localeCompare(right.canonicalListingId, "en")
      : left.createdAt.localeCompare(right.createdAt, "en")
  )[0]!;
}

function explicitMergeSurvivor(
  cluster: DuplicateClusterPlan,
  touched: readonly PriorCanonicalIdentity[],
  overrides: readonly DuplicateOverride[]
): PriorCanonicalIdentity | null {
  const memberSet = new Set(cluster.memberSourceRecordIds);
  const candidates = overrides
    .filter(
      (override) =>
        override.kind === "force_merge" && override.sourceRecordIds.every((id) => memberSet.has(id))
    )
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? right.id.localeCompare(left.id, "en")
        : right.createdAt.localeCompare(left.createdAt, "en")
    );
  const selected = candidates[0];
  if (selected === undefined) return null;
  const survivor = touched.find(
    (canonical) => canonical.canonicalListingId === selected.survivorCanonicalId
  );
  if (survivor === undefined) {
    throw new CanonicalIdentityError(
      "invalid_survivor",
      "Force-merge survivor is not an active canonical touched by the merged component."
    );
  }
  return survivor;
}

export function assignCanonicalIdentities(
  input: AssignCanonicalIdentitiesInput
): CanonicalIdentityPlan {
  const clusters = [...input.clusters].sort((left, right) =>
    left.memberSourceRecordIds[0]!.localeCompare(right.memberSourceRecordIds[0]!, "en")
  );
  const priorById = new Map(
    input.priorCanonicals.map((canonical) => [canonical.canonicalListingId, canonical])
  );
  if (priorById.size !== input.priorCanonicals.length) {
    throw new CanonicalIdentityError(
      "ambiguous_canonical_identity",
      "Prior canonical identities must be unique."
    );
  }
  const clustersByPrior = new Map<string, DuplicateClusterPlan[]>();
  for (const prior of input.priorCanonicals) {
    clustersByPrior.set(
      prior.canonicalListingId,
      clusters.filter((cluster) => overlap(cluster, prior))
    );
  }

  const assignments: CanonicalIdentityAssignment[] = [];
  for (const cluster of clusters) {
    const touched = input.priorCanonicals
      .filter((prior) => overlap(cluster, prior))
      .sort((left, right) => left.canonicalListingId.localeCompare(right.canonicalListingId, "en"));
    let winner: PriorCanonicalIdentity | null = null;
    let identityReasonCode: CanonicalIdentityAssignment["identityReasonCode"];

    if (touched.length === 0) {
      identityReasonCode = "new_canonical";
    } else if (touched.length === 1) {
      const prior = touched[0]!;
      const splitComponents = clustersByPrior.get(prior.canonicalListingId) ?? [];
      if (splitComponents.length <= 1) {
        winner = prior;
        identityReasonCode = "preserved_canonical";
      } else if (cluster.memberSourceRecordIds.includes(prior.primarySourceRecordId)) {
        winner = prior;
        identityReasonCode = "split_primary_preserved";
      } else {
        identityReasonCode = "split_new_canonical";
      }
    } else {
      const overrideSurvivor = explicitMergeSurvivor(cluster, touched, input.activeOverrides);
      winner = overrideSurvivor ?? oldestCanonical(touched);
      identityReasonCode =
        overrideSurvivor === null ? "merge_oldest_survivor" : "merge_override_survivor";
    }

    assignments.push({
      clusterId: cluster.clusterId,
      canonicalListingId:
        winner?.canonicalListingId ??
        stableEntityId("canonical", [cluster.memberSourceRecordIds[0]!]),
      priorCanonicalListingIds: touched.map((prior) => prior.canonicalListingId),
      lifecycleState: winner?.lifecycleState ?? "new",
      createdAt: winner?.createdAt ?? input.createdAt,
      identityReasonCode
    });
  }

  const claimedIds = assignments.map((assignment) => assignment.canonicalListingId);
  if (new Set(claimedIds).size !== claimedIds.length) {
    throw new CanonicalIdentityError(
      "ambiguous_canonical_identity",
      "Multiple current components would claim the same canonical identity."
    );
  }

  const supersessions = assignments.flatMap((assignment) => {
    if (!assignment.identityReasonCode.startsWith("merge_")) return [];
    return assignment.priorCanonicalListingIds
      .filter((id) => id !== assignment.canonicalListingId)
      .map((id) =>
        CanonicalSupersessionPlanSchema.parse({
          supersededCanonicalListingId: id,
          survivorCanonicalListingId: assignment.canonicalListingId,
          reasonCode: "cluster_merge"
        })
      );
  });
  const claimedSet = new Set(claimedIds);
  if (
    supersessions.some((supersession) => claimedSet.has(supersession.supersededCanonicalListingId))
  ) {
    throw new CanonicalIdentityError(
      "ambiguous_canonical_identity",
      "A canonical identity cannot be both current and superseded."
    );
  }

  return {
    assignments,
    supersessions: supersessions.sort((left, right) =>
      left.supersededCanonicalListingId.localeCompare(right.supersededCanonicalListingId, "en")
    )
  };
}
