import type { VeraUserId } from "@vera/domain";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresPrivacyLifecycleRepository } from "./privacy-lifecycle-repository.ts";
import { privacyOwnerTableNames } from "./privacy-owner-table-policy.ts";
import {
  accounts,
  betaAccessRequests,
  betaMemberships,
  browserGatewayAssignments,
  browserNodes,
  integrationConnections,
  notificationPreferences,
  privacyDeletionReceipts,
  rawListings,
  sessions,
  users,
  verifications,
  webPushSubscriptions
} from "./schema.ts";
import { withPostgresTestDatabase, type PostgresTestContext } from "./testing.ts";

const userA = "10000000-0000-4000-8000-000000000001" as VeraUserId;
const userB = "20000000-0000-4000-8000-000000000002" as VeraUserId;
const challengeId = "30000000-0000-4000-8000-000000000003";
const now = "2026-08-16T12:00:00.000Z";
const expiresAt = "2026-08-16T12:15:00.000Z";

async function seedOwner(context: PostgresTestContext, userId: VeraUserId, suffix: "a" | "b") {
  const email = `privacy-${suffix}@example.test`;
  const createdAt = new Date(now);
  await context.db.insert(users).values({
    id: userId,
    name: `Privacy Tester ${suffix.toUpperCase()}`,
    email,
    emailVerified: true,
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(accounts).values({
    id:
      suffix === "a"
        ? "40000000-0000-4000-8000-000000000004"
        : "50000000-0000-4000-8000-000000000005",
    accountId: `google-subject-${suffix}`,
    providerId: "google",
    userId,
    accessToken: `access-token-${suffix}`,
    refreshToken: `refresh-token-${suffix}`,
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(sessions).values({
    id:
      suffix === "a"
        ? "60000000-0000-4000-8000-000000000006"
        : "70000000-0000-4000-8000-000000000007",
    userId,
    token: `session-token-${suffix}`,
    expiresAt: new Date("2026-08-17T12:00:00.000Z"),
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(integrationConnections).values({
    id:
      suffix === "a"
        ? "80000000-0000-4000-8000-000000000008"
        : "90000000-0000-4000-8000-000000000009",
    userId,
    provider: "google",
    providerSubjectId: `provider-subject-${suffix}`,
    displayEmail: email,
    credentialVersion: 1,
    credentialAlgorithm: "aes-256-gcm",
    credentialKeyId: `privacy-key-${suffix}`,
    credentialNonce: Buffer.alloc(12, suffix === "a" ? 1 : 2),
    credentialCiphertext: Buffer.from(`credential-${suffix}`),
    credentialAuthenticationTag: Buffer.alloc(16, suffix === "a" ? 3 : 4),
    grantedScopes: ["scope:read"],
    status: "connected",
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(betaAccessRequests).values({
    normalizedEmail: email,
    status: "invited",
    consentVersion: "private-beta.v1",
    consentedAt: createdAt,
    requestedAt: createdAt
  });
  await context.db.insert(betaMemberships).values({
    normalizedEmail: email,
    userId,
    status: "active",
    invitedAt: createdAt,
    activatedAt: createdAt
  });
  await context.db.insert(verifications).values({
    identifier: email,
    value: `verification-secret-${suffix}`,
    expiresAt: new Date("2026-08-17T12:00:00.000Z"),
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(rawListings).values({
    userId,
    id: `raw-listing-${suffix}`,
    source: "other",
    acquisitionMode: "user_capture",
    captureMethod: "manual_text",
    observedAt: createdAt,
    rawText: `listing-owned-by-${suffix}`,
    captureMetadata: {},
    contentHash: suffix === "a" ? "a".repeat(64) : "b".repeat(64),
    idempotencyKey: `privacy-listing-${suffix}`,
    createdAt
  });
  await context.db.insert(notificationPreferences).values({
    userId,
    enabled: true,
    scoreThreshold: 80,
    freshnessMinutes: 60,
    riskCeiling: "medium",
    timezone: "America/New_York",
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    hourlyLimit: 3,
    digestEnabled: false,
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(webPushSubscriptions).values({
    userId,
    id: `push-${suffix}`,
    endpointHash: suffix === "a" ? "c".repeat(64) : "d".repeat(64),
    credentialVersion: 1,
    credentialAlgorithm: "aes-256-gcm",
    credentialKeyId: `push-key-${suffix}`,
    credentialNonce: Buffer.alloc(12, 5),
    credentialCiphertext: Buffer.from(`push-secret-${suffix}`),
    credentialAuthenticationTag: Buffer.alloc(16, 6),
    status: "active",
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(browserNodes).values({
    userId,
    nodeId: `privacy-node-${suffix}`,
    providerId: "openclaw-2026.6.33",
    nodeName: `Privacy browser ${suffix}`,
    status: "online",
    pairingState: "paired",
    capabilityApprovalState: "approved",
    selectedProfileId: "vera-search",
    allowedProfileIds: ["vera-search"],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: createdAt,
    heartbeatExpiresAt: new Date("2026-08-16T12:30:00.000Z"),
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt,
    updatedAt: createdAt
  });
  await context.db.insert(browserGatewayAssignments).values({
    id:
      suffix === "a"
        ? "a0000000-0000-4000-8000-00000000000a"
        : "b0000000-0000-4000-8000-00000000000b",
    userId,
    nodeId: `privacy-node-${suffix}`,
    maritimeAgentId: `privacy-agent-${suffix}`,
    gatewayOrigin: `https://privacy-${suffix}.verahousing.app`,
    checkpointOrigin: "https://app.verahousing.app",
    secretReference: `PRIVACY_${suffix.toUpperCase()}`,
    relayCredentialDigest: suffix === "a" ? "e".repeat(64) : "f".repeat(64),
    checkpointCredentialDigest: suffix === "a" ? "1".repeat(64) : "2".repeat(64),
    status: "active",
    createdAt,
    activatedAt: createdAt
  });
}

describe("PostgreSQL privacy lifecycle repository", () => {
  it("exports and deletes exactly one owner, denies challenge replay, and reapplies receipts", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedOwner(context, userA, "a");
      await seedOwner(context, userB, "b");
      const repository = createPostgresPrivacyLifecycleRepository(context.connection);

      const exported = await repository.exportOwner({ userId: userA, generatedAt: now });
      const json = JSON.stringify(exported);
      expect(json).toContain("listing-owned-by-a");
      expect(json).not.toContain("listing-owned-by-b");
      expect(json).not.toContain("refresh-token-a");
      expect(json).not.toContain("session-token-a");
      expect(json).not.toContain("relayCredentialDigest");
      expect(exported.manifest.recordCounts.raw_listings).toBe(1);

      const issued = await repository.issueDeletionChallenge({
        id: challengeId,
        userId: userA,
        challengeDigest: "3".repeat(64),
        createdAt: now,
        expiresAt
      });
      await expect(
        repository.consumeDeletionChallenge({
          userId: userB,
          challengeDigest: issued.challengeDigest,
          consumedAt: now
        })
      ).rejects.toThrow("challenge");
      await expect(
        repository.consumeDeletionChallenge({
          userId: userA,
          challengeDigest: issued.challengeDigest,
          consumedAt: now
        })
      ).resolves.toBe(challengeId);
      await expect(
        repository.consumeDeletionChallenge({
          userId: userA,
          challengeDigest: issued.challengeDigest,
          consumedAt: now
        })
      ).rejects.toThrow("challenge");

      await expect(repository.getDeletionIdentity(userA)).resolves.toEqual({
        normalizedEmail: "privacy-a@example.test",
        providerSubject: "provider-subject-a"
      });
      const receipt = await repository.deleteOwnerAccount({
        userId: userA,
        consumedChallengeId: challengeId,
        subjectDigest: "4".repeat(64),
        providerRevocation: "confirmed",
        browserRevocation: "confirmed",
        completedAt: now,
        backupEraseAfter: "2026-09-15T12:00:00.000Z",
        legalHoldUntil: null
      });
      expect(JSON.stringify(receipt)).not.toMatch(/email|token|secret|credential|nonce|url/iu);
      expect(Object.values(await repository.countOwnerRows(userA))).toEqual(
        expect.arrayContaining([0])
      );
      expect(
        Object.values(await repository.countOwnerRows(userA)).every((count) => count === 0)
      ).toBe(true);
      expect((await repository.countOwnerRows(userB)).raw_listings).toBe(1);
      await expect(context.db.select().from(users).where(eq(users.id, userA))).resolves.toEqual([]);
      await expect(
        context.db.select().from(users).where(eq(users.id, userB))
      ).resolves.toHaveLength(1);
      await expect(
        context.db
          .select()
          .from(betaAccessRequests)
          .where(eq(betaAccessRequests.normalizedEmail, "privacy-a@example.test"))
      ).resolves.toEqual([]);
      await expect(
        context.db
          .select()
          .from(verifications)
          .where(eq(verifications.identifier, "privacy-a@example.test"))
      ).resolves.toEqual([]);

      await context.db.insert(users).values({
        id: userA,
        name: "Restored owner",
        email: "privacy-a@example.test",
        emailVerified: true,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await context.db.insert(sessions).values({
        userId: userA,
        token: "restored-session",
        expiresAt: new Date("2026-08-17T12:00:00.000Z"),
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await expect(repository.reapplyDeletionReceipt(receipt)).resolves.toBe("reapplied");
      await expect(repository.reapplyDeletionReceipt(receipt)).resolves.toBe("absent");
      await expect(context.db.select().from(users).where(eq(users.id, userA))).resolves.toEqual([]);
    });
  });

  it("requires every current user_id table to have an explicit privacy policy", async () => {
    await withPostgresTestDatabase(async ({ connection, schemaName }) => {
      const result = await connection.db.execute<{ table_name: string }>(sql`
        select table_name
        from information_schema.columns
        where table_schema = ${schemaName} and column_name = 'user_id'
        order by table_name
      `);
      expect(result.rows.map((row) => row.table_name)).toEqual(privacyOwnerTableNames);
    });
  });

  it("keeps direct append-only deletion blocked even when an owner receipt exists", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedOwner(context, userA, "a");
      await context.db.insert(privacyDeletionReceipts).values({
        id: "c0000000-0000-4000-8000-00000000000c",
        formerUserId: userA,
        subjectDigest: "5".repeat(64),
        providerRevocation: "not_configured",
        browserRevocation: "not_configured",
        completedAt: new Date(now),
        backupEraseAfter: new Date("2026-09-15T12:00:00.000Z"),
        legalHoldUntil: null
      });

      await expect(
        context.db.delete(rawListings).where(eq(rawListings.userId, userA))
      ).rejects.toThrow();
      await expect(
        context.db.select().from(rawListings).where(eq(rawListings.userId, userA))
      ).resolves.toHaveLength(1);
    });
  });
});
