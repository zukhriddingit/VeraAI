CREATE TABLE "browser_connector_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_digest" text NOT NULL,
	"extension_version" text NOT NULL,
	"protocol_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "browser_connector_devices_installation_digest_check" CHECK ("browser_connector_devices"."installation_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_connector_devices_version_check" CHECK ("browser_connector_devices"."extension_version" = '2.2.0' AND "browser_connector_devices"."protocol_version" = '1'),
	CONSTRAINT "browser_connector_devices_status_check" CHECK ("browser_connector_devices"."status" IN ('pending', 'active', 'revoked')),
	CONSTRAINT "browser_connector_devices_state_consistency" CHECK (
        ("browser_connector_devices"."status" = 'pending' AND "browser_connector_devices"."connected_at" IS NULL AND "browser_connector_devices"."revoked_at" IS NULL)
        OR ("browser_connector_devices"."status" = 'active' AND "browser_connector_devices"."connected_at" IS NOT NULL AND "browser_connector_devices"."revoked_at" IS NULL)
        OR ("browser_connector_devices"."status" = 'revoked' AND "browser_connector_devices"."revoked_at" IS NOT NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "browser_connector_enrollment_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"installation_digest" text NOT NULL,
	"ticket_digest" text NOT NULL,
	"extension_version" text NOT NULL,
	"protocol_version" text NOT NULL,
	"gateway_origin" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"terminal_reason" text,
	CONSTRAINT "browser_connector_enrollment_tickets_digest_check" CHECK ("browser_connector_enrollment_tickets"."ticket_digest" ~ '^[a-f0-9]{64}$' AND "browser_connector_enrollment_tickets"."installation_digest" ~ '^[a-f0-9]{64}$' AND "browser_connector_enrollment_tickets"."idempotency_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "browser_connector_enrollment_tickets_version_check" CHECK ("browser_connector_enrollment_tickets"."extension_version" = '2.2.0' AND "browser_connector_enrollment_tickets"."protocol_version" = '1'),
	CONSTRAINT "browser_connector_enrollment_tickets_gateway_origin_check" CHECK ("browser_connector_enrollment_tickets"."gateway_origin" ~ '^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\:[1-9][0-9]{0,4})?$'),
	CONSTRAINT "browser_connector_enrollment_tickets_status_check" CHECK ("browser_connector_enrollment_tickets"."status" IN ('issued', 'consumed', 'expired', 'revoked')),
	CONSTRAINT "browser_connector_enrollment_tickets_lifetime_check" CHECK ("browser_connector_enrollment_tickets"."expires_at" > "browser_connector_enrollment_tickets"."issued_at" AND "browser_connector_enrollment_tickets"."expires_at" <= "browser_connector_enrollment_tickets"."issued_at" + interval '60 seconds'),
	CONSTRAINT "browser_connector_enrollment_tickets_state_consistency" CHECK (
        ("browser_connector_enrollment_tickets"."status" = 'issued' AND "browser_connector_enrollment_tickets"."consumed_at" IS NULL AND "browser_connector_enrollment_tickets"."terminal_at" IS NULL AND "browser_connector_enrollment_tickets"."terminal_reason" IS NULL)
        OR ("browser_connector_enrollment_tickets"."status" = 'consumed' AND "browser_connector_enrollment_tickets"."consumed_at" IS NOT NULL AND "browser_connector_enrollment_tickets"."terminal_at" = "browser_connector_enrollment_tickets"."consumed_at" AND "browser_connector_enrollment_tickets"."terminal_reason" IS NULL)
        OR ("browser_connector_enrollment_tickets"."status" = 'expired' AND "browser_connector_enrollment_tickets"."consumed_at" IS NULL AND "browser_connector_enrollment_tickets"."terminal_at" IS NOT NULL AND "browser_connector_enrollment_tickets"."terminal_reason" = 'expired')
        OR ("browser_connector_enrollment_tickets"."status" = 'revoked' AND "browser_connector_enrollment_tickets"."consumed_at" IS NULL AND "browser_connector_enrollment_tickets"."terminal_at" IS NOT NULL AND "browser_connector_enrollment_tickets"."terminal_reason" = 'revoked')
      )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_devices_owner_assignment_id_unique" ON "browser_connector_devices" USING btree ("id","user_id","assignment_id");--> statement-breakpoint
ALTER TABLE "browser_connector_devices" ADD CONSTRAINT "browser_connector_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_connector_devices" ADD CONSTRAINT "browser_connector_devices_assignment_owner_fk" FOREIGN KEY ("assignment_id","user_id") REFERENCES "browser_gateway_assignments"("id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_connector_enrollment_tickets" ADD CONSTRAINT "browser_connector_enrollment_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_connector_enrollment_tickets" ADD CONSTRAINT "browser_connector_enrollment_tickets_assignment_owner_fk" FOREIGN KEY ("assignment_id","user_id") REFERENCES "browser_gateway_assignments"("id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "browser_connector_enrollment_tickets" ADD CONSTRAINT "browser_connector_enrollment_tickets_device_owner_fk" FOREIGN KEY ("device_id","user_id","assignment_id") REFERENCES "browser_connector_devices"("id","user_id","assignment_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_devices_assignment_live_unique" ON "browser_connector_devices" USING btree ("assignment_id") WHERE "browser_connector_devices"."status" IN ('pending', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_devices_installation_live_unique" ON "browser_connector_devices" USING btree ("installation_digest") WHERE "browser_connector_devices"."status" IN ('pending', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_enrollment_tickets_digest_unique" ON "browser_connector_enrollment_tickets" USING btree ("ticket_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_enrollment_tickets_owner_idempotency_unique" ON "browser_connector_enrollment_tickets" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_connector_enrollment_tickets_assignment_issued_unique" ON "browser_connector_enrollment_tickets" USING btree ("assignment_id") WHERE "browser_connector_enrollment_tickets"."status" = 'issued';--> statement-breakpoint
CREATE INDEX "browser_connector_enrollment_tickets_expiry_idx" ON "browser_connector_enrollment_tickets" USING btree ("status","expires_at");
