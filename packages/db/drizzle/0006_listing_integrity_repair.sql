CREATE TABLE "listing_source_record_dispositions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"listing_source_record_id" text NOT NULL,
	"disposition" text NOT NULL,
	"reason_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"actor" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "listing_source_record_dispositions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "listing_source_record_dispositions_allowed" CHECK ("listing_source_record_dispositions"."disposition" IN ('accepted', 'invalid_non_listing')),
	CONSTRAINT "listing_source_record_dispositions_actor_allowed" CHECK ("listing_source_record_dispositions"."actor" IN ('system', 'founder')),
	CONSTRAINT "listing_source_record_dispositions_payload_hash_valid" CHECK ("listing_source_record_dispositions"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "listing_photos" DROP CONSTRAINT "listing_photos_decoded_metadata_consistency";--> statement-breakpoint
DROP INDEX "listing_photos_user_source_position_unique";--> statement-breakpoint
ALTER TABLE "listing_source_record_dispositions" ADD CONSTRAINT "listing_source_record_dispositions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "listing_source_record_dispositions" ADD CONSTRAINT "listing_source_record_dispositions_source_record_tenant_fk" FOREIGN KEY ("user_id","listing_source_record_id") REFERENCES "listing_source_records"("user_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_source_record_dispositions_payload_unique" ON "listing_source_record_dispositions" USING btree ("user_id","listing_source_record_id","payload_hash");--> statement-breakpoint
CREATE INDEX "listing_source_record_dispositions_current_idx" ON "listing_source_record_dispositions" USING btree ("user_id","listing_source_record_id","observed_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_photos_user_source_url_position_unique" ON "listing_photos" USING btree ("user_id","listing_source_record_id","source_url","position") WHERE "listing_photos"."source_url" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_observed_dimensions_consistency" CHECK (("listing_photos"."width" IS NULL) = ("listing_photos"."height" IS NULL));--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_fetched_metadata_consistency" CHECK (("listing_photos"."byte_size" IS NULL) = ("listing_photos"."mime_type" IS NULL));--> statement-breakpoint
CREATE TRIGGER "listing_source_record_dispositions_append_only" BEFORE UPDATE OR DELETE ON "listing_source_record_dispositions"
FOR EACH ROW EXECUTE FUNCTION "vera_reject_mutation"();
