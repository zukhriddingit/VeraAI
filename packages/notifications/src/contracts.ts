import { z } from "zod";

import type { NotificationPayloadSchema } from "@vera/domain";

export const PushSubscriptionDataSchema = z
  .object({
    endpoint: z.string().url().max(4_096),
    expirationTime: z.number().nonnegative().nullable(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(2_048),
        auth: z.string().min(1).max(2_048)
      })
      .strict()
  })
  .strict();

export const NotificationProviderResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("delivered"), providerReference: z.string().max(256).nullable() })
    .strict(),
  z
    .object({ status: z.literal("revoked"), safeErrorCode: z.literal("push_subscription_revoked") })
    .strict(),
  z
    .object({ status: z.literal("retryable_failed"), safeErrorCode: z.string().min(1).max(120) })
    .strict(),
  z
    .object({ status: z.literal("permanently_failed"), safeErrorCode: z.string().min(1).max(120) })
    .strict()
]);

export type PushSubscriptionData = z.infer<typeof PushSubscriptionDataSchema>;
export type NotificationProviderResult = z.infer<typeof NotificationProviderResultSchema>;

export interface NotificationProvider {
  readonly providerId: string;
  send(input: {
    readonly subscription: PushSubscriptionData;
    readonly payload: z.infer<typeof NotificationPayloadSchema>;
    readonly signal?: AbortSignal;
  }): Promise<NotificationProviderResult>;
}
