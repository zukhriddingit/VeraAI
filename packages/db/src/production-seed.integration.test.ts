import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateCorpus } from "@vera/scoring";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedEvidenceDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./demo/index.ts";

const now = "2026-07-20T18:00:00.000Z";
let directory = "";
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-production-seed-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("production sanitized evidence seed", () => {
  it("queues evidence, computes product decisions through the production engine, and is idempotent", () => {
    const seeded = seedEvidenceDatabase(repositories);
    expect(seeded).toMatchObject({
      sourceRecords: 12,
      evidenceChanged: true,
      decisionJobStatus: "queued"
    });
    expect(repositories.canonicalListings.count()).toBe(0);
    expect(repositories.listingScores.count()).toBe(0);
    expect(repositories.riskSignals.count()).toBe(0);

    const job = repositories.decisionJobs.claimNext({
      leaseOwner: "production-seed-worker",
      now,
      leaseExpiresAt: "2026-07-20T18:05:00.000Z"
    });
    expect(job?.id).toBe(seeded.decisionJobId);
    const snapshot = repositories.decisionReconciliation.readSnapshot({
      searchProfileId: job!.searchProfileId,
      targetCorpusRevision: job!.targetCorpusRevision
    });
    const plan = evaluateCorpus(snapshot, { now });
    repositories.decisionReconciliation.applyPlan({
      jobId: job!.id,
      leaseOwner: "production-seed-worker",
      plan
    });

    expect(repositories.canonicalListings.count()).toBe(plan.canonicalPlans.length);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM listing_scores WHERE schema_version = ?")
        .get("listing-score.v2")
    ).toEqual({ count: plan.scoreSnapshots.length });
    const replay = seedEvidenceDatabase(repositories);
    expect(replay).toMatchObject({
      evidenceChanged: false,
      decisionJobId: seeded.decisionJobId,
      decisionJobStatus: "succeeded"
    });
    expect(repositories.decisionJobs.list()).toHaveLength(1);
  });
});
