import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Text, type UserRepositories } from "@vera/db";
import {
  ActivityEventSchema,
  NotificationDeliverySchema,
  type CanonicalListingSummary,
  type NotificationPreference,
  type VeraUserId,
  type WebPushSubscriptionRecord
} from "@vera/domain";
import { evaluateNotificationEligibility } from "@vera/notifications";

interface NotificationFanoutRepositories {
  readonly notificationPreferences: Pick<UserRepositories["notificationPreferences"], "get">;
  readonly webPushSubscriptions: Pick<UserRepositories["webPushSubscriptions"], "list">;
  readonly notificationDeliveries: Pick<
    UserRepositories["notificationDeliveries"],
    "list" | "enqueue"
  >;
  readonly canonicalListings: Pick<UserRepositories["canonicalListings"], "listSummaries">;
  readonly searchProfiles: Pick<UserRepositories["searchProfiles"], "list">;
  readonly activityEvents: Pick<UserRepositories["activityEvents"], "append">;
}

export interface NotificationFanoutDependencies {
  readonly userId: VeraUserId;
  readonly repositories: NotificationFanoutRepositories;
  readonly killSwitchActive: boolean;
  readonly now: () => Date;
  readonly createId?: () => string;
}

export interface NotificationFanoutResult {
  readonly status: "completed";
  readonly considered: number;
  readonly queued: number;
  readonly suppressed: number;
}

function risk(summary: CanonicalListingSummary): "none" | "low" | "medium" | "high" {
  if (summary.highestRiskSeverity === "high") return "high";
  if (summary.highestRiskSeverity === "medium") return "medium";
  if (summary.highestRiskSeverity === "low") return "low";
  return "none";
}

function effectivePreference(
  preference: NotificationPreference,
  profileThresholdBasisPoints: number | null
): NotificationPreference {
  return {
    ...preference,
    scoreThreshold: Math.max(
      preference.scoreThreshold,
      profileThresholdBasisPoints === null ? 0 : Math.ceil(profileThresholdBasisPoints / 100)
    )
  };
}

function deliveryKey(
  userId: VeraUserId,
  listing: CanonicalListingSummary,
  subscription: WebPushSubscriptionRecord
): string {
  // One lock-screen notification per canonical listing and device. A later price
  // change can be represented in Vera without creating alert spam.
  return sha256Text(
    canonicalJson({
      namespace: "notification-delivery:v1",
      userId,
      listingId: listing.id,
      subscriptionId: subscription.id
    })
  );
}

export async function fanOutEligibleNotifications(
  dependencies: NotificationFanoutDependencies
): Promise<NotificationFanoutResult> {
  const now = dependencies.now();
  if (Number.isNaN(now.getTime())) throw new Error("Notification fan-out clock is invalid.");
  const [preference, subscriptions, listings, profiles, existingDeliveries] = await Promise.all([
    dependencies.repositories.notificationPreferences.get(),
    dependencies.repositories.webPushSubscriptions.list(),
    dependencies.repositories.canonicalListings.listSummaries(),
    dependencies.repositories.searchProfiles.list(),
    dependencies.repositories.notificationDeliveries.list()
  ]);
  const activeSubscriptions = subscriptions.filter(({ status }) => status === "active");
  if (!preference || activeSubscriptions.length === 0) {
    return { status: "completed", considered: 0, queued: 0, suppressed: 0 };
  }
  const currentProfile = [...profiles].sort((left, right) => right.version - left.version)[0];
  const profileThreshold =
    currentProfile?.notificationRules.enabled === true
      ? currentProfile.notificationRules.minimumScoreBasisPoints
      : null;
  const configured = effectivePreference(preference, profileThreshold);
  const existingKeys = new Set(existingDeliveries.map(({ idempotencyKey }) => idempotencyKey));
  let queued = 0;
  let suppressed = 0;

  for (const listing of listings) {
    for (const subscription of activeSubscriptions) {
      const idempotencyKey = deliveryKey(dependencies.userId, listing, subscription);
      const decision = evaluateNotificationEligibility({
        preference: configured,
        score: Math.floor((listing.fitScoreBasisPoints ?? 0) / 100),
        observedAt: listing.freshestObservedAt,
        now,
        hardConstraintsPassed: listing.eligible === true,
        highestRisk: risk(listing),
        alreadyDelivered: existingKeys.has(idempotencyKey),
        killSwitchActive:
          dependencies.killSwitchActive || currentProfile?.notificationRules.enabled !== true
      });
      if (!decision.eligible) {
        suppressed += 1;
        continue;
      }
      const payload = {
        title: "Vera found a new match" as const,
        body: "Open Vera to review a new listing." as const,
        deepLink: `/listings/${listing.id}`
      };
      const at = now.toISOString();
      const result = await dependencies.repositories.notificationDeliveries.enqueue(
        NotificationDeliverySchema.parse({
          id: (dependencies.createId ?? randomUUID)(),
          userId: dependencies.userId,
          canonicalListingId: listing.id,
          subscriptionId: subscription.id,
          idempotencyKey,
          payloadHash: sha256Text(canonicalJson(payload)),
          state: "queued",
          payload,
          attemptCount: 0,
          availableAt: at,
          leaseOwner: null,
          leaseExpiresAt: null,
          deliveredAt: null,
          safeErrorCode: null,
          createdAt: at,
          updatedAt: at
        })
      );
      existingKeys.add(idempotencyKey);
      if (!result.inserted) {
        suppressed += 1;
        continue;
      }
      queued += 1;
      await dependencies.repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: (dependencies.createId ?? randomUUID)(),
          correlationId: result.record.id,
          causationId: listing.id,
          actor: "system",
          action: "notification.queued",
          targetType: "notification_delivery",
          targetId: result.record.id,
          policyDecision: "authorized",
          approvalId: null,
          payloadHash: result.record.payloadHash,
          outcome: "recorded",
          errorCategory: null,
          metadata: { canonicalListingId: listing.id, channel: "web_push" },
          occurredAt: at
        })
      );
    }
  }
  return {
    status: "completed",
    considered: listings.length * activeSubscriptions.length,
    queued,
    suppressed
  };
}
