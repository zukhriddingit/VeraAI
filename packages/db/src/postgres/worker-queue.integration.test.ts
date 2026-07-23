import type { VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import { createCorePostgresRepositories } from "./repositories.ts";
import { decisionJobs, normalizationJobs, sourceJobs, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";
import { createPostgresWorkerQueue } from "./worker-queue.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const now = "2026-07-20T12:00:00.000Z";
const leaseExpiresAt = "2026-07-20T12:01:00.000Z";

async function seedOwner(db: Parameters<typeof createCorePostgresRepositories>[0]) {
  await db.insert(users).values({
    id: userId,
    name: "Queue Test",
    email: "queue@example.test",
    emailVerified: true
  });
  const repositories = createCorePostgresRepositories(db, userId);
  await repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
  await repositories.rawListings.import(SOURCE_FIXTURES[0].capture);
}

describe("PostgreSQL system worker queue", () => {
  it("leases each normalization, decision, and source job to at most one claimer", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedOwner(db);
      await db.insert(normalizationJobs).values({
        userId,
        id: "normalize-one",
        rawListingId: SOURCE_FIXTURES[0].capture.id,
        idempotencyKey: "c".repeat(64),
        state: "queued",
        availableAt: new Date(now),
        attempts: 0,
        maxAttempts: 3,
        correlationId: "normalize-correlation",
        causationId: SOURCE_FIXTURES[0].capture.id,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await db.insert(decisionJobs).values({
        userId,
        id: "decision-one",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        targetCorpusRevision: 0,
        trigger: "seed",
        status: "queued",
        attemptCount: 0,
        availableAt: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await db.insert(sourceJobs).values({
        userId,
        id: "source-one",
        correlationId: "source-correlation",
        connectorId: "fixture.feed.v1",
        source: "other",
        acquisitionMode: "fixture",
        manifestVersion: 1,
        trigger: "manual",
        capability: "fixture.read",
        approvalId: null,
        operation: "fixture.read_sanitized",
        payload: { acquisitionMode: "fixture", fixtureSetId: "fixture-set" },
        payloadHash: "a".repeat(64),
        idempotencyKey: "b".repeat(64),
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        availableAt: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });

      const left = createPostgresWorkerQueue(connection);
      const right = createPostgresWorkerQueue(connection);
      const claimInput = { leaseOwner: "worker-a", now, leaseExpiresAt };

      for (const claim of [
        (queue: typeof left) => queue.claimNextNormalizationJob(claimInput),
        (queue: typeof left) => queue.claimNextDecisionJob(claimInput),
        (queue: typeof left) => queue.claimNextSourceJob(claimInput)
      ]) {
        const results = await Promise.all([claim(left), claim(right)]);
        expect(results.filter((result) => result !== null)).toHaveLength(1);
        expect(results.find((result) => result !== null)?.userId).toBe(userId);
      }
    });
  });

  it("reclaims an expired running source job without exceeding its attempt budget", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedOwner(db);
      await db.insert(sourceJobs).values({
        userId,
        id: "source-recoverable",
        correlationId: "source-recoverable-correlation",
        connectorId: "zillow.openclaw.current-tab.v1",
        source: "zillow",
        acquisitionMode: "local_browser",
        manifestVersion: 1,
        trigger: "manual",
        capability: "browser.capture",
        approvalId: null,
        operation: "capture.current_tab",
        payload: {
          acquisitionMode: "local_browser",
          captureKind: "current_tab",
          nodeId: "node-not-needed-for-queue-test",
          profileId: "profile-not-needed-for-queue-test",
          expectedUrl: "https://www.zillow.com/homedetails/Test/12345_zpid/",
          canonicalUrl: "https://www.zillow.com/homedetails/Test/12345_zpid/",
          limits: {
            maxPages: 1,
            maxRecords: 1,
            maxBytes: 250_000,
            maxDurationMilliseconds: 30_000,
            maxConcurrency: 1
          }
        },
        payloadHash: "d".repeat(64),
        idempotencyKey: "e".repeat(64),
        status: "running",
        attempts: 1,
        maxAttempts: 2,
        availableAt: new Date("2026-07-20T11:00:00.000Z"),
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date("2026-07-20T11:59:00.000Z"),
        createdAt: new Date("2026-07-20T11:00:00.000Z"),
        updatedAt: new Date("2026-07-20T11:00:00.000Z")
      });

      const queue = createPostgresWorkerQueue(connection);
      const recovered = await queue.claimNextSourceJob({
        leaseOwner: "replacement-worker",
        now,
        leaseExpiresAt
      });
      expect(recovered?.job).toMatchObject({
        id: "source-recoverable",
        status: "running",
        attempts: 2
      });

      const exhausted = await queue.claimNextSourceJob({
        leaseOwner: "another-worker",
        now: "2026-07-20T12:02:00.000Z",
        leaseExpiresAt: "2026-07-20T12:03:00.000Z"
      });
      expect(exhausted).toBeNull();
    });
  });
});
