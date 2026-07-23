import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import type { UserRepositories, UserRepositoryProvider, VeraRepositories } from "@vera/db";
import { InvalidListingTransitionError } from "@vera/domain";

import { dismissListing, getListingDetail, setListingShortlist } from "./listing-presentation.ts";

let directory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;
let asyncRepositories: UserRepositories;
let repositoryProvider: UserRepositoryProvider;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-listing-detail-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  repositoryProvider = createDemoRepositoryProvider(connection);
  asyncRepositories = repositoryProvider.forUser(DEMO_USER_ID);
  seedDatabase(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("listing presentation", () => {
  it("projects duplicate sources, provenance, fit, and evidence-backed risk", async () => {
    const detail = await getListingDetail(asyncRepositories, "can-juniper-1a");

    expect(detail?.sources).toHaveLength(3);
    expect(detail?.sources.every((source) => source.provenance.length > 0)).toBe(true);
    expect(detail?.duplicateExplanation).toContain("Same normalized address and unit");
    expect(detail?.duplicateExplanation).toContain("Zillow");
    expect(detail?.score?.factors).toHaveLength(4);
    expect(detail?.risks).toHaveLength(3);
    expect(detail?.fieldSources.length).toBeGreaterThan(0);
    const incompleteSummary = repositories.canonicalListings
      .listSummaries()
      .find(({ unknownFields }) => unknownFields.length > 0);
    expect(incompleteSummary).toBeDefined();
    const incompleteDetail = await getListingDetail(asyncRepositories, incompleteSummary!.id);
    expect(incompleteDetail?.missingInformation).toHaveLength(
      incompleteSummary!.unknownFields.length
    );
    expect(
      incompleteDetail?.missingInformation.every(
        ({ verificationQuestion }) => verificationQuestion.length > 0
      )
    ).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
  });

  it("persists reversible shortlist decisions through domain transitions", async () => {
    let id = 0;
    const dependencies = {
      userId: DEMO_USER_ID,
      repositoryProvider,
      now: () => new Date("2026-07-17T12:40:00.000Z"),
      createId: () => `shortlist-id-${String(++id)}`
    };

    expect((await setListingShortlist("can-juniper-1a", true, dependencies)).shortlisted).toBe(
      true
    );
    expect(repositories.canonicalListings.getById("can-juniper-1a")?.lifecycleState).toBe(
      "shortlisted"
    );
    expect((await setListingShortlist("can-juniper-1a", false, dependencies)).shortlisted).toBe(
      false
    );
    expect(repositories.canonicalListings.getById("can-juniper-1a")?.lifecycleState).toBe("new");
    expect(
      repositories.activityEvents.listByTarget("canonical_listing", "can-juniper-1a")
    ).toHaveLength(2);
  });

  it("rejects repeated target state without appending success", async () => {
    const count = repositories.activityEvents.count();

    await expect(
      setListingShortlist("can-juniper-1a", false, {
        userId: DEMO_USER_ID,
        repositoryProvider,
        now: () => new Date("2026-07-17T12:40:00.000Z"),
        createId: () => "unused-id"
      })
    ).rejects.toThrow(InvalidListingTransitionError);
    expect(repositories.activityEvents.count()).toBe(count);
  });

  it("persists a terminal dismissal and its audit event atomically", async () => {
    let id = 0;
    const result = await dismissListing("can-cedar-flat", {
      userId: DEMO_USER_ID,
      repositoryProvider,
      now: () => new Date("2026-07-17T12:45:00.000Z"),
      createId: () => `dismiss-id-${String(++id)}`
    });

    expect(result.lifecycleState).toBe("dismissed");
    expect(repositories.canonicalListings.getById("can-cedar-flat")?.lifecycleState).toBe(
      "dismissed"
    );
    expect(
      repositories.activityEvents
        .listByTarget("canonical_listing", "can-cedar-flat")
        .map(({ action }) => action)
    ).toContain("listing.dismissed");
  });
});
