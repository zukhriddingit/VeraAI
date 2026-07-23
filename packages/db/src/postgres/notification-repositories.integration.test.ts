import type { VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { CANONICAL_FIXTURES, DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import { sha256Text } from "../hashing.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { webPushSubscriptions, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";
import { createPostgresWorkerQueue } from "./worker-queue.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;
const NOW = "2026-07-22T12:00:00.000Z";

async function seedListing(connection: Parameters<typeof createPostgresRepositoryProvider>[0]) {
  await connection.db.insert(users).values([
    { id: aliceId, name: "Alice", email: "alice-push@example.test", emailVerified: true },
    { id: bobId, name: "Bob", email: "bob-push@example.test", emailVerified: true }
  ]);
  const provider = createPostgresRepositoryProvider(connection);
  const alice = provider.forUser(aliceId);
  await alice.searchProfiles.insert(DEMO_SEARCH_PROFILE);
  const fixture = CANONICAL_FIXTURES.find(({ listing }) => listing.id === "can-orchard-loft");
  if (!fixture) throw new Error("Canonical notification fixture is missing.");
  const source = SOURCE_FIXTURES.find(
    ({ sourceRecord }) => sourceRecord.id === fixture.listing.primarySourceRecordId
  );
  if (!source) throw new Error("Source notification fixture is missing.");
  await alice.rawListings.import(source.capture);
  await alice.sourceRecords.insert(source.sourceRecord);
  await alice.canonicalListings.insert(fixture.listing);
  return { provider, listing: fixture.listing };
}

const encryptedSubscription = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  keyId: "push-test-key",
  nonce: Buffer.alloc(12, 1).toString("base64"),
  ciphertext: Buffer.alloc(32, 2).toString("base64"),
  authenticationTag: Buffer.alloc(16, 3).toString("base64")
};

describe("PostgreSQL notification repositories", () => {
  it("stores encrypted subscriptions and never returns them across tenants", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      const { provider } = await seedListing(connection);
      const subscription = {
        id: "push-subscription-1",
        userId: aliceId,
        endpointHash: sha256Text("https://push.example.test/subscription"),
        encryptedSubscription,
        status: "active" as const,
        createdAt: NOW,
        updatedAt: NOW,
        revokedAt: null
      };
      await provider.forUser(aliceId).webPushSubscriptions.insert(subscription);
      await expect(provider.forUser(bobId).webPushSubscriptions.list()).resolves.toEqual([]);
      const rawRows = await db.select().from(webPushSubscriptions);
      expect(JSON.stringify(rawRows)).not.toContain("https://push.example.test/subscription");
      await expect(
        provider.forUser(bobId).webPushSubscriptions.insert(subscription)
      ).rejects.toMatchObject({ category: "ownership_violation" });
    });
  });

  it("deduplicates delivery and prevents duplicate concurrent claims", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const { provider, listing } = await seedListing(connection);
      const alice = provider.forUser(aliceId);
      const subscription = await alice.webPushSubscriptions.insert({
        id: "push-subscription-1",
        userId: aliceId,
        endpointHash: sha256Text("https://push.example.test/subscription"),
        encryptedSubscription,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        revokedAt: null
      });
      const delivery = {
        id: "notification-delivery-1",
        userId: aliceId,
        canonicalListingId: listing.id,
        subscriptionId: subscription.id,
        idempotencyKey: sha256Text(`notification:${listing.id}:${subscription.id}`),
        payloadHash: sha256Text("generic-notification-v1"),
        state: "queued" as const,
        payload: {
          title: "Vera found a new match" as const,
          body: "Open Vera to review a new listing." as const,
          deepLink: `/listings/${listing.id}`
        },
        attemptCount: 0,
        availableAt: NOW,
        leaseOwner: null,
        leaseExpiresAt: null,
        deliveredAt: null,
        safeErrorCode: null,
        createdAt: NOW,
        updatedAt: NOW
      };
      await expect(alice.notificationDeliveries.enqueue(delivery)).resolves.toMatchObject({
        inserted: true
      });
      await expect(
        alice.notificationDeliveries.enqueue({ ...delivery, id: "notification-delivery-replay" })
      ).resolves.toMatchObject({ inserted: false, record: { id: delivery.id } });
      const queue = createPostgresWorkerQueue(connection);
      const claims = await Promise.all([
        queue.claimNextNotificationDelivery({
          leaseOwner: "worker-a",
          now: NOW,
          leaseExpiresAt: "2026-07-22T12:01:00.000Z"
        }),
        queue.claimNextNotificationDelivery({
          leaseOwner: "worker-b",
          now: NOW,
          leaseExpiresAt: "2026-07-22T12:01:00.000Z"
        })
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)?.delivery.state).toBe("leased");
    });
  });

  it("recovers one expired notification lease without duplicate execution", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const { provider, listing } = await seedListing(connection);
      const alice = provider.forUser(aliceId);
      const subscription = await alice.webPushSubscriptions.insert({
        id: "push-subscription-expired-lease",
        userId: aliceId,
        endpointHash: sha256Text("https://push.example.test/expired-lease"),
        encryptedSubscription,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
        revokedAt: null
      });
      await alice.notificationDeliveries.enqueue({
        id: "notification-expired-lease",
        userId: aliceId,
        canonicalListingId: listing.id,
        subscriptionId: subscription.id,
        idempotencyKey: sha256Text(`notification-expired:${listing.id}:${subscription.id}`),
        payloadHash: sha256Text("generic-notification-expired-v1"),
        state: "queued",
        payload: {
          title: "Vera found a new match",
          body: "Open Vera to review a new listing.",
          deepLink: `/listings/${listing.id}`
        },
        attemptCount: 0,
        availableAt: "2026-07-22T11:58:00.000Z",
        leaseOwner: null,
        leaseExpiresAt: null,
        deliveredAt: null,
        safeErrorCode: null,
        createdAt: "2026-07-22T11:58:00.000Z",
        updatedAt: "2026-07-22T11:58:00.000Z"
      });
      const queue = createPostgresWorkerQueue(connection);
      await expect(
        queue.claimNextNotificationDelivery({
          leaseOwner: "crashed-worker",
          now: "2026-07-22T11:58:30.000Z",
          leaseExpiresAt: "2026-07-22T11:59:00.000Z"
        })
      ).resolves.toMatchObject({ delivery: { state: "leased", attemptCount: 1 } });

      const input = {
        now: NOW,
        leaseExpiresAt: "2026-07-22T12:01:00.000Z"
      };
      const [left, right] = await Promise.all([
        queue.claimNextNotificationDelivery({ ...input, leaseOwner: "worker-a" }),
        queue.claimNextNotificationDelivery({ ...input, leaseOwner: "worker-b" })
      ]);
      expect([left, right].filter(Boolean)).toHaveLength(1);
      expect((left ?? right)?.delivery).toMatchObject({ state: "leased", attemptCount: 2 });
    });
  });
});
