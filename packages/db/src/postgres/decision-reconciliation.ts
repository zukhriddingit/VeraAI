import {
  ActivityEventSchema,
  CanonicalListingPlanSchema,
  DecisionCorpusSnapshotSchema,
  DecisionPlanSchema,
  EntityIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  PetPolicySchema,
  type CanonicalFieldSelectionPlan,
  type FieldProvenance,
  type JsonObject,
  type JsonValue,
  type ListingSourceRecord,
  type NormalizedDecisionSource,
  type PetPolicy,
  type VeraUserId
} from "@vera/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

import { canonicalJson, sha256Text } from "../hashing.ts";
import {
  DecisionIdempotencyConflictError,
  StaleCorpusRevisionError,
  type AppliedDecisionRun,
  type UserRepositories
} from "../repositories.ts";
import { PostgresRepositoryError } from "./errors.ts";
import {
  mapCanonicalListingRow,
  mapFieldProvenanceRow,
  mapListingPhotoRow,
  mapListingSourceRecordRow,
  mapRawListingRow,
  mapSearchProfileRow
} from "./row-mappers.ts";
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
  duplicatePairEvaluations,
  fieldProvenance,
  listingPhotos,
  listingScores,
  listingSourceRecords,
  rawListings,
  riskSignals,
  searchProfiles
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

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

