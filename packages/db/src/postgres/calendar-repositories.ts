import {
  AvailabilityCheckSchema,
  AvailabilityRuleSetSchema,
  CalendarHoldSchema,
  CalendarHoldStateSchema,
  CalendarOAuthStateSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  type CalendarHoldState,
  type VeraUserId
} from "@vera/domain";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { RepositoryNotFoundError, type UserRepositories } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import {
  mapAvailabilityCheckRow,
  mapAvailabilityRuleSetRow,
  mapCalendarHoldRow,
  mapCalendarOAuthStateRow
} from "./row-mappers.ts";
import {
  availabilityChecks,
  availabilityRuleSets,
  calendarHolds,
  calendarOauthStates
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type CalendarPostgresRepositories = Pick<
  UserRepositories,
  "availabilityRuleSets" | "calendarOAuthStates" | "availabilityChecks" | "calendarHolds"
>;

const ALLOWED_HOLD_TRANSITIONS = {
  approval_pending: ["approved", "cancelled_internal"],
  approved: ["creating", "cancelled_internal"],
  creating: ["created", "retryable_failed", "permanently_failed", "cancelled_internal"],
  created: ["cancelled_internal"],
  retryable_failed: ["creating", "permanently_failed", "cancelled_internal"],
  permanently_failed: [],
  cancelled_internal: []
} as const satisfies Record<CalendarHoldState, readonly CalendarHoldState[]>;

function instant(value: string): Date;
function instant(value: string | null): Date | null;
function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new Error(message);
  return row;
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    if (error instanceof PostgresRepositoryError || error instanceof RepositoryNotFoundError) {
      throw error;
    }
    throw mapPostgresError(error);
  }
}

function verifierColumns(value: ReturnType<typeof CalendarOAuthStateSchema.parse>) {
  const verifier = value.encryptedPkceVerifier;
  return {
    credentialVersion: verifier.version,
    credentialAlgorithm: verifier.algorithm,
    credentialKeyId: verifier.keyId,
    credentialNonce: Buffer.from(verifier.nonce, "base64"),
    credentialCiphertext: Buffer.from(verifier.ciphertext, "base64"),
    credentialAuthenticationTag: Buffer.from(verifier.authenticationTag, "base64")
  };
}

function assertHoldTransition(current: CalendarHoldState, requested: CalendarHoldState): void {
  const allowed: readonly CalendarHoldState[] = ALLOWED_HOLD_TRANSITIONS[current];
  if (!allowed.includes(requested)) {
    throw new PostgresRepositoryError(
      "conflict",
      false,
      `Calendar hold cannot transition from ${current} to ${requested}.`
    );
  }
}

