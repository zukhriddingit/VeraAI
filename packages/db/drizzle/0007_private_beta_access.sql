CREATE TABLE "beta_access_rate_limits" (
	"key_digest" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "beta_access_rate_limits_digest_check" CHECK ("beta_access_rate_limits"."key_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "beta_access_rate_limits_attempts_check" CHECK ("beta_access_rate_limits"."attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "beta_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_email" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	CONSTRAINT "beta_access_requests_normalized_email_check" CHECK ("beta_access_requests"."normalized_email" = lower(btrim("beta_access_requests"."normalized_email"))),
	CONSTRAINT "beta_access_requests_status_check" CHECK ("beta_access_requests"."status" IN ('requested', 'invited', 'declined', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "beta_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_email" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	CONSTRAINT "beta_memberships_normalized_email_check" CHECK ("beta_memberships"."normalized_email" = lower(btrim("beta_memberships"."normalized_email"))),
	CONSTRAINT "beta_memberships_status_check" CHECK ("beta_memberships"."status" IN ('invited', 'active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "beta_access_requests" ADD CONSTRAINT "beta_access_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "beta_memberships" ADD CONSTRAINT "beta_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "beta_memberships" ADD CONSTRAINT "beta_memberships_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "beta_access_rate_limits_expiry_idx" ON "beta_access_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_access_requests_email_unique" ON "beta_access_requests" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "beta_access_requests_status_requested_idx" ON "beta_access_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_memberships_email_unique" ON "beta_memberships" USING btree ("normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_memberships_user_unique" ON "beta_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "beta_memberships_status_idx" ON "beta_memberships" USING btree ("status");
