import { describe, expect, it } from "vitest";

import type { DuplicateClusterPlan, NormalizedDecisionSource } from "@vera/domain";

import type { CanonicalIdentityAssignment } from "./identity.ts";
import { stitchCanonicalListing } from "./stitch.ts";

const older = "2026-07-20T17:00:00.000Z";
const newer = "2026-07-20T18:00:00.000Z";

function source(
  id: string,
  value: number,
  overrides: Partial<NormalizedDecisionSource> = {}
): NormalizedDecisionSource {
  return {
    sourceRecordId: id,
    rawListingId: `raw-${id}`,
    source: id === "source-a" ? "zillow" : "craigslist",
    connectorId: id === "source-a" ? "official.v1" : "manual.v1",
    acquisitionMode: id === "source-a" ? "official_api" : "user_capture",
    sourceListingId: id,
    acquiredAt: older,
    observedAt: older,
    postedAt: null,
    title: "Synthetic listing",
    normalizedAddress: "12 n main st",
    normalizedUnit: "4b",
    normalizedCity: "boston",
    normalizedRegion: "MA",
    normalizedPostalCode: "02110",
    normalizedCountryCode: "US",
    addressMatchKey: "12 n main st|4b|boston|MA|02110|US",
    latitude: null,
    longitude: null,
    canonicalUrl: null,
    rentCents: value,
    requiredRecurringFeeCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    availableOn: null,
    descriptionText: "Synthetic text.",
    extractionConfidenceBasisPoints: 9_000,
    completenessBasisPoints: 8_000,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [
      {
        fieldPath: "monthlyRentCents",
        fieldProvenanceId: `provenance-${id}`,
        sourceRecordId: id,
        extractionMethod: "rule",
        valueStatus: "known",
        value,
        confidenceBasisPoints: 9_000,
        observedAt: older
      }
    ],
    normalizationReasonCodes: ["address_normalized"],
    ...overrides
  };
}

const cluster: DuplicateClusterPlan = {
  clusterId: "cluster-a",
  memberSourceRecordIds: ["source-a", "source-b"],
  linkedPairEvaluationIds: [],
  appliedOverrideIds: [],
  blockedEdges: [],
  priorCanonicalListingIds: [],
  primarySourceRecordId: "source-a",
  reasonCodes: ["test_component"]
};

const identity: CanonicalIdentityAssignment = {
  clusterId: "cluster-a",
  canonicalListingId: "canonical-a",
  priorCanonicalListingIds: [],
  lifecycleState: "new",
  createdAt: older,
  identityReasonCode: "new_canonical"
};

describe("provenance-preserving canonical stitching", () => {
  it("selects fields by configured acquisition trust rather than source brand", () => {
    const plan = stitchCanonicalListing({
      cluster,
      identity,
      sources: [source("source-b", 250_000), source("source-a", 245_000)]
    });
    expect(plan.selectedFields[0]).toMatchObject({
      value: 245_000,
      selectedSourceRecordId: "source-a",
      selectedFieldProvenanceId: "provenance-source-a"
    });
  });

  it("selects the primary by freshness before completeness and trust", () => {
    const plan = stitchCanonicalListing({
      cluster,
      identity,
      sources: [
        source("source-a", 245_000, { completenessBasisPoints: 10_000 }),
        source("source-b", 250_000, { observedAt: newer, completenessBasisPoints: 7_000 })
      ]
    });
    expect(plan.primarySourceRecordId).toBe("source-b");
    expect(plan.freshestObservedAt).toBe(newer);
  });

  it("preserves unknown when every candidate is unknown", () => {
    const unknownSource = source("source-a", 245_000, {
      fieldCandidates: [
        {
          fieldPath: "petPolicy",
          fieldProvenanceId: "provenance-pets-unknown",
          sourceRecordId: "source-a",
          extractionMethod: "rule",
          valueStatus: "unknown",
          value: null,
          confidenceBasisPoints: 0,
          observedAt: older
        }
      ]
    });
    const plan = stitchCanonicalListing({
      cluster: { ...cluster, memberSourceRecordIds: ["source-a"] },
      identity,
      sources: [unknownSource]
    });
    expect(plan.selectedFields).toEqual([
      {
        fieldPath: "petPolicy",
        valueStatus: "unknown",
        value: null,
        selectedFieldProvenanceId: null,
        selectedSourceRecordId: null,
        reasonCodes: ["all_candidates_unknown"]
      }
    ]);
  });

  it("is deterministic across source ordering", () => {
    const sources = [source("source-a", 245_000), source("source-b", 250_000)];
    expect(stitchCanonicalListing({ cluster, identity, sources })).toEqual(
      stitchCanonicalListing({ cluster, identity, sources: [...sources].reverse() })
    );
  });
});
