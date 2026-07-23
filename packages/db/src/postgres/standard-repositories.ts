import {
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
  IsoDateTimeSchema,
  JobAttemptSchema,
  ListingLifecycleStateSchema,
  ListingScoreSchema,
  ListingScoreV2Schema,
  ReminderMinutesSchema,
  RiskSignalSchema,
  RiskSignalV2Schema,
  SourceJobSchema,
  SourceJobStatusSchema,
  ViewingSchema,
  ViewingStateSchema,
  transitionApprovalState,
  transitionListingLifecycle,
  transitionSourceJobStatus,
  transitionViewingState,
  type CanonicalListingSummary,
  type VeraUserId
} from "@vera/domain";
import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  RepositoryJobLeaseError,
  RepositoryNotFoundError,
  type UserRepositories
} from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import {
  mapApprovalRow,
  mapBrowserNodeRow,
  mapCanonicalListingRow,
  mapContactWorkflowRow,
  mapDuplicateClusterRow,
  mapListingScoreRow,
  mapNormalizationJobRow,
  mapRiskSignalRow,
  mapSourceJobAttemptRow,
  mapSourceJobRow,
  mapViewingRow
} from "./row-mappers.ts";
import {
  approvals,
  browserNodes,
  canonicalFieldSources,
  canonicalListingSources,
  canonicalListings,
  contactWorkflows,
  duplicateClusters,
  listingScores,
  listingSourceRecords,
  normalizationJobs,
  riskSignals,
  searchProfiles,
  sourceJobAttempts,
  sourceJobs,
  viewings
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type StandardPostgresRepositories = Pick<
  UserRepositories,
  | "duplicateClusters"
  | "canonicalListings"
  | "listingScores"
  | "riskSignals"
  | "contactWorkflows"
  | "approvals"
  | "viewings"
  | "sourceJobs"
  | "sourceJobAttempts"
  | "browserNodes"
  | "normalizationJobs"
>;

function instant(value: string): Date;
function instant(value: string | null): Date | null;
function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toHalfUnits(value: number | null): number | null {
  return value === null ? null : value * 2;
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (row === undefined) throw new Error(message);
  return row;
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function safeErrorCode(value: string): string {
  const parsed = value.trim();
  if (!/^[a-z][a-z0-9_.-]{0,99}$/u.test(parsed)) {
    throw new Error("Normalization job error code must be a safe closed identifier.");
  }
  return parsed;
}

function assertLater(later: string, earlier: string, label: string): void {
  if (Date.parse(later) <= Date.parse(earlier)) {
    throw new Error(`${label} must be later than the reference time.`);
  }
}

async function soleProfileId(db: PostgresExecutor, userId: VeraUserId): Promise<string> {
  const rows = await db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.userId, userId))
    .orderBy(asc(searchProfiles.createdAt), asc(searchProfiles.id))
    .limit(2);
  if (rows.length !== 1) {
    throw new PostgresRepositoryError(
      "validation",
      false,
      "Legacy projection writes require exactly one search profile for the current user."
    );
  }
  return required(rows[0], "Search-profile resolution returned no row.").id;
}

function fitLabel(score: number): "strong_fit" | "possible_fit" | "needs_review" {
  if (score >= 7_500) return "strong_fit";
  if (score >= 2_500) return "possible_fit";
  return "needs_review";
}

