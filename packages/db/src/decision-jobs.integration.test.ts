import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_SEARCH_PROFILE } from "./fixtures.ts";
import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./index.ts";

const now = "2026-07-20T18:00:00.000Z";
let temporaryDirectory = "";
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-decision-jobs-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  seedDatabase(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("decision queue and append-only override repositories", () => {
  it("increments revisions monotonically and enqueues one idempotent job per profile revision", () => {
    expect(repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now).revision).toBe(
      0
    );
    const first = repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
      id: "decision-job-revision-1",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "normalization",
      now
    });
    const replay = repositories.decisionJobs.enqueueCurrentRevision({
      id: "decision-job-revision-1-replay",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "seed",
      now
    });
    const second = repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
      id: "decision-job-revision-2",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "manual_recompute",
      now: "2026-07-20T18:01:00.000Z"
    });

    expect(first.targetCorpusRevision).toBe(1);
    expect(replay.id).toBe(first.id);
    expect(second.targetCorpusRevision).toBe(2);
    expect(repositories.decisionJobs.getCorpusState(DEMO_SEARCH_PROFILE.id)?.revision).toBe(2);
    expect(repositories.decisionJobs.list()).toHaveLength(2);
  });

  it("claims with a lease, records typed failure, and preserves immutable attempts", () => {
    repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
      id: "decision-job-lease",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "normalization",
      now
    });
    const claimed = repositories.decisionJobs.claimNext({
      leaseOwner: "worker-local-1",
      now,
      leaseExpiresAt: "2026-07-20T18:02:00.000Z"
    });
    expect(claimed).toMatchObject({ status: "running", attemptCount: 1 });
    const failed = repositories.decisionJobs.fail({
      id: claimed!.id,
      leaseOwner: "worker-local-1",
      retryable: true,
      errorCode: "database_busy",
      errorMessage: "Decision persistence is temporarily busy.",
      failedAt: "2026-07-20T18:01:00.000Z",
      retryAt: "2026-07-20T18:03:00.000Z"
    });
    expect(failed).toMatchObject({ status: "retryable_failed", errorCode: "database_busy" });
    const attempt = repositories.decisionJobs.appendAttempt({
      id: "decision-attempt-lease-1",
      jobId: failed.id,
      attemptNumber: 1,
      startedAt: now,
      finishedAt: "2026-07-20T18:01:00.000Z",
      outcome: "retryable_failed",
      errorCode: "database_busy",
      durationMilliseconds: 60_000
    });
    expect(repositories.decisionJobs.listAttempts(failed.id)).toEqual([attempt]);
    expect(() =>
      connection.sqlite
        .prepare("UPDATE decision_job_attempts SET outcome = 'cancelled' WHERE id = ?")
        .run(attempt.id)
    ).toThrow(/append-only/u);
  });

  it("creates and revokes overrides without mutating the original event", () => {
    const override = repositories.duplicateOverrides.create({
      id: "override-force-split-1",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      kind: "force_split",
      sourceRecordIds: ["src-juniper-apartments", "src-juniper-zillow"],
      survivorCanonicalId: null,
      reason: "Sanitized reviewer correction.",
      createdBy: "user",
      createdAt: now
    });
    expect(repositories.duplicateOverrides.listActive(DEMO_SEARCH_PROFILE.id)).toEqual([override]);
    repositories.duplicateOverrides.revoke({
      id: "override-revocation-1",
      overrideId: override.id,
      reason: "Sanitized correction withdrawn.",
      createdBy: "user",
      createdAt: "2026-07-20T18:01:00.000Z"
    });
    expect(repositories.duplicateOverrides.listActive(DEMO_SEARCH_PROFILE.id)).toEqual([]);
    expect(repositories.duplicateOverrides.list(DEMO_SEARCH_PROFILE.id)).toEqual([override]);
    expect(() =>
      connection.sqlite
        .prepare("UPDATE duplicate_overrides SET reason = 'changed' WHERE id = ?")
        .run(override.id)
    ).toThrow(/append-only/u);
  });
});
