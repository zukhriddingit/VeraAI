import type {
  ActivityEvent,
  BrowserNodeStatus,
  CanonicalListing,
  CanonicalListingPlan,
  ContactWorkflow,
  DuplicateCluster,
  DuplicateOverride,
  DuplicatePairEvaluation,
  JobAttempt,
  JsonObject,
  JsonValue,
  ListingExtractionRun,
  ListingScore,
  ListingScoreV2,
  RiskSignal,
  RiskSignalV2,
  SearchProfile,
  SourceJob,
  SourcePolicyManifest,
  Viewing
} from "@vera/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  }
});

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const calendarDate = (name: string) => date(name, { mode: "string" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow()
  },
  (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: instant("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" })
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_expiry_idx").on(table.userId, table.expiresAt)
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique").on(table.providerId, table.accountId),
    index("accounts_user_idx").on(table.userId)
  ]
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow()
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    provider: text("provider").notNull(),
    providerSubjectId: text("provider_subject_id").notNull(),
    displayEmail: text("display_email"),
    credentialVersion: integer("credential_version"),
    credentialAlgorithm: text("credential_algorithm"),
    credentialKeyId: text("credential_key_id"),
    credentialNonce: bytea("credential_nonce"),
    credentialCiphertext: bytea("credential_ciphertext"),
    credentialAuthenticationTag: bytea("credential_authentication_tag"),
    grantedScopes: text("granted_scopes")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tokenExpiresAt: instant("token_expires_at"),
    status: text("status").notNull(),
    lastSuccessfulUseAt: instant("last_successful_use_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("integration_connections_user_provider_subject_unique").on(
      table.userId,
      table.provider,
      table.providerSubjectId
    ),
    check("integration_connections_provider_allowed", sql`${table.provider} IN ('google')`),
    check(
      "integration_connections_status_allowed",
      sql`${table.status} IN ('connected', 'partial', 'expired', 'revoked', 'disconnected', 'reconnect_required')`
    ),
    check(
      "integration_connections_credential_all_or_none",
      sql`num_nonnulls(${table.credentialVersion}, ${table.credentialAlgorithm}, ${table.credentialKeyId}, ${table.credentialNonce}, ${table.credentialCiphertext}, ${table.credentialAuthenticationTag}) IN (0, 6)`
    ),
    check(
      "integration_connections_disconnected_no_credential",
      sql`${table.status} <> 'disconnected' OR ${table.credentialCiphertext} IS NULL`
    )
  ]
);

export const searchProfiles = pgTable(
  "search_profiles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
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
    moveInEarliest: calendarDate("move_in_earliest"),
    moveInLatest: calendarDate("move_in_latest"),
    petRequirements: jsonb("pet_requirements").$type<SearchProfile["petRequirements"]>().notNull(),
    commuteAnchors: jsonb("commute_anchors").$type<SearchProfile["commuteAnchors"]>().notNull(),
    hardConstraints: jsonb("hard_constraints").$type<SearchProfile["hardConstraints"]>().notNull(),
    weightedPreferences: jsonb("weighted_preferences")
      .$type<SearchProfile["weightedPreferences"]>()
      .notNull(),
    notificationRules: jsonb("notification_rules")
      .$type<SearchProfile["notificationRules"]>()
      .notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("search_profiles_user_name_version_unique").on(
      table.userId,
      table.name,
      table.version
    ),
    check("search_profiles_version_positive", sql`${table.version} > 0`),
    check(
      "search_profiles_budget_nonnegative",
      sql`(${table.targetMonthlyTotalCents} IS NULL OR ${table.targetMonthlyTotalCents} >= 0)
        AND (${table.absoluteMonthlyMaximumCents} IS NULL OR ${table.absoluteMonthlyMaximumCents} >= 0)`
    )
  ]
);

export const rawListings = pgTable(
  "raw_listings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    source: text("source").notNull(),
    sourceListingId: text("source_listing_id"),
    sourceUrl: text("source_url"),
    acquisitionMode: text("acquisition_mode").notNull(),
    captureMethod: text("capture_method").notNull(),
    observedAt: instant("observed_at").notNull(),
    sourcePostedAt: instant("source_posted_at"),
    rawText: text("raw_text"),
    rawJson: jsonb("raw_json").$type<JsonValue | null>(),
    captureMetadata: jsonb("capture_metadata").$type<JsonObject>().notNull(),
    contentHash: text("content_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("raw_listings_user_idempotency_key_unique").on(table.userId, table.idempotencyKey),
    index("raw_listings_user_source_identity_idx").on(
      table.userId,
      table.source,
      table.sourceListingId
    ),
    check(
      "raw_listings_evidence_required",
      sql`${table.rawText} IS NOT NULL OR ${table.rawJson} IS NOT NULL`
    ),
    check("raw_listings_content_hash_valid", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "raw_listings_capture_method_allowed",
      sql`${table.captureMethod} IN ('fixture', 'manual_text', 'manual_structured', 'official_api', 'email_alert', 'local_browser')`
    ),
    check(
      "raw_listings_acquisition_mode_allowed",
      sql`${table.acquisitionMode} IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')`
    ),
    check(
      "raw_listings_capture_mode_consistency",
      sql`(${table.captureMethod} = 'fixture' AND ${table.acquisitionMode} = 'fixture')
        OR (${table.captureMethod} IN ('manual_text', 'manual_structured') AND ${table.acquisitionMode} = 'user_capture')
        OR (${table.captureMethod} = 'official_api' AND ${table.acquisitionMode} = 'official_api')
        OR (${table.captureMethod} = 'email_alert' AND ${table.acquisitionMode} = 'email_alert')
        OR (${table.captureMethod} = 'local_browser' AND ${table.acquisitionMode} = 'local_browser')`
    )
  ]
);

