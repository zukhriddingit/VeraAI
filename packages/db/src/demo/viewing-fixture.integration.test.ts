import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_USER_ID,
  DEMO_VIEWING_ADDRESS_LINE_1,
  DEMO_VIEWING_ADDRESS_UNIT,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  prepareDemoViewingFixture,
  seedDatabase
} from "./index.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("demo viewing fixture preparation", () => {
  it("uses idempotent repository lifecycle transitions and records one safe audit event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "vera-demo-viewing-"));
    directories.push(directory);
    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      migrateDatabase(connection);
      seedDatabase(createSqliteRepositories(connection));
      const provider = createDemoRepositoryProvider(connection);

      await prepareDemoViewingFixture(provider);
      await prepareDemoViewingFixture(provider);

      const repositories = provider.forUser(DEMO_USER_ID);
      const listing = (await repositories.canonicalListings.list()).find(
        ({ address }) =>
          address.line1 === DEMO_VIEWING_ADDRESS_LINE_1 &&
          address.unit === DEMO_VIEWING_ADDRESS_UNIT
      );
      expect(listing).toMatchObject({ lifecycleState: "replied" });
      await expect(repositories.canonicalListings.getById("can-juniper-1a")).resolves.toMatchObject(
        { lifecycleState: "new" }
      );
      const events = await repositories.activityEvents.listByTarget(
        "canonical_listing",
        listing!.id
      );
      expect(events.filter(({ action }) => action === "demo.viewing_fixture.prepared")).toEqual([
        expect.objectContaining({
          actor: "system",
          policyDecision: "not_applicable",
          outcome: "succeeded",
          metadata: {
            fixtureVersion: 1,
            listingId: listing!.id,
            lifecycleState: "replied",
            networkAccess: false,
            sanitized: true
          }
        })
      ]);
      expect(JSON.stringify(events)).not.toContain("@example");
    } finally {
      connection.close();
    }
  });
});
