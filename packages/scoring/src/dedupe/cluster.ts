import {
  DuplicateClusterPlanSchema,
  type BlockedDuplicateEdge,
  type DuplicateClusterPlan,
  type DuplicateOverride,
  type DuplicatePairEvaluation,
  type PriorCanonicalIdentity
} from "@vera/domain";

import { stableEntityId } from "../determinism.ts";

function edgeKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

class DeterministicUnionFind {
  readonly #parent = new Map<string, string>();
  readonly #members = new Map<string, Set<string>>();

  constructor(ids: readonly string[]) {
    for (const id of ids) {
      this.#parent.set(id, id);
      this.#members.set(id, new Set([id]));
    }
  }

  find(id: string): string {
    const parent = this.#parent.get(id);
    if (parent === undefined) throw new Error(`Unknown union-find source ${id}.`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.#parent.set(id, root);
    return root;
  }

  members(id: string): ReadonlySet<string> {
    return this.#members.get(this.find(id)) ?? new Set();
  }

  union(left: string, right: string): string {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return leftRoot;
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    const child = root === leftRoot ? rightRoot : leftRoot;
    const rootMembers = this.#members.get(root)!;
    for (const member of this.#members.get(child) ?? []) rootMembers.add(member);
    this.#members.delete(child);
    this.#parent.set(child, root);
    return root;
  }

  components(): readonly (readonly string[])[] {
    return [...this.#members.values()]
      .map((members) => [...members].sort())
      .sort((left, right) => left[0]!.localeCompare(right[0]!, "en"));
  }
}

interface CannotLink {
  readonly overrideId: string;
  readonly createdAt: string;
}

function newestCannotLink(current: CannotLink | undefined, candidate: CannotLink): CannotLink {
  if (current === undefined) return candidate;
  if (current.createdAt !== candidate.createdAt) {
    return current.createdAt > candidate.createdAt ? current : candidate;
  }
  return current.overrideId > candidate.overrideId ? current : candidate;
}

function firstBlockingConstraint(
  leftMembers: ReadonlySet<string>,
  rightMembers: ReadonlySet<string>,
  cannotLinks: ReadonlyMap<string, CannotLink>
): { readonly left: string; readonly right: string; readonly constraint: CannotLink } | null {
  for (const left of [...leftMembers].sort()) {
    for (const right of [...rightMembers].sort()) {
      const constraint = cannotLinks.get(edgeKey(left, right));
      if (constraint !== undefined) {
        return left < right
          ? { left, right, constraint }
          : { left: right, right: left, constraint };
      }
    }
  }
  return null;
}

export interface ClusterDuplicateSourcesInput {
  readonly sourceRecordIds: readonly string[];
  readonly pairEvaluations: readonly DuplicatePairEvaluation[];
  readonly activeOverrides: readonly DuplicateOverride[];
  readonly priorCanonicals?: readonly PriorCanonicalIdentity[];
}

export function clusterDuplicateSources(
  input: ClusterDuplicateSourcesInput
): readonly DuplicateClusterPlan[] {
  const sourceRecordIds = [...input.sourceRecordIds].sort();
  if (new Set(sourceRecordIds).size !== sourceRecordIds.length) {
    throw new Error("Duplicate clustering requires unique source-record IDs.");
  }
  const sourceIdSet = new Set(sourceRecordIds);
  for (const pair of input.pairEvaluations) {
    if (!sourceIdSet.has(pair.leftSourceRecordId) || !sourceIdSet.has(pair.rightSourceRecordId)) {
      throw new Error("Pair evaluation references a source outside the clustering corpus.");
    }
  }
  for (const override of input.activeOverrides) {
    if (override.sourceRecordIds.some((id) => !sourceIdSet.has(id))) {
      throw new Error("Duplicate override references a source outside the clustering corpus.");
    }
  }

  const cannotLinks = new Map<string, CannotLink>();
  for (const override of input.activeOverrides.filter(({ kind }) => kind === "force_split")) {
    for (let leftIndex = 0; leftIndex < override.sourceRecordIds.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < override.sourceRecordIds.length;
        rightIndex += 1
      ) {
        const key = edgeKey(
          override.sourceRecordIds[leftIndex]!,
          override.sourceRecordIds[rightIndex]!
        );
        cannotLinks.set(
          key,
          newestCannotLink(cannotLinks.get(key), {
            overrideId: override.id,
            createdAt: override.createdAt
          })
        );
      }
    }
  }

  const unionFind = new DeterministicUnionFind(sourceRecordIds);
  const blockedEdges: BlockedDuplicateEdge[] = [];
  const attemptUnion = (left: string, right: string): boolean => {
    if (unionFind.find(left) === unionFind.find(right)) return true;
    const blocked = firstBlockingConstraint(
      unionFind.members(left),
      unionFind.members(right),
      cannotLinks
    );
    if (blocked !== null) {
      blockedEdges.push({
        leftSourceRecordId: blocked.left,
        rightSourceRecordId: blocked.right,
        reasonCode: "blocked_by_force_split",
        overrideId: blocked.constraint.overrideId
      });
      return false;
    }
    unionFind.union(left, right);
    return true;
  };

  const mergeOverrides = input.activeOverrides
    .filter(({ kind }) => kind === "force_merge")
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id, "en")
        : left.createdAt.localeCompare(right.createdAt, "en")
    );
  for (const override of mergeOverrides) {
    const first = override.sourceRecordIds[0]!;
    for (const sourceId of override.sourceRecordIds.slice(1)) attemptUnion(first, sourceId);
  }

