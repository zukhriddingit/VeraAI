CREATE TABLE "availability_checks" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"availability_rule_set_id" text NOT NULL,
	"integration_connection_id" uuid,
	"state" text NOT NULL,
	"range_starts_at" timestamp with time zone NOT NULL,
	"range_ends_at" timestamp with time zone NOT NULL,
	"calendar_ids_attempted" jsonb NOT NULL,
	"calendars_checked" jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"response_hash" text,
	"busy_interval_count" integer,
	"safe_provider_error_code" text,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "availability_checks_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "availability_checks_state_allowed" CHECK ("availability_checks"."state" IN ('checked', 'scope_not_granted', 'google_disconnected', 'google_temporarily_unavailable', 'vera_rules_only')),
	CONSTRAINT "availability_checks_range_order" CHECK ("availability_checks"."range_ends_at" > "availability_checks"."range_starts_at"),
	CONSTRAINT "availability_checks_busy_count_nonnegative" CHECK ("availability_checks"."busy_interval_count" IS NULL OR "availability_checks"."busy_interval_count" >= 0),
	CONSTRAINT "availability_checks_response_hash_valid" CHECK ("availability_checks"."response_hash" IS NULL OR "availability_checks"."response_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "availability_checks_state_matrix" CHECK (("availability_checks"."state" = 'checked'
          AND "availability_checks"."calendar_ids_attempted" = '["primary"]'::jsonb
          AND "availability_checks"."calendars_checked" = '["primary"]'::jsonb
          AND "availability_checks"."checked_at" IS NOT NULL
          AND "availability_checks"."response_hash" IS NOT NULL
          AND "availability_checks"."busy_interval_count" IS NOT NULL
          AND "availability_checks"."safe_provider_error_code" IS NULL)
        OR ("availability_checks"."state" = 'google_temporarily_unavailable'
          AND "availability_checks"."calendar_ids_attempted" IN ('[]'::jsonb, '["primary"]'::jsonb)
          AND "availability_checks"."calendars_checked" = '[]'::jsonb
          AND "availability_checks"."checked_at" IS NULL
          AND "availability_checks"."response_hash" IS NULL
          AND "availability_checks"."busy_interval_count" IS NULL
          AND "availability_checks"."safe_provider_error_code" IS NOT NULL)
        OR ("availability_checks"."state" IN ('scope_not_granted', 'google_disconnected', 'vera_rules_only')
          AND "availability_checks"."calendar_ids_attempted" = '[]'::jsonb
          AND "availability_checks"."calendars_checked" = '[]'::jsonb
          AND "availability_checks"."checked_at" IS NULL
          AND "availability_checks"."response_hash" IS NULL
          AND "availability_checks"."busy_interval_count" IS NULL
          AND "availability_checks"."safe_provider_error_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "availability_rule_sets" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"time_zone" text NOT NULL,
	"weekly_intervals" jsonb NOT NULL,
	"duration_minutes" integer NOT NULL,
	"minimum_notice_minutes" integer NOT NULL,
	"travel_minutes" integer NOT NULL,
	"buffer_minutes" integer NOT NULL,
	"reminders_minutes_before_start" jsonb NOT NULL,
	"conflict_checking_enabled" boolean NOT NULL,
	"selected_calendar_ids" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "availability_rule_sets_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "availability_rule_sets_schema_version" CHECK ("availability_rule_sets"."schema_version" = 1),
	CONSTRAINT "availability_rule_sets_duration_range" CHECK ("availability_rule_sets"."duration_minutes" BETWEEN 15 AND 240),
	CONSTRAINT "availability_rule_sets_notice_range" CHECK ("availability_rule_sets"."minimum_notice_minutes" BETWEEN 0 AND 10080),
	CONSTRAINT "availability_rule_sets_travel_range" CHECK ("availability_rule_sets"."travel_minutes" BETWEEN 0 AND 240),
	CONSTRAINT "availability_rule_sets_buffer_range" CHECK ("availability_rule_sets"."buffer_minutes" BETWEEN 0 AND 240),
	CONSTRAINT "availability_rule_sets_weekly_intervals_object" CHECK (jsonb_typeof("availability_rule_sets"."weekly_intervals") = 'object'),
	CONSTRAINT "availability_rule_sets_reminders_array" CHECK (jsonb_typeof("availability_rule_sets"."reminders_minutes_before_start") = 'array'
        AND jsonb_array_length("availability_rule_sets"."reminders_minutes_before_start") <= 5),
	CONSTRAINT "availability_rule_sets_calendar_ids_consistency" CHECK (jsonb_typeof("availability_rule_sets"."selected_calendar_ids") = 'array'
        AND (("availability_rule_sets"."conflict_checking_enabled" = true
              AND "availability_rule_sets"."selected_calendar_ids" = '["primary"]'::jsonb)
          OR ("availability_rule_sets"."conflict_checking_enabled" = false
              AND "availability_rule_sets"."selected_calendar_ids" = '[]'::jsonb))),
	CONSTRAINT "availability_rule_sets_timestamp_order" CHECK ("availability_rule_sets"."updated_at" >= "availability_rule_sets"."created_at")
);
--> statement-breakpoint
CREATE TABLE "calendar_holds" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"viewing_id" text NOT NULL,
	"approval_id" text,
	"availability_check_id" text,
	"payload_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"google_event_id" text NOT NULL,
	"provider_event_reference" text,
	"state" text NOT NULL,
	"conflict_check_override" boolean DEFAULT false NOT NULL,
	"conflict_check_override_reason" text,
	"safe_error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "calendar_holds_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "calendar_holds_calendar_primary" CHECK ("calendar_holds"."calendar_id" = 'primary'),
	CONSTRAINT "calendar_holds_state_allowed" CHECK ("calendar_holds"."state" IN ('approval_pending', 'approved', 'creating', 'created', 'retryable_failed', 'permanently_failed', 'cancelled_internal')),
	CONSTRAINT "calendar_holds_payload_hash_valid" CHECK ("calendar_holds"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calendar_holds_idempotency_key_valid" CHECK ("calendar_holds"."idempotency_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calendar_holds_google_event_id_valid" CHECK ("calendar_holds"."google_event_id" ~ '^vera[a-f0-9]{40}$'),
	CONSTRAINT "calendar_holds_override_consistency" CHECK (("calendar_holds"."conflict_check_override" = false AND "calendar_holds"."conflict_check_override_reason" IS NULL)
        OR ("calendar_holds"."conflict_check_override" = true
          AND "calendar_holds"."conflict_check_override_reason" IN ('scope_not_granted', 'google_disconnected', 'google_temporarily_unavailable', 'stale', 'vera_rules_only'))),
	CONSTRAINT "calendar_holds_error_consistency" CHECK (("calendar_holds"."state" IN ('retryable_failed', 'permanently_failed'))
        = ("calendar_holds"."safe_error_code" IS NOT NULL)),
	CONSTRAINT "calendar_holds_completion_consistency" CHECK (("calendar_holds"."state" IN ('created', 'permanently_failed', 'cancelled_internal'))
        = ("calendar_holds"."completed_at" IS NOT NULL)),
	CONSTRAINT "calendar_holds_approval_consistency" CHECK (("calendar_holds"."state" = 'approval_pending' AND "calendar_holds"."approval_id" IS NULL)
        OR ("calendar_holds"."state" IN ('approved', 'creating', 'created', 'retryable_failed', 'permanently_failed')
          AND "calendar_holds"."approval_id" IS NOT NULL)
        OR ("calendar_holds"."state" = 'cancelled_internal'
          AND ("calendar_holds"."approval_id" IS NOT NULL OR "calendar_holds"."provider_event_reference" IS NULL))),
	CONSTRAINT "calendar_holds_provider_reference_consistency" CHECK (("calendar_holds"."state" = 'created' AND "calendar_holds"."provider_event_reference" IS NOT NULL)
        OR ("calendar_holds"."state" = 'cancelled_internal')
        OR ("calendar_holds"."state" NOT IN ('created', 'cancelled_internal')
          AND "calendar_holds"."provider_event_reference" IS NULL)),
	CONSTRAINT "calendar_holds_timestamp_order" CHECK ("calendar_holds"."updated_at" >= "calendar_holds"."created_at"
        AND ("calendar_holds"."completed_at" IS NULL
          OR ("calendar_holds"."completed_at" >= "calendar_holds"."created_at" AND "calendar_holds"."completed_at" <= "calendar_holds"."updated_at")))
);
--> statement-breakpoint
CREATE TABLE "calendar_oauth_states" (
	"user_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"capability" text NOT NULL,
	"requested_calendar_scopes" jsonb NOT NULL,
	"credential_version" integer,
	"credential_algorithm" text,
	"credential_key_id" text,
	"credential_nonce" "bytea",
	"credential_ciphertext" "bytea",
	"credential_authentication_tag" "bytea",
	"redirect_uri_hash" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "calendar_oauth_states_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "calendar_oauth_states_capability_allowed" CHECK ("calendar_oauth_states"."capability" IN ('calendar_conflict_checking', 'calendar_hold_creation')),
	CONSTRAINT "calendar_oauth_states_scope_consistency" CHECK (("calendar_oauth_states"."capability" = 'calendar_conflict_checking'
            AND "calendar_oauth_states"."requested_calendar_scopes" = '["https://www.googleapis.com/auth/calendar.freebusy"]'::jsonb)
        OR ("calendar_oauth_states"."capability" = 'calendar_hold_creation'
            AND "calendar_oauth_states"."requested_calendar_scopes" = '["https://www.googleapis.com/auth/calendar.events.owned"]'::jsonb)),
	CONSTRAINT "calendar_oauth_states_verifier_all_or_none" CHECK (num_nonnulls("calendar_oauth_states"."credential_version", "calendar_oauth_states"."credential_algorithm", "calendar_oauth_states"."credential_key_id", "calendar_oauth_states"."credential_nonce", "calendar_oauth_states"."credential_ciphertext", "calendar_oauth_states"."credential_authentication_tag") IN (0, 6)),
	CONSTRAINT "calendar_oauth_states_encrypted_verifier_required" CHECK ("calendar_oauth_states"."credential_ciphertext" IS NOT NULL),
	CONSTRAINT "calendar_oauth_states_state_hash_valid" CHECK ("calendar_oauth_states"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calendar_oauth_states_redirect_hash_valid" CHECK ("calendar_oauth_states"."redirect_uri_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "calendar_oauth_states_timestamp_order" CHECK ("calendar_oauth_states"."expires_at" > "calendar_oauth_states"."created_at"
        AND ("calendar_oauth_states"."consumed_at" IS NULL
          OR ("calendar_oauth_states"."consumed_at" >= "calendar_oauth_states"."created_at" AND "calendar_oauth_states"."consumed_at" <= "calendar_oauth_states"."expires_at")))
);
--> statement-breakpoint
ALTER TABLE "viewings" ADD COLUMN "selected_window" jsonb;--> statement-breakpoint
ALTER TABLE "viewings" ADD COLUMN "supersedes_viewing_id" text;--> statement-breakpoint
ALTER TABLE "availability_checks" ADD CONSTRAINT "availability_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "availability_checks" ADD CONSTRAINT "availability_checks_rule_set_tenant_fk" FOREIGN KEY ("user_id","availability_rule_set_id") REFERENCES "availability_rule_sets"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "availability_checks" ADD CONSTRAINT "availability_checks_integration_tenant_fk" FOREIGN KEY ("user_id","integration_connection_id") REFERENCES "integration_connections"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "availability_rule_sets" ADD CONSTRAINT "availability_rule_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "calendar_holds" ADD CONSTRAINT "calendar_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "calendar_holds" ADD CONSTRAINT "calendar_holds_viewing_tenant_fk" FOREIGN KEY ("user_id","viewing_id") REFERENCES "viewings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "calendar_holds" ADD CONSTRAINT "calendar_holds_approval_tenant_fk" FOREIGN KEY ("user_id","approval_id") REFERENCES "approvals"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "calendar_holds" ADD CONSTRAINT "calendar_holds_check_tenant_fk" FOREIGN KEY ("user_id","availability_check_id") REFERENCES "availability_checks"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "calendar_oauth_states" ADD CONSTRAINT "calendar_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "availability_checks_user_created_idx" ON "availability_checks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_rule_sets_user_unique" ON "availability_rule_sets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holds_user_idempotency_unique" ON "calendar_holds" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holds_user_approval_unique" ON "calendar_holds" USING btree ("user_id","approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holds_user_provider_event_unique" ON "calendar_holds" USING btree ("user_id","calendar_id","google_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_oauth_states_state_hash_unique" ON "calendar_oauth_states" USING btree ("state_hash");--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_supersedes_tenant_fk" FOREIGN KEY ("user_id","supersedes_viewing_id") REFERENCES "viewings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "integration_connections"
		GROUP BY "user_id", "provider"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23505',
			MESSAGE = 'Calendar migration blocked: multiple integration_connections exist for one user and provider',
			HINT = 'Resolve the duplicate account links explicitly before retrying; credentials are never merged or deleted automatically.';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_user_provider_unique" ON "integration_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE TRIGGER "availability_checks_append_only" BEFORE UPDATE OR DELETE ON "availability_checks"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();
