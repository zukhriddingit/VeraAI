import {
  EntityIdSchema,
  IsoDateTimeSchema,
  MaritimeDeploymentSchema,
  MaritimeDispatchSchema,
  MaritimeDispatchStateSchema,
  ProductionScheduleRunSchema,
  ProductionScheduleRunStateSchema,
  ProductionScheduleSchema,
  ServiceHeartbeatSchema,
  Sha256Schema,
  transitionMaritimeDispatch,
  type MaritimeDispatch,
  type ProductionScheduleRun,
  type VeraUserId
} from "@vera/domain";
import { and, asc, desc, eq, lte } from "drizzle-orm";

import type { MaritimeOperationsRepository, UserRepositories } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import {
  maritimeDeployments,
  maritimeDispatches,
  productionScheduleRuns,
  productionSchedules,
  serviceHeartbeats
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type MaritimePostgresRepositories = Pick<
  UserRepositories,
  "maritimeDispatches" | "productionSchedules"
>;

function instant(value: string): Date {
  return new Date(value);
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

function assertOwner(actual: VeraUserId, expected: VeraUserId): void {
  if (actual !== expected) {
    throw new PostgresRepositoryError(
      "ownership_violation",
      false,
      "The requested record belongs to a different user."
    );
  }
}

function mapDispatch(row: typeof maritimeDispatches.$inferSelect): MaritimeDispatch {
  return MaritimeDispatchSchema.parse({
    ...row,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    consumedAt: row.consumedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function mapSchedule(row: typeof productionSchedules.$inferSelect) {
  return ProductionScheduleSchema.parse({
    ...row,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function mapScheduleRun(row: typeof productionScheduleRuns.$inferSelect): ProductionScheduleRun {
  return ProductionScheduleRunSchema.parse({
    ...row,
    dueAt: row.dueAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

export function createPostgresMaritimeRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): MaritimePostgresRepositories {
  const maritimeDispatchRepository: MaritimePostgresRepositories["maritimeDispatches"] = {
    async create(input) {
      const dispatch = MaritimeDispatchSchema.parse(input);
      assertOwner(dispatch.userId, userId);
      const rows = await operation(() =>
        db
          .insert(maritimeDispatches)
          .values({
            ...dispatch,
            issuedAt: instant(dispatch.issuedAt),
            expiresAt: instant(dispatch.expiresAt),
            acceptedAt: dispatch.acceptedAt === null ? null : instant(dispatch.acceptedAt),
            consumedAt: dispatch.consumedAt === null ? null : instant(dispatch.consumedAt),
            rejectedAt: dispatch.rejectedAt === null ? null : instant(dispatch.rejectedAt),
            createdAt: instant(dispatch.createdAt),
            updatedAt: instant(dispatch.updatedAt)
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Maritime dispatch insert returned no row.");
      return mapDispatch(row);
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(maritimeDispatches)
        .where(and(eq(maritimeDispatches.userId, userId), eq(maritimeDispatches.id, id)))
        .limit(1);
      return rows[0] ? mapDispatch(rows[0]) : null;
    },
    async getBySourceJobId(input) {
      const sourceJobId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(maritimeDispatches)
        .where(
          and(
            eq(maritimeDispatches.userId, userId),
            eq(maritimeDispatches.sourceJobId, sourceJobId)
          )
        )
        .orderBy(desc(maritimeDispatches.issuedAt), desc(maritimeDispatches.id))
        .limit(1);
      return rows[0] ? mapDispatch(rows[0]) : null;
    },
    async getByNonceHash(input) {
      const nonceHash = Sha256Schema.parse(input);
      const rows = await db
        .select()
        .from(maritimeDispatches)
        .where(
          and(eq(maritimeDispatches.userId, userId), eq(maritimeDispatches.nonceHash, nonceHash))
        )
        .limit(1);
      return rows[0] ? mapDispatch(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(maritimeDispatches)
        .where(eq(maritimeDispatches.userId, userId))
        .orderBy(asc(maritimeDispatches.issuedAt), asc(maritimeDispatches.id));
      return rows.map(mapDispatch);
    },
    async transition(idInput, expectedInput, requestedInput, atInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const expected = MaritimeDispatchStateSchema.parse(expectedInput);
      const requested = MaritimeDispatchStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      const currentRows = await db
        .select()
        .from(maritimeDispatches)
        .where(and(eq(maritimeDispatches.userId, userId), eq(maritimeDispatches.id, id)))
        .limit(1);
      const currentRow = currentRows[0];
      if (!currentRow) throw new PostgresRepositoryError("not_found", false, "Dispatch not found.");
      const current = mapDispatch(currentRow);
      if (current.state !== expected) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Dispatch state changed concurrently."
        );
      }
      const next = transitionMaritimeDispatch(
        current,
        requested,
        at,
        patch.rejectionCode ?? undefined
      );
      const rows = await operation(() =>
        db
          .update(maritimeDispatches)
          .set({
            state: next.state,
            maritimeRunId:
              patch.maritimeRunId === undefined ? current.maritimeRunId : patch.maritimeRunId,
            acceptedAt: next.acceptedAt === null ? null : instant(next.acceptedAt),
            consumedAt: next.consumedAt === null ? null : instant(next.consumedAt),
            rejectedAt: next.rejectedAt === null ? null : instant(next.rejectedAt),
            rejectionCode: next.rejectionCode,
            updatedAt: instant(next.updatedAt)
          })
          .where(
            and(
              eq(maritimeDispatches.userId, userId),
              eq(maritimeDispatches.id, id),
              eq(maritimeDispatches.state, expected)
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row)
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Dispatch state changed concurrently."
        );
      return mapDispatch(row);
    }
  };

  const productionScheduleRepository: MaritimePostgresRepositories["productionSchedules"] = {
    async upsert(input) {
      const schedule = ProductionScheduleSchema.parse(input);
      assertOwner(schedule.userId, userId);
      const rows = await operation(() =>
        db
          .insert(productionSchedules)
          .values({
            ...schedule,
            nextRunAt: instant(schedule.nextRunAt),
            lastRunAt: schedule.lastRunAt === null ? null : instant(schedule.lastRunAt),
            createdAt: instant(schedule.createdAt),
            updatedAt: instant(schedule.updatedAt)
          })
          .onConflictDoUpdate({
            target: [productionSchedules.userId, productionSchedules.id],
            set: {
              state: schedule.state,
              intervalSeconds: schedule.intervalSeconds,
              sourceConfigurationId: schedule.sourceConfigurationId,
              nextRunAt: instant(schedule.nextRunAt),
              lastRunAt: schedule.lastRunAt === null ? null : instant(schedule.lastRunAt),
              updatedAt: instant(schedule.updatedAt)
            }
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Production schedule upsert returned no row.");
      return mapSchedule(row);
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(productionSchedules)
        .where(and(eq(productionSchedules.userId, userId), eq(productionSchedules.id, id)))
        .limit(1);
      return rows[0] ? mapSchedule(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(productionSchedules)
        .where(eq(productionSchedules.userId, userId))
        .orderBy(asc(productionSchedules.nextRunAt), asc(productionSchedules.id));
      return rows.map(mapSchedule);
    },
    async listDue(nowInput, limitInput) {
      const now = instant(IsoDateTimeSchema.parse(nowInput));
      const limit = Math.max(1, Math.min(100, Math.trunc(limitInput)));
      const rows = await db
        .select()
        .from(productionSchedules)
        .where(
          and(
            eq(productionSchedules.userId, userId),
            eq(productionSchedules.state, "enabled"),
            lte(productionSchedules.nextRunAt, now)
          )
        )
        .orderBy(asc(productionSchedules.nextRunAt), asc(productionSchedules.id))
        .limit(limit);
      return rows.map(mapSchedule);
    },
    async createRun(input) {
      const run = ProductionScheduleRunSchema.parse(input);
      assertOwner(run.userId, userId);
      const inserted = await operation(() =>
        db
          .insert(productionScheduleRuns)
          .values({
            ...run,
            dueAt: instant(run.dueAt),
            startedAt: run.startedAt === null ? null : instant(run.startedAt),
            completedAt: run.completedAt === null ? null : instant(run.completedAt),
            createdAt: instant(run.createdAt),
            updatedAt: instant(run.updatedAt)
          })
          .onConflictDoNothing({
            target: [productionScheduleRuns.userId, productionScheduleRuns.idempotencyKey]
          })
          .returning()
      );
      const rows =
        inserted.length > 0
          ? inserted
          : await db
              .select()
              .from(productionScheduleRuns)
              .where(
                and(
                  eq(productionScheduleRuns.userId, userId),
                  eq(productionScheduleRuns.idempotencyKey, run.idempotencyKey)
                )
              )
              .limit(1);
      const row = rows[0];
      if (!row) throw new Error("Production schedule run did not resolve.");
      return { record: mapScheduleRun(row), inserted: inserted.length === 1 };
    },
    async getRunById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(productionScheduleRuns)
        .where(and(eq(productionScheduleRuns.userId, userId), eq(productionScheduleRuns.id, id)))
        .limit(1);
      return rows[0] ? mapScheduleRun(rows[0]) : null;
    },
    async getRunByIdempotencyKey(input) {
      const key = Sha256Schema.parse(input);
      const rows = await db
        .select()
        .from(productionScheduleRuns)
        .where(
          and(
            eq(productionScheduleRuns.userId, userId),
            eq(productionScheduleRuns.idempotencyKey, key)
          )
        )
        .limit(1);
      return rows[0] ? mapScheduleRun(rows[0]) : null;
    },
    async listRuns(scheduleIdInput) {
      const scheduleId = EntityIdSchema.parse(scheduleIdInput);
      const rows = await db
        .select()
        .from(productionScheduleRuns)
        .where(
          and(
            eq(productionScheduleRuns.userId, userId),
            eq(productionScheduleRuns.scheduleId, scheduleId)
          )
        )
        .orderBy(asc(productionScheduleRuns.dueAt), asc(productionScheduleRuns.id));
      return rows.map(mapScheduleRun);
    },
    async transitionRun(idInput, expectedInput, requestedInput, atInput, safeErrorCode = null) {
      const id = EntityIdSchema.parse(idInput);
      const expected = ProductionScheduleRunStateSchema.parse(expectedInput);
      const requested = ProductionScheduleRunStateSchema.parse(requestedInput);
      const at = instant(IsoDateTimeSchema.parse(atInput));
      const terminal = ["completed", "permanently_failed", "cancelled_by_policy"].includes(
        requested
      );
      const failure = ["retryable_failed", "permanently_failed"].includes(requested);
      const rows = await operation(() =>
        db
          .update(productionScheduleRuns)
          .set({
            state: requested,
            attemptCount: requested === "running" ? 1 : undefined,
            safeErrorCode: failure ? EntityIdSchema.parse(safeErrorCode) : null,
            startedAt: requested === "running" ? at : undefined,
            completedAt: terminal ? at : null,
            updatedAt: at
          })
          .where(
            and(
              eq(productionScheduleRuns.userId, userId),
              eq(productionScheduleRuns.id, id),
              eq(productionScheduleRuns.state, expected)
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row)
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Schedule run state changed concurrently."
        );
      return mapScheduleRun(row);
    }
  };

  return {
    maritimeDispatches: maritimeDispatchRepository,
    productionSchedules: productionScheduleRepository
  };
}

export function createPostgresMaritimeOperationsRepository(
  db: PostgresExecutor
): MaritimeOperationsRepository {
  return {
    async upsertDeployment(input) {
      const deployment = MaritimeDeploymentSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(maritimeDeployments)
          .values({
            ...deployment,
            lastCheckedAt:
              deployment.lastCheckedAt === null ? null : instant(deployment.lastCheckedAt),
            createdAt: instant(deployment.createdAt),
            updatedAt: instant(deployment.updatedAt)
          })
          .onConflictDoUpdate({
            target: maritimeDeployments.id,
            set: {
              kind: deployment.kind,
              maritimeAgentId: deployment.maritimeAgentId,
              environment: deployment.environment,
              status: deployment.status,
              version: deployment.version,
              diagnosticUrl: deployment.diagnosticUrl,
              lastCheckedAt:
                deployment.lastCheckedAt === null ? null : instant(deployment.lastCheckedAt),
              safeErrorCode: deployment.safeErrorCode,
              updatedAt: instant(deployment.updatedAt)
            }
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Maritime deployment upsert returned no row.");
      return MaritimeDeploymentSchema.parse({
        ...row,
        lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      });
    },
    async listDeployments() {
      const rows = await db.select().from(maritimeDeployments).orderBy(asc(maritimeDeployments.id));
      return rows.map((row) =>
        MaritimeDeploymentSchema.parse({
          ...row,
          lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        })
      );
    },
    async upsertHeartbeat(input) {
      const heartbeat = ServiceHeartbeatSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(serviceHeartbeats)
          .values({
            ...heartbeat,
            checkedAt: instant(heartbeat.checkedAt),
            expiresAt: instant(heartbeat.expiresAt)
          })
          .onConflictDoUpdate({
            target: serviceHeartbeats.id,
            set: {
              status: heartbeat.status,
              version: heartbeat.version,
              checkedAt: instant(heartbeat.checkedAt),
              expiresAt: instant(heartbeat.expiresAt),
              safeCode: heartbeat.safeCode
            }
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Service heartbeat upsert returned no row.");
      return ServiceHeartbeatSchema.parse({
        ...row,
        checkedAt: row.checkedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString()
      });
    },
    async listHeartbeats() {
      const rows = await db.select().from(serviceHeartbeats).orderBy(asc(serviceHeartbeats.id));
      return rows.map((row) =>
        ServiceHeartbeatSchema.parse({
          ...row,
          checkedAt: row.checkedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString()
        })
      );
    }
  };
}
