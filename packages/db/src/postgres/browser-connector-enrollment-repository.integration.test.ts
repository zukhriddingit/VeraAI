import type { VeraUserId } from "@vera/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createPostgresBrowserConnectorEnrollmentRepository,
  type ConsumeBrowserConnectorEnrollmentInput,
  type IssueBrowserConnectorEnrollmentInput
} from "./browser-connector-enrollment-repository.ts";
import { createPostgresBrowserGatewayAssignmentRepository } from "./browser-gateway-assignment-repository.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { browserConnectorEnrollmentTickets, users } from "./schema.ts";
import { withPostgresTestDatabase, type PostgresTestContext } from "./testing.ts";

const userA = "22222222-2222-4222-8222-222222222222" as VeraUserId;
const userB = "33333333-3333-4333-8333-333333333333" as VeraUserId;
const assignmentA = "11111111-1111-4111-8111-111111111111";
const assignmentB = "44444444-4444-4444-8444-444444444444";
const issuedAt = "2026-08-14T12:00:00.000Z";
const expiresAt = "2026-08-14T12:01:00.000Z";

async function seedAssignment(
  context: PostgresTestContext,
  userId: VeraUserId,
  assignmentId: string,
  suffix: "a" | "b"
) {
  await context.db.insert(users).values({
    id: userId,
    name: `Tester ${suffix.toUpperCase()}`,
    email: `browser-enrollment-${suffix}@example.test`,
    emailVerified: true
  });
  const repositories = createPostgresRepositoryProvider(context.connection).forUser(userId);
  await repositories.browserNodes.upsert({
    nodeId: `enrollment-node-${suffix}`,
    providerId: "openclaw-2026.6.33",
    nodeName: `Enrollment node ${suffix}`,
    status: "online",
    pairingState: "not_paired",
    capabilityApprovalState: "not_approved",
    selectedProfileId: null,
    allowedProfileIds: [],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: issuedAt,
    heartbeatExpiresAt: "2026-08-14T12:30:00.000Z",
    lastSuccessfulCaptureAt: null,
    disabledAt: null,
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt: issuedAt,
    updatedAt: issuedAt
  });
  const assignments = createPostgresBrowserGatewayAssignmentRepository(context.connection);
  await assignments.createPending({
    id: assignmentId,
    userId,
    nodeId: `enrollment-node-${suffix}`,
    maritimeAgentId: `enrollment-agent-${suffix}`,
    gatewayOrigin: `https://enrollment-${suffix}.verahousing.app`,
    checkpointOrigin: "https://app.verahousing.app",
    secretReference: `ENROLL_${suffix.toUpperCase()}_202608`,
    relayCredentialDigest: suffix === "a" ? "1".repeat(64) : "2".repeat(64),
    checkpointCredentialDigest: suffix === "a" ? "3".repeat(64) : "4".repeat(64),
    createdAt: issuedAt
  });
  await assignments.activate({ assignmentId, activatedAt: issuedAt });
}

function issueInput(
  overrides: Partial<IssueBrowserConnectorEnrollmentInput> = {}
): IssueBrowserConnectorEnrollmentInput {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    deviceId: "60000000-0000-4000-8000-000000000001",
    userId: userA,
    assignmentId: assignmentA,
    installationDigest: "a".repeat(64),
    ticketDigest: "b".repeat(64),
    extensionVersion: "2.2.0",
    protocolVersion: "1",
    gatewayOrigin: "https://enrollment-a.verahousing.app",
    idempotencyKey: "c".repeat(64),
    issuedAt,
    expiresAt,
    ...overrides
  };
}

function consumeInput(
  overrides: Partial<ConsumeBrowserConnectorEnrollmentInput> = {}
): ConsumeBrowserConnectorEnrollmentInput {
  return {
    userId: userA,
    assignmentId: assignmentA,
    ticketDigest: "b".repeat(64),
    installationDigest: "a".repeat(64),
    extensionVersion: "2.2.0",
    protocolVersion: "1",
    gatewayOrigin: "https://enrollment-a.verahousing.app",
    consumedAt: "2026-08-14T12:00:30.000Z",
    ...overrides
  };
}

