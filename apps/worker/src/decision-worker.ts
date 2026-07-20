import {
  DecisionIdempotencyConflictError,
  StaleCorpusRevisionError,
  type VeraRepositories
} from "@vera/db";
import type { DecisionJobErrorCode } from "@vera/domain";
import { DecisionEvaluationError, evaluateCorpus } from "@vera/scoring";

export const DECISION_LEASE_DURATION_MILLISECONDS = 90_000;
export const DECISION_MAXIMUM_ATTEMPTS = 3;

type Evaluator = typeof evaluateCorpus;

export interface DecisionWorkerDependencies {
  readonly repositories: VeraRepositories;
  readonly leaseOwner: string;
  readonly evaluate?: Evaluator;
  now(): Date;
  createId(): string;
}

export type DecisionWorkerResult =
  | { readonly status: "idle" }
  | { readonly status: "cancelled"; readonly jobId: string }
  | {
      readonly status: "completed";
      readonly jobId: string;
      readonly decisionRunId: string;
      readonly replayed: boolean;
      readonly canonicalCount: number;
      readonly riskSignalCount: number;
    }
  | {
      readonly status: "retryable" | "dead_letter";
      readonly jobId: string;
      readonly errorCode: DecisionJobErrorCode;
      readonly retryable: boolean;
    };

interface SafeDecisionFailure {
  readonly code: DecisionJobErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

function validDate(dependencies: DecisionWorkerDependencies): Date {
  const value = dependencies.now();
  if (Number.isNaN(value.getTime())) throw new Error("Decision worker clock is invalid.");
  return value;
}

function sqliteBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")
  );
}

function safeFailure(error: unknown): SafeDecisionFailure {
  if (error instanceof StaleCorpusRevisionError) {
    return {
      code: "stale_corpus_revision",
      message: "The corpus changed while the decision plan was being computed.",
      retryable: true
    };
  }
  if (error instanceof DecisionIdempotencyConflictError) {
    return {
      code: "idempotency_conflict",
      message: "The decision job resolved to a conflicting immutable result.",
      retryable: false
    };
  }
  if (error instanceof DecisionEvaluationError) {
    const code: DecisionJobErrorCode =
      error.code === "candidate_limit_exceeded"
        ? "candidate_limit_exceeded"
        : error.code === "invalid_snapshot"
          ? "invalid_snapshot"
          : "invalid_decision_plan";
    return {
      code,
      message: "The decision corpus could not be evaluated safely.",
      retryable: error.retryable
    };
  }
  if (sqliteBusy(error)) {
    return {
      code: "database_busy",
      message: "Decision persistence is temporarily busy.",
      retryable: true
    };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return {
      code: "invalid_decision_plan",
      message: "The decision plan failed strict validation.",
      retryable: false
    };
  }
  return {
    code: "internal_error",
    message: "The decision worker encountered an internal error.",
    retryable: true
  };
}

function retryAt(attemptCount: number, failedAt: Date): string {
  const delayMilliseconds = Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(failedAt.getTime() + delayMilliseconds).toISOString();
}

export async function processNextDecisionJob(
  dependencies: DecisionWorkerDependencies,
  signal: AbortSignal
): Promise<DecisionWorkerResult> {
  if (signal.aborted) return { status: "idle" };
  const claimTime = validDate(dependencies);
  const job = dependencies.repositories.decisionJobs.claimNext({
    leaseOwner: dependencies.leaseOwner,
    now: claimTime.toISOString(),
    leaseExpiresAt: new Date(
      claimTime.getTime() + DECISION_LEASE_DURATION_MILLISECONDS
    ).toISOString()
  });
  if (job === null) return { status: "idle" };

  try {
    if (signal.aborted) return { status: "cancelled", jobId: job.id };
    const snapshot = dependencies.repositories.decisionReconciliation.readSnapshot({
      searchProfileId: job.searchProfileId,
      targetCorpusRevision: job.targetCorpusRevision
    });
    const computedAt = validDate(dependencies).toISOString();
    const plan = (dependencies.evaluate ?? evaluateCorpus)(snapshot, { now: computedAt });
    if (signal.aborted) return { status: "cancelled", jobId: job.id };
    const applied = dependencies.repositories.decisionReconciliation.applyPlan({
      jobId: job.id,
      leaseOwner: dependencies.leaseOwner,
      plan
    });
    return {
      status: "completed",
      jobId: job.id,
      decisionRunId: applied.run.id,
      replayed: applied.replayed,
      canonicalCount: plan.canonicalPlans.length,
      riskSignalCount: plan.riskSignals.length
    };
  } catch (error: unknown) {
    if (signal.aborted) return { status: "cancelled", jobId: job.id };
    const failedAt = validDate(dependencies);
    const safe = safeFailure(error);
    const retryable = safe.retryable && job.attemptCount < DECISION_MAXIMUM_ATTEMPTS;
    dependencies.repositories.transaction((repositories) => {
      repositories.decisionJobs.appendAttempt({
        id: dependencies.createId(),
        jobId: job.id,
        attemptNumber: job.attemptCount,
        startedAt: job.updatedAt,
        finishedAt: failedAt.toISOString(),
        outcome: retryable ? "retryable_failed" : "permanently_failed",
        errorCode: safe.code,
        durationMilliseconds: Math.max(0, failedAt.getTime() - Date.parse(job.updatedAt))
      });
      repositories.decisionJobs.fail({
        id: job.id,
        leaseOwner: dependencies.leaseOwner,
        retryable,
        errorCode: safe.code,
        errorMessage: safe.message,
        failedAt: failedAt.toISOString(),
        retryAt: retryAt(job.attemptCount, failedAt)
      });
      if (safe.code === "stale_corpus_revision") {
        repositories.decisionJobs.enqueueCurrentRevision({
          id: dependencies.createId(),
          searchProfileId: job.searchProfileId,
          trigger: job.trigger,
          now: failedAt.toISOString()
        });
      }
    });
    return {
      status: retryable ? "retryable" : "dead_letter",
      jobId: job.id,
      errorCode: safe.code,
      retryable
    };
  }
}