export function createPostgresCalendarRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): CalendarPostgresRepositories {
  const ruleSets: CalendarPostgresRepositories["availabilityRuleSets"] = {
    async upsertCurrent(input) {
      const value = AvailabilityRuleSetSchema.parse(input);
      const currentRows = await db
        .select()
        .from(availabilityRuleSets)
        .where(eq(availabilityRuleSets.userId, userId))
        .limit(1);
      const current = currentRows[0];
      if (current && current.id !== value.id) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "The current availability rule set has a different stable identifier."
        );
      }

      const columns = {
        timeZone: value.timeZone,
        weeklyIntervals: value.weeklyIntervals,
        durationMinutes: value.durationMinutes,
        minimumNoticeMinutes: value.minimumNoticeMinutes,
        travelMinutes: value.travelMinutes,
        bufferMinutes: value.bufferMinutes,
        remindersMinutesBeforeStart: value.remindersMinutesBeforeStart,
        conflictCheckingEnabled: value.conflictCheckingEnabled,
        selectedCalendarIds: value.calendarIds,
        schemaVersion: value.schemaVersion,
        updatedAt: instant(value.updatedAt)
      };
      const rows = await operation(() =>
        current
          ? db
              .update(availabilityRuleSets)
              .set(columns)
              .where(
                and(eq(availabilityRuleSets.userId, userId), eq(availabilityRuleSets.id, value.id))
              )
              .returning()
          : db
              .insert(availabilityRuleSets)
              .values({
                userId,
                id: value.id,
                ...columns,
                createdAt: instant(value.createdAt)
              })
              .returning()
      );
      return mapAvailabilityRuleSetRow(
        required(rows[0], "Availability rule-set upsert returned no row.")
      );
    },
    async getCurrent() {
      const rows = await db
        .select()
        .from(availabilityRuleSets)
        .where(eq(availabilityRuleSets.userId, userId))
        .limit(1);
      return rows[0] ? mapAvailabilityRuleSetRow(rows[0]) : null;
    }
  };

  const oauthStates: CalendarPostgresRepositories["calendarOAuthStates"] = {
    async insert(input) {
      const value = CalendarOAuthStateSchema.parse(input);
      if (value.userId !== userId) {
        throw new Error("Calendar OAuth state ownership must match the scoped repository user.");
      }
      const rows = await operation(() =>
        db
          .insert(calendarOauthStates)
          .values({
            userId,
            id: value.id,
            stateHash: value.stateHash,
            capability: value.capability,
            requestedCalendarScopes: value.requestedCalendarScopes,
            ...verifierColumns(value),
            redirectUriHash: value.redirectUriHash,
            returnTo: value.returnTo,
            expiresAt: instant(value.expiresAt),
            consumedAt: instant(value.consumedAt),
            createdAt: instant(value.createdAt)
          })
          .returning()
      );
      return mapCalendarOAuthStateRow(
        required(rows[0], "Calendar OAuth state insert returned no row.")
      );
    },
    async consume(input) {
      const stateHash = Sha256Schema.parse(input.stateHash);
      const consumedAt = IsoDateTimeSchema.parse(input.consumedAt);
      const rows = await operation(() =>
        db
          .update(calendarOauthStates)
          .set({ consumedAt: instant(consumedAt) })
          .where(
            and(
              eq(calendarOauthStates.userId, userId),
              eq(calendarOauthStates.stateHash, stateHash),
              isNull(calendarOauthStates.consumedAt),
              gt(calendarOauthStates.expiresAt, instant(consumedAt))
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Calendar OAuth state is missing, expired, already consumed, or belongs to another user."
        );
      }
      return mapCalendarOAuthStateRow(row);
    }
  };

  const checks: CalendarPostgresRepositories["availabilityChecks"] = {
    async append(input) {
      const value = AvailabilityCheckSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(availabilityChecks)
          .values({
            userId,
            ...value,
            rangeStartsAt: instant(value.rangeStartsAt),
            rangeEndsAt: instant(value.rangeEndsAt),
            checkedAt: instant(value.checkedAt),
            createdAt: instant(value.createdAt)
          })
          .returning()
      );
      return mapAvailabilityCheckRow(
        required(rows[0], "Availability check append returned no row.")
      );
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(availabilityChecks)
        .where(and(eq(availabilityChecks.userId, userId), eq(availabilityChecks.id, id)))
        .limit(1);
      return rows[0] ? mapAvailabilityCheckRow(rows[0]) : null;
    },
    async listRecent(limitInput) {
      const limit = Math.trunc(limitInput);
      if (limit < 1 || limit > 500) throw new Error("Availability check limit must be 1–500.");
      const rows = await db
        .select()
        .from(availabilityChecks)
        .where(eq(availabilityChecks.userId, userId))
        .orderBy(desc(availabilityChecks.createdAt), desc(availabilityChecks.id))
        .limit(limit);
      return rows.map(mapAvailabilityCheckRow);
    }
  };

  const holds: CalendarPostgresRepositories["calendarHolds"] = {
    async insert(input) {
      const value = CalendarHoldSchema.parse(input);
      const inserted = await operation(() =>
        db
          .insert(calendarHolds)
          .values({
            userId,
            ...value,
            calendarId: "primary",
            createdAt: instant(value.createdAt),
            updatedAt: instant(value.updatedAt),
            completedAt: instant(value.completedAt)
          })
          .onConflictDoNothing({ target: [calendarHolds.userId, calendarHolds.idempotencyKey] })
          .returning()
      );
      const row =
        inserted[0] ??
        (
          await db
            .select()
            .from(calendarHolds)
            .where(
              and(
                eq(calendarHolds.userId, userId),
                eq(calendarHolds.idempotencyKey, value.idempotencyKey)
              )
            )
            .limit(1)
        )[0];
      const persisted = mapCalendarHoldRow(
        required(row, "Calendar hold insert did not resolve a row.")
      );
      if (
        persisted.id !== value.id ||
        persisted.payloadHash !== value.payloadHash ||
        persisted.viewingId !== value.viewingId ||
        persisted.approvalId !== value.approvalId ||
        persisted.availabilityCheckId !== value.availabilityCheckId ||
        persisted.googleEventId !== value.googleEventId ||
        persisted.conflictCheckOverride !== value.conflictCheckOverride ||
        persisted.conflictCheckOverrideReason !== value.conflictCheckOverrideReason
      ) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "The Calendar hold idempotency key belongs to a different immutable payload."
        );
      }
      return persisted;
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(calendarHolds)
        .where(and(eq(calendarHolds.userId, userId), eq(calendarHolds.id, id)))
        .limit(1);
      return rows[0] ? mapCalendarHoldRow(rows[0]) : null;
    },
    async getByIdempotencyKey(input) {
      const key = Sha256Schema.parse(input);
      const rows = await db
        .select()
        .from(calendarHolds)
        .where(and(eq(calendarHolds.userId, userId), eq(calendarHolds.idempotencyKey, key)))
        .limit(1);
      return rows[0] ? mapCalendarHoldRow(rows[0]) : null;
    },
    async listByViewingId(input) {
      const viewingId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(calendarHolds)
        .where(and(eq(calendarHolds.userId, userId), eq(calendarHolds.viewingId, viewingId)))
        .orderBy(desc(calendarHolds.createdAt), desc(calendarHolds.id));
      return rows.map(mapCalendarHoldRow);
    },
    async transition(idInput, expectedInput, requestedInput, atInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const expected = CalendarHoldStateSchema.parse(expectedInput);
      const requested = CalendarHoldStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      assertHoldTransition(expected, requested);
      const current = await holds.getById(id);
      if (!current) throw new RepositoryNotFoundError("CalendarHold", id);
      if (current.state !== expected) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Calendar hold state changed concurrently."
        );
      }
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new Error("Calendar hold transition time cannot precede its current update time.");
      }
      const terminal = ["created", "permanently_failed", "cancelled_internal"].includes(requested);
      const failed = requested === "retryable_failed" || requested === "permanently_failed";
      const candidate = CalendarHoldSchema.parse({
        ...current,
        state: requested,
        approvalId: patch.approvalId !== undefined ? patch.approvalId : current.approvalId,
        providerEventReference:
          patch.providerEventReference ??
          (requested === "created" || requested === "cancelled_internal"
            ? current.providerEventReference
            : null),
        availabilityCheckId: patch.availabilityCheckId ?? current.availabilityCheckId,
        safeErrorCode: failed ? (patch.safeErrorCode ?? current.safeErrorCode) : null,
        updatedAt: at,
        completedAt: terminal ? (patch.completedAt ?? at) : null
      });
      const rows = await operation(() =>
        db
          .update(calendarHolds)
          .set({
            state: candidate.state,
            approvalId: candidate.approvalId,
            providerEventReference: candidate.providerEventReference,
            availabilityCheckId: candidate.availabilityCheckId,
            safeErrorCode: candidate.safeErrorCode,
            updatedAt: instant(candidate.updatedAt),
            completedAt: instant(candidate.completedAt)
          })
          .where(
            and(
              eq(calendarHolds.userId, userId),
              eq(calendarHolds.id, id),
              eq(calendarHolds.state, expected),
              eq(calendarHolds.updatedAt, instant(current.updatedAt))
            )
          )
          .returning()
      );
      if (!rows[0]) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Calendar hold state changed concurrently."
        );
      }
      return mapCalendarHoldRow(rows[0]);
    }
  };

  return {
    availabilityRuleSets: ruleSets,
    calendarOAuthStates: oauthStates,
    availabilityChecks: checks,
    calendarHolds: holds
  };
}
