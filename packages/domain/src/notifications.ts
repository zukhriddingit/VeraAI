import { z } from "zod";

import { EncryptedCredentialEnvelopeSchema, VeraUserIdSchema } from "./identity.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

const ClockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const NotificationRiskCeilingSchema = z.enum(["none", "low", "medium", "high"]);
export const NotificationPreferenceSchema = z
  .object({
    userId: VeraUserIdSchema,
    enabled: z.boolean(),
    scoreThreshold: z.number().int().min(0).max(100),
    freshnessMinutes: z.number().int().min(1).max(43_200),
    riskCeiling: NotificationRiskCeilingSchema,
    timezone: z.string().trim().min(1).max(100).refine(isValidTimeZone, "Invalid IANA timezone."),
    quietHoursStart: ClockTimeSchema,
    quietHoursEnd: ClockTimeSchema,
    hourlyLimit: z.number().int().min(1).max(60),
    digestEnabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const WebPushSubscriptionStatusSchema = z.enum(["active", "revoked", "disabled"]);
export const WebPushSubscriptionRecordSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    endpointHash: Sha256Schema,
    encryptedSubscription: EncryptedCredentialEnvelopeSchema,
    status: WebPushSubscriptionStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    revokedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((subscription, context) => {
    if ((subscription.status === "revoked") !== (subscription.revokedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Only revoked subscriptions require a revocation time."
      });
    }
  });

export const NotificationPayloadSchema = z
  .object({
    title: z.literal("Vera found a new match"),
    body: z.literal("Open Vera to review a new listing."),
    deepLink: z
      .string()
      .regex(/^\/listings\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u)
      .max(220)
  })
  .strict();

export const NotificationDeliveryStateSchema = z.enum([
  "queued",
  "leased",
  "deferred_quiet_hours",
  "deferred_rate_limit",
  "delivered",
  "retryable_failed",
  "permanently_failed",
  "cancelled_by_policy"
]);

export const NotificationDeliverySchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    canonicalListingId: EntityIdSchema,
    subscriptionId: EntityIdSchema,
    idempotencyKey: Sha256Schema,
    payloadHash: Sha256Schema,
    state: NotificationDeliveryStateSchema,
    payload: NotificationPayloadSchema,
    attemptCount: z.number().int().nonnegative().max(20),
    availableAt: IsoDateTimeSchema,
    leaseOwner: EntityIdSchema.nullable(),
    leaseExpiresAt: IsoDateTimeSchema.nullable(),
    deliveredAt: IsoDateTimeSchema.nullable(),
    safeErrorCode: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((delivery, context) => {
    if ((delivery.leaseOwner === null) !== (delivery.leaseExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["leaseExpiresAt"],
        message: "Notification lease owner and expiry must be set together."
      });
    }
    if ((delivery.state === "delivered") !== (delivery.deliveredAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["deliveredAt"],
        message: "Only delivered notifications require a delivery time."
      });
    }
  });

export const NotificationDigestItemSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    notificationDeliveryId: EntityIdSchema,
    releaseAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    releasedAt: IsoDateTimeSchema.nullable()
  })
  .strict();

export type NotificationRiskCeiling = z.infer<typeof NotificationRiskCeilingSchema>;
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;
export type WebPushSubscriptionStatus = z.infer<typeof WebPushSubscriptionStatusSchema>;
export type WebPushSubscriptionRecord = z.infer<typeof WebPushSubscriptionRecordSchema>;
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
export type NotificationDeliveryState = z.infer<typeof NotificationDeliveryStateSchema>;
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;
export type NotificationDigestItem = z.infer<typeof NotificationDigestItemSchema>;
