import {
  ActivityEventSchema,
  ApprovalSchema,
  BrowserNodeStatusSchema,
  CanonicalListingSchema,
  ContactWorkflowSchema,
  DuplicateClusterSchema,
  FieldProvenanceSchema,
  JobAttemptSchema,
  ListingPhotoSchema,
  ListingExtractionRunSchema,
  ListingScoreSchema,
  ListingSourceRecordSchema,
  NormalizationJobSchema,
  RawListingSchema,
  RiskSignalSchema,
  SearchProfileSchema,
  SourceJobSchema,
  SourcePolicyManifestSchema,
  ViewingSchema,
  type ActivityEvent,
  type Approval,
  type BrowserNodeStatus,
  type CanonicalListing,
  type ContactWorkflow,
  type DuplicateCluster,
  type FieldProvenance,
  type JobAttempt,
  type ListingPhoto,
  type ListingExtractionRun,
  type ListingScore,
  type ListingSourceRecord,
  type NormalizationJob,
  type RawListing,
  type RiskSignal,
  type SearchProfile,
  type SourceJob,
  type SourcePolicyManifest,
  type Viewing
} from "@vera/domain";

import type {
  activityEvents,
  approvals,
  browserNodes,
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

type SearchProfileRow = typeof searchProfiles.$inferSelect;
type RawListingRow = typeof rawListings.$inferSelect;
type ListingSourceRecordRow = typeof listingSourceRecords.$inferSelect;
type NormalizationJobRow = typeof normalizationJobs.$inferSelect;
type ListingPhotoRow = typeof listingPhotos.$inferSelect;
type ListingExtractionRow = typeof listingExtractions.$inferSelect;
type FieldProvenanceRow = typeof fieldProvenance.$inferSelect;
type DuplicateClusterRow = typeof duplicateClusters.$inferSelect;
type CanonicalListingRow = typeof canonicalListings.$inferSelect;
type ListingScoreRow = typeof listingScores.$inferSelect;
type RiskSignalRow = typeof riskSignals.$inferSelect;
type ContactWorkflowRow = typeof contactWorkflows.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type ViewingRow = typeof viewings.$inferSelect;
type ActivityEventRow = typeof activityEvents.$inferSelect;
type SourcePolicyManifestRow = typeof sourcePolicyManifests.$inferSelect;
type SourceJobRow = typeof sourceJobs.$inferSelect;
type SourceJobAttemptRow = typeof sourceJobAttempts.$inferSelect;
type BrowserNodeRow = typeof browserNodes.$inferSelect;

function fromMicrodegrees(value: number | null): number | null {
  return value === null ? null : value / 1_000_000;
}

function fromMeters(value: number | null): number | null {
  return value === null ? null : value / 1_000;
}

function fromHalfUnits(value: number | null): number | null {
  return value === null ? null : value / 2;
}

export function mapSearchProfileRow(row: SearchProfileRow): SearchProfile {
  return SearchProfileSchema.parse({
    id: row.id,
    name: row.name,
    version: row.version,
    locationText: row.locationText,
    centerLatitude: fromMicrodegrees(row.centerLatitude),
    centerLongitude: fromMicrodegrees(row.centerLongitude),
    radiusKilometers: fromMeters(row.radiusMeters),
    minimumBedrooms: fromHalfUnits(row.minimumBedrooms),
    minimumBathrooms: fromHalfUnits(row.minimumBathrooms),
    targetMonthlyTotalCents: row.targetMonthlyTotalCents,
    absoluteMonthlyMaximumCents: row.absoluteMonthlyMaximumCents,
    moveInEarliest: row.moveInEarliest,
    moveInLatest: row.moveInLatest,
    petRequirements: row.petRequirements,
    commuteAnchors: row.commuteAnchors,
    hardConstraints: row.hardConstraints,
    weightedPreferences: row.weightedPreferences,
    notificationRules: row.notificationRules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

export function mapRawListingRow(row: RawListingRow): RawListing {
  return RawListingSchema.parse(row);
}

export function mapListingSourceRecordRow(row: ListingSourceRecordRow): ListingSourceRecord {
  return ListingSourceRecordSchema.parse({
    id: row.id,
    rawListingId: row.rawListingId,
    source: row.source,
    sourceListingId: row.sourceListingId,
    sourceUrl: row.sourceUrl,
    sourcePostedAt: row.sourcePostedAt,
    contactChannel: row.contactChannel,
    title: row.title,
    address: {
      line1: row.addressLine1,
      unit: row.addressUnit,
      city: row.addressCity,
      region: row.addressRegion,
      postalCode: row.addressPostalCode,
      countryCode: row.addressCountryCode
    },
    monthlyRentCents: row.monthlyRentCents,
    recurringFeesCents: row.recurringFeesCents,
    bedrooms: fromHalfUnits(row.bedroomsHalfUnits),
    bathrooms: fromHalfUnits(row.bathroomsHalfUnits),
    squareFeet: row.squareFeet,
    propertyType: row.propertyType,
    availableOn: row.availableOn,
    leaseTermMonths: row.leaseTermMonths,
    petPolicy: row.petPolicy,
    amenities: row.amenities,
    description: row.description,
    extractionConfidenceBasisPoints: row.extractionConfidenceBasisPoints,
    completenessBasisPoints: row.completenessBasisPoints,
    observedAt: row.observedAt,
    createdAt: row.createdAt
  });
}

export function mapListingPhotoRow(row: ListingPhotoRow): ListingPhoto {
  return ListingPhotoSchema.parse(row);
}

export function mapFieldProvenanceRow(row: FieldProvenanceRow): FieldProvenance {
  return FieldProvenanceSchema.parse(row);
}

export function mapListingExtractionRow(row: ListingExtractionRow): ListingExtractionRun {
  return ListingExtractionRunSchema.parse({
    id: row.id,
    rawListingId: row.rawListingId,
    listingSourceRecordId: row.listingSourceRecordId,
    mode: row.mode,
    inputHash: row.inputHash,
    requestedFields: row.requestedFields,
    providerId: row.providerId,
    model: row.model,
    responseId: row.responseId,
    promptVersion: row.promptVersion,
    extractionVersion: row.extractionVersion,
    providerResult: row.providerResult,
    mergedExtraction: row.mergedExtraction,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens
    },
    latencyMilliseconds: row.latencyMilliseconds,
    repairCount: row.repairCount,
    completedAt: row.completedAt
  });
}

export function mapNormalizationJobRow(row: NormalizationJobRow): NormalizationJob {
  return NormalizationJobSchema.parse(row);
}

export function mapDuplicateClusterRow(
  row: DuplicateClusterRow,
  memberSourceRecordIds: readonly string[]
): DuplicateCluster {
  return DuplicateClusterSchema.parse({ ...row, memberSourceRecordIds });
}

export function mapCanonicalListingRow(row: CanonicalListingRow): CanonicalListing {
  return CanonicalListingSchema.parse({
    id: row.id,
    duplicateClusterId: row.duplicateClusterId,
    primarySourceRecordId: row.primarySourceRecordId,
    title: row.title,
    address: {
      line1: row.addressLine1,
      unit: row.addressUnit,
      city: row.addressCity,
      region: row.addressRegion,
      postalCode: row.addressPostalCode,
      countryCode: row.addressCountryCode
    },
    monthlyRentCents: row.monthlyRentCents,
    recurringFeesCents: row.recurringFeesCents,
    bedrooms: fromHalfUnits(row.bedroomsHalfUnits),
    bathrooms: fromHalfUnits(row.bathroomsHalfUnits),
    squareFeet: row.squareFeet,
    propertyType: row.propertyType,
    availableOn: row.availableOn,
    leaseTermMonths: row.leaseTermMonths,
    petPolicy: row.petPolicy,
    amenities: row.amenities,
    description: row.description,
    lifecycleState: row.lifecycleState,
    completenessBasisPoints: row.completenessBasisPoints,
    freshestObservedAt: row.freshestObservedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

export function mapListingScoreRow(row: ListingScoreRow): ListingScore {
  return ListingScoreSchema.parse(row);
}

export function mapRiskSignalRow(row: RiskSignalRow): RiskSignal {
  return RiskSignalSchema.parse(row);
}

export function mapContactWorkflowRow(row: ContactWorkflowRow): ContactWorkflow {
  return ContactWorkflowSchema.parse(row);
}

export function mapApprovalRow(row: ApprovalRow): Approval {
  return ApprovalSchema.parse(row);
}

export function mapViewingRow(row: ViewingRow): Viewing {
  return ViewingSchema.parse(row);
}

export function mapActivityEventRow(row: ActivityEventRow): ActivityEvent {
  return ActivityEventSchema.parse(row);
}

export function mapSourcePolicyManifestRow(row: SourcePolicyManifestRow): SourcePolicyManifest {
  return SourcePolicyManifestSchema.parse(row);
}

export function mapSourceJobRow(row: SourceJobRow): SourceJob {
  return SourceJobSchema.parse(row);
}

export function mapSourceJobAttemptRow(row: SourceJobAttemptRow): JobAttempt {
  return JobAttemptSchema.parse(row);
}

export function mapBrowserNodeRow(row: BrowserNodeRow): BrowserNodeStatus {
  return BrowserNodeStatusSchema.parse(row);
}
