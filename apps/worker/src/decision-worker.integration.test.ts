import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "@vera/db";
import { DEMO_SEARCH_PROFILE } from "@vera/db/fixtures";
import { evaluateCorpus } from "@vera/scoring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processNextDecisionJob } from "./decision-worker.ts";

const now = "2026-07-20T18:00:00.000Z";
let directory = "";
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-decision-worker-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  seedDatabase(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

function dependencies(overrides: Partial<Parameters<typeof processNextDecisionJob>[0]> = {}) {
  return {
    repositories,
    leaseOwner: "decision-worker-test-1",
    now: () => new Date(now),
    createId: randomUUID,
    ...overrides
  };
}

describe("durable decision worker", () => {
  it("computes outside persistence and applies the current corpus without network access", async () => {
    repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
    const job = repositories.decisionJobs.enqueueCurrentRevision({
      id: "decision-worker-job-1",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "seed",
      now
    });
    const originalFetch = globalThis.fetch;
    const forbiddenFetch = vi.fn(() => {
      throw new Error("Decision worker must not use network access.");
    });
    Object.assign(globalThis, { fetch: forbiddenFetch });
    try {
      const result = await processNextDecisionJob(dependencies(), new AbortController().signal);
      expect(result).toMatchObject({ status: "completed", jobId: job.id, replayed: false });
      expect(forbiddenFetch).not.toHaveBeenCalled();
      expect(repositories.decisionJobs.getById(job.id)?.status).toBe("succeeded");
      expect(repositories.decisionHistory.listRuns(DEMO_SEARCH_PROFILE.id)).toHaveLength(1);
      expect(
        connection.sqlite
          .prepare("SELECT count(*) AS count FROM listing_scores WHERE schema_version = ?")
          .get("listing-score.v2")
      ).toMatchObject({ count: expect.any(Number) });
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });

  it("makes a stale computation visibly retryable and queues the newest revision", async () => {
    repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
    const first = repositories.decisionJobs.enqueueCurrentRevision({
      id: "decision-worker-stale-1",
      searchProfileId: DEMO_SEARCH_PROFILE.id,
      trigger: "seed",
      now
    });
    const result = await processNextDecisionJob(
      dependencies({
        evaluate(snapshot, evaluationDependencies) {
          repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
            id: "decision-worker-stale-2",
            searchProfileId: DEMO_SEARCH_PROFILE.id,
            trigger: "manual_recompute",
            now
          });
          return evaluateCorpus(snapshot, evaluationDependencies);
        }
      }),
      new AbortController().signal
    );

    expect(result).toEqual({
      status: "retryable",
      jobId: first.id,
      errorCode: "stale_corpus_revision",
      retryable: true
    });
    expect(repositories.decisionJobs.getById(first.id)?.status).toBe("retryable_failed");
    expect(repositories.decisionJobs.getByProfileRevision(DEMO_SEARCH_PROFILE.id, 1)?.status).toBe(
      "queued"
    );
    expect(repositories.decisionHistory.listRuns(DEMO_SEARCH_PROFILE.id)).toEqual([]);
  });
});
