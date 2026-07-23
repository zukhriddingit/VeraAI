CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"policy_decision" text NOT NULL,
	"approval_id" text,
	"payload_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"error_category" text,
	"metadata" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_events_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "activity_events_payload_hash_valid" CHECK ("activity_events"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "activity_events_actor_allowed" CHECK ("activity_events"."actor" IN ('user', 'vera', 'connector', 'system')),
	CONSTRAINT "activity_events_policy_allowed" CHECK ("activity_events"."policy_decision" IN ('not_applicable', 'authorized', 'denied')),
	CONSTRAINT "activity_events_outcome_allowed" CHECK ("activity_events"."outcome" IN ('recorded', 'authorized', 'denied', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"actor" text NOT NULL,
	"connector_id" text NOT NULL,
	"operation" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "approvals_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "approvals_actor_user_only" CHECK ("approvals"."actor" = 'user'),
	CONSTRAINT "approvals_state_allowed" CHECK ("approvals"."state" IN ('pending', 'used', 'expired', 'revoked')),
	CONSTRAINT "approvals_payload_hash_valid" CHECK ("approvals"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "browser_nodes" (
	"user_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"heartbeat_expires_at" timestamp with time zone NOT NULL,
	"contract_version" integer NOT NULL,
	"capabilities" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_nodes_user_id_node_id_pk" PRIMARY KEY("user_id","node_id"),
	CONSTRAINT "browser_nodes_status_allowed" CHECK ("browser_nodes"."status" IN ('online', 'offline', 'stale', 'revoked')),
	CONSTRAINT "browser_nodes_contract_version_positive" CHECK ("browser_nodes"."contract_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "canonical_decision_runs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"decision_run_id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"cluster_id" text,
	"primary_source_record_id" text NOT NULL,
	"stitch_version" text NOT NULL,
	"stitch_input_hash" text NOT NULL,
	"member_source_record_ids_json" jsonb NOT NULL,
	"selected_fields_json" jsonb NOT NULL,
	"diagnostics_json" jsonb NOT NULL,
	CONSTRAINT "canonical_decision_runs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "canonical_decision_runs_stitch_hash_valid" CHECK ("canonical_decision_runs"."stitch_input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "canonical_field_sources" (
	"user_id" uuid NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"field_path" text NOT NULL,
	"field_provenance_id" text NOT NULL,
	CONSTRAINT "canonical_field_sources_user_id_canonical_listing_id_field_path_pk" PRIMARY KEY("user_id","canonical_listing_id","field_path")
);
--> statement-breakpoint
CREATE TABLE "canonical_listing_sources" (
	"user_id" uuid NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"is_primary" boolean NOT NULL,
	CONSTRAINT "canonical_listing_sources_user_id_canonical_listing_id_listing_source_record_id_pk" PRIMARY KEY("user_id","canonical_listing_id","listing_source_record_id")
);
--> statement-breakpoint
CREATE TABLE "canonical_listings" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"search_profile_id" text NOT NULL,
	"duplicate_cluster_id" text,
	"primary_source_record_id" text NOT NULL,
	"title" text NOT NULL,
	"address_line_1" text,
	"address_unit" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country_code" text,
	"monthly_rent_cents" integer,
	"recurring_fees_cents" integer,
	"bedrooms_half_units" integer,
	"bathrooms_half_units" integer,
	"square_feet" integer,
	"property_type" text,
	"available_on" date,
	"lease_term_months" integer,
	"pet_policy" jsonb,
	"amenities" jsonb NOT NULL,
	"description" text,
	"lifecycle_state" text NOT NULL,
	"projection_state" text DEFAULT 'active' NOT NULL,
	"superseded_by_id" text,
	"stitch_version" text,
	"stitch_input_hash" text,
	"updated_by_decision_run_id" text,
	"completeness_basis_points" integer NOT NULL,
	"freshest_observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "canonical_listings_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "canonical_listings_lifecycle_allowed" CHECK ("canonical_listings"."lifecycle_state" IN ('new', 'shortlisted', 'draft_ready', 'draft_created', 'draft_rejected', 'replied', 'follow_up_due', 'tour_proposed', 'tour_scheduled', 'toured', 'applying', 'passed', 'dismissed', 'stale', 'unavailable')),
	CONSTRAINT "canonical_listings_completeness_range" CHECK ("canonical_listings"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "canonical_listings_money_nonnegative" CHECK (("canonical_listings"."monthly_rent_cents" IS NULL OR "canonical_listings"."monthly_rent_cents" >= 0)
        AND ("canonical_listings"."recurring_fees_cents" IS NULL OR "canonical_listings"."recurring_fees_cents" >= 0)),
	CONSTRAINT "canonical_listings_projection_allowed" CHECK ("canonical_listings"."projection_state" IN ('active', 'superseded')),
	CONSTRAINT "canonical_listings_projection_redirect_consistency" CHECK (("canonical_listings"."projection_state" = 'active' AND "canonical_listings"."superseded_by_id" IS NULL)
        OR ("canonical_listings"."projection_state" = 'superseded' AND "canonical_listings"."superseded_by_id" IS NOT NULL)),
	CONSTRAINT "canonical_listings_stitch_pair" CHECK (("canonical_listings"."stitch_version" IS NULL) = ("canonical_listings"."stitch_input_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "contact_workflows" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_reference" text,
	"missing_fact_questions" jsonb NOT NULL,
	"draft_reference" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_workflows_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "contact_workflows_state_allowed" CHECK ("contact_workflows"."state" IN ('not_started', 'questions_ready', 'draft_ready', 'draft_created', 'reply_received', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "decision_corpus_state" (
	"user_id" uuid NOT NULL,
	"search_profile_id" text NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_corpus_state_user_id_search_profile_id_pk" PRIMARY KEY("user_id","search_profile_id"),
	CONSTRAINT "decision_corpus_state_revision_nonnegative" CHECK ("decision_corpus_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "decision_job_attempts" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"job_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"error_code" text,
	"duration_milliseconds" integer,
	CONSTRAINT "decision_job_attempts_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "decision_job_attempts_number_positive" CHECK ("decision_job_attempts"."attempt_number" > 0),
	CONSTRAINT "decision_job_attempts_outcome_allowed" CHECK ("decision_job_attempts"."outcome" IS NULL OR "decision_job_attempts"."outcome" IN ('succeeded', 'retryable_failed', 'permanently_failed', 'cancelled', 'lease_lost'))
);
--> statement-breakpoint
CREATE TABLE "decision_jobs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"search_profile_id" text NOT NULL,
	"target_corpus_revision" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"input_hash" text,
	"output_hash" text,
	"attempt_count" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "decision_jobs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "decision_jobs_revision_nonnegative" CHECK ("decision_jobs"."target_corpus_revision" >= 0),
	CONSTRAINT "decision_jobs_trigger_allowed" CHECK ("decision_jobs"."trigger" IN ('normalization', 'manual_recompute', 'seed')),
	CONSTRAINT "decision_jobs_status_allowed" CHECK ("decision_jobs"."status" IN ('queued', 'running', 'succeeded', 'retryable_failed', 'permanently_failed', 'cancelled')),
	CONSTRAINT "decision_jobs_attempt_count_valid" CHECK ("decision_jobs"."attempt_count" BETWEEN 0 AND 100),
	CONSTRAINT "decision_jobs_lease_pair" CHECK (("decision_jobs"."lease_owner" IS NULL) = ("decision_jobs"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "decision_runs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"job_id" text NOT NULL,
	"search_profile_id" text NOT NULL,
	"corpus_revision" integer NOT NULL,
	"plan_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"counts_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_runs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "decision_runs_revision_nonnegative" CHECK ("decision_runs"."corpus_revision" >= 0),
	CONSTRAINT "decision_runs_input_hash_valid" CHECK ("decision_runs"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "decision_runs_output_hash_valid" CHECK ("decision_runs"."output_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "duplicate_clusters" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"search_profile_id" text NOT NULL,
	"cluster_key" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"config_version" text DEFAULT 'legacy' NOT NULL,
	"projection_state" text DEFAULT 'active' NOT NULL,
	"updated_by_decision_run_id" text,
	"reason_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duplicate_clusters_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "duplicate_clusters_projection_allowed" CHECK ("duplicate_clusters"."projection_state" IN ('active', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "duplicate_override_revocations" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"override_id" text NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duplicate_override_revocations_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "duplicate_override_revocations_actor_allowed" CHECK ("duplicate_override_revocations"."created_by" IN ('user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "duplicate_overrides" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"search_profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_record_ids_json" jsonb NOT NULL,
	"survivor_canonical_id" text,
	"reason" text,
	"created_by" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duplicate_overrides_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "duplicate_overrides_kind_allowed" CHECK ("duplicate_overrides"."kind" IN ('force_merge', 'force_split')),
	CONSTRAINT "duplicate_overrides_actor_allowed" CHECK ("duplicate_overrides"."created_by" IN ('user', 'system')),
	CONSTRAINT "duplicate_overrides_payload_hash_valid" CHECK ("duplicate_overrides"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "duplicate_pair_evaluations" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"decision_run_id" text NOT NULL,
	"left_source_record_id" text NOT NULL,
	"right_source_record_id" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"decision" text NOT NULL,
	"score_basis_points" integer,
	"automatic_link_threshold_basis_points" integer NOT NULL,
	"review_threshold_basis_points" integer NOT NULL,
	"exact_reason_codes" jsonb NOT NULL,
	"conflict_reason_codes" jsonb NOT NULL,
	"contact_matched" boolean NOT NULL,
	"features_json" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duplicate_pair_evaluations_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "duplicate_pair_evaluations_ordered_pair" CHECK ("duplicate_pair_evaluations"."left_source_record_id" < "duplicate_pair_evaluations"."right_source_record_id"),
	CONSTRAINT "duplicate_pair_evaluations_decision_allowed" CHECK ("duplicate_pair_evaluations"."decision" IN ('link', 'review', 'separate'))
);
--> statement-breakpoint
CREATE TABLE "field_provenance" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"raw_listing_id" text NOT NULL,
	"field_path" text NOT NULL,
	"extraction_method" text NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"value_status" text DEFAULT 'known' NOT NULL,
	"unknown_reason" text,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence_excerpt" text,
	CONSTRAINT "field_provenance_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "field_provenance_confidence_range" CHECK ("field_provenance"."confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "field_provenance_method_allowed" CHECK ("field_provenance"."extraction_method" IN ('fixture_structured', 'manual', 'rule', 'ai')),
	CONSTRAINT "field_provenance_value_status_allowed" CHECK ("field_provenance"."value_status" IN ('known', 'unknown')),
	CONSTRAINT "field_provenance_unknown_consistency" CHECK (("field_provenance"."value_status" = 'known' AND "field_provenance"."unknown_reason" IS NULL)
        OR ("field_provenance"."value_status" = 'unknown' AND "field_provenance"."confidence_basis_points" = 0
          AND "field_provenance"."unknown_reason" IN ('missing_evidence', 'unrecognized_format', 'not_applicable')))
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject_id" text NOT NULL,
	"display_email" text,
	"credential_version" integer,
	"credential_algorithm" text,
	"credential_key_id" text,
	"credential_nonce" "bytea",
	"credential_ciphertext" "bytea",
	"credential_authentication_tag" "bytea",
	"granted_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"last_successful_use_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "integration_connections_provider_allowed" CHECK ("integration_connections"."provider" IN ('google')),
	CONSTRAINT "integration_connections_status_allowed" CHECK ("integration_connections"."status" IN ('connected', 'partial', 'expired', 'revoked', 'disconnected', 'reconnect_required')),
	CONSTRAINT "integration_connections_credential_all_or_none" CHECK (num_nonnulls("integration_connections"."credential_version", "integration_connections"."credential_algorithm", "integration_connections"."credential_key_id", "integration_connections"."credential_nonce", "integration_connections"."credential_ciphertext", "integration_connections"."credential_authentication_tag") IN (0, 6)),
	CONSTRAINT "integration_connections_disconnected_no_credential" CHECK ("integration_connections"."status" <> 'disconnected' OR "integration_connections"."credential_ciphertext" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "listing_extractions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"raw_listing_id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"mode" text NOT NULL,
	"input_hash" text NOT NULL,
	"requested_fields" jsonb NOT NULL,
	"provider_id" text,
	"model" text,
	"response_id" text,
	"prompt_version" text NOT NULL,
	"extraction_version" text NOT NULL,
	"provider_result" jsonb,
	"merged_extraction" jsonb NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"latency_milliseconds" integer NOT NULL,
	"repair_count" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_extractions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_extractions_mode_allowed" CHECK ("listing_extractions"."mode" IN ('deterministic_only', 'llm_augmented')),
	CONSTRAINT "listing_extractions_input_hash_valid" CHECK ("listing_extractions"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "listing_extractions_metrics_nonnegative" CHECK ("listing_extractions"."input_tokens" >= 0 AND "listing_extractions"."output_tokens" >= 0 AND "listing_extractions"."total_tokens" >= 0
        AND "listing_extractions"."latency_milliseconds" >= 0),
	CONSTRAINT "listing_extractions_token_total_consistency" CHECK ("listing_extractions"."total_tokens" = "listing_extractions"."input_tokens" + "listing_extractions"."output_tokens"),
	CONSTRAINT "listing_extractions_repair_range" CHECK ("listing_extractions"."repair_count" IN (0, 1)),
	CONSTRAINT "listing_extractions_mode_metadata_consistency" CHECK (("listing_extractions"."mode" = 'deterministic_only' AND "listing_extractions"."provider_id" IS NULL
          AND "listing_extractions"."model" IS NULL AND "listing_extractions"."response_id" IS NULL
          AND "listing_extractions"."provider_result" IS NULL AND "listing_extractions"."input_tokens" = 0
          AND "listing_extractions"."output_tokens" = 0 AND "listing_extractions"."total_tokens" = 0
          AND "listing_extractions"."latency_milliseconds" = 0 AND "listing_extractions"."repair_count" = 0)
        OR ("listing_extractions"."mode" = 'llm_augmented' AND "listing_extractions"."provider_id" IS NOT NULL
          AND "listing_extractions"."model" IS NOT NULL AND "listing_extractions"."provider_result" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"source_url" text,
	"fixture_asset_label" text,
	"byte_hash" text,
	"perceptual_hash" text,
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"mime_type" text,
	"perceptual_hash_version" text,
	"position" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_photos_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_photos_reference_required" CHECK ("listing_photos"."source_url" IS NOT NULL OR "listing_photos"."fixture_asset_label" IS NOT NULL),
	CONSTRAINT "listing_photos_position_nonnegative" CHECK ("listing_photos"."position" >= 0),
	CONSTRAINT "listing_photos_decoded_metadata_consistency" CHECK (num_nonnulls("listing_photos"."byte_size", "listing_photos"."width", "listing_photos"."height", "listing_photos"."mime_type") IN (0, 4)),
	CONSTRAINT "listing_photos_perceptual_version_consistency" CHECK (("listing_photos"."perceptual_hash" IS NULL) = ("listing_photos"."perceptual_hash_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "listing_scores" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"search_profile_id" text,
	"algorithm_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"total_score_basis_points" integer NOT NULL,
	"factors" jsonb NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"schema_version" text DEFAULT 'listing-score.v1' NOT NULL,
	"decision_run_id" text,
	"eligible" boolean,
	"hard_constraints_v2" jsonb,
	"factors_v2" jsonb,
	"base_score_basis_points" integer,
	"stale_penalty_basis_points" integer,
	"low_confidence_penalty_basis_points" integer,
	"risk_penalty_basis_points" integer,
	"final_score_basis_points" integer,
	"explanation" text,
	CONSTRAINT "listing_scores_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_scores_total_range" CHECK ("listing_scores"."total_score_basis_points" BETWEEN -10000 AND 10000),
	CONSTRAINT "listing_scores_input_hash_valid" CHECK ("listing_scores"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "listing_scores_v2_ranges" CHECK (("listing_scores"."base_score_basis_points" IS NULL OR "listing_scores"."base_score_basis_points" BETWEEN 0 AND 10000)
        AND ("listing_scores"."stale_penalty_basis_points" IS NULL OR "listing_scores"."stale_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("listing_scores"."low_confidence_penalty_basis_points" IS NULL OR "listing_scores"."low_confidence_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("listing_scores"."risk_penalty_basis_points" IS NULL OR "listing_scores"."risk_penalty_basis_points" BETWEEN 0 AND 10000)
        AND ("listing_scores"."final_score_basis_points" IS NULL OR "listing_scores"."final_score_basis_points" BETWEEN 0 AND 10000))
);
--> statement-breakpoint
CREATE TABLE "listing_source_records" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"raw_listing_id" text NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text,
	"source_url" text,
	"source_posted_at" timestamp with time zone,
	"contact_channel" text DEFAULT 'unknown' NOT NULL,
	"title" text NOT NULL,
	"address_line_1" text,
	"address_unit" text,
	"address_city" text,
	"address_region" text,
	"address_postal_code" text,
	"address_country_code" text,
	"monthly_rent_cents" integer,
	"recurring_fees_cents" integer,
	"bedrooms_half_units" integer,
	"bathrooms_half_units" integer,
	"square_feet" integer,
	"latitude_microdegrees" integer,
	"longitude_microdegrees" integer,
	"property_type" text,
	"available_on" date,
	"lease_term_months" integer,
	"pet_policy" jsonb,
	"amenities" jsonb NOT NULL,
	"description" text,
	"extraction_confidence_basis_points" integer NOT NULL,
	"completeness_basis_points" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_source_records_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_source_records_confidence_range" CHECK ("listing_source_records"."extraction_confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_completeness_range" CHECK ("listing_source_records"."completeness_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "listing_source_records_money_nonnegative" CHECK (("listing_source_records"."monthly_rent_cents" IS NULL OR "listing_source_records"."monthly_rent_cents" >= 0)
        AND ("listing_source_records"."recurring_fees_cents" IS NULL OR "listing_source_records"."recurring_fees_cents" >= 0)),
	CONSTRAINT "listing_source_records_contact_channel_allowed" CHECK ("listing_source_records"."contact_channel" IN ('email', 'phone', 'platform_message', 'website_form', 'other', 'unknown')),
	CONSTRAINT "listing_source_records_coordinate_pair" CHECK (("listing_source_records"."latitude_microdegrees" IS NULL) = ("listing_source_records"."longitude_microdegrees" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "normalization_jobs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"raw_listing_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"job_type" text DEFAULT 'normalize_listing' NOT NULL,
	"state" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_category" text,
	"correlation_id" text NOT NULL,
	"causation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "normalization_jobs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "normalization_jobs_type_allowed" CHECK ("normalization_jobs"."job_type" = 'normalize_listing'),
	CONSTRAINT "normalization_jobs_state_allowed" CHECK ("normalization_jobs"."state" IN ('queued', 'leased', 'completed', 'retryable', 'dead_letter')),
	CONSTRAINT "normalization_jobs_attempts_valid" CHECK ("normalization_jobs"."attempts" >= 0 AND "normalization_jobs"."max_attempts" > 0 AND "normalization_jobs"."attempts" <= "normalization_jobs"."max_attempts"),
	CONSTRAINT "normalization_jobs_lease_consistency" CHECK (("normalization_jobs"."state" = 'leased' AND "normalization_jobs"."lease_owner" IS NOT NULL AND "normalization_jobs"."lease_expires_at" IS NOT NULL)
        OR ("normalization_jobs"."state" <> 'leased' AND "normalization_jobs"."lease_owner" IS NULL AND "normalization_jobs"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "raw_listings" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source" text NOT NULL,
	"source_listing_id" text,
	"source_url" text,
	"acquisition_mode" text NOT NULL,
	"capture_method" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_posted_at" timestamp with time zone,
	"raw_text" text,
	"raw_json" jsonb,
	"capture_metadata" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "raw_listings_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "raw_listings_evidence_required" CHECK ("raw_listings"."raw_text" IS NOT NULL OR "raw_listings"."raw_json" IS NOT NULL),
	CONSTRAINT "raw_listings_content_hash_valid" CHECK ("raw_listings"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "raw_listings_capture_method_allowed" CHECK ("raw_listings"."capture_method" IN ('fixture', 'manual_text', 'manual_structured', 'official_api', 'email_alert', 'local_browser')),
	CONSTRAINT "raw_listings_acquisition_mode_allowed" CHECK ("raw_listings"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "raw_listings_capture_mode_consistency" CHECK (("raw_listings"."capture_method" = 'fixture' AND "raw_listings"."acquisition_mode" = 'fixture')
        OR ("raw_listings"."capture_method" IN ('manual_text', 'manual_structured') AND "raw_listings"."acquisition_mode" = 'user_capture')
        OR ("raw_listings"."capture_method" = 'official_api' AND "raw_listings"."acquisition_mode" = 'official_api')
        OR ("raw_listings"."capture_method" = 'email_alert' AND "raw_listings"."acquisition_mode" = 'email_alert')
        OR ("raw_listings"."capture_method" = 'local_browser' AND "raw_listings"."acquisition_mode" = 'local_browser'))
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"verification_action" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"schema_version" text DEFAULT 'listing-risk.v1' NOT NULL,
	"decision_run_id" text,
	"algorithm_version" text,
	"input_hash" text,
	"idempotency_key" text,
	"evidence_v2" jsonb,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"evaluated_at" timestamp with time zone,
	CONSTRAINT "risk_signals_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "risk_signals_confidence_range" CHECK ("risk_signals"."confidence_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "risk_signals_severity_allowed" CHECK ("risk_signals"."severity" IN ('info', 'low', 'medium', 'high')),
	CONSTRAINT "risk_signals_status_allowed" CHECK ("risk_signals"."status" IN ('open', 'verified', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "search_profiles" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"location_text" text NOT NULL,
	"center_latitude_microdegrees" integer,
	"center_longitude_microdegrees" integer,
	"radius_meters" integer,
	"minimum_bedrooms_half_units" integer,
	"minimum_bathrooms_half_units" integer,
	"target_monthly_total_cents" integer,
	"absolute_monthly_maximum_cents" integer,
	"move_in_earliest" date,
	"move_in_latest" date,
	"pet_requirements" jsonb NOT NULL,
	"commute_anchors" jsonb NOT NULL,
	"hard_constraints" jsonb NOT NULL,
	"weighted_preferences" jsonb NOT NULL,
	"notification_rules" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "search_profiles_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "search_profiles_version_positive" CHECK ("search_profiles"."version" > 0),
	CONSTRAINT "search_profiles_budget_nonnegative" CHECK (("search_profiles"."target_monthly_total_cents" IS NULL OR "search_profiles"."target_monthly_total_cents" >= 0)
        AND ("search_profiles"."absolute_monthly_maximum_cents" IS NULL OR "search_profiles"."absolute_monthly_maximum_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_job_attempts" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source_job_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"outcome_status" text NOT NULL,
	"error" jsonb,
	"deferred_reason" text,
	"correlation_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	CONSTRAINT "source_job_attempts_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "source_job_attempts_number_positive" CHECK ("source_job_attempts"."attempt_number" > 0),
	CONSTRAINT "source_job_attempts_outcome_allowed" CHECK ("source_job_attempts"."outcome_status" IN ('completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy'))
);
--> statement-breakpoint
CREATE TABLE "source_jobs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"source" text NOT NULL,
	"acquisition_mode" text NOT NULL,
	"manifest_version" integer NOT NULL,
	"trigger" text NOT NULL,
	"capability" text NOT NULL,
	"approval_id" text,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"manual_action" jsonb,
	"deferred_reason" text,
	"result" jsonb,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "source_jobs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "source_jobs_acquisition_mode_allowed" CHECK ("source_jobs"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "source_jobs_manifest_version_positive" CHECK ("source_jobs"."manifest_version" > 0),
	CONSTRAINT "source_jobs_trigger_allowed" CHECK ("source_jobs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "source_jobs_status_allowed" CHECK ("source_jobs"."status" IN ('queued', 'dispatched', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')),
	CONSTRAINT "source_jobs_payload_hash_valid" CHECK ("source_jobs"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "source_jobs_attempts_valid" CHECK ("source_jobs"."attempts" >= 0 AND "source_jobs"."max_attempts" > 0 AND "source_jobs"."attempts" <= "source_jobs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "source_policy_manifests" (
	"schema_version" integer DEFAULT 2 NOT NULL,
	"connector_id" text NOT NULL,
	"display_name" text DEFAULT 'Sanitized source label' NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"acquisition_mode" text NOT NULL,
	"policy_state" text NOT NULL,
	"enabled" boolean NOT NULL,
	"execution" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"allowed_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_domains" jsonb NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_http_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_user_session" boolean NOT NULL,
	"requires_approval" boolean NOT NULL,
	"minimum_interval_seconds" integer,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"global_kill_switch_key" text DEFAULT 'integrations.disabled' NOT NULL,
	"connector_kill_switch_key" text DEFAULT 'integrations.legacy_source_labels' NOT NULL,
	"data_classification" text DEFAULT 'synthetic' NOT NULL,
	"redaction_rules" jsonb DEFAULT '["raw_content_from_logs","full_urls_from_logs","contact_details_from_logs","credentials_from_logs"]'::jsonb NOT NULL,
	"manual_blocker_behavior" text DEFAULT 'stop_and_request_user_action' NOT NULL,
	"owner" text DEFAULT 'Vera maintainers' NOT NULL,
	"reviewed_at" date DEFAULT '2026-07-17' NOT NULL,
	"decision_record" text DEFAULT 'docs/DECISIONS/0004-fail-closed-connectors.md' NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_policy_manifests_connector_id_version_pk" PRIMARY KEY("connector_id","version"),
	CONSTRAINT "source_policy_manifests_version_positive" CHECK ("source_policy_manifests"."version" > 0),
	CONSTRAINT "source_policy_manifests_schema_version_supported" CHECK ("source_policy_manifests"."schema_version" = 2),
	CONSTRAINT "source_policy_manifests_acquisition_mode_allowed" CHECK ("source_policy_manifests"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "source_policy_manifests_policy_state_allowed" CHECK ("source_policy_manifests"."policy_state" IN ('approved', 'user_triggered_only', 'experimental_personal', 'disabled')),
	CONSTRAINT "source_policy_manifests_execution_allowed" CHECK ("source_policy_manifests"."execution" IN ('manual', 'scheduled')),
	CONSTRAINT "source_policy_manifests_scheduling_consistency" CHECK ("source_policy_manifests"."execution" <> 'scheduled' OR "source_policy_manifests"."minimum_interval_seconds" IS NOT NULL),
	CONSTRAINT "source_policy_manifests_disabled_consistency" CHECK ("source_policy_manifests"."policy_state" <> 'disabled' OR "source_policy_manifests"."enabled" = false),
	CONSTRAINT "source_policy_manifests_user_triggered_consistency" CHECK ("source_policy_manifests"."policy_state" <> 'user_triggered_only' OR "source_policy_manifests"."execution" = 'manual'),
	CONSTRAINT "source_policy_manifests_experimental_consistency" CHECK ("source_policy_manifests"."policy_state" <> 'experimental_personal' OR "source_policy_manifests"."acquisition_mode" = 'local_browser'),
	CONSTRAINT "source_policy_manifests_concurrency_positive" CHECK ("source_policy_manifests"."max_concurrency" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewings" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"proposed_windows" jsonb NOT NULL,
	"confirmed_window" jsonb,
	"time_zone" text NOT NULL,
	"calendar_reference" text,
	"state" text NOT NULL,
	"notes" text,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "viewings_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "viewings_state_allowed" CHECK ("viewings"."state" IN ('proposed', 'selected', 'hold_approved', 'hold_created', 'confirmed', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_approval_tenant_fk" FOREIGN KEY ("user_id","approval_id") REFERENCES "approvals"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_decision_runs" ADD CONSTRAINT "canonical_decision_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_decision_runs" ADD CONSTRAINT "canonical_decision_runs_run_tenant_fk" FOREIGN KEY ("user_id","decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_decision_runs" ADD CONSTRAINT "canonical_decision_runs_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_decision_runs" ADD CONSTRAINT "canonical_decision_runs_primary_source_tenant_fk" FOREIGN KEY ("user_id","primary_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_field_sources" ADD CONSTRAINT "canonical_field_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_field_sources" ADD CONSTRAINT "canonical_field_sources_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_field_sources" ADD CONSTRAINT "canonical_field_sources_provenance_tenant_fk" FOREIGN KEY ("user_id","field_provenance_id") REFERENCES "field_provenance"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listing_sources" ADD CONSTRAINT "canonical_listing_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listing_sources" ADD CONSTRAINT "canonical_listing_sources_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listing_sources" ADD CONSTRAINT "canonical_listing_sources_source_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listings" ADD CONSTRAINT "canonical_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listings" ADD CONSTRAINT "canonical_listings_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listings" ADD CONSTRAINT "canonical_listings_cluster_tenant_fk" FOREIGN KEY ("user_id","duplicate_cluster_id") REFERENCES "duplicate_clusters"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listings" ADD CONSTRAINT "canonical_listings_primary_source_tenant_fk" FOREIGN KEY ("user_id","primary_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "canonical_listings" ADD CONSTRAINT "canonical_listings_decision_run_tenant_fk" FOREIGN KEY ("user_id","updated_by_decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contact_workflows" ADD CONSTRAINT "contact_workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "contact_workflows" ADD CONSTRAINT "contact_workflows_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_corpus_state" ADD CONSTRAINT "decision_corpus_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_corpus_state" ADD CONSTRAINT "decision_corpus_state_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_job_attempts" ADD CONSTRAINT "decision_job_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_job_attempts" ADD CONSTRAINT "decision_job_attempts_job_tenant_fk" FOREIGN KEY ("user_id","job_id") REFERENCES "decision_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_jobs" ADD CONSTRAINT "decision_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_jobs" ADD CONSTRAINT "decision_jobs_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_job_tenant_fk" FOREIGN KEY ("user_id","job_id") REFERENCES "decision_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "decision_runs" ADD CONSTRAINT "decision_runs_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_clusters" ADD CONSTRAINT "duplicate_clusters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_clusters" ADD CONSTRAINT "duplicate_clusters_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_clusters" ADD CONSTRAINT "duplicate_clusters_decision_run_tenant_fk" FOREIGN KEY ("user_id","updated_by_decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_override_revocations" ADD CONSTRAINT "duplicate_override_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_override_revocations" ADD CONSTRAINT "duplicate_override_revocations_override_tenant_fk" FOREIGN KEY ("user_id","override_id") REFERENCES "duplicate_overrides"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_overrides" ADD CONSTRAINT "duplicate_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_overrides" ADD CONSTRAINT "duplicate_overrides_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_pair_evaluations" ADD CONSTRAINT "duplicate_pair_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_pair_evaluations" ADD CONSTRAINT "duplicate_pair_evaluations_run_tenant_fk" FOREIGN KEY ("user_id","decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_pair_evaluations" ADD CONSTRAINT "duplicate_pair_evaluations_left_tenant_fk" FOREIGN KEY ("user_id","left_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "duplicate_pair_evaluations" ADD CONSTRAINT "duplicate_pair_evaluations_right_tenant_fk" FOREIGN KEY ("user_id","right_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_extractions" ADD CONSTRAINT "listing_extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_extractions" ADD CONSTRAINT "listing_extractions_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_extractions" ADD CONSTRAINT "listing_extractions_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_scores" ADD CONSTRAINT "listing_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_scores" ADD CONSTRAINT "listing_scores_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_scores" ADD CONSTRAINT "listing_scores_profile_tenant_fk" FOREIGN KEY ("user_id","search_profile_id") REFERENCES "search_profiles"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_scores" ADD CONSTRAINT "listing_scores_run_tenant_fk" FOREIGN KEY ("user_id","decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_source_records" ADD CONSTRAINT "listing_source_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_source_records" ADD CONSTRAINT "listing_source_records_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "normalization_jobs" ADD CONSTRAINT "normalization_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "normalization_jobs" ADD CONSTRAINT "normalization_jobs_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "raw_listings" ADD CONSTRAINT "raw_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_run_tenant_fk" FOREIGN KEY ("user_id","decision_run_id") REFERENCES "decision_runs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "source_job_attempts" ADD CONSTRAINT "source_job_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "source_job_attempts" ADD CONSTRAINT "source_job_attempts_job_tenant_fk" FOREIGN KEY ("user_id","source_job_id") REFERENCES "source_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "source_jobs" ADD CONSTRAINT "source_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "source_jobs" ADD CONSTRAINT "source_jobs_approval_tenant_fk" FOREIGN KEY ("user_id","approval_id") REFERENCES "approvals"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_events_user_correlation_idx" ON "activity_events" USING btree ("user_id","correlation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "browser_nodes_user_status_expiry_idx" ON "browser_nodes" USING btree ("user_id","status","heartbeat_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_decision_runs_user_run_listing_unique" ON "canonical_decision_runs" USING btree ("user_id","decision_run_id","canonical_listing_id");--> statement-breakpoint
CREATE INDEX "canonical_field_sources_user_provenance_idx" ON "canonical_field_sources" USING btree ("user_id","field_provenance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_listing_sources_user_source_unique" ON "canonical_listing_sources" USING btree ("user_id","listing_source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_listings_user_duplicate_cluster_unique" ON "canonical_listings" USING btree ("user_id","duplicate_cluster_id");--> statement-breakpoint
CREATE INDEX "canonical_listings_user_projection_idx" ON "canonical_listings" USING btree ("user_id","projection_state","freshest_observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_workflows_user_listing_unique" ON "contact_workflows" USING btree ("user_id","canonical_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_job_attempts_user_job_number_unique" ON "decision_job_attempts" USING btree ("user_id","job_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_jobs_user_profile_revision_unique" ON "decision_jobs" USING btree ("user_id","search_profile_id","target_corpus_revision");--> statement-breakpoint
CREATE INDEX "decision_jobs_claim_idx" ON "decision_jobs" USING btree ("status","available_at","created_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_runs_user_job_unique" ON "decision_runs" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_runs_user_profile_revision_input_unique" ON "decision_runs" USING btree ("user_id","search_profile_id","corpus_revision","input_hash");--> statement-breakpoint
CREATE INDEX "decision_runs_user_profile_revision_idx" ON "decision_runs" USING btree ("user_id","search_profile_id","corpus_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_clusters_user_key_unique" ON "duplicate_clusters" USING btree ("user_id","cluster_key");--> statement-breakpoint
CREATE INDEX "duplicate_clusters_user_projection_idx" ON "duplicate_clusters" USING btree ("user_id","projection_state","id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_override_revocations_user_override_unique" ON "duplicate_override_revocations" USING btree ("user_id","override_id");--> statement-breakpoint
CREATE INDEX "duplicate_overrides_user_profile_created_idx" ON "duplicate_overrides" USING btree ("user_id","search_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_evaluations_user_run_pair_unique" ON "duplicate_pair_evaluations" USING btree ("user_id","decision_run_id","left_source_record_id","right_source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_provenance_user_source_field_unique" ON "field_provenance" USING btree ("user_id","listing_source_record_id","field_path");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_user_provider_subject_unique" ON "integration_connections" USING btree ("user_id","provider","provider_subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_extractions_user_raw_listing_unique" ON "listing_extractions" USING btree ("user_id","raw_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_extractions_user_source_record_unique" ON "listing_extractions" USING btree ("user_id","listing_source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_photos_user_source_position_unique" ON "listing_photos" USING btree ("user_id","listing_source_record_id","position");--> statement-breakpoint
CREATE INDEX "listing_photos_user_byte_hash_idx" ON "listing_photos" USING btree ("user_id","byte_hash");--> statement-breakpoint
CREATE INDEX "listing_photos_user_perceptual_hash_idx" ON "listing_photos" USING btree ("user_id","perceptual_hash_version","perceptual_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_scores_user_snapshot_unique" ON "listing_scores" USING btree ("user_id","canonical_listing_id","search_profile_id","algorithm_version","input_hash");--> statement-breakpoint
CREATE INDEX "listing_scores_user_current_run_idx" ON "listing_scores" USING btree ("user_id","decision_run_id","canonical_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_source_records_user_raw_listing_unique" ON "listing_source_records" USING btree ("user_id","raw_listing_id");--> statement-breakpoint
CREATE INDEX "listing_source_records_user_source_idx" ON "listing_source_records" USING btree ("user_id","source");--> statement-breakpoint
CREATE INDEX "listing_source_records_user_coordinates_idx" ON "listing_source_records" USING btree ("user_id","latitude_microdegrees","longitude_microdegrees");--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_jobs_user_raw_listing_unique" ON "normalization_jobs" USING btree ("user_id","raw_listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_jobs_user_idempotency_key_unique" ON "normalization_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "normalization_jobs_claim_idx" ON "normalization_jobs" USING btree ("state","available_at","created_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_listings_user_idempotency_key_unique" ON "raw_listings" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "raw_listings_user_source_identity_idx" ON "raw_listings" USING btree ("user_id","source","source_listing_id");--> statement-breakpoint
CREATE INDEX "risk_signals_user_listing_code_idx" ON "risk_signals" USING btree ("user_id","canonical_listing_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_signals_user_idempotency_key_unique" ON "risk_signals" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "search_profiles_user_name_version_unique" ON "search_profiles" USING btree ("user_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_job_attempts_user_job_number_unique" ON "source_job_attempts" USING btree ("user_id","source_job_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "source_jobs_user_idempotency_key_unique" ON "source_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "source_jobs_claim_idx" ON "source_jobs" USING btree ("status","available_at","created_at","user_id");--> statement-breakpoint
CREATE INDEX "source_jobs_user_connector_idx" ON "source_jobs" USING btree ("user_id","connector_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE FUNCTION "vera_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "raw_listings_append_only" BEFORE UPDATE OR DELETE ON "raw_listings"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "activity_events_append_only" BEFORE UPDATE OR DELETE ON "activity_events"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "source_job_attempts_append_only" BEFORE UPDATE OR DELETE ON "source_job_attempts"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "decision_job_attempts_append_only" BEFORE UPDATE OR DELETE ON "decision_job_attempts"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "listing_extractions_append_only" BEFORE UPDATE OR DELETE ON "listing_extractions"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "decision_runs_append_only" BEFORE UPDATE OR DELETE ON "decision_runs"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "duplicate_pair_evaluations_append_only" BEFORE UPDATE OR DELETE ON "duplicate_pair_evaluations"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "duplicate_overrides_append_only" BEFORE UPDATE OR DELETE ON "duplicate_overrides"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "duplicate_override_revocations_append_only" BEFORE UPDATE OR DELETE ON "duplicate_override_revocations"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "canonical_decision_runs_append_only" BEFORE UPDATE OR DELETE ON "canonical_decision_runs"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "listing_scores_append_only" BEFORE UPDATE OR DELETE ON "listing_scores"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "risk_signals_append_only" BEFORE UPDATE OR DELETE ON "risk_signals"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();
