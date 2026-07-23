import {
  ActivityEventSchema,
  EntityIdSchema,
  FieldProvenanceSchema,
  ListingExtractionRunSchema,
  ListingPhotoSchema,
  ListingSourceRecordSchema,
  RawListingCaptureSchema,
  SearchProfileSchema,
  VeraUserIdSchema,
  type VeraUserId
} from "@vera/domain";
import { and, asc, count, eq } from "drizzle-orm";

import { computeRawContentHash, computeRawImportIdempotencyKey } from "../hashing.ts";
import type { UserRepositories, UserRepositoryProvider } from "../repositories.ts";
import type { PostgresConnection } from "./connection.ts";
import { createPostgresDecisionReconciliation } from "./decision-reconciliation.ts";
import { createPostgresDecisionRepositories } from "./decision-repositories.ts";
import { createPostgresCalendarRepositories } from "./calendar-repositories.ts";
import { createPostgresBrowserRepositories } from "./browser-repositories.ts";
import { createPostgresGmailRepositories } from "./gmail-repositories.ts";
import { mapPostgresError } from "./errors.ts";
import { createPostgresIntegrationConnectionRepository } from "./integration-repository.ts";
import { createPostgresIntegrationRefreshLeaseRepository } from "./integration-refresh-leases.ts";
import { createPostgresMaritimeRepositories } from "./maritime-repositories.ts";
import { createPostgresNotificationRepositories } from "./notification-repositories.ts";
import { createPostgresPolicyReader } from "./policy-repository.ts";
import {
  mapActivityEventRow,
  mapFieldProvenanceRow,
  mapListingExtractionRow,
  mapListingPhotoRow,
  mapListingSourceRecordRow,
  mapRawListingRow,
  mapSearchProfileRow
} from "./row-mappers.ts";
import {
  activityEvents,
  canonicalListingSources,
  fieldProvenance,
  listingExtractions,
  listingPhotos,
  listingSourceRecords,
  rawListings,
  searchProfiles
} from "./schema.ts";
import { createStandardPostgresRepositories } from "./standard-repositories.ts";
import type { PostgresExecutor } from "./types.ts";

export type CorePostgresRepositories = Pick<
  UserRepositories,
  | "searchProfiles"
  | "rawListings"
  | "sourceRecords"
  | "listingPhotos"
  | "fieldProvenance"
  | "listingExtractions"
  | "activityEvents"
>;

function toMicrodegrees(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000_000);
}

function toMeters(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000);
}

function toHalfUnits(value: number | null): number | null {
  return value === null ? null : value * 2;
}

function instant(value: string): Date;
function instant(value: string | null): Date | null;
function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new Error(message);
  return row;
}

async function databaseOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

