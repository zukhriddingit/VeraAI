import { describe, expect, it } from "vitest";

import type { DuplicateClusterPlan, DuplicateOverride, PriorCanonicalIdentity } from "@vera/domain";

import { assignCanonicalIdentities } from "./identity.ts";

const now = "2026-07-20T18:00:00.000Z";

function cluster(id: string, members: string[]): DuplicateClusterPlan {
  return {
    clusterId: id,
    memberSourceRecordIds: [...members].sort(),
    linkedPairEvaluationIds: [],
    appliedOverrideIds: [],
    blockedEdges: [],
    priorCanonicalListingIds: [],
    primarySourceRecordId: [...members].sort()[0]!,
    reasonCodes: ["test_component"]
  };
}

function prior(
  id: string,
  members: string[],
  primary: string,
  createdAt = now
): PriorCanonicalIdentity {
  return {
    canonicalListingId: id,
    memberSourceRecordIds: [...members].sort(),
    primarySourceRecordId: primary,
    lifecycleState: "shortlisted",
    createdAt
  };
}

describe("stable canonical identity", () => {
  it("assigns deterministic IDs to new components", () => {
    const first = assignCanonicalIdentities({
      clusters: [cluster("cluster-a", ["source-b", "source-a"])],
      priorCanonicals: [],
      activeOverrides: [],
      createdAt: now
    });
    const second = assignCanonicalIdentities({
      clusters: [cluster("cluster-a", ["source-a", "source-b"])],
      priorCanonicals: [],
      activeOverrides: [],
      createdAt: now
    });
    expect(first).toEqual(second);
    expect(first.assignments[0]?.canonicalListingId).toMatch(/^canonical:[a-f0-9]{32}$/u);
  });

  it("preserves an unchanged canonical lifecycle and identity", () => {
    const existing = prior("canonical-a", ["source-a"], "source-a");
    expect(
      assignCanonicalIdentities({
        clusters: [cluster("cluster-a", ["source-a", "source-b"])],
        priorCanonicals: [existing],
        activeOverrides: [],
        createdAt: now
      }).assignments[0]
    ).toMatchObject({
      canonicalListingId: "canonical-a",
      lifecycleState: "shortlisted",
      identityReasonCode: "preserved_canonical"
    });
  });

  it("preserves the old ID only in the split component containing the old primary", () => {
    const plan = assignCanonicalIdentities({
      clusters: [cluster("cluster-a", ["source-a"]), cluster("cluster-b", ["source-b"])],
      priorCanonicals: [prior("canonical-old", ["source-a", "source-b"], "source-b")],
      activeOverrides: [],
      createdAt: now
    });

    expect(plan.assignments.find(({ clusterId }) => clusterId === "cluster-b")).toMatchObject({
      canonicalListingId: "canonical-old",
      identityReasonCode: "split_primary_preserved"
    });
    expect(
      plan.assignments.find(({ clusterId }) => clusterId === "cluster-a")?.canonicalListingId
    ).not.toBe("canonical-old");
    expect(plan.supersessions).toEqual([]);
  });

  it("uses an explicit merge survivor and supersedes the loser", () => {
    const merge: DuplicateOverride = {
      id: "override-merge",
      searchProfileId: "profile-primary",
      kind: "force_merge",
      sourceRecordIds: ["source-a", "source-b"],
      survivorCanonicalId: "canonical-b",
      reason: "Reviewed duplicate.",
      createdBy: "user",
      createdAt: now
    };
    const plan = assignCanonicalIdentities({
      clusters: [cluster("cluster-merged", ["source-a", "source-b"])],
      priorCanonicals: [
        prior("canonical-a", ["source-a"], "source-a", "2026-01-01T00:00:00.000Z"),
        prior("canonical-b", ["source-b"], "source-b", "2026-02-01T00:00:00.000Z")
      ],
      activeOverrides: [merge],
      createdAt: now
    });

    expect(plan.assignments[0]).toMatchObject({
      canonicalListingId: "canonical-b",
      identityReasonCode: "merge_override_survivor"
    });
    expect(plan.supersessions).toEqual([
      {
        supersededCanonicalListingId: "canonical-a",
        survivorCanonicalListingId: "canonical-b",
        reasonCode: "cluster_merge"
      }
    ]);
  });

  it("uses the oldest touched canonical when no override selects a survivor", () => {
    const plan = assignCanonicalIdentities({
      clusters: [cluster("cluster-merged", ["source-a", "source-b"])],
      priorCanonicals: [
        prior("canonical-newer", ["source-a"], "source-a", "2026-02-01T00:00:00.000Z"),
        prior("canonical-older", ["source-b"], "source-b", "2026-01-01T00:00:00.000Z")
      ],
      activeOverrides: [],
      createdAt: now
    });
    expect(plan.assignments[0]?.canonicalListingId).toBe("canonical-older");
  });
});
