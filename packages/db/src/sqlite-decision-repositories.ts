import {
  ActivityEventSchema,
  CanonicalListingPlanSchema,
  DecisionCorpusSnapshotSchema,
  DecisionJobAttemptSchema,
  DecisionJobErrorCodeSchema,
  DecisionJobSchema,
  DecisionJobTriggerSchema,
  DecisionPlanSchema,
  DuplicateOverrideRevocationSchema,
  DuplicateOverrideSchema,
  DuplicatePairEvaluationSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  PetPolicySchema,
  type CanonicalFieldSelectionPlan,
  type DecisionJob,
  type FieldProvenance,
  type JsonObject,
  type JsonValue,
  type ListingSourceRecord,
  type NormalizedDecisionSource,
  type PetPolicy
} from "@vera/domain";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import type { VeraDatabaseConnection } from "./connection.ts";
import { canonicalJson, sha256Text } from "./hashing.ts";
import {
  mapCanonicalListingRow,
  mapFieldProvenanceRow,
  mapListingPhotoRow,
  mapListingSourceRecordRow,
  mapRawListingRow,
  mapSearchProfileRow
} from "./row-mappers.ts";
import type {
  AppliedDecisionRun,
  DecisionCorpusState,
  DecisionHistoryRepository,
  DecisionJobRepository,
  DecisionReconciliationRepository,
  DecisionRunRecord,
  DuplicateOverrideRepository,
  VeraRepositories
} from "./repositories.ts";
import {
  activityEvents,
  canonicalDecisionRuns,
  canonicalFieldSources,
  canonicalListingSources,
  canonicalListings,
  decisionCorpusState,
  decisionJobAttempts,
  decisionJobs,
  decisionRuns,
  duplicateClusters,
  duplicateOverrideRevocations,
  duplicateOverrides,
  duplicatePairEvaluations,
  fieldProvenance,
  listingPhotos,
  listingScores,
  listingSourceRecords,
  rawListings,
  riskSignals,
  searchProfiles
} from "./schema.ts";

export class StaleCorpusRevisionError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super("Decision plan was computed from a stale corpus revision.");
    this.name = "StaleCorpusRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class DecisionIdempotencyConflictError extends Error {
  constructor() {
    super("Decision job already has a different immutable result.");
    this.name = "DecisionIdempotencyConflictError";
  }
}

interface DecisionRepositorySet {
  readonly decisionJobs: DecisionJobRepository;
  readonly duplicateOverrides: DuplicateOverrideRepository;
  readonly decisionHistory: DecisionHistoryRepository;
  readonly decisionReconciliation: DecisionReconciliationRepository;
}

function mapDecisionJob(row: typeof decisionJobs.$inferSelect): DecisionJob {
  return DecisionJobSchema.parse(row);
}

function mapDecisionAttempt(
  row: typeof decisionJobAttempts.$inferSelect
): ReturnType<typeof DecisionJobAttemptSchema.parse> {
  return DecisionJobAttemptSchema.parse(row);
}

function mapCorpusState(row: typeof decisionCorpusState.$inferSelect): DecisionCorpusState {
  return {
    searchProfileId: EntityIdSchema.parse(row.searchProfileId),
    revision: row.revision,
    updatedAt: IsoDateTimeSchema.parse(row.updatedAt)
  };
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
    createdAt: IsoDateTimeSchema.parse(row.createdAt)
  };
}

function mapDuplicateOverride(row: typeof duplicateOverrides.$inferSelect) {
  const { payloadHash: _payloadHash, ...override } = row;
  return DuplicateOverrideSchema.parse(override);
}

function connectorId(metadata: JsonObject): string {
  const value = metadata.connectorId;
  return typeof value === "string" && value.trim().length > 0
    ? value.slice(0, 120)
    : "unknown.local.v1";
}

function normalizedAddressPart(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? null : normalized;
}

function sourceValue(record: ListingSourceRecord, fieldPath: string): JsonValue | null {
  const values: Readonly<Record<string, unknown>> = {
    title: record.title,
    "address.line1": record.address.line1,
    "address.unit": record.address.unit,
    "address.city": record.address.city,
    "address.region": record.address.region,
    "address.postalCode": record.address.postalCode,
    "address.countryCode": record.address.countryCode,
    monthlyRentCents: record.monthlyRentCents,
    recurringFeesCents: record.recurringFeesCents,
    bedrooms: record.bedrooms,
    bathrooms: record.bathrooms,
    squareFeet: record.squareFeet,
    propertyType: record.propertyType,
    availableOn: record.availableOn,
    leaseTermMonths: record.leaseTermMonths,
    petPolicy: record.petPolicy,
    "petPolicy.cats": record.petPolicy?.cats ?? null,
    "petPolicy.dogs": record.petPolicy?.dogs ?? null,
    "petPolicy.notes": record.petPolicy?.notes ?? null,
    catsAllowed:
      record.petPolicy?.cats === "unknown" || record.petPolicy === null
        ? null
        : record.petPolicy.cats === "allowed",
    dogsAllowed:
      record.petPolicy?.dogs === "unknown" || record.petPolicy === null
        ? null
        : record.petPolicy.dogs === "allowed",
    amenities: record.amenities,
    description: record.description,
    source: record.source,
    sourceUrl: record.sourceUrl
  };
  const value = values[fieldPath];
  return value === undefined || value === null ? null : JsonValueSchema.parse(value);
}

