import {
  ActivityEventSchema,
  ApprovalSchema,
  ApprovalStateSchema,
  BrowserNodeStatusSchema,
  CanonicalFieldSourceSchema,
  CanonicalListingSchema,
  CanonicalListingSourceSchema,
  CanonicalListingSummarySchema,
  ContactWorkflowSchema,
  DuplicateClusterSchema,
  EntityIdSchema,
  ErrorCategorySchema,
  FieldProvenanceSchema,
  IsoDateTimeSchema,
  JobAttemptSchema,
  ListingLifecycleStateSchema,
  ListingExtractionRunSchema,
  ListingPhotoSchema,
  ListingScoreSchema,
  ListingScoreV2Schema,
  ListingSourceRecordSchema,
  NormalizationJobSchema,
  RawListingCaptureSchema,
  RiskSignalSchema,
  RiskSignalV2Schema,
  ReminderMinutesSchema,
  SearchProfileSchema,
  SourceJobSchema,
  SourceJobStatusSchema,
  SourcePolicyManifestSchema,
  ViewingSchema,
  ViewingStateSchema,
  transitionApprovalState,
  transitionListingLifecycle,
  transitionSourceJobStatus,
  transitionViewingState,
  type CanonicalListingSummary,
  type RawListingCapture
} from "@vera/domain";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { VeraDatabaseConnection } from "./connection.ts";
import { computeRawContentHash, computeRawImportIdempotencyKey } from "./hashing.ts";
import {
  mapActivityEventRow,
  mapApprovalRow,
  mapBrowserNodeRow,
  mapCanonicalListingRow,
  mapContactWorkflowRow,
  mapDuplicateClusterRow,
  mapFieldProvenanceRow,
  mapSourceJobAttemptRow,
  mapSourceJobRow,
  mapListingPhotoRow,
  mapListingExtractionRow,
  mapListingScoreRow,
  mapListingSourceRecordRow,
  mapNormalizationJobRow,
  mapRawListingRow,
  mapRiskSignalRow,
  mapSearchProfileRow,
  mapSourcePolicyManifestRow,
  mapViewingRow
} from "./row-mappers.ts";
import {
  RepositoryJobLeaseError,
  RepositoryNotFoundError,
  type VeraRepositories
} from "./repositories.ts";
import {
  activityEvents,
  approvals,
  browserNodes,
  canonicalFieldSources,
  canonicalListingSources,
  canonicalListings,
  contactWorkflows,
  duplicateClusters,
  fieldProvenance,
  listingPhotos,
  listingExtractions,
  listingScores,
  listingSourceRecords,
  normalizationJobs,
  rawListings,
  riskSignals,
  searchProfiles,
  sourceJobAttempts,
  sourceJobs,
  sourcePolicyManifests,
  viewings
} from "./schema.ts";
import { createSqliteDecisionRepositories } from "./sqlite-decision-repositories.ts";

function toMicrodegrees(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000_000);
}

function toMeters(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000);
}

function toHalfUnits(value: number | null): number | null {
  return value === null ? null : value * 2;
}

function scalarCount(value: number | undefined): number {
  return value ?? 0;
}

function parsePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function parseSafeErrorCode(value: string): string {
  const parsed = value.trim();

  if (!/^[a-z][a-z0-9_.-]{0,99}$/u.test(parsed)) {
    throw new Error("Normalization job error code must be a safe closed identifier.");
  }

  return parsed;
}

function assertLaterTimestamp(later: string, earlier: string, label: string): void {
  if (Date.parse(later) <= Date.parse(earlier)) {
    throw new Error(`${label} must be later than the reference time.`);
  }
}

function fitLabel(score: number): "strong_fit" | "possible_fit" | "needs_review" {
  if (score >= 7_500) return "strong_fit";
  if (score >= 2_500) return "possible_fit";
  return "needs_review";
}

const positiveReasonText: Readonly<Record<string, string>> = {
  total_within_target: "Known monthly cost is within the target budget.",
  base_rent_within_target: "Base rent is within the target budget.",
  budget_between_target_and_maximum: "Known monthly cost remains below the maximum.",
  bedrooms_match: "Bedroom count meets the profile requirement.",
  required_pet_allowed: "The stated pet policy matches the profile requirement.",
  move_in_window_match: "Availability falls inside the move-in window."
};

const concernReasonText: Readonly<Record<string, string>> = {
  budget_above_maximum: "Known monthly cost is above the profile maximum.",
  bedrooms_below_minimum: "Bedroom count is below the profile minimum.",
  required_pet_not_allowed: "The stated pet policy conflicts with the profile requirement.",
  move_in_window_conflict: "Availability falls outside the move-in window.",
  budget_unknown: "Rent needs verification before budget fit can be confirmed.",
  bedrooms_unknown: "Bedroom count needs verification.",
  pet_policy_unknown: "Pet policy needs verification.",
  availability_unknown: "Move-in availability needs verification.",
  base_rent_within_target: "Recurring fees are unknown."
};

function firstReason(
  reasonCodes: readonly string[],
  copy: Readonly<Record<string, string>>,
  fallback: string
): string {
  for (const reasonCode of reasonCodes) {
    const text = copy[reasonCode];
    if (text) return text;
  }
  return fallback;
}

