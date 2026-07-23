import { seedEvidenceDatabase } from "@vera/db/demo";
import type { VeraRepositories } from "@vera/db";
import { evaluateCorpus } from "@vera/scoring";

const decisionTime = "2026-07-20T18:00:00.000Z";

export function seedAndEvaluateProductionEvidence(repositories: VeraRepositories): void {
  const seeded = seedEvidenceDatabase(repositories);
  const job = repositories.decisionJobs.claimNext({
    leaseOwner: "web-test-decision-worker",
    now: decisionTime,
    leaseExpiresAt: "2026-07-20T18:05:00.000Z"
  });
  if (job === null || job.id !== seeded.decisionJobId) {
    throw new Error("Expected the sanitized evidence decision job.");
  }
  const snapshot = repositories.decisionReconciliation.readSnapshot({
    searchProfileId: job.searchProfileId,
    targetCorpusRevision: job.targetCorpusRevision
  });
  repositories.decisionReconciliation.applyPlan({
    jobId: job.id,
    leaseOwner: "web-test-decision-worker",
    plan: evaluateCorpus(snapshot, { now: decisionTime })
  });
}
