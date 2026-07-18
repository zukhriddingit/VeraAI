import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANONICAL_FIXTURES,
  DUPLICATE_CLUSTER_FIXTURES,
  SOURCE_FIXTURES,
  normalizedFactEntries
} from "./fixtures.ts";
import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./index.ts";

let temporaryDirectory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-seed-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("sanitized fixture seed", () => {
  it("creates 12 source records, 8 canonical listings, and 3 duplicate clusters", () => {
    const result = seedDatabase(repositories);

    expect(result).toMatchObject({
      rawListings: 12,
      sourceRecords: 12,
      canonicalListings: 8,
      duplicateClusters: 3,
      sourceMemberships: 12,
      activityEvents: 1,
      searchProfiles: 1,
      listingScores: 8,
      riskSignals: 3
    });
    expect(repositories.canonicalListings.listSummaries()).toHaveLength(8);
    expect(
      repositories.canonicalListings.listSummaries().filter((listing) => listing.duplicateCount > 0)
    ).toHaveLength(3);
    expect(repositories.sourcePolicyManifests.listLatest()).toHaveLength(6);
    expect(
      repositories.sourcePolicyManifests.listLatest().map((manifest) => ({
        connectorId: manifest.connectorId,
        schemaVersion: manifest.schemaVersion,
        acquisitionMode: manifest.acquisitionMode,
        policyState: manifest.policyState
      }))
    ).toEqual([
      {
        connectorId: "fixture-label-apartments_com",
        schemaVersion: 2,
        acquisitionMode: "fixture",
        policyState: "disabled"
      },
      {
        connectorId: "fixture-label-craigslist",
        schemaVersion: 2,
        acquisitionMode: "fixture",
        policyState: "disabled"
      },
      {
        connectorId: "fixture-label-facebook_marketplace",
        schemaVersion: 2,
        acquisitionMode: "fixture",
        policyState: "disabled"
      },
      {
        connectorId: "fixture-label-zillow",
        schemaVersion: 2,
        acquisitionMode: "fixture",
        policyState: "disabled"
      },
      {
        connectorId: "fixture.feed.v1",
        schemaVersion: 2,
        acquisitionMode: "fixture",
        policyState: "approved"
      },
      {
        connectorId: "manual.capture.v1",
        schemaVersion: 2,
        acquisitionMode: "user_capture",
        policyState: "user_triggered_only"
      }
    ]);
    expect(
      repositories.sourcePolicyManifests
        .listLatest()
        .filter((manifest) => manifest.enabled)
        .map((manifest) => manifest.connectorId)
        .sort()
    ).toEqual(["fixture.feed.v1", "manual.capture.v1"]);
    expect(
      SOURCE_FIXTURES.every(
        (fixture) =>
          fixture.capture.acquisitionMode === "fixture" &&
          repositories.rawListings.getById(fixture.capture.id)?.acquisitionMode === "fixture"
      )
    ).toBe(true);
  });

  it("is idempotent without growing evidence, membership, provenance, or audit rows", () => {
    const first = seedDatabase(repositories);
    const second = seedDatabase(repositories);

    expect(second).toEqual(first);
    expect(second.rawListings).toBe(12);
    expect(second.sourceRecords).toBe(12);
    expect(second.canonicalListings).toBe(8);
    expect(second.activityEvents).toBe(1);
    expect(second.searchProfiles).toBe(1);
    expect(second.listingScores).toBe(8);
    expect(second.riskSignals).toBe(3);
  });

  it("seeds the sanitized profile, explainable scores, and evidence-backed risks", () => {
    seedDatabase(repositories);

    expect(repositories.searchProfiles.getById("profile-demo-harbor-city")).toMatchObject({
      minimumBedrooms: 1,
      targetMonthlyTotalCents: 260_000,
      absoluteMonthlyMaximumCents: 300_000,
      moveInEarliest: "2026-09-01",
      moveInLatest: "2026-09-30"
    });
    expect(repositories.listingScores.listByCanonicalListingId("can-juniper-1a")).toHaveLength(1);
    expect(repositories.riskSignals.listByCanonicalListingId("can-juniper-1a")).toHaveLength(3);
    expect(
      repositories.riskSignals
        .listByCanonicalListingId("can-juniper-1a")
        .every((signal) => signal.evidence.length > 0 && signal.verificationAction.length > 0)
    ).toBe(true);
  });

  it("preserves every source record and all cross-source duplicate members", () => {
    seedDatabase(repositories);

    const fixtureSourceIds = SOURCE_FIXTURES.map((fixture) => fixture.sourceRecord.id).sort();
    const persistedSourceIds = CANONICAL_FIXTURES.flatMap((fixture) =>
      repositories.sourceRecords
        .listByCanonicalListingId(fixture.listing.id)
        .map((record) => record.id)
    ).sort();

    expect(persistedSourceIds).toEqual(fixtureSourceIds);

    for (const clusterFixture of DUPLICATE_CLUSTER_FIXTURES) {
      const cluster = repositories.duplicateClusters.getById(clusterFixture.id);
      expect(cluster?.memberSourceRecordIds).toEqual(
        [...clusterFixture.memberSourceRecordIds].sort()
      );
      const labels = new Set(
        cluster?.memberSourceRecordIds.map(
          (id) =>
            SOURCE_FIXTURES.find((fixture) => fixture.sourceRecord.id === id)?.sourceRecord.source
        )
      );
      expect(labels.size).toBeGreaterThan(1);
    }
  });

  it("records provenance for every non-null source and canonical fact", () => {
    const result = seedDatabase(repositories);
    let expectedSourceProvenance = 0;
    let expectedCanonicalSelections = 0;

    for (const fixture of SOURCE_FIXTURES) {
      const expectedPaths = normalizedFactEntries(fixture.sourceRecord)
        .map(([fieldPath]) => fieldPath)
        .sort();
      const actualPaths = repositories.fieldProvenance
        .listBySourceRecordId(fixture.sourceRecord.id)
        .map((provenance) => provenance.fieldPath)
        .sort();

      expectedSourceProvenance += expectedPaths.length;
      expect(actualPaths).toEqual(expectedPaths);
      expect(
        repositories.fieldProvenance
          .listBySourceRecordId(fixture.sourceRecord.id)
          .every(
            (provenance) => provenance.valueStatus === "known" && provenance.unknownReason === null
          )
      ).toBe(true);
    }

    for (const fixture of CANONICAL_FIXTURES) {
      expectedCanonicalSelections += normalizedFactEntries(fixture.listing).length;
    }

    expect(result.fieldProvenance).toBe(expectedSourceProvenance);
    expect(result.canonicalFieldSelections).toBe(expectedCanonicalSelections);
  });

  it("covers all four labels and retains explicit incomplete facts", () => {
    seedDatabase(repositories);
    const summaries = repositories.canonicalListings.listSummaries();
    const sourceLabels = new Set(summaries.flatMap((listing) => listing.sourceLabels));

    expect(sourceLabels).toEqual(
      new Set(["zillow", "facebook_marketplace", "craigslist", "apartments_com"])
    );
    expect(summaries.some((listing) => listing.unknownFields.length > 0)).toBe(true);
  });

  it("contains only inert fixture URLs and no contact-shaped values", () => {
    const serialized = JSON.stringify(SOURCE_FIXTURES);
    const contactCandidateText = SOURCE_FIXTURES.flatMap((fixture) => [
      fixture.capture.rawText ?? "",
      fixture.sourceRecord.title,
      fixture.sourceRecord.address.line1 ?? "",
      fixture.sourceRecord.address.unit ?? "",
      fixture.sourceRecord.address.city ?? "",
      fixture.sourceRecord.description ?? ""
    ]).join("\n");

    expect(
      SOURCE_FIXTURES.every((fixture) =>
        fixture.capture.sourceUrl?.startsWith("https://example.invalid/")
      )
    ).toBe(true);
    expect(contactCandidateText).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
    expect(contactCandidateText).not.toMatch(/\+?\d[\d ()-]{8,}\d/u);
    expect(serialized).not.toContain("zillow.com");
    expect(serialized).not.toContain("facebook.com");
    expect(serialized).not.toContain("craigslist.org");
    expect(serialized).not.toContain("apartments.com");
  });
});
