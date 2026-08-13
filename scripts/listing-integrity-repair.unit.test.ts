import { describe, expect, it } from "vitest";

import type { DecisionCorpusSnapshot } from "@vera/domain";

import {
  assertPredictedRelationships,
  computeRepairCorpusHash,
  filterDecisionSnapshot
} from "./listing-integrity-repair-lib.ts";

const snapshot = {
  searchProfile: {
    id: "profile-1",
    name: "Repair profile",
    version: 1,
    locationText: "Boston, MA",
    centerLatitude: null,
    centerLongitude: null,
    radiusKilometers: null,
    minimumBedrooms: null,
    minimumBathrooms: null,
    targetMonthlyTotalCents: null,
    absoluteMonthlyMaximumCents: null,
    moveInEarliest: null,
    moveInLatest: null,
    petRequirements: [],
    commuteAnchors: [],
    hardConstraints: [],
    weightedPreferences: [],
    notificationRules: { enabled: false, minimumScoreBasisPoints: null },
    createdAt: "2026-08-13T12:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z"
  },
  corpusRevision: 9,
  sourceRecords: ["source-a", "source-b", "source-invalid"].map((sourceRecordId) => ({
    sourceRecordId,
    rawListingId: `raw-${sourceRecordId}`,
    source: "other",
    connectorId: "fixture.official-api.v1",
    acquisitionMode: "fixture",
    sourceListingId: sourceRecordId,
    acquiredAt: "2026-08-13T12:00:00.000Z",
    observedAt: "2026-08-13T12:00:00.000Z",
    postedAt: null,
    title: sourceRecordId,
    normalizedAddress: sourceRecordId === "source-invalid" ? null : "12 main st",
    normalizedUnit: null,
    normalizedCity: "boston",
    normalizedRegion: "MA",
    normalizedPostalCode: null,
    normalizedCountryCode: "US",
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
    extractionConfidenceBasisPoints: 5000,
    completenessBasisPoints: 1000,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["field_unknown"]
  })),
  activeOverrides: [],
  priorCanonicals: [
    {
      canonicalListingId: "canonical-a",
      memberSourceRecordIds: ["source-a", "source-invalid"],
      primarySourceRecordId: "source-invalid",
      lifecycleState: "new",
      createdAt: "2026-08-13T12:00:00.000Z"
    }
  ]
} as DecisionCorpusSnapshot;

describe("listing integrity repair planning", () => {
  it("filters only explicit invalid records and chooses an accepted effective primary", () => {
    const filtered = filterDecisionSnapshot(snapshot, ["source-invalid"]);
    expect(filtered.sourceRecords.map(({ sourceRecordId }) => sourceRecordId)).toEqual([
      "source-a",
      "source-b"
    ]);
    expect(filtered.priorCanonicals).toEqual([
      expect.objectContaining({
        memberSourceRecordIds: ["source-a"],
        primarySourceRecordId: "source-a"
      })
    ]);
    expect(snapshot.sourceRecords).toHaveLength(3);
  });

  it("hashes disposition state and validates predicted split/join assertions", () => {
    expect(computeRepairCorpusHash(snapshot, [])).toMatch(/^[a-f0-9]{64}$/u);
    const predicted = [
      { canonicalListingId: "canonical-a", memberSourceRecordIds: ["source-a", "source-b"] },
      { canonicalListingId: "canonical-c", memberSourceRecordIds: ["source-c"] }
    ];
    expect(() =>
      assertPredictedRelationships(predicted, {
        searchProfileId: "profile-1",
        invalidSourceRecordIds: ["source-invalid"],
        assertSeparatedPairs: [["source-a", "source-c"]],
        assertJoinedGroups: [["source-a", "source-b"]]
      })
    ).not.toThrow();
  });
});
