CREATE TABLE `normalization_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_listing_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`job_type` text DEFAULT 'normalize_listing' NOT NULL,
	`state` text NOT NULL,
	`available_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`last_error_code` text,
	`last_error_category` text,
	`correlation_id` text NOT NULL,
	`causation_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`raw_listing_id`) REFERENCES `raw_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "normalization_jobs_type_allowed" CHECK("normalization_jobs"."job_type" = 'normalize_listing'),
	CONSTRAINT "normalization_jobs_state_allowed" CHECK("normalization_jobs"."state" IN ('queued', 'leased', 'completed', 'retryable', 'dead_letter')),
	CONSTRAINT "normalization_jobs_attempts_valid" CHECK("normalization_jobs"."attempts" >= 0 AND "normalization_jobs"."max_attempts" > 0 AND "normalization_jobs"."attempts" <= "normalization_jobs"."max_attempts"),
	CONSTRAINT "normalization_jobs_attempt_state_consistency" CHECK((
        "normalization_jobs"."state" = 'queued' AND "normalization_jobs"."attempts" = 0
      ) OR (
        "normalization_jobs"."state" IN ('leased', 'completed') AND "normalization_jobs"."attempts" >= 1
      ) OR (
        "normalization_jobs"."state" = 'retryable'
        AND "normalization_jobs"."attempts" >= 1
        AND "normalization_jobs"."attempts" < "normalization_jobs"."max_attempts"
      ) OR (
        "normalization_jobs"."state" = 'dead_letter'
        AND "normalization_jobs"."attempts" = "normalization_jobs"."max_attempts"
      )),
	CONSTRAINT "normalization_jobs_lease_consistency" CHECK((
        "normalization_jobs"."state" = 'leased'
        AND "normalization_jobs"."lease_owner" IS NOT NULL
        AND "normalization_jobs"."lease_expires_at" IS NOT NULL
      ) OR (
        "normalization_jobs"."state" <> 'leased'
        AND "normalization_jobs"."lease_owner" IS NULL
        AND "normalization_jobs"."lease_expires_at" IS NULL
      )),
	CONSTRAINT "normalization_jobs_completion_consistency" CHECK((
        "normalization_jobs"."state" = 'completed'
        AND "normalization_jobs"."completed_at" IS NOT NULL
      ) OR (
        "normalization_jobs"."state" <> 'completed'
        AND "normalization_jobs"."completed_at" IS NULL
      )),
	CONSTRAINT "normalization_jobs_error_pair_consistency" CHECK(("normalization_jobs"."last_error_code" IS NULL) = ("normalization_jobs"."last_error_category" IS NULL)),
	CONSTRAINT "normalization_jobs_error_state_consistency" CHECK((
        "normalization_jobs"."state" IN ('queued', 'completed')
        AND "normalization_jobs"."last_error_code" IS NULL
      ) OR (
        "normalization_jobs"."state" IN ('retryable', 'dead_letter')
        AND "normalization_jobs"."last_error_code" IS NOT NULL
      ) OR "normalization_jobs"."state" = 'leased')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_jobs_raw_listing_unique` ON `normalization_jobs` (`raw_listing_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_jobs_idempotency_key_unique` ON `normalization_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `normalization_jobs_claim_idx` ON `normalization_jobs` (`state`,`available_at`,`created_at`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_raw_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_listing_id` text,
	`source_url` text,
	`capture_method` text NOT NULL,
	`observed_at` text NOT NULL,
	`source_posted_at` text,
	`raw_text` text,
	`raw_json` text,
	`capture_metadata` text NOT NULL,
	`content_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "raw_listings_evidence_required" CHECK("__new_raw_listings"."raw_text" IS NOT NULL OR "__new_raw_listings"."raw_json" IS NOT NULL),
	CONSTRAINT "raw_listings_capture_method_allowed" CHECK("__new_raw_listings"."capture_method" IN ('fixture', 'manual_text', 'manual_structured'))
);
--> statement-breakpoint
INSERT INTO `__new_raw_listings`("id", "source", "source_listing_id", "source_url", "capture_method", "observed_at", "source_posted_at", "raw_text", "raw_json", "capture_metadata", "content_hash", "idempotency_key", "created_at") SELECT "id", "source", "source_listing_id", "source_url", "capture_method", "observed_at", "source_posted_at", "raw_text", "raw_json", "capture_metadata", "content_hash", "idempotency_key", "created_at" FROM `raw_listings`;--> statement-breakpoint
DROP TABLE `raw_listings`;--> statement-breakpoint
ALTER TABLE `__new_raw_listings` RENAME TO `raw_listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `raw_listings_idempotency_key_unique` ON `raw_listings` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `raw_listings_source_identity_idx` ON `raw_listings` (`source`,`source_listing_id`);--> statement-breakpoint
CREATE TRIGGER `raw_listings_no_update`
BEFORE UPDATE ON `raw_listings`
BEGIN
	SELECT RAISE(ABORT, 'raw_listings are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `raw_listings_no_delete`
BEFORE DELETE ON `raw_listings`
BEGIN
	SELECT RAISE(ABORT, 'raw_listings are append-only');
END;--> statement-breakpoint
CREATE TABLE `__new_field_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`raw_listing_id` text NOT NULL,
	`field_path` text NOT NULL,
	`extraction_method` text NOT NULL,
	`confidence_basis_points` integer NOT NULL,
	`value_status` text DEFAULT 'known' NOT NULL,
	`unknown_reason` text,
	`observed_at` text NOT NULL,
	`evidence_excerpt` text,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`raw_listing_id`) REFERENCES `raw_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "field_provenance_confidence_range" CHECK("__new_field_provenance"."confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "field_provenance_method_allowed" CHECK("__new_field_provenance"."extraction_method" IN ('fixture_structured', 'manual', 'rule', 'ai')),
	CONSTRAINT "field_provenance_value_status_allowed" CHECK("__new_field_provenance"."value_status" IN ('known', 'unknown')),
	CONSTRAINT "field_provenance_unknown_consistency" CHECK((
        "__new_field_provenance"."value_status" = 'known'
        AND "__new_field_provenance"."unknown_reason" IS NULL
      ) OR (
        "__new_field_provenance"."value_status" = 'unknown'
        AND "__new_field_provenance"."confidence_basis_points" = 0
        AND "__new_field_provenance"."unknown_reason" IN (
          'missing_evidence', 'unrecognized_format', 'not_applicable'
        )
      ))
);
--> statement-breakpoint
INSERT INTO `__new_field_provenance`("id", "listing_source_record_id", "raw_listing_id", "field_path", "extraction_method", "confidence_basis_points", "value_status", "unknown_reason", "observed_at", "evidence_excerpt") SELECT "id", "listing_source_record_id", "raw_listing_id", "field_path", "extraction_method", "confidence_basis_points", 'known', NULL, "observed_at", "evidence_excerpt" FROM `field_provenance`;--> statement-breakpoint
DROP TABLE `field_provenance`;--> statement-breakpoint
ALTER TABLE `__new_field_provenance` RENAME TO `field_provenance`;--> statement-breakpoint
CREATE UNIQUE INDEX `field_provenance_source_field_unique` ON `field_provenance` (`listing_source_record_id`,`field_path`);--> statement-breakpoint
CREATE TABLE `__new_listing_source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_listing_id` text NOT NULL,
	`source` text NOT NULL,
	`source_listing_id` text,
	`source_url` text,
	`source_posted_at` text,
	`contact_channel` text DEFAULT 'unknown' NOT NULL,
	`title` text NOT NULL,
	`address_line_1` text,
	`address_unit` text,
	`address_city` text,
	`address_region` text,
	`address_postal_code` text,
	`address_country_code` text,
	`monthly_rent_cents` integer,
	`recurring_fees_cents` integer,
	`bedrooms_half_units` integer,
	`bathrooms_half_units` integer,
	`square_feet` integer,
	`property_type` text,
	`available_on` text,
	`lease_term_months` integer,
	`pet_policy` text DEFAULT 'null',
	`amenities` text NOT NULL,
	`description` text,
	`extraction_confidence_basis_points` integer NOT NULL,
	`completeness_basis_points` integer NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`raw_listing_id`) REFERENCES `raw_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_source_records_confidence_range" CHECK("__new_listing_source_records"."extraction_confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_completeness_range" CHECK("__new_listing_source_records"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_money_nonnegative" CHECK(("__new_listing_source_records"."monthly_rent_cents" IS NULL OR "__new_listing_source_records"."monthly_rent_cents" >= 0)
        AND ("__new_listing_source_records"."recurring_fees_cents" IS NULL OR "__new_listing_source_records"."recurring_fees_cents" >= 0)),
	CONSTRAINT "listing_source_records_contact_channel_allowed" CHECK("__new_listing_source_records"."contact_channel" IN (
        'email', 'phone', 'platform_message', 'website_form', 'other', 'unknown'
      ))
);
--> statement-breakpoint
INSERT INTO `__new_listing_source_records`("id", "raw_listing_id", "source", "source_listing_id", "source_url", "source_posted_at", "contact_channel", "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "extraction_confidence_basis_points", "completeness_basis_points", "observed_at", "created_at") SELECT "id", "raw_listing_id", "source", "source_listing_id", "source_url", NULL, 'unknown', "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "extraction_confidence_basis_points", "completeness_basis_points", "observed_at", "created_at" FROM `listing_source_records`;--> statement-breakpoint
DROP TABLE `listing_source_records`;--> statement-breakpoint
ALTER TABLE `__new_listing_source_records` RENAME TO `listing_source_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `listing_source_records_raw_listing_unique` ON `listing_source_records` (`raw_listing_id`);--> statement-breakpoint
CREATE INDEX `listing_source_records_source_idx` ON `listing_source_records` (`source`);--> statement-breakpoint
CREATE TABLE `__new_source_policy_manifests` (
	`schema_version` integer DEFAULT 1 NOT NULL,
	`connector_id` text NOT NULL,
	`display_name` text DEFAULT 'Sanitized source label' NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`enabled` integer NOT NULL,
	`execution` text NOT NULL,
	`capabilities` text NOT NULL,
	`allowed_operations` text DEFAULT '[]' NOT NULL,
	`allowed_domains` text NOT NULL,
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`allowed_http_methods` text DEFAULT '[]' NOT NULL,
	`requires_user_session` integer NOT NULL,
	`requires_approval` integer NOT NULL,
	`minimum_interval_seconds` integer,
	`max_concurrency` integer DEFAULT 1 NOT NULL,
	`global_kill_switch_key` text DEFAULT 'integrations.disabled' NOT NULL,
	`connector_kill_switch_key` text DEFAULT 'integrations.legacy_source_labels' NOT NULL,
	`data_classification` text DEFAULT 'synthetic' NOT NULL,
	`redaction_rules` text DEFAULT '["raw_content_from_logs","full_urls_from_logs","contact_details_from_logs","credentials_from_logs"]' NOT NULL,
	`manual_blocker_behavior` text DEFAULT 'stop_and_request_user_action' NOT NULL,
	`owner` text DEFAULT 'Vera maintainers' NOT NULL,
	`reviewed_at` text DEFAULT '2026-07-17' NOT NULL,
	`decision_record` text DEFAULT 'docs/DECISIONS/0004-fail-closed-connectors.md' NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connector_id`, `version`),
	CONSTRAINT "source_policy_manifests_version_positive" CHECK("__new_source_policy_manifests"."version" > 0),
	CONSTRAINT "source_policy_manifests_schema_version_supported" CHECK("__new_source_policy_manifests"."schema_version" = 1),
	CONSTRAINT "source_policy_manifests_execution_allowed" CHECK("__new_source_policy_manifests"."execution" IN ('manual', 'scheduled')),
	CONSTRAINT "source_policy_manifests_scheduling_consistency" CHECK("__new_source_policy_manifests"."execution" <> 'scheduled' OR "__new_source_policy_manifests"."minimum_interval_seconds" IS NOT NULL),
	CONSTRAINT "source_policy_manifests_concurrency_positive" CHECK("__new_source_policy_manifests"."max_concurrency" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_source_policy_manifests`("schema_version", "connector_id", "display_name", "version", "source", "enabled", "execution", "capabilities", "allowed_operations", "allowed_domains", "allowed_origins", "allowed_http_methods", "requires_user_session", "requires_approval", "minimum_interval_seconds", "max_concurrency", "global_kill_switch_key", "connector_kill_switch_key", "data_classification", "redaction_rules", "manual_blocker_behavior", "owner", "reviewed_at", "decision_record", "notes", "created_at", "updated_at") SELECT 1, "connector_id", 'Sanitized source label', "version", "source", "enabled", "execution", "capabilities", '[]', "allowed_domains", '[]', '[]', "requires_user_session", "requires_approval", "minimum_interval_seconds", 1, 'integrations.disabled', 'integrations.legacy_source_labels', 'synthetic', '["raw_content_from_logs","full_urls_from_logs","contact_details_from_logs","credentials_from_logs"]', 'stop_and_request_user_action', 'Vera maintainers', '2026-07-17', 'docs/DECISIONS/0004-fail-closed-connectors.md', "notes", "created_at", "updated_at" FROM `source_policy_manifests`;--> statement-breakpoint
DROP TABLE `source_policy_manifests`;--> statement-breakpoint
ALTER TABLE `__new_source_policy_manifests` RENAME TO `source_policy_manifests`;
