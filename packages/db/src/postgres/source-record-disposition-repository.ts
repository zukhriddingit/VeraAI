import {
  EntityIdSchema,
  ListingSourceRecordDispositionEventSchema,
  type VeraUserId
} from "@vera/domain";
import { and, asc, desc, eq } from "drizzle-orm";

import type { UserRepositories } from "../repositories.ts";
import { mapPostgresError } from "./errors.ts";
import { mapListingSourceRecordDispositionRow } from "./row-mappers.ts";
import { listingSourceRecordDispositions } from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

function instant(value: string): Date {
  return new Date(value);
}

async function databaseOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw mapPostgresError(error);
  }
}

export function createPostgresSourceRecordDispositionRepository(
  db: PostgresExecutor,
  userId: VeraUserId
): UserRepositories["sourceRecordDispositions"] {
  const repository: UserRepositories["sourceRecordDispositions"] = {
    async append(input) {
      const event = ListingSourceRecordDispositionEventSchema.parse(input);
      const inserted = await databaseOperation(() =>
        db
          .insert(listingSourceRecordDispositions)
          .values({
            userId,
            ...event,
            observedAt: instant(event.observedAt)
          })
          .onConflictDoNothing({
            target: [
              listingSourceRecordDispositions.userId,
              listingSourceRecordDispositions.listingSourceRecordId,
              listingSourceRecordDispositions.payloadHash
            ]
          })
          .returning()
      );

      const row =
        inserted[0] ??
        (
          await db
            .select()
            .from(listingSourceRecordDispositions)
            .where(
              and(
                eq(listingSourceRecordDispositions.userId, userId),
                eq(
                  listingSourceRecordDispositions.listingSourceRecordId,
                  event.listingSourceRecordId
                ),
                eq(listingSourceRecordDispositions.payloadHash, event.payloadHash)
              )
            )
            .limit(1)
        )[0];
      if (!row) throw new Error("Source-record disposition append did not resolve a row.");
      return {
        event: mapListingSourceRecordDispositionRow(row),
        inserted: inserted.length === 1
      };
    },

    async getCurrent(listingSourceRecordIdInput) {
      const listingSourceRecordId = EntityIdSchema.parse(listingSourceRecordIdInput);
      const rows = await db
        .select()
        .from(listingSourceRecordDispositions)
        .where(
          and(
            eq(listingSourceRecordDispositions.userId, userId),
            eq(listingSourceRecordDispositions.listingSourceRecordId, listingSourceRecordId)
          )
        )
        .orderBy(
          desc(listingSourceRecordDispositions.observedAt),
          desc(listingSourceRecordDispositions.id)
        )
        .limit(1);
      return rows[0] ? mapListingSourceRecordDispositionRow(rows[0]) : null;
    },

    async listCurrent() {
      const rows = await db
        .select()
        .from(listingSourceRecordDispositions)
        .where(eq(listingSourceRecordDispositions.userId, userId))
        .orderBy(
          asc(listingSourceRecordDispositions.listingSourceRecordId),
          desc(listingSourceRecordDispositions.observedAt),
          desc(listingSourceRecordDispositions.id)
        );
      const current = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        if (!current.has(row.listingSourceRecordId)) current.set(row.listingSourceRecordId, row);
      }
      return [...current.values()].map(mapListingSourceRecordDispositionRow);
    },

    async isEligible(listingSourceRecordId) {
      const current = await repository.getCurrent(listingSourceRecordId);
      return current?.disposition !== "invalid_non_listing";
    }
  };

  return repository;
}
