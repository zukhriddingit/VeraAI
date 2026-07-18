CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`policy_decision` text NOT NULL,
	`approval_id` text,
	`payload_hash` text NOT NULL,
	`outcome` text NOT NULL,
	`error_category` text,
	`metadata` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "activity_events_actor_allowed" CHECK("activity_events"."actor" IN ('user', 'vera', 'connector', 'system')),
	CONSTRAINT "activity_events_policy_allowed" CHECK("activity_events"."policy_decision" IN ('not_applicable', 'authorized', 'denied')),
	CONSTRAINT "activity_events_outcome_allowed" CHECK("activity_events"."outcome" IN ('recorded', 'authorized', 'denied', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `activity_events_correlation_idx` ON `activity_events` (`correlation_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`connector_id` text NOT NULL,
	`operation` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	CONSTRAINT "approvals_actor_user_only" CHECK("approvals"."actor" = 'user'),
	CONSTRAINT "approvals_state_allowed" CHECK("approvals"."state" IN ('pending', 'used', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE `canonical_field_sources` (
	`canonical_listing_id` text NOT NULL,
	`field_path` text NOT NULL,
	`field_provenance_id` text NOT NULL,
	PRIMARY KEY(`canonical_listing_id`, `field_path`),
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`field_provenance_id`) REFERENCES `field_provenance`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `canonical_field_sources_provenance_idx` ON `canonical_field_sources` (`field_provenance_id`);--> statement-breakpoint
CREATE TABLE `canonical_listing_sources` (
	`canonical_listing_id` text NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`is_primary` integer NOT NULL,
	PRIMARY KEY(`canonical_listing_id`, `listing_source_record_id`),
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_listing_sources_source_unique` ON `canonical_listing_sources` (`listing_source_record_id`);--> statement-breakpoint
CREATE TABLE `canonical_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`duplicate_cluster_id` text,
	`primary_source_record_id` text NOT NULL,
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
	`lifecycle_state` text NOT NULL,
	`completeness_basis_points` integer NOT NULL,
	`freshest_observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`duplicate_cluster_id`) REFERENCES `duplicate_clusters`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`primary_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "canonical_listings_lifecycle_allowed" CHECK("canonical_listings"."lifecycle_state" IN (
        'new', 'shortlisted', 'draft_ready', 'draft_created', 'draft_rejected', 'replied',
        'follow_up_due', 'tour_proposed', 'tour_scheduled', 'toured', 'applying', 'passed',
        'dismissed', 'stale', 'unavailable'
      )),
	CONSTRAINT "canonical_listings_completeness_range" CHECK("canonical_listings"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "canonical_listings_money_nonnegative" CHECK(("canonical_listings"."monthly_rent_cents" IS NULL OR "canonical_listings"."monthly_rent_cents" >= 0)
        AND ("canonical_listings"."recurring_fees_cents" IS NULL OR "canonical_listings"."recurring_fees_cents" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_listings_duplicate_cluster_unique` ON `canonical_listings` (`duplicate_cluster_id`);--> statement-breakpoint
CREATE TABLE `contact_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_reference` text,
	`missing_fact_questions` text NOT NULL,
	`draft_reference` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "contact_workflows_state_allowed" CHECK("contact_workflows"."state" IN ('not_started', 'questions_ready', 'draft_ready', 'draft_created', 'reply_received', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_workflows_listing_unique` ON `contact_workflows` (`canonical_listing_id`);--> statement-breakpoint
CREATE TABLE `duplicate_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_key` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`reason_codes` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_clusters_key_unique` ON `duplicate_clusters` (`cluster_key`);--> statement-breakpoint
CREATE TABLE `field_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`raw_listing_id` text NOT NULL,
	`field_path` text NOT NULL,
	`extraction_method` text NOT NULL,
	`confidence_basis_points` integer NOT NULL,
	`observed_at` text NOT NULL,
	`evidence_excerpt` text,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`raw_listing_id`) REFERENCES `raw_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "field_provenance_confidence_range" CHECK("field_provenance"."confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "field_provenance_method_allowed" CHECK("field_provenance"."extraction_method" IN ('fixture_structured', 'manual', 'rule', 'ai'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_provenance_source_field_unique` ON `field_provenance` (`listing_source_record_id`,`field_path`);--> statement-breakpoint
CREATE TABLE `listing_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`source_url` text,
	`fixture_asset_label` text,
	`byte_hash` text,
	`perceptual_hash` text,
	`position` integer NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_photos_reference_required" CHECK("listing_photos"."source_url" IS NOT NULL OR "listing_photos"."fixture_asset_label" IS NOT NULL),
	CONSTRAINT "listing_photos_position_nonnegative" CHECK("listing_photos"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_photos_source_position_unique` ON `listing_photos` (`listing_source_record_id`,`position`);--> statement-breakpoint
CREATE TABLE `listing_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`search_profile_id` text,
	`algorithm_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`total_score_basis_points` integer NOT NULL,
	`factors` text NOT NULL,
	`reason_codes` text NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_scores_total_range" CHECK("listing_scores"."total_score_basis_points" BETWEEN -10000 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_scores_snapshot_unique` ON `listing_scores` (`canonical_listing_id`,`search_profile_id`,`algorithm_version`,`input_hash`);--> statement-breakpoint
CREATE TABLE `listing_source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_listing_id` text NOT NULL,
	`source` text NOT NULL,
	`source_listing_id` text,
	`source_url` text,
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
	CONSTRAINT "listing_source_records_confidence_range" CHECK("listing_source_records"."extraction_confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_completeness_range" CHECK("listing_source_records"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_money_nonnegative" CHECK(("listing_source_records"."monthly_rent_cents" IS NULL OR "listing_source_records"."monthly_rent_cents" >= 0)
        AND ("listing_source_records"."recurring_fees_cents" IS NULL OR "listing_source_records"."recurring_fees_cents" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_source_records_raw_listing_unique` ON `listing_source_records` (`raw_listing_id`);--> statement-breakpoint
CREATE INDEX `listing_source_records_source_idx` ON `listing_source_records` (`source`);--> statement-breakpoint
CREATE TABLE `raw_listings` (
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
	CONSTRAINT "raw_listings_evidence_required" CHECK("raw_listings"."raw_text" IS NOT NULL OR "raw_listings"."raw_json" IS NOT NULL),
	CONSTRAINT "raw_listings_fixture_capture_only" CHECK("raw_listings"."capture_method" = 'fixture')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_listings_idempotency_key_unique` ON `raw_listings` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `raw_listings_source_identity_idx` ON `raw_listings` (`source`,`source_listing_id`);--> statement-breakpoint
CREATE TABLE `risk_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`confidence_basis_points` integer NOT NULL,
	`evidence` text NOT NULL,
	`verification_action` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "risk_signals_confidence_range" CHECK("risk_signals"."confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "risk_signals_severity_allowed" CHECK("risk_signals"."severity" IN ('info', 'low', 'medium', 'high')),
	CONSTRAINT "risk_signals_status_allowed" CHECK("risk_signals"."status" IN ('open', 'verified', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `risk_signals_listing_code_unique` ON `risk_signals` (`canonical_listing_id`,`code`);--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`location_text` text NOT NULL,
	`center_latitude_microdegrees` integer,
	`center_longitude_microdegrees` integer,
	`radius_meters` integer,
	`minimum_bedrooms_half_units` integer,
	`minimum_bathrooms_half_units` integer,
	`target_monthly_total_cents` integer,
	`absolute_monthly_maximum_cents` integer,
	`move_in_earliest` text,
	`move_in_latest` text,
	`pet_requirements` text NOT NULL,
	`commute_anchors` text NOT NULL,
	`hard_constraints` text NOT NULL,
	`weighted_preferences` text NOT NULL,
	`notification_rules` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "search_profiles_version_positive" CHECK("search_profiles"."version" > 0),
	CONSTRAINT "search_profiles_budget_nonnegative" CHECK(("search_profiles"."target_monthly_total_cents" IS NULL OR "search_profiles"."target_monthly_total_cents" >= 0)
        AND ("search_profiles"."absolute_monthly_maximum_cents" IS NULL OR "search_profiles"."absolute_monthly_maximum_cents" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_profiles_name_version_unique` ON `search_profiles` (`name`,`version`);--> statement-breakpoint
CREATE TABLE `source_policy_manifests` (
	`connector_id` text NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`enabled` integer NOT NULL,
	`execution` text NOT NULL,
	`capabilities` text NOT NULL,
	`requires_user_session` integer NOT NULL,
	`requires_approval` integer NOT NULL,
	`minimum_interval_seconds` integer,
	`allowed_domains` text NOT NULL,
	`kill_switch_active` integer NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`connector_id`, `version`),
	CONSTRAINT "source_policy_manifests_version_positive" CHECK("source_policy_manifests"."version" > 0),
	CONSTRAINT "source_policy_manifests_execution_allowed" CHECK("source_policy_manifests"."execution" IN ('manual', 'scheduled'))
);
--> statement-breakpoint
CREATE TABLE `viewings` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`proposed_windows` text NOT NULL,
	`confirmed_window` text,
	`time_zone` text NOT NULL,
	`calendar_reference` text,
	`state` text NOT NULL,
	`notes` text,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "viewings_state_allowed" CHECK("viewings"."state" IN ('proposed', 'selected', 'hold_approved', 'hold_created', 'confirmed', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TRIGGER `raw_listings_no_update`
BEFORE UPDATE ON `raw_listings`
BEGIN
	SELECT RAISE(ABORT, 'raw_listings are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `raw_listings_no_delete`
BEFORE DELETE ON `raw_listings`
BEGIN
	SELECT RAISE(ABORT, 'raw_listings are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `activity_events_no_update`
BEFORE UPDATE ON `activity_events`
BEGIN
	SELECT RAISE(ABORT, 'activity_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `activity_events_no_delete`
BEFORE DELETE ON `activity_events`
BEGIN
	SELECT RAISE(ABORT, 'activity_events are append-only');
END;
