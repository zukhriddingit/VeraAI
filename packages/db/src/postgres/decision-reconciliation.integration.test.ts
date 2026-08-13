import { FieldProvenanceSchema, type VeraUserId } from "@vera/domain";
import { evaluateCorpus } from "@vera/scoring";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DEMO_SEARCH_PROFILE, SOURCE_FIXTURES, normalizedFactEntries } from "../fixtures.ts";
import { createPostgresDecisionRepositories } from "./decision-repositories.ts";
import { createPostgresDecisionReconciliation } from "./decision-reconciliation.ts";
import {
  createCorePostgresRepositories,
  createPostgresRepositoryProvider
} from "./repositories.ts";
import { activityEvents, decisionRuns, listingScores, riskSignals, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const now = "2026-07-20T18:00:00.000Z";

async function seedEvidence(db: Parameters<typeof createCorePostgresRepositories>[0]) {
  await db.insert(users).values({
    id: userId,
    name: "Reconciliation Test",
    email: "reconciliation@example.test",
    emailVerified: true
  });
  const repositories = createCorePostgresRepositories(db, userId);
  await repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
  for (const fixture of SOURCE_FIXTURES) {
    await repositories.rawListings.import(fixture.capture);
    await repositories.sourceRecords.insert(fixture.sourceRecord);
    for (const [fieldPath] of normalizedFactEntries(fixture.sourceRecord)) {
      await repositories.fieldProvenance.insert(
        FieldProvenanceSchema.parse({
          id: `prov:${fixture.sourceRecord.id}:${fieldPath}`,
          listingSourceRecordId: fixture.sourceRecord.id,
          rawListingId: fixture.sourceRecord.rawListingId,
          fieldPath,
          extractionMethod: "fixture_structured",
          confidenceBasisPoints: fixture.sourceRecord.extractionConfidenceBasisPoints,
          valueStatus: "known",
          unknownReason: null,
          observedAt: fixture.sourceRecord.observedAt,
          evidenceExcerpt: null
        })
      );
    }
  }
}

describe("PostgreSQL decision reconciliation", () => {
  it("excludes current invalid dispositions without deleting retained evidence", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedEvidence(db);
      const provider = createPostgresRepositoryProvider(connection);
      const repositories = provider.forUser(userId);
      const invalidSource = SOURCE_FIXTURES[0]!.sourceRecord;
      await repositories.sourceRecordDispositions.append({
        id: "disposition-reconciliation-invalid",
        listingSourceRecordId: invalidSource.id,
        disposition: "invalid_non_listing",
        reasonCode: "integration_non_listing",
        evidence: { observedUrl: invalidSource.sourceUrl },
        payloadHash: "e".repeat(64),
        actor: "founder",
        observedAt: now
      });
      await repositories.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
      const job = await repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
        id: "decision-job-disposition-1",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        trigger: "manual_recompute",
        now
      });
      const claimed = await repositories.decisionJobs.claimNext({
        leaseOwner: "decision-worker-disposition",
        now,
        leaseExpiresAt: "2026-07-20T18:05:00.000Z"
      });
      expect(claimed?.id).toBe(job.id);
      const snapshot = await repositories.decisionReconciliation.readSnapshot({
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        targetCorpusRevision: job.targetCorpusRevision
      });
      expect(snapshot.sourceRecords.map(({ sourceRecordId }) => sourceRecordId)).not.toContain(
        invalidSource.id
      );
      const plan = evaluateCorpus(snapshot, { now });
      await repositories.decisionReconciliation.applyPlan({
        jobId: job.id,
        leaseOwner: "decision-worker-disposition",
        plan
      });
      await expect(repositories.rawListings.count()).resolves.toBe(SOURCE_FIXTURES.length);
      await expect(repositories.sourceRecords.count()).resolves.toBe(SOURCE_FIXTURES.length);
      const summaries = await repositories.canonicalListings.listSummaries();
      expect(
        (
          await Promise.all(
            summaries.map(({ id }) => repositories.sourceRecords.listByCanonicalListingId(id))
          )
        )
          .flat()
          .map(({ id }) => id)
      ).not.toContain(invalidSource.id);
    });
  });

  it("applies one atomic plan and replays the same result idempotently", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await seedEvidence(db);
      const decision = createPostgresDecisionRepositories(db, userId);
      const reconciliation = createPostgresDecisionReconciliation(db, userId, decision);
      await decision.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
      const enqueued = await decision.decisionJobs.enqueueCurrentRevision({
        id: "decision-job-apply-1",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        trigger: "seed",
        now
      });
      const claimed = await decision.decisionJobs.claimNext({
        leaseOwner: "decision-worker-1",
        now,
        leaseExpiresAt: "2026-07-20T18:05:00.000Z"
      });
      expect(claimed?.id).toBe(enqueued.id);
      const snapshot = await reconciliation.readSnapshot({
        searchProfileId: claimed!.searchProfileId,
        targetCorpusRevision: claimed!.targetCorpusRevision
      });
      const plan = evaluateCorpus(snapshot, { now });
      const applied = await reconciliation.applyPlan({
        jobId: claimed!.id,
        leaseOwner: "decision-worker-1",
        plan
      });
      const replay = await reconciliation.applyPlan({
        jobId: claimed!.id,
        leaseOwner: "decision-worker-1",
        plan
      });

      expect(applied.replayed).toBe(false);
      expect(replay).toEqual({ run: applied.run, replayed: true });
      expect(await decision.decisionHistory.listRuns(DEMO_SEARCH_PROFILE.id)).toHaveLength(1);
      const scoreCount = await db
        .select({ value: count() })
        .from(listingScores)
        .where(eq(listingScores.decisionRunId, applied.run.id));
      const riskCount = await db
        .select({ value: count() })
        .from(riskSignals)
        .where(eq(riskSignals.decisionRunId, applied.run.id));
      expect(Number(scoreCount[0]?.value)).toBe(plan.scoreSnapshots.length);
      expect(Number(riskCount[0]?.value)).toBe(plan.riskSignals.length);
      expect(await decision.decisionJobs.getById(claimed!.id)).toMatchObject({
        status: "succeeded"
      });
    });
  });

  it("rolls back every write when a planned source violates a foreign key", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await seedEvidence(db);
      const decision = createPostgresDecisionRepositories(db, userId);
      const reconciliation = createPostgresDecisionReconciliation(db, userId, decision);
      await decision.decisionJobs.ensureCorpusState(DEMO_SEARCH_PROFILE.id, now);
      const enqueued = await decision.decisionJobs.enqueueCurrentRevision({
        id: "decision-job-rollback-1",
        searchProfileId: DEMO_SEARCH_PROFILE.id,
        trigger: "seed",
        now
      });
      const claimed = await decision.decisionJobs.claimNext({
        leaseOwner: "decision-worker-1",
        now,
        leaseExpiresAt: "2026-07-20T18:05:00.000Z"
      });
      expect(claimed?.id).toBe(enqueued.id);
      const snapshot = await reconciliation.readSnapshot({
        searchProfileId: claimed!.searchProfileId,
        targetCorpusRevision: claimed!.targetCorpusRevision
      });
      const plan = evaluateCorpus(snapshot, { now });
      const invalid = {
        ...plan,
        pairEvaluations: plan.pairEvaluations.map((pair, index) =>
          index === 0 ? { ...pair, leftSourceRecordId: "a-missing-source" } : pair
        )
      };
      await expect(
        reconciliation.applyPlan({
          jobId: claimed!.id,
          leaseOwner: "decision-worker-1",
          plan: invalid
        })
      ).rejects.toBeDefined();

      for (const table of [decisionRuns, listingScores, riskSignals, activityEvents]) {
        const rows = await db.select({ value: count() }).from(table);
        expect(Number(rows[0]?.value ?? -1)).toBe(0);
      }
    });
  });
});