export const listingSourceRecords = pgTable(
  "listing_source_records",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    rawListingId: text("raw_listing_id").notNull(),
    source: text("source").notNull(),
    sourceListingId: text("source_listing_id"),
    sourceUrl: text("source_url"),
    sourcePostedAt: instant("source_posted_at"),
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
    latitude: integer("latitude_microdegrees"),
    longitude: integer("longitude_microdegrees"),
    propertyType: text("property_type"),
    availableOn: calendarDate("available_on"),
    leaseTermMonths: integer("lease_term_months"),
    petPolicy: jsonb("pet_policy").$type<CanonicalListing["petPolicy"]>(),
    amenities: jsonb("amenities").$type<CanonicalListing["amenities"]>().notNull(),
    description: text("description"),
    extractionConfidenceBasisPoints: integer("extraction_confidence_basis_points").notNull(),
    completenessBasisPoints: integer("completeness_basis_points").notNull(),
    observedAt: instant("observed_at").notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("listing_source_records_user_raw_listing_unique").on(
      table.userId,
      table.rawListingId
    ),
    foreignKey({
      name: "listing_source_records_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("listing_source_records_user_source_idx").on(table.userId, table.source),
    index("listing_source_records_user_coordinates_idx").on(
      table.userId,
      table.latitude,
      table.longitude
    ),
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
      sql`${table.contactChannel} IN ('email', 'phone', 'platform_message', 'website_form', 'other', 'unknown')`
    ),
    check(
      "listing_source_records_coordinate_pair",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`
    )
  ]
);

export const listingPhotos = pgTable(
  "listing_photos",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    listingSourceRecordId: text("listing_source_record_id").notNull(),
    sourceUrl: text("source_url"),
    fixtureAssetLabel: text("fixture_asset_label"),
    byteHash: text("byte_hash"),
    perceptualHash: text("perceptual_hash"),
    byteSize: integer("byte_size"),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type"),
    perceptualHashVersion: text("perceptual_hash_version"),
    position: integer("position").notNull(),
    observedAt: instant("observed_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "listing_photos_source_record_tenant_fk",
      columns: [table.userId, table.listingSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("listing_photos_user_source_position_unique").on(
      table.userId,
      table.listingSourceRecordId,
      table.position
    ),
    index("listing_photos_user_byte_hash_idx").on(table.userId, table.byteHash),
    index("listing_photos_user_perceptual_hash_idx").on(
      table.userId,
      table.perceptualHashVersion,
      table.perceptualHash
    ),
    check(
      "listing_photos_reference_required",
      sql`${table.sourceUrl} IS NOT NULL OR ${table.fixtureAssetLabel} IS NOT NULL`
    ),
    check("listing_photos_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "listing_photos_decoded_metadata_consistency",
      sql`num_nonnulls(${table.byteSize}, ${table.width}, ${table.height}, ${table.mimeType}) IN (0, 4)`
    ),
    check(
      "listing_photos_perceptual_version_consistency",
      sql`(${table.perceptualHash} IS NULL) = (${table.perceptualHashVersion} IS NULL)`
    )
  ]
);

export const fieldProvenance = pgTable(
  "field_provenance",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    listingSourceRecordId: text("listing_source_record_id").notNull(),
    rawListingId: text("raw_listing_id").notNull(),
    fieldPath: text("field_path").notNull(),
    extractionMethod: text("extraction_method").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    valueStatus: text("value_status").notNull().default("known"),
    unknownReason: text("unknown_reason"),
    observedAt: instant("observed_at").notNull(),
    evidenceExcerpt: text("evidence_excerpt")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "field_provenance_source_record_tenant_fk",
      columns: [table.userId, table.listingSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "field_provenance_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("field_provenance_user_source_field_unique").on(
      table.userId,
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
      sql`(${table.valueStatus} = 'known' AND ${table.unknownReason} IS NULL)
        OR (${table.valueStatus} = 'unknown' AND ${table.confidenceBasisPoints} = 0
          AND ${table.unknownReason} IN ('missing_evidence', 'unrecognized_format', 'not_applicable'))`
    )
  ]
);

export const approvals = pgTable(
  "approvals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    actor: text("actor").notNull(),
    connectorId: text("connector_id").notNull(),
    operation: text("operation").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    check("approvals_actor_user_only", sql`${table.actor} = 'user'`),
    check(
      "approvals_state_allowed",
      sql`${table.state} IN ('pending', 'used', 'expired', 'revoked')`
    ),
    check("approvals_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`)
  ]
);