function canonicalFieldPath(fieldPath: string): string | null {
  switch (fieldPath) {
    case "addressText":
      return "address.line1";
    case "baseRent":
      return "monthlyRentCents";
    case "requiredRecurringFees":
      return "recurringFeesCents";
    case "availabilityRaw":
    case "contactChannel":
    case "contactEmail":
    case "contactName":
    case "contactPhone":
    case "contactUrl":
    case "source":
    case "sourcePostedAt":
    case "sourceUrl":
      return null;
    default:
      return fieldPath;
  }
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
    fieldCandidates: input.provenance.flatMap((provenance) => {
      const fieldPath = canonicalFieldPath(provenance.fieldPath);
      if (fieldPath === null) return [];
      const value = provenance.valueStatus === "known" ? sourceValue(record, fieldPath) : null;
      const valueStatus =
        provenance.valueStatus === "known" && value !== null ? "known" : "unknown";
      return [
        {
          fieldPath,
          fieldProvenanceId: provenance.id,
          sourceRecordId: record.id,
          extractionMethod: provenance.extractionMethod,
          valueStatus,
          value: valueStatus === "known" ? value : null,
          confidenceBasisPoints: valueStatus === "known" ? provenance.confidenceBasisPoints : 0,
          observedAt: provenance.observedAt
        }
      ];
    }),
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

export function createPostgresDecisionReconciliation(
  db: PostgresExecutor,
  userId: VeraUserId,
  dependencies: Pick<UserRepositories, "decisionJobs" | "duplicateOverrides" | "decisionHistory">
): UserRepositories["decisionReconciliation"] {
  return {
    async readSnapshot(input) {
      const searchProfileId = EntityIdSchema.parse(input.searchProfileId);
      if (!Number.isInteger(input.targetCorpusRevision) || input.targetCorpusRevision < 0) {
        throw new Error("Decision snapshot revision must be nonnegative.");
      }
      const state = await dependencies.decisionJobs.getCorpusState(searchProfileId);
      if (!state) throw new Error("Decision corpus state is missing.");
      if (state.revision !== input.targetCorpusRevision) {
        throw new StaleCorpusRevisionError(input.targetCorpusRevision, state.revision);
      }
      const profileRows = await db
        .select()
        .from(searchProfiles)
        .where(and(eq(searchProfiles.userId, userId), eq(searchProfiles.id, searchProfileId)))
        .limit(1);
      const profileRow = profileRows[0];
      if (!profileRow) throw new Error("Decision search profile is missing.");
      const sourceRows = await db
        .select({ source: listingSourceRecords, raw: rawListings })
        .from(listingSourceRecords)
        .innerJoin(
          rawListings,
          and(
            eq(listingSourceRecords.userId, rawListings.userId),
            eq(listingSourceRecords.rawListingId, rawListings.id)
          )
        )
        .where(eq(listingSourceRecords.userId, userId))
        .orderBy(asc(listingSourceRecords.id));
      const provenanceRows = await db
        .select()
        .from(fieldProvenance)
        .where(eq(fieldProvenance.userId, userId))
        .orderBy(asc(fieldProvenance.listingSourceRecordId), asc(fieldProvenance.fieldPath));
      const photoRows = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.userId, userId))
        .orderBy(asc(listingPhotos.listingSourceRecordId), asc(listingPhotos.position));
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
      const activeRows = await db
        .select()
        .from(canonicalListings)
        .where(
          and(
            eq(canonicalListings.userId, userId),
            eq(canonicalListings.searchProfileId, searchProfileId),
            eq(canonicalListings.projectionState, "active")
          )
        )
        .orderBy(asc(canonicalListings.id));
      const priorCanonicals = [];
      for (const row of activeRows) {
        const listing = mapCanonicalListingRow(row);
        const memberRows = await db
          .select({ id: canonicalListingSources.listingSourceRecordId })
          .from(canonicalListingSources)
          .where(
            and(
              eq(canonicalListingSources.userId, userId),
              eq(canonicalListingSources.canonicalListingId, listing.id)
            )
          )
          .orderBy(asc(canonicalListingSources.listingSourceRecordId));
        priorCanonicals.push({
          canonicalListingId: listing.id,
          memberSourceRecordIds: memberRows.map(({ id }) => id),
          primarySourceRecordId: listing.primarySourceRecordId,
          lifecycleState: listing.lifecycleState,
          createdAt: listing.createdAt
        });
      }
      return DecisionCorpusSnapshotSchema.parse({
        searchProfile: mapSearchProfileRow(profileRow),
        corpusRevision: state.revision,
        sourceRecords,
        activeOverrides: await dependencies.duplicateOverrides.listActive(searchProfileId),
        priorCanonicals
      });
    },
    async applyPlan(input): Promise<AppliedDecisionRun> {
      const jobId = EntityIdSchema.parse(input.jobId);
      const leaseOwner = EntityIdSchema.parse(input.leaseOwner);
      const plan = DecisionPlanSchema.parse(input.plan);
      return db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(decisionJobs)
          .where(and(eq(decisionJobs.userId, userId), eq(decisionJobs.id, jobId)))
          .limit(1)
          .for("update");
        const jobRow = jobRows[0];
        if (!jobRow) throw new Error("Decision job does not exist.");
        const existingRows = await tx
          .select()
          .from(decisionRuns)
          .where(and(eq(decisionRuns.userId, userId), eq(decisionRuns.jobId, jobId)))
          .limit(1);
        if (existingRows[0]) {
          const existing = await dependencies.decisionHistory.getRunByJobId(jobId);
          if (!existing) throw new Error("Decision run history is inconsistent.");
          if (existing.inputHash !== plan.inputHash) throw new DecisionIdempotencyConflictError();
          return { run: existing, replayed: true };
        }
        if (jobRow.status !== "running" || jobRow.leaseOwner !== leaseOwner) {
          throw new PostgresRepositoryError("conflict", false, "Decision job lease was lost.");
        }
        const stateRows = await tx
          .select()
          .from(decisionCorpusState)
          .where(
            and(
              eq(decisionCorpusState.userId, userId),
              eq(decisionCorpusState.searchProfileId, jobRow.searchProfileId)
            )
          )
          .limit(1)
          .for("share");
        const state = stateRows[0];
        if (!state) throw new Error("Decision corpus state is missing.");
        if (
          state.revision !== plan.corpusRevision ||
          jobRow.targetCorpusRevision !== plan.corpusRevision
        ) {
          throw new StaleCorpusRevisionError(plan.corpusRevision, state.revision);
        }
        const plannedSourceIds = plan.canonicalPlans.flatMap(
          ({ memberSourceRecordIds }) => memberSourceRecordIds
        );
        if (new Set(plannedSourceIds).size !== plannedSourceIds.length) {
          throw new Error("Decision plan assigns a source more than once.");
        }
        const persistedSources = await tx
          .select({ id: listingSourceRecords.id })
          .from(listingSourceRecords)
          .where(eq(listingSourceRecords.userId, userId))
          .orderBy(asc(listingSourceRecords.id));
        const persistedSourceIds = persistedSources.map(({ id }) => id);
        if (canonicalJson([...plannedSourceIds].sort()) !== canonicalJson(persistedSourceIds)) {
          throw new Error("Decision plan must assign every persisted source exactly once.");
        }
        for (const canonical of plan.canonicalPlans) {
          CanonicalListingPlanSchema.parse(canonical);
          for (const selection of canonical.selectedFields) {
            if (selection.selectedFieldProvenanceId === null) continue;
            const rows = await tx
              .select()
              .from(fieldProvenance)
              .where(
                and(
                  eq(fieldProvenance.userId, userId),
                  eq(fieldProvenance.id, selection.selectedFieldProvenanceId)
                )
              )
              .limit(1);
            const provenance = rows[0];
            if (
              !provenance ||
              provenance.listingSourceRecordId !== selection.selectedSourceRecordId ||
              canonicalFieldPath(provenance.fieldPath) !== selection.fieldPath
            ) {
              throw new Error("Canonical field selection has mismatched provenance.");
            }
          }
        }
        return applyValidatedPlan(tx, userId, jobRow, plan);
      });
    }
  };
}

