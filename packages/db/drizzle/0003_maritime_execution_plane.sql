CREATE TABLE "gmail_alert_cursors" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source_configuration_id" text NOT NULL,
	"history_id" text,
	"last_successful_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gmail_alert_cursors_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "gmail_alert_cursors_history_id_valid" CHECK ("gmail_alert_cursors"."history_id" IS NULL OR "gmail_alert_cursors"."history_id" ~ '^[0-9]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "gmail_alert_external_references" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"history_id" text,
	"raw_listing_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gmail_alert_external_references_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "gmail_alert_external_references_history_valid" CHECK ("gmail_alert_external_references"."history_id" IS NULL OR "gmail_alert_external_references"."history_id" ~ '^[0-9]{1,64}$'),
	CONSTRAINT "gmail_alert_external_references_content_hash_valid" CHECK ("gmail_alert_external_references"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_states" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_hash" text NOT NULL,
	"redirect_path" text NOT NULL,
	"requested_scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "gmail_oauth_states_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "gmail_oauth_states_state_hash_valid" CHECK ("gmail_oauth_states"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "gmail_oauth_states_verifier_hash_valid" CHECK ("gmail_oauth_states"."code_verifier_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "gmail_oauth_states_redirect_path" CHECK ("gmail_oauth_states"."redirect_path" = '/settings/integrations'),
	CONSTRAINT "gmail_oauth_states_scopes_exact" CHECK ("gmail_oauth_states"."requested_scopes" = ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[]),
	CONSTRAINT "gmail_oauth_states_expiry_order" CHECK ("gmail_oauth_states"."expires_at" > "gmail_oauth_states"."created_at")
);
--> statement-breakpoint
CREATE TABLE "maritime_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"maritime_agent_id" text NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"version" text NOT NULL,
	"diagnostic_url" text,
	"last_checked_at" timestamp with time zone,
	"safe_error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "maritime_deployments_kind_allowed" CHECK ("maritime_deployments"."kind" IN ('vera_worker', 'openclaw_gateway')),
	CONSTRAINT "maritime_deployments_environment_allowed" CHECK ("maritime_deployments"."environment" IN ('development', 'staging', 'production')),
	CONSTRAINT "maritime_deployments_status_allowed" CHECK ("maritime_deployments"."status" IN ('unknown', 'sleeping', 'starting', 'running', 'restarting', 'unavailable', 'configuration_error', 'authentication_error')),
	CONSTRAINT "maritime_deployments_timestamp_order" CHECK ("maritime_deployments"."updated_at" >= "maritime_deployments"."created_at")
);
--> statement-breakpoint
CREATE TABLE "maritime_dispatches" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source_job_id" text NOT NULL,
	"issuer" text NOT NULL,
	"audience" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text NOT NULL,
	"maritime_agent_id" text NOT NULL,
	"maritime_run_id" text,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "maritime_dispatches_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "maritime_dispatches_issuer_vera" CHECK ("maritime_dispatches"."issuer" = 'vera-control-plane'),
	CONSTRAINT "maritime_dispatches_nonce_hash_valid" CHECK ("maritime_dispatches"."nonce_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "maritime_dispatches_payload_hash_valid" CHECK ("maritime_dispatches"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "maritime_dispatches_state_allowed" CHECK ("maritime_dispatches"."state" IN ('pending_wake', 'accepted', 'consumed', 'expired', 'rejected')),
	CONSTRAINT "maritime_dispatches_expiry_order" CHECK ("maritime_dispatches"."expires_at" > "maritime_dispatches"."issued_at"),
	CONSTRAINT "maritime_dispatches_rejection_consistency" CHECK (("maritime_dispatches"."state" = 'rejected') = ("maritime_dispatches"."rejected_at" IS NOT NULL AND "maritime_dispatches"."rejection_code" IS NOT NULL)),
	CONSTRAINT "maritime_dispatches_consumption_consistency" CHECK ("maritime_dispatches"."state" <> 'consumed' OR ("maritime_dispatches"."accepted_at" IS NOT NULL AND "maritime_dispatches"."consumed_at" IS NOT NULL)),
	CONSTRAINT "maritime_dispatches_timestamp_order" CHECK ("maritime_dispatches"."updated_at" >= "maritime_dispatches"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"canonical_listing_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"safe_error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_deliveries_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "notification_deliveries_idempotency_valid" CHECK ("notification_deliveries"."idempotency_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "notification_deliveries_payload_hash_valid" CHECK ("notification_deliveries"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "notification_deliveries_payload_object" CHECK (jsonb_typeof("notification_deliveries"."payload") = 'object'),
	CONSTRAINT "notification_deliveries_state_allowed" CHECK ("notification_deliveries"."state" IN ('queued', 'leased', 'deferred_quiet_hours', 'deferred_rate_limit', 'delivered', 'retryable_failed', 'permanently_failed', 'cancelled_by_policy')),
	CONSTRAINT "notification_deliveries_attempt_range" CHECK ("notification_deliveries"."attempt_count" BETWEEN 0 AND 20),
	CONSTRAINT "notification_deliveries_lease_consistency" CHECK (("notification_deliveries"."state" = 'leased' AND "notification_deliveries"."lease_owner" IS NOT NULL AND "notification_deliveries"."lease_expires_at" IS NOT NULL) OR ("notification_deliveries"."state" <> 'leased' AND "notification_deliveries"."lease_owner" IS NULL AND "notification_deliveries"."lease_expires_at" IS NULL)),
	CONSTRAINT "notification_deliveries_delivered_consistency" CHECK (("notification_deliveries"."state" = 'delivered') = ("notification_deliveries"."delivered_at" IS NOT NULL)),
	CONSTRAINT "notification_deliveries_timestamp_order" CHECK ("notification_deliveries"."updated_at" >= "notification_deliveries"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification_digest_items" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"notification_delivery_id" text NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "notification_digest_items_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"score_threshold" integer NOT NULL,
	"freshness_minutes" integer NOT NULL,
	"risk_ceiling" text NOT NULL,
	"timezone" text NOT NULL,
	"quiet_hours_start" text NOT NULL,
	"quiet_hours_end" text NOT NULL,
	"hourly_limit" integer NOT NULL,
	"digest_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_preferences_score_range" CHECK ("notification_preferences"."score_threshold" BETWEEN 0 AND 100),
	CONSTRAINT "notification_preferences_freshness_range" CHECK ("notification_preferences"."freshness_minutes" BETWEEN 1 AND 43200),
	CONSTRAINT "notification_preferences_risk_allowed" CHECK ("notification_preferences"."risk_ceiling" IN ('none', 'low', 'medium', 'high')),
	CONSTRAINT "notification_preferences_quiet_start_valid" CHECK ("notification_preferences"."quiet_hours_start" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_preferences_quiet_end_valid" CHECK ("notification_preferences"."quiet_hours_end" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_preferences_hourly_range" CHECK ("notification_preferences"."hourly_limit" BETWEEN 1 AND 60),
	CONSTRAINT "notification_preferences_timestamp_order" CHECK ("notification_preferences"."updated_at" >= "notification_preferences"."created_at")
);
--> statement-breakpoint
CREATE TABLE "production_schedule_runs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"state" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_job_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"safe_error_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "production_schedule_runs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "production_schedule_runs_idempotency_valid" CHECK ("production_schedule_runs"."idempotency_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "production_schedule_runs_state_allowed" CHECK ("production_schedule_runs"."state" IN ('created', 'running', 'completed', 'retryable_failed', 'permanently_failed', 'cancelled_by_policy')),
	CONSTRAINT "production_schedule_runs_attempts_valid" CHECK ("production_schedule_runs"."attempt_count" >= 0 AND "production_schedule_runs"."attempt_count" <= 100),
	CONSTRAINT "production_schedule_runs_timestamp_order" CHECK ("production_schedule_runs"."updated_at" >= "production_schedule_runs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "production_schedules" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"source_configuration_id" text,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "production_schedules_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "production_schedules_kind_allowed" CHECK ("production_schedules"."kind" IN ('gmail_alert_ingestion', 'normalization_reconciliation', 'decision_reconciliation', 'stale_listing_check', 'notification_fanout', 'health_reconciliation', 'ephemeral_cleanup')),
	CONSTRAINT "production_schedules_state_allowed" CHECK ("production_schedules"."state" IN ('enabled', 'paused', 'disabled_by_policy')),
	CONSTRAINT "production_schedules_interval_range" CHECK ("production_schedules"."interval_seconds" BETWEEN 60 AND 31536000),
	CONSTRAINT "production_schedules_timestamp_order" CHECK ("production_schedules"."updated_at" >= "production_schedules"."created_at")
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"deployment_id" text NOT NULL,
	"status" text NOT NULL,
	"version" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"safe_code" text,
	CONSTRAINT "service_heartbeats_service_allowed" CHECK ("service_heartbeats"."service" IN ('vera-worker', 'openclaw-gateway')),
	CONSTRAINT "service_heartbeats_status_allowed" CHECK ("service_heartbeats"."status" IN ('ready', 'degraded', 'unavailable')),
	CONSTRAINT "service_heartbeats_expiry_order" CHECK ("service_heartbeats"."expires_at" > "service_heartbeats"."checked_at")
);
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"endpoint_hash" text NOT NULL,
	"credential_version" integer NOT NULL,
	"credential_algorithm" text NOT NULL,
	"credential_key_id" text NOT NULL,
	"credential_nonce" "bytea" NOT NULL,
	"credential_ciphertext" "bytea" NOT NULL,
	"credential_authentication_tag" "bytea" NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "web_push_subscriptions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "web_push_subscriptions_endpoint_hash_valid" CHECK ("web_push_subscriptions"."endpoint_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "web_push_subscriptions_credential_version" CHECK ("web_push_subscriptions"."credential_version" = 1),
	CONSTRAINT "web_push_subscriptions_credential_algorithm" CHECK ("web_push_subscriptions"."credential_algorithm" = 'aes-256-gcm'),
	CONSTRAINT "web_push_subscriptions_status_allowed" CHECK ("web_push_subscriptions"."status" IN ('active', 'revoked', 'disabled')),
	CONSTRAINT "web_push_subscriptions_revocation_consistency" CHECK (("web_push_subscriptions"."status" = 'revoked') = ("web_push_subscriptions"."revoked_at" IS NOT NULL)),
	CONSTRAINT "web_push_subscriptions_timestamp_order" CHECK ("web_push_subscriptions"."updated_at" >= "web_push_subscriptions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "browser_nodes" DROP CONSTRAINT "browser_nodes_expected_version_pinned";--> statement-breakpoint
UPDATE "browser_nodes"
SET "expected_openclaw_version" = '2026.6.33',
	"version_compatibility" = 'unknown',
	"updated_at" = GREATEST("updated_at", CURRENT_TIMESTAMP)
WHERE "expected_openclaw_version" <> '2026.6.33';--> statement-breakpoint
ALTER TABLE "browser_nodes" ALTER COLUMN "expected_openclaw_version" SET DEFAULT '2026.6.33';--> statement-breakpoint
ALTER TABLE "gmail_alert_cursors" ADD CONSTRAINT "gmail_alert_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "gmail_alert_external_references" ADD CONSTRAINT "gmail_alert_external_references_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "gmail_alert_external_references" ADD CONSTRAINT "gmail_alert_external_references_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "gmail_oauth_states" ADD CONSTRAINT "gmail_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "maritime_dispatches" ADD CONSTRAINT "maritime_dispatches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "maritime_dispatches" ADD CONSTRAINT "maritime_dispatches_source_job_tenant_fk" FOREIGN KEY ("user_id","source_job_id") REFERENCES "source_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_listing_tenant_fk" FOREIGN KEY ("user_id","canonical_listing_id") REFERENCES "canonical_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_tenant_fk" FOREIGN KEY ("user_id","subscription_id") REFERENCES "web_push_subscriptions"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_delivery_tenant_fk" FOREIGN KEY ("user_id","notification_delivery_id") REFERENCES "notification_deliveries"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "production_schedule_runs" ADD CONSTRAINT "production_schedule_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "production_schedule_runs" ADD CONSTRAINT "production_schedule_runs_schedule_tenant_fk" FOREIGN KEY ("user_id","schedule_id") REFERENCES "production_schedules"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "production_schedule_runs" ADD CONSTRAINT "production_schedule_runs_source_job_tenant_fk" FOREIGN KEY ("user_id","source_job_id") REFERENCES "source_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "production_schedules" ADD CONSTRAINT "production_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_alert_cursors_user_source_unique" ON "gmail_alert_cursors" USING btree ("user_id","source_configuration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_alert_external_references_user_message_unique" ON "gmail_alert_external_references" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_oauth_states_state_hash_unique" ON "gmail_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "maritime_deployments_kind_environment_unique" ON "maritime_deployments" USING btree ("kind","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "maritime_deployments_agent_unique" ON "maritime_deployments" USING btree ("maritime_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maritime_dispatches_nonce_hash_unique" ON "maritime_dispatches" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "maritime_dispatches_user_job_idx" ON "maritime_dispatches" USING btree ("user_id","source_job_id");--> statement-breakpoint
CREATE INDEX "maritime_dispatches_claim_idx" ON "maritime_dispatches" USING btree ("state","expires_at","issued_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_user_idempotency_unique" ON "notification_deliveries" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_claim_idx" ON "notification_deliveries" USING btree ("state","available_at","created_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_items_user_delivery_unique" ON "notification_digest_items" USING btree ("user_id","notification_delivery_id");--> statement-breakpoint
CREATE INDEX "notification_digest_items_release_idx" ON "notification_digest_items" USING btree ("release_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_schedule_runs_user_idempotency_unique" ON "production_schedule_runs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "production_schedule_runs_state_due_idx" ON "production_schedule_runs" USING btree ("state","due_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_schedules_user_kind_source_unique" ON "production_schedules" USING btree ("user_id","kind","source_configuration_id");--> statement-breakpoint
CREATE INDEX "production_schedules_due_idx" ON "production_schedules" USING btree ("state","next_run_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_heartbeats_deployment_unique" ON "service_heartbeats" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_user_endpoint_unique" ON "web_push_subscriptions" USING btree ("user_id","endpoint_hash");--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_expected_version_pinned" CHECK ("browser_nodes"."expected_openclaw_version" = '2026.6.33');