export const normalizationJobs = pgTable(
  "normalization_jobs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    rawListingId: text("raw_listing_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    jobType: text("job_type").notNull().default("normalize_listing"),
    state: text("state").notNull(),
    availableAt: instant("available_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: instant("lease_expires_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorCategory: text("last_error_category"),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    completedAt: instant("completed_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "normalization_jobs_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("normalization_jobs_user_raw_listing_unique").on(table.userId, table.rawListingId),
    uniqueIndex("normalization_jobs_user_idempotency_key_unique").on(
      table.userId,
      table.idempotencyKey
    ),
    index("normalization_jobs_claim_idx").on(
      table.state,
      table.availableAt,
      table.createdAt,
      table.userId
    ),
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
      "normalization_jobs_lease_consistency",
      sql`(${table.state} = 'leased' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
        OR (${table.state} <> 'leased' AND ${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)`
    )
  ]
);

export const sourceJobs = pgTable(
  "source_jobs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    correlationId: text("correlation_id").notNull(),
    connectorId: text("connector_id").notNull(),
    source: text("source").notNull(),
    acquisitionMode: text("acquisition_mode").notNull(),
    manifestVersion: integer("manifest_version").notNull(),
    trigger: text("trigger").notNull(),
    capability: text("capability").notNull(),
    approvalId: text("approval_id"),
    operation: text("operation").notNull(),
    payload: jsonb("payload").$type<SourceJob["payload"]>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    manualAction: jsonb("manual_action").$type<SourceJob["manualAction"]>(),
    deferredReason: text("deferred_reason"),
    result: jsonb("result").$type<SourceJob["result"]>(),
    availableAt: instant("available_at").notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: instant("lease_expires_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    completedAt: instant("completed_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "source_jobs_approval_tenant_fk",
      columns: [table.userId, table.approvalId],
      foreignColumns: [approvals.userId, approvals.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("source_jobs_user_idempotency_key_unique").on(table.userId, table.idempotencyKey),
    index("source_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
      table.userId
    ),
    index("source_jobs_user_connector_idx").on(table.userId, table.connectorId, table.createdAt),
    check(
      "source_jobs_acquisition_mode_allowed",
      sql`${table.acquisitionMode} IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')`
    ),
    check("source_jobs_manifest_version_positive", sql`${table.manifestVersion} > 0`),
    check("source_jobs_trigger_allowed", sql`${table.trigger} IN ('manual', 'scheduled')`),
    check(
      "source_jobs_status_allowed",
      sql`${table.status} IN ('queued', 'dispatched', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')`
    ),
    check("source_jobs_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "source_jobs_attempts_valid",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attempts} <= ${table.maxAttempts}`
    )
  ]
);

export const sourceJobAttempts = pgTable(
  "source_job_attempts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: instant("started_at").notNull(),
    completedAt: instant("completed_at").notNull(),
    outcomeStatus: text("outcome_status").notNull(),
    error: jsonb("error").$type<JobAttempt["error"]>(),
    deferredReason: text("deferred_reason"),
    correlationId: text("correlation_id").notNull(),
    payloadHash: text("payload_hash").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "source_job_attempts_job_tenant_fk",
      columns: [table.userId, table.sourceJobId],
      foreignColumns: [sourceJobs.userId, sourceJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("source_job_attempts_user_job_number_unique").on(
      table.userId,
      table.sourceJobId,
      table.attemptNumber
    ),
    check("source_job_attempts_number_positive", sql`${table.attemptNumber} > 0`),
    check(
      "source_job_attempts_outcome_allowed",
      sql`${table.outcomeStatus} IN ('completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')`
    )
  ]
);

export const browserNodes = pgTable(
  "browser_nodes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    nodeId: text("node_id").notNull(),
    providerId: text("provider_id").notNull(),
    status: text("status").notNull(),
    lastHeartbeatAt: instant("last_heartbeat_at").notNull(),
    heartbeatExpiresAt: instant("heartbeat_expires_at").notNull(),
    contractVersion: integer("contract_version").notNull(),
    capabilities: jsonb("capabilities").$type<BrowserNodeStatus["capabilities"]>().notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.nodeId] }),
    index("browser_nodes_user_status_expiry_idx").on(
      table.userId,
      table.status,
      table.heartbeatExpiresAt
    ),
    check(
      "browser_nodes_status_allowed",
      sql`${table.status} IN ('online', 'offline', 'stale', 'revoked')`
    ),
    check("browser_nodes_contract_version_positive", sql`${table.contractVersion} > 0`)
  ]
);

