import {
  EntityIdSchema,
  GmailAlertCursorSchema,
  GmailAlertExternalReferenceRecordSchema,
  GmailOAuthStateSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  VeraUserIdSchema,
  type VeraUserId
} from "@vera/domain";
import { and, eq, gt, isNull } from "drizzle-orm";

import type { UserRepositories } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import { gmailAlertCursors, gmailAlertExternalReferences, gmailOauthStates } from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type GmailPostgresRepositories = Pick<
  UserRepositories,
  "gmailOAuthStates" | "gmailAlertCursors" | "gmailAlertExternalReferences"
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

function mapOAuthState(row: typeof gmailOauthStates.$inferSelect) {
  return GmailOAuthStateSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null
  });
}

function mapCursor(row: typeof gmailAlertCursors.$inferSelect) {
  return GmailAlertCursorSchema.parse({
    ...row,
    lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString()
  });
}

function mapExternalReference(row: typeof gmailAlertExternalReferences.$inferSelect) {
  return GmailAlertExternalReferenceRecordSchema.parse({
    ...row,
    importedAt: row.importedAt.toISOString()
  });
}

export function createPostgresGmailRepositories(
  db: PostgresExecutor,
  userIdInput: VeraUserId
): GmailPostgresRepositories {
  const userId = VeraUserIdSchema.parse(userIdInput);

  const gmailOAuthStateRepository: GmailPostgresRepositories["gmailOAuthStates"] = {
    async insert(input) {
      const state = GmailOAuthStateSchema.parse(input);
      assertOwner(state.userId, userId);
      const rows = await operation(() =>
        db
          .insert(gmailOauthStates)
          .values({
            ...state,
            createdAt: instant(state.createdAt),
            expiresAt: instant(state.expiresAt),
            consumedAt: state.consumedAt === null ? null : instant(state.consumedAt)
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Gmail OAuth state insert returned no row.");
      return mapOAuthState(row);
    },
    async consume(stateHashInput, consumedAtInput) {
      const stateHash = Sha256Schema.parse(stateHashInput);
      const consumedAt = instant(IsoDateTimeSchema.parse(consumedAtInput));
      const rows = await operation(() =>
        db
          .update(gmailOauthStates)
          .set({ consumedAt })
          .where(
            and(
              eq(gmailOauthStates.userId, userId),
              eq(gmailOauthStates.stateHash, stateHash),
              isNull(gmailOauthStates.consumedAt),
              gt(gmailOauthStates.expiresAt, consumedAt)
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row)
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Gmail OAuth state is invalid, expired, or already consumed."
        );
      return mapOAuthState(row);
    }
  };

  const gmailAlertCursorRepository: GmailPostgresRepositories["gmailAlertCursors"] = {
    async getBySourceConfigurationId(input) {
      const sourceConfigurationId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(gmailAlertCursors)
        .where(
          and(
            eq(gmailAlertCursors.userId, userId),
            eq(gmailAlertCursors.sourceConfigurationId, sourceConfigurationId)
          )
        )
        .limit(1);
      return rows[0] ? mapCursor(rows[0]) : null;
    },
    async upsert(input) {
      const cursor = GmailAlertCursorSchema.parse(input);
      assertOwner(cursor.userId, userId);
      const rows = await operation(() =>
        db
          .insert(gmailAlertCursors)
          .values({
            ...cursor,
            lastSuccessfulAt:
              cursor.lastSuccessfulAt === null ? null : instant(cursor.lastSuccessfulAt),
            updatedAt: instant(cursor.updatedAt)
          })
          .onConflictDoUpdate({
            target: [gmailAlertCursors.userId, gmailAlertCursors.sourceConfigurationId],
            set: {
              historyId: cursor.historyId,
              lastSuccessfulAt:
                cursor.lastSuccessfulAt === null ? null : instant(cursor.lastSuccessfulAt),
              updatedAt: instant(cursor.updatedAt)
            }
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Gmail alert cursor upsert returned no row.");
      return mapCursor(row);
    }
  };

  const gmailAlertExternalReferenceRepository: GmailPostgresRepositories["gmailAlertExternalReferences"] =
    {
      async insert(input) {
        const reference = GmailAlertExternalReferenceRecordSchema.parse(input);
        assertOwner(reference.userId, userId);
        const rows = await operation(() =>
          db
            .insert(gmailAlertExternalReferences)
            .values({ ...reference, importedAt: instant(reference.importedAt) })
            .returning()
        );
        const row = rows[0];
        if (!row) throw new Error("Gmail alert reference insert returned no row.");
        return mapExternalReference(row);
      },
      async getByMessageId(input) {
        const messageId = input.trim();
        if (messageId.length < 1 || messageId.length > 256)
          throw new Error("Invalid Gmail message ID.");
        const rows = await db
          .select()
          .from(gmailAlertExternalReferences)
          .where(
            and(
              eq(gmailAlertExternalReferences.userId, userId),
              eq(gmailAlertExternalReferences.messageId, messageId)
            )
          )
          .limit(1);
        return rows[0] ? mapExternalReference(rows[0]) : null;
      }
    };

  return {
    gmailOAuthStates: gmailOAuthStateRepository,
    gmailAlertCursors: gmailAlertCursorRepository,
    gmailAlertExternalReferences: gmailAlertExternalReferenceRepository
  };
}
