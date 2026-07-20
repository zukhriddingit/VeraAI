import { describe, expect, it } from "vitest";

import type { DuplicateOverride, DuplicatePairEvaluation } from "@vera/domain";

import { clusterDuplicateSources } from "./cluster.ts";

const now = "2026-07-20T18:00:00.000Z";

function pair(left: string, right: string, score = 8_000): DuplicatePairEvaluation {
  return {
    id: `pair-${left}-${right}`,
    leftSourceRecordId: left,
    rightSourceRecordId: right,
    algorithmVersion: "listing-dedupe.v1",
    inputHash: "a".repeat(64),
    decision: "link",
    scoreBasisPoints: score,
    automaticLinkThresholdBasisPoints: 7_500,
    reviewThresholdBasisPoints: 6_000,
    exactReasonCodes: [],
    conflictReasonCodes: [],
    contactMatched: false,
    features: [],
    evaluatedAt: now
  };
}

function split(left: string, right: string): DuplicateOverride {
  return {
    id: `split-${left}-${right}`,
    searchProfileId: "profile-primary",
    kind: "force_split",
    sourceRecordIds: [left, right],
    survivorCanonicalId: null,
    reason: "Reviewed as separate properties.",
    createdBy: "user",
    createdAt: now
  };
}

describe("override-aware connected components", () => {
  it("forms transitive components from link decisions", () => {
    const clusters = clusterDuplicateSources({
      sourceRecordIds: ["a", "b", "c"],
      pairEvaluations: [pair("a", "b"), pair("b", "c")],
      activeOverrides: []
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.memberSourceRecordIds).toEqual(["a", "b", "c"]);
  });

  it("prevents transitive union across a force-split cannot-link", () => {
    const clusters = clusterDuplicateSources({
      sourceRecordIds: ["a", "b", "c"],
      pairEvaluations: [pair("a", "b", 9_000), pair("b", "c", 8_000)],
      activeOverrides: [split("a", "c")]
    });

    expect(clusters.map((cluster) => cluster.memberSourceRecordIds)).toEqual([["a", "b"], ["c"]]);
    expect(clusters.flatMap((cluster) => cluster.blockedEdges)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "blocked_by_force_split", overrideId: "split-a-c" })
      ])
    );
  });

  it("applies force-merge edges before automatic edges", () => {
    const merge: DuplicateOverride = {
      id: "merge-a-c",
      searchProfileId: "profile-primary",
      kind: "force_merge",
      sourceRecordIds: ["a", "c"],
      survivorCanonicalId: "canonical-a",
      reason: "Reviewed duplicate.",
      createdBy: "user",
      createdAt: now
    };
    expect(
      clusterDuplicateSources({
        sourceRecordIds: ["a", "b", "c"],
        pairEvaluations: [],
        activeOverrides: [merge]
      }).map((cluster) => cluster.memberSourceRecordIds)
    ).toEqual([["a", "c"], ["b"]]);
  });

  it("is deterministic across shuffled inputs", () => {
    const input = {
      sourceRecordIds: ["c", "a", "b"],
      pairEvaluations: [pair("b", "c"), pair("a", "b")],
      activeOverrides: []
    };
    expect(clusterDuplicateSources(input)).toEqual(
      clusterDuplicateSources({
        ...input,
        sourceRecordIds: [...input.sourceRecordIds].reverse(),
        pairEvaluations: [...input.pairEvaluations].reverse()
      })
    );
  });
});