describe("browser connector enrollment repository", () => {
  it("persists only digests and atomically consumes a ticket once", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedAssignment(context, userA, assignmentA, "a");
      const repository = createPostgresBrowserConnectorEnrollmentRepository(context.connection);

      await expect(repository.issue(issueInput())).resolves.toMatchObject({ status: "issued" });
      const results = await Promise.all([
        repository.consume(consumeInput()),
        repository.consume(consumeInput())
      ]);
      expect(results.map((result) => result.outcome).sort()).toEqual([
        "consumed",
        "ticket_replayed"
      ]);

      const columns = await context.db.execute<{ column_name: string }>(sql`
        select column_name
        from information_schema.columns
        where table_schema = ${context.schemaName}
          and table_name = 'browser_connector_enrollment_tickets'
        order by column_name
      `);
      expect(columns.rows.map((row) => row.column_name)).not.toEqual(
        expect.arrayContaining(["ticket", "relay_token", "relay_credential"])
      );
    });
  });

  it("fails closed across owners, assignments, versions, and devices", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedAssignment(context, userA, assignmentA, "a");
      await seedAssignment(context, userB, assignmentB, "b");
      const repository = createPostgresBrowserConnectorEnrollmentRepository(context.connection);
      await repository.issue(issueInput());

      await expect(
        repository.consume(consumeInput({ userId: userB, assignmentId: assignmentB }))
      ).resolves.toEqual({ outcome: "ticket_invalid" });
      await expect(
        repository.consume(consumeInput({ extensionVersion: "2.3.0" }))
      ).resolves.toEqual({ outcome: "version_incompatible" });
      await expect(
        repository.issue(
          issueInput({
            id: "50000000-0000-4000-8000-000000000002",
            deviceId: "60000000-0000-4000-8000-000000000002",
            installationDigest: "d".repeat(64),
            ticketDigest: "e".repeat(64),
            idempotencyKey: "f".repeat(64)
          })
        )
      ).rejects.toThrow("active enrollment ticket");
    });
  });

  it("expires bounded tickets and revokes owner devices without touching another owner", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedAssignment(context, userA, assignmentA, "a");
      await seedAssignment(context, userB, assignmentB, "b");
      const repository = createPostgresBrowserConnectorEnrollmentRepository(context.connection);
      await repository.issue(issueInput());
      await repository.issue(
        issueInput({
          id: "50000000-0000-4000-8000-000000000002",
          deviceId: "60000000-0000-4000-8000-000000000002",
          userId: userB,
          assignmentId: assignmentB,
          installationDigest: "d".repeat(64),
          ticketDigest: "e".repeat(64),
          gatewayOrigin: "https://enrollment-b.verahousing.app",
          idempotencyKey: "f".repeat(64)
        })
      );

      await expect(
        repository.expireBatch({ now: "2026-08-14T12:02:00.000Z", limit: 1 })
      ).resolves.toBe(1);
      await expect(
        repository.revokeForUser({ userId: userA, revokedAt: "2026-08-14T12:03:00.000Z" })
      ).resolves.toBe(1);
      const rows = await context.db.select().from(browserConnectorEnrollmentTickets);
      expect(rows.find((row) => row.userId === userB)?.status).not.toBe("revoked");
    });
  });

  it("rejects a ticket lifetime above sixty seconds", async () => {
    await withPostgresTestDatabase(async (context) => {
      await seedAssignment(context, userA, assignmentA, "a");
      const repository = createPostgresBrowserConnectorEnrollmentRepository(context.connection);
      await expect(
        repository.issue(issueInput({ expiresAt: "2026-08-14T12:01:00.001Z" }))
      ).rejects.toThrow();
    });
  });
});
