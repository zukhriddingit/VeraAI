import type { NotificationDelivery, VeraUserId, WebPushSubscriptionRecord } from "@vera/domain";
import { MockNotificationProvider } from "@vera/notifications";
import { describe, expect, it, vi } from "vitest";

import { processNextNotification } from "./notification-worker.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const NOW = new Date("2026-07-22T16:00:00.000Z");
const delivery: NotificationDelivery = {
  id: "delivery-1",
  userId: USER_ID,
  canonicalListingId: "listing-1",
  subscriptionId: "subscription-1",
  idempotencyKey: "a".repeat(64),
  payloadHash: "b".repeat(64),
  state: "leased",
  payload: {
    title: "Vera found a new match",
    body: "Open Vera to review a new listing.",
    deepLink: "/listings/listing-1"
  },
  attemptCount: 1,
  availableAt: NOW.toISOString(),
  leaseOwner: "worker-1",
  leaseExpiresAt: "2026-07-22T16:01:00.000Z",
  deliveredAt: null,
  safeErrorCode: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString()
};
const subscription: WebPushSubscriptionRecord = {
  id: "subscription-1",
  userId: USER_ID,
  endpointHash: "c".repeat(64),
  encryptedSubscription: {
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: "test",
    nonce: "AAECAw==",
    ciphertext: "BAUGBw==",
    authenticationTag: "CAkKCw=="
  },
  status: "active",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  revokedAt: null
};

describe("notification worker", () => {
  it("delivers generic payload once and persists the outcome", async () => {
    const transition = vi.fn(async () => ({
      ...delivery,
      state: "delivered" as const,
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveredAt: NOW.toISOString()
    }));
    const provider = new MockNotificationProvider();
    await expect(
      processNextNotification({
        queue: {
          claimNextNotificationDelivery: vi.fn(async () => ({ userId: USER_ID, delivery }))
        },
        repositoriesForUser: () => ({
          notificationPreferences: {
            get: vi.fn(async () => ({
              userId: USER_ID,
              enabled: true,
              scoreThreshold: 75,
              freshnessMinutes: 120,
              riskCeiling: "medium" as const,
              timezone: "America/New_York",
              quietHoursStart: "22:00",
              quietHoursEnd: "07:00",
              hourlyLimit: 4,
              digestEnabled: true,
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString()
            }))
          },
          webPushSubscriptions: { getById: vi.fn(async () => subscription), transition: vi.fn() },
          notificationDeliveries: { list: vi.fn(async () => []), transition }
        }),
        provider,
        resolveSubscription: vi.fn(async () => ({
          endpoint: "https://push.example.test/subscription",
          expirationTime: null,
          keys: { p256dh: "public", auth: "auth" }
        })),
        leaseOwner: "worker-1",
        now: () => NOW
      })
    ).resolves.toMatchObject({ status: "delivered", deliveryId: delivery.id });
    expect(provider.deliveries).toEqual([delivery.payload]);
    expect(transition).toHaveBeenCalledWith(delivery.id, "leased", "delivered", NOW.toISOString());
  });

  it("defers to the digest window after reaching the per-user hourly limit", async () => {
    const transition = vi.fn(async () => ({
      ...delivery,
      state: "deferred_rate_limit" as const,
      leaseOwner: null,
      leaseExpiresAt: null
    }));
    const delivered = {
      ...delivery,
      id: "delivery-prior",
      state: "delivered" as const,
      deliveredAt: new Date(NOW.getTime() - 30_000).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null
    };
    const provider = new MockNotificationProvider();
    await expect(
      processNextNotification({
        queue: {
          claimNextNotificationDelivery: vi.fn(async () => ({ userId: USER_ID, delivery }))
        },
        repositoriesForUser: () => ({
          notificationPreferences: {
            get: vi.fn(async () => ({
              userId: USER_ID,
              enabled: true,
              scoreThreshold: 75,
              freshnessMinutes: 120,
              riskCeiling: "medium" as const,
              timezone: "America/New_York",
              quietHoursStart: "22:00",
              quietHoursEnd: "07:00",
              hourlyLimit: 1,
              digestEnabled: true,
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString()
            }))
          },
          webPushSubscriptions: { getById: vi.fn(async () => subscription), transition: vi.fn() },
          notificationDeliveries: { list: vi.fn(async () => [delivered]), transition }
        }),
        provider,
        resolveSubscription: vi.fn(),
        leaseOwner: "worker-1",
        now: () => NOW
      })
    ).resolves.toMatchObject({ status: "deferred", deliveryId: delivery.id });
    expect(provider.deliveries).toHaveLength(0);
    expect(transition).toHaveBeenCalledWith(
      delivery.id,
      "leased",
      "deferred_rate_limit",
      NOW.toISOString(),
      null,
      new Date(NOW.getTime() + 60 * 60_000).toISOString()
    );
  });
});
