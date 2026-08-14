CREATE TABLE "browser_gateway_acceptance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_job_id" text NOT NULL,
	"source" text NOT NULL,
	"forbidden_action_count" integer NOT NULL,
	"unshare_stopped_future_work" boolean NOT NULL,
	"unpair_verified" boolean NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "browser_gateway_acceptance_nonnegative" CHECK ("browser_gateway_acceptance_runs"."forbidden_action_count" >= 0),
	CONSTRAINT "browser_gateway_acceptance_source_check" CHECK ("browser_gateway_acceptance_runs"."source" IN ('zillow', 'apartments_com', 'facebook_marketplace', 'bu_off_campus', 'custom_website', 'craigslist'))
);
--> statement-breakpoint
CREATE TABLE "browser_gateway_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"maritime_agent_id" text NOT NULL,
	"gateway_origin" text NOT NULL,
	"checkpoint_origin" text NOT NULL,
	"secret_reference" text NOT NULL,
	"relay_credential_digest" text NOT NULL,
	"checkpoint_credential_digest" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "browser_gateway_assignments_status_check" CHECK ("browser_gateway_assignments"."status" IN ('pending', 'active', 'revoked')),
	CONSTRAINT "browser_gateway_assignments_digest_check" CHECK ("browser_gateway_assignments"."relay_credential_digest" ~ '^[a-f0-9]{64}$' AND "browser_gateway_assignments"."checkpoint_credential_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_gateway_assignments_checkpoint_origin_check" CHECK ("browser_gateway_assignments"."checkpoint_origin" = 'https://app.verahousing.app')
);
--> statement-breakpoint
ALTER TABLE "browser_gateway_acceptance_runs" ADD CONSTRAINT "browser_gateway_acceptance_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_id_user_unique" ON "browser_gateway_assignments" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "browser_gateway_acceptance_runs" ADD CONSTRAINT "browser_gateway_acceptance_assignment_owner_fk" FOREIGN KEY ("assignment_id","user_id") REFERENCES "browser_gateway_assignments"("id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_gateway_assignments" ADD CONSTRAINT "browser_gateway_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_gateway_assignments" ADD CONSTRAINT "browser_gateway_assignments_node_tenant_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "browser_nodes"("user_id","node_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_acceptance_user_job_unique" ON "browser_gateway_acceptance_runs" USING btree ("user_id","source_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_user_live_unique" ON "browser_gateway_assignments" USING btree ("user_id") WHERE "browser_gateway_assignments"."status" IN ('pending', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_agent_unique" ON "browser_gateway_assignments" USING btree ("maritime_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_gateway_origin_unique" ON "browser_gateway_assignments" USING btree ("gateway_origin");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_secret_reference_unique" ON "browser_gateway_assignments" USING btree ("secret_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_relay_digest_unique" ON "browser_gateway_assignments" USING btree ("relay_credential_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_gateway_assignments_checkpoint_digest_unique" ON "browser_gateway_assignments" USING btree ("checkpoint_credential_digest");