  const automaticEdges = input.pairEvaluations
    .filter(({ decision }) => decision === "link")
    .sort((left, right) => {
      const scoreDifference = (right.scoreBasisPoints ?? -1) - (left.scoreBasisPoints ?? -1);
      return scoreDifference === 0 ? left.id.localeCompare(right.id, "en") : scoreDifference;
    });
  for (const pair of automaticEdges)
    attemptUnion(pair.leftSourceRecordId, pair.rightSourceRecordId);

  const priorCanonicals = input.priorCanonicals ?? [];
  return unionFind.components().map((members) => {
    const memberSet = new Set(members);
    const linkedPairEvaluationIds = automaticEdges
      .filter(
        (pair) => memberSet.has(pair.leftSourceRecordId) && memberSet.has(pair.rightSourceRecordId)
      )
      .map((pair) => pair.id)
      .sort();
    const appliedOverrideIds = input.activeOverrides
      .filter((override) => override.sourceRecordIds.some((id) => memberSet.has(id)))
      .map((override) => override.id)
      .sort();
    const clusterBlockedEdges = blockedEdges
      .filter(
        (edge) => memberSet.has(edge.leftSourceRecordId) || memberSet.has(edge.rightSourceRecordId)
      )
      .sort((left, right) =>
        edgeKey(left.leftSourceRecordId, left.rightSourceRecordId).localeCompare(
          edgeKey(right.leftSourceRecordId, right.rightSourceRecordId),
          "en"
        )
      );
    const priorCanonicalListingIds = priorCanonicals
      .filter((canonical) => canonical.memberSourceRecordIds.some((id) => memberSet.has(id)))
      .map((canonical) => canonical.canonicalListingId)
      .sort();
    const reasonCodes = [
      members.length === 1 ? "singleton_component" : "automatic_connected_component",
      ...(appliedOverrideIds.length > 0 ? ["override_applied"] : []),
      ...(clusterBlockedEdges.length > 0 ? ["force_split_blocked_edge"] : [])
    ];
    return DuplicateClusterPlanSchema.parse({
      clusterId: stableEntityId("cluster", members),
      memberSourceRecordIds: members,
      linkedPairEvaluationIds,
      appliedOverrideIds,
      blockedEdges: clusterBlockedEdges,
      priorCanonicalListingIds,
      primarySourceRecordId: members[0],
      reasonCodes
    });
  });
}
