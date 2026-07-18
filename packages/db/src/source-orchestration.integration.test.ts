import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InvalidSourceJobTransitionError,
  type BrowserNodeStatus,
  type JobAttempt,
  type SourceJob
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./index.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const LATER = "2026-07-18T12:01:00.000Z";
const LATEST = "2026-07-18T12:02:00.000Z";

function sourceJob(overrides: Partial<SourceJob> = {}): SourceJob {
  return {
    id: "source-job-fixture-1",
    correlationId: "correlation-source-job-1",
    connectorId: "fixture.feed.v1",
    source: "other",
    acquisitionMode: "fixture",
    manifestVersion: 1,
    trigger: "manual",
    operation: "capture",
    payload: { acquisitionMode: "fixture", fixtureSetId: "fixture-set-demo" },
    payloadHash: "1".repeat(64),
    idempotencyKey: "2".repeat(64),
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides
  };
}

function completedAttempt(jobId: string): JobAttempt {
  return {
    id: "source-job-attempt-1",
    sourceJobId: jobId,
    attemptNumber: 1,
    startedAt: NOW,
    completedAt: LATER,
    outcomeStatus: "completed",
    error: null,
    deferredReason: null,
    correlationId: "correlation-source-job-1",
    payloadHash: "1".repeat(64)
  };
}

function browserNode(overrides: Partial<BrowserNodeStatus> = {}): BrowserNodeStatus {
  return {
    nodeId: "browser-node-local-1",
    providerId: "mock-openclaw",
    status: "online",
    lastHeartbeatAt: NOW,
    heartbeatExpiresAt: "2026-07-18T12:02:00.000Z",
    contractVersion: 1,
    capabilities: { navigation: true, capture: true, cancellation: true },
    updatedAt: NOW,
    ...overrides
  };
}