export function createCorePostgresRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): CorePostgresRepositories {
  const searchProfileRepository: CorePostgresRepositories["searchProfiles"] = {
    async insert(profileInput) {
      const profile = SearchProfileSchema.parse(profileInput);
      const rows = await databaseOperation(() =>
        db
          .insert(searchProfiles)
          .values({
            userId,
            id: profile.id,
            name: profile.name,
            version: profile.version,
            locationText: profile.locationText,
            centerLatitude: toMicrodegrees(profile.centerLatitude),
            centerLongitude: toMicrodegrees(profile.centerLongitude),
            radiusMeters: toMeters(profile.radiusKilometers),
            minimumBedrooms: toHalfUnits(profile.minimumBedrooms),
            minimumBathrooms: toHalfUnits(profile.minimumBathrooms),
            targetMonthlyTotalCents: profile.targetMonthlyTotalCents,
            absoluteMonthlyMaximumCents: profile.absoluteMonthlyMaximumCents,
            moveInEarliest: profile.moveInEarliest,
            moveInLatest: profile.moveInLatest,
            petRequirements: profile.petRequirements,
            commuteAnchors: profile.commuteAnchors,
            hardConstraints: profile.hardConstraints,
            weightedPreferences: profile.weightedPreferences,
            notificationRules: profile.notificationRules,
            createdAt: instant(profile.createdAt),
            updatedAt: instant(profile.updatedAt)
          })
          .returning()
      );
      return mapSearchProfileRow(required(rows[0], "Search profile insert returned no row."));
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(searchProfiles)
        .where(and(eq(searchProfiles.userId, userId), eq(searchProfiles.id, id)))
        .limit(1);
      return rows[0] ? mapSearchProfileRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(searchProfiles)
        .where(eq(searchProfiles.userId, userId))
        .orderBy(asc(searchProfiles.createdAt), asc(searchProfiles.id));
      return rows.map(mapSearchProfileRow);
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(searchProfiles)
        .where(eq(searchProfiles.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const rawListingRepository: CorePostgresRepositories["rawListings"] = {
    async import(captureInput) {
      const capture = RawListingCaptureSchema.parse(captureInput);
      const contentHash = computeRawContentHash(capture);
      const idempotencyKey = computeRawImportIdempotencyKey(capture, contentHash);
      const inserted = await databaseOperation(() =>
        db
          .insert(rawListings)
          .values({
            userId,
            id: capture.id,
            source: capture.source,
            sourceListingId: capture.sourceListingId,
            sourceUrl: capture.sourceUrl,
            acquisitionMode: capture.acquisitionMode,
            captureMethod: capture.captureMethod,
            observedAt: instant(capture.observedAt),
            sourcePostedAt: instant(capture.sourcePostedAt),
            rawText: capture.rawText,
            rawJson: capture.rawJson,
            captureMetadata: capture.captureMetadata,
            contentHash,
            idempotencyKey,
            createdAt: instant(capture.observedAt)
          })
          .onConflictDoNothing({
            target: [rawListings.userId, rawListings.idempotencyKey]
          })
          .returning()
      );
      const rows =
        inserted.length > 0
          ? inserted
          : await db
              .select()
              .from(rawListings)
              .where(
                and(eq(rawListings.userId, userId), eq(rawListings.idempotencyKey, idempotencyKey))
              )
              .limit(1);
      const row = required(rows[0], "Raw listing import did not resolve a persisted record.");
      return { record: mapRawListingRow(row), inserted: inserted.length === 1 };
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(rawListings)
        .where(and(eq(rawListings.userId, userId), eq(rawListings.id, id)))
        .limit(1);
      return rows[0] ? mapRawListingRow(rows[0]) : null;
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(rawListings)
        .where(eq(rawListings.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const sourceRecordRepository: CorePostgresRepositories["sourceRecords"] = {
    async insert(recordInput) {
      const record = ListingSourceRecordSchema.parse(recordInput);
      const rows = await databaseOperation(() =>
        db
          .insert(listingSourceRecords)
          .values({
            userId,
            id: record.id,
            rawListingId: record.rawListingId,
            source: record.source,
            sourceListingId: record.sourceListingId,
            sourceUrl: record.sourceUrl,
            sourcePostedAt: instant(record.sourcePostedAt),
            contactChannel: record.contactChannel,
            title: record.title,
            addressLine1: record.address.line1,
            addressUnit: record.address.unit,
            addressCity: record.address.city,
            addressRegion: record.address.region,
            addressPostalCode: record.address.postalCode,
            addressCountryCode: record.address.countryCode,
            monthlyRentCents: record.monthlyRentCents,
            recurringFeesCents: record.recurringFeesCents,
            bedroomsHalfUnits: toHalfUnits(record.bedrooms),
            bathroomsHalfUnits: toHalfUnits(record.bathrooms),
            squareFeet: record.squareFeet,
            latitude: toMicrodegrees(record.latitude),
            longitude: toMicrodegrees(record.longitude),
            propertyType: record.propertyType,
            availableOn: record.availableOn,
            leaseTermMonths: record.leaseTermMonths,
            petPolicy: record.petPolicy,
            amenities: record.amenities,
            description: record.description,
            extractionConfidenceBasisPoints: record.extractionConfidenceBasisPoints,
            completenessBasisPoints: record.completenessBasisPoints,
            observedAt: instant(record.observedAt),
            createdAt: instant(record.createdAt)
          })
          .returning()
      );
      return mapListingSourceRecordRow(
        required(rows[0], "Listing source record insert returned no row.")
      );
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(listingSourceRecords)
        .where(and(eq(listingSourceRecords.userId, userId), eq(listingSourceRecords.id, id)))
        .limit(1);
      return rows[0] ? mapListingSourceRecordRow(rows[0]) : null;
    },
    async getByRawListingId(rawListingIdInput) {
      const rawListingId = EntityIdSchema.parse(rawListingIdInput);
      const rows = await db
        .select()
        .from(listingSourceRecords)
        .where(
          and(
            eq(listingSourceRecords.userId, userId),
            eq(listingSourceRecords.rawListingId, rawListingId)
          )
        )
        .limit(1);
      return rows[0] ? mapListingSourceRecordRow(rows[0]) : null;
    },
    async listByCanonicalListingId(canonicalListingIdInput) {
      const canonicalListingId = EntityIdSchema.parse(canonicalListingIdInput);
      const rows = await db
        .select({ sourceRecord: listingSourceRecords })
        .from(canonicalListingSources)
        .innerJoin(
          listingSourceRecords,
          and(
            eq(canonicalListingSources.userId, listingSourceRecords.userId),
            eq(canonicalListingSources.listingSourceRecordId, listingSourceRecords.id)
          )
        )
        .where(
          and(
            eq(canonicalListingSources.userId, userId),
            eq(canonicalListingSources.canonicalListingId, canonicalListingId)
          )
        )
        .orderBy(asc(listingSourceRecords.id));
      return rows.map(({ sourceRecord }) => mapListingSourceRecordRow(sourceRecord));
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(listingSourceRecords)
        .where(eq(listingSourceRecords.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const listingPhotoRepository: CorePostgresRepositories["listingPhotos"] = {
    async insert(photoInput) {
      const photo = ListingPhotoSchema.parse(photoInput);
      const rows = await databaseOperation(() =>
        db
          .insert(listingPhotos)
          .values({ ...photo, userId, observedAt: instant(photo.observedAt) })
          .returning()
      );
      return mapListingPhotoRow(required(rows[0], "Listing photo insert returned no row."));
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(listingPhotos)
        .where(and(eq(listingPhotos.userId, userId), eq(listingPhotos.id, id)))
        .limit(1);
      return rows[0] ? mapListingPhotoRow(rows[0]) : null;
    }
  };

  const provenanceRepository: CorePostgresRepositories["fieldProvenance"] = {
    async insert(provenanceInput) {
      const provenance = FieldProvenanceSchema.parse(provenanceInput);
      const rows = await databaseOperation(() =>
        db
          .insert(fieldProvenance)
          .values({ ...provenance, userId, observedAt: instant(provenance.observedAt) })
          .returning()
      );
      return mapFieldProvenanceRow(required(rows[0], "Field provenance insert returned no row."));
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(fieldProvenance)
        .where(and(eq(fieldProvenance.userId, userId), eq(fieldProvenance.id, id)))
        .limit(1);
      return rows[0] ? mapFieldProvenanceRow(rows[0]) : null;
    },
    async listBySourceRecordId(sourceRecordIdInput) {
      const sourceRecordId = EntityIdSchema.parse(sourceRecordIdInput);
      const rows = await db
        .select()
        .from(fieldProvenance)
        .where(
          and(
            eq(fieldProvenance.userId, userId),
            eq(fieldProvenance.listingSourceRecordId, sourceRecordId)
          )
        )
        .orderBy(asc(fieldProvenance.fieldPath));
      return rows.map(mapFieldProvenanceRow);
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(fieldProvenance)
        .where(eq(fieldProvenance.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const extractionRepository: CorePostgresRepositories["listingExtractions"] = {
    async insert(runInput) {
      const run = ListingExtractionRunSchema.parse(runInput);
      const rows = await databaseOperation(() =>
        db
          .insert(listingExtractions)
          .values({
            userId,
            id: run.id,
            rawListingId: run.rawListingId,
            listingSourceRecordId: run.listingSourceRecordId,
            mode: run.mode,
            inputHash: run.inputHash,
            requestedFields: run.requestedFields,
            providerId: run.providerId,
            model: run.model,
            responseId: run.responseId,
            promptVersion: run.promptVersion,
            extractionVersion: run.extractionVersion,
            providerResult: run.providerResult,
            mergedExtraction: run.mergedExtraction,
            inputTokens: run.usage.inputTokens,
            outputTokens: run.usage.outputTokens,
            totalTokens: run.usage.totalTokens,
            latencyMilliseconds: run.latencyMilliseconds,
            repairCount: run.repairCount,
            completedAt: instant(run.completedAt)
          })
          .returning()
      );
      return mapListingExtractionRow(
        required(rows[0], "Listing extraction insert returned no row.")
      );
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(listingExtractions)
        .where(and(eq(listingExtractions.userId, userId), eq(listingExtractions.id, id)))
        .limit(1);
      return rows[0] ? mapListingExtractionRow(rows[0]) : null;
    },
    async getByRawListingId(rawListingIdInput) {
      const rawListingId = EntityIdSchema.parse(rawListingIdInput);
      const rows = await db
        .select()
        .from(listingExtractions)
        .where(
          and(
            eq(listingExtractions.userId, userId),
            eq(listingExtractions.rawListingId, rawListingId)
          )
        )
        .limit(1);
      return rows[0] ? mapListingExtractionRow(rows[0]) : null;
    },
    async getBySourceRecordId(sourceRecordIdInput) {
      const sourceRecordId = EntityIdSchema.parse(sourceRecordIdInput);
      const rows = await db
        .select()
        .from(listingExtractions)
        .where(
          and(
            eq(listingExtractions.userId, userId),
            eq(listingExtractions.listingSourceRecordId, sourceRecordId)
          )
        )
        .limit(1);
      return rows[0] ? mapListingExtractionRow(rows[0]) : null;
    }
  };

  const activityRepository: CorePostgresRepositories["activityEvents"] = {
    async append(eventInput) {
      const event = ActivityEventSchema.parse(eventInput);
      const rows = await databaseOperation(() =>
        db
          .insert(activityEvents)
          .values({ ...event, userId, occurredAt: instant(event.occurredAt) })
          .returning()
      );
      return mapActivityEventRow(required(rows[0], "Activity event insert returned no row."));
    },
    async getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const rows = await db
        .select()
        .from(activityEvents)
        .where(and(eq(activityEvents.userId, userId), eq(activityEvents.id, id)))
        .limit(1);
      return rows[0] ? mapActivityEventRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.userId, userId))
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id));
      return rows.map(mapActivityEventRow);
    },
    async listByTarget(targetTypeInput, targetIdInput) {
      const targetType = targetTypeInput.trim();
      const targetId = EntityIdSchema.parse(targetIdInput);
      if (!/^[a-z][a-z0-9_.-]{0,99}$/u.test(targetType)) {
        throw new Error("Activity target type must be a safe closed identifier.");
      }
      const rows = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.userId, userId),
            eq(activityEvents.targetType, targetType),
            eq(activityEvents.targetId, targetId)
          )
        )
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id));
      return rows.map(mapActivityEventRow);
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(activityEvents)
        .where(eq(activityEvents.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  return {
    searchProfiles: searchProfileRepository,
    rawListings: rawListingRepository,
    sourceRecords: sourceRecordRepository,
    listingPhotos: listingPhotoRepository,
    fieldProvenance: provenanceRepository,
    listingExtractions: extractionRepository,
    activityEvents: activityRepository
  };
}

export function createPostgresUserRepositories(
  db: PostgresExecutor,
  userIdInput: VeraUserId
): UserRepositories {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const decision = createPostgresDecisionRepositories(db, userId);
  const repositories = {
    integrationConnections: createPostgresIntegrationConnectionRepository(db, userId),
    integrationRefreshLeases: createPostgresIntegrationRefreshLeaseRepository(db, userId),
    ...createPostgresCalendarRepositories(db, userId),
    ...createPostgresBrowserRepositories(db, userId),
    ...createPostgresGmailRepositories(db, userId),
    ...createPostgresMaritimeRepositories(db, userId),
    ...createPostgresNotificationRepositories(db, userId),
    ...createCorePostgresRepositories(db, userId),
    ...createStandardPostgresRepositories(db, userId),
    sourcePolicyManifests: createPostgresPolicyReader(db),
    ...decision
  };
  return {
    ...repositories,
    decisionReconciliation: createPostgresDecisionReconciliation(db, userId, decision)
  };
}

export function createPostgresRepositoryProvider(
  connection: PostgresConnection
): UserRepositoryProvider {
  return {
    forUser(userId) {
      return createPostgresUserRepositories(connection.db, VeraUserIdSchema.parse(userId));
    },
    async transaction(userIdInput, operation) {
      const userId = VeraUserIdSchema.parse(userIdInput);
      return connection.db.transaction(async (transaction) =>
        operation(createPostgresUserRepositories(transaction, userId))
      );
    }
  };
}
