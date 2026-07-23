import type {
  NotificationDelivery,
  NotificationPreference,
  VeraUserId,
  WebPushSubscriptionRecord
} from "@vera/domain";
import {
  PushSubscriptionDataSchema,
  evaluateQuietHours,
  type NotificationProvider,
  type PushSubscriptionData
} from "@vera/notifications";

export const NOTIFICATION_LEASE_DURATION_MILLISECONDS = 60_000;

interface NotificationWorkerRepositories {
  readonly notificationPreferences: { get(): Promise<NotificationPreference | null> };
  readonly webPushSubscriptions: {
    getById(id: string): Promise<WebPushSubscriptionRecord | null>;
    transition(
      id: string,
      expected: WebPushSubscriptionRecord["status"],
      requested: WebPushSubscriptionRecord["status"],
      at: string
    ): Promise<WebPushSubscriptionRecord>;
  };
  readonly notificationDeliveries: {
    list(): Promise<readonly NotificationDelivery[]>;
    transition(
      id: string,
      expected: NotificationDelivery["state"],
      requested: NotificationDelivery["state"],
      at: string,
      safeErrorCode?: string | null,
      availableAt?: string
    ): Promise<NotificationDelivery>;
  };
}

export interface NotificationWorkerDependencies {
  readonly queue: {
    claimNextNotificationDelivery(input: {
      readonly leaseOwner: string;
      readonly now: string;
      readonly leaseExpiresAt: string;
    }): Promise<{ readonly userId: VeraUserId; readonly delivery: NotificationDelivery } | null>;
  };
  readonly repositoriesForUser: (userId: VeraUserId) => NotificationWorkerRepositories;
  readonly provider: NotificationProvider;
  readonly resolveSubscription: (
    userId: VeraUserId,
    record: WebPushSubscriptionRecord
  ) => Promise<PushSubscriptionData>;
  readonly leaseOwner: string;
  readonly now: () => Date;
}

export type NotificationWorkerResult =
  | { readonly status: "idle" }
  | {
      readonly status:
        | "delivered"
        | "deferred"
        | "retryable_failed"
        | "permanently_failed"
        | "cancelled_by_policy";
      readonly deliveryId: string;
    };

export async function processNextNotification(
  dependencies: NotificationWorkerDependencies,
  signal?: AbortSignal
): Promise<NotificationWorkerResult> {
  const now = dependencies.now();
  const owned = await dependencies.queue.claimNextNotificationDelivery({
    leaseOwner: dependencies.leaseOwner,
    now: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + NOTIFICATION_LEASE_DURATION_MILLISECONDS).toISOString()
  });
  if (!owned) return { status: "idle" };
  const repositories = dependencies.repositoriesForUser(owned.userId);
  const [preference, subscription] = await Promise.all([
    repositories.notificationPreferences.get(),
    repositories.webPushSubscriptions.getById(owned.delivery.subscriptionId)
  ]);
  if (!preference?.enabled || !subscription || subscription.status !== "active") {
    await repositories.notificationDeliveries.transition(
      owned.delivery.id,
      "leased",
      "cancelled_by_policy",
      now.toISOString()
    );
    return { status: "cancelled_by_policy", deliveryId: owned.delivery.id };
  }
  if (
    evaluateQuietHours(
      now,
      preference.timezone,
      preference.quietHoursStart,
      preference.quietHoursEnd
    ).quiet
  ) {
    await repositories.notificationDeliveries.transition(
      owned.delivery.id,
      "leased",
      "deferred_quiet_hours",
      now.toISOString(),
      null,
      new Date(now.getTime() + 60 * 60_000).toISOString()
    );
    return { status: "deferred", deliveryId: owned.delivery.id };
  }
  const deliveredDuringWindow = (await repositories.notificationDeliveries.list()).filter(
    (candidate) =>
      candidate.state === "delivered" &&
      candidate.deliveredAt !== null &&
      Date.parse(candidate.deliveredAt) > now.getTime() - 60 * 60_000
  ).length;
  if (deliveredDuringWindow >= preference.hourlyLimit) {
    await repositories.notificationDeliveries.transition(
      owned.delivery.id,
      "leased",
      "deferred_rate_limit",
      now.toISOString(),
      null,
      new Date(now.getTime() + 60 * 60_000).toISOString()
    );
    return { status: "deferred", deliveryId: owned.delivery.id };
  }
  if (signal?.aborted) throw signal.reason;
  const resolved = PushSubscriptionDataSchema.parse(
    await dependencies.resolveSubscription(owned.userId, subscription)
  );
  const result = await dependencies.provider.send({
    subscription: resolved,
    payload: owned.delivery.payload,
    ...(signal ? { signal } : {})
  });
  if (result.status === "delivered") {
    await repositories.notificationDeliveries.transition(
      owned.delivery.id,
      "leased",
      "delivered",
      dependencies.now().toISOString()
    );
    return { status: "delivered", deliveryId: owned.delivery.id };
  }
  if (result.status === "revoked") {
    await repositories.webPushSubscriptions.transition(
      subscription.id,
      "active",
      "revoked",
      dependencies.now().toISOString()
    );
    await repositories.notificationDeliveries.transition(
      owned.delivery.id,
      "leased",
      "permanently_failed",
      dependencies.now().toISOString(),
      result.safeErrorCode
    );
    return { status: "permanently_failed", deliveryId: owned.delivery.id };
  }
  const retryable = result.status === "retryable_failed";
  const retryAt = new Date(
    dependencies.now().getTime() + Math.min(3_600_000, 60_000 * 2 ** owned.delivery.attemptCount)
  ).toISOString();
  await repositories.notificationDeliveries.transition(
    owned.delivery.id,
    "leased",
    retryable ? "retryable_failed" : "permanently_failed",
    dependencies.now().toISOString(),
    result.safeErrorCode,
    retryable ? retryAt : undefined
  );
  return {
    status: retryable ? "retryable_failed" : "permanently_failed",
    deliveryId: owned.delivery.id
  };
}