export const listingExtractions = pgTable(
  "listing_extractions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    rawListingId: text("raw_listing_id").notNull(),
    listingSourceRecordId: text("listing_source_record_id").notNull(),
    mode: text("mode").notNull(),
    inputHash: text("input_hash").notNull(),
    requestedFields: jsonb("requested_fields")
      .$type<ListingExtractionRun["requestedFields"]>()
      .notNull(),
    providerId: text("provider_id"),
    model: text("model"),
    responseId: text("response_id"),
    promptVersion: text("prompt_version").notNull(),
    extractionVersion: text("extraction_version").notNull(),
    providerResult: jsonb("provider_result").$type<ListingExtractionRun["providerResult"]>(),
    mergedExtraction: jsonb("merged_extraction")
      .$type<ListingExtractionRun["mergedExtraction"]>()
      .notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    latencyMilliseconds: integer("latency_milliseconds").notNull(),
    repairCount: integer("repair_count").notNull(),
    completedAt: instant("completed_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "listing_extractions_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "listing_extractions_source_record_tenant_fk",
      columns: [table.userId, table.listingSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("listing_extractions_user_raw_listing_unique").on(table.userId, table.rawListingId),
    uniqueIndex("listing_extractions_user_source_record_unique").on(
      table.userId,
      table.listingSourceRecordId
    ),
    check(
      "listing_extractions_mode_allowed",
      sql`${table.mode} IN ('deterministic_only', 'llm_augmented')`
    ),
    check("listing_extractions_input_hash_valid", sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "listing_extractions_metrics_nonnegative",
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.totalTokens} >= 0
        AND ${table.latencyMilliseconds} >= 0`
    ),
    check(
      "listing_extractions_token_total_consistency",
      sql`${table.totalTokens} = ${table.inputTokens} + ${table.outputTokens}`
    ),
    check("listing_extractions_repair_range", sql`${table.repairCount} IN (0, 1)`),
    check(
      "listing_extractions_mode_metadata_consistency",
      sql`(${table.mode} = 'deterministic_only' AND ${table.providerId} IS NULL
          AND ${table.model} IS NULL AND ${table.responseId} IS NULL
          AND ${table.providerResult} IS NULL AND ${table.inputTokens} = 0
          AND ${table.outputTokens} = 0 AND ${table.totalTokens} = 0
          AND ${table.latencyMilliseconds} = 0 AND ${table.repairCount} = 0)
        OR (${table.mode} = 'llm_augmented' AND ${table.providerId} IS NOT NULL
          AND ${table.model} IS NOT NULL AND ${table.providerResult} IS NOT NULL)`
    )
  ]
);

export const decisionCorpusState = pgTable(
  "decision_corpus_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    searchProfileId: text("search_profile_id").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.searchProfileId] }),
    foreignKey({
      name: "decision_corpus_state_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("decision_corpus_state_revision_nonnegative", sql`${table.revision} >= 0`)
  ]
);

export const decisionJobs = pgTable(
  "decision_jobs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    searchProfileId: text("search_profile_id").notNull(),
    targetCorpusRevision: integer("target_corpus_revision").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    inputHash: text("input_hash"),
    outputHash: text("output_hash"),
    attemptCount: integer("attempt_count").notNull(),
    availableAt: instant("available_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: instant("lease_expires_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    completedAt: instant("completed_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "decision_jobs_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("decision_jobs_user_profile_revision_unique").on(
      table.userId,
      table.searchProfileId,
      table.targetCorpusRevision
    ),
    index("decision_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
      table.userId
    ),
    check("decision_jobs_revision_nonnegative", sql`${table.targetCorpusRevision} >= 0`),
    check(
      "decision_jobs_trigger_allowed",
      sql`${table.trigger} IN ('normalization', 'manual_recompute', 'seed')`
    ),
    check(
      "decision_jobs_status_allowed",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'retryable_failed', 'permanently_failed', 'cancelled')`
    ),
    check("decision_jobs_attempt_count_valid", sql`${table.attemptCount} BETWEEN 0 AND 100`),
    check(
      "decision_jobs_lease_pair",
      sql`(${table.leaseOwner} IS NULL) = (${table.leaseExpiresAt} IS NULL)`
    )
  ]
);

