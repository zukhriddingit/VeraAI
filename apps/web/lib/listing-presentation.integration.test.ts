import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "@vera/db";
import { InvalidListingTransitionError } from "@vera/domain";

import { getListingDetail, setListingShortlist } from "./listing-presentation.ts";

let directory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-listing-detail-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  seedDatabase(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("listing presentation", () => {
  it("projects duplicate sources, provenance, fit, and evidence-backed risk", () => {
    const detail = getListingDetail(repositories, "can-juniper-1a");

    expect(detail?.sources).toHaveLength(3);
    expect(detail?.sources.every((source) => source.provenance.length > 0)).toBe(true);
    expect(detail?.duplicateExplanation).toContain("Same normalized address and unit");
    expect(detail?.duplicateExplanation).toContain("Zillow");
    expect(detail?.score?.factors).toHaveLength(4);
    expect(detail?.risks).toHaveLength(3);
    expect(JSON.stringify(detail)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
  });

  it("persists reversible shortlist decisions through domain transitions", () => {
    let id = 0;
    const dependencies = {
      repositories,
      now: () => new Date("2026-07-17T12:40:00.000Z"),
      createId: () => `shortlist-id-${String(++id)}`
    };

    expect(setListingShortlist("can-juniper-1a", true, dependencies).shortlisted).toBe(true);
    expect(repositories.canonicalListings.getById("can-juniper-1a")?.lifecycleState).toBe(
      "shortlisted"
    );
    expect(setListingShortlist("can-juniper-1a", false, dependencies).shortlisted).toBe(false);
    expect(repositories.canonicalListings.getById("can-juniper-1a")?.lifecycleState).toBe("new");
    expect(
      repositories.activityEvents.listByTarget("canonical_listing", "can-juniper-1a")
    ).toHaveLength(2);
  });

  it("rejects repeated target state without appending success", () => {
    const count = repositories.activityEvents.count();

    expect(() =>
      setListingShortlist("can-juniper-1a", false, {
        repositories,
        now: () => new Date("2026-07-17T12:40:00.000Z"),
        createId: () => "unused-id"
      })
    ).toThrow(InvalidListingTransitionError);
    expect(repositories.activityEvents.count()).toBe(count);
  });
});
