import {
  ActivityEventSchema,
  ApprovalSchema,
  AvailabilityCheckSchema,
  AvailabilityRuleSetSchema,
  BrowserNodeStatusSchema,
  CanonicalListingSchema,
  CalendarHoldSchema,
  CalendarOAuthStateSchema,
  ContactWorkflowSchema,
  DuplicateClusterSchema,
  DecisionJobSchema,
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
  ProposedViewingWindowSchema,
  ViewingSchema,
  type ActivityEvent,
  type Approval,
  type AvailabilityCheck,
  type AvailabilityRuleSet,
  type BrowserNodeStatus,
  type CanonicalListing,
  type CalendarHold,
  type CalendarOAuthState,
  type ContactWorkflow,
  type DuplicateCluster,
  type DecisionJob,
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
  type ProposedViewingWindow,
  type Viewing
} from "@vera/domain";

import type {
  activityEvents,
  approvals,
  availabilityChecks,
  availabilityRuleSets,
  browserNodes,
  calendarHolds,
  calendarOauthStates,
  canonicalListings,
  contactWorkflows,
  duplicateClusters,
  decisionJobs,
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
type DecisionJobRow = typeof decisionJobs.$inferSelect;
type CanonicalListingRow = typeof canonicalListings.$inferSelect;
type ListingScoreRow = typeof listingScores.$inferSelect;
type RiskSignalRow = typeof riskSignals.$inferSelect;
type ContactWorkflowRow = typeof contactWorkflows.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type AvailabilityRuleSetRow = typeof availabilityRuleSets.$inferSelect;
type AvailabilityCheckRow = typeof availabilityChecks.$inferSelect;
type CalendarOAuthStateRow = typeof calendarOauthStates.$inferSelect;
type CalendarHoldRow = typeof calendarHolds.$inferSelect;
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

function toIso(value: Date): string;
function toIso(value: Date | null): string | null;
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, normalizeDates(nested)])
  );
}

function normalizeTenantRow(row: object): unknown {
  const { userId: _userId, ...value } = row as { readonly userId?: unknown };
  return normalizeDates(value);
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
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  });
}

export function mapRawListingRow(row: RawListingRow): RawListing {
  return RawListingSchema.parse(normalizeTenantRow(row));
}

export function mapListingSourceRecordRow(row: ListingSourceRecordRow): ListingSourceRecord {
  return ListingSourceRecordSchema.parse({
    id: row.id,
    rawListingId: row.rawListingId,
    source: row.source,
    sourceListingId: row.sourceListingId,
    sourceUrl: row.sourceUrl,
    sourcePostedAt: toIso(row.sourcePostedAt),
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
    latitude: fromMicrodegrees(row.latitude),
    longitude: fromMicrodegrees(row.longitude),
    propertyType: row.propertyType,
    availableOn: row.availableOn,
    leaseTermMonths: row.leaseTermMonths,
    petPolicy: row.petPolicy,
    amenities: row.amenities,
    description: row.description,
    extractionConfidenceBasisPoints: row.extractionConfidenceBasisPoints,
    completenessBasisPoints: row.completenessBasisPoints,
    observedAt: toIso(row.observedAt),
    createdAt: toIso(row.createdAt)
  });
}

export function mapListingPhotoRow(row: ListingPhotoRow): ListingPhoto {
  return ListingPhotoSchema.parse(normalizeTenantRow(row));
}

export function mapFieldProvenanceRow(row: FieldProvenanceRow): FieldProvenance {
  return FieldProvenanceSchema.parse(normalizeTenantRow(row));
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
    completedAt: toIso(row.completedAt)
  });
}

export function mapNormalizationJobRow(row: NormalizationJobRow): NormalizationJob {
  return NormalizationJobSchema.parse(normalizeTenantRow(row));
}

export function mapDecisionJobRow(row: DecisionJobRow): DecisionJob {
  return DecisionJobSchema.parse(normalizeTenantRow(row));
}

export function mapDuplicateClusterRow(
  row: DuplicateClusterRow,
  memberSourceRecordIds: readonly string[]
): DuplicateCluster {
  return DuplicateClusterSchema.parse({
    id: row.id,
    clusterKey: row.clusterKey,
    algorithmVersion: row.algorithmVersion,
    reasonCodes: row.reasonCodes,
    memberSourceRecordIds,
    createdAt: toIso(row.createdAt)
  });
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
    projectionState: row.projectionState,
    supersededById: row.supersededById,
    stitchVersion: row.stitchVersion,
    stitchInputHash: row.stitchInputHash,
    updatedByDecisionRunId: row.updatedByDecisionRunId,
    completenessBasisPoints: row.completenessBasisPoints,
    freshestObservedAt: toIso(row.freshestObservedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  });
}

export function mapListingScoreRow(row: ListingScoreRow): ListingScore {
  return ListingScoreSchema.parse({
    id: row.id,
    canonicalListingId: row.canonicalListingId,
    searchProfileId: row.searchProfileId,
    algorithmVersion: row.algorithmVersion,
    inputHash: row.inputHash,
    totalScoreBasisPoints: row.totalScoreBasisPoints,
    factors: row.factors,
    reasonCodes: row.reasonCodes,
    computedAt: toIso(row.computedAt)
  });
}

export function mapRiskSignalRow(row: RiskSignalRow): RiskSignal {
  return RiskSignalSchema.parse({
    id: row.id,
    canonicalListingId: row.canonicalListingId,
    code: row.code,
    severity: row.severity,
    confidenceBasisPoints: row.confidenceBasisPoints,
    evidence: row.evidence,
    verificationAction: row.verificationAction,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  });
}

export function mapContactWorkflowRow(row: ContactWorkflowRow): ContactWorkflow {
  return ContactWorkflowSchema.parse(normalizeTenantRow(row));
}

