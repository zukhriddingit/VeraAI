CREATE TABLE "privacy_deletion_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "privacy_deletion_challenges_digest_check" CHECK ("privacy_deletion_challenges"."challenge_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "privacy_deletion_challenges_lifetime_check" CHECK ("privacy_deletion_challenges"."expires_at" > "privacy_deletion_challenges"."created_at" AND "privacy_deletion_challenges"."expires_at" <= "privacy_deletion_challenges"."created_at" + interval '15 minutes'),
	CONSTRAINT "privacy_deletion_challenges_consumed_check" CHECK ("privacy_deletion_challenges"."consumed_at" IS NULL OR ("privacy_deletion_challenges"."consumed_at" >= "privacy_deletion_challenges"."created_at" AND "privacy_deletion_challenges"."consumed_at" <= "privacy_deletion_challenges"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "privacy_deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"former_user_id" uuid NOT NULL,
	"subject_digest" text NOT NULL,
	"provider_revocation" text NOT NULL,
	"browser_revocation" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"backup_erase_after" timestamp with time zone NOT NULL,
	"legal_hold_until" timestamp with time zone,
	CONSTRAINT "privacy_deletion_receipts_digest_check" CHECK ("privacy_deletion_receipts"."subject_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "privacy_deletion_receipts_status_check" CHECK ("privacy_deletion_receipts"."provider_revocation" IN ('confirmed', 'unconfirmed', 'not_configured') AND "privacy_deletion_receipts"."browser_revocation" IN ('confirmed', 'unconfirmed', 'not_configured')),
	CONSTRAINT "privacy_deletion_receipts_ordering_check" CHECK ("privacy_deletion_receipts"."backup_erase_after" >= "privacy_deletion_receipts"."completed_at" AND ("privacy_deletion_receipts"."legal_hold_until" IS NULL OR "privacy_deletion_receipts"."legal_hold_until" >= "privacy_deletion_receipts"."completed_at"))
);
--> statement-breakpoint
ALTER TABLE "privacy_deletion_challenges" ADD CONSTRAINT "privacy_deletion_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_deletion_challenges_digest_unique" ON "privacy_deletion_challenges" USING btree ("challenge_digest");--> statement-breakpoint
CREATE INDEX "privacy_deletion_challenges_user_expiry_idx" ON "privacy_deletion_challenges" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_deletion_receipts_former_user_unique" ON "privacy_deletion_receipts" USING btree ("former_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_deletion_receipts_subject_digest_unique" ON "privacy_deletion_receipts" USING btree ("subject_digest");
