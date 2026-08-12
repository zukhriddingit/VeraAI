CREATE TABLE "listing_enrichment_snapshots" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"source" text NOT NULL,
	"details" jsonb NOT NULL,
	"photos" jsonb NOT NULL,
	"field_provenance" jsonb NOT NULL,
	"completeness" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"fresh_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_enrichment_snapshots_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_enrichment_snapshots_freshness_order" CHECK ("listing_enrichment_snapshots"."fresh_until" > "listing_enrichment_snapshots"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "listing_enrichment_states" (
	"user_id" uuid NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"state" text DEFAULT 'not_requested' NOT NULL,
	"requested_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"current_snapshot_id" text,
	"manual_action" text,
	"last_error_code" text,
	"requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_enrichment_states_user_id_listing_source_record_id_pk" PRIMARY KEY("user_id","listing_source_record_id"),
	CONSTRAINT "listing_enrichment_states_state_allowed" CHECK ("listing_enrichment_states"."state" IN ('not_requested', 'queued', 'enriching', 'enriched', 'partial', 'blocked_manual_action', 'stale', 'failed')),
	CONSTRAINT "listing_enrichment_states_reason_allowed" CHECK ("listing_enrichment_states"."requested_reason" IS NULL OR "listing_enrichment_states"."requested_reason" IN ('search_top_three', 'listing_opened', 'listing_shortlisted', 'user_refresh')),
	CONSTRAINT "listing_enrichment_states_attempt_range" CHECK ("listing_enrichment_states"."attempt_count" BETWEEN 0 AND 10),
	CONSTRAINT "listing_enrichment_states_lease_pair" CHECK (("listing_enrichment_states"."lease_owner" IS NULL) = ("listing_enrichment_states"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "listing_enrichment_snapshots" ADD CONSTRAINT "listing_enrichment_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_enrichment_snapshots" ADD CONSTRAINT "listing_enrichment_snapshots_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_enrichment_states" ADD CONSTRAINT "listing_enrichment_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_enrichment_states" ADD CONSTRAINT "listing_enrichment_states_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_enrichment_snapshots_source_observed_unique" ON "listing_enrichment_snapshots" USING btree ("user_id","listing_source_record_id","observed_at");--> statement-breakpoint
CREATE INDEX "listing_enrichment_snapshots_current_idx" ON "listing_enrichment_snapshots" USING btree ("user_id","listing_source_record_id","observed_at");--> statement-breakpoint
CREATE INDEX "listing_enrichment_states_claim_idx" ON "listing_enrichment_states" USING btree ("state","available_at","updated_at");--> statement-breakpoint
CREATE TRIGGER "listing_enrichment_snapshots_append_only" BEFORE UPDATE OR DELETE ON "listing_enrichment_snapshots"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();