let temporaryDirectory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-source-jobs-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("source orchestration repositories", () => {
  it("enqueues idempotently and transitions only through the domain lifecycle", () => {
    const first = repositories.sourceJobs.enqueue(sourceJob());
    const replay = repositories.sourceJobs.enqueue(sourceJob({ id: "source-job-replay-alias" }));

    expect(first.inserted).toBe(true);
    expect(replay).toEqual({ record: first.record, inserted: false });
    expect(repositories.sourceJobs.getByIdempotencyKey(first.record.idempotencyKey)).toEqual(
      first.record
    );

    const dispatched = repositories.sourceJobs.transition(first.record.id, "dispatched", LATER);
    expect(dispatched.status).toBe("dispatched");
    expect(repositories.sourceJobs.getById(first.record.id)?.status).toBe("dispatched");

    expect(() => repositories.sourceJobs.transition(first.record.id, "completed", LATER)).toThrow(
      InvalidSourceJobTransitionError
    );
    expect(repositories.sourceJobs.getById(first.record.id)?.status).toBe("dispatched");
  });

  it("persists attempts transactionally and enforces append-only history in SQLite", () => {
    const job = repositories.sourceJobs.enqueue(sourceJob()).record;
    const attempt = completedAttempt(job.id);

    repositories.transaction((transactionRepositories) => {
      transactionRepositories.sourceJobs.transition(job.id, "dispatched", LATER);
      transactionRepositories.sourceJobAttempts.append(attempt);
    });

    expect(repositories.sourceJobAttempts.listByJobId(job.id)).toEqual([attempt]);
    expect(() =>
      connection.sqlite
        .prepare("UPDATE source_job_attempts SET attempt_number = 2 WHERE id = ?")
        .run(attempt.id)
    ).toThrow(/append-only/u);
    expect(() =>
      connection.sqlite.prepare("DELETE FROM source_job_attempts WHERE id = ?").run(attempt.id)
    ).toThrow(/append-only/u);
  });

  it("persists one completed result and resolves its repeated idempotent replay", () => {
    const job = repositories.sourceJobs.enqueue(sourceJob()).record;
    repositories.sourceJobs.transition(job.id, "dispatched", NOW);
    repositories.sourceJobs.transition(job.id, "running", LATER, { attempts: 1 });
    const result = {
      jobId: job.id,
      connectorId: job.connectorId,
      source: job.source,
      acquisitionMode: job.acquisitionMode,
      operation: job.operation,
      status: "completed" as const,
      correlationId: job.correlationId,
      payloadHash: job.payloadHash,
      idempotencyKey: job.idempotencyKey,
      resultHash: "3".repeat(64),
      recordCount: 12,
      previousCursor: null,
      cursorCandidate: null,
      error: null,
      completedAt: LATEST,
      idempotentReplay: false,
      untrustedInput: true as const
    };

    const completed = repositories.sourceJobs.transition(job.id, "completed", LATEST, {
      result
    });
    const replay = repositories.sourceJobs.transition(job.id, "completed", LATEST, {
      result: { ...result, idempotentReplay: true }
    });

    expect(completed.result).toEqual(result);
    expect(replay).toEqual(completed);
    expect(repositories.sourceJobs.list()).toEqual([completed]);
  });

  it("rolls back a source transition when an attempt append fails", () => {
    const job = repositories.sourceJobs.enqueue(sourceJob()).record;
    const attempt = completedAttempt(job.id);
    repositories.sourceJobAttempts.append(attempt);

    expect(() =>
      repositories.transaction((transactionRepositories) => {
        transactionRepositories.sourceJobs.transition(job.id, "dispatched", LATER);
        transactionRepositories.sourceJobAttempts.append(attempt);
      })
    ).toThrow();
    expect(repositories.sourceJobs.getById(job.id)?.status).toBe("queued");
  });

  it("upserts safe node health without allowing an older heartbeat to overwrite newer state", () => {
    const current = repositories.browserNodes.upsert(browserNode());
    const newer = repositories.browserNodes.upsert(
      browserNode({
        status: "offline",
        lastHeartbeatAt: LATER,
        heartbeatExpiresAt: "2026-07-18T12:03:00.000Z",
        updatedAt: LATER
      })
    );
    const older = repositories.browserNodes.upsert(current);

    expect(newer.status).toBe("offline");
    expect(older).toEqual(newer);
    expect(repositories.browserNodes.getById(current.nodeId)).toEqual(newer);
    expect(repositories.browserNodes.list()).toEqual([newer]);
  });

  it("does not accept an older heartbeat even when it has a later processing timestamp", () => {
    const current = repositories.browserNodes.upsert(
      browserNode({
        lastHeartbeatAt: LATER,
        heartbeatExpiresAt: "2026-07-18T12:03:00.000Z",
        updatedAt: LATER
      })
    );
    const ignored = repositories.browserNodes.upsert(
      browserNode({
        status: "offline",
        lastHeartbeatAt: NOW,
        heartbeatExpiresAt: "2026-07-18T12:02:00.000Z",
        updatedAt: LATEST
      })
    );

    expect(ignored).toEqual(current);
    expect(repositories.browserNodes.getById(current.nodeId)).toEqual(current);
  });

  it("allows a later derived status for the same heartbeat", () => {
    const current = repositories.browserNodes.upsert(browserNode());
    const stale = repositories.browserNodes.upsert(
      browserNode({ status: "stale", updatedAt: LATEST })
    );

    expect(stale).toEqual({ ...current, status: "stale", updatedAt: LATEST });
  });

  it("keeps node revocation sticky", () => {
    const revoked = repositories.browserNodes.upsert(browserNode({ status: "revoked" }));

    expect(() =>
      repositories.browserNodes.upsert(
        browserNode({
          status: "online",
          lastHeartbeatAt: LATER,
          heartbeatExpiresAt: "2026-07-18T12:03:00.000Z",
          updatedAt: LATER
        })
      )
    ).toThrow(/revoked/u);
    expect(repositories.browserNodes.getById(revoked.nodeId)).toEqual(revoked);
  });

  it("rejects a provider identity change for a registered node", () => {
    const current = repositories.browserNodes.upsert(browserNode());

    expect(() =>
      repositories.browserNodes.upsert(
        browserNode({ providerId: "different-provider", updatedAt: LATER })
      )
    ).toThrow(/provider identity/u);
    expect(repositories.browserNodes.getById(current.nodeId)).toEqual(current);
  });
});
