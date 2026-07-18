CREATE TABLE `browser_nodes` (
	`node_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`status` text NOT NULL,
	`last_heartbeat_at` text NOT NULL,
	`heartbeat_expires_at` text NOT NULL,
	`contract_version` integer NOT NULL,
	`capabilities` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "browser_nodes_status_allowed" CHECK("browser_nodes"."status" IN ('online', 'offline', 'stale', 'revoked')),
	CONSTRAINT "browser_nodes_contract_version_positive" CHECK("browser_nodes"."contract_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `browser_nodes_status_expiry_idx` ON `browser_nodes` (`status`,`heartbeat_expires_at`);--> statement-breakpoint
CREATE TABLE `source_job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`outcome_status` text NOT NULL,
	`error` text,
	`deferred_reason` text,
	`correlation_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	FOREIGN KEY (`source_job_id`) REFERENCES `source_jobs`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "source_job_attempts_number_positive" CHECK("source_job_attempts"."attempt_number" > 0),
	CONSTRAINT "source_job_attempts_outcome_allowed" CHECK("source_job_attempts"."outcome_status" IN ('completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')),
	CONSTRAINT "source_job_attempts_deferred_reason_allowed" CHECK("source_job_attempts"."deferred_reason" IS NULL OR "source_job_attempts"."deferred_reason" IN ('node_unregistered', 'node_offline', 'stale_heartbeat', 'node_revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_job_attempts_job_number_unique` ON `source_job_attempts` (`source_job_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `source_job_attempts_job_idx` ON `source_job_attempts` (`source_job_id`,`attempt_number`);--> statement-breakpoint
CREATE TRIGGER `source_job_attempts_no_update`
BEFORE UPDATE ON `source_job_attempts`
BEGIN
	SELECT RAISE(ABORT, 'source_job_attempts are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `source_job_attempts_no_delete`
BEFORE DELETE ON `source_job_attempts`
BEGIN
	SELECT RAISE(ABORT, 'source_job_attempts are append-only');
END;--> statement-breakpoint
CREATE TABLE `source_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`source` text NOT NULL,
	`acquisition_mode` text NOT NULL,
	`manifest_version` integer NOT NULL,
	`trigger` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`max_attempts` integer NOT NULL,
	`manual_action` text,
	`deferred_reason` text,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "source_jobs_acquisition_mode_allowed" CHECK("source_jobs"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "source_jobs_manifest_version_positive" CHECK("source_jobs"."manifest_version" > 0),
	CONSTRAINT "source_jobs_trigger_allowed" CHECK("source_jobs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "source_jobs_status_allowed" CHECK("source_jobs"."status" IN ('queued', 'dispatched', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')),
	CONSTRAINT "source_jobs_attempts_valid" CHECK("source_jobs"."attempts" >= 0 AND "source_jobs"."max_attempts" > 0 AND "source_jobs"."attempts" <= "source_jobs"."max_attempts"),
	CONSTRAINT "source_jobs_terminal_consistency" CHECK(("source_jobs"."status" IN ('completed', 'permanently_failed', 'cancelled_by_policy')) = ("source_jobs"."completed_at" IS NOT NULL)),
	CONSTRAINT "source_jobs_manual_action_consistency" CHECK(("source_jobs"."status" = 'manual_action_required') = ("source_jobs"."manual_action" IS NOT NULL)),
	CONSTRAINT "source_jobs_deferred_reason_consistency" CHECK(("source_jobs"."status" = 'deferred_node_offline') = ("source_jobs"."deferred_reason" IS NOT NULL)),
	CONSTRAINT "source_jobs_deferred_reason_allowed" CHECK("source_jobs"."deferred_reason" IS NULL OR "source_jobs"."deferred_reason" IN ('node_unregistered', 'node_offline', 'stale_heartbeat', 'node_revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_jobs_idempotency_key_unique` ON `source_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `source_jobs_status_updated_idx` ON `source_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `source_jobs_connector_idx` ON `source_jobs` (`connector_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_source_policy_manifests` (
	`schema_version` integer DEFAULT 2 NOT NULL,
	`connector_id` text NOT NULL,
	`display_name` text DEFAULT 'Sanitized source label' NOT NULL,
	`version` integer NOT NULL,
	`source` text NOT NULL,
	`acquisition_mode` text NOT NULL,
	`policy_state` text NOT NULL,
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
	CONSTRAINT "source_policy_manifests_schema_version_supported" CHECK("__new_source_policy_manifests"."schema_version" = 2),
	CONSTRAINT "source_policy_manifests_acquisition_mode_allowed" CHECK("__new_source_policy_manifests"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "source_policy_manifests_policy_state_allowed" CHECK("__new_source_policy_manifests"."policy_state" IN ('approved', 'user_triggered_only', 'experimental_personal', 'disabled')),
	CONSTRAINT "source_policy_manifests_execution_allowed" CHECK("__new_source_policy_manifests"."execution" IN ('manual', 'scheduled')),
	CONSTRAINT "source_policy_manifests_scheduling_consistency" CHECK("__new_source_policy_manifests"."execution" <> 'scheduled' OR "__new_source_policy_manifests"."minimum_interval_seconds" IS NOT NULL),
	CONSTRAINT "source_policy_manifests_disabled_consistency" CHECK("__new_source_policy_manifests"."policy_state" <> 'disabled' OR "__new_source_policy_manifests"."enabled" = 0),
	CONSTRAINT "source_policy_manifests_user_triggered_consistency" CHECK("__new_source_policy_manifests"."policy_state" <> 'user_triggered_only' OR "__new_source_policy_manifests"."execution" = 'manual'),
	CONSTRAINT "source_policy_manifests_experimental_consistency" CHECK("__new_source_policy_manifests"."policy_state" <> 'experimental_personal' OR "__new_source_policy_manifests"."acquisition_mode" = 'local_browser'),
	CONSTRAINT "source_policy_manifests_concurrency_positive" CHECK("__new_source_policy_manifests"."max_concurrency" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_source_policy_manifests`("schema_version", "connector_id", "display_name", "version", "source", "acquisition_mode", "policy_state", "enabled", "execution", "capabilities", "allowed_operations", "allowed_domains", "allowed_origins", "allowed_http_methods", "requires_user_session", "requires_approval", "minimum_interval_seconds", "max_concurrency", "global_kill_switch_key", "connector_kill_switch_key", "data_classification", "redaction_rules", "manual_blocker_behavior", "owner", "reviewed_at", "decision_record", "notes", "created_at", "updated_at")
SELECT
	2,
	"connector_id",
	"display_name",
	"version",
	"source",
	CASE WHEN "connector_id" = 'manual.capture.v1' THEN 'user_capture' ELSE 'fixture' END,
	CASE
		WHEN "connector_id" = 'fixture.feed.v1' THEN 'approved'
		WHEN "connector_id" = 'manual.capture.v1' THEN 'user_triggered_only'
		ELSE 'disabled'
	END,
	CASE
		WHEN "connector_id" IN ('fixture.feed.v1', 'manual.capture.v1') THEN "enabled"
		ELSE 0
	END,
	"execution",
	"capabilities",
	"allowed_operations",
	"allowed_domains",
	"allowed_origins",
	"allowed_http_methods",
	"requires_user_session",
	"requires_approval",
	"minimum_interval_seconds",
	"max_concurrency",
	"global_kill_switch_key",
	"connector_kill_switch_key",
	"data_classification",
	"redaction_rules",
	"manual_blocker_behavior",
	"owner",
	"reviewed_at",
	"decision_record",
	"notes",
	"created_at",
	"updated_at"
FROM `source_policy_manifests`;--> statement-breakpoint
DROP TABLE `source_policy_manifests`;--> statement-breakpoint
ALTER TABLE `__new_source_policy_manifests` RENAME TO `source_policy_manifests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_raw_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_listing_id` text,
	`source_url` text,
	`acquisition_mode` text NOT NULL,
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
	CONSTRAINT "raw_listings_capture_method_allowed" CHECK("__new_raw_listings"."capture_method" IN ('fixture', 'manual_text', 'manual_structured')),
	CONSTRAINT "raw_listings_acquisition_mode_allowed" CHECK("__new_raw_listings"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "raw_listings_capture_mode_consistency" CHECK(("__new_raw_listings"."capture_method" = 'fixture' AND "__new_raw_listings"."acquisition_mode" = 'fixture')
        OR ("__new_raw_listings"."capture_method" IN ('manual_text', 'manual_structured') AND "__new_raw_listings"."acquisition_mode" = 'user_capture'))
);
--> statement-breakpoint
INSERT INTO `__new_raw_listings`("id", "source", "source_listing_id", "source_url", "acquisition_mode", "capture_method", "observed_at", "source_posted_at", "raw_text", "raw_json", "capture_metadata", "content_hash", "idempotency_key", "created_at")
SELECT
	"id",
	"source",
	"source_listing_id",
	"source_url",
	CASE WHEN "capture_method" = 'fixture' THEN 'fixture' ELSE 'user_capture' END,
	"capture_method",
	"observed_at",
	"source_posted_at",
	"raw_text",
	"raw_json",
	"capture_metadata",
	"content_hash",
	"idempotency_key",
	"created_at"
FROM `raw_listings`;--> statement-breakpoint
DROP TABLE `raw_listings`;--> statement-breakpoint
ALTER TABLE `__new_raw_listings` RENAME TO `raw_listings`;--> statement-breakpoint
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
END;