function normalizedDecisionSource(input: {
  readonly record: ListingSourceRecord;
  readonly raw: ReturnType<typeof mapRawListingRow>;
  readonly provenance: readonly FieldProvenance[];
  readonly photos: readonly ReturnType<typeof mapListingPhotoRow>[];
}): NormalizedDecisionSource {
  const { record, raw } = input;
  const address = normalizedAddressPart(record.address.line1);
  const unit = normalizedAddressPart(record.address.unit);
  const city = normalizedAddressPart(record.address.city);
  const region = record.address.region?.normalize("NFKC").toUpperCase() ?? null;
  const postalCode = record.address.postalCode?.normalize("NFKC").toUpperCase() ?? null;
  const countryCode = record.address.countryCode?.toUpperCase() ?? null;
  const addressMatchKey =
    address === null
      ? null
      : [
          address,
          unit ?? "__unknown_unit__",
          city ?? "",
          region ?? "",
          postalCode ?? "",
          countryCode ?? ""
        ]
          .join("|")
          .slice(0, 1_000);
  return DecisionCorpusSnapshotSchema.shape.sourceRecords.element.parse({
    sourceRecordId: record.id,
    rawListingId: record.rawListingId,
    source: record.source,
    connectorId: connectorId(raw.captureMetadata),
    acquisitionMode: raw.acquisitionMode,
    sourceListingId: record.sourceListingId,
    acquiredAt: raw.createdAt,
    observedAt: record.observedAt,
    postedAt: record.sourcePostedAt,
    title: record.title,
    normalizedAddress: address,
    normalizedUnit: unit,
    normalizedCity: city,
    normalizedRegion: region,
    normalizedPostalCode: postalCode,
    normalizedCountryCode: countryCode,
    addressMatchKey,
    latitude: record.latitude,
    longitude: record.longitude,
    canonicalUrl: record.sourceUrl,
    rentCents: record.monthlyRentCents,
    requiredRecurringFeeCents: record.recurringFeesCents,
    bedrooms: record.bedrooms,
    bathrooms: record.bathrooms,
    squareFeet: record.squareFeet,
    availableOn: record.availableOn,
    descriptionText: record.description ?? "",
    extractionConfidenceBasisPoints: record.extractionConfidenceBasisPoints,
    completenessBasisPoints: record.completenessBasisPoints,
    photoHashes: input.photos.flatMap((photo) =>
      photo.perceptualHash !== null && photo.perceptualHashVersion === "listing-photo.dhash64.v1"
        ? [
            {
              listingPhotoId: photo.id,
              byteHash: photo.byteHash,
              hash: photo.perceptualHash,
              version: photo.perceptualHashVersion
            }
          ]
        : []
    ),
    contactFingerprints: [],
    fieldCandidates: input.provenance.map((provenance) => ({
      fieldPath: provenance.fieldPath,
      fieldProvenanceId: provenance.id,
      sourceRecordId: record.id,
      extractionMethod: provenance.extractionMethod,
      valueStatus: provenance.valueStatus,
      value: provenance.valueStatus === "known" ? sourceValue(record, provenance.fieldPath) : null,
      confidenceBasisPoints: provenance.confidenceBasisPoints,
      observedAt: provenance.observedAt
    })),
    normalizationReasonCodes:
      address === null ? ["field_unknown", "cost_partial"] : ["address_normalized"]
  });
}

function knownField(
  selections: readonly CanonicalFieldSelectionPlan[],
  fieldPath: string
): JsonValue | null {
  const selection = selections.find((candidate) => candidate.fieldPath === fieldPath);
  return selection?.valueStatus === "known" ? selection.value : null;
}

function nullableString(value: JsonValue | null): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: JsonValue | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function canonicalPetPolicy(selections: readonly CanonicalFieldSelectionPlan[]): PetPolicy | null {
  const complete = knownField(selections, "petPolicy");
  if (complete !== null && typeof complete === "object" && !Array.isArray(complete)) {
    return PetPolicySchema.parse(complete);
  }
  const cats = knownField(selections, "catsAllowed");
  const dogs = knownField(selections, "dogsAllowed");
  if (typeof cats !== "boolean" && typeof dogs !== "boolean") return null;
  return PetPolicySchema.parse({
    cats: typeof cats === "boolean" ? (cats ? "allowed" : "not_allowed") : "unknown",
    dogs: typeof dogs === "boolean" ? (dogs ? "allowed" : "not_allowed") : "unknown",
    notes: null
  });
}

function safeRunId(jobId: string): string {
  return `decision-run:${sha256Text(jobId).slice(0, 40)}`;
}

function planOutputHash(plan: ReturnType<typeof DecisionPlanSchema.parse>): string {
  return sha256Text(canonicalJson(JsonValueSchema.parse(plan)));
}

