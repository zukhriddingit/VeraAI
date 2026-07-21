import type { VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import { createCorePostgresRepositories } from "./repositories.ts";
import { users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;

async function insertUsers(db: Parameters<typeof createCorePostgresRepositories>[0]) {
  await db.insert(users).values([
    {
      id: aliceId,
      name: "Alice Test",
      email: "alice@example.test",
      emailVerified: true
    },
    {
      id: bobId,
      name: "Bob Test",
      email: "bob@example.test",
      emailVerified: true
    }
  ]);
}

describe("tenant-scoped PostgreSQL core repositories", () => {
  it("allows identical deterministic IDs while isolating users", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await insertUsers(db);
      const alice = createCorePostgresRepositories(db, aliceId);
      const bob = createCorePostgresRepositories(db, bobId);

      await alice.searchProfiles.insert(DEMO_SEARCH_PROFILE);
      await bob.searchProfiles.insert({ ...DEMO_SEARCH_PROFILE, name: "Bob's private search" });

      await expect(alice.searchProfiles.list()).resolves.toEqual([DEMO_SEARCH_PROFILE]);
      await expect(bob.searchProfiles.getById(DEMO_SEARCH_PROFILE.id)).resolves.toMatchObject({
        id: DEMO_SEARCH_PROFILE.id,
        name: "Bob's private search"
      });
      await expect(alice.searchProfiles.count()).resolves.toBe(1);
      await expect(bob.searchProfiles.count()).resolves.toBe(1);
    });
  });

  it("imports raw evidence idempotently per user", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await insertUsers(db);
      const alice = createCorePostgresRepositories(db, aliceId);
      const capture = SOURCE_FIXTURES[0].capture;

      await expect(alice.rawListings.import(capture)).resolves.toMatchObject({ inserted: true });
      await expect(alice.rawListings.import(capture)).resolves.toMatchObject({ inserted: false });
      await expect(alice.rawListings.count()).resolves.toBe(1);
    });
  });

  it("rejects a child linked to another user's parent", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await insertUsers(db);
      const alice = createCorePostgresRepositories(db, aliceId);
      const bob = createCorePostgresRepositories(db, bobId);
      const fixture = SOURCE_FIXTURES[0];

      await alice.rawListings.import(fixture.capture);
      await expect(bob.sourceRecords.insert(fixture.sourceRecord)).rejects.toMatchObject({
        category: "ownership_violation",
        retryable: false
      });
      await expect(bob.rawListings.getById(fixture.capture.id)).resolves.toBeNull();
    });
  });

  it("round-trips timestamptz values as the same ISO instant", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await insertUsers(db);
      const repositories = createCorePostgresRepositories(db, aliceId);
      const inserted = await repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);

      expect(inserted.createdAt).toBe(DEMO_SEARCH_PROFILE.createdAt);
      await expect(repositories.searchProfiles.getById(inserted.id)).resolves.toEqual(inserted);
    });
  });
});