async function applyValidatedPlan(
  db: PostgresExecutor,
  userId: VeraUserId,
  job: typeof decisionJobs.$inferSelect,
  plan: ReturnType<typeof DecisionPlanSchema.parse>
): Promise<AppliedDecisionRun> {
  const outputHash = planOutputHash(plan);
  const runId = safeRunId(job.id);
  const computedAt = new Date(plan.computedAt);
  const counts: JsonObject = {
    pairEvaluations: plan.pairEvaluations.length,
    clusters: plan.clusterPlans.length,
    canonicals: plan.canonicalPlans.length,
    scores: plan.scoreSnapshots.length,
    riskSignals: plan.riskSignals.length
  };
  const runRows = await db
    .insert(decisionRuns)
    .values({
      userId,
      id: runId,
      jobId: job.id,
      searchProfileId: job.searchProfileId,
      corpusRevision: plan.corpusRevision,
      planVersion: plan.version,
      inputHash: plan.inputHash,
      outputHash,
      counts,
      createdAt: computedAt
    })
    .returning();
  if (!runRows[0]) throw new Error("Decision run insert returned no row.");
  if (plan.pairEvaluations.length > 0) {
    await db.insert(duplicatePairEvaluations).values(
      plan.pairEvaluations.map((pair) => ({
        userId,
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
        evaluatedAt: new Date(pair.evaluatedAt)
      }))
    );
  }
  await db
    .update(duplicateClusters)
    .set({ projectionState: "superseded" })
    .where(
      and(
        eq(duplicateClusters.userId, userId),
        eq(duplicateClusters.searchProfileId, job.searchProfileId),
        eq(duplicateClusters.projectionState, "active")
      )
    );
  for (const cluster of plan.clusterPlans.filter(
    ({ memberSourceRecordIds }) => memberSourceRecordIds.length > 1
  )) {
    await db
      .insert(duplicateClusters)
      .values({
        userId,
        id: cluster.clusterId,
        searchProfileId: job.searchProfileId,
        clusterKey: sha256Text(canonicalJson(cluster.memberSourceRecordIds)),
        algorithmVersion: plan.dedupeVersion,
        configVersion: plan.dedupeVersion,
        projectionState: "active",
        updatedByDecisionRunId: runId,
        reasonCodes: cluster.reasonCodes.length > 0 ? cluster.reasonCodes : ["clustered"],
        createdAt: computedAt
      })
      .onConflictDoUpdate({
        target: [duplicateClusters.userId, duplicateClusters.id],
        set: {
          algorithmVersion: plan.dedupeVersion,
          configVersion: plan.dedupeVersion,
          projectionState: "active",
          updatedByDecisionRunId: runId,
          reasonCodes: cluster.reasonCodes.length > 0 ? cluster.reasonCodes : ["clustered"]
        }
      });
  }
  const activeIds = plan.canonicalPlans.map(({ canonicalListingId }) => canonicalListingId);
  const existingActive = await db
    .select({ id: canonicalListings.id, createdAt: canonicalListings.createdAt })
    .from(canonicalListings)
    .where(
      and(
        eq(canonicalListings.userId, userId),
        eq(canonicalListings.searchProfileId, job.searchProfileId),
        eq(canonicalListings.projectionState, "active")
      )
    );
  const createdAtById = new Map(existingActive.map(({ id, createdAt }) => [id, createdAt]));
  const redirectByLoser = new Map(
    plan.supersessions.map((item) => [
      item.supersededCanonicalListingId,
      item.survivorCanonicalListingId
    ])
  );
  for (const { id } of existingActive) {
    if (activeIds.includes(id)) continue;
    const survivor = redirectByLoser.get(id);
    if (!survivor || !activeIds.includes(survivor)) {
      throw new Error("Inactive canonical listing lacks a valid survivor redirect.");
    }
    await db
      .update(canonicalListings)
      .set({
        projectionState: "superseded",
        supersededById: survivor,
        updatedByDecisionRunId: runId,
        updatedAt: computedAt
      })
      .where(and(eq(canonicalListings.userId, userId), eq(canonicalListings.id, id)));
  }
  const priorIds = existingActive.map(({ id }) => id);
  if (priorIds.length > 0) {
    await db
      .delete(canonicalFieldSources)
      .where(
        and(
          eq(canonicalFieldSources.userId, userId),
          inArray(canonicalFieldSources.canonicalListingId, priorIds)
        )
      );
    await db
      .delete(canonicalListingSources)
      .where(
        and(
          eq(canonicalListingSources.userId, userId),
          inArray(canonicalListingSources.canonicalListingId, priorIds)
        )
      );
  }
  const sourceRows = await db
    .select()
    .from(listingSourceRecords)
    .where(eq(listingSourceRecords.userId, userId));
  const sourceRowsById = new Map(sourceRows.map((row) => [row.id, row]));
  for (const canonical of plan.canonicalPlans) {
    const primary = sourceRowsById.get(canonical.primarySourceRecordId);
    if (!primary) throw new Error("Canonical primary source is missing.");
    const selections = canonical.selectedFields;
    const title = nullableString(knownField(selections, "title")) ?? primary.title;
    const clusterId = canonical.memberSourceRecordIds.length > 1 ? canonical.clusterId : null;
    const bedrooms = nullableNumber(knownField(selections, "bedrooms"));
    const bathrooms = nullableNumber(knownField(selections, "bathrooms"));
    await db
      .insert(canonicalListings)
      .values({
        userId,
        id: canonical.canonicalListingId,
        searchProfileId: job.searchProfileId,
        duplicateClusterId: clusterId,
        primarySourceRecordId: canonical.primarySourceRecordId,
        title,
        addressLine1:
          nullableString(knownField(selections, "address.line1")) ?? primary.addressLine1,
        addressUnit: nullableString(knownField(selections, "address.unit")) ?? primary.addressUnit,
        addressCity: nullableString(knownField(selections, "address.city")) ?? primary.addressCity,
        addressRegion:
          nullableString(knownField(selections, "address.region")) ?? primary.addressRegion,
        addressPostalCode:
          nullableString(knownField(selections, "address.postalCode")) ?? primary.addressPostalCode,
        addressCountryCode:
          nullableString(knownField(selections, "address.countryCode")) ??
          primary.addressCountryCode,
        monthlyRentCents: nullableNumber(knownField(selections, "monthlyRentCents")),
        recurringFeesCents: nullableNumber(knownField(selections, "recurringFeesCents")),
        bedroomsHalfUnits: bedrooms === null ? null : bedrooms * 2,
        bathroomsHalfUnits: bathrooms === null ? null : bathrooms * 2,
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
        freshestObservedAt: new Date(canonical.freshestObservedAt),
        createdAt: createdAtById.get(canonical.canonicalListingId) ?? computedAt,
        updatedAt: computedAt
      })
      .onConflictDoUpdate({
        target: [canonicalListings.userId, canonicalListings.id],
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
          bedroomsHalfUnits: bedrooms === null ? null : bedrooms * 2,
          bathroomsHalfUnits: bathrooms === null ? null : bathrooms * 2,
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
          freshestObservedAt: new Date(canonical.freshestObservedAt),
          updatedAt: computedAt
        }
      });
    await db.insert(canonicalListingSources).values(
      canonical.memberSourceRecordIds.map((sourceId) => ({
        userId,
        canonicalListingId: canonical.canonicalListingId,
        listingSourceRecordId: sourceId,
        isPrimary: sourceId === canonical.primarySourceRecordId
      }))
    );
    const selectedKnown = canonical.selectedFields.filter(
      (selection) => selection.selectedFieldProvenanceId !== null
    );
    if (selectedKnown.length > 0) {
      await db.insert(canonicalFieldSources).values(
        selectedKnown.map((selection) => ({
          userId,
          canonicalListingId: canonical.canonicalListingId,
          fieldPath: selection.fieldPath,
          fieldProvenanceId: selection.selectedFieldProvenanceId!
        }))
      );
    }
    await db.insert(canonicalDecisionRuns).values({
      userId,
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
    });
  }
  if (plan.scoreSnapshots.length > 0) {
    await db.insert(listingScores).values(
      plan.scoreSnapshots.map((score) => ({
        userId,
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
        computedAt: new Date(score.computedAt),
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
    );
  }
  if (plan.riskSignals.length > 0) {
    await db.insert(riskSignals).values(
      plan.riskSignals.map((risk) => ({
        userId,
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
        createdAt: new Date(risk.createdAt),
        updatedAt: new Date(risk.createdAt),
        schemaVersion: "listing-risk.v2",
        decisionRunId: runId,
        algorithmVersion: risk.algorithmVersion,
        inputHash: risk.inputHash,
        idempotencyKey: risk.idempotencyKey,
        evidenceV2: risk.evidence,
        needsVerification: risk.needsVerification,
        evaluatedAt: new Date(risk.createdAt)
      }))
    );
  }
  const attemptId = `decision-attempt:${sha256Text(`${job.id}:${String(job.attemptCount)}`).slice(0, 40)}`;
  await db.insert(decisionJobAttempts).values({
    userId,
    id: attemptId,
    jobId: job.id,
    attemptNumber: job.attemptCount,
    startedAt: job.updatedAt,
    finishedAt: computedAt,
    outcome: "succeeded",
    errorCode: null,
    durationMilliseconds: Math.max(0, computedAt.getTime() - job.updatedAt.getTime())
  });
  await db
    .update(decisionJobs)
    .set({
      status: "succeeded",
      inputHash: plan.inputHash,
      outputHash,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: computedAt,
      completedAt: computedAt
    })
    .where(and(eq(decisionJobs.userId, userId), eq(decisionJobs.id, job.id)));
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
  await db.insert(activityEvents).values({
    userId,
    ...activity,
    occurredAt: new Date(activity.occurredAt)
  });
  const parsedCounts = JsonObjectSchema.parse(runRows[0].counts);
  const normalizedCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsedCounts)) {
    if (typeof value !== "number") throw new Error("Decision run count is invalid.");
    normalizedCounts[key] = value;
  }
  return {
    run: {
      id: runRows[0].id,
      jobId: runRows[0].jobId,
      searchProfileId: runRows[0].searchProfileId,
      corpusRevision: runRows[0].corpusRevision,
      planVersion: runRows[0].planVersion,
      inputHash: runRows[0].inputHash,
      outputHash: runRows[0].outputHash,
      counts: normalizedCounts,
      createdAt: runRows[0].createdAt.toISOString()
    },
    replayed: false
  };
}
