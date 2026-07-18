PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "raw_listings_capture_method_allowed" CHECK("__new_raw_listings"."capture_method" IN ('fixture', 'manual_text', 'manual_structured', 'official_api', 'email_alert', 'local_browser')),
	CONSTRAINT "raw_listings_acquisition_mode_allowed" CHECK("__new_raw_listings"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "raw_listings_capture_mode_consistency" CHECK(("__new_raw_listings"."capture_method" = 'fixture' AND "__new_raw_listings"."acquisition_mode" = 'fixture')
        OR ("__new_raw_listings"."capture_method" IN ('manual_text', 'manual_structured') AND "__new_raw_listings"."acquisition_mode" = 'user_capture')
        OR ("__new_raw_listings"."capture_method" = 'official_api' AND "__new_raw_listings"."acquisition_mode" = 'official_api')
        OR ("__new_raw_listings"."capture_method" = 'email_alert' AND "__new_raw_listings"."acquisition_mode" = 'email_alert')
        OR ("__new_raw_listings"."capture_method" = 'local_browser' AND "__new_raw_listings"."acquisition_mode" = 'local_browser'))
);
--> statement-breakpoint
INSERT INTO `__new_raw_listings`("id", "source", "source_listing_id", "source_url", "acquisition_mode", "capture_method", "observed_at", "source_posted_at", "raw_text", "raw_json", "capture_metadata", "content_hash", "idempotency_key", "created_at") SELECT "id", "source", "source_listing_id", "source_url", "acquisition_mode", "capture_method", "observed_at", "source_posted_at", "raw_text", "raw_json", "capture_metadata", "content_hash", "idempotency_key", "created_at" FROM `raw_listings`;--> statement-breakpoint
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
END;--> statement-breakpoint
CREATE TABLE `__new_source_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`source` text NOT NULL,
	`acquisition_mode` text NOT NULL,
	`manifest_version` integer NOT NULL,
	`trigger` text NOT NULL,
	`capability` text NOT NULL,
	`approval_id` text,
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
	CONSTRAINT "source_jobs_acquisition_mode_allowed" CHECK("__new_source_jobs"."acquisition_mode" IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
	CONSTRAINT "source_jobs_manifest_version_positive" CHECK("__new_source_jobs"."manifest_version" > 0),
	CONSTRAINT "source_jobs_trigger_allowed" CHECK("__new_source_jobs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "source_jobs_capability_allowed" CHECK("__new_source_jobs"."capability" IN ('fixture.read', 'manual.capture', 'gmail.alert.read', 'structured_feed.read', 'browser.capture', 'gmail.draft.create', 'calendar.hold.create', 'notification.local')),
	CONSTRAINT "source_jobs_status_allowed" CHECK("__new_source_jobs"."status" IN ('queued', 'dispatched', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'deferred_node_offline', 'manual_action_required', 'cancelled_by_policy')),
	CONSTRAINT "source_jobs_attempts_valid" CHECK("__new_source_jobs"."attempts" >= 0 AND "__new_source_jobs"."max_attempts" > 0 AND "__new_source_jobs"."attempts" <= "__new_source_jobs"."max_attempts"),
	CONSTRAINT "source_jobs_terminal_consistency" CHECK(("__new_source_jobs"."status" IN ('completed', 'permanently_failed', 'cancelled_by_policy')) = ("__new_source_jobs"."completed_at" IS NOT NULL)),
	CONSTRAINT "source_jobs_manual_action_consistency" CHECK(("__new_source_jobs"."status" = 'manual_action_required') = ("__new_source_jobs"."manual_action" IS NOT NULL)),
	CONSTRAINT "source_jobs_deferred_reason_consistency" CHECK(("__new_source_jobs"."status" = 'deferred_node_offline') = ("__new_source_jobs"."deferred_reason" IS NOT NULL)),
	CONSTRAINT "source_jobs_deferred_reason_allowed" CHECK("__new_source_jobs"."deferred_reason" IS NULL OR "__new_source_jobs"."deferred_reason" IN ('node_unregistered', 'node_offline', 'stale_heartbeat', 'node_revoked'))
);
--> statement-breakpoint
INSERT INTO `__new_source_jobs`("id", "correlation_id", "connector_id", "source", "acquisition_mode", "manifest_version", "trigger", "capability", "approval_id", "operation", "payload", "payload_hash", "idempotency_key", "status", "attempts", "max_attempts", "manual_action", "deferred_reason", "result", "created_at", "updated_at", "completed_at")
SELECT
	"id",
	"correlation_id",
	"connector_id",
	"source",
	"acquisition_mode",
	"manifest_version",
	"trigger",
	CASE "acquisition_mode"
		WHEN 'fixture' THEN 'fixture.read'
		WHEN 'user_capture' THEN 'manual.capture'
		WHEN 'email_alert' THEN 'gmail.alert.read'
		WHEN 'official_api' THEN 'structured_feed.read'
		WHEN 'local_browser' THEN 'browser.capture'
	END,
	NULL,
	"operation",
	"payload",
	"payload_hash",
	"idempotency_key",
	"status",
	"attempts",
	"max_attempts",
	"manual_action",
	"deferred_reason",
	"result",
	"created_at",
	"updated_at",
	"completed_at"
FROM `source_jobs`;--> statement-breakpoint
DROP TABLE `source_jobs`;--> statement-breakpoint
ALTER TABLE `__new_source_jobs` RENAME TO `source_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `source_jobs_idempotency_key_unique` ON `source_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `source_jobs_status_updated_idx` ON `source_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `source_jobs_connector_idx` ON `source_jobs` (`connector_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