export function createSqliteDecisionRepositories(
  connection: VeraDatabaseConnection,
  repositories: () => VeraRepositories
): DecisionRepositorySet {
  const { db, sqlite } = connection;

  const decisionHistory: DecisionHistoryRepository = {
    getRunById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(decisionRuns).where(eq(decisionRuns.id, id)).get();
      return row ? mapDecisionRun(row) : null;
    },
    getRunByJobId(jobIdInput) {
      const jobId = EntityIdSchema.parse(jobIdInput);
      const row = db.select().from(decisionRuns).where(eq(decisionRuns.jobId, jobId)).get();
      return row ? mapDecisionRun(row) : null;
    },
    listRuns(searchProfileIdInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      return db
        .select()
        .from(decisionRuns)
        .where(eq(decisionRuns.searchProfileId, searchProfileId))
        .orderBy(asc(decisionRuns.corpusRevision), asc(decisionRuns.id))
        .all()
        .map(mapDecisionRun);
    },
    listPairEvaluations(decisionRunIdInput) {
      const decisionRunId = EntityIdSchema.parse(decisionRunIdInput);
      return db
        .select()
        .from(duplicatePairEvaluations)
        .where(eq(duplicatePairEvaluations.decisionRunId, decisionRunId))
        .orderBy(
          asc(duplicatePairEvaluations.leftSourceRecordId),
          asc(duplicatePairEvaluations.rightSourceRecordId)
        )
        .all()
        .map((row) =>
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
            evaluatedAt: row.evaluatedAt
          })
        );
    }
  };

  const decisionJobsRepository: DecisionJobRepository = {
    getCorpusState(searchProfileIdInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      const row = db
        .select()
        .from(decisionCorpusState)
        .where(eq(decisionCorpusState.searchProfileId, searchProfileId))
        .get();
      return row ? mapCorpusState(row) : null;
    },
    ensureCorpusState(searchProfileIdInput, nowInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      const now = IsoDateTimeSchema.parse(nowInput);
      if (repositories().searchProfiles.getById(searchProfileId) === null) {
        throw new Error("Decision corpus profile does not exist.");
      }
      db.insert(decisionCorpusState)
        .values({ searchProfileId, revision: 0, updatedAt: now })
        .onConflictDoNothing()
        .run();
      const state = decisionJobsRepository.getCorpusState(searchProfileId);
      if (state === null) throw new Error("Decision corpus state could not be initialized.");
      return state;
    },
    bumpCorpusRevisionAndEnqueue(input) {
      const transaction = sqlite.transaction(() => {
        const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
        const now = IsoDateTimeSchema.parse(input.now);
        const trigger = DecisionJobTriggerSchema.parse(input.trigger);
        const id = EntityIdSchema.parse(input.id);
        const current = decisionJobsRepository.ensureCorpusState(searchProfileId, now);
        const revision = current.revision + 1;
        db.update(decisionCorpusState)
          .set({ revision, updatedAt: now })
          .where(eq(decisionCorpusState.searchProfileId, searchProfileId))
          .run();
        db.insert(decisionJobs)
          .values({
            id,
            searchProfileId,
            targetCorpusRevision: revision,
            trigger,
            status: "queued",
            inputHash: null,
            outputHash: null,
            attemptCount: 0,
            availableAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null
          })
          .onConflictDoNothing()
          .run();
        const job = decisionJobsRepository.getByProfileRevision(searchProfileId, revision);
        if (job === null) throw new Error("Decision job could not be enqueued.");
        return job;
      });
      return transaction.immediate();
    },
    enqueueCurrentRevision(input) {
      const transaction = sqlite.transaction(() => {
        const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
        const now = IsoDateTimeSchema.parse(input.now);
        const trigger = DecisionJobTriggerSchema.parse(input.trigger);
        const id = EntityIdSchema.parse(input.id);
        const state = decisionJobsRepository.ensureCorpusState(searchProfileId, now);
        db.insert(decisionJobs)
          .values({
            id,
            searchProfileId,
            targetCorpusRevision: state.revision,
            trigger,
            status: "queued",
            inputHash: null,
            outputHash: null,
            attemptCount: 0,
            availableAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null
          })
          .onConflictDoNothing()
          .run();
        const job = decisionJobsRepository.getByProfileRevision(searchProfileId, state.revision);
        if (job === null) throw new Error("Current-revision decision job could not be enqueued.");
        return job;
      });
      return transaction.immediate();
    },
    getById(idInput) {
      const id = EntityIdSchema.parse(idInput);
      const row = db.select().from(decisionJobs).where(eq(decisionJobs.id, id)).get();
      return row ? mapDecisionJob(row) : null;
    },
    getByProfileRevision(searchProfileIdInput, revisionInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      if (!Number.isInteger(revisionInput) || revisionInput < 0) {
        throw new Error("Decision corpus revision must be a nonnegative integer.");
      }
      const row = db
        .select()
        .from(decisionJobs)
        .where(
          and(
            eq(decisionJobs.searchProfileId, searchProfileId),
            eq(decisionJobs.targetCorpusRevision, revisionInput)
          )
        )
        .get();
      return row ? mapDecisionJob(row) : null;
    },
    list() {
      return db
        .select()
        .from(decisionJobs)
        .orderBy(asc(decisionJobs.createdAt), asc(decisionJobs.id))
        .all()
        .map(mapDecisionJob);
    },
    claimNext(input) {
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const now = IsoDateTimeSchema.parse(input.now);
      const leaseExpiresAt = IsoDateTimeSchema.parse(input.leaseExpiresAt);
      if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
        throw new Error("Decision lease expiry must be later than claim time.");
      }
      const transaction = sqlite.transaction(() => {
        const candidate = db
          .select({ id: decisionJobs.id })
          .from(decisionJobs)
          .where(
            and(
              sql`julianday(${decisionJobs.availableAt}) <= julianday(${now})`,
              or(
                inArray(decisionJobs.status, ["queued", "retryable_failed"]),
                and(
                  eq(decisionJobs.status, "running"),
                  sql`julianday(${decisionJobs.leaseExpiresAt}) <= julianday(${now})`
                )
              )
            )
          )
          .orderBy(asc(decisionJobs.availableAt), asc(decisionJobs.createdAt), asc(decisionJobs.id))
          .get();
        if (candidate === undefined) return null;
        db.update(decisionJobs)
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
          .where(eq(decisionJobs.id, candidate.id))
          .run();
        return decisionJobsRepository.getById(candidate.id);
      });
      return transaction.immediate();
    },
    appendAttempt(attemptInput) {
      const attempt = DecisionJobAttemptSchema.parse(attemptInput);
      db.insert(decisionJobAttempts).values(attempt).run();
      const row = db
        .select()
        .from(decisionJobAttempts)
        .where(eq(decisionJobAttempts.id, attempt.id))
        .get();
      if (row === undefined) throw new Error("Decision attempt was not persisted.");
      return mapDecisionAttempt(row);
    },
    listAttempts(jobIdInput) {
      const jobId = EntityIdSchema.parse(jobIdInput);
      return db
        .select()
        .from(decisionJobAttempts)
        .where(eq(decisionJobAttempts.jobId, jobId))
        .orderBy(asc(decisionJobAttempts.attemptNumber), asc(decisionJobAttempts.id))
        .all()
        .map(mapDecisionAttempt);
    },
    fail(input) {
      const id = EntityIdSchema.parse(input.id);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const errorCode = DecisionJobErrorCodeSchema.parse(input.errorCode);
      const failedAt = IsoDateTimeSchema.parse(input.failedAt);
      const retryAt = IsoDateTimeSchema.parse(input.retryAt);
      const errorMessage = input.errorMessage.trim().slice(0, 500);
      if (errorMessage.length === 0) throw new Error("Decision failure needs a safe message.");
      const status = input.retryable ? "retryable_failed" : "permanently_failed";
      const result = db
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
            eq(decisionJobs.id, id),
            eq(decisionJobs.status, "running"),
            eq(decisionJobs.leaseOwner, leaseOwner)
          )
        )
        .run();
      if (result.changes !== 1) throw new Error("Decision job lease was lost.");
      const job = decisionJobsRepository.getById(id);
      if (job === null) throw new Error("Decision job disappeared after failure.");
      return job;
    },
    cancel(idInput, cancelledAtInput) {
      const id = EntityIdSchema.parse(idInput);
      const cancelledAt = IsoDateTimeSchema.parse(cancelledAtInput);
      db.update(decisionJobs)
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
            eq(decisionJobs.id, id),
            inArray(decisionJobs.status, ["queued", "running", "retryable_failed"])
          )
        )
        .run();
      const job = decisionJobsRepository.getById(id);
      if (job === null) throw new Error("Decision job does not exist.");
      return job;
    }
  };

  const overrideRepository: DuplicateOverrideRepository = {
    create(overrideInput) {
      const override = DuplicateOverrideSchema.parse(overrideInput);
      const payloadHash = sha256Text(canonicalJson(JsonValueSchema.parse(override)));
      db.insert(duplicateOverrides)
        .values({ ...override, payloadHash })
        .run();
      return override;
    },
    revoke(revocationInput) {
      const revocation = DuplicateOverrideRevocationSchema.parse(revocationInput);
      db.insert(duplicateOverrideRevocations).values(revocation).run();
      return revocation;
    },
    list(searchProfileIdInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      return db
        .select()
        .from(duplicateOverrides)
        .where(eq(duplicateOverrides.searchProfileId, searchProfileId))
        .orderBy(asc(duplicateOverrides.createdAt), asc(duplicateOverrides.id))
        .all()
        .map(mapDuplicateOverride);
    },
    listActive(searchProfileIdInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      return db
        .select({ override: duplicateOverrides })
        .from(duplicateOverrides)
        .leftJoin(
          duplicateOverrideRevocations,
          eq(duplicateOverrideRevocations.overrideId, duplicateOverrides.id)
        )
        .where(
          and(
            eq(duplicateOverrides.searchProfileId, searchProfileId),
            sql`${duplicateOverrideRevocations.id} IS NULL`
          )
        )
        .orderBy(asc(duplicateOverrides.createdAt), asc(duplicateOverrides.id))
        .all()
        .map(({ override }) => mapDuplicateOverride(override));
    },
    listRevocations(searchProfileIdInput) {
      const searchProfileId = EntityIdSchema.parse(searchProfileIdInput);
      return db
        .select({ revocation: duplicateOverrideRevocations })
        .from(duplicateOverrideRevocations)
        .innerJoin(
          duplicateOverrides,
          eq(duplicateOverrideRevocations.overrideId, duplicateOverrides.id)
        )
        .where(eq(duplicateOverrides.searchProfileId, searchProfileId))
        .orderBy(asc(duplicateOverrideRevocations.createdAt), asc(duplicateOverrideRevocations.id))
        .all()
        .map(({ revocation }) => DuplicateOverrideRevocationSchema.parse(revocation));
    }
  };

  const reconciliationRepository: DecisionReconciliationRepository = {
    readSnapshot(input) {
      const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
      if (!Number.isInteger(input.targetCorpusRevision) || input.targetCorpusRevision < 0) {
        throw new Error("Decision snapshot revision must be nonnegative.");
      }
      const state = decisionJobsRepository.getCorpusState(searchProfileId);
      if (state === null) throw new Error("Decision corpus state is missing.");
      if (state.revision !== input.targetCorpusRevision) {
        throw new StaleCorpusRevisionError(input.targetCorpusRevision, state.revision);
      }
      const profileRow = db
        .select()
        .from(searchProfiles)
        .where(eq(searchProfiles.id, searchProfileId))
        .get();
      if (profileRow === undefined) throw new Error("Decision search profile is missing.");
      const sourceRows = db
        .select({ source: listingSourceRecords, raw: rawListings })
        .from(listingSourceRecords)
        .innerJoin(rawListings, eq(listingSourceRecords.rawListingId, rawListings.id))
        .orderBy(asc(listingSourceRecords.id))
        .all();
      const provenanceRows = db
        .select()
        .from(fieldProvenance)
        .orderBy(asc(fieldProvenance.listingSourceRecordId), asc(fieldProvenance.fieldPath))
        .all();
      const photoRows = db
        .select()
        .from(listingPhotos)
        .orderBy(asc(listingPhotos.listingSourceRecordId), asc(listingPhotos.position))
        .all();
      const provenanceBySource = new Map<string, FieldProvenance[]>();
      for (const row of provenanceRows) {
        const provenance = mapFieldProvenanceRow(row);
        provenanceBySource.set(provenance.listingSourceRecordId, [
          ...(provenanceBySource.get(provenance.listingSourceRecordId) ?? []),
          provenance
        ]);
      }
      const photosBySource = new Map<string, ReturnType<typeof mapListingPhotoRow>[]>();
      for (const row of photoRows) {
        const photo = mapListingPhotoRow(row);
        photosBySource.set(photo.listingSourceRecordId, [
          ...(photosBySource.get(photo.listingSourceRecordId) ?? []),
          photo
        ]);
      }
      const sourceRecords = sourceRows.map(({ source, raw }) => {
        const record = mapListingSourceRecordRow(source);
        return normalizedDecisionSource({
          record,
          raw: mapRawListingRow(raw),
          provenance: provenanceBySource.get(record.id) ?? [],
          photos: photosBySource.get(record.id) ?? []
        });
      });
      const activeCanonicalRows = db
        .select()
        .from(canonicalListings)
        .where(eq(canonicalListings.projectionState, "active"))
        .orderBy(asc(canonicalListings.id))
        .all();
      const priorCanonicals = activeCanonicalRows.map((row) => {
        const listing = mapCanonicalListingRow(row);
        const memberSourceRecordIds = db
          .select({ id: canonicalListingSources.listingSourceRecordId })
          .from(canonicalListingSources)
          .where(eq(canonicalListingSources.canonicalListingId, listing.id))
          .orderBy(asc(canonicalListingSources.listingSourceRecordId))
          .all()
          .map(({ id }) => id);
        return {
          canonicalListingId: listing.id,
          memberSourceRecordIds,
          primarySourceRecordId: listing.primarySourceRecordId,
          lifecycleState: listing.lifecycleState,
          createdAt: listing.createdAt
        };
      });
      return DecisionCorpusSnapshotSchema.parse({
        searchProfile: mapSearchProfileRow(profileRow),
        corpusRevision: state.revision,
        sourceRecords,
        activeOverrides: overrideRepository.listActive(searchProfileId),
        priorCanonicals
      });
    },
    applyPlan(input): AppliedDecisionRun {
      const jobId = EntityIdSchema.parse(input.jobId);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const plan = DecisionPlanSchema.parse(input.plan);
      const existingRun = decisionHistory.getRunByJobId(jobId);
      if (existingRun !== null) {
        if (existingRun.inputHash !== plan.inputHash) {
          throw new DecisionIdempotencyConflictError();
        }
        return { run: existingRun, replayed: true };
      }
      const transaction = sqlite.transaction(() => {
        const job = decisionJobsRepository.getById(jobId);
        if (job === null) throw new Error("Decision job does not exist.");
        if (job.status !== "running" || job.leaseOwner !== leaseOwner) {
          throw new Error("Decision job lease was lost.");
        }
        const state = decisionJobsRepository.getCorpusState(job.searchProfileId);
        if (state === null) throw new Error("Decision corpus state is missing.");
        if (
          state.revision !== plan.corpusRevision ||
          job.targetCorpusRevision !== plan.corpusRevision
        ) {
          throw new StaleCorpusRevisionError(plan.corpusRevision, state.revision);
        }
        const plannedSourceIds = plan.canonicalPlans.flatMap(
          ({ memberSourceRecordIds }) => memberSourceRecordIds
        );
        if (new Set(plannedSourceIds).size !== plannedSourceIds.length) {
          throw new Error("Decision plan assigns a source to more than one canonical listing.");
        }
        const persistedSourceIds = db
          .select({ id: listingSourceRecords.id })
          .from(listingSourceRecords)
          .orderBy(asc(listingSourceRecords.id))
          .all()
          .map(({ id }) => id);
        if (canonicalJson(plannedSourceIds.slice().sort()) !== canonicalJson(persistedSourceIds)) {
          throw new Error("Decision plan must assign every persisted source exactly once.");
        }
        for (const canonical of plan.canonicalPlans) {
          CanonicalListingPlanSchema.parse(canonical);
          for (const selection of canonical.selectedFields) {
            if (selection.selectedFieldProvenanceId === null) continue;
            const provenance = db
              .select()
              .from(fieldProvenance)
              .where(eq(fieldProvenance.id, selection.selectedFieldProvenanceId))
              .get();
            if (
              provenance === undefined ||
              provenance.listingSourceRecordId !== selection.selectedSourceRecordId ||
              provenance.fieldPath !== selection.fieldPath
            ) {
              throw new Error("Canonical field selection has mismatched provenance.");
            }
          }
        }
        const outputHash = planOutputHash(plan);
        const runId = safeRunId(jobId);
        const counts: JsonObject = {
          pairEvaluations: plan.pairEvaluations.length,
          clusters: plan.clusterPlans.length,
          canonicals: plan.canonicalPlans.length,
          scores: plan.scoreSnapshots.length,
          riskSignals: plan.riskSignals.length
        };
        db.insert(decisionRuns)
          .values({
            id: runId,
            jobId,
            searchProfileId: job.searchProfileId,
            corpusRevision: plan.corpusRevision,
            planVersion: plan.version,
            inputHash: plan.inputHash,
            outputHash,
            counts,
            createdAt: plan.computedAt
          })
          .run();
        if (plan.pairEvaluations.length > 0) {
          db.insert(duplicatePairEvaluations)
            .values(
              plan.pairEvaluations.map((pair) => ({
                id: `${runId}:${pair.id}`.slice(0, 160),
                decisionRunId: runId,
                leftSourceRecordId: pair.leftSourceRecordId,
                rightSourceRecordId: pair.rightSourceRecordId,
                algorithmVersion: pair.algorithmVersion,
                inputHash: pair.inputHash,
                decision: pair.decision,
                scoreBasisPoints: pair.scoreBasisPoints,
                automaticLinkThresholdBasisPoints: pair.automaticLinkThresholdBasisPoints,
                reviewThresholdBasisPoints: pair.reviewThresholdBasisPoints,
                exactReasonCodes: pair.exactReasonCodes,
                conflictReasonCodes: pair.conflictReasonCodes,
                contactMatched: pair.contactMatched,
                features: pair.features,
                evaluatedAt: pair.evaluatedAt
              }))
            )
            .run();
        }
        db.update(duplicateClusters)
          .set({ projectionState: "superseded" })
          .where(eq(duplicateClusters.projectionState, "active"))
          .run();
        for (const cluster of plan.clusterPlans.filter(
          ({ memberSourceRecordIds }) => memberSourceRecordIds.length > 1
        )) {
          db.insert(duplicateClusters)
            .values({
              id: cluster.clusterId,
              clusterKey: sha256Text(canonicalJson(cluster.memberSourceRecordIds)),
              algorithmVersion: plan.dedupeVersion,
              configVersion: plan.dedupeVersion,
              projectionState: "active",
              updatedByDecisionRunId: runId,
              reasonCodes: cluster.reasonCodes.length > 0 ? cluster.reasonCodes : ["clustered"],
              createdAt: plan.computedAt
            })
            .onConflictDoUpdate({
              target: duplicateClusters.id,
              set: {
                algorithmVersion: plan.dedupeVersion,
                configVersion: plan.dedupeVersion,
                projectionState: "active",
                updatedByDecisionRunId: runId,
                reasonCodes: cluster.reasonCodes.length > 0 ? cluster.reasonCodes : ["clustered"]
              }
            })
            .run();
        }
        const activeIds = plan.canonicalPlans.map(({ canonicalListingId }) => canonicalListingId);
        const existingActive = db
          .select({ id: canonicalListings.id })
          .from(canonicalListings)
          .where(eq(canonicalListings.projectionState, "active"))
          .all();
        const redirectByLoser = new Map(
          plan.supersessions.map((item) => [
            item.supersededCanonicalListingId,
            item.survivorCanonicalListingId
          ])
        );
        for (const { id } of existingActive) {
          if (activeIds.includes(id)) continue;
          const survivor = redirectByLoser.get(id);
          if (survivor === undefined || !activeIds.includes(survivor)) {
            throw new Error("Inactive canonical listing lacks a valid survivor redirect.");
          }
          db.update(canonicalListings)
            .set({
              projectionState: "superseded",
              supersededById: survivor,
              updatedByDecisionRunId: runId,
              updatedAt: plan.computedAt
            })
            .where(eq(canonicalListings.id, id))
            .run();
        }
        db.delete(canonicalFieldSources).run();
        db.delete(canonicalListingSources).run();
        const sourceRowsById = new Map(
          db
            .select()
            .from(listingSourceRecords)
            .all()
            .map((row) => [row.id, row])
        );
        for (const canonical of plan.canonicalPlans) {
          const primary = sourceRowsById.get(canonical.primarySourceRecordId);
          if (primary === undefined) throw new Error("Canonical primary source is missing.");
          const selections = canonical.selectedFields;
          const title = nullableString(knownField(selections, "title")) ?? primary.title;
          const clusterId = canonical.memberSourceRecordIds.length > 1 ? canonical.clusterId : null;
          db.insert(canonicalListings)
            .values({
              id: canonical.canonicalListingId,
              duplicateClusterId: clusterId,
              primarySourceRecordId: canonical.primarySourceRecordId,
              title,
              addressLine1:
                nullableString(knownField(selections, "address.line1")) ?? primary.addressLine1,
              addressUnit:
                nullableString(knownField(selections, "address.unit")) ?? primary.addressUnit,
              addressCity:
                nullableString(knownField(selections, "address.city")) ?? primary.addressCity,
              addressRegion:
                nullableString(knownField(selections, "address.region")) ?? primary.addressRegion,
              addressPostalCode:
                nullableString(knownField(selections, "address.postalCode")) ??
                primary.addressPostalCode,
              addressCountryCode:
                nullableString(knownField(selections, "address.countryCode")) ??
                primary.addressCountryCode,
              monthlyRentCents: nullableNumber(knownField(selections, "monthlyRentCents")),
              recurringFeesCents: nullableNumber(knownField(selections, "recurringFeesCents")),
              bedroomsHalfUnits:
                nullableNumber(knownField(selections, "bedrooms")) === null
                  ? null
                  : nullableNumber(knownField(selections, "bedrooms"))! * 2,
              bathroomsHalfUnits:
                nullableNumber(knownField(selections, "bathrooms")) === null
                  ? null
                  : nullableNumber(knownField(selections, "bathrooms"))! * 2,
              squareFeet: nullableNumber(knownField(selections, "squareFeet")),
              propertyType: nullableString(knownField(selections, "propertyType")),
              availableOn: nullableString(knownField(selections, "availableOn")),
              leaseTermMonths: nullableNumber(knownField(selections, "leaseTermMonths")),
              petPolicy: canonicalPetPolicy(selections),
              amenities: stringArray(knownField(selections, "amenities")),
              description: nullableString(knownField(selections, "description")),
              lifecycleState: canonical.lifecycleState,
              projectionState: "active",
              supersededById: null,
              stitchVersion: canonical.stitchVersion,
              stitchInputHash: canonical.stitchInputHash,
              updatedByDecisionRunId: runId,
              completenessBasisPoints: canonical.completenessBasisPoints,
              freshestObservedAt: canonical.freshestObservedAt,
              createdAt:
                db
                  .select({ createdAt: canonicalListings.createdAt })
                  .from(canonicalListings)
                  .where(eq(canonicalListings.id, canonical.canonicalListingId))
                  .get()?.createdAt ?? plan.computedAt,
              updatedAt: plan.computedAt
            })
            .onConflictDoUpdate({
              target: canonicalListings.id,
              set: {
                duplicateClusterId: clusterId,
                primarySourceRecordId: canonical.primarySourceRecordId,
                title,
                addressLine1:
                  nullableString(knownField(selections, "address.line1")) ?? primary.addressLine1,
                addressUnit:
                  nullableString(knownField(selections, "address.unit")) ?? primary.addressUnit,
                addressCity:
                  nullableString(knownField(selections, "address.city")) ?? primary.addressCity,
                addressRegion:
                  nullableString(knownField(selections, "address.region")) ?? primary.addressRegion,
                addressPostalCode:
                  nullableString(knownField(selections, "address.postalCode")) ??
                  primary.addressPostalCode,
                addressCountryCode:
                  nullableString(knownField(selections, "address.countryCode")) ??
                  primary.addressCountryCode,
                monthlyRentCents: nullableNumber(knownField(selections, "monthlyRentCents")),
                recurringFeesCents: nullableNumber(knownField(selections, "recurringFeesCents")),
                bedroomsHalfUnits:
                  nullableNumber(knownField(selections, "bedrooms")) === null
                    ? null
                    : nullableNumber(knownField(selections, "bedrooms"))! * 2,
                bathroomsHalfUnits:
                  nullableNumber(knownField(selections, "bathrooms")) === null
                    ? null
                    : nullableNumber(knownField(selections, "bathrooms"))! * 2,
                squareFeet: nullableNumber(knownField(selections, "squareFeet")),
                propertyType: nullableString(knownField(selections, "propertyType")),
                availableOn: nullableString(knownField(selections, "availableOn")),
                leaseTermMonths: nullableNumber(knownField(selections, "leaseTermMonths")),
                petPolicy: canonicalPetPolicy(selections),
                amenities: stringArray(knownField(selections, "amenities")),
                description: nullableString(knownField(selections, "description")),
                lifecycleState: canonical.lifecycleState,
                projectionState: "active",
                supersededById: null,
                stitchVersion: canonical.stitchVersion,
                stitchInputHash: canonical.stitchInputHash,
                updatedByDecisionRunId: runId,
                completenessBasisPoints: canonical.completenessBasisPoints,
                freshestObservedAt: canonical.freshestObservedAt,
                updatedAt: plan.computedAt
              }
            })
            .run();
          db.insert(canonicalListingSources)
            .values(
              canonical.memberSourceRecordIds.map((sourceId) => ({
                canonicalListingId: canonical.canonicalListingId,
                listingSourceRecordId: sourceId,
                isPrimary: sourceId === canonical.primarySourceRecordId
              }))
            )
            .run();
          const selectedKnown = canonical.selectedFields.filter(
            (selection) => selection.selectedFieldProvenanceId !== null
          );
          if (selectedKnown.length > 0) {
            db.insert(canonicalFieldSources)
              .values(
                selectedKnown.map((selection) => ({
                  canonicalListingId: canonical.canonicalListingId,
                  fieldPath: selection.fieldPath,
                  fieldProvenanceId: selection.selectedFieldProvenanceId!
                }))
              )
              .run();
          }
          db.insert(canonicalDecisionRuns)
            .values({
              id: `canonical-run:${sha256Text(`${runId}:${canonical.canonicalListingId}`).slice(0, 40)}`,
              decisionRunId: runId,
              canonicalListingId: canonical.canonicalListingId,
              clusterId: canonical.clusterId,
              primarySourceRecordId: canonical.primarySourceRecordId,
              stitchVersion: canonical.stitchVersion,
              stitchInputHash: canonical.stitchInputHash,
              memberSourceRecordIds: canonical.memberSourceRecordIds,
              selectedFields: canonical.selectedFields,
              diagnostics: { priorCanonicalListingIds: canonical.priorCanonicalListingIds }
            })
            .run();
        }
        if (plan.scoreSnapshots.length > 0) {
          db.insert(listingScores)
            .values(
              plan.scoreSnapshots.map((score) => ({
                id: score.id,
                canonicalListingId: score.canonicalListingId,
                searchProfileId: score.searchProfileId,
                algorithmVersion: score.algorithmVersion,
                inputHash: score.inputHash,
                totalScoreBasisPoints: score.finalScoreBasisPoints,
                factors: score.factors.map((factor) => ({
                  code: factor.code,
                  scoreBasisPoints: factor.scoreBasisPoints ?? 0,
                  weightBasisPoints: factor.normalizedWeightBasisPoints,
                  reasonCode: factor.reasonCodes[0] ?? "needs_verification"
                })),
                reasonCodes: score.reasonCodes,
                computedAt: score.computedAt,
                schemaVersion: "listing-score.v2",
                decisionRunId: runId,
                eligible: score.eligible,
                hardConstraintsV2: score.hardConstraints,
                factorsV2: score.factors,
                baseScoreBasisPoints: score.baseScoreBasisPoints,
                stalePenaltyBasisPoints: score.stalePenaltyBasisPoints,
                lowConfidencePenaltyBasisPoints: score.lowConfidencePenaltyBasisPoints,
                riskPenaltyBasisPoints: score.riskPenaltyBasisPoints,
                finalScoreBasisPoints: score.finalScoreBasisPoints,
                explanation: score.explanation
              }))
            )
            .run();
        }
        if (plan.riskSignals.length > 0) {
          db.insert(riskSignals)
            .values(
              plan.riskSignals.map((risk) => ({
                id: risk.id,
                canonicalListingId: risk.canonicalListingId,
                code: risk.code,
                severity: risk.severity === "informational" ? "info" : risk.severity,
                confidenceBasisPoints: risk.confidenceBasisPoints,
                evidence: risk.evidence.map(({ sourceRecordId, fieldPath, summary }) => ({
                  sourceRecordId,
                  fieldPath,
                  summary
                })),
                verificationAction: risk.verificationAction,
                status: risk.status,
                createdAt: risk.createdAt,
                updatedAt: risk.createdAt,
                schemaVersion: "listing-risk.v2",
                decisionRunId: runId,
                algorithmVersion: risk.algorithmVersion,
                inputHash: risk.inputHash,
                idempotencyKey: risk.idempotencyKey,
                evidenceV2: risk.evidence,
                needsVerification: risk.needsVerification,
                evaluatedAt: risk.createdAt
              }))
            )
            .run();
        }
        const attemptId = `decision-attempt:${sha256Text(`${job.id}:${String(job.attemptCount)}`).slice(0, 40)}`;
        const durationMilliseconds = Math.max(
          0,
          Date.parse(plan.computedAt) - Date.parse(job.updatedAt)
        );
        db.insert(decisionJobAttempts)
          .values({
            id: attemptId,
            jobId: job.id,
            attemptNumber: job.attemptCount,
            startedAt: job.updatedAt,
            finishedAt: plan.computedAt,
            outcome: "succeeded",
            errorCode: null,
            durationMilliseconds
          })
          .run();
        db.update(decisionJobs)
          .set({
            status: "succeeded",
            inputHash: plan.inputHash,
            outputHash,
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: plan.computedAt,
            completedAt: plan.computedAt
          })
          .where(eq(decisionJobs.id, job.id))
          .run();
        const activity = ActivityEventSchema.parse({
          id: `event:decision:${sha256Text(runId).slice(0, 40)}`,
          correlationId: job.id,
          causationId: job.id,
          actor: "system",
          action: "decision.completed",
          targetType: "search_profile",
          targetId: job.searchProfileId,
          policyDecision: "not_applicable",
          approvalId: null,
          payloadHash: outputHash,
          outcome: "succeeded",
          errorCategory: null,
          metadata: {
            decisionRunId: runId,
            corpusRevision: plan.corpusRevision,
            planVersion: plan.version,
            dedupeVersion: plan.dedupeVersion,
            scoreVersion: plan.scoreVersion,
            riskVersion: plan.riskVersion,
            ...counts
          },
          occurredAt: plan.computedAt
        });
        db.insert(activityEvents).values(activity).run();
        const run = decisionHistory.getRunById(runId);
        if (run === null) throw new Error("Decision run was not persisted.");
        return { run, replayed: false };
      });
      return transaction.immediate();
    }
  };

  return {
    decisionJobs: decisionJobsRepository,
    duplicateOverrides: overrideRepository,
    decisionHistory,
    decisionReconciliation: reconciliationRepository
  };
}