export const decisionJobAttempts = pgTable(
  "decision_job_attempts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    jobId: text("job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: instant("started_at").notNull(),
    finishedAt: instant("finished_at"),
    outcome: text("outcome"),
    errorCode: text("error_code"),
    durationMilliseconds: integer("duration_milliseconds")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "decision_job_attempts_job_tenant_fk",
      columns: [table.userId, table.jobId],
      foreignColumns: [decisionJobs.userId, decisionJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("decision_job_attempts_user_job_number_unique").on(
      table.userId,
      table.jobId,
      table.attemptNumber
    ),
    check("decision_job_attempts_number_positive", sql`${table.attemptNumber} > 0`),
    check(
      "decision_job_attempts_outcome_allowed",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('succeeded', 'retryable_failed', 'permanently_failed', 'cancelled', 'lease_lost')`
    )
  ]
);

export const decisionRuns = pgTable(
  "decision_runs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    jobId: text("job_id").notNull(),
    searchProfileId: text("search_profile_id").notNull(),
    corpusRevision: integer("corpus_revision").notNull(),
    planVersion: text("plan_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    counts: jsonb("counts_json").$type<JsonObject>().notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "decision_runs_job_tenant_fk",
      columns: [table.userId, table.jobId],
      foreignColumns: [decisionJobs.userId, decisionJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "decision_runs_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("decision_runs_user_job_unique").on(table.userId, table.jobId),
    uniqueIndex("decision_runs_user_profile_revision_input_unique").on(
      table.userId,
      table.searchProfileId,
      table.corpusRevision,
      table.inputHash
    ),
    index("decision_runs_user_profile_revision_idx").on(
      table.userId,
      table.searchProfileId,
      table.corpusRevision
    ),
    check("decision_runs_revision_nonnegative", sql`${table.corpusRevision} >= 0`),
    check("decision_runs_input_hash_valid", sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
    check("decision_runs_output_hash_valid", sql`${table.outputHash} ~ '^[a-f0-9]{64}$'`)
  ]
);

export const duplicatePairEvaluations = pgTable(
  "duplicate_pair_evaluations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    decisionRunId: text("decision_run_id").notNull(),
    leftSourceRecordId: text("left_source_record_id").notNull(),
    rightSourceRecordId: text("right_source_record_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    inputHash: text("input_hash").notNull(),
    decision: text("decision").notNull(),
    scoreBasisPoints: integer("score_basis_points"),
    automaticLinkThresholdBasisPoints: integer("automatic_link_threshold_basis_points").notNull(),
    reviewThresholdBasisPoints: integer("review_threshold_basis_points").notNull(),
    exactReasonCodes: jsonb("exact_reason_codes")
      .$type<DuplicatePairEvaluation["exactReasonCodes"]>()
      .notNull(),
    conflictReasonCodes: jsonb("conflict_reason_codes")
      .$type<DuplicatePairEvaluation["conflictReasonCodes"]>()
      .notNull(),
    contactMatched: boolean("contact_matched").notNull(),
    features: jsonb("features_json").$type<DuplicatePairEvaluation["features"]>().notNull(),
    evaluatedAt: instant("evaluated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "duplicate_pair_evaluations_run_tenant_fk",
      columns: [table.userId, table.decisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "duplicate_pair_evaluations_left_tenant_fk",
      columns: [table.userId, table.leftSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "duplicate_pair_evaluations_right_tenant_fk",
      columns: [table.userId, table.rightSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("duplicate_pair_evaluations_user_run_pair_unique").on(
      table.userId,
      table.decisionRunId,
      table.leftSourceRecordId,
      table.rightSourceRecordId
    ),
    check(
      "duplicate_pair_evaluations_ordered_pair",
      sql`${table.leftSourceRecordId} < ${table.rightSourceRecordId}`
    ),
    check(
      "duplicate_pair_evaluations_decision_allowed",
      sql`${table.decision} IN ('link', 'review', 'separate')`
    )
  ]
);

export const duplicateOverrides = pgTable(
  "duplicate_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    searchProfileId: text("search_profile_id").notNull(),
    kind: text("kind").notNull(),
    sourceRecordIds: jsonb("source_record_ids_json")
      .$type<DuplicateOverride["sourceRecordIds"]>()
      .notNull(),
    survivorCanonicalId: text("survivor_canonical_id"),
    reason: text("reason"),
    createdBy: text("created_by").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "duplicate_overrides_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("duplicate_overrides_user_profile_created_idx").on(
      table.userId,
      table.searchProfileId,
      table.createdAt
    ),
    check("duplicate_overrides_kind_allowed", sql`${table.kind} IN ('force_merge', 'force_split')`),
    check("duplicate_overrides_actor_allowed", sql`${table.createdBy} IN ('user', 'system')`),
    check("duplicate_overrides_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`)
  ]
);

export const duplicateOverrideRevocations = pgTable(
  "duplicate_override_revocations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    overrideId: text("override_id").notNull(),
    reason: text("reason"),
    createdBy: text("created_by").notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "duplicate_override_revocations_override_tenant_fk",
      columns: [table.userId, table.overrideId],
      foreignColumns: [duplicateOverrides.userId, duplicateOverrides.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("duplicate_override_revocations_user_override_unique").on(
      table.userId,
      table.overrideId
    ),
    check(
      "duplicate_override_revocations_actor_allowed",
      sql`${table.createdBy} IN ('user', 'system')`
    )
  ]
);

export const duplicateClusters = pgTable(
  "duplicate_clusters",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    searchProfileId: text("search_profile_id").notNull(),
    clusterKey: text("cluster_key").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    configVersion: text("config_version").notNull().default("legacy"),
    projectionState: text("projection_state").notNull().default("active"),
    updatedByDecisionRunId: text("updated_by_decision_run_id"),
    reasonCodes: jsonb("reason_codes").$type<DuplicateCluster["reasonCodes"]>().notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "duplicate_clusters_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "duplicate_clusters_decision_run_tenant_fk",
      columns: [table.userId, table.updatedByDecisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("duplicate_clusters_user_key_unique").on(table.userId, table.clusterKey),
    index("duplicate_clusters_user_projection_idx").on(
      table.userId,
      table.projectionState,
      table.id
    ),
    check(
      "duplicate_clusters_projection_allowed",
      sql`${table.projectionState} IN ('active', 'superseded')`
    )
  ]
);

