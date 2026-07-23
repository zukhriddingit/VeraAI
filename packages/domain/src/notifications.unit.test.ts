import { describe, expect, it } from "vitest";

import {
  NotificationPayloadSchema,
  NotificationPreferenceSchema,
  WebPushSubscriptionRecordSchema
} from "./notifications.ts";

const NOW = "2026-07-22T12:00:00.000Z";

describe("notification contracts", () => {
  it("accepts only generic lock-screen copy and a same-origin listing link", () => {
    expect(
      NotificationPayloadSchema.parse({
        title: "Vera found a new match",
        body: "Open Vera to review a new listing.",
        deepLink: "/listings/listing-1"
      })
    ).toBeTruthy();
    expect(() =>
      NotificationPayloadSchema.parse({
        title: "Vera found a new match",
        body: "12 Main St for $2,000",
        deepLink: "/listings/listing-1"
      })
    ).toThrow();
    expect(() =>
      NotificationPayloadSchema.parse({
        title: "Vera found a new match",
        body: "Open Vera to review a new listing.",
        deepLink: "https://attacker.example/listing-1"
      })
    ).toThrow();
  });

  it("validates explicit quiet hours and score/risk limits", () => {
    expect(
      NotificationPreferenceSchema.parse({
        userId: "00000000-0000-4000-8000-000000000001",
        enabled: true,
        scoreThreshold: 75,
        freshnessMinutes: 120,
        riskCeiling: "medium",
        timezone: "America/New_York",
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        hourlyLimit: 4,
        digestEnabled: true,
        createdAt: NOW,
        updatedAt: NOW
      })
    ).toMatchObject({ scoreThreshold: 75 });
  });

  it("requires encrypted push subscription material", () => {
    expect(() =>
      WebPushSubscriptionRecordSchema.parse({
        id: "push-subscription-1",
        userId: "00000000-0000-4000-8000-000000000001",
        endpointHash: "c".repeat(64),
        encryptedSubscription: { endpoint: "https://push.example/subscription" },
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        revokedAt: null
      })
    ).toThrow();
  });
});
