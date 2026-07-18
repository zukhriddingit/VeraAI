CREATE TABLE `listing_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_listing_id` text NOT NULL,
	`listing_source_record_id` text NOT NULL,
	`mode` text NOT NULL,
	`input_hash` text NOT NULL,
	`requested_fields` text NOT NULL,
	`provider_id` text,
	`model` text,
	`response_id` text,
	`prompt_version` text NOT NULL,
	`extraction_version` text NOT NULL,
	`provider_result` text,
	`merged_extraction` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	`latency_milliseconds` integer NOT NULL,
	`repair_count` integer NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`raw_listing_id`) REFERENCES `raw_listings`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`listing_source_record_id`) REFERENCES `listing_source_records`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "listing_extractions_mode_allowed" CHECK("listing_extractions"."mode" IN ('deterministic_only', 'llm_augmented')),
	CONSTRAINT "listing_extractions_input_hash_valid" CHECK(length("listing_extractions"."input_hash") = 64 AND "listing_extractions"."input_hash" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "listing_extractions_metrics_nonnegative" CHECK("listing_extractions"."input_tokens" >= 0
        AND "listing_extractions"."output_tokens" >= 0
        AND "listing_extractions"."total_tokens" >= 0
        AND "listing_extractions"."latency_milliseconds" >= 0),
	CONSTRAINT "listing_extractions_token_total_consistency" CHECK("listing_extractions"."total_tokens" = "listing_extractions"."input_tokens" + "listing_extractions"."output_tokens"),
	CONSTRAINT "listing_extractions_repair_range" CHECK("listing_extractions"."repair_count" IN (0, 1)),
	CONSTRAINT "listing_extractions_mode_metadata_consistency" CHECK((
        "listing_extractions"."mode" = 'deterministic_only'
        AND "listing_extractions"."provider_id" IS NULL
        AND "listing_extractions"."model" IS NULL
        AND "listing_extractions"."response_id" IS NULL
        AND "listing_extractions"."provider_result" IS NULL
        AND "listing_extractions"."input_tokens" = 0
        AND "listing_extractions"."output_tokens" = 0
        AND "listing_extractions"."total_tokens" = 0
        AND "listing_extractions"."latency_milliseconds" = 0
        AND "listing_extractions"."repair_count" = 0
      ) OR (
        "listing_extractions"."mode" = 'llm_augmented'
        AND "listing_extractions"."provider_id" IS NOT NULL
        AND "listing_extractions"."model" IS NOT NULL
        AND "listing_extractions"."provider_result" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_extractions_raw_listing_unique` ON `listing_extractions` (`raw_listing_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `listing_extractions_source_record_unique` ON `listing_extractions` (`listing_source_record_id`);--> statement-breakpoint
CREATE TRIGGER `listing_extractions_no_update`
BEFORE UPDATE ON `listing_extractions`
BEGIN
	SELECT RAISE(ABORT, 'listing_extractions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `listing_extractions_no_delete`
BEFORE DELETE ON `listing_extractions`
BEGIN
	SELECT RAISE(ABORT, 'listing_extractions are append-only');
END;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_normalization_jobs` (
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
	CONSTRAINT "normalization_jobs_type_allowed" CHECK("__new_normalization_jobs"."job_type" = 'normalize_listing'),
	CONSTRAINT "normalization_jobs_state_allowed" CHECK("__new_normalization_jobs"."state" IN ('queued', 'leased', 'completed', 'retryable', 'dead_letter')),
	CONSTRAINT "normalization_jobs_attempts_valid" CHECK("__new_normalization_jobs"."attempts" >= 0 AND "__new_normalization_jobs"."max_attempts" > 0 AND "__new_normalization_jobs"."attempts" <= "__new_normalization_jobs"."max_attempts"),
	CONSTRAINT "normalization_jobs_attempt_state_consistency" CHECK((
        "__new_normalization_jobs"."state" = 'queued' AND "__new_normalization_jobs"."attempts" = 0
      ) OR (
        "__new_normalization_jobs"."state" IN ('leased', 'completed') AND "__new_normalization_jobs"."attempts" >= 1
      ) OR (
        "__new_normalization_jobs"."state" = 'retryable'
        AND "__new_normalization_jobs"."attempts" >= 1
        AND "__new_normalization_jobs"."attempts" < "__new_normalization_jobs"."max_attempts"
      ) OR (
        "__new_normalization_jobs"."state" = 'dead_letter'
        AND "__new_normalization_jobs"."attempts" >= 1
        AND "__new_normalization_jobs"."attempts" <= "__new_normalization_jobs"."max_attempts"
      )),
	CONSTRAINT "normalization_jobs_lease_consistency" CHECK((
        "__new_normalization_jobs"."state" = 'leased'
        AND "__new_normalization_jobs"."lease_owner" IS NOT NULL
        AND "__new_normalization_jobs"."lease_expires_at" IS NOT NULL
      ) OR (
        "__new_normalization_jobs"."state" <> 'leased'
        AND "__new_normalization_jobs"."lease_owner" IS NULL
        AND "__new_normalization_jobs"."lease_expires_at" IS NULL
      )),
	CONSTRAINT "normalization_jobs_completion_consistency" CHECK((
        "__new_normalization_jobs"."state" = 'completed'
        AND "__new_normalization_jobs"."completed_at" IS NOT NULL
      ) OR (
        "__new_normalization_jobs"."state" <> 'completed'
        AND "__new_normalization_jobs"."completed_at" IS NULL
      )),
	CONSTRAINT "normalization_jobs_error_pair_consistency" CHECK(("__new_normalization_jobs"."last_error_code" IS NULL) = ("__new_normalization_jobs"."last_error_category" IS NULL)),
	CONSTRAINT "normalization_jobs_error_state_consistency" CHECK((
        "__new_normalization_jobs"."state" IN ('queued', 'completed')
        AND "__new_normalization_jobs"."last_error_code" IS NULL
      ) OR (
        "__new_normalization_jobs"."state" IN ('retryable', 'dead_letter')
        AND "__new_normalization_jobs"."last_error_code" IS NOT NULL
      ) OR "__new_normalization_jobs"."state" = 'leased')
);
--> statement-breakpoint
INSERT INTO `__new_normalization_jobs`("id", "raw_listing_id", "idempotency_key", "job_type", "state", "available_at", "attempts", "max_attempts", "lease_owner", "lease_expires_at", "last_error_code", "last_error_category", "correlation_id", "causation_id", "created_at", "updated_at", "completed_at") SELECT "id", "raw_listing_id", "idempotency_key", "job_type", "state", "available_at", "attempts", "max_attempts", "lease_owner", "lease_expires_at", "last_error_code", "last_error_category", "correlation_id", "causation_id", "created_at", "updated_at", "completed_at" FROM `normalization_jobs`;--> statement-breakpoint
DROP TABLE `normalization_jobs`;--> statement-breakpoint
ALTER TABLE `__new_normalization_jobs` RENAME TO `normalization_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_jobs_raw_listing_unique` ON `normalization_jobs` (`raw_listing_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_jobs_idempotency_key_unique` ON `normalization_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `normalization_jobs_claim_idx` ON `normalization_jobs` (`state`,`available_at`,`created_at`);
