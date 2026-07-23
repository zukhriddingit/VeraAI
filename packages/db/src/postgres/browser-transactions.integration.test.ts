import { SourceJobSchema, type VeraUserId } from "@vera/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { sha256Text } from "../hashing.ts";
import { acceptBrowserCapture } from "./browser-transactions.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;
const NOW = "2026-07-21T15:00:00.000Z";
const LATER = "2026-07-21T15:00:01.000Z";
const URL = "https://www.zillow.com/homedetails/12-Main-St/123456_zpid/";

async function seedUsers(db: Parameters<typeof createPostgresRepositoryProvider>[0]["db"]) {
  await db.insert(users).values([
    { id: aliceId, name: "Alice", email: "alice-browser@example.test", emailVerified: true },
    { id: bobId, name: "Bob", email: "bob-browser@example.test", emailVerified: true }
  ]);
}

async function readyJob(provider: ReturnType<typeof createPostgresRepositoryProvider>) {
  const repositories = provider.forUser(aliceId);
  await repositories.browserIntegrationControls.upsert({
    userBrowserEnabled: true,
    zillowSourceEnabled: true,
    updatedAt: NOW
  });
  await repositories.browserNodes.upsert({
    nodeId: "node-founder",
    providerId: "openclaw-2026.6.33",
    nodeName: "Founder Mac",
    status: "online",
    pairingState: "paired",
    capabilityApprovalState: "approved",
    selectedProfileId: "vera-zillow",
    allowedProfileIds: ["vera-zillow"],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: NOW,
    heartbeatExpiresAt: "2026-07-21T15:05:00.000Z",
    lastSuccessfulCaptureAt: null,
    disabledAt: null,
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt: NOW,
    updatedAt: NOW
  });
  await repositories.browserProfileControls.upsert({
    nodeId: "node-founder",
    profileId: "vera-zillow",
    disabledAt: null,
    updatedAt: NOW
  });
  const payload = {
    acquisitionMode: "local_browser" as const,
    captureKind: "current_tab" as const,
    nodeId: "node-founder",
    profileId: "vera-zillow",
    expectedUrl: URL,
    canonicalUrl: URL,
    limits: {
      maxPages: 1 as const,
      maxRecords: 1 as const,
      maxBytes: 250_000,
      maxDurationMilliseconds: 30_000,
      maxConcurrency: 1 as const
    }
  };
  const payloadHash = sha256Text(JSON.stringify(payload));
  await repositories.approvals.insert({
    id: "approval-browser",
    actor: "user",
    connectorId: "zillow.current-tab.v1",
    operation: "capture.current_tab",
    targetType: "source_job",
    targetId: "job-browser",
    payloadHash,
    state: "used",
    createdAt: NOW,
    expiresAt: "2026-07-21T15:10:00.000Z",
    usedAt: NOW
  });
  const job = SourceJobSchema.parse({
    id: "job-browser",
    correlationId: "correlation-browser",
    connectorId: "zillow.current-tab.v1",
    source: "zillow",
    acquisitionMode: "local_browser",
    manifestVersion: 1,
    trigger: "manual",
    capability: "browser.capture",
    approvalId: "approval-browser",
    operation: "capture.current_tab",
    payload,
    payloadHash,
    idempotencyKey: sha256Text("job-browser"),
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
  await repositories.sourceJobs.enqueue(job);
  await repositories.sourceJobs.transition(job.id, "dispatched", NOW);
  await repositories.sourceJobs.transition(job.id, "running", NOW, { attempts: 1 });
  await repositories.sourceJobAttempts.append({
    id: "attempt-browser",
    sourceJobId: job.id,
    attemptNumber: 1,
    startedAt: NOW,
    completedAt: LATER,
    outcomeStatus: "completed",
    error: null,
    deferredReason: null,
    correlationId: job.correlationId,
    payloadHash
  });
  return { repositories, job, payloadHash };
}

describe("PostgreSQL browser capture persistence", () => {
  it("keeps controls and nodes fail-closed and tenant-scoped", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedUsers(db);
      const provider = createPostgresRepositoryProvider(connection);
      await expect(
        provider.forUser(aliceId).browserIntegrationControls.get()
      ).resolves.toMatchObject({
        userBrowserEnabled: false,
        zillowSourceEnabled: false
      });
      await readyJob(provider);
      await expect(
        provider.forUser(bobId).browserNodes.getById("node-founder")
      ).resolves.toBeNull();
      await expect(provider.forUser(bobId).sourceJobs.getById("job-browser")).resolves.toBeNull();
      await expect(
        provider.forUser(bobId).browserProfileControls.upsert({
          nodeId: "node-founder",
          profileId: "vera-zillow",
          disabledAt: null,
          updatedAt: NOW
        })
      ).rejects.toMatchObject({ category: "ownership_violation" });
    });
  });

  it("accepts once atomically, enqueues normalization, audits in order, and replays", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedUsers(db);
      const provider = createPostgresRepositoryProvider(connection);
      const { repositories, job, payloadHash } = await readyJob(provider);
      const renderedText = "Zillow listing at 12 Main St. Rent is $2,400 per month.";
      const pageTitle = "12 Main St rental";
      const contentHash = sha256Text(
        JSON.stringify({ canonicalUrl: URL, pageTitle, renderedText })
      );
      const input = {
        sourceJobId: job.id,
        attemptId: "attempt-browser",
        nodeId: "node-founder",
        profileId: "vera-zillow",
        payloadHash,
        invocationIdempotencyKey: sha256Text("invocation-browser"),
        resultHash: sha256Text("result-browser"),
        contentHash,
        canonicalUrl: URL,
        pageTitle,
        renderedText,
        structuredMetadata: {},
        observedAt: LATER,
        acceptedAt: LATER
      };

      const first = await acceptBrowserCapture(provider, aliceId, input);
      const replay = await acceptBrowserCapture(provider, aliceId, input);
      expect(first.replayed).toBe(false);
      expect(replay).toMatchObject({ replayed: true, acceptance: first.acceptance });
      await expect(repositories.rawListings.count()).resolves.toBe(1);
      await expect(repositories.normalizationJobs.count()).resolves.toBe(1);
      await expect(repositories.sourceJobs.getById(job.id)).resolves.toMatchObject({
        status: "completed"
      });
      const events = await repositories.activityEvents.list();
      expect(events.map((event) => event.action)).toEqual([
        "browser.result_accepted",
        "browser.ingestion_completed"
      ]);
      await expect(
        db.execute(sql`
          update browser_capture_acceptances
          set canonical_url = ${"https://www.zillow.com/homedetails/Tampered/999999_zpid/"}
          where user_id = ${aliceId} and source_job_id = ${job.id}
        `)
      ).rejects.toThrow(/Failed query/u);
    });
  });

  it("rolls back raw evidence when result identity is invalid", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedUsers(db);
      const provider = createPostgresRepositoryProvider(connection);
      const { repositories, job, payloadHash } = await readyJob(provider);
      await expect(
        acceptBrowserCapture(provider, aliceId, {
          sourceJobId: job.id,
          attemptId: "attempt-browser",
          nodeId: "node-founder",
          profileId: "vera-zillow",
          payloadHash: "f".repeat(64),
          invocationIdempotencyKey: sha256Text("bad-payload-invocation"),
          resultHash: sha256Text("bad-payload-result"),
          contentHash: sha256Text(
            JSON.stringify({ canonicalUrl: URL, pageTitle: "Title", renderedText: "Content" })
          ),
          canonicalUrl: URL,
          pageTitle: "Title",
          renderedText: "Content",
          structuredMetadata: {},
          observedAt: LATER,
          acceptedAt: LATER
        })
      ).rejects.toThrow(/identity/u);
      await expect(
        acceptBrowserCapture(provider, aliceId, {
          sourceJobId: job.id,
          attemptId: "attempt-browser",
          nodeId: "node-founder",
          profileId: "vera-zillow",
          payloadHash,
          invocationIdempotencyKey: sha256Text("bad-invocation"),
          resultHash: sha256Text("bad-result"),
          contentHash: sha256Text("wrong-content"),
          canonicalUrl: URL,
          pageTitle: "Title",
          renderedText: "Content",
          structuredMetadata: {},
          observedAt: LATER,
          acceptedAt: LATER
        })
      ).rejects.toThrow(/content hash/u);
      await expect(repositories.rawListings.count()).resolves.toBe(0);
      await expect(
        repositories.browserCaptureAcceptances.getBySourceJobId(job.id)
      ).resolves.toBeNull();
      await expect(repositories.sourceJobs.getById(job.id)).resolves.toMatchObject({
        status: "running"
      });
    });
  });
});
