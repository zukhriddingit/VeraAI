import {
  DecisionJobAttemptSchema,
  DecisionJobErrorCodeSchema,
  DecisionJobTriggerSchema,
  DuplicateOverrideRevocationSchema,
  DuplicateOverrideSchema,
  DuplicatePairEvaluationSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  type DecisionJobAttempt,
  type VeraUserId
} from "@vera/domain";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { canonicalJson, sha256Text } from "../hashing.ts";
import type { DecisionCorpusState, DecisionRunRecord, UserRepositories } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import { mapDecisionJobRow } from "./row-mappers.ts";
import {
  decisionCorpusState,
  decisionJobAttempts,
  decisionJobs,
  decisionRuns,
  duplicateOverrideRevocations,
  duplicateOverrides,
  duplicatePairEvaluations,
  searchProfiles
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type PostgresDecisionRepositories = Pick<
  UserRepositories,
  "decisionJobs" | "duplicateOverrides" | "decisionHistory"
>;

function instant(value: string): Date;
function instant(value: string | null): Date | null;
function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function mapCorpusState(row: typeof decisionCorpusState.$inferSelect): DecisionCorpusState {
  return {
    searchProfileId: EntityIdSchema.parse(row.searchProfileId),
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapDecisionAttempt(row: typeof decisionJobAttempts.$inferSelect): DecisionJobAttempt {
  const { userId: _owner, ...value } = row;
  return DecisionJobAttemptSchema.parse({
    ...value,
    startedAt: value.startedAt.toISOString(),
    finishedAt: value.finishedAt?.toISOString() ?? null
  });
}

function mapDecisionRun(row: typeof decisionRuns.$inferSelect): DecisionRunRecord {
  const countsJson = JsonObjectSchema.parse(row.counts);
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(countsJson)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error("Decision run count metadata is invalid.");
    }
    counts[key] = value;
  }
  return {
    id: EntityIdSchema.parse(row.id),
    jobId: EntityIdSchema.parse(row.jobId),
    searchProfileId: EntityIdSchema.parse(row.searchProfileId),
    corpusRevision: row.corpusRevision,
    planVersion: row.planVersion,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    counts,
    createdAt: row.createdAt.toISOString()
  };
}

function mapOverride(row: typeof duplicateOverrides.$inferSelect) {
  const { userId: _owner, payloadHash: _payloadHash, ...value } = row;
  return DuplicateOverrideSchema.parse({
    ...value,
    createdAt: value.createdAt.toISOString()
  });
}

async function safe<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

export function createPostgresDecisionRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): PostgresDecisionRepositories {
  const decisionHistory: PostgresDecisionRepositories["decisionHistory"] = {
    async getRunById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionRuns)
        .where(and(eq(decisionRuns.userId, userId), eq(decisionRuns.id, id)))
        .limit(1);
      return rows[0] ? mapDecisionRun(rows[0]) : null;
    },
    async getRunByJobId(input) {
      const jobId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionRuns)
        .where(and(eq(decisionRuns.userId, userId), eq(decisionRuns.jobId, jobId)))
        .limit(1);
      return rows[0] ? mapDecisionRun(rows[0]) : null;
    },
    async listRuns(input) {
      const searchProfileId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionRuns)
        .where(
          and(eq(decisionRuns.userId, userId), eq(decisionRuns.searchProfileId, searchProfileId))
        )
        .orderBy(asc(decisionRuns.corpusRevision), asc(decisionRuns.id));
      return rows.map(mapDecisionRun);
    },
    async listPairEvaluations(input) {
      const decisionRunId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(duplicatePairEvaluations)
        .where(
          and(
            eq(duplicatePairEvaluations.userId, userId),
            eq(duplicatePairEvaluations.decisionRunId, decisionRunId)
          )
        )
        .orderBy(
          asc(duplicatePairEvaluations.leftSourceRecordId),
          asc(duplicatePairEvaluations.rightSourceRecordId)
        );
      return rows.map((row) =>
        DuplicatePairEvaluationSchema.parse({
          id: row.id,
          leftSourceRecordId: row.leftSourceRecordId,
          rightSourceRecordId: row.rightSourceRecordId,
          algorithmVersion: row.algorithmVersion,
          inputHash: row.inputHash,
          decision: row.decision,
          scoreBasisPoints: row.scoreBasisPoints,
          automaticLinkThresholdBasisPoints: row.automaticLinkThresholdBasisPoints,
          reviewThresholdBasisPoints: row.reviewThresholdBasisPoints,
          exactReasonCodes: row.exactReasonCodes,
          conflictReasonCodes: row.conflictReasonCodes,
          contactMatched: row.contactMatched,
          features: row.features,
          evaluatedAt: row.evaluatedAt.toISOString()
        })
      );
    }
  };

  const decisionJobRepository: PostgresDecisionRepositories["decisionJobs"] = {
    async getCorpusState(input) {
      const searchProfileId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionCorpusState)
        .where(
          and(
            eq(decisionCorpusState.userId, userId),
            eq(decisionCorpusState.searchProfileId, searchProfileId)
          )
        )
        .limit(1);
      return rows[0] ? mapCorpusState(rows[0]) : null;
    },
    async ensureCorpusState(profileInput, nowInput) {
      const searchProfileId = EntityIdSchema.parse(profileInput);
      const now = instant(IsoDateTimeSchema.parse(nowInput));
      const profiles = await db
        .select({ id: searchProfiles.id })
        .from(searchProfiles)
        .where(and(eq(searchProfiles.userId, userId), eq(searchProfiles.id, searchProfileId)))
        .limit(1);
      if (!profiles[0]) throw new Error("Decision corpus profile does not exist.");
      await safe(() =>
        db
          .insert(decisionCorpusState)
          .values({ userId, searchProfileId, revision: 0, updatedAt: now })
          .onConflictDoNothing()
      );
      const state = await decisionJobRepository.getCorpusState(searchProfileId);
      if (!state) throw new Error("Decision corpus state could not be initialized.");
      return state;
    },
    async bumpCorpusRevisionAndEnqueue(input) {
      const id = EntityIdSchema.parse(input.id);
      const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
      const trigger = DecisionJobTriggerSchema.parse(input.trigger);
      const now = instant(IsoDateTimeSchema.parse(input.now));
      return safe(() =>
        db.transaction(async (tx) => {
          const profiles = await tx
            .select({ id: searchProfiles.id })
            .from(searchProfiles)
            .where(and(eq(searchProfiles.userId, userId), eq(searchProfiles.id, searchProfileId)))
            .limit(1);
          if (!profiles[0]) throw new Error("Decision corpus profile does not exist.");
          await tx
            .insert(decisionCorpusState)
            .values({ userId, searchProfileId, revision: 0, updatedAt: now })
            .onConflictDoNothing();
          const states = await tx
            .select()
            .from(decisionCorpusState)
            .where(
              and(
                eq(decisionCorpusState.userId, userId),
                eq(decisionCorpusState.searchProfileId, searchProfileId)
              )
            )
            .limit(1)
            .for("update");
          const revision = (states[0]?.revision ?? 0) + 1;
          await tx
            .update(decisionCorpusState)
            .set({ revision, updatedAt: now })
            .where(
              and(
                eq(decisionCorpusState.userId, userId),
                eq(decisionCorpusState.searchProfileId, searchProfileId)
              )
            );
          const rows = await tx
            .insert(decisionJobs)
            .values({
              userId,
              id,
              searchProfileId,
              targetCorpusRevision: revision,
              trigger,
              status: "queued",
              attemptCount: 0,
              availableAt: now,
              createdAt: now,
              updatedAt: now
            })
            .onConflictDoNothing({
              target: [
                decisionJobs.userId,
                decisionJobs.searchProfileId,
                decisionJobs.targetCorpusRevision
              ]
            })
            .returning();
          const row =
            rows[0] ??
            (
              await tx
                .select()
                .from(decisionJobs)
                .where(
                  and(
                    eq(decisionJobs.userId, userId),
                    eq(decisionJobs.searchProfileId, searchProfileId),
                    eq(decisionJobs.targetCorpusRevision, revision)
                  )
                )
                .limit(1)
            )[0];
          if (!row) throw new Error("Decision job could not be enqueued.");
          return mapDecisionJobRow(row);
        })
      );
    },
    async enqueueCurrentRevision(input) {
      const id = EntityIdSchema.parse(input.id);
      const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
      const trigger = DecisionJobTriggerSchema.parse(input.trigger);
      const now = instant(IsoDateTimeSchema.parse(input.now));
      await decisionJobRepository.ensureCorpusState(searchProfileId, input.now);
      const state = await decisionJobRepository.getCorpusState(searchProfileId);
      if (!state) throw new Error("Decision corpus state is missing.");
      const rows = await safe(() =>
        db
          .insert(decisionJobs)
          .values({
            userId,
            id,
            searchProfileId,
            targetCorpusRevision: state.revision,
            trigger,
            status: "queued",
            attemptCount: 0,
            availableAt: now,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoNothing({
            target: [
              decisionJobs.userId,
              decisionJobs.searchProfileId,
              decisionJobs.targetCorpusRevision
            ]
          })
          .returning()
      );
      const row =
        rows[0] ??
        (
          await db
            .select()
            .from(decisionJobs)
            .where(
              and(
                eq(decisionJobs.userId, userId),
                eq(decisionJobs.searchProfileId, searchProfileId),
                eq(decisionJobs.targetCorpusRevision, state.revision)
              )
            )
            .limit(1)
        )[0];
      if (!row) throw new Error("Current-revision decision job could not be enqueued.");
      return mapDecisionJobRow(row);
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionJobs)
        .where(and(eq(decisionJobs.userId, userId), eq(decisionJobs.id, id)))
        .limit(1);
      return rows[0] ? mapDecisionJobRow(rows[0]) : null;
    },
    async getByProfileRevision(profileInput, revisionInput) {
      const searchProfileId = EntityIdSchema.parse(profileInput);
      if (!Number.isInteger(revisionInput) || revisionInput < 0) {
        throw new Error("Decision corpus revision must be nonnegative.");
      }
      const rows = await db
        .select()
        .from(decisionJobs)
        .where(
          and(
            eq(decisionJobs.userId, userId),
            eq(decisionJobs.searchProfileId, searchProfileId),
            eq(decisionJobs.targetCorpusRevision, revisionInput)
          )
        )
        .limit(1);
      return rows[0] ? mapDecisionJobRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(decisionJobs)
        .where(eq(decisionJobs.userId, userId))
        .orderBy(asc(decisionJobs.createdAt), asc(decisionJobs.id));
      return rows.map(mapDecisionJobRow);
    },
    async claimNext(input) {
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const now = instant(IsoDateTimeSchema.parse(input.now));
      const leaseExpiresAt = instant(IsoDateTimeSchema.parse(input.leaseExpiresAt));
      if (leaseExpiresAt <= now) throw new Error("Decision lease expiry must follow claim time.");
      return safe(() =>
        db.transaction(async (tx) => {
          const candidates = await tx
            .select({ id: decisionJobs.id })
            .from(decisionJobs)
            .where(
              and(
                eq(decisionJobs.userId, userId),
                lte(decisionJobs.availableAt, now),
                or(
                  inArray(decisionJobs.status, ["queued", "retryable_failed"]),
                  and(eq(decisionJobs.status, "running"), lte(decisionJobs.leaseExpiresAt, now))
                )
              )
            )
            .orderBy(
              asc(decisionJobs.availableAt),
              asc(decisionJobs.createdAt),
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
              leaseOwner,
              leaseExpiresAt,
              errorCode: null,
              errorMessage: null,
              updatedAt: now,
              completedAt: null
            })
            .where(and(eq(decisionJobs.userId, userId), eq(decisionJobs.id, candidate.id)))
            .returning();
          return rows[0] ? mapDecisionJobRow(rows[0]) : null;
        })
      );
    },
    async appendAttempt(input) {
      const attempt = DecisionJobAttemptSchema.parse(input);
      const rows = await safe(() =>
        db
          .insert(decisionJobAttempts)
          .values({
            userId,
            ...attempt,
            startedAt: instant(attempt.startedAt),
            finishedAt: instant(attempt.finishedAt)
          })
          .returning()
      );
      return mapDecisionAttempt(
        rows[0] ??
          (() => {
            throw new Error("Decision attempt insert returned no row.");
          })()
      );
    },
    async listAttempts(input) {
      const jobId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(decisionJobAttempts)
        .where(and(eq(decisionJobAttempts.userId, userId), eq(decisionJobAttempts.jobId, jobId)))
        .orderBy(asc(decisionJobAttempts.attemptNumber), asc(decisionJobAttempts.id));
      return rows.map(mapDecisionAttempt);
    },
    async fail(input) {
      const id = EntityIdSchema.parse(input.id);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const errorCode = DecisionJobErrorCodeSchema.parse(input.errorCode);
      const failedAt = instant(IsoDateTimeSchema.parse(input.failedAt));
      const retryAt = instant(IsoDateTimeSchema.parse(input.retryAt));
      const errorMessage = input.errorMessage.trim().slice(0, 500);
      if (!errorMessage) throw new Error("Decision failure requires a safe message.");
      const status = input.retryable ? "retryable_failed" : "permanently_failed";
      const rows = await safe(() =>
        db
          .update(decisionJobs)
          .set({
            status,
            availableAt: input.retryable ? retryAt : failedAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode,
            errorMessage,
            updatedAt: failedAt,
            completedAt: input.retryable ? null : failedAt
          })
          .where(
            and(
              eq(decisionJobs.userId, userId),
              eq(decisionJobs.id, id),
              eq(decisionJobs.status, "running"),
              eq(decisionJobs.leaseOwner, leaseOwner)
            )
          )
          .returning()
      );
      if (!rows[0])
        throw new PostgresRepositoryError("conflict", false, "Decision lease was lost.");
      return mapDecisionJobRow(rows[0]);
    },
    async cancel(idInput, timeInput) {
      const id = EntityIdSchema.parse(idInput);
      const cancelledAt = instant(IsoDateTimeSchema.parse(timeInput));
      const rows = await safe(() =>
        db
          .update(decisionJobs)
          .set({
            status: "cancelled",
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: cancelledAt,
            completedAt: cancelledAt
          })
          .where(
            and(
              eq(decisionJobs.userId, userId),
              eq(decisionJobs.id, id),
              inArray(decisionJobs.status, ["queued", "running", "retryable_failed"])
            )
          )
          .returning()
      );
      const row = rows[0] ?? (await decisionJobRepository.getById(id));
      if (!row) throw new Error("Decision job does not exist.");
      return "userId" in row ? mapDecisionJobRow(row) : row;
    }
  };

  const duplicateOverrideRepository: PostgresDecisionRepositories["duplicateOverrides"] = {
    async create(input) {
      const override = DuplicateOverrideSchema.parse(input);
      const payloadHash = sha256Text(canonicalJson(JsonValueSchema.parse(override)));
      await safe(() =>
        db.insert(duplicateOverrides).values({
          userId,
          ...override,
          payloadHash,
          createdAt: instant(override.createdAt)
        })
      );
      return override;
    },
    async revoke(input) {
      const revocation = DuplicateOverrideRevocationSchema.parse(input);
      await safe(() =>
        db.insert(duplicateOverrideRevocations).values({
          userId,
          ...revocation,
          createdAt: instant(revocation.createdAt)
        })
      );
      return revocation;
    },
    async list(input) {
      const searchProfileId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(duplicateOverrides)
        .where(
          and(
            eq(duplicateOverrides.userId, userId),
            eq(duplicateOverrides.searchProfileId, searchProfileId)
          )
        )
        .orderBy(asc(duplicateOverrides.createdAt), asc(duplicateOverrides.id));
      return rows.map(mapOverride);
    },
    async listActive(input) {
      const searchProfileId = EntityIdSchema.parse(input);
      const rows = await db
        .select({ override: duplicateOverrides })
        .from(duplicateOverrides)
        .leftJoin(
          duplicateOverrideRevocations,
          and(
            eq(duplicateOverrideRevocations.userId, duplicateOverrides.userId),
            eq(duplicateOverrideRevocations.overrideId, duplicateOverrides.id)
          )
        )
        .where(
          and(
            eq(duplicateOverrides.userId, userId),
            eq(duplicateOverrides.searchProfileId, searchProfileId),
            isNull(duplicateOverrideRevocations.id)
          )
        )
        .orderBy(asc(duplicateOverrides.createdAt), asc(duplicateOverrides.id));
      return rows.map(({ override }) => mapOverride(override));
    },
    async listRevocations(input) {
      const searchProfileId = EntityIdSchema.parse(input);
      const rows = await db
        .select({ revocation: duplicateOverrideRevocations })
        .from(duplicateOverrideRevocations)
        .innerJoin(
          duplicateOverrides,
          and(
            eq(duplicateOverrideRevocations.userId, duplicateOverrides.userId),
            eq(duplicateOverrideRevocations.overrideId, duplicateOverrides.id)
          )
        )
        .where(
          and(
            eq(duplicateOverrides.userId, userId),
            eq(duplicateOverrides.searchProfileId, searchProfileId)
          )
        )
        .orderBy(asc(duplicateOverrideRevocations.createdAt), asc(duplicateOverrideRevocations.id));
      return rows.map(({ revocation }) => {
        const { userId: _owner, ...value } = revocation;
        return DuplicateOverrideRevocationSchema.parse({
          ...value,
          createdAt: value.createdAt.toISOString()
        });
      });
    }
  };

  return {
    decisionJobs: decisionJobRepository,
    duplicateOverrides: duplicateOverrideRepository,
    decisionHistory
  };
}
