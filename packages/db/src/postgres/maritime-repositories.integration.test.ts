import { SourceJobSchema, type VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { sha256Text } from "../hashing.ts";
import { createPostgresMaritimeOperationsRepository } from "./maritime-repositories.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";
import { createPostgresWorkerQueue } from "./worker-queue.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;
const NOW = "2026-07-22T12:00:00.000Z";
const LATER = "2026-07-22T12:05:00.000Z";
const HASH = "a".repeat(64);

async function seedUsersAndJob(connection: Parameters<typeof createPostgresRepositoryProvider>[0]) {
  await connection.db.insert(users).values([
    { id: aliceId, name: "Alice", email: "alice-maritime@example.test", emailVerified: true },
    { id: bobId, name: "Bob", email: "bob-maritime@example.test", emailVerified: true }
  ]);
  const job = SourceJobSchema.parse({
    id: "job-maritime-1",
    correlationId: "correlation-maritime-1",
    connectorId: "fixture.feed.v1",
    source: "other",
    acquisitionMode: "fixture",
    manifestVersion: 1,
    trigger: "manual",
    capability: "fixture.read",
    approvalId: null,
    operation: "fixture.read_sanitized",
    payload: { acquisitionMode: "fixture", fixtureSetId: "default" },
    payloadHash: HASH,
    idempotencyKey: sha256Text("job-maritime-1"),
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null
  });
  const provider = createPostgresRepositoryProvider(connection);
  await provider.forUser(aliceId).sourceJobs.enqueue(job);
  return { provider, job };
}

function dispatch() {
  return {
    id: "dispatch-maritime-1",
    userId: aliceId,
    sourceJobId: "job-maritime-1",
    issuer: "vera-control-plane" as const,
    audience: "vera-worker",
    nonceHash: sha256Text("nonce-maritime-1"),
    payloadHash: HASH,
    state: "pending_wake" as const,
    maritimeAgentId: "vera-worker",
    maritimeRunId: null,
    issuedAt: NOW,
    expiresAt: "2026-07-22T12:10:00.000Z",
    acceptedAt: null,
    consumedAt: null,
    rejectedAt: null,
    rejectionCode: null,
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("PostgreSQL Maritime repositories", () => {
  it("reconciles a stable deployment slot to the inventoried Maritime agent ID", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const operations = createPostgresMaritimeOperationsRepository(connection.db);
      const base = {
        id: "maritime-openclaw-gateway",
        kind: "openclaw_gateway" as const,
        environment: "staging" as const,
        status: "running" as const,
        version: "unverified",
        diagnosticUrl: null,
        lastCheckedAt: NOW,
        safeErrorCode: null,
        createdAt: NOW,
        updatedAt: NOW
      };

      await operations.upsertDeployment({ ...base, maritimeAgentId: "old-gateway-agent" });
      await operations.upsertDeployment({
        ...base,
        maritimeAgentId: "existing-maritime-openclaw-agent",
        updatedAt: LATER
      });

      await expect(operations.listDeployments()).resolves.toEqual([
        expect.objectContaining({
          id: base.id,
          maritimeAgentId: "existing-maritime-openclaw-agent"
        })
      ]);
    });
  });

  it("isolates dispatches, enforces replay protection, and consumes once", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const { provider } = await seedUsersAndJob(connection);
      await expect(
        provider.forUser(aliceId).maritimeDispatches.create(dispatch())
      ).resolves.toMatchObject({
        state: "pending_wake"
      });
      await expect(
        provider.forUser(bobId).maritimeDispatches.create(dispatch())
      ).rejects.toMatchObject({ category: "ownership_violation" });
      await expect(
        provider.forUser(aliceId).maritimeDispatches.create({
          ...dispatch(),
          id: "dispatch-maritime-replay"
        })
      ).rejects.toMatchObject({ category: "conflict" });
      await expect(
        provider.forUser(aliceId).maritimeDispatches.create({
          ...dispatch(),
          id: "dispatch-maritime-retry",
          nonceHash: sha256Text("nonce-maritime-retry")
        })
      ).resolves.toMatchObject({ sourceJobId: "job-maritime-1" });

      await provider
        .forUser(aliceId)
        .maritimeDispatches.transition(dispatch().id, "pending_wake", "accepted", LATER, {
          maritimeRunId: "run-maritime-1"
        });
      const queue = createPostgresWorkerQueue(connection);
      const claims = await Promise.all([
        queue.claimNextMaritimeDispatch({
          leaseOwner: "worker-a",
          now: "2026-07-22T12:06:00.000Z",
          leaseExpiresAt: "2026-07-22T12:07:00.000Z"
        }),
        queue.claimNextMaritimeDispatch({
          leaseOwner: "worker-b",
          now: "2026-07-22T12:06:00.000Z",
          leaseExpiresAt: "2026-07-22T12:07:00.000Z"
        })
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)?.dispatch.state).toBe("consumed");
      await expect(
        provider.forUser(bobId).maritimeDispatches.getById(dispatch().id)
      ).resolves.toBeNull();
    });
  });

  it("creates one schedule run per idempotency key", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const { provider } = await seedUsersAndJob(connection);
      const repositories = provider.forUser(aliceId);
      await repositories.productionSchedules.upsert({
        id: "schedule-gmail-1",
        userId: aliceId,
        kind: "gmail_alert_ingestion",
        state: "enabled",
        intervalSeconds: 300,
        sourceConfigurationId: "gmail-alerts",
        nextRunAt: NOW,
        lastRunAt: null,
        createdAt: NOW,
        updatedAt: NOW
      });
      const run = {
        id: "schedule-run-1",
        userId: aliceId,
        scheduleId: "schedule-gmail-1",
        state: "created" as const,
        dueAt: NOW,
        idempotencyKey: sha256Text("schedule-gmail-1:2026-07-22T12:00:00.000Z"),
        sourceJobId: null,
        attemptCount: 0,
        safeErrorCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW
      };
      await expect(repositories.productionSchedules.createRun(run)).resolves.toMatchObject({
        inserted: true
      });
      await expect(
        repositories.productionSchedules.createRun({ ...run, id: "schedule-run-replay" })
      ).resolves.toMatchObject({ inserted: false, record: { id: run.id } });
      await expect(provider.forUser(bobId).productionSchedules.list()).resolves.toEqual([]);
    });
  });
});