export const canonicalListings = pgTable(
  "canonical_listings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    searchProfileId: text("search_profile_id").notNull(),
    duplicateClusterId: text("duplicate_cluster_id"),
    primarySourceRecordId: text("primary_source_record_id").notNull(),
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
    availableOn: calendarDate("available_on"),
    leaseTermMonths: integer("lease_term_months"),
    petPolicy: jsonb("pet_policy").$type<CanonicalListing["petPolicy"]>(),
    amenities: jsonb("amenities").$type<CanonicalListing["amenities"]>().notNull(),
    description: text("description"),
    lifecycleState: text("lifecycle_state").notNull(),
    projectionState: text("projection_state").notNull().default("active"),
    supersededById: text("superseded_by_id"),
    stitchVersion: text("stitch_version"),
    stitchInputHash: text("stitch_input_hash"),
    updatedByDecisionRunId: text("updated_by_decision_run_id"),
    completenessBasisPoints: integer("completeness_basis_points").notNull(),
    freshestObservedAt: instant("freshest_observed_at").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "canonical_listings_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_listings_cluster_tenant_fk",
      columns: [table.userId, table.duplicateClusterId],
      foreignColumns: [duplicateClusters.userId, duplicateClusters.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_listings_primary_source_tenant_fk",
      columns: [table.userId, table.primarySourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_listings_decision_run_tenant_fk",
      columns: [table.userId, table.updatedByDecisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("canonical_listings_user_duplicate_cluster_unique").on(
      table.userId,
      table.duplicateClusterId
    ),
    index("canonical_listings_user_projection_idx").on(
      table.userId,
      table.projectionState,
      table.freshestObservedAt
    ),
    check(
      "canonical_listings_lifecycle_allowed",
      sql`${table.lifecycleState} IN ('new', 'shortlisted', 'draft_ready', 'draft_created', 'draft_rejected', 'replied', 'follow_up_due', 'tour_proposed', 'tour_scheduled', 'toured', 'applying', 'passed', 'dismissed', 'stale', 'unavailable')`
    ),
    check(
      "canonical_listings_completeness_range",
      sql`${table.completenessBasisPoints} BETWEEN 0 AND 10000`
    ),
    check(
      "canonical_listings_money_nonnegative",
      sql`(${table.monthlyRentCents} IS NULL OR ${table.monthlyRentCents} >= 0)
        AND (${table.recurringFeesCents} IS NULL OR ${table.recurringFeesCents} >= 0)`
    ),
    check(
      "canonical_listings_projection_allowed",
      sql`${table.projectionState} IN ('active', 'superseded')`
    ),
    check(
      "canonical_listings_projection_redirect_consistency",
      sql`(${table.projectionState} = 'active' AND ${table.supersededById} IS NULL)
        OR (${table.projectionState} = 'superseded' AND ${table.supersededById} IS NOT NULL)`
    ),
    check(
      "canonical_listings_stitch_pair",
      sql`(${table.stitchVersion} IS NULL) = (${table.stitchInputHash} IS NULL)`
    )
  ]
);

export const canonicalDecisionRuns = pgTable(
  "canonical_decision_runs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    decisionRunId: text("decision_run_id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    clusterId: text("cluster_id"),
    primarySourceRecordId: text("primary_source_record_id").notNull(),
    stitchVersion: text("stitch_version").notNull(),
    stitchInputHash: text("stitch_input_hash").notNull(),
    memberSourceRecordIds: jsonb("member_source_record_ids_json")
      .$type<CanonicalListingPlan["memberSourceRecordIds"]>()
      .notNull(),
    selectedFields: jsonb("selected_fields_json")
      .$type<CanonicalListingPlan["selectedFields"]>()
      .notNull(),
    diagnostics: jsonb("diagnostics_json").$type<JsonValue>().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "canonical_decision_runs_run_tenant_fk",
      columns: [table.userId, table.decisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_decision_runs_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_decision_runs_primary_source_tenant_fk",
      columns: [table.userId, table.primarySourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("canonical_decision_runs_user_run_listing_unique").on(
      table.userId,
      table.decisionRunId,
      table.canonicalListingId
    ),
    check(
      "canonical_decision_runs_stitch_hash_valid",
      sql`${table.stitchInputHash} ~ '^[a-f0-9]{64}$'`
    )
  ]
);

export const canonicalListingSources = pgTable(
  "canonical_listing_sources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    canonicalListingId: text("canonical_listing_id").notNull(),
    listingSourceRecordId: text("listing_source_record_id").notNull(),
    isPrimary: boolean("is_primary").notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.canonicalListingId, table.listingSourceRecordId]
    }),
    foreignKey({
      name: "canonical_listing_sources_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_listing_sources_source_tenant_fk",
      columns: [table.userId, table.listingSourceRecordId],
      foreignColumns: [listingSourceRecords.userId, listingSourceRecords.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("canonical_listing_sources_user_source_unique").on(
      table.userId,
      table.listingSourceRecordId
    )
  ]
);

export const canonicalFieldSources = pgTable(
  "canonical_field_sources",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    canonicalListingId: text("canonical_listing_id").notNull(),
    fieldPath: text("field_path").notNull(),
    fieldProvenanceId: text("field_provenance_id").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.canonicalListingId, table.fieldPath] }),
    foreignKey({
      name: "canonical_field_sources_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "canonical_field_sources_provenance_tenant_fk",
      columns: [table.userId, table.fieldProvenanceId],
      foreignColumns: [fieldProvenance.userId, fieldProvenance.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("canonical_field_sources_user_provenance_idx").on(table.userId, table.fieldProvenanceId)
  ]
);

export const listingScores = pgTable(
  "listing_scores",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    searchProfileId: text("search_profile_id"),
    algorithmVersion: text("algorithm_version").notNull(),
    inputHash: text("input_hash").notNull(),
    totalScoreBasisPoints: integer("total_score_basis_points").notNull(),
    factors: jsonb("factors").$type<ListingScore["factors"]>().notNull(),
    reasonCodes: jsonb("reason_codes").$type<ListingScore["reasonCodes"]>().notNull(),
    computedAt: instant("computed_at").notNull(),
    schemaVersion: text("schema_version").notNull().default("listing-score.v1"),
    decisionRunId: text("decision_run_id"),
    eligible: boolean("eligible"),
    hardConstraintsV2: jsonb("hard_constraints_v2").$type<
      ListingScoreV2["hardConstraints"] | null
    >(),
    factorsV2: jsonb("factors_v2").$type<ListingScoreV2["factors"] | null>(),
    baseScoreBasisPoints: integer("base_score_basis_points"),
    stalePenaltyBasisPoints: integer("stale_penalty_basis_points"),
    lowConfidencePenaltyBasisPoints: integer("low_confidence_penalty_basis_points"),
    riskPenaltyBasisPoints: integer("risk_penalty_basis_points"),
    finalScoreBasisPoints: integer("final_score_basis_points"),
    explanation: text("explanation")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "listing_scores_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "listing_scores_profile_tenant_fk",
      columns: [table.userId, table.searchProfileId],
      foreignColumns: [searchProfiles.userId, searchProfiles.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "listing_scores_run_tenant_fk",
      columns: [table.userId, table.decisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("listing_scores_user_snapshot_unique").on(
      table.userId,
      table.canonicalListingId,
      table.searchProfileId,
      table.algorithmVersion,
      table.inputHash
    ),
    index("listing_scores_user_current_run_idx").on(
      table.userId,
      table.decisionRunId,
      table.canonicalListingId
    ),
    check(
      "listing_scores_total_range",
      sql`${table.totalScoreBasisPoints} BETWEEN -10000 AND 10000`
    ),
    check("listing_scores_input_hash_valid", sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "listing_scores_v2_ranges",
      sql`(${table.baseScoreBasisPoints} IS NULL OR ${table.baseScoreBasisPoints} BETWEEN 0 AND 10000)
        AND (${table.stalePenaltyBasisPoints} IS NULL OR ${table.stalePenaltyBasisPoints} BETWEEN 0 AND 10000)
        AND (${table.lowConfidencePenaltyBasisPoints} IS NULL OR ${table.lowConfidencePenaltyBasisPoints} BETWEEN 0 AND 10000)
        AND (${table.riskPenaltyBasisPoints} IS NULL OR ${table.riskPenaltyBasisPoints} BETWEEN 0 AND 10000)
        AND (${table.finalScoreBasisPoints} IS NULL OR ${table.finalScoreBasisPoints} BETWEEN 0 AND 10000)`
    )
  ]
);

export const riskSignals = pgTable(
  "risk_signals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    code: text("code").notNull(),
    severity: text("severity").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    evidence: jsonb("evidence").$type<RiskSignal["evidence"]>().notNull(),
    verificationAction: text("verification_action").notNull(),
    status: text("status").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    schemaVersion: text("schema_version").notNull().default("listing-risk.v1"),
    decisionRunId: text("decision_run_id"),
    algorithmVersion: text("algorithm_version"),
    inputHash: text("input_hash"),
    idempotencyKey: text("idempotency_key"),
    evidenceV2: jsonb("evidence_v2").$type<RiskSignalV2["evidence"] | null>(),
    needsVerification: boolean("needs_verification").notNull().default(true),
    evaluatedAt: instant("evaluated_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "risk_signals_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "risk_signals_run_tenant_fk",
      columns: [table.userId, table.decisionRunId],
      foreignColumns: [decisionRuns.userId, decisionRuns.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("risk_signals_user_listing_code_idx").on(
      table.userId,
      table.canonicalListingId,
      table.code
    ),
    uniqueIndex("risk_signals_user_idempotency_key_unique").on(table.userId, table.idempotencyKey),
    check("risk_signals_confidence_range", sql`${table.confidenceBasisPoints} BETWEEN 0 AND 10000`),
    check(
      "risk_signals_severity_allowed",
      sql`${table.severity} IN ('info', 'low', 'medium', 'high')`
    ),
    check("risk_signals_status_allowed", sql`${table.status} IN ('open', 'verified', 'dismissed')`)
  ]
);

export const contactWorkflows = pgTable(
  "contact_workflows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    channel: text("channel").notNull(),
    recipientReference: text("recipient_reference"),
    missingFactQuestions: jsonb("missing_fact_questions")
      .$type<ContactWorkflow["missingFactQuestions"]>()
      .notNull(),
    draftReference: text("draft_reference"),
    state: text("state").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "contact_workflows_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("contact_workflows_user_listing_unique").on(table.userId, table.canonicalListingId),
    check(
      "contact_workflows_state_allowed",
      sql`${table.state} IN ('not_started', 'questions_ready', 'draft_ready', 'draft_created', 'reply_received', 'closed')`
    )
  ]
);

export const viewings = pgTable(
  "viewings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    proposedWindows: jsonb("proposed_windows").$type<Viewing["proposedWindows"]>().notNull(),
    confirmedWindow: jsonb("confirmed_window").$type<Viewing["confirmedWindow"]>(),
    timeZone: text("time_zone").notNull(),
    calendarReference: text("calendar_reference"),
    state: text("state").notNull(),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Viewing["metadata"]>().notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "viewings_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "viewings_state_allowed",
      sql`${table.state} IN ('proposed', 'selected', 'hold_approved', 'hold_created', 'confirmed', 'completed', 'cancelled')`
    )
  ]
);

