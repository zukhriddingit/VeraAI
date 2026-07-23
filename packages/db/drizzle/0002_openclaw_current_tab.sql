CREATE TABLE "browser_capture_acceptances" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source_job_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"node_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"invocation_idempotency_key" text NOT NULL,
	"result_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"canonical_url" text NOT NULL,
	"raw_listing_id" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_capture_acceptances_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "browser_capture_acceptances_payload_hash_valid" CHECK ("browser_capture_acceptances"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_capture_acceptances_invocation_hash_valid" CHECK ("browser_capture_acceptances"."invocation_idempotency_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_capture_acceptances_result_hash_valid" CHECK ("browser_capture_acceptances"."result_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_capture_acceptances_content_hash_valid" CHECK ("browser_capture_acceptances"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "browser_profile_controls" (
	"user_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_profile_controls_user_id_node_id_profile_id_pk" PRIMARY KEY("user_id","node_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "browser_source_controls" (
	"user_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_source_controls_user_id_connector_id_pk" PRIMARY KEY("user_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "browser_user_controls" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "node_name" text DEFAULT 'Unnamed browser node' NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "pairing_state" text DEFAULT 'not_paired' NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "capability_approval_state" text DEFAULT 'not_approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "selected_profile_id" text;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "allowed_profile_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "reported_openclaw_version" text;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "expected_openclaw_version" text DEFAULT '2026.5.28' NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "version_compatibility" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "last_successful_capture_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "browser_nodes" SET "created_at" = "updated_at";--> statement-breakpoint
ALTER TABLE "source_jobs" ADD COLUMN "browser_node_id" text;--> statement-breakpoint
ALTER TABLE "source_jobs" ADD COLUMN "browser_profile_id" text;--> statement-breakpoint
ALTER TABLE "browser_capture_acceptances" ADD CONSTRAINT "browser_capture_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_capture_acceptances" ADD CONSTRAINT "browser_capture_acceptances_job_tenant_fk" FOREIGN KEY ("user_id","source_job_id") REFERENCES "source_jobs"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_capture_acceptances" ADD CONSTRAINT "browser_capture_acceptances_attempt_tenant_fk" FOREIGN KEY ("user_id","attempt_id") REFERENCES "source_job_attempts"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_capture_acceptances" ADD CONSTRAINT "browser_capture_acceptances_profile_tenant_fk" FOREIGN KEY ("user_id","node_id","profile_id") REFERENCES "browser_profile_controls"("user_id","node_id","profile_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_capture_acceptances" ADD CONSTRAINT "browser_capture_acceptances_raw_listing_tenant_fk" FOREIGN KEY ("user_id","raw_listing_id") REFERENCES "raw_listings"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_profile_controls" ADD CONSTRAINT "browser_profile_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_profile_controls" ADD CONSTRAINT "browser_profile_controls_node_tenant_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "browser_nodes"("user_id","node_id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_source_controls" ADD CONSTRAINT "browser_source_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_user_controls" ADD CONSTRAINT "browser_user_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_capture_acceptances_user_job_unique" ON "browser_capture_acceptances" USING btree ("user_id","source_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_capture_acceptances_user_invocation_unique" ON "browser_capture_acceptances" USING btree ("user_id","invocation_idempotency_key");--> statement-breakpoint
ALTER TABLE "source_jobs" ADD CONSTRAINT "source_jobs_browser_node_tenant_fk" FOREIGN KEY ("user_id","browser_node_id") REFERENCES "browser_nodes"("user_id","node_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_pairing_state_allowed" CHECK ("browser_nodes"."pairing_state" IN ('not_paired', 'pairing_pending', 'paired', 'revoked'));--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_capability_state_allowed" CHECK ("browser_nodes"."capability_approval_state" IN ('not_approved', 'approval_pending', 'approved', 'revoked'));--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_version_compatibility_allowed" CHECK ("browser_nodes"."version_compatibility" IN ('unknown', 'compatible', 'incompatible'));--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_expected_version_pinned" CHECK ("browser_nodes"."expected_openclaw_version" = '2026.5.28');--> statement-breakpoint
ALTER TABLE "browser_nodes" ADD CONSTRAINT "browser_nodes_selected_profile_allowlisted" CHECK ("browser_nodes"."selected_profile_id" IS NULL OR "browser_nodes"."allowed_profile_ids" @> jsonb_build_array("browser_nodes"."selected_profile_id"));--> statement-breakpoint
ALTER TABLE "source_jobs" ADD CONSTRAINT "source_jobs_browser_target_consistency" CHECK (("source_jobs"."browser_node_id" IS NULL AND "source_jobs"."browser_profile_id" IS NULL)
        OR ("source_jobs"."acquisition_mode" = 'local_browser'
          AND "source_jobs"."browser_node_id" IS NOT NULL
          AND "source_jobs"."browser_profile_id" IS NOT NULL));--> statement-breakpoint
CREATE TRIGGER "browser_capture_acceptances_append_only" BEFORE UPDATE OR DELETE ON "browser_capture_acceptances"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();
