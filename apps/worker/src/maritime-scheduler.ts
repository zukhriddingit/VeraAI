import { createHash } from "node:crypto";

import {
  ProductionScheduleRunSchema,
  type ProductionSchedule,
  type VeraUserId
} from "@vera/domain";

type ScheduleRunRecord = ReturnType<typeof ProductionScheduleRunSchema.parse>;

export interface ProductionScheduleQueueBoundary {
  claimNextProductionSchedule(input: {
    readonly now: string;
  }): Promise<{ readonly userId: VeraUserId; readonly schedule: ProductionSchedule } | null>;
}

export interface ProductionScheduleRepositoryBoundary {
  createRun(run: ScheduleRunRecord): Promise<{
    readonly record: ScheduleRunRecord;
    readonly inserted: boolean;
  }>;
  transitionRun(
    id: string,
    expected: ScheduleRunRecord["state"],
    requested: ScheduleRunRecord["state"],
    at: string,
    safeErrorCode?: string | null
  ): Promise<ScheduleRunRecord>;
}

export type ProductionScheduleHandlerResult =
  | { readonly status: "completed" }
  | { readonly status: "cancelled_by_policy" }
  | { readonly status: "retryable_failed"; readonly safeErrorCode: string }
  | { readonly status: "permanently_failed"; readonly safeErrorCode: string };

export interface ReconcileProductionScheduleDependencies {
  readonly queue: ProductionScheduleQueueBoundary;
  readonly repositoriesForUser: (userId: VeraUserId) => {
    readonly productionSchedules: ProductionScheduleRepositoryBoundary;
  };
  readonly handler: (
    userId: VeraUserId,
    schedule: ProductionSchedule,
    signal?: AbortSignal
  ) => Promise<ProductionScheduleHandlerResult>;
  readonly now: () => Date;
  readonly createId: () => string;
}

export type ScheduleWorkerResult =
  | { readonly status: "idle" }
  | { readonly status: "replayed"; readonly scheduleKind: ProductionSchedule["kind"] }
  | {
      readonly status: ProductionScheduleHandlerResult["status"];
      readonly scheduleKind: ProductionSchedule["kind"];
    };

function idempotencyKey(userId: VeraUserId, schedule: ProductionSchedule, dueAt: string): string {
  return createHash("sha256")
    .update(`vera-production-schedule-run:v1:${userId}:${schedule.id}:${dueAt}`, "utf8")
    .digest("hex");
}

export async function reconcileNextProductionSchedule(
  dependencies: ReconcileProductionScheduleDependencies,
  signal?: AbortSignal
): Promise<ScheduleWorkerResult> {
  const now = dependencies.now();
  if (Number.isNaN(now.getTime()))
    throw new Error("Schedule reconciliation requires a valid clock.");
  const owned = await dependencies.queue.claimNextProductionSchedule({ now: now.toISOString() });
  if (!owned) return { status: "idle" };
  const dueAt = owned.schedule.lastRunAt;
  if (dueAt === null) throw new Error("A claimed production schedule must record its due time.");
  const repositories = dependencies.repositoriesForUser(owned.userId);
  const run = ProductionScheduleRunSchema.parse({
    id: dependencies.createId(),
    userId: owned.userId,
    scheduleId: owned.schedule.id,
    state: "created",
    dueAt,
    idempotencyKey: idempotencyKey(owned.userId, owned.schedule, dueAt),
    sourceJobId: null,
    attemptCount: 0,
    safeErrorCode: null,
    startedAt: null,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
  const created = await repositories.productionSchedules.createRun(run);
  if (!created.inserted) return { status: "replayed", scheduleKind: owned.schedule.kind };
  await repositories.productionSchedules.transitionRun(
    run.id,
    "created",
    "running",
    now.toISOString()
  );
  const outcome = await dependencies.handler(owned.userId, owned.schedule, signal);
  await repositories.productionSchedules.transitionRun(
    run.id,
    "running",
    outcome.status,
    dependencies.now().toISOString(),
    "safeErrorCode" in outcome ? outcome.safeErrorCode : null
  );
  return { status: outcome.status, scheduleKind: owned.schedule.kind };
}
