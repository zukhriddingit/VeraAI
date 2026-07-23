import webPush from "web-push";

import {
  NotificationProviderResultSchema,
  type NotificationProvider,
  type PushSubscriptionData
} from "./contracts.ts";

export interface WebPushBoundary {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: PushSubscriptionData,
    payload: string,
    options: { readonly TTL: number; readonly urgency: "normal" }
  ): Promise<{ readonly statusCode: number; readonly headers?: Readonly<Record<string, string>> }>;
}

export class WebPushNotificationProvider implements NotificationProvider {
  readonly providerId = "web-push.v1";
  constructor(
    private readonly boundary: WebPushBoundary,
    config: { readonly subject: string; readonly publicKey: string; readonly privateKey: string }
  ) {
    if (!config.subject || !config.publicKey || !config.privateKey) {
      throw new Error("Complete VAPID configuration is required for Web Push.");
    }
    boundary.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  async send(input: Parameters<NotificationProvider["send"]>[0]) {
    try {
      const response = await this.boundary.sendNotification(
        input.subscription,
        JSON.stringify(input.payload),
        { TTL: 300, urgency: "normal" }
      );
      return NotificationProviderResultSchema.parse({
        status: "delivered",
        providerReference: response.headers?.["x-request-id"] ?? null
      });
    } catch (error: unknown) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { readonly statusCode?: unknown }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        return { status: "revoked" as const, safeErrorCode: "push_subscription_revoked" as const };
      }
      if (statusCode === 429 || statusCode >= 500 || statusCode === 0) {
        return {
          status: "retryable_failed" as const,
          safeErrorCode: "push_temporarily_unavailable"
        };
      }
      return { status: "permanently_failed" as const, safeErrorCode: "push_request_rejected" };
    }
  }
}

export function createWebPushNotificationProvider(config: {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}) {
  return new WebPushNotificationProvider(webPush as unknown as WebPushBoundary, config);
}
