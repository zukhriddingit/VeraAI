CREATE TABLE `canonical_decision_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_run_id` text NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`cluster_id` text,
	`primary_source_record_id` text NOT NULL,
	`stitch_version` text NOT NULL,
	`stitch_input_hash` text NOT NULL,
	`member_source_record_ids_json` text NOT NULL,
	`selected_fields_json` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	FOREIGN KEY (`decision_run_id`) REFERENCES `decision_runs`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`primary_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_decision_runs_run_listing_unique` ON `canonical_decision_runs` (`decision_run_id`,`canonical_listing_id`);--> statement-breakpoint
CREATE INDEX `canonical_decision_runs_listing_idx` ON `canonical_decision_runs` (`canonical_listing_id`,`decision_run_id`);--> statement-breakpoint
CREATE TABLE `decision_corpus_state` (
	`search_profile_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "decision_corpus_state_revision_nonnegative" CHECK("decision_corpus_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `decision_job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text,
	`error_code` text,
	`duration_milliseconds` integer,
	FOREIGN KEY (`job_id`) REFERENCES `decision_jobs`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "decision_job_attempts_number_positive" CHECK("decision_job_attempts"."attempt_number" > 0),
	CONSTRAINT "decision_job_attempts_outcome_allowed" CHECK("decision_job_attempts"."outcome" IS NULL OR "decision_job_attempts"."outcome" IN ('succeeded', 'retryable_failed', 'permanently_failed', 'cancelled', 'lease_lost'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_job_attempts_job_number_unique` ON `decision_job_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `decision_job_attempts_job_idx` ON `decision_job_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `decision_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`search_profile_id` text NOT NULL,
	`target_corpus_revision` integer NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`input_hash` text,
	`output_hash` text,
	`attempt_count` integer NOT NULL,
	`available_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "decision_jobs_revision_nonnegative" CHECK("decision_jobs"."target_corpus_revision" >= 0),
	CONSTRAINT "decision_jobs_trigger_allowed" CHECK("decision_jobs"."trigger" IN ('normalization', 'manual_recompute', 'seed')),
	CONSTRAINT "decision_jobs_status_allowed" CHECK("decision_jobs"."status" IN ('queued', 'running', 'succeeded', 'retryable_failed', 'permanently_failed', 'cancelled')),
	CONSTRAINT "decision_jobs_attempt_count_valid" CHECK("decision_jobs"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "decision_jobs_lease_pair" CHECK(("decision_jobs"."lease_owner" IS NULL) = ("decision_jobs"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_jobs_profile_revision_unique` ON `decision_jobs` (`search_profile_id`,`target_corpus_revision`);--> statement-breakpoint
CREATE INDEX `decision_jobs_claim_idx` ON `decision_jobs` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `decision_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`search_profile_id` text NOT NULL,
	`corpus_revision` integer NOT NULL,
	`plan_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text NOT NULL,
	`counts_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `decision_jobs`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "decision_runs_revision_nonnegative" CHECK("decision_runs"."corpus_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decision_runs_job_unique` ON `decision_runs` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `decision_runs_profile_revision_input_unique` ON `decision_runs` (`search_profile_id`,`corpus_revision`,`input_hash`);--> statement-breakpoint
CREATE INDEX `decision_runs_profile_revision_idx` ON `decision_runs` (`search_profile_id`,`corpus_revision`);--> statement-breakpoint
CREATE TABLE `duplicate_override_revocations` (
	`id` text PRIMARY KEY NOT NULL,
	`override_id` text NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`override_id`) REFERENCES `duplicate_overrides`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "duplicate_override_revocations_actor_allowed" CHECK("duplicate_override_revocations"."created_by" IN ('user', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_override_revocations_override_unique` ON `duplicate_override_revocations` (`override_id`);--> statement-breakpoint
CREATE TABLE `duplicate_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`search_profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_record_ids_json` text NOT NULL,
	`survivor_canonical_id` text,
	`reason` text,
	`created_by` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "duplicate_overrides_kind_allowed" CHECK("duplicate_overrides"."kind" IN ('force_merge', 'force_split')),
	CONSTRAINT "duplicate_overrides_actor_allowed" CHECK("duplicate_overrides"."created_by" IN ('user', 'system'))
);
--> statement-breakpoint
CREATE INDEX `duplicate_overrides_profile_created_idx` ON `duplicate_overrides` (`search_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `duplicate_pair_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_run_id` text NOT NULL,
	`left_source_record_id` text NOT NULL,
	`right_source_record_id` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`decision` text NOT NULL,
	`score_basis_points` integer,
	`automatic_link_threshold_basis_points` integer NOT NULL,
	`review_threshold_basis_points` integer NOT NULL,
	`exact_reason_codes` text NOT NULL,
	`conflict_reason_codes` text NOT NULL,
	`contact_matched` integer NOT NULL,
	`features_json` text NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`decision_run_id`) REFERENCES `decision_runs`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`left_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`right_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "duplicate_pair_evaluations_ordered_pair" CHECK("duplicate_pair_evaluations"."left_source_record_id" < "duplicate_pair_evaluations"."right_source_record_id"),
	CONSTRAINT "duplicate_pair_evaluations_decision_allowed" CHECK("duplicate_pair_evaluations"."decision" IN ('link', 'review', 'separate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_pair_evaluations_run_pair_unique` ON `duplicate_pair_evaluations` (`decision_run_id`,`left_source_record_id`,`right_source_record_id`);--> statement-breakpoint
CREATE INDEX `duplicate_pair_evaluations_pair_idx` ON `duplicate_pair_evaluations` (`left_source_record_id`,`right_source_record_id`,`evaluated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_canonical_listings` (
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
	`projection_state` text DEFAULT 'active' NOT NULL,
	`superseded_by_id` text,
	`stitch_version` text,
	`stitch_input_hash` text,
	`updated_by_decision_run_id` text,
	`completeness_basis_points` integer NOT NULL,
	`freshest_observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`duplicate_cluster_id`) REFERENCES `duplicate_clusters`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`primary_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`updated_by_decision_run_id`) REFERENCES `decision_runs`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "canonical_listings_lifecycle_allowed" CHECK("__new_canonical_listings"."lifecycle_state" IN (
        'new', 'shortlisted', 'draft_ready', 'draft_created', 'draft_rejected', 'replied',
        'follow_up_due', 'tour_proposed', 'tour_scheduled', 'toured', 'applying', 'passed',
        'dismissed', 'stale', 'unavailable'
      )),
	CONSTRAINT "canonical_listings_completeness_range" CHECK("__new_canonical_listings"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "canonical_listings_money_nonnegative" CHECK(("__new_canonical_listings"."monthly_rent_cents" IS NULL OR "__new_canonical_listings"."monthly_rent_cents" >= 0)
        AND ("__new_canonical_listings"."recurring_fees_cents" IS NULL OR "__new_canonical_listings"."recurring_fees_cents" >= 0)),
	CONSTRAINT "canonical_listings_projection_allowed" CHECK("__new_canonical_listings"."projection_state" IN ('active', 'superseded')),
	CONSTRAINT "canonical_listings_projection_redirect_consistency" CHECK(("__new_canonical_listings"."projection_state" = 'active' AND "__new_canonical_listings"."superseded_by_id" IS NULL)
        OR ("__new_canonical_listings"."projection_state" = 'superseded' AND "__new_canonical_listings"."superseded_by_id" IS NOT NULL)),
	CONSTRAINT "canonical_listings_stitch_pair" CHECK(("__new_canonical_listings"."stitch_version" IS NULL) = ("__new_canonical_listings"."stitch_input_hash" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_canonical_listings`("id", "duplicate_cluster_id", "primary_source_record_id", "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "lifecycle_state", "projection_state", "superseded_by_id", "stitch_version", "stitch_input_hash", "updated_by_decision_run_id", "completeness_basis_points", "freshest_observed_at", "created_at", "updated_at") SELECT "id", "duplicate_cluster_id", "primary_source_record_id", "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "lifecycle_state", 'active', NULL, NULL, NULL, NULL, "completeness_basis_points", "freshest_observed_at", "created_at", "updated_at" FROM `canonical_listings`;--> statement-breakpoint
DROP TABLE `canonical_listings`;--> statement-breakpoint
ALTER TABLE `__new_canonical_listings` RENAME TO `canonical_listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_listings_duplicate_cluster_unique` ON `canonical_listings` (`duplicate_cluster_id`);--> statement-breakpoint
CREATE INDEX `canonical_listings_projection_idx` ON `canonical_listings` (`projection_state`,`freshest_observed_at`);--> statement-breakpoint
CREATE TABLE `__new_duplicate_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_key` text NOT NULL,
	`algorithm_version` text NOT NULL,
	`config_version` text DEFAULT 'legacy' NOT NULL,
	`projection_state` text DEFAULT 'active' NOT NULL,
	`updated_by_decision_run_id` text,
	`reason_codes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`updated_by_decision_run_id`) REFERENCES `decision_runs`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "duplicate_clusters_projection_allowed" CHECK("__new_duplicate_clusters"."projection_state" IN ('active', 'superseded'))
);
--> statement-breakpoint
INSERT INTO `__new_duplicate_clusters`("id", "cluster_key", "algorithm_version", "config_version", "projection_state", "updated_by_decision_run_id", "reason_codes", "created_at") SELECT "id", "cluster_key", "algorithm_version", 'legacy', 'active', NULL, "reason_codes", "created_at" FROM `duplicate_clusters`;--> statement-breakpoint
DROP TABLE `duplicate_clusters`;--> statement-breakpoint
ALTER TABLE `__new_duplicate_clusters` RENAME TO `duplicate_clusters`;--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_clusters_key_unique` ON `duplicate_clusters` (`cluster_key`);--> statement-breakpoint
CREATE INDEX `duplicate_clusters_projection_idx` ON `duplicate_clusters` (`projection_state`,`id`);--> statement-breakpoint
CREATE TABLE `__new_listing_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`source_url` text,
	`fixture_asset_label` text,
	`byte_hash` text,
	`perceptual_hash` text,
	`byte_size` integer,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`perceptual_hash_version` text,
	`position` integer NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_photos_reference_required" CHECK("__new_listing_photos"."source_url" IS NOT NULL OR "__new_listing_photos"."fixture_asset_label" IS NOT NULL),
	CONSTRAINT "listing_photos_position_nonnegative" CHECK("__new_listing_photos"."position" >= 0),
	CONSTRAINT "listing_photos_decoded_metadata_consistency" CHECK((("__new_listing_photos"."byte_size" IS NULL) + ("__new_listing_photos"."width" IS NULL) + ("__new_listing_photos"."height" IS NULL) + ("__new_listing_photos"."mime_type" IS NULL)) IN (0, 4)),
	CONSTRAINT "listing_photos_perceptual_version_consistency" CHECK(("__new_listing_photos"."perceptual_hash" IS NULL) = ("__new_listing_photos"."perceptual_hash_version" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_listing_photos`("id", "listing_source_record_id", "source_url", "fixture_asset_label", "byte_hash", "perceptual_hash", "byte_size", "width", "height", "mime_type", "perceptual_hash_version", "position", "observed_at") SELECT "id", "listing_source_record_id", "source_url", "fixture_asset_label", "byte_hash", "perceptual_hash", NULL, NULL, NULL, NULL, CASE WHEN "perceptual_hash" IS NULL THEN NULL ELSE 'legacy' END, "position", "observed_at" FROM `listing_photos`;--> statement-breakpoint
DROP TABLE `listing_photos`;--> statement-breakpoint
ALTER TABLE `__new_listing_photos` RENAME TO `listing_photos`;--> statement-breakpoint
CREATE UNIQUE INDEX `listing_photos_source_position_unique` ON `listing_photos` (`listing_source_record_id`,`position`);--> statement-breakpoint
CREATE INDEX `listing_photos_byte_hash_idx` ON `listing_photos` (`byte_hash`);--> statement-breakpoint
CREATE INDEX `listing_photos_perceptual_hash_idx` ON `listing_photos` (`perceptual_hash_version`,`perceptual_hash`);--> statement-breakpoint
CREATE TABLE `__new_listing_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_listing_id` text NOT NULL,
	`search_profile_id` text,
	`algorithm_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`total_score_basis_points` integer NOT NULL,
	`factors` text NOT NULL,
	`reason_codes` text NOT NULL,
	`computed_at` text NOT NULL,
	`schema_version` text DEFAULT 'listing-score.v1' NOT NULL,
	`decision_run_id` text,
	`eligible` integer,
	`hard_constraints_v2` text,
	`factors_v2` text,
	`base_score_basis_points` integer,
	`stale_penalty_basis_points` integer,
	`low_confidence_penalty_basis_points` integer,
	`risk_penalty_basis_points` integer,
	`final_score_basis_points` integer,
	`explanation` text,
	FOREIGN KEY (`canonical_listing_id`) REFERENCES `canonical_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`search_profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`decision_run_id`) REFERENCES `decision_runs`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_scores_total_range" CHECK("__new_listing_scores"."total_score_basis_points" BETWEEN -10000 AND 10000),
	CONSTRAINT "listing_scores_v2_ranges" CHECK(("__new_listing_scores"."base_score_basis_points" IS NULL OR "__new_listing_scores"."base_score_basis_points" BETWEEN 0 AND 10000)
        AND ("__new_listing_scores"."stale_penalty_basis_points" IS NULL OR "__new_listing_scores"."stale_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("__new_listing_scores"."low_confidence_penalty_basis_points" IS NULL OR "__new_listing_scores"."low_confidence_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("__new_listing_scores"."risk_penalty_basis_points" IS NULL OR "__new_listing_scores"."risk_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("__new_listing_scores"."final_score_basis_points" IS NULL OR "__new_listing_scores"."final_score_basis_points" BETWEEN 0 AND 10000))
);
--> statement-breakpoint
INSERT INTO `__new_listing_scores`("id", "canonical_listing_id", "search_profile_id", "algorithm_version", "input_hash", "total_score_basis_points", "factors", "reason_codes", "computed_at", "schema_version", "decision_run_id", "eligible", "hard_constraints_v2", "factors_v2", "base_score_basis_points", "stale_penalty_basis_points", "low_confidence_penalty_basis_points", "risk_penalty_basis_points", "final_score_basis_points", "explanation") SELECT "id", "canonical_listing_id", "search_profile_id", "algorithm_version", "input_hash", "total_score_basis_points", "factors", "reason_codes", "computed_at", 'listing-score.v1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM `listing_scores`;--> statement-breakpoint
DROP TABLE `listing_scores`;--> statement-breakpoint
ALTER TABLE `__new_listing_scores` RENAME TO `listing_scores`;--> statement-breakpoint
CREATE UNIQUE INDEX `listing_scores_snapshot_unique` ON `listing_scores` (`canonical_listing_id`,`search_profile_id`,`algorithm_version`,`input_hash`);--> statement-breakpoint
CREATE INDEX `listing_scores_current_run_idx` ON `listing_scores` (`decision_run_id`,`canonical_listing_id`);--> statement-breakpoint
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
	`latitude_microdegrees` integer,
	`longitude_microdegrees` integer,
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
      )),
	CONSTRAINT "listing_source_records_coordinate_pair" CHECK(("__new_listing_source_records"."latitude_microdegrees" IS NULL) = ("__new_listing_source_records"."longitude_microdegrees" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_listing_source_records`("id", "raw_listing_id", "source", "source_listing_id", "source_url", "source_posted_at", "contact_channel", "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", "latitude_microdegrees", "longitude_microdegrees", "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "extraction_confidence_basis_points", "completeness_basis_points", "observed_at", "created_at") SELECT "id", "raw_listing_id", "source", "source_listing_id", "source_url", "source_posted_at", "contact_channel", "title", "address_line_1", "address_unit", "address_city", "address_region", "address_postal_code", "address_country_code", "monthly_rent_cents", "recurring_fees_cents", "bedrooms_half_units", "bathrooms_half_units", "square_feet", NULL, NULL, "property_type", "available_on", "lease_term_months", "pet_policy", "amenities", "description", "extraction_confidence_basis_points", "completeness_basis_points", "observed_at", "created_at" FROM `listing_source_records`;--> statement-breakpoint
DROP TABLE `listing_source_records`;--> statement-breakpoint
ALTER TABLE `__new_listing_source_records` RENAME TO `listing_source_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `listing_source_records_raw_listing_unique` ON `listing_source_records` (`raw_listing_id`);--> statement-breakpoint
CREATE INDEX `listing_source_records_source_idx` ON `listing_source_records` (`source`);--> statement-breakpoint
CREATE INDEX `listing_source_records_coordinates_idx` ON `listing_source_records` (`latitude_microdegrees`,`longitude_microdegrees`);--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `schema_version` text DEFAULT 'listing-risk.v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `decision_run_id` text REFERENCES decision_runs(id);--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `algorithm_version` text;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `input_hash` text;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `evidence_v2` text;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `needs_verification` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `risk_signals` ADD `evaluated_at` text;--> statement-breakpoint
DROP INDEX `risk_signals_listing_code_unique`;--> statement-breakpoint
CREATE INDEX `risk_signals_listing_code_idx` ON `risk_signals` (`canonical_listing_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `risk_signals_idempotency_key_unique` ON `risk_signals` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `risk_signals_current_run_idx` ON `risk_signals` (`decision_run_id`,`canonical_listing_id`);--> statement-breakpoint
CREATE TRIGGER `decision_job_attempts_no_update`
BEFORE UPDATE ON `decision_job_attempts`
BEGIN
	SELECT RAISE(ABORT, 'decision job attempts are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `decision_job_attempts_no_delete`
BEFORE DELETE ON `decision_job_attempts`
BEGIN
	SELECT RAISE(ABORT, 'decision job attempts are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `decision_runs_no_update`
BEFORE UPDATE ON `decision_runs`
BEGIN
	SELECT RAISE(ABORT, 'decision runs are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `decision_runs_no_delete`
BEFORE DELETE ON `decision_runs`
BEGIN
	SELECT RAISE(ABORT, 'decision runs are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_pair_evaluations_no_update`
BEFORE UPDATE ON `duplicate_pair_evaluations`
BEGIN
	SELECT RAISE(ABORT, 'duplicate pair evaluations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_pair_evaluations_no_delete`
BEFORE DELETE ON `duplicate_pair_evaluations`
BEGIN
	SELECT RAISE(ABORT, 'duplicate pair evaluations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_overrides_no_update`
BEFORE UPDATE ON `duplicate_overrides`
BEGIN
	SELECT RAISE(ABORT, 'duplicate overrides are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_overrides_no_delete`
BEFORE DELETE ON `duplicate_overrides`
BEGIN
	SELECT RAISE(ABORT, 'duplicate overrides are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_override_revocations_no_update`
BEFORE UPDATE ON `duplicate_override_revocations`
BEGIN
	SELECT RAISE(ABORT, 'duplicate override revocations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `duplicate_override_revocations_no_delete`
BEFORE DELETE ON `duplicate_override_revocations`
BEGIN
	SELECT RAISE(ABORT, 'duplicate override revocations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `canonical_decision_runs_no_update`
BEFORE UPDATE ON `canonical_decision_runs`
BEGIN
	SELECT RAISE(ABORT, 'canonical decision runs are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `canonical_decision_runs_no_delete`
BEFORE DELETE ON `canonical_decision_runs`
BEGIN
	SELECT RAISE(ABORT, 'canonical decision runs are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `listing_scores_no_update`
BEFORE UPDATE ON `listing_scores`
BEGIN
	SELECT RAISE(ABORT, 'listing scores are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `listing_scores_no_delete`
BEFORE DELETE ON `listing_scores`
BEGIN
	SELECT RAISE(ABORT, 'listing scores are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `risk_signals_no_update`
BEFORE UPDATE ON `risk_signals`
BEGIN
	SELECT RAISE(ABORT, 'risk signals are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `risk_signals_no_delete`
BEFORE DELETE ON `risk_signals`
BEGIN
	SELECT RAISE(ABORT, 'risk signals are append-only');
END;
