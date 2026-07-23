import {
  CanonicalListingSummarySchema,
  NotificationPreferenceSchema,
  SearchProfileSchema,
  type NotificationDelivery,
  type VeraUserId
} from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { fanOutEligibleNotifications } from "./notification-fanout.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const NOW = new Date("2026-07-22T12:00:00.000Z");

describe("notification fan-out", () => {
  it("queues one generic, idempotent delivery for an eligible canonical listing", async () => {
    const deliveries: NotificationDelivery[] = [];
    let sequence = 0;
    const listing = CanonicalListingSummarySchema.parse({
      id: "listing-1",
      title: "Sanitized listing",
      address: {
        line1: "1 Example Way",
        unit: null,
        city: "Boston",
        region: "MA",
        postalCode: null,
        countryCode: "US"
      },
      monthlyRentCents: 200_000,
      recurringFeesCents: 0,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 700,
      availableOn: "2026-09-01",
      leaseTermMonths: 12,
      petPolicy: null,
      lifecycleState: "new",
      completenessBasisPoints: 8_000,
      freshestObservedAt: "2026-07-22T11:30:00.000Z",
      freshestSourcePostedAt: null,
      alertLatencySeconds: null,
      sourceLabels: ["other"],
      sourceRecordCount: 1,
      duplicateCount: 0,
      unknownFields: [],
      fitScoreBasisPoints: 9_000,
      eligible: true,
      fitLabel: "strong_fit",
      topPositiveReason: "Matches the configured budget.",
      topConcern: null,
      riskIndicatorCount: 0,
      highestRiskSeverity: null
    });
    const preference = NotificationPreferenceSchema.parse({
      userId: USER_ID,
      enabled: true,
      scoreThreshold: 75,
      freshnessMinutes: 120,
      riskCeiling: "medium",
      timezone: "America/New_York",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      hourlyLimit: 4,
      digestEnabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });
    const profile = SearchProfileSchema.parse({
      id: "profile-1",
      name: "Founder search",
      version: 1,
      locationText: "Boston, MA",
      centerLatitude: null,
      centerLongitude: null,
      radiusKilometers: null,
      minimumBedrooms: 1,
      minimumBathrooms: 1,
      targetMonthlyTotalCents: 200_000,
      absoluteMonthlyMaximumCents: 250_000,
      moveInEarliest: null,
      moveInLatest: null,
      petRequirements: [],
      commuteAnchors: [],
      hardConstraints: [],
      weightedPreferences: [],
      notificationRules: { enabled: true, minimumScoreBasisPoints: 8_000 },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString()
    });
    const repositories = {
      notificationPreferences: { get: vi.fn(async () => preference) },
      webPushSubscriptions: {
        list: vi.fn(async () => [
          {
            id: "subscription-1",
            userId: USER_ID,
            endpointHash: "a".repeat(64),
            encryptedSubscription: {
              version: 1 as const,
              algorithm: "aes-256-gcm" as const,
              keyId: "test",
              nonce: "AA==",
              ciphertext: "AA==",
              authenticationTag: "AA=="
            },
            status: "active" as const,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
            revokedAt: null
          }
        ])
      },
      canonicalListings: { listSummaries: vi.fn(async () => [listing]) },
      searchProfiles: { list: vi.fn(async () => [profile]) },
      notificationDeliveries: {
        list: vi.fn(async () => deliveries),
        enqueue: vi.fn(async (delivery: NotificationDelivery) => {
          const prior = deliveries.find(
            ({ idempotencyKey }) => idempotencyKey === delivery.idempotencyKey
          );
          if (prior) return { record: prior, inserted: false };
          deliveries.push(delivery);
          return { record: delivery, inserted: true };
        })
      },
      activityEvents: { append: vi.fn(async (event) => event) }
    };
    const dependencies = {
      userId: USER_ID,
      repositories,
      killSwitchActive: false,
      now: () => NOW,
      createId: () => `generated-${++sequence}`
    };

    await expect(fanOutEligibleNotifications(dependencies)).resolves.toMatchObject({
      queued: 1,
      suppressed: 0
    });
    await expect(fanOutEligibleNotifications(dependencies)).resolves.toMatchObject({
      queued: 0,
      suppressed: 1
    });
    expect(deliveries[0]?.payload).toEqual({
      title: "Vera found a new match",
      body: "Open Vera to review a new listing.",
      deepLink: "/listings/listing-1"
    });
    expect(JSON.stringify(deliveries)).not.toMatch(/Example Way|200000/iu);
  });
});
