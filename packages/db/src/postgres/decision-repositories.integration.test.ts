import type { VeraUserId } from "@vera/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DEMO_SEARCH_PROFILE } from "../fixtures.ts";
import { createPostgresDecisionRepositories } from "./decision-repositories.ts";
import { createCorePostgresRepositories } from "./repositories.ts";
import { decisionJobAttempts, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const now = "2026-07-20T18:00:00.000Z";

describe("tenant-scoped PostgreSQL decision repositories", () => {
  it("increments revisions, leases safely, and preserves immutable attempts", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await db.insert(users).values({
        id: userId,
        name: "Decision Test",
        email: "decision@example.test",
        emailVerified: true
      });
      await createCorePostgresRepositories(db, userId).searchProfiles.insert(DEMO_SEARCH_PROFILE);
      const repositories = createPostgresDecisionRepositories(db, userId);

      await expect(
        repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now)
      ).resolves.toMatchObject({ revision: 0 });
      const first = await repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
        id: "decision-job-revision-1",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        trigger: "normalization",
        now
      });
      const replay = await repositories.decisionJobs.enqueueCurrentRevision({
        id: "decision-job-revision-1-replay",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        trigger: "seed",
        now
      });
      expect(first.targetCorpusRevision).toBe(1);
      expect(replay.id).toBe(first.id);

      const claimed = await repositories.decisionJobs.claimNext({
        leaseOwner: "worker-local-1",
        now,
        leaseExpiresAt: "2026-07-20T18:02:00.000Z"
      });
      expect(claimed).toMatchObject({ status: "running", attemptCount: 1 });
      const failed = await repositories.decisionJobs.fail({
        id: claimed!.id,
        leaseOwner: "worker-local-1",
        retryable: true,
        errorCode: "database_busy",
        errorMessage: "Decision persistence is temporarily busy.",
        failedAt: "2026-07-20T18:01:00.000Z",
        retryAt: "2026-07-20T18:03:00.000Z"
      });
      expect(failed.status).toBe("retryable_failed");
      const attempt = await repositories.decisionJobs.appendAttempt({
        id: "decision-attempt-lease-1",
        jobId: failed.id,
        attemptNumber: 1,
        startedAt: now,
        finishedAt: "2026-07-20T18:01:00.000Z",
        outcome: "retryable_failed",
        errorCode: "database_busy",
        durationMilliseconds: 60_000
      });
      await expect(repositories.decisionJobs.listAttempts(failed.id)).resolves.toEqual([attempt]);
      await expect(
        db
          .update(decisionJobAttempts)
          .set({ outcome: "cancelled" })
          .where(eq(decisionJobAttempts.id, attempt.id))
      ).rejects.toBeDefined();
      await expect(repositories.decisionJobs.listAttempts(failed.id)).resolves.toEqual([attempt]);
    });
  });

  it("records merge/split overrides as append-only events", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await db.insert(users).values({
        id: userId,
        name: "Override Test",
        email: "override@example.test",
        emailVerified: true
      });
      await createCorePostgresRepositories(db, userId).searchProfiles.insert(DEMO_SEARCH_PROFILE);
      const repositories = createPostgresDecisionRepositories(db, userId);
      const override = await repositories.duplicateOverrides.create({
        id: "override-force-split-1",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        kind: "force_split",
        sourceRecordIds: ["src-left", "src-right"],
        survivorCanonicalId: null,
        reason: "Sanitized reviewer correction.",
        createdBy: "user",
        createdAt: now
      });
      await expect(
        repositories.duplicateOverrides.listActive(DEMO_SEARCH_PROFILE.id)
      ).resolves.toEqual([override]);
      await repositories.duplicateOverrides.revoke({
        id: "override-revocation-1",
        overrideId: override.id,
        reason: "Sanitized correction withdrawn.",
        createdBy: "user",
        createdAt: "2026-07-20T18:01:00.000Z"
      });
      await expect(
        repositories.duplicateOverrides.listActive(DEMO_SEARCH_PROFILE.id)
      ).resolves.toEqual([]);
    });
  });
});