export function createSqliteRepositories(connection: VeraDatabaseConnection): VeraRepositories {
  const { db, sqlite } = connection;

  const searchProfileRepository: VeraRepositories["searchProfiles"] = {
    insert(profileInput) {
      const profile = SearchProfileSchema.parse(profileInput);
      db.insert(searchProfiles)
        .values({
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
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt
        })
        .run();
      return searchProfileRepository.getById(profile.id) ?? profile;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(searchProfiles).where(eq(searchProfiles.id, id)).get();
      return row ? mapSearchProfileRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(searchProfiles)
        .orderBy(asc(searchProfiles.createdAt), asc(searchProfiles.id))
        .all()
        .map(mapSearchProfileRow);
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(searchProfiles).get()?.value);
    }
  };

  const rawListingRepository: VeraRepositories["rawListings"] = {
    import(captureInput: RawListingCapture) {
      const capture = RawListingCaptureSchema.parse(captureInput);
      const contentHash = computeRawContentHash(capture);
      const idempotencyKey = computeRawImportIdempotencyKey(capture, contentHash);
      const result = db
        .insert(rawListings)
        .values({
          ...capture,
          contentHash,
          idempotencyKey,
          createdAt: capture.observedAt
        })
        .onConflictDoNothing({ target: rawListings.idempotencyKey })
        .run();
      const row = db
        .select()
        .from(rawListings)
        .where(eq(rawListings.idempotencyKey, idempotencyKey))
        .get();

      if (!row) {
        throw new Error("Raw listing import did not persist or resolve an existing record.");
      }

      return { record: mapRawListingRow(row), inserted: result.changes === 1 };
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(rawListings).where(eq(rawListings.id, id)).get();
      return row ? mapRawListingRow(row) : null;
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(rawListings).get()?.value);
    }
  };

  const sourceRecordRepository: VeraRepositories["sourceRecords"] = {
    insert(recordInput) {
      const record = ListingSourceRecordSchema.parse(recordInput);
      db.insert(listingSourceRecords)
        .values({
          id: record.id,
          rawListingId: record.rawListingId,
          source: record.source,
          sourceListingId: record.sourceListingId,
          sourceUrl: record.sourceUrl,
          sourcePostedAt: record.sourcePostedAt,
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
          observedAt: record.observedAt,
          createdAt: record.createdAt
        })
        .run();
      return sourceRecordRepository.getById(record.id) ?? record;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db
        .select()
        .from(listingSourceRecords)
        .where(eq(listingSourceRecords.id, id))
        .get();
      return row ? mapListingSourceRecordRow(row) : null;
    },
    getByRawListingId(rawListingIdInput) {
      const rawListingId = EntityIdSchema.parse(rawListingIdInput);
      const row = db
        .select()
        .from(listingSourceRecords)
        .where(eq(listingSourceRecords.rawListingId, rawListingId))
        .get();
      return row ? mapListingSourceRecordRow(row) : null;
    },
    listByCanonicalListingId(canonicalListingIdInput) {
      const canonicalListingId = EntityIdSchema.parse(canonicalListingIdInput);
      return db
        .select({ sourceRecord: listingSourceRecords })
        .from(canonicalListingSources)
        .innerJoin(
          listingSourceRecords,
          eq(canonicalListingSources.listingSourceRecordId, listingSourceRecords.id)
        )
        .where(eq(canonicalListingSources.canonicalListingId, canonicalListingId))
        .orderBy(asc(listingSourceRecords.id))
        .all()
        .map((row) => mapListingSourceRecordRow(row.sourceRecord));
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(listingSourceRecords).get()?.value);
    }
  };

  const listingPhotoRepository: VeraRepositories["listingPhotos"] = {
    insert(photoInput) {
      const photo = ListingPhotoSchema.parse(photoInput);
      db.insert(listingPhotos).values(photo).run();
      return listingPhotoRepository.getById(photo.id) ?? photo;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(listingPhotos).where(eq(listingPhotos.id, id)).get();
      return row ? mapListingPhotoRow(row) : null;
    }
  };

  const fieldProvenanceRepository: VeraRepositories["fieldProvenance"] = {
    insert(provenanceInput) {
      const provenance = FieldProvenanceSchema.parse(provenanceInput);
      db.insert(fieldProvenance).values(provenance).run();
      return fieldProvenanceRepository.getById(provenance.id) ?? provenance;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(fieldProvenance).where(eq(fieldProvenance.id, id)).get();
      return row ? mapFieldProvenanceRow(row) : null;
    },
    listBySourceRecordId(sourceRecordIdInput) {
      const sourceRecordId = EntityIdSchema.parse(sourceRecordIdInput);
      return db
        .select()
        .from(fieldProvenance)
        .where(eq(fieldProvenance.listingSourceRecordId, sourceRecordId))
        .orderBy(asc(fieldProvenance.fieldPath))
        .all()
        .map(mapFieldProvenanceRow);
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(fieldProvenance).get()?.value);
    }
  };

  const normalizationJobRepository: VeraRepositories["normalizationJobs"] = {
    enqueue(input) {
      const id = EntityIdSchema.parse(input.id);
      const rawListingId = EntityIdSchema.parse(input.rawListingId);
      const idempotencyKey = input.idempotencyKey;
      const availableAt = IsoDateTimeSchema.parse(input.availableAt);
      const maxAttempts = parsePositiveInteger(input.maxAttempts, "Normalization max attempts");
      const correlationId = EntityIdSchema.parse(input.correlationId);
      const causationId = EntityIdSchema.parse(input.causationId);
      const createdAt = IsoDateTimeSchema.parse(input.createdAt);
      const candidate = NormalizationJobSchema.parse({
        id,
        rawListingId,
        idempotencyKey,
        jobType: "normalize_listing",
        state: "queued",
        availableAt,
        attempts: 0,
        maxAttempts,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorCategory: null,
        correlationId,
        causationId,
        createdAt,
        updatedAt: createdAt,
        completedAt: null
      });
      const result = db.insert(normalizationJobs).values(candidate).onConflictDoNothing().run();
      const persisted = normalizationJobRepository.getByRawListingId(rawListingId);

      if (!persisted) {
        throw new Error(
          "Normalization job enqueue conflicted without resolving the raw-listing job."
        );
      }

      if (persisted.idempotencyKey !== idempotencyKey) {
        throw new Error("Normalization job raw listing already has a different idempotency key.");
      }

      return { record: persisted, inserted: result.changes === 1 };
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(normalizationJobs).where(eq(normalizationJobs.id, id)).get();
      return row ? mapNormalizationJobRow(row) : null;
    },
    getByRawListingId(rawListingIdInput) {
      const rawListingId = EntityIdSchema.parse(rawListingIdInput);
      const row = db
        .select()
        .from(normalizationJobs)
        .where(eq(normalizationJobs.rawListingId, rawListingId))
        .get();
      return row ? mapNormalizationJobRow(row) : null;
    },
    claimNext(input) {
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const now = IsoDateTimeSchema.parse(input.now);
      const leaseExpiresAt = IsoDateTimeSchema.parse(input.leaseExpiresAt);
      assertLaterTimestamp(leaseExpiresAt, now, "Normalization lease expiry");

      const eligible = and(
        sql`julianday(${normalizationJobs.availableAt}) <= julianday(${now})`,
        sql`${normalizationJobs.attempts} < ${normalizationJobs.maxAttempts}`,
        or(
          inArray(normalizationJobs.state, ["queued", "retryable"]),
          and(
            eq(normalizationJobs.state, "leased"),
            sql`julianday(${normalizationJobs.leaseExpiresAt}) <= julianday(${now})`
          )
        )
      );
      const claim = sqlite.transaction(() => {
        const candidate = db
          .select({ id: normalizationJobs.id })
          .from(normalizationJobs)
          .where(eligible)
          .orderBy(
            sql`julianday(${normalizationJobs.availableAt})`,
            sql`julianday(${normalizationJobs.createdAt})`,
            asc(normalizationJobs.id)
          )
          .get();

        if (!candidate) {
          return null;
        }

        const result = db
          .update(normalizationJobs)
          .set({
            state: "leased",
            attempts: sql`${normalizationJobs.attempts} + 1`,
            leaseOwner,
            leaseExpiresAt,
            updatedAt: now
          })
          .where(and(eq(normalizationJobs.id, candidate.id), eligible))
          .run();

        if (result.changes !== 1) {
          return null;
        }

        return normalizationJobRepository.getById(candidate.id);
      });

      return claim.immediate();
    },
    complete(input) {
      const id = EntityIdSchema.parse(input.id);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const completedAt = IsoDateTimeSchema.parse(input.completedAt);
      const result = db
        .update(normalizationJobs)
        .set({
          state: "completed",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorCategory: null,
          updatedAt: completedAt,
          completedAt
        })
        .where(
          and(
            eq(normalizationJobs.id, id),
            eq(normalizationJobs.state, "leased"),
            eq(normalizationJobs.leaseOwner, leaseOwner)
          )
        )
        .run();

      if (result.changes !== 1) {
        if (!normalizationJobRepository.getById(id)) {
          throw new RepositoryNotFoundError("NormalizationJob", id);
        }

        throw new RepositoryJobLeaseError(id);
      }

      const completed = normalizationJobRepository.getById(id);

      if (!completed) {
        throw new RepositoryNotFoundError("NormalizationJob", id);
      }

      return completed;
    },
    fail(input) {
      const id = EntityIdSchema.parse(input.id);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const failedAt = IsoDateTimeSchema.parse(input.failedAt);
      const retryAt = IsoDateTimeSchema.parse(input.retryAt);
      const errorCode = parseSafeErrorCode(input.errorCode);
      const errorCategory = ErrorCategorySchema.parse(input.errorCategory);
      const current = normalizationJobRepository.getById(id);

      if (!current) {
        throw new RepositoryNotFoundError("NormalizationJob", id);
      }

      if (current.state !== "leased" || current.leaseOwner !== leaseOwner) {
        throw new RepositoryJobLeaseError(id);
      }

      const deadLetter = !input.retryable || current.attempts >= current.maxAttempts;

      if (!deadLetter) {
        assertLaterTimestamp(retryAt, failedAt, "Normalization retry time");
      }

      const result = db
        .update(normalizationJobs)
        .set({
          state: deadLetter ? "dead_letter" : "retryable",
          availableAt: deadLetter ? current.availableAt : retryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          lastErrorCategory: errorCategory,
          updatedAt: failedAt,
          completedAt: null
        })
        .where(
          and(
            eq(normalizationJobs.id, id),
            eq(normalizationJobs.state, "leased"),
            eq(normalizationJobs.leaseOwner, leaseOwner)
          )
        )
        .run();

      if (result.changes !== 1) {
        throw new RepositoryJobLeaseError(id);
      }

      const failed = normalizationJobRepository.getById(id);

      if (!failed) {
        throw new RepositoryNotFoundError("NormalizationJob", id);
      }

      return failed;
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(normalizationJobs).get()?.value);
    }
  };

  const sourceJobRepository: VeraRepositories["sourceJobs"] = {
    enqueue(jobInput) {
      const job = SourceJobSchema.parse(jobInput);
      const result = db.insert(sourceJobs).values(job).onConflictDoNothing().run();
      const persisted = sourceJobRepository.getByIdempotencyKey(job.idempotencyKey);

      if (!persisted) {
        throw new Error("Source job enqueue conflicted without resolving its idempotency key.");
      }

      if (
        persisted.payloadHash !== job.payloadHash ||
        persisted.connectorId !== job.connectorId ||
        persisted.source !== job.source ||
        persisted.acquisitionMode !== job.acquisitionMode ||
        persisted.capability !== job.capability ||
        persisted.approvalId !== job.approvalId ||
        persisted.operation !== job.operation
      ) {
        throw new Error("Source job idempotency key resolved to a different job identity.");
      }

      return { record: persisted, inserted: result.changes === 1 };
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(sourceJobs).where(eq(sourceJobs.id, id)).get();
      return row ? mapSourceJobRow(row) : null;
    },
    getByIdempotencyKey(keyInput) {
      const key = keyInput.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/u.test(key)) {
        throw new Error("Source job idempotency keys must be SHA-256 values.");
      }
      const row = db.select().from(sourceJobs).where(eq(sourceJobs.idempotencyKey, key)).get();
      return row ? mapSourceJobRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(sourceJobs)
        .orderBy(asc(sourceJobs.createdAt), asc(sourceJobs.id))
        .all()
        .map(mapSourceJobRow);
    },
    transition(idInput, requestedInput, transitionedAtInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const requested = SourceJobStatusSchema.parse(requestedInput);
      const transitionedAt = IsoDateTimeSchema.parse(transitionedAtInput);
      const transaction = sqlite.transaction(() => {
        const current = sourceJobRepository.getById(id);

        if (!current) {
          throw new RepositoryNotFoundError("SourceJob", id);
        }

        if (Date.parse(transitionedAt) < Date.parse(current.updatedAt)) {
          throw new Error("Source job transition time cannot precede its current update time.");
        }

        if (
          current.status === "completed" &&
          requested === "completed" &&
          patch.result !== undefined
        ) {
          const replayCandidate = SourceJobSchema.parse({ ...current, result: patch.result });
          if (
            current.result !== null &&
            replayCandidate.result?.resultHash === current.result.resultHash
          ) {
            return current;
          }
        }

        const status = transitionSourceJobStatus(current.status, requested);
        const noResultStates = new Set([
          "queued",
          "dispatched",
          "running",
          "deferred_node_offline",
          "manual_action_required",
          "cancelled_by_policy"
        ]);
        const candidate = SourceJobSchema.parse({
          ...current,
          status,
          attempts: patch.attempts ?? current.attempts,
          manualAction: status === "manual_action_required" ? (patch.manualAction ?? null) : null,
          deferredReason:
            status === "deferred_node_offline" ? (patch.deferredReason ?? null) : null,
          result: noResultStates.has(status) ? null : (patch.result ?? current.result),
          updatedAt: transitionedAt,
          completedAt: ["completed", "permanently_failed", "cancelled_by_policy"].includes(status)
            ? transitionedAt
            : null
        });

        db.update(sourceJobs)
          .set({
            status: candidate.status,
            attempts: candidate.attempts,
            manualAction: candidate.manualAction,
            deferredReason: candidate.deferredReason,
            result: candidate.result,
            updatedAt: candidate.updatedAt,
            completedAt: candidate.completedAt
          })
          .where(eq(sourceJobs.id, id))
          .run();

        const updated = sourceJobRepository.getById(id);
        if (!updated) {
          throw new RepositoryNotFoundError("SourceJob", id);
        }
        return updated;
      });

      return transaction.immediate();
    }
  };

  const sourceJobAttemptRepository: VeraRepositories["sourceJobAttempts"] = {
    append(attemptInput) {
      const attempt = JobAttemptSchema.parse(attemptInput);
      const job = sourceJobRepository.getById(attempt.sourceJobId);

      if (!job) {
        throw new RepositoryNotFoundError("SourceJob", attempt.sourceJobId);
      }
      if (attempt.correlationId !== job.correlationId || attempt.payloadHash !== job.payloadHash) {
        throw new Error("Source job attempt identity does not match its source job.");
      }
      if (attempt.attemptNumber > job.maxAttempts) {
        throw new Error("Source job attempt number exceeds the configured maximum.");
      }

      db.insert(sourceJobAttempts).values(attempt).run();
      return attempt;
    },
    listByJobId(jobIdInput) {
      const jobId = EntityIdSchema.parse(jobIdInput);
      return db
        .select()
        .from(sourceJobAttempts)
        .where(eq(sourceJobAttempts.sourceJobId, jobId))
        .orderBy(asc(sourceJobAttempts.attemptNumber), asc(sourceJobAttempts.id))
        .all()
        .map(mapSourceJobAttemptRow);
    }
  };

  const browserNodeRepository: VeraRepositories["browserNodes"] = {
    upsert(statusInput) {
      const status = BrowserNodeStatusSchema.parse(statusInput);
      const transaction = sqlite.transaction(() => {
        const current = browserNodeRepository.getById(status.nodeId);

        if (current) {
          if (current.providerId !== status.providerId) {
            throw new Error("Browser node provider identity cannot change after registration.");
          }
          if (current.status === "revoked") {
            if (status.status !== "revoked") {
              throw new Error("A revoked browser node cannot be revived by a heartbeat update.");
            }
            return current;
          }

          const heartbeatOrder =
            Date.parse(status.lastHeartbeatAt) - Date.parse(current.lastHeartbeatAt);
          const updateOrder = Date.parse(status.updatedAt) - Date.parse(current.updatedAt);
          const isNewer = heartbeatOrder > 0 || (heartbeatOrder === 0 && updateOrder > 0);
          if (!isNewer) {
            return current;
          }

          db.update(browserNodes)
            .set({
              status: status.status,
              lastHeartbeatAt: status.lastHeartbeatAt,
              heartbeatExpiresAt: status.heartbeatExpiresAt,
              contractVersion: status.contractVersion,
              capabilities: status.capabilities,
              updatedAt: status.updatedAt
            })
            .where(eq(browserNodes.nodeId, status.nodeId))
            .run();
        } else {
          db.insert(browserNodes).values(status).run();
        }

        const persisted = browserNodeRepository.getById(status.nodeId);
        if (!persisted) {
          throw new Error("Browser node upsert did not persist or resolve a health record.");
        }
        return persisted;
      });

      return transaction.immediate();
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(browserNodes).where(eq(browserNodes.nodeId, id)).get();
      return row ? mapBrowserNodeRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(browserNodes)
        .orderBy(asc(browserNodes.nodeId))
        .all()
        .map(mapBrowserNodeRow);
    }
  };

  const listingExtractionRepository: VeraRepositories["listingExtractions"] = {
    insert(runInput) {
      const run = ListingExtractionRunSchema.parse(runInput);
      const sourceRecord = sourceRecordRepository.getById(run.listingSourceRecordId);

      if (!sourceRecord) {
        throw new RepositoryNotFoundError("ListingSourceRecord", run.listingSourceRecordId);
      }

      if (sourceRecord.rawListingId !== run.rawListingId) {
        throw new Error("Listing extraction raw listing does not match its source record.");
      }

      db.insert(listingExtractions)
        .values({
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
          completedAt: run.completedAt
        })
        .run();

      return listingExtractionRepository.getById(run.id) ?? run;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(listingExtractions).where(eq(listingExtractions.id, id)).get();
      return row ? mapListingExtractionRow(row) : null;
    },
    getByRawListingId(rawListingIdInput) {
      const rawListingId = EntityIdSchema.parse(rawListingIdInput);
      const row = db
        .select()
        .from(listingExtractions)
        .where(eq(listingExtractions.rawListingId, rawListingId))
        .get();
      return row ? mapListingExtractionRow(row) : null;
    },
    getBySourceRecordId(sourceRecordIdInput) {
      const sourceRecordId = EntityIdSchema.parse(sourceRecordIdInput);
      const row = db
        .select()
        .from(listingExtractions)
        .where(eq(listingExtractions.listingSourceRecordId, sourceRecordId))
        .get();
      return row ? mapListingExtractionRow(row) : null;
    }
  };

  const duplicateClusterRepository: VeraRepositories["duplicateClusters"] = {
    insert(clusterInput) {
      const cluster = DuplicateClusterSchema.parse(clusterInput);
      db.insert(duplicateClusters)
        .values({
          id: cluster.id,
          clusterKey: cluster.clusterKey,
          algorithmVersion: cluster.algorithmVersion,
          reasonCodes: cluster.reasonCodes,
          createdAt: cluster.createdAt
        })
        .onConflictDoNothing({ target: duplicateClusters.id })
        .run();
      return cluster;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(duplicateClusters).where(eq(duplicateClusters.id, id)).get();

      if (!row) {
        return null;
      }

      const canonical = db
        .select({ id: canonicalListings.id })
        .from(canonicalListings)
        .where(eq(canonicalListings.duplicateClusterId, id))
        .get();
      const memberSourceRecordIds = canonical
        ? db
            .select({ id: canonicalListingSources.listingSourceRecordId })
            .from(canonicalListingSources)
            .where(eq(canonicalListingSources.canonicalListingId, canonical.id))
            .orderBy(asc(canonicalListingSources.listingSourceRecordId))
            .all()
            .map((membership) => membership.id)
        : [];

      return mapDuplicateClusterRow(row, memberSourceRecordIds);
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(duplicateClusters).get()?.value);
    }
  };

  const canonicalListingRepository: VeraRepositories["canonicalListings"] = {
    insert(listingInput) {
      const listing = CanonicalListingSchema.parse(listingInput);
      db.insert(canonicalListings)
        .values({
          id: listing.id,
          duplicateClusterId: listing.duplicateClusterId,
          primarySourceRecordId: listing.primarySourceRecordId,
          title: listing.title,
          addressLine1: listing.address.line1,
          addressUnit: listing.address.unit,
          addressCity: listing.address.city,
          addressRegion: listing.address.region,
          addressPostalCode: listing.address.postalCode,
          addressCountryCode: listing.address.countryCode,
          monthlyRentCents: listing.monthlyRentCents,
          recurringFeesCents: listing.recurringFeesCents,
          bedroomsHalfUnits: toHalfUnits(listing.bedrooms),
          bathroomsHalfUnits: toHalfUnits(listing.bathrooms),
          squareFeet: listing.squareFeet,
          propertyType: listing.propertyType,
          availableOn: listing.availableOn,
          leaseTermMonths: listing.leaseTermMonths,
          petPolicy: listing.petPolicy,
          amenities: listing.amenities,
          description: listing.description,
          lifecycleState: listing.lifecycleState,
          projectionState: listing.projectionState,
          supersededById: listing.supersededById,
          stitchVersion: listing.stitchVersion,
          stitchInputHash: listing.stitchInputHash,
          updatedByDecisionRunId: listing.updatedByDecisionRunId,
          completenessBasisPoints: listing.completenessBasisPoints,
          freshestObservedAt: listing.freshestObservedAt,
          createdAt: listing.createdAt,
          updatedAt: listing.updatedAt
        })
        .run();
      return canonicalListingRepository.getById(listing.id) ?? listing;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(canonicalListings).where(eq(canonicalListings.id, id)).get();
      return row ? mapCanonicalListingRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.projectionState, "active"))
        .orderBy(desc(canonicalListings.freshestObservedAt), asc(canonicalListings.id))
        .all()
        .map(mapCanonicalListingRow);
    },
    listSummaries() {
      const listings = canonicalListingRepository.list();
      const memberships = db
        .select({
          canonicalListingId: canonicalListingSources.canonicalListingId,
          source: listingSourceRecords.source,
          observedAt: listingSourceRecords.observedAt,
          sourcePostedAt: listingSourceRecords.sourcePostedAt
        })
        .from(canonicalListingSources)
        .innerJoin(
          listingSourceRecords,
          eq(canonicalListingSources.listingSourceRecordId, listingSourceRecords.id)
        )
        .orderBy(asc(canonicalListingSources.canonicalListingId), asc(listingSourceRecords.source))
        .all();
      const sourcesByListing = new Map<string, string[]>();
      const scoreRows = db
        .select()
        .from(listingScores)
        .orderBy(desc(listingScores.computedAt), asc(listingScores.id))
        .all();
      const scoreByListing = new Map<string, ReturnType<typeof mapListingScoreRow>>();
      for (const row of scoreRows) {
        if (!scoreByListing.has(row.canonicalListingId)) {
          scoreByListing.set(row.canonicalListingId, mapListingScoreRow(row));
        }
      }
      const riskRows = db
        .select({
          canonicalListingId: riskSignals.canonicalListingId,
          status: riskSignals.status,
          severity: riskSignals.severity
        })
        .from(riskSignals)
        .all();
      const riskCountByListing = new Map<string, number>();
      for (const row of riskRows) {
        if (row.status === "open") {
          riskCountByListing.set(
            row.canonicalListingId,
            (riskCountByListing.get(row.canonicalListingId) ?? 0) + 1
          );
        }
      }

      for (const membership of memberships) {
        const sources = sourcesByListing.get(membership.canonicalListingId) ?? [];
        sources.push(membership.source);
        sourcesByListing.set(membership.canonicalListingId, sources);
      }

      return listings.map((listing): CanonicalListingSummary => {
        const sourceLabels = [...new Set(sourcesByListing.get(listing.id) ?? [])].sort();
        const sourceRecordCount = memberships.filter(
          (membership) => membership.canonicalListingId === listing.id
        ).length;
        const freshestMembership = memberships
          .filter((membership) => membership.canonicalListingId === listing.id)
          .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
        const freshestSourcePostedAt = freshestMembership?.sourcePostedAt ?? null;
        const alertLatencySeconds =
          freshestMembership && freshestSourcePostedAt
            ? Math.max(
                0,
                Math.floor(
                  (Date.parse(freshestMembership.observedAt) - Date.parse(freshestSourcePostedAt)) /
                    1_000
                )
              )
            : null;
        const unknownFields = [
          ["monthly rent", listing.monthlyRentCents],
          ["recurring fees", listing.recurringFeesCents],
          ["bedrooms", listing.bedrooms],
          ["bathrooms", listing.bathrooms],
          ["square feet", listing.squareFeet],
          ["availability", listing.availableOn],
          ["lease term", listing.leaseTermMonths],
          ["pet policy", listing.petPolicy]
        ]
          .filter((entry) => entry[1] === null)
          .map((entry) => String(entry[0]));
        const score = scoreByListing.get(listing.id) ?? null;
        const scoreV2 =
          listing.updatedByDecisionRunId === null
            ? null
            : listingScoreRepository.getCurrentV2ByCanonicalListingId(
                listing.id,
                listing.updatedByDecisionRunId
              );
        const currentRisks =
          listing.updatedByDecisionRunId === null
            ? null
            : riskSignalRepository.listCurrentV2ByCanonicalListingId(
                listing.id,
                listing.updatedByDecisionRunId
              );
        const listingRisks =
          currentRisks ?? riskRows.filter((risk) => risk.canonicalListingId === listing.id);
        const highestRiskSeverity = ["high", "medium", "low", "info"].find((severity) =>
          listingRisks.some((risk) => risk.status === "open" && risk.severity === severity)
        );
        const displayScore = scoreV2?.finalScoreBasisPoints ?? score?.totalScoreBasisPoints ?? null;
        const penaltyTotal = scoreV2
          ? scoreV2.stalePenaltyBasisPoints +
            scoreV2.lowConfidencePenaltyBasisPoints +
            scoreV2.riskPenaltyBasisPoints
          : 0;

        return CanonicalListingSummarySchema.parse({
          id: listing.id,
          title: listing.title,
          address: listing.address,
          monthlyRentCents: listing.monthlyRentCents,
          recurringFeesCents: listing.recurringFeesCents,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms,
          squareFeet: listing.squareFeet,
          availableOn: listing.availableOn,
          leaseTermMonths: listing.leaseTermMonths,
          petPolicy: listing.petPolicy,
          lifecycleState: listing.lifecycleState,
          completenessBasisPoints: listing.completenessBasisPoints,
          freshestObservedAt: listing.freshestObservedAt,
          freshestSourcePostedAt,
          alertLatencySeconds,
          sourceLabels,
          sourceRecordCount,
          duplicateCount: Math.max(0, sourceRecordCount - 1),
          unknownFields,
          fitScoreBasisPoints: displayScore,
          eligible: scoreV2?.eligible ?? null,
          baseScoreBasisPoints: scoreV2?.baseScoreBasisPoints ?? null,
          stalePenaltyBasisPoints: scoreV2?.stalePenaltyBasisPoints ?? null,
          lowConfidencePenaltyBasisPoints: scoreV2?.lowConfidencePenaltyBasisPoints ?? null,
          riskPenaltyBasisPoints: scoreV2?.riskPenaltyBasisPoints ?? null,
          fitLabel: displayScore === null ? null : fitLabel(displayScore),
          topPositiveReason: scoreV2
            ? scoreV2.explanation.slice(0, 300)
            : score
              ? firstReason(
                  score.reasonCodes,
                  positiveReasonText,
                  "Known facts do not yet establish a positive fit."
                )
              : null,
          topConcern: scoreV2
            ? !scoreV2.eligible
              ? "A known hard constraint excludes this listing; inspect the exact result below."
              : penaltyTotal > 0
                ? `${String(penaltyTotal / 100)} percentage points of separate evidence penalties apply.`
                : unknownFields.length > 0
                  ? `${unknownFields[0] ?? "A listing fact"} needs verification.`
                  : "No deterministic concern is active."
            : score
              ? firstReason(
                  score.reasonCodes,
                  concernReasonText,
                  unknownFields.length > 0
                    ? `${unknownFields[0] ?? "A listing fact"} needs verification.`
                    : "No concern was identified from the four demo factors."
                )
              : null,
          riskIndicatorCount:
            currentRisks?.filter(({ status }) => status === "open").length ??
            riskCountByListing.get(listing.id) ??
            0,
          highestRiskSeverity: highestRiskSeverity ?? null
        });
      });
    },
    addSource(membershipInput) {
      const membership = CanonicalListingSourceSchema.parse(membershipInput);
      db.insert(canonicalListingSources).values(membership).onConflictDoNothing().run();
      return membership;
    },
    setFieldSource(selectionInput) {
      const selection = CanonicalFieldSourceSchema.parse(selectionInput);
      db.insert(canonicalFieldSources).values(selection).onConflictDoNothing().run();
      return selection;
    },
    listFieldSources(idInput) {
      const id = EntityIdSchema.parse(idInput);
      return db
        .select()
        .from(canonicalFieldSources)
        .where(eq(canonicalFieldSources.canonicalListingId, id))
        .orderBy(asc(canonicalFieldSources.fieldPath))
        .all()
        .map((row) => CanonicalFieldSourceSchema.parse(row));
    },
    transitionLifecycle(idInput, requestedInput, transitionedAtInput) {
      const id = EntityIdSchema.parse(idInput);
      const requested = ListingLifecycleStateSchema.parse(requestedInput);
      const transitionedAt = IsoDateTimeSchema.parse(transitionedAtInput);
      const transition = sqlite.transaction(() => {
        const current = canonicalListingRepository.getById(id);

        if (!current) {
          throw new RepositoryNotFoundError("CanonicalListing", id);
        }

        const lifecycleState = transitionListingLifecycle(current.lifecycleState, requested);
        db.update(canonicalListings)
          .set({ lifecycleState, updatedAt: transitionedAt })
          .where(eq(canonicalListings.id, id))
          .run();

        const updated = canonicalListingRepository.getById(id);

        if (!updated) {
          throw new RepositoryNotFoundError("CanonicalListing", id);
        }

        return updated;
      });

      return transition();
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(canonicalListings).get()?.value);
    },
    sourceMembershipCount() {
      return scalarCount(db.select({ value: count() }).from(canonicalListingSources).get()?.value);
    },
    fieldSelectionCount() {
      return scalarCount(db.select({ value: count() }).from(canonicalFieldSources).get()?.value);
    }
  };

  const listingScoreRepository: VeraRepositories["listingScores"] = {
    insert(scoreInput) {
      const score = ListingScoreSchema.parse(scoreInput);
      db.insert(listingScores).values(score).run();
      return listingScoreRepository.getById(score.id) ?? score;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(listingScores).where(eq(listingScores.id, id)).get();
      return row ? mapListingScoreRow(row) : null;
    },
    listByCanonicalListingId(idInput) {
      const id = EntityIdSchema.parse(idInput);
      return db
        .select()
        .from(listingScores)
        .where(eq(listingScores.canonicalListingId, id))
        .orderBy(desc(listingScores.computedAt), asc(listingScores.id))
        .all()
        .map(mapListingScoreRow);
    },
    getCurrentV2ByCanonicalListingId(idInput, decisionRunIdInput) {
      const id = EntityIdSchema.parse(idInput);
      const decisionRunId = EntityIdSchema.parse(decisionRunIdInput);
      const row = db
        .select()
        .from(listingScores)
        .where(
          and(
            eq(listingScores.canonicalListingId, id),
            eq(listingScores.decisionRunId, decisionRunId),
            eq(listingScores.schemaVersion, "listing-score.v2")
          )
        )
        .get();
      if (
        row === undefined ||
        row.searchProfileId === null ||
        row.eligible === null ||
        row.hardConstraintsV2 === null ||
        row.factorsV2 === null ||
        row.baseScoreBasisPoints === null ||
        row.stalePenaltyBasisPoints === null ||
        row.lowConfidencePenaltyBasisPoints === null ||
        row.riskPenaltyBasisPoints === null ||
        row.finalScoreBasisPoints === null ||
        row.explanation === null
      ) {
        return null;
      }
      return ListingScoreV2Schema.parse({
        id: row.id,
        schemaVersion: 2,
        canonicalListingId: row.canonicalListingId,
        searchProfileId: row.searchProfileId,
        algorithmVersion: row.algorithmVersion,
        inputHash: row.inputHash,
        eligible: row.eligible,
        hardConstraints: row.hardConstraintsV2,
        factors: row.factorsV2,
        baseScoreBasisPoints: row.baseScoreBasisPoints,
        stalePenaltyBasisPoints: row.stalePenaltyBasisPoints,
        lowConfidencePenaltyBasisPoints: row.lowConfidencePenaltyBasisPoints,
        riskPenaltyBasisPoints: row.riskPenaltyBasisPoints,
        finalScoreBasisPoints: row.finalScoreBasisPoints,
        reasonCodes: row.reasonCodes,
        explanation: row.explanation,
        computedAt: row.computedAt
      });
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(listingScores).get()?.value);
    }
  };

  const riskSignalRepository: VeraRepositories["riskSignals"] = {
    insert(signalInput) {
      const signal = RiskSignalSchema.parse(signalInput);
      db.insert(riskSignals).values(signal).run();
      return riskSignalRepository.getById(signal.id) ?? signal;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(riskSignals).where(eq(riskSignals.id, id)).get();
      return row ? mapRiskSignalRow(row) : null;
    },
    listByCanonicalListingId(idInput) {
      const id = EntityIdSchema.parse(idInput);
      return db
        .select()
        .from(riskSignals)
        .where(eq(riskSignals.canonicalListingId, id))
        .orderBy(desc(riskSignals.createdAt), asc(riskSignals.id))
        .all()
        .map(mapRiskSignalRow);
    },
    listCurrentV2ByCanonicalListingId(idInput, decisionRunIdInput) {
      const id = EntityIdSchema.parse(idInput);
      const decisionRunId = EntityIdSchema.parse(decisionRunIdInput);
      return db
        .select()
        .from(riskSignals)
        .where(
          and(
            eq(riskSignals.canonicalListingId, id),
            eq(riskSignals.decisionRunId, decisionRunId),
            eq(riskSignals.schemaVersion, "listing-risk.v2")
          )
        )
        .orderBy(desc(riskSignals.createdAt), asc(riskSignals.id))
        .all()
        .map((row) => {
          if (
            row.algorithmVersion === null ||
            row.inputHash === null ||
            row.idempotencyKey === null ||
            row.evidenceV2 === null ||
            row.evaluatedAt === null
          ) {
            throw new Error("Current v2 risk row is incomplete.");
          }
          return RiskSignalV2Schema.parse({
            id: row.id,
            schemaVersion: 2,
            canonicalListingId: row.canonicalListingId,
            algorithmVersion: row.algorithmVersion,
            inputHash: row.inputHash,
            idempotencyKey: row.idempotencyKey,
            code: row.code,
            severity: row.severity === "info" ? "informational" : row.severity,
            confidenceBasisPoints: row.confidenceBasisPoints,
            evidence: row.evidenceV2,
            needsVerification: row.needsVerification,
            verificationAction: row.verificationAction,
            status: row.status,
            createdAt: row.evaluatedAt
          });
        });
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(riskSignals).get()?.value);
    }
  };

  const contactWorkflowRepository: VeraRepositories["contactWorkflows"] = {
    insert(workflowInput) {
      const workflow = ContactWorkflowSchema.parse(workflowInput);
      db.insert(contactWorkflows).values(workflow).run();
      return contactWorkflowRepository.getById(workflow.id) ?? workflow;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(contactWorkflows).where(eq(contactWorkflows.id, id)).get();
      return row ? mapContactWorkflowRow(row) : null;
    }
  };

  const approvalRepository: VeraRepositories["approvals"] = {
    insert(approvalInput) {
      const approval = ApprovalSchema.parse(approvalInput);
      db.insert(approvals).values(approval).run();
      return approvalRepository.getById(approval.id) ?? approval;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(approvals).where(eq(approvals.id, id)).get();
      return row ? mapApprovalRow(row) : null;
    },
    transition(idInput, expectedInput, requestedInput, atInput) {
      const id = EntityIdSchema.parse(idInput);
      const expected = ApprovalStateSchema.parse(expectedInput);
      const requested = ApprovalStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      transitionApprovalState(expected, requested);
      const current = approvalRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Approval", id);
      if (current.state !== expected) throw new Error("Approval state changed concurrently.");
      const candidate = ApprovalSchema.parse({
        ...current,
        state: requested,
        usedAt: requested === "used" ? at : null
      });
      const result = db
        .update(approvals)
        .set({ state: candidate.state, usedAt: candidate.usedAt })
        .where(and(eq(approvals.id, id), eq(approvals.state, expected)))
        .run();
      if (result.changes !== 1) throw new Error("Approval state changed concurrently.");
      return approvalRepository.getById(id) ?? candidate;
    }
  };

  const viewingRepository: VeraRepositories["viewings"] = {
    insert(viewingInput) {
      const viewing = ViewingSchema.parse(viewingInput);
      // The isolated SQLite demo keeps Calendar-only fields in the existing JSON metadata
      // column so hosted PostgreSQL remains the sole schema migration target.
      const metadata = { ...viewing.metadata };
      if (viewing.selectedWindow === null) delete metadata.calendarSelectedWindow;
      else metadata.calendarSelectedWindow = viewing.selectedWindow;
      if (viewing.supersedesViewingId === null) delete metadata.calendarSupersedesViewingId;
      else metadata.calendarSupersedesViewingId = viewing.supersedesViewingId;
      const persisted = ViewingSchema.parse({ ...viewing, metadata });
      db.insert(viewings).values(persisted).run();
      return viewingRepository.getById(persisted.id) ?? persisted;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(viewings).where(eq(viewings.id, id)).get();
      return row ? mapViewingRow(row) : null;
    },
    prepareCalendarHold(idInput, expectedState, contactNotes, remindersInput, atInput) {
      const id = EntityIdSchema.parse(idInput);
      const at = IsoDateTimeSchema.parse(atInput);
      const remindersMinutesBeforeStart = ReminderMinutesSchema.parse(remindersInput);
      const current = viewingRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Viewing", id);
      if (current.state !== expectedState) {
        throw new Error("Viewing state changed before Calendar hold preparation.");
      }
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new Error("Calendar hold preparation cannot precede the current Viewing update.");
      }
      const candidate = ViewingSchema.parse({
        ...current,
        notes: contactNotes,
        metadata: {
          ...current.metadata,
          calendarHoldRemindersMinutesBeforeStart: remindersMinutesBeforeStart
        },
        updatedAt: at
      });
      const result = db
        .update(viewings)
        .set({ notes: candidate.notes, metadata: candidate.metadata, updatedAt: at })
        .where(
          and(
            eq(viewings.id, id),
            eq(viewings.state, expectedState),
            eq(viewings.updatedAt, current.updatedAt)
          )
        )
        .run();
      if (result.changes !== 1) {
        throw new Error("Viewing changed concurrently during Calendar hold preparation.");
      }
      return viewingRepository.getById(id) ?? candidate;
    },
    transition(idInput, expectedInput, requestedInput, atInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const expected = ViewingStateSchema.parse(expectedInput);
      const requested = ViewingStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      transitionViewingState(expected, requested);
      const current = viewingRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Viewing", id);
      if (current.state !== expected) throw new Error("Viewing state changed concurrently.");
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new Error("Viewing transition time cannot precede its current update time.");
      }
      const selectedWindow =
        patch.selectedWindow !== undefined
          ? patch.selectedWindow
          : requested === "proposed"
            ? null
            : current.selectedWindow;
      const supersedesViewingId =
        patch.supersedesViewingId !== undefined
          ? patch.supersedesViewingId
          : current.supersedesViewingId;
      const metadata = { ...current.metadata };
      if (selectedWindow === null) delete metadata.calendarSelectedWindow;
      else metadata.calendarSelectedWindow = selectedWindow;
      if (supersedesViewingId === null) delete metadata.calendarSupersedesViewingId;
      else metadata.calendarSupersedesViewingId = supersedesViewingId;
      const candidate = ViewingSchema.parse({
        ...current,
        state: requested,
        selectedWindow,
        confirmedWindow:
          patch.confirmedWindow !== undefined ? patch.confirmedWindow : current.confirmedWindow,
        calendarReference:
          patch.calendarReference !== undefined
            ? patch.calendarReference
            : current.calendarReference,
        supersedesViewingId,
        metadata,
        updatedAt: at
      });
      const result = db
        .update(viewings)
        .set({
          confirmedWindow: candidate.confirmedWindow,
          calendarReference: candidate.calendarReference,
          state: candidate.state,
          metadata: candidate.metadata,
          updatedAt: at
        })
        .where(
          and(
            eq(viewings.id, id),
            eq(viewings.state, expected),
            eq(viewings.updatedAt, current.updatedAt)
          )
        )
        .run();
      if (result.changes !== 1) throw new Error("Viewing state changed concurrently.");
      return viewingRepository.getById(id) ?? candidate;
    },
    listByCanonicalListingId(idInput) {
      const id = EntityIdSchema.parse(idInput);
      return db
        .select()
        .from(viewings)
        .where(eq(viewings.canonicalListingId, id))
        .orderBy(asc(viewings.createdAt), asc(viewings.id))
        .all()
        .map(mapViewingRow);
    }
  };

  const activityEventRepository: VeraRepositories["activityEvents"] = {
    append(eventInput) {
      const event = ActivityEventSchema.parse(eventInput);
      db.insert(activityEvents).values(event).run();
      return activityEventRepository.getById(event.id) ?? event;
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(activityEvents).where(eq(activityEvents.id, id)).get();
      return row ? mapActivityEventRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(activityEvents)
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id))
        .all()
        .map(mapActivityEventRow);
    },
    listByTarget(targetTypeInput, targetIdInput) {
      const targetType = targetTypeInput.trim();
      const targetId = EntityIdSchema.parse(targetIdInput);
      if (!/^[a-z][a-z0-9_.-]{0,99}$/u.test(targetType)) {
        throw new Error("Activity target type must be a safe closed identifier.");
      }
      return db
        .select()
        .from(activityEvents)
        .where(
          and(eq(activityEvents.targetType, targetType), eq(activityEvents.targetId, targetId))
        )
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id))
        .all()
        .map(mapActivityEventRow);
    },
    count() {
      return scalarCount(db.select({ value: count() }).from(activityEvents).get()?.value);
    }
  };

  const sourcePolicyManifestRepository: VeraRepositories["sourcePolicyManifests"] = {
    insert(manifestInput) {
      const manifest = SourcePolicyManifestSchema.parse(manifestInput);
      db.insert(sourcePolicyManifests).values(manifest).run();
      return sourcePolicyManifestRepository.get(manifest.connectorId, manifest.version) ?? manifest;
    },
    get(connectorIdInput, versionInput) {
      const connectorId = EntityIdSchema.parse(connectorIdInput);
      const version = Number.isInteger(versionInput) && versionInput > 0 ? versionInput : null;

      if (version === null) {
        throw new Error("Manifest version must be a positive integer.");
      }

      const row = db
        .select()
        .from(sourcePolicyManifests)
        .where(eq(sourcePolicyManifests.connectorId, connectorId))
        .all()
        .find((candidate) => candidate.version === version);
      return row ? mapSourcePolicyManifestRow(row) : null;
    },
    list() {
      return db
        .select()
        .from(sourcePolicyManifests)
        .orderBy(asc(sourcePolicyManifests.connectorId), desc(sourcePolicyManifests.version))
        .all()
        .map(mapSourcePolicyManifestRow);
    },
    listLatest() {
      const latestByConnector = new Map<string, ReturnType<typeof mapSourcePolicyManifestRow>>();

      for (const manifest of sourcePolicyManifestRepository.list()) {
        if (!latestByConnector.has(manifest.connectorId)) {
          latestByConnector.set(manifest.connectorId, manifest);
        }
      }

      return [...latestByConnector.values()];
    }
  };

  const decisionRepositories = createSqliteDecisionRepositories(connection, () => repositories);
  const repositories: VeraRepositories = {
    searchProfiles: searchProfileRepository,
    rawListings: rawListingRepository,
    sourceRecords: sourceRecordRepository,
    listingPhotos: listingPhotoRepository,
    fieldProvenance: fieldProvenanceRepository,
    listingExtractions: listingExtractionRepository,
    duplicateClusters: duplicateClusterRepository,
    canonicalListings: canonicalListingRepository,
    listingScores: listingScoreRepository,
    riskSignals: riskSignalRepository,
    contactWorkflows: contactWorkflowRepository,
    approvals: approvalRepository,
    viewings: viewingRepository,
    activityEvents: activityEventRepository,
    sourcePolicyManifests: sourcePolicyManifestRepository,
    sourceJobs: sourceJobRepository,
    sourceJobAttempts: sourceJobAttemptRepository,
    browserNodes: browserNodeRepository,
    normalizationJobs: normalizationJobRepository,
    ...decisionRepositories,
    transaction<T>(callback: (transactionRepositories: VeraRepositories) => T): T {
      const transaction = sqlite.transaction(() => {
        const result = callback(repositories);

        if (
          typeof result === "object" &&
          result !== null &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          throw new Error("Vera repository transactions must be synchronous.");
        }

        return result;
      });

      return transaction();
    }
  };

  return repositories;
}
