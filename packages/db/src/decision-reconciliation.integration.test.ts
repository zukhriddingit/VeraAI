import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluateCorpus } from "@vera/scoring";

import { DEMO_SEARCH_PROFILE } from "./fixtures.ts";
import {
  StaleCorpusRevisionError,
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
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-decision-reconcile-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  seedDatabase(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function claimJob(id: string) {
  repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
  const job = repositories.decisionJobs.enqueueCurrentRevision({
    id,
    searchProfileId: DEMO_SEARCH_PROFILE.id,
    trigger: "seed",
    now
  });
  const claim = repositories.decisionJobs.claimNext({
    leaseOwner: "decision-worker-1",
    now,
    leaseExpiresAt: "2026-07-20T18:05:00.000Z"
  });
  expect(claim?.id).toBe(job.id);
  return claim!;
}

describe("atomic revision-checked decision reconciliation", () => {
  it("applies one complete plan and replays the same result idempotently", () => {
    const job = claimJob("decision-job-apply-1");
    const snapshot = repositories.decisionReconciliation.readSnapshot({
      searchProfileId: job.searchProfileId,
      targetCorpusRevision: job.targetCorpusRevision
    });
    const plan = evaluateCorpus(snapshot, { now });
    const applied = repositories.decisionReconciliation.applyPlan({
      jobId: job.id,
      leaseOwner: "decision-worker-1",
      plan
    });
    const replay = repositories.decisionReconciliation.applyPlan({
      jobId: job.id,
      leaseOwner: "decision-worker-1",
      plan
    });

    expect(applied.replayed).toBe(false);
    expect(replay).toEqual({ run: applied.run, replayed: true });
    expect(repositories.decisionHistory.listRuns(job.searchProfileId)).toHaveLength(1);
    expect(repositories.decisionHistory.listPairEvaluations(applied.run.id)).toHaveLength(
      plan.pairEvaluations.length
    );
    expect(
      repositories.canonicalListings.list().filter((item) => item.projectionState === "active")
    ).toHaveLength(plan.canonicalPlans.length);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM listing_scores WHERE decision_run_id = ?")
        .get(applied.run.id)
    ).toEqual({ count: plan.scoreSnapshots.length });
    expect(repositories.decisionJobs.getById(job.id)?.status).toBe("succeeded");
  });

  it("rejects a stale snapshot without writing a run", () => {
    const job = claimJob("decision-job-stale-1");
    const snapshot = repositories.decisionReconciliation.readSnapshot({
      searchProfileId: job.searchProfileId,
      targetCorpusRevision: job.targetCorpusRevision
    });
    const plan = evaluateCorpus(snapshot, { now });
    repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
      id: "decision-job-stale-2",
      searchProfileId: job.searchProfileId,
      trigger: "manual_recompute",
      now: "2026-07-20T18:01:00.000Z"
    });

    expect(() =>
      repositories.decisionReconciliation.applyPlan({
        jobId: job.id,
        leaseOwner: "decision-worker-1",
        plan
      })
    ).toThrow(StaleCorpusRevisionError);
    expect(repositories.decisionHistory.listRuns(job.searchProfileId)).toEqual([]);
  });

  it("rolls back run history when a pair write violates a foreign key", () => {
    const job = claimJob("decision-job-rollback-1");
    const snapshot = repositories.decisionReconciliation.readSnapshot({
      searchProfileId: job.searchProfileId,
      targetCorpusRevision: job.targetCorpusRevision
    });
    const plan = evaluateCorpus(snapshot, { now });
    const firstPair = plan.pairEvaluations[0];
    expect(firstPair).toBeDefined();
    const invalidPlan = {
      ...plan,
      pairEvaluations: [
        {
          ...firstPair!,
          id: "pair-invalid-foreign-key",
          leftSourceRecordId: "a-missing-source"
        },
        ...plan.pairEvaluations.slice(1)
      ]
    };

    expect(() =>
      repositories.decisionReconciliation.applyPlan({
        jobId: job.id,
        leaseOwner: "decision-worker-1",
        plan: invalidPlan
      })
    ).toThrow();
    expect(repositories.decisionHistory.listRuns(job.searchProfileId)).toEqual([]);
    expect(
      connection.sqlite.prepare("SELECT count(*) AS count FROM duplicate_pair_evaluations").get()
    ).toEqual({ count: 0 });
    expect(repositories.decisionJobs.getById(job.id)?.status).toBe("running");
  });
});
