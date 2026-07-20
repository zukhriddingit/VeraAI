import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { planCanonicalReconciliation } from "./plan.ts";

const now = "2026-07-20T18:00:00.000Z";

function source(id: string): NormalizedDecisionSource {
  return {
    sourceRecordId: id,
    rawListingId: `raw-${id}`,
    source: "other",
    connectorId: "fixture.v1",
    acquisitionMode: "fixture",
    sourceListingId: id,
    acquiredAt: now,
    observedAt: now,
    postedAt: null,
    title: "Synthetic listing",
    normalizedAddress: null,
    normalizedUnit: null,
    normalizedCity: null,
    normalizedRegion: null,
    normalizedPostalCode: null,
    normalizedCountryCode: null,
    addressMatchKey: null,
    latitude: null,
    longitude: null,
    canonicalUrl: null,
    rentCents: null,
    requiredRecurringFeeCents: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    availableOn: null,
    descriptionText: "",
    extractionConfidenceBasisPoints: 0,
    completenessBasisPoints: 0,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["field_unknown"]
  };
}

describe("canonical reconciliation composition", () => {
  it("produces one stable singleton canonical per source", () => {
    const plan = planCanonicalReconciliation({
      sources: [source("source-b"), source("source-a")],
      pairEvaluations: [],
      activeOverrides: [],
      priorCanonicals: [],
      createdAt: now
    });

    expect(plan.clusterPlans).toHaveLength(2);
    expect(plan.canonicalPlans).toHaveLength(2);
    expect(plan.canonicalPlans.every((canonical) => canonical.clusterId === null)).toBe(true);
    expect(plan.clusterPlans.map((cluster) => cluster.primarySourceRecordId)).toEqual([
      "source-a",
      "source-b"
    ]);
  });
});
