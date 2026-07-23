import type {
  ActivityEvent,
  AvailabilityCheck,
  AvailabilityRuleSet,
  BrowserNodeStatus,
  CalendarOAuthState,
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
  NotificationPayload,
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
    uniqueIndex("integration_connections_user_provider_unique").on(table.userId, table.provider),
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

export const integrationRefreshLeases = pgTable(
  "integration_refresh_leases",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    integrationId: uuid("integration_id").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    leaseExpiresAt: instant("lease_expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.integrationId] }),
    foreignKey({
      name: "integration_refresh_leases_connection_tenant_fk",
      columns: [table.userId, table.integrationId],
      foreignColumns: [integrationConnections.userId, integrationConnections.id]
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    index("integration_refresh_leases_expiry_idx").on(
      table.leaseExpiresAt,
      table.userId,
      table.integrationId
    ),
    check(
      "integration_refresh_leases_owner_valid",
      sql`${table.leaseOwner} ~ '^[A-Za-z0-9._:-]{1,160}$'`
    ),
    check(
      "integration_refresh_leases_expiry_order",
      sql`${table.leaseExpiresAt} > ${table.updatedAt}`
    )
  ]
);

export const availabilityRuleSets = pgTable(
  "availability_rule_sets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    timeZone: text("time_zone").notNull(),
    weeklyIntervals: jsonb("weekly_intervals")
      .$type<AvailabilityRuleSet["weeklyIntervals"]>()
      .notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    minimumNoticeMinutes: integer("minimum_notice_minutes").notNull(),
    travelMinutes: integer("travel_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
    remindersMinutesBeforeStart: jsonb("reminders_minutes_before_start")
      .$type<AvailabilityRuleSet["remindersMinutesBeforeStart"]>()
      .notNull(),
    conflictCheckingEnabled: boolean("conflict_checking_enabled").notNull(),
    selectedCalendarIds: jsonb("selected_calendar_ids")
      .$type<AvailabilityRuleSet["calendarIds"]>()
      .notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("availability_rule_sets_user_unique").on(table.userId),
    check("availability_rule_sets_schema_version", sql`${table.schemaVersion} = 1`),
    check(
      "availability_rule_sets_duration_range",
      sql`${table.durationMinutes} BETWEEN 15 AND 240`
    ),
    check(
      "availability_rule_sets_notice_range",
      sql`${table.minimumNoticeMinutes} BETWEEN 0 AND 10080`
    ),
    check("availability_rule_sets_travel_range", sql`${table.travelMinutes} BETWEEN 0 AND 240`),
    check("availability_rule_sets_buffer_range", sql`${table.bufferMinutes} BETWEEN 0 AND 240`),
    check(
      "availability_rule_sets_weekly_intervals_object",
      sql`jsonb_typeof(${table.weeklyIntervals}) = 'object'`
    ),
    check(
      "availability_rule_sets_reminders_array",
      sql`jsonb_typeof(${table.remindersMinutesBeforeStart}) = 'array'
        AND jsonb_array_length(${table.remindersMinutesBeforeStart}) <= 5`
    ),
    check(
      "availability_rule_sets_calendar_ids_consistency",
      sql`jsonb_typeof(${table.selectedCalendarIds}) = 'array'
        AND ((${table.conflictCheckingEnabled} = true
              AND ${table.selectedCalendarIds} = '["primary"]'::jsonb)
          OR (${table.conflictCheckingEnabled} = false
              AND ${table.selectedCalendarIds} = '[]'::jsonb))`
    ),
    check("availability_rule_sets_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const calendarOauthStates = pgTable(
  "calendar_oauth_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: uuid("id").notNull().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    capability: text("capability").notNull(),
    requestedCalendarScopes: jsonb("requested_calendar_scopes")
      .$type<CalendarOAuthState["requestedCalendarScopes"]>()
      .notNull(),
    credentialVersion: integer("credential_version"),
    credentialAlgorithm: text("credential_algorithm"),
    credentialKeyId: text("credential_key_id"),
    credentialNonce: bytea("credential_nonce"),
    credentialCiphertext: bytea("credential_ciphertext"),
    credentialAuthenticationTag: bytea("credential_authentication_tag"),
    redirectUriHash: text("redirect_uri_hash").notNull(),
    returnTo: text("return_to").notNull(),
    expiresAt: instant("expires_at").notNull(),
    consumedAt: instant("consumed_at"),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("calendar_oauth_states_state_hash_unique").on(table.stateHash),
    check(
      "calendar_oauth_states_capability_allowed",
      sql`${table.capability} IN ('calendar_conflict_checking', 'calendar_hold_creation')`
    ),
    check(
      "calendar_oauth_states_scope_consistency",
      sql`(${table.capability} = 'calendar_conflict_checking'
            AND ${table.requestedCalendarScopes} = '["https://www.googleapis.com/auth/calendar.freebusy"]'::jsonb)
        OR (${table.capability} = 'calendar_hold_creation'
            AND ${table.requestedCalendarScopes} = '["https://www.googleapis.com/auth/calendar.events.owned"]'::jsonb)`
    ),
    check(
      "calendar_oauth_states_verifier_all_or_none",
      sql`num_nonnulls(${table.credentialVersion}, ${table.credentialAlgorithm}, ${table.credentialKeyId}, ${table.credentialNonce}, ${table.credentialCiphertext}, ${table.credentialAuthenticationTag}) IN (0, 6)`
    ),
    check(
      "calendar_oauth_states_encrypted_verifier_required",
      sql`${table.credentialCiphertext} IS NOT NULL`
    ),
    check("calendar_oauth_states_state_hash_valid", sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "calendar_oauth_states_redirect_hash_valid",
      sql`${table.redirectUriHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "calendar_oauth_states_timestamp_order",
      sql`${table.expiresAt} > ${table.createdAt}
        AND (${table.consumedAt} IS NULL
          OR (${table.consumedAt} >= ${table.createdAt} AND ${table.consumedAt} <= ${table.expiresAt}))`
    )
  ]
);

export const availabilityChecks = pgTable(
  "availability_checks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    availabilityRuleSetId: text("availability_rule_set_id").notNull(),
    integrationConnectionId: uuid("integration_connection_id"),
    state: text("state").notNull(),
    rangeStartsAt: instant("range_starts_at").notNull(),
    rangeEndsAt: instant("range_ends_at").notNull(),
    calendarIdsAttempted: jsonb("calendar_ids_attempted")
      .$type<AvailabilityCheck["calendarIdsAttempted"]>()
      .notNull(),
    calendarsChecked: jsonb("calendars_checked")
      .$type<AvailabilityCheck["calendarsChecked"]>()
      .notNull(),
    checkedAt: instant("checked_at"),
    responseHash: text("response_hash"),
    busyIntervalCount: integer("busy_interval_count"),
    safeProviderErrorCode: text("safe_provider_error_code"),
    correlationId: text("correlation_id").notNull(),
    createdAt: instant("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "availability_checks_rule_set_tenant_fk",
      columns: [table.userId, table.availabilityRuleSetId],
      foreignColumns: [availabilityRuleSets.userId, availabilityRuleSets.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "availability_checks_integration_tenant_fk",
      columns: [table.userId, table.integrationConnectionId],
      foreignColumns: [integrationConnections.userId, integrationConnections.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("availability_checks_user_created_idx").on(table.userId, table.createdAt),
    check(
      "availability_checks_state_allowed",
      sql`${table.state} IN ('checked', 'scope_not_granted', 'google_disconnected', 'google_temporarily_unavailable', 'vera_rules_only')`
    ),
    check("availability_checks_range_order", sql`${table.rangeEndsAt} > ${table.rangeStartsAt}`),
    check(
      "availability_checks_busy_count_nonnegative",
      sql`${table.busyIntervalCount} IS NULL OR ${table.busyIntervalCount} >= 0`
    ),
    check(
      "availability_checks_response_hash_valid",
      sql`${table.responseHash} IS NULL OR ${table.responseHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "availability_checks_state_matrix",
      sql`(${table.state} = 'checked'
          AND ${table.calendarIdsAttempted} = '["primary"]'::jsonb
          AND ${table.calendarsChecked} = '["primary"]'::jsonb
          AND ${table.checkedAt} IS NOT NULL
          AND ${table.responseHash} IS NOT NULL
          AND ${table.busyIntervalCount} IS NOT NULL
          AND ${table.safeProviderErrorCode} IS NULL)
        OR (${table.state} = 'google_temporarily_unavailable'
          AND ${table.calendarIdsAttempted} IN ('[]'::jsonb, '["primary"]'::jsonb)
          AND ${table.calendarsChecked} = '[]'::jsonb
          AND ${table.checkedAt} IS NULL
          AND ${table.responseHash} IS NULL
          AND ${table.busyIntervalCount} IS NULL
          AND ${table.safeProviderErrorCode} IS NOT NULL)
        OR (${table.state} IN ('scope_not_granted', 'google_disconnected', 'vera_rules_only')
          AND ${table.calendarIdsAttempted} = '[]'::jsonb
          AND ${table.calendarsChecked} = '[]'::jsonb
          AND ${table.checkedAt} IS NULL
          AND ${table.responseHash} IS NULL
          AND ${table.busyIntervalCount} IS NULL
          AND ${table.safeProviderErrorCode} IS NULL)`
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
    browserNodeId: text("browser_node_id"),
    browserProfileId: text("browser_profile_id"),
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
    foreignKey({
      name: "source_jobs_browser_node_tenant_fk",
      columns: [table.userId, table.browserNodeId],
      foreignColumns: [browserNodes.userId, browserNodes.nodeId]
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
      "source_jobs_browser_target_consistency",
      sql`(${table.browserNodeId} IS NULL AND ${table.browserProfileId} IS NULL)
        OR (${table.acquisitionMode} = 'local_browser'
          AND ${table.browserNodeId} IS NOT NULL
          AND ${table.browserProfileId} IS NOT NULL)`
    ),
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
    nodeName: text("node_name").notNull().default("Unnamed browser node"),
    status: text("status").notNull(),
    pairingState: text("pairing_state").notNull().default("not_paired"),
    capabilityApprovalState: text("capability_approval_state").notNull().default("not_approved"),
    selectedProfileId: text("selected_profile_id"),
    allowedProfileIds: jsonb("allowed_profile_ids")
      .$type<BrowserNodeStatus["allowedProfileIds"]>()
      .notNull()
      .default([]),
    reportedOpenClawVersion: text("reported_openclaw_version"),
    expectedOpenClawVersion: text("expected_openclaw_version").notNull().default("2026.6.33"),
    versionCompatibility: text("version_compatibility").notNull().default("unknown"),
    lastHeartbeatAt: instant("last_heartbeat_at").notNull(),
    heartbeatExpiresAt: instant("heartbeat_expires_at").notNull(),
    lastSuccessfulCaptureAt: instant("last_successful_capture_at"),
    disabledAt: instant("disabled_at"),
    contractVersion: integer("contract_version").notNull(),
    capabilities: jsonb("capabilities").$type<BrowserNodeStatus["capabilities"]>().notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
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
    check(
      "browser_nodes_pairing_state_allowed",
      sql`${table.pairingState} IN ('not_paired', 'pairing_pending', 'paired', 'revoked')`
    ),
    check(
      "browser_nodes_capability_state_allowed",
      sql`${table.capabilityApprovalState} IN ('not_approved', 'approval_pending', 'approved', 'revoked')`
    ),
    check(
      "browser_nodes_version_compatibility_allowed",
      sql`${table.versionCompatibility} IN ('unknown', 'compatible', 'incompatible')`
    ),
    check(
      "browser_nodes_expected_version_pinned",
      sql`${table.expectedOpenClawVersion} = '2026.6.33'`
    ),
    check(
      "browser_nodes_selected_profile_allowlisted",
      sql`${table.selectedProfileId} IS NULL OR ${table.allowedProfileIds} @> jsonb_build_array(${table.selectedProfileId})`
    ),
    check("browser_nodes_contract_version_positive", sql`${table.contractVersion} > 0`)
  ]
);

export const browserUserControls = pgTable("browser_user_controls", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: instant("updated_at").notNull()
});

export const browserSourceControls = pgTable(
  "browser_source_controls",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    connectorId: text("connector_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.connectorId] })]
);

export const browserProfileControls = pgTable(
  "browser_profile_controls",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    nodeId: text("node_id").notNull(),
    profileId: text("profile_id").notNull(),
    disabledAt: instant("disabled_at"),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.nodeId, table.profileId] }),
    foreignKey({
      name: "browser_profile_controls_node_tenant_fk",
      columns: [table.userId, table.nodeId],
      foreignColumns: [browserNodes.userId, browserNodes.nodeId]
    })
      .onDelete("cascade")
      .onUpdate("restrict")
  ]
);

export const browserCaptureAcceptances = pgTable(
  "browser_capture_acceptances",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    nodeId: text("node_id").notNull(),
    profileId: text("profile_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    invocationIdempotencyKey: text("invocation_idempotency_key").notNull(),
    resultHash: text("result_hash").notNull(),
    contentHash: text("content_hash").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    rawListingId: text("raw_listing_id").notNull(),
    acceptedAt: instant("accepted_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("browser_capture_acceptances_user_job_unique").on(table.userId, table.sourceJobId),
    uniqueIndex("browser_capture_acceptances_user_invocation_unique").on(
      table.userId,
      table.invocationIdempotencyKey
    ),
    foreignKey({
      name: "browser_capture_acceptances_job_tenant_fk",
      columns: [table.userId, table.sourceJobId],
      foreignColumns: [sourceJobs.userId, sourceJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "browser_capture_acceptances_attempt_tenant_fk",
      columns: [table.userId, table.attemptId],
      foreignColumns: [sourceJobAttempts.userId, sourceJobAttempts.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "browser_capture_acceptances_profile_tenant_fk",
      columns: [table.userId, table.nodeId, table.profileId],
      foreignColumns: [
        browserProfileControls.userId,
        browserProfileControls.nodeId,
        browserProfileControls.profileId
      ]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "browser_capture_acceptances_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "browser_capture_acceptances_payload_hash_valid",
      sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "browser_capture_acceptances_invocation_hash_valid",
      sql`${table.invocationIdempotencyKey} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "browser_capture_acceptances_result_hash_valid",
      sql`${table.resultHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "browser_capture_acceptances_content_hash_valid",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`
    )
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
    selectedWindow: jsonb("selected_window").$type<Viewing["selectedWindow"]>(),
    confirmedWindow: jsonb("confirmed_window").$type<Viewing["confirmedWindow"]>(),
    supersedesViewingId: text("supersedes_viewing_id"),
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
    foreignKey({
      name: "viewings_supersedes_tenant_fk",
      columns: [table.userId, table.supersedesViewingId],
      foreignColumns: [table.userId, table.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "viewings_state_allowed",
      sql`${table.state} IN ('proposed', 'selected', 'hold_approved', 'hold_created', 'confirmed', 'completed', 'cancelled')`
    )
  ]
);

export const calendarHolds = pgTable(
  "calendar_holds",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    viewingId: text("viewing_id").notNull(),
    approvalId: text("approval_id"),
    availabilityCheckId: text("availability_check_id"),
    payloadHash: text("payload_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    calendarId: text("calendar_id").notNull().default("primary"),
    googleEventId: text("google_event_id").notNull(),
    providerEventReference: text("provider_event_reference"),
    state: text("state").notNull(),
    conflictCheckOverride: boolean("conflict_check_override").notNull().default(false),
    conflictCheckOverrideReason: text("conflict_check_override_reason"),
    safeErrorCode: text("safe_error_code"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    completedAt: instant("completed_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "calendar_holds_viewing_tenant_fk",
      columns: [table.userId, table.viewingId],
      foreignColumns: [viewings.userId, viewings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "calendar_holds_approval_tenant_fk",
      columns: [table.userId, table.approvalId],
      foreignColumns: [approvals.userId, approvals.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "calendar_holds_check_tenant_fk",
      columns: [table.userId, table.availabilityCheckId],
      foreignColumns: [availabilityChecks.userId, availabilityChecks.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("calendar_holds_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    uniqueIndex("calendar_holds_user_approval_unique").on(table.userId, table.approvalId),
    uniqueIndex("calendar_holds_user_provider_event_unique").on(
      table.userId,
      table.calendarId,
      table.googleEventId
    ),
    check("calendar_holds_calendar_primary", sql`${table.calendarId} = 'primary'`),
    check(
      "calendar_holds_state_allowed",
      sql`${table.state} IN ('approval_pending', 'approved', 'creating', 'created', 'retryable_failed', 'permanently_failed', 'cancelled_internal')`
    ),
    check("calendar_holds_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
    check("calendar_holds_idempotency_key_valid", sql`${table.idempotencyKey} ~ '^[a-f0-9]{64}$'`),
    check(
      "calendar_holds_google_event_id_valid",
      sql`${table.googleEventId} ~ '^vera[a-f0-9]{40}$'`
    ),
    check(
      "calendar_holds_override_consistency",
      sql`(${table.conflictCheckOverride} = false AND ${table.conflictCheckOverrideReason} IS NULL)
        OR (${table.conflictCheckOverride} = true
          AND ${table.conflictCheckOverrideReason} IN ('scope_not_granted', 'google_disconnected', 'google_temporarily_unavailable', 'stale', 'vera_rules_only'))`
    ),
    check(
      "calendar_holds_error_consistency",
      sql`(${table.state} IN ('retryable_failed', 'permanently_failed'))
        = (${table.safeErrorCode} IS NOT NULL)`
    ),
    check(
      "calendar_holds_completion_consistency",
      sql`(${table.state} IN ('created', 'permanently_failed', 'cancelled_internal'))
        = (${table.completedAt} IS NOT NULL)`
    ),
    check(
      "calendar_holds_approval_consistency",
      sql`(${table.state} = 'approval_pending' AND ${table.approvalId} IS NULL)
        OR (${table.state} IN ('approved', 'creating', 'created', 'retryable_failed', 'permanently_failed')
          AND ${table.approvalId} IS NOT NULL)
        OR (${table.state} = 'cancelled_internal'
          AND (${table.approvalId} IS NOT NULL OR ${table.providerEventReference} IS NULL))`
    ),
    check(
      "calendar_holds_provider_reference_consistency",
      sql`(${table.state} = 'created' AND ${table.providerEventReference} IS NOT NULL)
        OR (${table.state} = 'cancelled_internal')
        OR (${table.state} NOT IN ('created', 'cancelled_internal')
          AND ${table.providerEventReference} IS NULL)`
    ),
    check(
      "calendar_holds_timestamp_order",
      sql`${table.updatedAt} >= ${table.createdAt}
        AND (${table.completedAt} IS NULL
          OR (${table.completedAt} >= ${table.createdAt} AND ${table.completedAt} <= ${table.updatedAt}))`
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

export const maritimeDeployments = pgTable(
  "maritime_deployments",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    maritimeAgentId: text("maritime_agent_id").notNull(),
    environment: text("environment").notNull(),
    status: text("status").notNull(),
    version: text("version").notNull(),
    diagnosticUrl: text("diagnostic_url"),
    lastCheckedAt: instant("last_checked_at"),
    safeErrorCode: text("safe_error_code"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("maritime_deployments_kind_environment_unique").on(table.kind, table.environment),
    uniqueIndex("maritime_deployments_agent_unique").on(table.maritimeAgentId),
    check(
      "maritime_deployments_kind_allowed",
      sql`${table.kind} IN ('vera_worker', 'openclaw_gateway')`
    ),
    check(
      "maritime_deployments_environment_allowed",
      sql`${table.environment} IN ('development', 'staging', 'production')`
    ),
    check(
      "maritime_deployments_status_allowed",
      sql`${table.status} IN ('unknown', 'sleeping', 'starting', 'running', 'restarting', 'unavailable', 'configuration_error', 'authentication_error')`
    ),
    check("maritime_deployments_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const serviceHeartbeats = pgTable(
  "service_heartbeats",
  {
    id: text("id").primaryKey(),
    service: text("service").notNull(),
    deploymentId: text("deployment_id").notNull(),
    status: text("status").notNull(),
    version: text("version").notNull(),
    checkedAt: instant("checked_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    safeCode: text("safe_code")
  },
  (table) => [
    uniqueIndex("service_heartbeats_deployment_unique").on(table.deploymentId),
    check(
      "service_heartbeats_service_allowed",
      sql`${table.service} IN ('vera-worker', 'openclaw-gateway')`
    ),
    check(
      "service_heartbeats_status_allowed",
      sql`${table.status} IN ('ready', 'degraded', 'unavailable')`
    ),
    check("service_heartbeats_expiry_order", sql`${table.expiresAt} > ${table.checkedAt}`)
  ]
);

export const maritimeDispatches = pgTable(
  "maritime_dispatches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    issuer: text("issuer").notNull(),
    audience: text("audience").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull(),
    maritimeAgentId: text("maritime_agent_id").notNull(),
    maritimeRunId: text("maritime_run_id"),
    issuedAt: instant("issued_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    acceptedAt: instant("accepted_at"),
    consumedAt: instant("consumed_at"),
    rejectedAt: instant("rejected_at"),
    rejectionCode: text("rejection_code"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "maritime_dispatches_source_job_tenant_fk",
      columns: [table.userId, table.sourceJobId],
      foreignColumns: [sourceJobs.userId, sourceJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("maritime_dispatches_nonce_hash_unique").on(table.nonceHash),
    index("maritime_dispatches_user_job_idx").on(table.userId, table.sourceJobId),
    index("maritime_dispatches_claim_idx").on(
      table.state,
      table.expiresAt,
      table.issuedAt,
      table.userId
    ),
    check("maritime_dispatches_issuer_vera", sql`${table.issuer} = 'vera-control-plane'`),
    check("maritime_dispatches_nonce_hash_valid", sql`${table.nonceHash} ~ '^[a-f0-9]{64}$'`),
    check("maritime_dispatches_payload_hash_valid", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "maritime_dispatches_state_allowed",
      sql`${table.state} IN ('pending_wake', 'accepted', 'consumed', 'expired', 'rejected')`
    ),
    check("maritime_dispatches_expiry_order", sql`${table.expiresAt} > ${table.issuedAt}`),
    check(
      "maritime_dispatches_rejection_consistency",
      sql`(${table.state} = 'rejected') = (${table.rejectedAt} IS NOT NULL AND ${table.rejectionCode} IS NOT NULL)`
    ),
    check(
      "maritime_dispatches_consumption_consistency",
      sql`${table.state} <> 'consumed' OR (${table.acceptedAt} IS NOT NULL AND ${table.consumedAt} IS NOT NULL)`
    ),
    check("maritime_dispatches_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const productionSchedules = pgTable(
  "production_schedules",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    sourceConfigurationId: text("source_configuration_id"),
    nextRunAt: instant("next_run_at").notNull(),
    lastRunAt: instant("last_run_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("production_schedules_user_kind_source_unique").on(
      table.userId,
      table.kind,
      table.sourceConfigurationId
    ),
    uniqueIndex("production_schedules_user_global_kind_unique")
      .on(table.userId, table.kind)
      .where(sql`${table.sourceConfigurationId} IS NULL`),
    index("production_schedules_due_idx").on(table.state, table.nextRunAt, table.userId),
    check(
      "production_schedules_kind_allowed",
      sql`${table.kind} IN ('gmail_alert_ingestion', 'normalization_reconciliation', 'decision_reconciliation', 'stale_listing_check', 'notification_fanout', 'health_reconciliation', 'ephemeral_cleanup')`
    ),
    check(
      "production_schedules_state_allowed",
      sql`${table.state} IN ('enabled', 'paused', 'disabled_by_policy')`
    ),
    check(
      "production_schedules_interval_range",
      sql`${table.intervalSeconds} BETWEEN 60 AND 31536000`
    ),
    check("production_schedules_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const productionScheduleRuns = pgTable(
  "production_schedule_runs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    scheduleId: text("schedule_id").notNull(),
    state: text("state").notNull(),
    dueAt: instant("due_at").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceJobId: text("source_job_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    safeErrorCode: text("safe_error_code"),
    startedAt: instant("started_at"),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "production_schedule_runs_schedule_tenant_fk",
      columns: [table.userId, table.scheduleId],
      foreignColumns: [productionSchedules.userId, productionSchedules.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "production_schedule_runs_source_job_tenant_fk",
      columns: [table.userId, table.sourceJobId],
      foreignColumns: [sourceJobs.userId, sourceJobs.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("production_schedule_runs_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey
    ),
    index("production_schedule_runs_state_due_idx").on(table.state, table.dueAt, table.userId),
    check(
      "production_schedule_runs_idempotency_valid",
      sql`${table.idempotencyKey} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "production_schedule_runs_state_allowed",
      sql`${table.state} IN ('created', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'cancelled_by_policy')`
    ),
    check(
      "production_schedule_runs_attempts_valid",
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 100`
    ),
    check("production_schedule_runs_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    enabled: boolean("enabled").notNull().default(false),
    scoreThreshold: integer("score_threshold").notNull(),
    freshnessMinutes: integer("freshness_minutes").notNull(),
    riskCeiling: text("risk_ceiling").notNull(),
    timezone: text("timezone").notNull(),
    quietHoursStart: text("quiet_hours_start").notNull(),
    quietHoursEnd: text("quiet_hours_end").notNull(),
    hourlyLimit: integer("hourly_limit").notNull(),
    digestEnabled: boolean("digest_enabled").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    check("notification_preferences_score_range", sql`${table.scoreThreshold} BETWEEN 0 AND 100`),
    check(
      "notification_preferences_freshness_range",
      sql`${table.freshnessMinutes} BETWEEN 1 AND 43200`
    ),
    check(
      "notification_preferences_risk_allowed",
      sql`${table.riskCeiling} IN ('none', 'low', 'medium', 'high')`
    ),
    check(
      "notification_preferences_quiet_start_valid",
      sql`${table.quietHoursStart} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`
    ),
    check(
      "notification_preferences_quiet_end_valid",
      sql`${table.quietHoursEnd} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`
    ),
    check("notification_preferences_hourly_range", sql`${table.hourlyLimit} BETWEEN 1 AND 60`),
    check("notification_preferences_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const webPushSubscriptions = pgTable(
  "web_push_subscriptions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    endpointHash: text("endpoint_hash").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    credentialAlgorithm: text("credential_algorithm").notNull(),
    credentialKeyId: text("credential_key_id").notNull(),
    credentialNonce: bytea("credential_nonce").notNull(),
    credentialCiphertext: bytea("credential_ciphertext").notNull(),
    credentialAuthenticationTag: bytea("credential_authentication_tag").notNull(),
    status: text("status").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    revokedAt: instant("revoked_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("web_push_subscriptions_user_endpoint_unique").on(table.userId, table.endpointHash),
    check(
      "web_push_subscriptions_endpoint_hash_valid",
      sql`${table.endpointHash} ~ '^[a-f0-9]{64}$'`
    ),
    check("web_push_subscriptions_credential_version", sql`${table.credentialVersion} = 1`),
    check(
      "web_push_subscriptions_credential_algorithm",
      sql`${table.credentialAlgorithm} = 'aes-256-gcm'`
    ),
    check("web_push_subscriptions_nonce_length", sql`octet_length(${table.credentialNonce}) = 12`),
    check(
      "web_push_subscriptions_ciphertext_length",
      sql`octet_length(${table.credentialCiphertext}) BETWEEN 1 AND 16384`
    ),
    check(
      "web_push_subscriptions_authentication_tag_length",
      sql`octet_length(${table.credentialAuthenticationTag}) = 16`
    ),
    check(
      "web_push_subscriptions_status_allowed",
      sql`${table.status} IN ('active', 'revoked', 'disabled')`
    ),
    check(
      "web_push_subscriptions_revocation_consistency",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} IS NOT NULL)`
    ),
    check("web_push_subscriptions_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    canonicalListingId: text("canonical_listing_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull(),
    payload: jsonb("payload").$type<NotificationPayload>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: instant("available_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: instant("lease_expires_at"),
    deliveredAt: instant("delivered_at"),
    safeErrorCode: text("safe_error_code"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "notification_deliveries_listing_tenant_fk",
      columns: [table.userId, table.canonicalListingId],
      foreignColumns: [canonicalListings.userId, canonicalListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "notification_deliveries_subscription_tenant_fk",
      columns: [table.userId, table.subscriptionId],
      foreignColumns: [webPushSubscriptions.userId, webPushSubscriptions.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("notification_deliveries_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey
    ),
    index("notification_deliveries_claim_idx").on(
      table.state,
      table.availableAt,
      table.createdAt,
      table.userId
    ),
    check(
      "notification_deliveries_idempotency_valid",
      sql`${table.idempotencyKey} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "notification_deliveries_payload_hash_valid",
      sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`
    ),
    check("notification_deliveries_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "notification_deliveries_state_allowed",
      sql`${table.state} IN ('queued', 'leased', 'deferred_quiet_hours', 'deferred_rate_limit', 'delivered', 'retryable_failed', 'permanently_failed', 'cancelled_by_policy')`
    ),
    check("notification_deliveries_attempt_range", sql`${table.attemptCount} BETWEEN 0 AND 20`),
    check(
      "notification_deliveries_lease_consistency",
      sql`(${table.state} = 'leased' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} <> 'leased' AND ${table.leaseOwner} IS NULL AND ${table.leaseExpiresAt} IS NULL)`
    ),
    check(
      "notification_deliveries_delivered_consistency",
      sql`(${table.state} = 'delivered') = (${table.deliveredAt} IS NOT NULL)`
    ),
    check("notification_deliveries_timestamp_order", sql`${table.updatedAt} >= ${table.createdAt}`)
  ]
);

export const notificationDigestItems = pgTable(
  "notification_digest_items",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    notificationDeliveryId: text("notification_delivery_id").notNull(),
    releaseAt: instant("release_at").notNull(),
    createdAt: instant("created_at").notNull(),
    releasedAt: instant("released_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "notification_digest_items_delivery_tenant_fk",
      columns: [table.userId, table.notificationDeliveryId],
      foreignColumns: [notificationDeliveries.userId, notificationDeliveries.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("notification_digest_items_user_delivery_unique").on(
      table.userId,
      table.notificationDeliveryId
    ),
    index("notification_digest_items_release_idx").on(table.releaseAt, table.userId)
  ]
);

export const gmailOauthStates = pgTable(
  "gmail_oauth_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    stateHash: text("state_hash").notNull(),
    codeVerifierHash: text("code_verifier_hash").notNull(),
    redirectPath: text("redirect_path").notNull(),
    requestedScopes: text("requested_scopes").array().notNull(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    consumedAt: instant("consumed_at")
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("gmail_oauth_states_state_hash_unique").on(table.stateHash),
    check("gmail_oauth_states_state_hash_valid", sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "gmail_oauth_states_verifier_hash_valid",
      sql`${table.codeVerifierHash} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "gmail_oauth_states_redirect_path",
      sql`${table.redirectPath} = '/settings/integrations'`
    ),
    check(
      "gmail_oauth_states_scopes_exact",
      sql`${table.requestedScopes} = ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[]`
    ),
    check("gmail_oauth_states_expiry_order", sql`${table.expiresAt} > ${table.createdAt}`)
  ]
);

export const gmailAlertCursors = pgTable(
  "gmail_alert_cursors",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    sourceConfigurationId: text("source_configuration_id").notNull(),
    historyId: text("history_id"),
    lastSuccessfulAt: instant("last_successful_at"),
    updatedAt: instant("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("gmail_alert_cursors_user_source_unique").on(
      table.userId,
      table.sourceConfigurationId
    ),
    check(
      "gmail_alert_cursors_history_id_valid",
      sql`${table.historyId} IS NULL OR ${table.historyId} ~ '^[0-9]{1,64}$'`
    )
  ]
);

export const gmailAlertExternalReferences = pgTable(
  "gmail_alert_external_references",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "restrict" }),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    historyId: text("history_id"),
    rawListingId: text("raw_listing_id").notNull(),
    contentHash: text("content_hash").notNull(),
    importedAt: instant("imported_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      name: "gmail_alert_external_references_raw_listing_tenant_fk",
      columns: [table.userId, table.rawListingId],
      foreignColumns: [rawListings.userId, rawListings.id]
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("gmail_alert_external_references_user_message_unique").on(
      table.userId,
      table.messageId
    ),
    check(
      "gmail_alert_external_references_history_valid",
      sql`${table.historyId} IS NULL OR ${table.historyId} ~ '^[0-9]{1,64}$'`
    ),
    check(
      "gmail_alert_external_references_content_hash_valid",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`
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
  availabilityChecks,
  availabilityRuleSets,
  browserCaptureAcceptances,
  browserProfileControls,
  browserSourceControls,
  browserUserControls,
  browserNodes,
  calendarHolds,
  calendarOauthStates,
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
  integrationRefreshLeases,
  gmailAlertCursors,
  gmailAlertExternalReferences,
  gmailOauthStates,
  listingExtractions,
  listingPhotos,
  listingScores,
  listingSourceRecords,
  normalizationJobs,
  maritimeDeployments,
  maritimeDispatches,
  notificationDeliveries,
  notificationDigestItems,
  notificationPreferences,
  productionScheduleRuns,
  productionSchedules,
  rawListings,
  riskSignals,
  searchProfiles,
  sessions,
  sourceJobAttempts,
  sourceJobs,
  sourcePolicyManifests,
  serviceHeartbeats,
  users,
  verifications,
  viewings,
  webPushSubscriptions
};
