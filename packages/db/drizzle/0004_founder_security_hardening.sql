CREATE TABLE "integration_refresh_leases" (
	"user_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "integration_refresh_leases_user_id_integration_id_pk" PRIMARY KEY("user_id","integration_id"),
	CONSTRAINT "integration_refresh_leases_owner_valid" CHECK ("lease_owner" ~ '^[A-Za-z0-9._:-]{1,160}$'),
	CONSTRAINT "integration_refresh_leases_expiry_order" CHECK ("lease_expires_at" > "updated_at")
);
--> statement-breakpoint
ALTER TABLE "integration_refresh_leases" ADD CONSTRAINT "integration_refresh_leases_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "integration_refresh_leases" ADD CONSTRAINT "integration_refresh_leases_connection_tenant_fk"
	FOREIGN KEY ("user_id", "integration_id") REFERENCES "integration_connections"("user_id", "id") ON DELETE cascade ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX "integration_refresh_leases_expiry_idx" ON "integration_refresh_leases" ("lease_expires_at", "user_id", "integration_id");
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM production_schedules
		WHERE source_configuration_id IS NULL
		GROUP BY user_id, kind HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'production_schedules contains duplicate null-source rows';
	END IF;
	IF EXISTS (
		SELECT 1 FROM web_push_subscriptions
		WHERE octet_length(credential_nonce) <> 12
			OR octet_length(credential_authentication_tag) <> 16
			OR octet_length(credential_ciphertext) NOT BETWEEN 1 AND 16384
	) THEN
		RAISE EXCEPTION 'web_push_subscriptions contains malformed encrypted material';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "production_schedules_user_global_kind_unique"
	ON "production_schedules" ("user_id", "kind")
	WHERE "source_configuration_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_nonce_length"
	CHECK (octet_length("credential_nonce") = 12) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_nonce_length";
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_ciphertext_length"
	CHECK (octet_length("credential_ciphertext") BETWEEN 1 AND 16384) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_ciphertext_length";
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_authentication_tag_length"
	CHECK (octet_length("credential_authentication_tag") = 16) NOT VALID;
--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" VALIDATE CONSTRAINT "web_push_subscriptions_authentication_tag_length";
