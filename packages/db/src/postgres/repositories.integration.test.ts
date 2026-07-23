import type { VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { sha256Text } from "../hashing.ts";
import { CANONICAL_FIXTURES, DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import {
  createCorePostgresRepositories,
  createPostgresRepositoryProvider
} from "./repositories.ts";
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

  it("rolls back an entire user-scoped unit of work", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await insertUsers(db);
      const provider = createPostgresRepositoryProvider(connection);
      const fixture = SOURCE_FIXTURES[0];

      await expect(
        provider.transaction(aliceId, async (repositories) => {
          await repositories.rawListings.import(fixture.capture);
          await repositories.activityEvents.append({
            id: "event-rollback",
            correlationId: "correlation-rollback",
            causationId: null,
            actor: "system",
            action: "transaction.rollback.test",
            targetType: "raw_listing",
            targetId: fixture.capture.id,
            policyDecision: "authorized",
            approvalId: "missing-approval",
            payloadHash: sha256Text("rollback"),
            outcome: "succeeded",
            errorCategory: null,
            metadata: { sanitized: true },
            occurredAt: fixture.capture.observedAt
          });
        })
      ).rejects.toMatchObject({ category: "ownership_violation" });

      await expect(provider.forUser(aliceId).rawListings.count()).resolves.toBe(0);
      await expect(provider.forUser(aliceId).activityEvents.count()).resolves.toBe(0);
    });
  });

  it("serializes concurrent lifecycle updates without duplicating audit events", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await insertUsers(db);
      const provider = createPostgresRepositoryProvider(connection);
      const repositories = provider.forUser(aliceId);
      const sourceFixture = SOURCE_FIXTURES[7];
      const canonicalFixture = CANONICAL_FIXTURES[3];
      const transitionedAt = "2026-07-17T12:30:00.000Z";

      await repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
      await repositories.rawListings.import(sourceFixture.capture);
      await repositories.sourceRecords.insert(sourceFixture.sourceRecord);
      await repositories.canonicalListings.insert(canonicalFixture.listing);

      const attempts = await Promise.allSettled(
        ["event-concurrent-shortlist-a", "event-concurrent-shortlist-b"].map((eventId) =>
          provider.transaction(aliceId, async (transactionRepositories) => {
            const listing = await transactionRepositories.canonicalListings.transitionLifecycle(
              canonicalFixture.listing.id,
              "shortlisted",
              transitionedAt
            );
            await transactionRepositories.activityEvents.append({
              id: eventId,
              correlationId: `correlation-${eventId}`,
              causationId: null,
              actor: "user",
              action: "listing.shortlisted",
              targetType: "canonical_listing",
              targetId: canonicalFixture.listing.id,
              policyDecision: "not_applicable",
              approvalId: null,
              payloadHash: sha256Text(`shortlist:${canonicalFixture.listing.id}`),
              outcome: "succeeded",
              errorCategory: null,
              metadata: { lifecycleState: "shortlisted" },
              occurredAt: transitionedAt
            });
            return listing;
          })
        )
      );

      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
      await expect(
        repositories.canonicalListings.getById(canonicalFixture.listing.id)
      ).resolves.toMatchObject({ lifecycleState: "shortlisted" });
      await expect(repositories.activityEvents.count()).resolves.toBe(1);
    });
  });
});
