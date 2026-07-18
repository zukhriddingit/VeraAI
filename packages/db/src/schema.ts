import type {
  ActivityEvent,
  CanonicalListing,
  ContactWorkflow,
  DuplicateCluster,
  JsonObject,
  JsonValue,
  ListingExtractionRun,
  ListingScore,
  RiskSignal,
  SearchProfile,
  SourcePolicyManifest,
  Viewing
} from "@vera/domain";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const searchProfiles = sqliteTable(
  "search_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    locationText: text("location_text").notNull(),
    centerLatitude: integer("center_latitude_microdegrees"),
    centerLongitude: integer("center_longitude_microdegrees"),
    radiusMeters: integer("radius_meters"),
    minimumBedrooms: integer("minimum_bedrooms_half_units"),
    minimumBathrooms: integer("minimum_bathrooms_half_units"),
    targetMonthlyTotalCents: integer("target_monthly_total_cents"),
    absoluteMonthlyMaximumCents: integer("absolute_monthly_maximum_cents"),
    moveInEarliest: text("move_in_earliest"),
    moveInLatest: text("move_in_latest"),
    petRequirements: text("pet_requirements", { mode: "json" })
      .$type<SearchProfile["petRequirements"]>()
      .notNull(),
    commuteAnchors: text("commute_anchors", { mode: "json" })
      .$type<SearchProfile["commuteAnchors"]>()
      .notNull(),
    hardConstraints: text("hard_constraints", { mode: "json" })
      .$type<SearchProfile["hardConstraints"]>()
      .notNull(),
    weightedPreferences: text("weighted_preferences", { mode: "json" })
      .$type<SearchProfile["weightedPreferences"]>()
      .notNull(),
    notificationRules: text("notification_rules", { mode: "json" })
      .$type<SearchProfile["notificationRules"]>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("search_profiles_name_version_unique").on(table.name, table.version),
    check("search_profiles_version_positive", sql`${table.version} > 0`),
    check(
      "search_profiles_budget_nonnegative",
      sql`(${table.targetMonthlyTotalCents} IS NULL OR ${table.targetMonthlyTotalCents} >= 0)
        AND (${table.absoluteMonthlyMaximumCents} IS NULL OR ${table.absoluteMonthlyMaximumCents} >= 0)`
    )
  ]
);

export const rawListings = sqliteTable(
  "raw_listings",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceListingId: text("source_listing_id"),
    sourceUrl: text("source_url"),
    captureMethod: text("capture_method").notNull(),
    observedAt: text("observed_at").notNull(),
    sourcePostedAt: text("source_posted_at"),
    rawText: text("raw_text"),
    rawJson: text("raw_json", { mode: "json" }).$type<JsonValue | null>(),
    captureMetadata: text("capture_metadata", { mode: "json" }).$type<JsonObject>().notNull(),
    contentHash: text("content_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("raw_listings_idempotency_key_unique").on(table.idempotencyKey),
    index("raw_listings_source_identity_idx").on(table.source, table.sourceListingId),
    check(
      "raw_listings_evidence_required",
      sql`${table.rawText} IS NOT NULL OR ${table.rawJson} IS NOT NULL`
    ),
    check(
      "raw_listings_capture_method_allowed",
      sql`${table.captureMethod} IN ('fixture', 'manual_text', 'manual_structured')`
    )
  ]
);

