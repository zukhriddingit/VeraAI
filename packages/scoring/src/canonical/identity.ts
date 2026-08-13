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

function priorOwnerCluster(
  prior: PriorCanonicalIdentity,
  clusters: readonly DuplicateClusterPlan[]
): DuplicateClusterPlan | null {
  const overlapping = clusters.filter((cluster) => overlap(cluster, prior));
  if (overlapping.length === 0) return null;
  const primaryOwner = overlapping.find((cluster) =>
    cluster.memberSourceRecordIds.includes(prior.primarySourceRecordId)
  );
  if (primaryOwner) return primaryOwner;
  const priorMembers = new Set(prior.memberSourceRecordIds);
  return [...overlapping].sort((left, right) => {
    const rightOverlap = right.memberSourceRecordIds.filter((id) => priorMembers.has(id)).length;
    const leftOverlap = left.memberSourceRecordIds.filter((id) => priorMembers.has(id)).length;
    return (
      rightOverlap - leftOverlap ||
      left.memberSourceRecordIds[0]!.localeCompare(right.memberSourceRecordIds[0]!, "en")
    );
  })[0]!;
}

function availableCanonicalId(
  cluster: DuplicateClusterPlan,
  reservedIds: ReadonlySet<string>
): string {
  const firstSourceRecordId = cluster.memberSourceRecordIds[0]!;
  const ordinary = stableEntityId("canonical", [firstSourceRecordId]);
  if (!reservedIds.has(ordinary)) return ordinary;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const split = stableEntityId("canonical", [firstSourceRecordId, "split", String(attempt)]);
    if (!reservedIds.has(split)) return split;
  }
  throw new CanonicalIdentityError(
    "ambiguous_canonical_identity",
    "A collision-free deterministic canonical identity could not be allocated."
  );
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
  const ownerClusterIdByPrior = new Map<string, string>();
  const reservedCanonicalIds = new Set(priorById.keys());
  for (const prior of input.priorCanonicals) {
    const overlapping = clusters.filter((cluster) => overlap(cluster, prior));
    clustersByPrior.set(prior.canonicalListingId, overlapping);
    const owner = priorOwnerCluster(prior, clusters);
    if (owner) ownerClusterIdByPrior.set(prior.canonicalListingId, owner.clusterId);
  }

  const assignments: CanonicalIdentityAssignment[] = [];
  for (const cluster of clusters) {
    const touched = input.priorCanonicals
      .filter((prior) => overlap(cluster, prior))
      .sort((left, right) => left.canonicalListingId.localeCompare(right.canonicalListingId, "en"));
    const assigned = touched.filter(
      (prior) => ownerClusterIdByPrior.get(prior.canonicalListingId) === cluster.clusterId
    );
    let winner: PriorCanonicalIdentity | null = null;
    let identityReasonCode: CanonicalIdentityAssignment["identityReasonCode"];

    if (assigned.length === 0) {
      identityReasonCode = touched.length === 0 ? "new_canonical" : "split_new_canonical";
    } else if (assigned.length === 1) {
      const prior = assigned[0]!;
      const splitComponents = clustersByPrior.get(prior.canonicalListingId) ?? [];
      winner = prior;
      identityReasonCode =
        splitComponents.length <= 1 ? "preserved_canonical" : "split_primary_preserved";
    } else {
      const overrideSurvivor = explicitMergeSurvivor(cluster, assigned, input.activeOverrides);
      winner = overrideSurvivor ?? oldestCanonical(assigned);
      identityReasonCode =
        overrideSurvivor === null ? "merge_oldest_survivor" : "merge_override_survivor";
    }

    const canonicalListingId =
      winner?.canonicalListingId ?? availableCanonicalId(cluster, reservedCanonicalIds);
    reservedCanonicalIds.add(canonicalListingId);
    assignments.push({
      clusterId: cluster.clusterId,
      canonicalListingId,
      priorCanonicalListingIds: assigned.map((prior) => prior.canonicalListingId),
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
