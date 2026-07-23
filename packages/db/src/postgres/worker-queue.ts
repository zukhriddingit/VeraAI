import {
  IsoDateTimeSchema,
  MaritimeDispatchSchema,
  NotificationDeliverySchema,
  ProductionScheduleSchema
} from "@vera/domain";
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { SystemWorkerQueue } from "../repositories.ts";
import type { PostgresConnection } from "./connection.ts";
import { mapPostgresError } from "./errors.ts";
import { mapDecisionJobRow, mapNormalizationJobRow, mapSourceJobRow } from "./row-mappers.ts";
import {
  decisionJobs,
  maritimeDispatches,
  normalizationJobs,
  notificationDeliveries,
  productionSchedules,
  sourceJobs
} from "./schema.ts";

function instant(value: string): Date {
  return new Date(value);
}

function validateLease(nowInput: string, expiryInput: string): { now: Date; expiry: Date } {
  const now = instant(IsoDateTimeSchema.parse(nowInput));
  const expiry = instant(IsoDateTimeSchema.parse(expiryInput));
  if (expiry.getTime() <= now.getTime()) throw new Error("Lease expiry must follow claim time.");
  return { now, expiry };
}

export function createPostgresWorkerQueue(connection: PostgresConnection): SystemWorkerQueue {
  return {
    async claimNextProductionSchedule(input) {
      const now = instant(IsoDateTimeSchema.parse(input.now));
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: productionSchedules.userId, id: productionSchedules.id })
            .from(productionSchedules)
            .where(
              and(eq(productionSchedules.state, "enabled"), lte(productionSchedules.nextRunAt, now))
            )
            .orderBy(
              asc(productionSchedules.nextRunAt),
              asc(productionSchedules.userId),
              asc(productionSchedules.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(productionSchedules)
            .set({
              lastRunAt: productionSchedules.nextRunAt,
              nextRunAt: sql`${productionSchedules.nextRunAt} + (${productionSchedules.intervalSeconds} * interval '1 second')`,
              updatedAt: now
            })
            .where(
              and(
                eq(productionSchedules.userId, candidate.userId),
                eq(productionSchedules.id, candidate.id),
                eq(productionSchedules.state, "enabled")
              )
            )
            .returning();
          const row = rows[0];
          if (!row) return null;
          return {
            userId: row.userId,
            schedule: ProductionScheduleSchema.parse({
              ...row,
              nextRunAt: row.nextRunAt.toISOString(),
              lastRunAt: row.lastRunAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString()
            })
          };
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextDispatchedSourceJob(input) {
      const { now, expiry } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({
              userId: sourceJobs.userId,
              jobId: sourceJobs.id,
              dispatchId: maritimeDispatches.id
            })
            .from(maritimeDispatches)
            .innerJoin(
              sourceJobs,
              and(
                eq(maritimeDispatches.userId, sourceJobs.userId),
                eq(maritimeDispatches.sourceJobId, sourceJobs.id)
              )
            )
            .where(
              and(
                eq(maritimeDispatches.state, "accepted"),
                eq(maritimeDispatches.audience, input.audience),
                gt(maritimeDispatches.expiresAt, now),
                eq(sourceJobs.status, "dispatched"),
                lt(sourceJobs.attempts, sourceJobs.maxAttempts),
                or(isNull(sourceJobs.leaseExpiresAt), lte(sourceJobs.leaseExpiresAt, now))
              )
            )
            .orderBy(asc(maritimeDispatches.issuedAt), asc(sourceJobs.userId), asc(sourceJobs.id))
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          await tx
            .update(maritimeDispatches)
            .set({ state: "consumed", consumedAt: now, updatedAt: now })
            .where(
              and(
                eq(maritimeDispatches.userId, candidate.userId),
                eq(maritimeDispatches.id, candidate.dispatchId),
                eq(maritimeDispatches.state, "accepted")
              )
            );
          const rows = await tx
            .update(sourceJobs)
            .set({
              status: "running",
              attempts: sql`${sourceJobs.attempts} + 1`,
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: expiry,
              updatedAt: now
            })
            .where(
              and(
                eq(sourceJobs.userId, candidate.userId),
                eq(sourceJobs.id, candidate.jobId),
                eq(sourceJobs.status, "dispatched")
              )
            )
            .returning();
          const row = rows[0];
          return row ? { userId: row.userId, job: mapSourceJobRow(row) } : null;
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextMaritimeDispatch(input) {
      const { now } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: maritimeDispatches.userId, id: maritimeDispatches.id })
            .from(maritimeDispatches)
            .where(
              and(eq(maritimeDispatches.state, "accepted"), gt(maritimeDispatches.expiresAt, now))
            )
            .orderBy(
              asc(maritimeDispatches.issuedAt),
              asc(maritimeDispatches.userId),
              asc(maritimeDispatches.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(maritimeDispatches)
            .set({ state: "consumed", consumedAt: now, updatedAt: now })
            .where(
              and(
                eq(maritimeDispatches.userId, candidate.userId),
                eq(maritimeDispatches.id, candidate.id),
                eq(maritimeDispatches.state, "accepted")
              )
            )
            .returning();
          const row = rows[0];
          if (!row) return null;
          return {
            userId: row.userId,
            dispatch: MaritimeDispatchSchema.parse({
              ...row,
              issuedAt: row.issuedAt.toISOString(),
              expiresAt: row.expiresAt.toISOString(),
              acceptedAt: row.acceptedAt?.toISOString() ?? null,
              consumedAt: row.consumedAt?.toISOString() ?? null,
              rejectedAt: row.rejectedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString()
            })
          };
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextNotificationDelivery(input) {
      const { now, expiry } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: notificationDeliveries.userId, id: notificationDeliveries.id })
            .from(notificationDeliveries)
            .where(
              or(
                and(
                  inArray(notificationDeliveries.state, [
                    "queued",
                    "retryable_failed",
                    "deferred_quiet_hours",
                    "deferred_rate_limit"
                  ]),
                  lte(notificationDeliveries.availableAt, now)
                ),
                and(
                  eq(notificationDeliveries.state, "leased"),
                  lte(notificationDeliveries.leaseExpiresAt, now)
                )
              )
            )
            .orderBy(
              asc(notificationDeliveries.availableAt),
              asc(notificationDeliveries.createdAt),
              asc(notificationDeliveries.userId),
              asc(notificationDeliveries.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(notificationDeliveries)
            .set({
              state: "leased",
              attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: expiry,
              safeErrorCode: null,
              updatedAt: now
            })
            .where(
              and(
                eq(notificationDeliveries.userId, candidate.userId),
                eq(notificationDeliveries.id, candidate.id)
              )
            )
            .returning();
          const row = rows[0];
          if (!row) return null;
          return {
            userId: row.userId,
            delivery: NotificationDeliverySchema.parse({
              ...row,
              availableAt: row.availableAt.toISOString(),
              leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
              deliveredAt: row.deliveredAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString()
            })
          };
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextNormalizationJob(input) {
      const { now, expiry } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: normalizationJobs.userId, id: normalizationJobs.id })
            .from(normalizationJobs)
            .where(
              and(
                inArray(normalizationJobs.state, ["queued", "retryable"]),
                lte(normalizationJobs.availableAt, now),
                or(
                  isNull(normalizationJobs.leaseExpiresAt),
                  lte(normalizationJobs.leaseExpiresAt, now)
                )
              )
            )
            .orderBy(
              asc(normalizationJobs.availableAt),
              asc(normalizationJobs.createdAt),
              asc(normalizationJobs.userId),
              asc(normalizationJobs.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(normalizationJobs)
            .set({
              state: "leased",
              attempts: sql`${normalizationJobs.attempts} + 1`,
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: expiry,
              updatedAt: now
            })
            .where(
              and(
                eq(normalizationJobs.userId, candidate.userId),
                eq(normalizationJobs.id, candidate.id)
              )
            )
            .returning();
          const row = rows[0];
          return row ? { userId: row.userId, job: mapNormalizationJobRow(row) } : null;
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextDecisionJob(input) {
      const { now, expiry } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: decisionJobs.userId, id: decisionJobs.id })
            .from(decisionJobs)
            .where(
              and(
                inArray(decisionJobs.status, ["queued", "retryable_failed"]),
                lte(decisionJobs.availableAt, now),
                or(isNull(decisionJobs.leaseExpiresAt), lte(decisionJobs.leaseExpiresAt, now))
              )
            )
            .orderBy(
              asc(decisionJobs.availableAt),
              asc(decisionJobs.createdAt),
              asc(decisionJobs.userId),
              asc(decisionJobs.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(decisionJobs)
            .set({
              status: "running",
              attemptCount: sql`${decisionJobs.attemptCount} + 1`,
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: expiry,
              errorCode: null,
              errorMessage: null,
              updatedAt: now
            })
            .where(
              and(eq(decisionJobs.userId, candidate.userId), eq(decisionJobs.id, candidate.id))
            )
            .returning();
          const row = rows[0];
          return row ? { userId: row.userId, job: mapDecisionJobRow(row) } : null;
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claimNextSourceJob(input) {
      const { now, expiry } = validateLease(input.now, input.leaseExpiresAt);
      try {
        return await connection.db.transaction(async (tx) => {
          const candidates = await tx
            .select({ userId: sourceJobs.userId, id: sourceJobs.id })
            .from(sourceJobs)
            .where(
              and(
                inArray(sourceJobs.status, ["queued", "retryable_failed", "running"]),
                lt(sourceJobs.attempts, sourceJobs.maxAttempts),
                lte(sourceJobs.availableAt, now),
                or(isNull(sourceJobs.leaseExpiresAt), lte(sourceJobs.leaseExpiresAt, now))
              )
            )
            .orderBy(
              asc(sourceJobs.availableAt),
              asc(sourceJobs.createdAt),
              asc(sourceJobs.userId),
              asc(sourceJobs.id)
            )
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) return null;
          const rows = await tx
            .update(sourceJobs)
            .set({
              status: "running",
              attempts: sql`${sourceJobs.attempts} + 1`,
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: expiry,
              updatedAt: now
            })
            .where(and(eq(sourceJobs.userId, candidate.userId), eq(sourceJobs.id, candidate.id)))
            .returning();
          const row = rows[0];
          return row ? { userId: row.userId, job: mapSourceJobRow(row) } : null;
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    }
  };
}