export function mapApprovalRow(row: ApprovalRow): Approval {
  return ApprovalSchema.parse(normalizeTenantRow(row));
}

const EMPTY_WEEKLY_INTERVALS = {
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
} as const;

function legacyViewingWindow(value: unknown, timeZone: string): ProposedViewingWindow | null {
  const parsed = ProposedViewingWindowSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { readonly startsAt?: unknown; readonly endsAt?: unknown };
  if (typeof candidate.startsAt !== "string" || typeof candidate.endsAt !== "string") return null;
  return ProposedViewingWindowSchema.parse({
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    timeZone,
    availabilitySource: "vera_rules_only",
    state: "vera_rules_only",
    availabilityCheckId: null,
    checkedAt: null,
    calendarsChecked: [],
    requiresConflictWarning: true,
    rules: {
      timeZone,
      weeklyIntervals: EMPTY_WEEKLY_INTERVALS,
      durationMinutes: 60,
      minimumNoticeMinutes: 0,
      travelMinutes: 0,
      bufferMinutes: 0,
      remindersMinutesBeforeStart: [],
      conflictCheckingEnabled: false,
      calendarIds: [],
      schemaVersion: 1
    },
    generatorVersion: "legacy.v0"
  });
}

export function mapViewingRow(row: ViewingRow): Viewing {
  const proposedWindows = row.proposedWindows.map((window) =>
    legacyViewingWindow(window, row.timeZone)
  );
  if (proposedWindows.some((window) => window === null)) {
    throw new Error("Persisted Viewing contains an invalid proposed window.");
  }
  const selectedWindow =
    legacyViewingWindow(row.selectedWindow, row.timeZone) ??
    (["selected", "hold_approved", "hold_created", "confirmed", "completed"].includes(row.state)
      ? (proposedWindows[0] ?? null)
      : null);
  return ViewingSchema.parse({
    ...(normalizeTenantRow(row) as Record<string, unknown>),
    proposedWindows,
    selectedWindow
  });
}

function encryptedVerifier(row: CalendarOAuthStateRow) {
  const values = [
    row.credentialVersion,
    row.credentialAlgorithm,
    row.credentialKeyId,
    row.credentialNonce,
    row.credentialCiphertext,
    row.credentialAuthenticationTag
  ];
  if (values.some((value) => value === null)) {
    throw new Error("Persisted Calendar OAuth verifier envelope is incomplete.");
  }
  return {
    version: row.credentialVersion,
    algorithm: row.credentialAlgorithm,
    keyId: row.credentialKeyId,
    nonce: row.credentialNonce?.toString("base64"),
    ciphertext: row.credentialCiphertext?.toString("base64"),
    authenticationTag: row.credentialAuthenticationTag?.toString("base64")
  };
}

export function mapAvailabilityRuleSetRow(row: AvailabilityRuleSetRow): AvailabilityRuleSet {
  return AvailabilityRuleSetSchema.parse({
    id: row.id,
    timeZone: row.timeZone,
    weeklyIntervals: row.weeklyIntervals,
    durationMinutes: row.durationMinutes,
    minimumNoticeMinutes: row.minimumNoticeMinutes,
    travelMinutes: row.travelMinutes,
    bufferMinutes: row.bufferMinutes,
    remindersMinutesBeforeStart: row.remindersMinutesBeforeStart,
    conflictCheckingEnabled: row.conflictCheckingEnabled,
    calendarIds: row.selectedCalendarIds,
    schemaVersion: row.schemaVersion,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  });
}

export function mapCalendarOAuthStateRow(row: CalendarOAuthStateRow): CalendarOAuthState {
  return CalendarOAuthStateSchema.parse({
    id: row.id,
    userId: row.userId,
    stateHash: row.stateHash,
    capability: row.capability,
    requestedCalendarScopes: row.requestedCalendarScopes,
    encryptedPkceVerifier: encryptedVerifier(row),
    redirectUriHash: row.redirectUriHash,
    returnTo: row.returnTo,
    createdAt: toIso(row.createdAt),
    expiresAt: toIso(row.expiresAt),
    consumedAt: toIso(row.consumedAt)
  });
}

export function mapAvailabilityCheckRow(row: AvailabilityCheckRow): AvailabilityCheck {
  return AvailabilityCheckSchema.parse(normalizeTenantRow(row));
}

export function mapCalendarHoldRow(row: CalendarHoldRow): CalendarHold {
  const { calendarId: _calendarId, ...value } = row;
  return CalendarHoldSchema.parse(normalizeTenantRow(value));
}

export function mapActivityEventRow(row: ActivityEventRow): ActivityEvent {
  return ActivityEventSchema.parse(normalizeTenantRow(row));
}

export function mapSourcePolicyManifestRow(row: SourcePolicyManifestRow): SourcePolicyManifest {
  return SourcePolicyManifestSchema.parse(normalizeDates(row));
}

export function mapSourceJobRow(row: SourceJobRow): SourceJob {
  const {
    userId: _userId,
    availableAt: _availableAt,
    leaseOwner: _leaseOwner,
    leaseExpiresAt: _leaseExpiresAt,
    browserNodeId: _browserNodeId,
    browserProfileId: _browserProfileId,
    ...value
  } = row;
  return SourceJobSchema.parse(normalizeDates(value));
}

export function mapSourceJobAttemptRow(row: SourceJobAttemptRow): JobAttempt {
  return JobAttemptSchema.parse(normalizeTenantRow(row));
}

export function mapBrowserNodeRow(row: BrowserNodeRow): BrowserNodeStatus {
  return BrowserNodeStatusSchema.parse(normalizeTenantRow(row));
}
