import type { VeraUserId } from "@vera/domain";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresBrowserGatewayAssignmentRepository } from "./browser-gateway-assignment-repository.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { browserSourceControls, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const userA = "22222222-2222-4222-8222-222222222222" as VeraUserId;
const userB = "33333333-3333-4333-8333-333333333333" as VeraUserId;
const assignmentA = "11111111-1111-4111-8111-111111111111";
const assignmentB = "44444444-4444-4444-8444-444444444444";
const now = "2026-08-13T18:00:00.000Z";
const activatedAt = "2026-08-13T18:05:00.000Z";
const revokedAt = "2026-08-13T19:00:00.000Z";

function inputFor(userId: VeraUserId, id: string, suffix: "a" | "b") {
  return {
    id,
    userId,
    nodeId: `vera-browser-node-tester-${suffix}`,
    maritimeAgentId: `vera-browser-gateway-tester-${suffix}`,
    gatewayOrigin: `https://browser-${suffix}.verahousing.app`,
    checkpointOrigin: "https://app.verahousing.app" as const,
    secretReference: `TESTER_${suffix.toUpperCase()}_202608`,
    relayCredentialDigest: suffix === "a" ? "a".repeat(64) : "c".repeat(64),
    checkpointCredentialDigest: suffix === "a" ? "b".repeat(64) : "d".repeat(64),
    createdAt: now
  };
}

async function seedUserAndNode(
  context: Parameters<Parameters<typeof withPostgresTestDatabase>[0]>[0],
  userId: VeraUserId,
  suffix: "a" | "b"
) {
  await context.db.insert(users).values({
    id: userId,
    name: `Tester ${suffix.toUpperCase()}`,
    email: `tester-${suffix}@example.test`,
    emailVerified: true
  });
  const repositories = createPostgresRepositoryProvider(context.connection).forUser(userId);
  await repositories.browserNodes.upsert({
    nodeId: `vera-browser-node-tester-${suffix}`,
    providerId: "openclaw-2026.6.33",
    nodeName: `Tester ${suffix.toUpperCase()} browser`,
    status: "online",
    pairingState: "paired",
    capabilityApprovalState: "approved",
    selectedProfileId: "vera-search",
    allowedProfileIds: ["vera-search"],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: now,
    heartbeatExpiresAt: "2026-08-13T18:30:00.000Z",
    lastSuccessfulCaptureAt: null,
    disabledAt: null,
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt: now,
    updatedAt: now
  });
  await repositories.browserIntegrationControls.upsert({
    userBrowserEnabled: true,
    zillowSourceEnabled: true,
    updatedAt: now
  });
  await repositories.browserProfileControls.upsert({
    nodeId: `vera-browser-node-tester-${suffix}`,
    profileId: "vera-search",
    disabledAt: null,
    updatedAt: now
  });
  return repositories;
}