export function createStandardPostgresRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): StandardPostgresRepositories {
  const listingScoreRepository: StandardPostgresRepositories["listingScores"] = {
    async insert(input) {
      const score = ListingScoreSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(listingScores)
          .values({
            userId,
            ...score,
            computedAt: instant(score.computedAt),
            schemaVersion: "listing-score.v1"
          })
          .returning()
      );
      return mapListingScoreRow(required(rows[0], "Listing score insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(listingScores)
        .where(and(eq(listingScores.userId, userId), eq(listingScores.id, id)))
        .limit(1);
      return rows[0] ? mapListingScoreRow(rows[0]) : null;
    },
    async listByCanonicalListingId(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(listingScores)
        .where(and(eq(listingScores.userId, userId), eq(listingScores.canonicalListingId, id)))
        .orderBy(desc(listingScores.computedAt), asc(listingScores.id));
      return rows.map(mapListingScoreRow);
    },
    async getCurrentV2ByCanonicalListingId(idInput, runInput) {
      const id = EntityIdSchema.parse(idInput);
      const decisionRunId = EntityIdSchema.parse(runInput);
      const rows = await db
        .select()
        .from(listingScores)
        .where(
          and(
            eq(listingScores.userId, userId),
            eq(listingScores.canonicalListingId, id),
            eq(listingScores.decisionRunId, decisionRunId),
            eq(listingScores.schemaVersion, "listing-score.v2")
          )
        )
        .limit(1);
      const row = rows[0];
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
        computedAt: row.computedAt.toISOString()
      });
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(listingScores)
        .where(eq(listingScores.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const riskSignalRepository: StandardPostgresRepositories["riskSignals"] = {
    async insert(input) {
      const signal = RiskSignalSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(riskSignals)
          .values({
            userId,
            ...signal,
            createdAt: instant(signal.createdAt),
            updatedAt: instant(signal.updatedAt),
            schemaVersion: "listing-risk.v1"
          })
          .returning()
      );
      return mapRiskSignalRow(required(rows[0], "Risk signal insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(riskSignals)
        .where(and(eq(riskSignals.userId, userId), eq(riskSignals.id, id)))
        .limit(1);
      return rows[0] ? mapRiskSignalRow(rows[0]) : null;
    },
    async listByCanonicalListingId(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(riskSignals)
        .where(and(eq(riskSignals.userId, userId), eq(riskSignals.canonicalListingId, id)))
        .orderBy(desc(riskSignals.createdAt), asc(riskSignals.id));
      return rows.map(mapRiskSignalRow);
    },
    async listCurrentV2ByCanonicalListingId(idInput, runInput) {
      const id = EntityIdSchema.parse(idInput);
      const decisionRunId = EntityIdSchema.parse(runInput);
      const rows = await db
        .select()
        .from(riskSignals)
        .where(
          and(
            eq(riskSignals.userId, userId),
            eq(riskSignals.canonicalListingId, id),
            eq(riskSignals.decisionRunId, decisionRunId),
            eq(riskSignals.schemaVersion, "listing-risk.v2")
          )
        )
        .orderBy(desc(riskSignals.createdAt), asc(riskSignals.id));
      return rows.map((row) => {
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
          createdAt: row.evaluatedAt.toISOString()
        });
      });
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(riskSignals)
        .where(eq(riskSignals.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const canonicalListingRepository: StandardPostgresRepositories["canonicalListings"] = {
    async insert(input) {
      const listing = CanonicalListingSchema.parse(input);
      const searchProfileId = await soleProfileId(db, userId);
      const rows = await operation(() =>
        db
          .insert(canonicalListings)
          .values({
            userId,
            id: listing.id,
            searchProfileId,
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
            freshestObservedAt: instant(listing.freshestObservedAt),
            createdAt: instant(listing.createdAt),
            updatedAt: instant(listing.updatedAt)
          })
          .returning()
      );
      return mapCanonicalListingRow(required(rows[0], "Canonical listing insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(canonicalListings)
        .where(and(eq(canonicalListings.userId, userId), eq(canonicalListings.id, id)))
        .limit(1);
      return rows[0] ? mapCanonicalListingRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(canonicalListings)
        .where(
          and(eq(canonicalListings.userId, userId), eq(canonicalListings.projectionState, "active"))
        )
        .orderBy(desc(canonicalListings.freshestObservedAt), asc(canonicalListings.id));
      return rows.map(mapCanonicalListingRow);
    },
    async listSummaries() {
      const listings = await canonicalListingRepository.list();
      const memberships = await db
        .select({
          canonicalListingId: canonicalListingSources.canonicalListingId,
          source: listingSourceRecords.source,
          observedAt: listingSourceRecords.observedAt,
          sourcePostedAt: listingSourceRecords.sourcePostedAt
        })
        .from(canonicalListingSources)
        .innerJoin(
          listingSourceRecords,
          and(
            eq(canonicalListingSources.userId, listingSourceRecords.userId),
            eq(canonicalListingSources.listingSourceRecordId, listingSourceRecords.id)
          )
        )
        .where(eq(canonicalListingSources.userId, userId));
      const summaries: CanonicalListingSummary[] = [];
      for (const listing of listings) {
        const listingMemberships = memberships.filter(
          (membership) => membership.canonicalListingId === listing.id
        );
        const score =
          (await listingScoreRepository.listByCanonicalListingId(listing.id))[0] ?? null;
        const v2 =
          listing.updatedByDecisionRunId === null
            ? null
            : await listingScoreRepository.getCurrentV2ByCanonicalListingId(
                listing.id,
                listing.updatedByDecisionRunId
              );
        const currentRisks =
          listing.updatedByDecisionRunId === null
            ? await riskSignalRepository.listByCanonicalListingId(listing.id)
            : await riskSignalRepository.listCurrentV2ByCanonicalListingId(
                listing.id,
                listing.updatedByDecisionRunId
              );
        const freshestMembership = [...listingMemberships].sort(
          (left, right) => right.observedAt.getTime() - left.observedAt.getTime()
        )[0];
        const posted = freshestMembership?.sourcePostedAt ?? null;
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
        const displayScore = v2?.finalScoreBasisPoints ?? score?.totalScoreBasisPoints ?? null;
        const highestRiskSeverity = ["high", "medium", "low", "info", "informational"].find(
          (severity) =>
            currentRisks.some((risk) => risk.status === "open" && risk.severity === severity)
        );
        summaries.push(
          CanonicalListingSummarySchema.parse({
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
            freshestSourcePostedAt: posted?.toISOString() ?? null,
            alertLatencySeconds:
              freshestMembership && posted
                ? Math.max(
                    0,
                    Math.floor((freshestMembership.observedAt.getTime() - posted.getTime()) / 1_000)
                  )
                : null,
            sourceLabels: [...new Set(listingMemberships.map(({ source }) => source))].sort(),
            sourceRecordCount: listingMemberships.length,
            duplicateCount: Math.max(0, listingMemberships.length - 1),
            unknownFields,
            fitScoreBasisPoints: displayScore,
            eligible: v2?.eligible ?? null,
            baseScoreBasisPoints: v2?.baseScoreBasisPoints ?? null,
            stalePenaltyBasisPoints: v2?.stalePenaltyBasisPoints ?? null,
            lowConfidencePenaltyBasisPoints: v2?.lowConfidencePenaltyBasisPoints ?? null,
            riskPenaltyBasisPoints: v2?.riskPenaltyBasisPoints ?? null,
            fitLabel: displayScore === null ? null : fitLabel(displayScore),
            topPositiveReason: v2?.explanation.slice(0, 300) ?? null,
            topConcern:
              v2 && !v2.eligible
                ? "A known hard constraint excludes this listing; inspect the exact result below."
                : unknownFields.length > 0
                  ? `${unknownFields[0] ?? "A listing fact"} needs verification.`
                  : null,
            riskIndicatorCount: currentRisks.filter(({ status }) => status === "open").length,
            highestRiskSeverity:
              highestRiskSeverity === "informational" ? "info" : (highestRiskSeverity ?? null)
          })
        );
      }
      return summaries;
    },
    async addSource(input) {
      const membership = CanonicalListingSourceSchema.parse(input);
      await operation(() =>
        db
          .insert(canonicalListingSources)
          .values({ userId, ...membership })
          .onConflictDoNothing()
      );
      return membership;
    },
    async setFieldSource(input) {
      const selection = CanonicalFieldSourceSchema.parse(input);
      await operation(() =>
        db
          .insert(canonicalFieldSources)
          .values({ userId, ...selection })
          .onConflictDoNothing()
      );
      return selection;
    },
    async listFieldSources(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(canonicalFieldSources)
        .where(
          and(
            eq(canonicalFieldSources.userId, userId),
            eq(canonicalFieldSources.canonicalListingId, id)
          )
        )
        .orderBy(asc(canonicalFieldSources.fieldPath));
      return rows.map(({ userId: _owner, ...row }) => CanonicalFieldSourceSchema.parse(row));
    },
    async transitionLifecycle(idInput, requestedInput, timeInput) {
      const id = EntityIdSchema.parse(idInput);
      const requested = ListingLifecycleStateSchema.parse(requestedInput);
      const transitionedAt = IsoDateTimeSchema.parse(timeInput);
      const current = await canonicalListingRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("CanonicalListing", id);
      const lifecycleState = transitionListingLifecycle(current.lifecycleState, requested);
      const rows = await operation(() =>
        db
          .update(canonicalListings)
          .set({ lifecycleState, updatedAt: instant(transitionedAt) })
          .where(
            and(
              eq(canonicalListings.userId, userId),
              eq(canonicalListings.id, id),
              eq(canonicalListings.lifecycleState, current.lifecycleState),
              eq(canonicalListings.updatedAt, instant(current.updatedAt))
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row) {
        throw new PostgresRepositoryError(
          "serialization",
          true,
          "The listing changed while its lifecycle transition was applied."
        );
      }
      return mapCanonicalListingRow(row);
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(canonicalListings)
        .where(eq(canonicalListings.userId, userId));
      return Number(rows[0]?.value ?? 0);
    },
    async sourceMembershipCount() {
      const rows = await db
        .select({ value: count() })
        .from(canonicalListingSources)
        .where(eq(canonicalListingSources.userId, userId));
      return Number(rows[0]?.value ?? 0);
    },
    async fieldSelectionCount() {
      const rows = await db
        .select({ value: count() })
        .from(canonicalFieldSources)
        .where(eq(canonicalFieldSources.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const duplicateClusterRepository: StandardPostgresRepositories["duplicateClusters"] = {
    async insert(input) {
      const cluster = DuplicateClusterSchema.parse(input);
      const searchProfileId = await soleProfileId(db, userId);
      await operation(() =>
        db
          .insert(duplicateClusters)
          .values({
            userId,
            id: cluster.id,
            searchProfileId,
            clusterKey: cluster.clusterKey,
            algorithmVersion: cluster.algorithmVersion,
            reasonCodes: cluster.reasonCodes,
            createdAt: instant(cluster.createdAt)
          })
          .onConflictDoNothing({ target: [duplicateClusters.userId, duplicateClusters.id] })
      );
      return cluster;
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(duplicateClusters)
        .where(and(eq(duplicateClusters.userId, userId), eq(duplicateClusters.id, id)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const canonicalRows = await db
        .select({ id: canonicalListings.id })
        .from(canonicalListings)
        .where(
          and(eq(canonicalListings.userId, userId), eq(canonicalListings.duplicateClusterId, id))
        )
        .limit(1);
      const canonicalId = canonicalRows[0]?.id;
      const memberRows = canonicalId
        ? await db
            .select({ id: canonicalListingSources.listingSourceRecordId })
            .from(canonicalListingSources)
            .where(
              and(
                eq(canonicalListingSources.userId, userId),
                eq(canonicalListingSources.canonicalListingId, canonicalId)
              )
            )
            .orderBy(asc(canonicalListingSources.listingSourceRecordId))
        : [];
      return mapDuplicateClusterRow(
        row,
        memberRows.map(({ id: memberId }) => memberId)
      );
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(duplicateClusters)
        .where(eq(duplicateClusters.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  const contactWorkflowRepository: StandardPostgresRepositories["contactWorkflows"] = {
    async insert(input) {
      const workflow = ContactWorkflowSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(contactWorkflows)
          .values({
            userId,
            ...workflow,
            createdAt: instant(workflow.createdAt),
            updatedAt: instant(workflow.updatedAt)
          })
          .returning()
      );
      return mapContactWorkflowRow(required(rows[0], "Contact workflow insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(contactWorkflows)
        .where(and(eq(contactWorkflows.userId, userId), eq(contactWorkflows.id, id)))
        .limit(1);
      return rows[0] ? mapContactWorkflowRow(rows[0]) : null;
    }
  };

  const approvalRepository: StandardPostgresRepositories["approvals"] = {
    async insert(input) {
      const approval = ApprovalSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(approvals)
          .values({
            userId,
            ...approval,
            createdAt: instant(approval.createdAt),
            expiresAt: instant(approval.expiresAt),
            usedAt: instant(approval.usedAt)
          })
          .returning()
      );
      return mapApprovalRow(required(rows[0], "Approval insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.userId, userId), eq(approvals.id, id)))
        .limit(1);
      return rows[0] ? mapApprovalRow(rows[0]) : null;
    },
    async transition(idInput, expectedInput, requestedInput, atInput) {
      const id = EntityIdSchema.parse(idInput);
      const expected = ApprovalStateSchema.parse(expectedInput);
      const requested = ApprovalStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      transitionApprovalState(expected, requested);
      const current = await approvalRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Approval", id);
      if (current.state !== expected) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Approval state changed concurrently."
        );
      }
      if (Date.parse(at) < Date.parse(current.createdAt)) {
        throw new Error("Approval transition time cannot precede its creation time.");
      }
      const candidate = ApprovalSchema.parse({
        ...current,
        state: requested,
        usedAt: requested === "used" ? at : null
      });
      const rows = await operation(() =>
        db
          .update(approvals)
          .set({ state: candidate.state, usedAt: instant(candidate.usedAt) })
          .where(
            and(eq(approvals.userId, userId), eq(approvals.id, id), eq(approvals.state, expected))
          )
          .returning()
      );
      if (!rows[0]) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Approval state changed concurrently."
        );
      }
      return mapApprovalRow(rows[0]);
    }
  };

  const viewingRepository: StandardPostgresRepositories["viewings"] = {
    async insert(input) {
      const viewing = ViewingSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(viewings)
          .values({
            userId,
            ...viewing,
            createdAt: instant(viewing.createdAt),
            updatedAt: instant(viewing.updatedAt)
          })
          .returning()
      );
      return mapViewingRow(required(rows[0], "Viewing insert returned no row."));
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(viewings)
        .where(and(eq(viewings.userId, userId), eq(viewings.id, id)))
        .limit(1);
      return rows[0] ? mapViewingRow(rows[0]) : null;
    },
    async prepareCalendarHold(idInput, expectedState, contactNotes, remindersInput, atInput) {
      const id = EntityIdSchema.parse(idInput);
      const at = IsoDateTimeSchema.parse(atInput);
      const remindersMinutesBeforeStart = ReminderMinutesSchema.parse(remindersInput);
      const current = await viewingRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Viewing", id);
      if (current.state !== expectedState) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Viewing state changed before Calendar hold preparation."
        );
      }
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new Error("Calendar hold preparation cannot precede the current Viewing update.");
      }
      const metadata = {
        ...current.metadata,
        calendarHoldRemindersMinutesBeforeStart: remindersMinutesBeforeStart
      };
      const candidate = ViewingSchema.parse({
        ...current,
        notes: contactNotes,
        metadata,
        updatedAt: at
      });
      const rows = await operation(() =>
        db
          .update(viewings)
          .set({ notes: candidate.notes, metadata: candidate.metadata, updatedAt: instant(at) })
          .where(
            and(
              eq(viewings.userId, userId),
              eq(viewings.id, id),
              eq(viewings.state, expectedState),
              eq(viewings.updatedAt, instant(current.updatedAt))
            )
          )
          .returning()
      );
      if (!rows[0]) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Viewing changed concurrently during Calendar hold preparation."
        );
      }
      return mapViewingRow(rows[0]);
    },
    async transition(idInput, expectedInput, requestedInput, atInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const expected = ViewingStateSchema.parse(expectedInput);
      const requested = ViewingStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      transitionViewingState(expected, requested);
      const current = await viewingRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("Viewing", id);
      if (current.state !== expected) {
        throw new PostgresRepositoryError("conflict", false, "Viewing state changed concurrently.");
      }
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new Error("Viewing transition time cannot precede its current update time.");
      }
      const candidate = ViewingSchema.parse({
        ...current,
        state: requested,
        selectedWindow:
          patch.selectedWindow !== undefined
            ? patch.selectedWindow
            : requested === "proposed"
              ? null
              : current.selectedWindow,
        confirmedWindow:
          patch.confirmedWindow !== undefined ? patch.confirmedWindow : current.confirmedWindow,
        calendarReference:
          patch.calendarReference !== undefined
            ? patch.calendarReference
            : current.calendarReference,
        supersedesViewingId:
          patch.supersedesViewingId !== undefined
            ? patch.supersedesViewingId
            : current.supersedesViewingId,
        updatedAt: at
      });
      const rows = await operation(() =>
        db
          .update(viewings)
          .set({
            selectedWindow: candidate.selectedWindow,
            confirmedWindow: candidate.confirmedWindow,
            calendarReference: candidate.calendarReference,
            supersedesViewingId: candidate.supersedesViewingId,
            state: candidate.state,
            updatedAt: instant(candidate.updatedAt)
          })
          .where(
            and(
              eq(viewings.userId, userId),
              eq(viewings.id, id),
              eq(viewings.state, expected),
              eq(viewings.updatedAt, instant(current.updatedAt))
            )
          )
          .returning()
      );
      if (!rows[0]) {
        throw new PostgresRepositoryError("conflict", false, "Viewing state changed concurrently.");
      }
      return mapViewingRow(rows[0]);
    },
    async listByCanonicalListingId(input) {
      const canonicalListingId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(viewings)
        .where(
          and(eq(viewings.userId, userId), eq(viewings.canonicalListingId, canonicalListingId))
        )
        .orderBy(asc(viewings.createdAt), asc(viewings.id));
      return rows.map(mapViewingRow);
    }
  };

  const sourceJobRepository: StandardPostgresRepositories["sourceJobs"] = {
    async enqueue(input) {
      const job = SourceJobSchema.parse(input);
      const inserted = await operation(() =>
        db
          .insert(sourceJobs)
          .values({
            userId,
            ...job,
            browserNodeId:
              job.payload.acquisitionMode === "local_browser" &&
              job.payload.captureKind === "current_tab"
                ? job.payload.nodeId
                : null,
            browserProfileId:
              job.payload.acquisitionMode === "local_browser" &&
              job.payload.captureKind === "current_tab"
                ? job.payload.profileId
                : null,
            availableAt: instant(job.createdAt),
            leaseOwner: null,
            leaseExpiresAt: null,
            createdAt: instant(job.createdAt),
            updatedAt: instant(job.updatedAt),
            completedAt: instant(job.completedAt)
          })
          .onConflictDoNothing({ target: [sourceJobs.userId, sourceJobs.idempotencyKey] })
          .returning()
      );
      const row =
        inserted[0] ??
        (
          await db
            .select()
            .from(sourceJobs)
            .where(
              and(eq(sourceJobs.userId, userId), eq(sourceJobs.idempotencyKey, job.idempotencyKey))
            )
            .limit(1)
        )[0];
      const persisted = mapSourceJobRow(required(row, "Source job enqueue did not resolve a row."));
      if (
        persisted.payloadHash !== job.payloadHash ||
        persisted.connectorId !== job.connectorId ||
        persisted.operation !== job.operation
      ) {
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "The source-job idempotency key belongs to another operation."
        );
      }
      return { record: persisted, inserted: inserted.length === 1 };
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(sourceJobs)
        .where(and(eq(sourceJobs.userId, userId), eq(sourceJobs.id, id)))
        .limit(1);
      return rows[0] ? mapSourceJobRow(rows[0]) : null;
    },
    async getByIdempotencyKey(input) {
      const key = input.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid source-job idempotency key.");
      const rows = await db
        .select()
        .from(sourceJobs)
        .where(and(eq(sourceJobs.userId, userId), eq(sourceJobs.idempotencyKey, key)))
        .limit(1);
      return rows[0] ? mapSourceJobRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(sourceJobs)
        .where(eq(sourceJobs.userId, userId))
        .orderBy(asc(sourceJobs.createdAt), asc(sourceJobs.id));
      return rows.map(mapSourceJobRow);
    },
    async transition(idInput, statusInput, timeInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const requested = SourceJobStatusSchema.parse(statusInput);
      const transitionedAt = IsoDateTimeSchema.parse(timeInput);
      const current = await sourceJobRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("SourceJob", id);
      if (Date.parse(transitionedAt) < Date.parse(current.updatedAt)) {
        throw new Error("Source job transition time cannot precede its current update time.");
      }
      if (
        current.status === "completed" &&
        requested === "completed" &&
        patch.result?.resultHash === current.result?.resultHash
      ) {
        return current;
      }
      const status = transitionSourceJobStatus(current.status, requested);
      const noResult = new Set([
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
        deferredReason: status === "deferred_node_offline" ? (patch.deferredReason ?? null) : null,
        result: noResult.has(status) ? null : (patch.result ?? current.result),
        updatedAt: transitionedAt,
        completedAt: ["completed", "permanently_failed", "cancelled_by_policy"].includes(status)
          ? transitionedAt
          : null
      });
      const rows = await operation(() =>
        db
          .update(sourceJobs)
          .set({
            status: candidate.status,
            attempts: candidate.attempts,
            manualAction: candidate.manualAction,
            deferredReason: candidate.deferredReason,
            result: candidate.result,
            updatedAt: instant(candidate.updatedAt),
            completedAt: instant(candidate.completedAt),
            leaseOwner: null,
            leaseExpiresAt: null
          })
          .where(
            and(
              eq(sourceJobs.userId, userId),
              eq(sourceJobs.id, id),
              eq(sourceJobs.status, current.status),
              eq(sourceJobs.updatedAt, instant(current.updatedAt))
            )
          )
          .returning()
      );
      if (!rows[0]) {
        throw new PostgresRepositoryError(
          "serialization",
          true,
          "The source job changed concurrently."
        );
      }
      return mapSourceJobRow(rows[0]);
    }
  };

  const sourceJobAttemptRepository: StandardPostgresRepositories["sourceJobAttempts"] = {
    async append(input) {
      const attempt = JobAttemptSchema.parse(input);
      const job = await sourceJobRepository.getById(attempt.sourceJobId);
      if (!job) throw new RepositoryNotFoundError("SourceJob", attempt.sourceJobId);
      if (attempt.correlationId !== job.correlationId || attempt.payloadHash !== job.payloadHash) {
        throw new Error("Source job attempt identity does not match its job.");
      }
      if (attempt.attemptNumber > job.maxAttempts) {
        throw new Error("Source job attempt exceeds its maximum.");
      }
      const rows = await operation(() =>
        db
          .insert(sourceJobAttempts)
          .values({
            userId,
            ...attempt,
            startedAt: instant(attempt.startedAt),
            completedAt: instant(attempt.completedAt)
          })
          .returning()
      );
      return mapSourceJobAttemptRow(
        required(rows[0], "Source job attempt insert returned no row.")
      );
    },
    async listByJobId(input) {
      const jobId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(sourceJobAttempts)
        .where(and(eq(sourceJobAttempts.userId, userId), eq(sourceJobAttempts.sourceJobId, jobId)))
        .orderBy(asc(sourceJobAttempts.attemptNumber), asc(sourceJobAttempts.id));
      return rows.map(mapSourceJobAttemptRow);
    }
  };

  const browserNodeRepository: StandardPostgresRepositories["browserNodes"] = {
    async upsert(input) {
      const status = BrowserNodeStatusSchema.parse(input);
      const current = await browserNodeRepository.getById(status.nodeId);
      if (current?.providerId !== undefined && current.providerId !== status.providerId) {
        throw new Error("Browser node provider identity cannot change.");
      }
      if (current?.status === "revoked" && status.status !== "revoked") {
        throw new Error("A revoked browser node cannot be revived.");
      }
      if (
        current &&
        (Date.parse(status.lastHeartbeatAt) < Date.parse(current.lastHeartbeatAt) ||
          (status.lastHeartbeatAt === current.lastHeartbeatAt &&
            Date.parse(status.updatedAt) <= Date.parse(current.updatedAt)))
      ) {
        return current;
      }
      const rows = await operation(() =>
        db
          .insert(browserNodes)
          .values({
            userId,
            ...status,
            lastHeartbeatAt: instant(status.lastHeartbeatAt),
            heartbeatExpiresAt: instant(status.heartbeatExpiresAt),
            lastSuccessfulCaptureAt: instant(status.lastSuccessfulCaptureAt),
            disabledAt: instant(status.disabledAt),
            createdAt: instant(status.createdAt),
            updatedAt: instant(status.updatedAt)
          })
          .onConflictDoUpdate({
            target: [browserNodes.userId, browserNodes.nodeId],
            set: {
              status: status.status,
              nodeName: status.nodeName,
              pairingState: status.pairingState,
              capabilityApprovalState: status.capabilityApprovalState,
              selectedProfileId: status.selectedProfileId,
              allowedProfileIds: status.allowedProfileIds,
              reportedOpenClawVersion: status.reportedOpenClawVersion,
              expectedOpenClawVersion: status.expectedOpenClawVersion,
              versionCompatibility: status.versionCompatibility,
              lastHeartbeatAt: instant(status.lastHeartbeatAt),
              heartbeatExpiresAt: instant(status.heartbeatExpiresAt),
              lastSuccessfulCaptureAt: instant(status.lastSuccessfulCaptureAt),
              disabledAt: instant(status.disabledAt),
              contractVersion: status.contractVersion,
              capabilities: status.capabilities,
              updatedAt: instant(status.updatedAt)
            }
          })
          .returning()
      );
      return mapBrowserNodeRow(required(rows[0], "Browser node upsert returned no row."));
    },
    async getById(input) {
      const nodeId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(browserNodes)
        .where(and(eq(browserNodes.userId, userId), eq(browserNodes.nodeId, nodeId)))
        .limit(1);
      return rows[0] ? mapBrowserNodeRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(browserNodes)
        .where(eq(browserNodes.userId, userId))
        .orderBy(asc(browserNodes.nodeId));
      return rows.map(mapBrowserNodeRow);
    }
  };

  const normalizationJobRepository: StandardPostgresRepositories["normalizationJobs"] = {
    async enqueue(input) {
      const id = EntityIdSchema.parse(input.id);
      const rawListingId = EntityIdSchema.parse(input.rawListingId);
      const availableAt = IsoDateTimeSchema.parse(input.availableAt);
      const createdAt = IsoDateTimeSchema.parse(input.createdAt);
      const maxAttempts = positiveInteger(input.maxAttempts, "Maximum attempts");
      const inserted = await operation(() =>
        db
          .insert(normalizationJobs)
          .values({
            userId,
            id,
            rawListingId,
            idempotencyKey: input.idempotencyKey,
            state: "queued",
            availableAt: instant(availableAt),
            attempts: 0,
            maxAttempts,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorCategory: null,
            correlationId: input.correlationId,
            causationId: input.causationId,
            createdAt: instant(createdAt),
            updatedAt: instant(createdAt),
            completedAt: null
          })
          .onConflictDoNothing({
            target: [normalizationJobs.userId, normalizationJobs.idempotencyKey]
          })
          .returning()
      );
      const row =
        inserted[0] ??
        (
          await db
            .select()
            .from(normalizationJobs)
            .where(
              and(
                eq(normalizationJobs.userId, userId),
                eq(normalizationJobs.idempotencyKey, input.idempotencyKey)
              )
            )
            .limit(1)
        )[0];
      return {
        record: mapNormalizationJobRow(
          required(row, "Normalization enqueue did not resolve a row.")
        ),
        inserted: inserted.length === 1
      };
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(normalizationJobs)
        .where(and(eq(normalizationJobs.userId, userId), eq(normalizationJobs.id, id)))
        .limit(1);
      return rows[0] ? mapNormalizationJobRow(rows[0]) : null;
    },
    async getByRawListingId(input) {
      const rawListingId = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(normalizationJobs)
        .where(
          and(
            eq(normalizationJobs.userId, userId),
            eq(normalizationJobs.rawListingId, rawListingId)
          )
        )
        .limit(1);
      return rows[0] ? mapNormalizationJobRow(rows[0]) : null;
    },
    async claimNext(input) {
      const now = IsoDateTimeSchema.parse(input.now);
      const leaseExpiresAt = IsoDateTimeSchema.parse(input.leaseExpiresAt);
      assertLater(leaseExpiresAt, now, "Lease expiry");
      const candidateRows = await db
        .select({ id: normalizationJobs.id })
        .from(normalizationJobs)
        .where(
          and(
            eq(normalizationJobs.userId, userId),
            inArray(normalizationJobs.state, ["queued", "retryable"]),
            lte(normalizationJobs.availableAt, instant(now)),
            or(
              isNull(normalizationJobs.leaseExpiresAt),
              lte(normalizationJobs.leaseExpiresAt, instant(now))
            )
          )
        )
        .orderBy(asc(normalizationJobs.availableAt), asc(normalizationJobs.createdAt))
        .limit(1);
      const candidate = candidateRows[0];
      if (!candidate) return null;
      const rows = await db
        .update(normalizationJobs)
        .set({
          state: "leased",
          attempts: sql`${normalizationJobs.attempts} + 1`,
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: instant(leaseExpiresAt),
          updatedAt: instant(now)
        })
        .where(
          and(
            eq(normalizationJobs.userId, userId),
            eq(normalizationJobs.id, candidate.id),
            inArray(normalizationJobs.state, ["queued", "retryable"])
          )
        )
        .returning();
      return rows[0] ? mapNormalizationJobRow(rows[0]) : null;
    },
    async complete(input) {
      const id = EntityIdSchema.parse(input.id);
      const completedAt = IsoDateTimeSchema.parse(input.completedAt);
      const rows = await db
        .update(normalizationJobs)
        .set({
          state: "completed",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: instant(completedAt),
          updatedAt: instant(completedAt)
        })
        .where(
          and(
            eq(normalizationJobs.userId, userId),
            eq(normalizationJobs.id, id),
            eq(normalizationJobs.state, "leased"),
            eq(normalizationJobs.leaseOwner, input.leaseOwner)
          )
        )
        .returning();
      if (!rows[0]) throw new RepositoryJobLeaseError(id);
      return mapNormalizationJobRow(rows[0]);
    },
    async fail(input) {
      const id = EntityIdSchema.parse(input.id);
      const failedAt = IsoDateTimeSchema.parse(input.failedAt);
      const retryAt = IsoDateTimeSchema.parse(input.retryAt);
      const current = await normalizationJobRepository.getById(id);
      if (!current) throw new RepositoryNotFoundError("NormalizationJob", id);
      if (current.state !== "leased" || current.leaseOwner !== input.leaseOwner) {
        throw new RepositoryJobLeaseError(id);
      }
      const deadLetter = !input.retryable || current.attempts >= current.maxAttempts;
      if (!deadLetter) assertLater(retryAt, failedAt, "Normalization retry time");
      const rows = await db
        .update(normalizationJobs)
        .set({
          state: deadLetter ? "dead_letter" : "retryable",
          availableAt: deadLetter ? instant(current.availableAt) : instant(retryAt),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: safeErrorCode(input.errorCode),
          lastErrorCategory: ErrorCategorySchema.parse(input.errorCategory),
          updatedAt: instant(failedAt),
          completedAt: null
        })
        .where(
          and(
            eq(normalizationJobs.userId, userId),
            eq(normalizationJobs.id, id),
            eq(normalizationJobs.state, "leased"),
            eq(normalizationJobs.leaseOwner, input.leaseOwner)
          )
        )
        .returning();
      if (!rows[0]) throw new RepositoryJobLeaseError(id);
      return mapNormalizationJobRow(rows[0]);
    },
    async count() {
      const rows = await db
        .select({ value: count() })
        .from(normalizationJobs)
        .where(eq(normalizationJobs.userId, userId));
      return Number(rows[0]?.value ?? 0);
    }
  };

  return {
    duplicateClusters: duplicateClusterRepository,
    canonicalListings: canonicalListingRepository,
    listingScores: listingScoreRepository,
    riskSignals: riskSignalRepository,
    contactWorkflows: contactWorkflowRepository,
    approvals: approvalRepository,
    viewings: viewingRepository,
    sourceJobs: sourceJobRepository,
    sourceJobAttempts: sourceJobAttemptRepository,
    browserNodes: browserNodeRepository,
    normalizationJobs: normalizationJobRepository
  };
}