export const listingSourceRecords = sqliteTable(
  "listing_source_records",
  {
    id: text("id").primaryKey(),
    rawListingId: text("raw_listing_id")
      .notNull()
      .references(() => rawListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    source: text("source").notNull(),
    sourceListingId: text("source_listing_id"),
    sourceUrl: text("source_url"),
    sourcePostedAt: text("source_posted_at"),
    contactChannel: text("contact_channel").notNull().default("unknown"),
    title: text("title").notNull(),
    addressLine1: text("address_line_1"),
    addressUnit: text("address_unit"),
    addressCity: text("address_city"),
    addressRegion: text("address_region"),
    addressPostalCode: text("address_postal_code"),
    addressCountryCode: text("address_country_code"),
    monthlyRentCents: integer("monthly_rent_cents"),
    recurringFeesCents: integer("recurring_fees_cents"),
    bedroomsHalfUnits: integer("bedrooms_half_units"),
    bathroomsHalfUnits: integer("bathrooms_half_units"),
    squareFeet: integer("square_feet"),
    propertyType: text("property_type"),
    availableOn: text("available_on"),
    leaseTermMonths: integer("lease_term_months"),
    petPolicy: text("pet_policy", { mode: "json" })
      .$type<CanonicalListing["petPolicy"]>()
      .default(null),
    amenities: text("amenities", { mode: "json" }).$type<CanonicalListing["amenities"]>().notNull(),
    description: text("description"),
    extractionConfidenceBasisPoints: integer("extraction_confidence_basis_points").notNull(),
    completenessBasisPoints: integer("completeness_basis_points").notNull(),
    observedAt: text("observed_at").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("listing_source_records_raw_listing_unique").on(table.rawListingId),
    index("listing_source_records_source_idx").on(table.source),
    check(
      "listing_source_records_confidence_range",
      sql`${table.extractionConfidenceBasisPoints} BETWEEN 0 AND 10000`
    ),
    check(
      "listing_source_records_completeness_range",
      sql`${table.completenessBasisPoints} BETWEEN 0 AND 10000`
    ),
    check(
      "listing_source_records_money_nonnegative",
      sql`(${table.monthlyRentCents} IS NULL OR ${table.monthlyRentCents} >= 0)
        AND (${table.recurringFeesCents} IS NULL OR ${table.recurringFeesCents} >= 0)`
    ),
    check(
      "listing_source_records_contact_channel_allowed",
      sql`${table.contactChannel} IN (
        'email', 'phone', 'platform_message', 'website_form', 'other', 'unknown'
      )`
    )
  ]
);

export const listingPhotos = sqliteTable(
  "listing_photos",
  {
    id: text("id").primaryKey(),
    listingSourceRecordId: text("listing_source_record_id")
      .notNull()
      .references(() => listingSourceRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    sourceUrl: text("source_url"),
    fixtureAssetLabel: text("fixture_asset_label"),
    byteHash: text("byte_hash"),
    perceptualHash: text("perceptual_hash"),
    position: integer("position").notNull(),
    observedAt: text("observed_at").notNull()
  },
  (table) => [
    uniqueIndex("listing_photos_source_position_unique").on(
      table.listingSourceRecordId,
      table.position
    ),
    check(
      "listing_photos_reference_required",
      sql`${table.sourceUrl} IS NOT NULL OR ${table.fixtureAssetLabel} IS NOT NULL`
    ),
    check("listing_photos_position_nonnegative", sql`${table.position} >= 0`)
  ]
);

export const fieldProvenance = sqliteTable(
  "field_provenance",
  {
    id: text("id").primaryKey(),
    listingSourceRecordId: text("listing_source_record_id")
      .notNull()
      .references(() => listingSourceRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    rawListingId: text("raw_listing_id")
      .notNull()
      .references(() => rawListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    fieldPath: text("field_path").notNull(),
    extractionMethod: text("extraction_method").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    valueStatus: text("value_status").notNull().default("known"),
    unknownReason: text("unknown_reason"),
    observedAt: text("observed_at").notNull(),
    evidenceExcerpt: text("evidence_excerpt")
  },
  (table) => [
    uniqueIndex("field_provenance_source_field_unique").on(
      table.listingSourceRecordId,
      table.fieldPath
    ),
    check(
      "field_provenance_confidence_range",
      sql`${table.confidenceBasisPoints} BETWEEN 0 AND 10000`
    ),
    check(
      "field_provenance_method_allowed",
      sql`${table.extractionMethod} IN ('fixture_structured', 'manual', 'rule', 'ai')`
    ),
    check(
      "field_provenance_value_status_allowed",
      sql`${table.valueStatus} IN ('known', 'unknown')`
    ),
    check(
      "field_provenance_unknown_consistency",
      sql`(
        ${table.valueStatus} = 'known'
        AND ${table.unknownReason} IS NULL
      ) OR (
        ${table.valueStatus} = 'unknown'
        AND ${table.confidenceBasisPoints} = 0
        AND ${table.unknownReason} IN (
          'missing_evidence', 'unrecognized_format', 'not_applicable'
        )
      )`
    )
  ]
);

export const normalizationJobs = sqliteTable(
  "normalization_jobs",
  {
    id: text("id").primaryKey(),
    rawListingId: text("raw_listing_id")
      .notNull()
      .references(() => rawListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    jobType: text("job_type").notNull().default("normalize_listing"),
    state: text("state").notNull(),
    availableAt: text("available_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorCategory: text("last_error_category"),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at")
  },
  (table) => [
    uniqueIndex("normalization_jobs_raw_listing_unique").on(table.rawListingId),
    uniqueIndex("normalization_jobs_idempotency_key_unique").on(table.idempotencyKey),
    index("normalization_jobs_claim_idx").on(table.state, table.availableAt, table.createdAt),
    check("normalization_jobs_type_allowed", sql`${table.jobType} = 'normalize_listing'`),
    check(
      "normalization_jobs_state_allowed",
      sql`${table.state} IN ('queued', 'leased', 'completed', 'retryable', 'dead_letter')`
    ),
    check(
      "normalization_jobs_attempts_valid",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attempts} <= ${table.maxAttempts}`
    ),
    check(
      "normalization_jobs_attempt_state_consistency",
      sql`(
        ${table.state} = 'queued' AND ${table.attempts} = 0
      ) OR (
        ${table.state} IN ('leased', 'completed') AND ${table.attempts} >= 1
      ) OR (
        ${table.state} = 'retryable'
        AND ${table.attempts} >= 1
        AND ${table.attempts} < ${table.maxAttempts}
      ) OR (
        ${table.state} = 'dead_letter'
        AND ${table.attempts} >= 1
        AND ${table.attempts} <= ${table.maxAttempts}
      )`
    ),
    check(
      "normalization_jobs_lease_consistency",
      sql`(
        ${table.state} = 'leased'
        AND ${table.leaseOwner} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${table.state} <> 'leased'
        AND ${table.leaseOwner} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      )`
    ),
    check(
      "normalization_jobs_completion_consistency",
      sql`(
        ${table.state} = 'completed'
        AND ${table.completedAt} IS NOT NULL
      ) OR (
        ${table.state} <> 'completed'
        AND ${table.completedAt} IS NULL
      )`
    ),
    check(
      "normalization_jobs_error_pair_consistency",
      sql`(${table.lastErrorCode} IS NULL) = (${table.lastErrorCategory} IS NULL)`
    ),
    check(
      "normalization_jobs_error_state_consistency",
      sql`(
        ${table.state} IN ('queued', 'completed')
        AND ${table.lastErrorCode} IS NULL
      ) OR (
        ${table.state} IN ('retryable', 'dead_letter')
        AND ${table.lastErrorCode} IS NOT NULL
      ) OR ${table.state} = 'leased'`
    )
  ]
);

export const listingExtractions = sqliteTable(
  "listing_extractions",
  {
    id: text("id").primaryKey(),
    rawListingId: text("raw_listing_id")
      .notNull()
      .references(() => rawListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    listingSourceRecordId: text("listing_source_record_id")
      .notNull()
      .references(() => listingSourceRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    mode: text("mode").notNull(),
    inputHash: text("input_hash").notNull(),
    requestedFields: text("requested_fields", { mode: "json" })
      .$type<ListingExtractionRun["requestedFields"]>()
      .notNull(),
    providerId: text("provider_id"),
    model: text("model"),
    responseId: text("response_id"),
    promptVersion: text("prompt_version").notNull(),
    extractionVersion: text("extraction_version").notNull(),
    providerResult: text("provider_result", { mode: "json" }).$type<
      ListingExtractionRun["providerResult"]
    >(),
    mergedExtraction: text("merged_extraction", { mode: "json" })
      .$type<ListingExtractionRun["mergedExtraction"]>()
      .notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    latencyMilliseconds: integer("latency_milliseconds").notNull(),
    repairCount: integer("repair_count").notNull(),
    completedAt: text("completed_at").notNull()
  },
  (table) => [
    uniqueIndex("listing_extractions_raw_listing_unique").on(table.rawListingId),
    uniqueIndex("listing_extractions_source_record_unique").on(table.listingSourceRecordId),
    check(
      "listing_extractions_mode_allowed",
      sql`${table.mode} IN ('deterministic_only', 'llm_augmented')`
    ),
    check(
      "listing_extractions_input_hash_valid",
      sql`length(${table.inputHash}) = 64 AND ${table.inputHash} NOT GLOB '*[^a-f0-9]*'`
    ),
    check(
      "listing_extractions_metrics_nonnegative",
      sql`${table.inputTokens} >= 0
        AND ${table.outputTokens} >= 0
        AND ${table.totalTokens} >= 0
        AND ${table.latencyMilliseconds} >= 0`
    ),
    check(
      "listing_extractions_token_total_consistency",
      sql`${table.totalTokens} = ${table.inputTokens} + ${table.outputTokens}`
    ),
    check("listing_extractions_repair_range", sql`${table.repairCount} IN (0, 1)`),
    check(
      "listing_extractions_mode_metadata_consistency",
      sql`(
        ${table.mode} = 'deterministic_only'
        AND ${table.providerId} IS NULL
        AND ${table.model} IS NULL
        AND ${table.responseId} IS NULL
        AND ${table.providerResult} IS NULL
        AND ${table.inputTokens} = 0
        AND ${table.outputTokens} = 0
        AND ${table.totalTokens} = 0
        AND ${table.latencyMilliseconds} = 0
        AND ${table.repairCount} = 0
      ) OR (
        ${table.mode} = 'llm_augmented'
        AND ${table.providerId} IS NOT NULL
        AND ${table.model} IS NOT NULL
        AND ${table.providerResult} IS NOT NULL
      )`
    )
  ]
);

export const duplicateClusters = sqliteTable(
  "duplicate_clusters",
  {
    id: text("id").primaryKey(),
    clusterKey: text("cluster_key").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    reasonCodes: text("reason_codes", { mode: "json" })
      .$type<DuplicateCluster["reasonCodes"]>()
      .notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [uniqueIndex("duplicate_clusters_key_unique").on(table.clusterKey)]
);

export const canonicalListings = sqliteTable(
  "canonical_listings",
  {
    id: text("id").primaryKey(),
    duplicateClusterId: text("duplicate_cluster_id").references(() => duplicateClusters.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    primarySourceRecordId: text("primary_source_record_id")
      .notNull()
      .references(() => listingSourceRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    title: text("title").notNull(),
    addressLine1: text("address_line_1"),
    addressUnit: text("address_unit"),
    addressCity: text("address_city"),
    addressRegion: text("address_region"),
    addressPostalCode: text("address_postal_code"),
    addressCountryCode: text("address_country_code"),
    monthlyRentCents: integer("monthly_rent_cents"),
    recurringFeesCents: integer("recurring_fees_cents"),
    bedroomsHalfUnits: integer("bedrooms_half_units"),
    bathroomsHalfUnits: integer("bathrooms_half_units"),
    squareFeet: integer("square_feet"),
    propertyType: text("property_type"),
    availableOn: text("available_on"),
    leaseTermMonths: integer("lease_term_months"),
    petPolicy: text("pet_policy", { mode: "json" })
      .$type<CanonicalListing["petPolicy"]>()
      .default(null),
    amenities: text("amenities", { mode: "json" }).$type<CanonicalListing["amenities"]>().notNull(),
    description: text("description"),
    lifecycleState: text("lifecycle_state").notNull(),
    completenessBasisPoints: integer("completeness_basis_points").notNull(),
    freshestObservedAt: text("freshest_observed_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("canonical_listings_duplicate_cluster_unique").on(table.duplicateClusterId),
    check(
      "canonical_listings_lifecycle_allowed",
      sql`${table.lifecycleState} IN (
        'new', 'shortlisted', 'draft_ready', 'draft_created', 'draft_rejected', 'replied',
        'follow_up_due', 'tour_proposed', 'tour_scheduled', 'toured', 'applying', 'passed',
        'dismissed', 'stale', 'unavailable'
      )`
    ),
    check(
      "canonical_listings_completeness_range",
      sql`${table.completenessBasisPoints} BETWEEN 0 AND 10000`
    ),
    check(
      "canonical_listings_money_nonnegative",
      sql`(${table.monthlyRentCents} IS NULL OR ${table.monthlyRentCents} >= 0)
        AND (${table.recurringFeesCents} IS NULL OR ${table.recurringFeesCents} >= 0)`
    )
  ]
);

export const canonicalListingSources = sqliteTable(
  "canonical_listing_sources",
  {
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    listingSourceRecordId: text("listing_source_record_id")
      .notNull()
      .references(() => listingSourceRecords.id, { onDelete: "restrict", onUpdate: "restrict" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.canonicalListingId, table.listingSourceRecordId] }),
    uniqueIndex("canonical_listing_sources_source_unique").on(table.listingSourceRecordId)
  ]
);

export const canonicalFieldSources = sqliteTable(
  "canonical_field_sources",
  {
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    fieldPath: text("field_path").notNull(),
    fieldProvenanceId: text("field_provenance_id")
      .notNull()
      .references(() => fieldProvenance.id, { onDelete: "restrict", onUpdate: "restrict" })
  },
  (table) => [
    primaryKey({ columns: [table.canonicalListingId, table.fieldPath] }),
    index("canonical_field_sources_provenance_idx").on(table.fieldProvenanceId)
  ]
);

export const listingScores = sqliteTable(
  "listing_scores",
  {
    id: text("id").primaryKey(),
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    searchProfileId: text("search_profile_id").references(() => searchProfiles.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    algorithmVersion: text("algorithm_version").notNull(),
    inputHash: text("input_hash").notNull(),
    totalScoreBasisPoints: integer("total_score_basis_points").notNull(),
    factors: text("factors", { mode: "json" }).$type<ListingScore["factors"]>().notNull(),
    reasonCodes: text("reason_codes", { mode: "json" })
      .$type<ListingScore["reasonCodes"]>()
      .notNull(),
    computedAt: text("computed_at").notNull()
  },
  (table) => [
    uniqueIndex("listing_scores_snapshot_unique").on(
      table.canonicalListingId,
      table.searchProfileId,
      table.algorithmVersion,
      table.inputHash
    ),
    check(
      "listing_scores_total_range",
      sql`${table.totalScoreBasisPoints} BETWEEN -10000 AND 10000`
    )
  ]
);

export const riskSignals = sqliteTable(
  "risk_signals",
  {
    id: text("id").primaryKey(),
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    code: text("code").notNull(),
    severity: text("severity").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<RiskSignal["evidence"]>().notNull(),
    verificationAction: text("verification_action").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("risk_signals_listing_code_unique").on(table.canonicalListingId, table.code),
    check("risk_signals_confidence_range", sql`${table.confidenceBasisPoints} BETWEEN 0 AND 10000`),
    check(
      "risk_signals_severity_allowed",
      sql`${table.severity} IN ('info', 'low', 'medium', 'high')`
    ),
    check("risk_signals_status_allowed", sql`${table.status} IN ('open', 'verified', 'dismissed')`)
  ]
);

export const contactWorkflows = sqliteTable(
  "contact_workflows",
  {
    id: text("id").primaryKey(),
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    channel: text("channel").notNull(),
    recipientReference: text("recipient_reference"),
    missingFactQuestions: text("missing_fact_questions", { mode: "json" })
      .$type<ContactWorkflow["missingFactQuestions"]>()
      .notNull(),
    draftReference: text("draft_reference"),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("contact_workflows_listing_unique").on(table.canonicalListingId),
    check(
      "contact_workflows_state_allowed",
      sql`${table.state} IN ('not_started', 'questions_ready', 'draft_ready', 'draft_created', 'reply_received', 'closed')`
    )
  ]
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    connectorId: text("connector_id").notNull(),
    operation: text("operation").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at")
  },
  (table) => [
    check("approvals_actor_user_only", sql`${table.actor} = 'user'`),
    check(
      "approvals_state_allowed",
      sql`${table.state} IN ('pending', 'used', 'expired', 'revoked')`
    )
  ]
);

export const viewings = sqliteTable(
  "viewings",
  {
    id: text("id").primaryKey(),
    canonicalListingId: text("canonical_listing_id")
      .notNull()
      .references(() => canonicalListings.id, { onDelete: "restrict", onUpdate: "restrict" }),
    proposedWindows: text("proposed_windows", { mode: "json" })
      .$type<Viewing["proposedWindows"]>()
      .notNull(),
    confirmedWindow: text("confirmed_window", { mode: "json" }).$type<Viewing["confirmedWindow"]>(),
    timeZone: text("time_zone").notNull(),
    calendarReference: text("calendar_reference"),
    state: text("state").notNull(),
    notes: text("notes"),
    metadata: text("metadata", { mode: "json" }).$type<Viewing["metadata"]>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    check(
      "viewings_state_allowed",
      sql`${table.state} IN ('proposed', 'selected', 'hold_approved', 'hold_created', 'confirmed', 'completed', 'cancelled')`
    )
  ]
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    policyDecision: text("policy_decision").notNull(),
    approvalId: text("approval_id").references(() => approvals.id, {
      onDelete: "restrict",
      onUpdate: "restrict"
    }),
    payloadHash: text("payload_hash").notNull(),
    outcome: text("outcome").notNull(),
    errorCategory: text("error_category"),
    metadata: text("metadata", { mode: "json" }).$type<ActivityEvent["metadata"]>().notNull(),
    occurredAt: text("occurred_at").notNull()
  },
  (table) => [
    index("activity_events_correlation_idx").on(table.correlationId, table.occurredAt),
    check(
      "activity_events_actor_allowed",
      sql`${table.actor} IN ('user', 'vera', 'connector', 'system')`
    ),
    check(
      "activity_events_policy_allowed",
      sql`${table.policyDecision} IN ('not_applicable', 'authorized', 'denied')`
    ),
    check(
      "activity_events_outcome_allowed",
      sql`${table.outcome} IN ('recorded', 'authorized', 'denied', 'succeeded', 'failed')`
    )
  ]
);

export const sourcePolicyManifests = sqliteTable(
  "source_policy_manifests",
  {
    schemaVersion: integer("schema_version").notNull().default(1),
    connectorId: text("connector_id").notNull(),
    displayName: text("display_name").notNull().default("Sanitized source label"),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    execution: text("execution").notNull(),
    capabilities: text("capabilities", { mode: "json" })
      .$type<SourcePolicyManifest["capabilities"]>()
      .notNull(),
    allowedOperations: text("allowed_operations", { mode: "json" })
      .$type<SourcePolicyManifest["allowedOperations"]>()
      .notNull()
      .default([]),
    allowedDomains: text("allowed_domains", { mode: "json" })
      .$type<SourcePolicyManifest["allowedDomains"]>()
      .notNull(),
    allowedOrigins: text("allowed_origins", { mode: "json" })
      .$type<SourcePolicyManifest["allowedOrigins"]>()
      .notNull()
      .default([]),
    allowedHttpMethods: text("allowed_http_methods", { mode: "json" })
      .$type<SourcePolicyManifest["allowedHttpMethods"]>()
      .notNull()
      .default([]),
    requiresUserSession: integer("requires_user_session", { mode: "boolean" }).notNull(),
    requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull(),
    minimumIntervalSeconds: integer("minimum_interval_seconds"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    globalKillSwitchKey: text("global_kill_switch_key").notNull().default("integrations.disabled"),
    connectorKillSwitchKey: text("connector_kill_switch_key")
      .notNull()
      .default("integrations.legacy_source_labels"),
    dataClassification: text("data_classification").notNull().default("synthetic"),
    redactionRules: text("redaction_rules", { mode: "json" })
      .$type<SourcePolicyManifest["redactionRules"]>()
      .notNull()
      .default([
        "raw_content_from_logs",
        "full_urls_from_logs",
        "contact_details_from_logs",
        "credentials_from_logs"
      ]),
    manualBlockerBehavior: text("manual_blocker_behavior")
      .notNull()
      .default("stop_and_request_user_action"),
    owner: text("owner").notNull().default("Vera maintainers"),
    reviewedAt: text("reviewed_at").notNull().default("2026-07-17"),
    decisionRecord: text("decision_record")
      .notNull()
      .default("docs/DECISIONS/0004-fail-closed-connectors.md"),
    notes: text("notes").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.connectorId, table.version] }),
    check("source_policy_manifests_version_positive", sql`${table.version} > 0`),
    check("source_policy_manifests_schema_version_supported", sql`${table.schemaVersion} = 1`),
    check(
      "source_policy_manifests_execution_allowed",
      sql`${table.execution} IN ('manual', 'scheduled')`
    ),
    check(
      "source_policy_manifests_scheduling_consistency",
      sql`${table.execution} <> 'scheduled' OR ${table.minimumIntervalSeconds} IS NOT NULL`
    ),
    check("source_policy_manifests_concurrency_positive", sql`${table.maxConcurrency} > 0`)
  ]
);

export const schema = {
  activityEvents,
  approvals,
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
  sourcePolicyManifests,
  viewings
};