describe("browser Gateway assignment repository", () => {
  it("allows only one non-revoked assignment per user", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedUserAndNode(context, userA, "a");
      const repository = createPostgresBrowserGatewayAssignmentRepository(context.connection);
      await repository.createPending(inputFor(userA, assignmentA, "a"));
      await expect(
        repository.createPending({
          ...inputFor(userA, assignmentB, "a"),
          maritimeAgentId: "vera-browser-gateway-second",
          gatewayOrigin: "https://browser-second.verahousing.app",
          secretReference: "TESTER_SECOND_202608",
          relayCredentialDigest: "e".repeat(64),
          checkpointCredentialDigest: "f".repeat(64)
        })
      ).rejects.toThrow();
    });
  });

  it("resolves a checkpoint digest to exactly one active owner", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedUserAndNode(context, userA, "a");
      const repository = createPostgresBrowserGatewayAssignmentRepository(context.connection);
      await repository.createPending(inputFor(userA, assignmentA, "a"));
      await expect(repository.getActiveByCheckpointDigest("b".repeat(64))).resolves.toBeNull();
      await repository.activate({ assignmentId: assignmentA, activatedAt });
      await expect(repository.getActiveByCheckpointDigest("b".repeat(64))).resolves.toMatchObject({
        id: assignmentA,
        userId: userA,
        status: "active"
      });
      await expect(repository.getActiveByCheckpointDigest("c".repeat(64))).resolves.toBeNull();
    });
  });

  it("revokes assignment, user controls, sources, node, and profile atomically", async () => {
    await withPostgresTestDatabase(async (context) => {
      const repositories = await seedUserAndNode(context, userA, "a");
      await context.db.insert(browserSourceControls).values({
        userId: userA,
        connectorId: "apartments.browser-research.v1",
        enabled: true,
        updatedAt: new Date(now)
      });
      const repository = createPostgresBrowserGatewayAssignmentRepository(context.connection);
      await repository.createPending(inputFor(userA, assignmentA, "a"));
      await repository.activate({ assignmentId: assignmentA, activatedAt });

      await expect(repository.revokeForUser({ userId: userA, revokedAt })).resolves.toMatchObject({
        status: "revoked",
        revokedAt
      });
      await expect(repository.getActiveForUser(userA)).resolves.toBeNull();
      await expect(repository.revokeForUser({ userId: userA, revokedAt })).resolves.toBeNull();
      await expect(repository.listEnabledConnectorIdsForUser(userA)).resolves.toEqual([]);
      await expect(repositories.browserIntegrationControls.get()).resolves.toMatchObject({
        userBrowserEnabled: false,
        zillowSourceEnabled: false
      });
      await expect(
        repositories.browserNodes.getById("vera-browser-node-tester-a")
      ).resolves.toMatchObject({
        status: "revoked",
        pairingState: "revoked",
        capabilityApprovalState: "revoked",
        disabledAt: revokedAt
      });
      await expect(
        repositories.browserProfileControls.get("vera-browser-node-tester-a", "vera-search")
      ).resolves.toMatchObject({ disabledAt: revokedAt });
      const sourceCount = await context.db.execute<{ count: number }>(sql`
        select count(*)::int as count
        from ${browserSourceControls}
        where ${browserSourceControls.userId} = ${userA}
          and ${browserSourceControls.enabled} = true
      `);
      expect(sourceCount.rows).toEqual([{ count: 0 }]);
    });
  });

  it("records only owner-matched safe acceptance evidence", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedUserAndNode(context, userA, "a");
      await seedUserAndNode(context, userB, "b");
      const repository = createPostgresBrowserGatewayAssignmentRepository(context.connection);
      await repository.createPending(inputFor(userA, assignmentA, "a"));
      await repository.createPending(inputFor(userB, assignmentB, "b"));
      await repository.activate({ assignmentId: assignmentA, activatedAt });
      await repository.activate({ assignmentId: assignmentB, activatedAt });

      await expect(
        repository.recordAcceptance({
          id: "55555555-5555-4555-8555-555555555555",
          assignmentId: assignmentA,
          userId: userB,
          sourceJobId: "job-cross-user",
          source: "zillow",
          forbiddenActionCount: 0,
          unshareStoppedFutureWork: true,
          unpairVerified: true,
          completedAt: revokedAt
        })
      ).rejects.toThrow("owner does not match");

      await repository.recordAcceptance({
        id: "66666666-6666-4666-8666-666666666666",
        assignmentId: assignmentA,
        userId: userA,
        sourceJobId: "job-safe-a",
        source: "zillow",
        forbiddenActionCount: 0,
        unshareStoppedFutureWork: true,
        unpairVerified: true,
        completedAt: revokedAt
      });
      await expect(repository.summarizeAcceptance()).resolves.toEqual({
        completedRuns: 1,
        distinctUsers: 1,
        forbiddenActionCount: 0,
        unsharePasses: 1,
        unpairPasses: 1
      });

      const crossUser = await context.db
        .select()
        .from(browserSourceControls)
        .where(
          and(
            eq(browserSourceControls.userId, userB),
            eq(browserSourceControls.enabled, true)
          )
        );
      expect(crossUser.length).toBeGreaterThan(0);
    });
  });
});
