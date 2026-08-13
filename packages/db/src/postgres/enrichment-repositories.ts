import {
  EntityIdSchema,
  IsoDateTimeSchema,
  ListingEnrichmentManualActionSchema,
  ListingEnrichmentRecordSchema,
  ListingEnrichmentSnapshotSchema,
  type ListingEnrichmentRecord,
  type ListingEnrichmentSnapshot,
  type VeraUserId
} from "@vera/domain";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { sha256Text } from "../hashing.ts";
import {
  RepositoryIneligibleListingError,
  RepositoryJobLeaseError,
  type AsyncRepository,
  type ListingEnrichmentRepository
} from "../repositories.ts";
import { mapPostgresError } from "./errors.ts";
import {
  canonicalListingSources,
  listingEnrichmentSnapshots,
  listingEnrichmentStates,
  listingPhotos,
  listingSourceRecordDispositions
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

type StateRow = typeof listingEnrichmentStates.$inferSelect;
type SnapshotRow = typeof listingEnrichmentSnapshots.$inferSelect;

function instant(value: string): Date {
  return new Date(IsoDateTimeSchema.parse(value));
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function mapPostgresEnrichmentStateRow(row: StateRow): ListingEnrichmentRecord {
  return ListingEnrichmentRecordSchema.parse({
    listingSourceRecordId: row.listingSourceRecordId,
    state: row.state,
    requestedReason: row.requestedReason,
    attemptCount: row.attemptCount,
    availableAt: iso(row.availableAt),
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    currentSnapshotId: row.currentSnapshotId,
    manualAction: row.manualAction,
    lastErrorCode: row.lastErrorCode,
    requestedAt: iso(row.requestedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    updatedAt: row.updatedAt.toISOString()
  });
}

export function mapPostgresEnrichmentSnapshotRow(row: SnapshotRow): ListingEnrichmentSnapshot {
  return ListingEnrichmentSnapshotSchema.parse({
    id: row.id,
    listingSourceRecordId: row.listingSourceRecordId,
    source: row.source,
    details: row.details,
    photos: row.photos,
    fieldProvenance: row.fieldProvenance,
    completeness: row.completeness,
    observedAt: row.observedAt.toISOString(),
    freshUntil: row.freshUntil.toISOString(),
    createdAt: row.createdAt.toISOString()
  });
}

function safeErrorCode(value: string): string {
  const code = value.trim();
  if (!/^[a-z][a-z0-9_.-]{0,99}$/u.test(code)) throw new Error("Invalid enrichment error code.");
  return code;
}

function observedPhotoRows(userId: VeraUserId, snapshot: ListingEnrichmentSnapshot) {
  return snapshot.photos.map((photo) => ({
    userId,
    id: `photo-enrichment:${sha256Text(
      `${userId}:${snapshot.listingSourceRecordId}:${photo.sourceUrl}:${String(photo.position)}`
    ).slice(0, 40)}`,
    listingSourceRecordId: snapshot.listingSourceRecordId,
    sourceUrl: photo.sourceUrl,
    fixtureAssetLabel: null,
    byteHash: photo.safeContentHash,
    perceptualHash: null,
    byteSize: null,
    width: photo.width,
    height: photo.height,
    mimeType: null,
    perceptualHashVersion: null,
    position: photo.position,
    observedAt: instant(photo.observedAt)
  }));
}

async function isEligibleSourceRecord(
  db: PostgresExecutor,
  userId: VeraUserId,
  listingSourceRecordId: string
): Promise<boolean> {
  const rows = await db
    .select({ disposition: listingSourceRecordDispositions.disposition })
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
  return rows[0]?.disposition !== "invalid_non_listing";
}

export function createPostgresEnrichmentRepository(
  db: PostgresExecutor,
  userId: VeraUserId
): AsyncRepository<ListingEnrichmentRepository> {
  const repository: AsyncRepository<ListingEnrichmentRepository> = {
    async getBySourceRecordId(input) {
      const sourceRecordId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(listingEnrichmentStates)
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            eq(listingEnrichmentStates.listingSourceRecordId, sourceRecordId)
          )
        )
        .limit(1);
      return rows[0] ? mapPostgresEnrichmentStateRow(rows[0]) : null;
    },
    async listByCanonicalListingId(input) {
      const canonicalListingId = EntityIdSchema.parse(input);
      const rows = await db
        .select({ state: listingEnrichmentStates })
        .from(canonicalListingSources)
        .leftJoin(
          listingEnrichmentStates,
          and(
            eq(canonicalListingSources.userId, listingEnrichmentStates.userId),
            eq(
              canonicalListingSources.listingSourceRecordId,
              listingEnrichmentStates.listingSourceRecordId
            )
          )
        )
        .where(
          and(
            eq(canonicalListingSources.userId, userId),
            eq(canonicalListingSources.canonicalListingId, canonicalListingId),
            sql`coalesce((
              select ${listingSourceRecordDispositions.disposition}
              from ${listingSourceRecordDispositions}
              where ${listingSourceRecordDispositions.userId} = ${canonicalListingSources.userId}
                and ${listingSourceRecordDispositions.listingSourceRecordId} = ${canonicalListingSources.listingSourceRecordId}
              order by ${listingSourceRecordDispositions.observedAt} desc,
                ${listingSourceRecordDispositions.id} desc
              limit 1
            ), 'accepted') <> 'invalid_non_listing'`
          )
        )
        .orderBy(asc(canonicalListingSources.listingSourceRecordId));
      return rows.flatMap(({ state }) =>
        state === null ? [] : [mapPostgresEnrichmentStateRow(state)]
      );
    },
    async getCurrentSnapshot(input) {
      const sourceRecordId = EntityIdSchema.parse(input);
      const rows = await db
        .select({ snapshot: listingEnrichmentSnapshots })
        .from(listingEnrichmentStates)
        .innerJoin(
          listingEnrichmentSnapshots,
          and(
            eq(listingEnrichmentStates.userId, listingEnrichmentSnapshots.userId),
            eq(listingEnrichmentStates.currentSnapshotId, listingEnrichmentSnapshots.id)
          )
        )
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            eq(listingEnrichmentStates.listingSourceRecordId, sourceRecordId)
          )
        )
        .limit(1);
      return rows[0] ? mapPostgresEnrichmentSnapshotRow(rows[0].snapshot) : null;
    },
    async projectCurrentObservedPhotos() {
      const rows = await db
        .select({ snapshot: listingEnrichmentSnapshots })
        .from(listingEnrichmentStates)
        .innerJoin(
          listingEnrichmentSnapshots,
          and(
            eq(listingEnrichmentStates.userId, listingEnrichmentSnapshots.userId),
            eq(listingEnrichmentStates.currentSnapshotId, listingEnrichmentSnapshots.id)
          )
        )
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            sql`coalesce((
              select ${listingSourceRecordDispositions.disposition}
              from ${listingSourceRecordDispositions}
              where ${listingSourceRecordDispositions.userId} = ${listingEnrichmentStates.userId}
                and ${listingSourceRecordDispositions.listingSourceRecordId} = ${listingEnrichmentStates.listingSourceRecordId}
              order by ${listingSourceRecordDispositions.observedAt} desc,
                ${listingSourceRecordDispositions.id} desc
              limit 1
            ), 'accepted') <> 'invalid_non_listing'`
          )
        );
      const photos = rows.flatMap(({ snapshot }) =>
        observedPhotoRows(userId, mapPostgresEnrichmentSnapshotRow(snapshot))
      );
      if (photos.length === 0) return 0;
      const inserted = await db
        .insert(listingPhotos)
        .values(photos)
        .onConflictDoNothing()
        .returning({ id: listingPhotos.id });
      return inserted.length;
    },
    async markExpiredStale(input) {
      const now = instant(input);
      const rows = await db
        .update(listingEnrichmentStates)
        .set({ state: "stale", updatedAt: now })
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            inArray(listingEnrichmentStates.state, ["enriched", "partial"]),
            sql`exists (
              select 1 from ${listingEnrichmentSnapshots}
              where ${listingEnrichmentSnapshots.userId} = ${listingEnrichmentStates.userId}
                and ${listingEnrichmentSnapshots.id} = ${listingEnrichmentStates.currentSnapshotId}
                and ${listingEnrichmentSnapshots.freshUntil} <= ${now}
            )`
          )
        )
        .returning({ listingSourceRecordId: listingEnrichmentStates.listingSourceRecordId });
      return rows.length;
    },
    async queue(input) {
      const listingSourceRecordId = EntityIdSchema.parse(input.listingSourceRecordId);
      if (!(await isEligibleSourceRecord(db, userId, listingSourceRecordId))) {
        throw new RepositoryIneligibleListingError(listingSourceRecordId);
      }
      const requestedAt = IsoDateTimeSchema.parse(input.requestedAt);
      const current = await repository.getBySourceRecordId(listingSourceRecordId);
      const snapshot = await repository.getCurrentSnapshot(listingSourceRecordId);
      if (current?.state === "queued" || current?.state === "enriching") {
        return { record: current, queued: false, reusedFresh: false };
      }
      if (
        !input.force &&
        (current?.state === "blocked_manual_action" || current?.state === "failed")
      ) {
        return { record: current, queued: false, reusedFresh: false };
      }
      const fresh =
        !input.force &&
        snapshot !== null &&
        Date.parse(snapshot.freshUntil) > Date.parse(requestedAt) &&
        (current?.state === "enriched" || current?.state === "partial");
      if (current && fresh) return { record: current, queued: false, reusedFresh: true };
      const time = instant(requestedAt);
      try {
        const rows = await db
          .insert(listingEnrichmentStates)
          .values({
            userId,
            listingSourceRecordId,
            state: "queued",
            requestedReason: input.reason,
            attemptCount: 0,
            availableAt: time,
            leaseOwner: null,
            leaseExpiresAt: null,
            currentSnapshotId: current?.currentSnapshotId ?? null,
            manualAction: null,
            lastErrorCode: null,
            requestedAt: time,
            startedAt: null,
            completedAt: null,
            updatedAt: time
          })
          .onConflictDoUpdate({
            target: [listingEnrichmentStates.userId, listingEnrichmentStates.listingSourceRecordId],
            set: {
              state: "queued",
              requestedReason: input.reason,
              attemptCount: 0,
              availableAt: time,
              leaseOwner: null,
              leaseExpiresAt: null,
              manualAction: null,
              lastErrorCode: null,
              requestedAt: time,
              startedAt: null,
              completedAt: null,
              updatedAt: time
            }
          })
          .returning();
        return {
          record: mapPostgresEnrichmentStateRow(rows[0]!),
          queued: true,
          reusedFresh: false
        };
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async claim(input) {
      const now = instant(input.now);
      const leaseExpiresAt = instant(input.leaseExpiresAt);
      if (leaseExpiresAt <= now) throw new Error("Enrichment lease expiry must follow claim time.");
      try {
        const candidates = await db
          .select({ listingSourceRecordId: listingEnrichmentStates.listingSourceRecordId })
          .from(listingEnrichmentStates)
          .where(
            and(
              eq(listingEnrichmentStates.userId, userId),
              or(
                and(
                  inArray(listingEnrichmentStates.state, ["queued", "stale"]),
                  lte(listingEnrichmentStates.availableAt, now)
                ),
                and(
                  eq(listingEnrichmentStates.state, "enriching"),
                  lte(listingEnrichmentStates.leaseExpiresAt, now)
                )
              ),
              or(
                isNull(listingEnrichmentStates.leaseExpiresAt),
                lte(listingEnrichmentStates.leaseExpiresAt, now)
              ),
              lte(listingEnrichmentStates.attemptCount, 2),
              sql`coalesce((
                select ${listingSourceRecordDispositions.disposition}
                from ${listingSourceRecordDispositions}
                where ${listingSourceRecordDispositions.userId} = ${listingEnrichmentStates.userId}
                  and ${listingSourceRecordDispositions.listingSourceRecordId} = ${listingEnrichmentStates.listingSourceRecordId}
                order by ${listingSourceRecordDispositions.observedAt} desc,
                  ${listingSourceRecordDispositions.id} desc
                limit 1
              ), 'accepted') <> 'invalid_non_listing'`
            )
          )
          .orderBy(
            asc(listingEnrichmentStates.availableAt),
            asc(listingEnrichmentStates.updatedAt),
            asc(listingEnrichmentStates.listingSourceRecordId)
          )
          .limit(1)
          .for("update", { skipLocked: true });
        const candidate = candidates[0];
        if (!candidate) return null;
        const rows = await db
          .update(listingEnrichmentStates)
          .set({
            state: "enriching",
            attemptCount: sql`${listingEnrichmentStates.attemptCount} + 1`,
            leaseOwner: input.leaseOwner,
            leaseExpiresAt,
            startedAt: now,
            manualAction: null,
            lastErrorCode: null,
            updatedAt: now
          })
          .where(
            and(
              eq(listingEnrichmentStates.userId, userId),
              eq(listingEnrichmentStates.listingSourceRecordId, candidate.listingSourceRecordId),
              inArray(listingEnrichmentStates.state, ["queued", "stale", "enriching"])
            )
          )
          .returning();
        return rows[0] ? mapPostgresEnrichmentStateRow(rows[0]) : null;
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async complete(input) {
      const sourceRecordId = EntityIdSchema.parse(input.listingSourceRecordId);
      const snapshot = ListingEnrichmentSnapshotSchema.parse(input.snapshot);
      if (snapshot.listingSourceRecordId !== sourceRecordId) {
        throw new Error("Enrichment snapshot source record mismatch.");
      }
      try {
        const rows = await db.transaction(async (transaction) => {
          if (!(await isEligibleSourceRecord(transaction, userId, sourceRecordId))) {
            throw new RepositoryIneligibleListingError(sourceRecordId);
          }
          await transaction
            .insert(listingEnrichmentSnapshots)
            .values({
              userId,
              id: snapshot.id,
              listingSourceRecordId: snapshot.listingSourceRecordId,
              source: snapshot.source,
              details: snapshot.details,
              photos: [...snapshot.photos],
              fieldProvenance: [...snapshot.fieldProvenance],
              completeness: snapshot.completeness,
              observedAt: instant(snapshot.observedAt),
              freshUntil: instant(snapshot.freshUntil),
              createdAt: instant(snapshot.createdAt)
            })
            .onConflictDoNothing({
              target: [listingEnrichmentSnapshots.userId, listingEnrichmentSnapshots.id]
            });
          if (snapshot.photos.length > 0) {
            await transaction
              .insert(listingPhotos)
              .values(observedPhotoRows(userId, snapshot))
              .onConflictDoNothing();
          }
          return transaction
            .update(listingEnrichmentStates)
            .set({
              state: input.state,
              leaseOwner: null,
              leaseExpiresAt: null,
              currentSnapshotId: snapshot.id,
              manualAction: null,
              lastErrorCode: null,
              completedAt: instant(snapshot.observedAt),
              updatedAt: instant(snapshot.observedAt)
            })
            .where(
              and(
                eq(listingEnrichmentStates.userId, userId),
                eq(listingEnrichmentStates.listingSourceRecordId, sourceRecordId),
                eq(listingEnrichmentStates.state, "enriching"),
                eq(listingEnrichmentStates.leaseOwner, input.leaseOwner)
              )
            )
            .returning();
        });
        if (!rows[0]) throw new RepositoryJobLeaseError(sourceRecordId);
        return mapPostgresEnrichmentStateRow(rows[0]);
      } catch (error: unknown) {
        if (
          error instanceof RepositoryJobLeaseError ||
          error instanceof RepositoryIneligibleListingError
        ) {
          throw error;
        }
        throw mapPostgresError(error);
      }
    },
    async block(input) {
      const sourceRecordId = EntityIdSchema.parse(input.listingSourceRecordId);
      const completedAt = instant(input.completedAt);
      const manualAction = ListingEnrichmentManualActionSchema.parse(input.manualAction);
      const rows = await db
        .update(listingEnrichmentStates)
        .set({
          state: "blocked_manual_action",
          leaseOwner: null,
          leaseExpiresAt: null,
          manualAction,
          completedAt,
          updatedAt: completedAt
        })
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            eq(listingEnrichmentStates.listingSourceRecordId, sourceRecordId),
            eq(listingEnrichmentStates.state, "enriching"),
            eq(listingEnrichmentStates.leaseOwner, input.leaseOwner)
          )
        )
        .returning();
      if (!rows[0]) throw new RepositoryJobLeaseError(sourceRecordId);
      return mapPostgresEnrichmentStateRow(rows[0]);
    },
    async fail(input) {
      const sourceRecordId = EntityIdSchema.parse(input.listingSourceRecordId);
      const failedAt = instant(input.failedAt);
      const retryAt = instant(input.retryAt);
      const current = await repository.getBySourceRecordId(sourceRecordId);
      if (!current || current.state !== "enriching" || current.leaseOwner !== input.leaseOwner) {
        throw new RepositoryJobLeaseError(sourceRecordId);
      }
      const retry = input.retryable && current.attemptCount < 3;
      if (retry && retryAt <= failedAt)
        throw new Error("Enrichment retry must follow failure time.");
      const rows = await db
        .update(listingEnrichmentStates)
        .set({
          state: retry ? "queued" : "failed",
          availableAt: retry ? retryAt : null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: safeErrorCode(input.errorCode),
          completedAt: retry ? null : failedAt,
          updatedAt: failedAt
        })
        .where(
          and(
            eq(listingEnrichmentStates.userId, userId),
            eq(listingEnrichmentStates.listingSourceRecordId, sourceRecordId),
            eq(listingEnrichmentStates.state, "enriching"),
            eq(listingEnrichmentStates.leaseOwner, input.leaseOwner)
          )
        )
        .returning();
      if (!rows[0]) throw new RepositoryJobLeaseError(sourceRecordId);
      return mapPostgresEnrichmentStateRow(rows[0]);
    }
  };
  return repository;
}