export const activityEvents = pgTable(
  "activity_events",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    policyDecision: text("policy_decision").notNull(),
    approvalId: text("approval_id"),
    payloadHash: text("payload_hash").notNull(),
    outcome: text("outcome").notNull(),
    errorCategory: text("error_category"),
    metadata: jsonb("metadata").$type<ActivityEvent["metadata"]>().notNull(),
    occurredAt: instant("occurred_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "activity_events_approval_tenant_fk",
      columns: [table.userId, table.approvalId],
      foreignColumns: [approvals.userId, approvals.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("activity_events_user_correlation_idx").on(
      table.userId,
      table.correlationId,
      table.occurredAt
    ),
    check("activity_events_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
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

export const sourcePolicyManifests = pgTable(
  "source_policy_manifests",
  {
    schemaVersion: integer("schema_version").notNull().default(2),
    connectorId: text("connector_id").notNull(),
    displayName: text("display_name").notNull().default("Sanitized source label"),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    acquisitionMode: text("acquisition_mode").notNull(),
    policyState: text("policy_state").notNull(),
    enabled: boolean("enabled").notNull(),
    execution: text("execution").notNull(),
    capabilities: jsonb("capabilities").$type<SourcePolicyManifest["capabilities"]>().notNull(),
    allowedOperations: jsonb("allowed_operations")
      .$type<SourcePolicyManifest["allowedOperations"]>()
      .notNull()
      .default([]),
    allowedDomains: jsonb("allowed_domains")
      .$type<SourcePolicyManifest["allowedDomains"]>()
      .notNull(),
    allowedOrigins: jsonb("allowed_origins")
      .$type<SourcePolicyManifest["allowedOrigins"]>()
      .notNull()
      .default([]),
    allowedHttpMethods: jsonb("allowed_http_methods")
      .$type<SourcePolicyManifest["allowedHttpMethods"]>()
      .notNull()
      .default([]),
    requiresUserSession: boolean("requires_user_session").notNull(),
    requiresApproval: boolean("requires_approval").notNull(),
    minimumIntervalSeconds: integer("minimum_interval_seconds"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    globalKillSwitchKey: text("global_kill_switch_key").notNull().default("integrations.disabled"),
    connectorKillSwitchKey: text("connector_kill_switch_key")
      .notNull()
      .default("integrations.legacy_source_labels"),
    dataClassification: text("data_classification").notNull().default("synthetic"),
    redactionRules: jsonb("redaction_rules")
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
    reviewedAt: calendarDate("reviewed_at").notNull().default("2026-07-17"),
    decisionRecord: text("decision_record")
      .notNull()
      .default("docs/DECISIONS/0004-fail-closed-connectors.md"),
    notes: text("notes").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.connectorId, table.version] }),
    check("source_policy_manifests_version_positive", sql`${table.version} > 0`),
    check("source_policy_manifests_schema_version_supported", sql`${table.schemaVersion} = 2`),
    check(
      "source_policy_manifests_acquisition_mode_allowed",
      sql`${table.acquisitionMode} IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')`
    ),
    check(
      "source_policy_manifests_policy_state_allowed",
      sql`${table.policyState} IN ('approved', 'user_triggered_only', 'experimental_personal', 'disabled')`
    ),
    check(
      "source_policy_manifests_execution_allowed",
      sql`${table.execution} IN ('manual', 'scheduled')`
    ),
    check(
      "source_policy_manifests_scheduling_consistency",
      sql`${table.execution} <> 'scheduled' OR ${table.minimumIntervalSeconds} IS NOT NULL`
    ),
    check(
      "source_policy_manifests_disabled_consistency",
      sql`${table.policyState} <> 'disabled' OR ${table.enabled} = false`
    ),
    check(
      "source_policy_manifests_user_triggered_consistency",
      sql`${table.policyState} <> 'user_triggered_only' OR ${table.execution} = 'manual'`
    ),
    check(
      "source_policy_manifests_experimental_consistency",
      sql`${table.policyState} <> 'experimental_personal' OR ${table.acquisitionMode} = 'local_browser'`
    ),
    check("source_policy_manifests_concurrency_positive", sql`${table.maxConcurrency} > 0`)
  ]
);

export const schema = {
  accounts,
  activityEvents,
  approvals,
  browserNodes,
  canonicalDecisionRuns,
  canonicalFieldSources,
  canonicalListingSources,
  canonicalListings,
  contactWorkflows,
  decisionCorpusState,
  decisionJobAttempts,
  decisionJobs,
  decisionRuns,
  duplicateClusters,
  duplicateOverrideRevocations,
  duplicateOverrides,
  duplicatePairEvaluations,
  fieldProvenance,
  integrationConnections,
  listingExtractions,
  listingPhotos,
  listingScores,
  listingSourceRecords,
  normalizationJobs,
  rawListings,
  riskSignals,
  searchProfiles,
  sessions,
  sourceJobAttempts,
  sourceJobs,
  sourcePolicyManifests,
  users,
  verifications,
  viewings
};
