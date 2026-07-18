import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RepositoryJobLeaseError,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type EnqueueNormalizationJob,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./index.ts";

const queuedAt = "2026-07-17T12:00:00.000Z";
const firstFailureAt = "2026-07-17T12:00:30.000Z";
const firstLeaseExpiry = "2026-07-17T12:01:00.000Z";
const retryAt = "2026-07-17T12:02:00.000Z";
const secondLeaseExpiry = "2026-07-17T12:03:00.000Z";
const completedAt = "2026-07-17T12:02:30.000Z";

let temporaryDirectory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

function importRaw(id = "raw-job-test"): void {
  repositories.rawListings.import({
    id,
    source: "other",
    acquisitionMode: "user_capture",
    sourceListingId: null,
    sourceUrl: "https://housing.example/listing/job-test",
    captureMethod: "manual_text",
    observedAt: queuedAt,
    sourcePostedAt: null,
    rawText: "Synthetic user-supplied listing text for a normalization job.",
    rawJson: null,
    captureMetadata: {
      networkAccess: false,
      untrustedContent: true
    }
  });
}

function enqueueInput(overrides: Partial<EnqueueNormalizationJob> = {}): EnqueueNormalizationJob {
  return {
    id: "job-normalize-raw-job-test",
    rawListingId: "raw-job-test",
    idempotencyKey: "c".repeat(64),
    availableAt: queuedAt,
    maxAttempts: 2,
    correlationId: "correlation-job-test",
    causationId: "event-capture-completed",
    createdAt: queuedAt,
    ...overrides
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-jobs-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  importRaw();
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("SQLite normalization jobs", () => {
  it("enqueues one job per raw listing and resolves repeat enqueue idempotently", () => {
    const first = repositories.normalizationJobs.enqueue(enqueueInput());
    const second = repositories.normalizationJobs.enqueue({
      ...enqueueInput(),
      id: "job-normalize-repeated-request"
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record).toEqual(first.record);
    expect(second.record).toMatchObject({
      jobType: "normalize_listing",
      state: "queued",
      attempts: 0,
      leaseOwner: null,
      completedAt: null
    });
    expect(repositories.normalizationJobs.count()).toBe(1);
  });

  it("claims an available job immediately and excludes its active lease", () => {
    repositories.normalizationJobs.enqueue(enqueueInput());

    const claimed = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-a",
      now: queuedAt,
      leaseExpiresAt: firstLeaseExpiry
    });

    expect(claimed).toMatchObject({
      id: "job-normalize-raw-job-test",
      state: "leased",
      attempts: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: firstLeaseExpiry
    });
    expect(
      repositories.normalizationJobs.claimNext({
        leaseOwner: "worker-b",
        now: firstFailureAt,
        leaseExpiresAt: retryAt
      })
    ).toBeNull();
  });

  it("recovers an expired lease and binds completion to the new owner", () => {
    repositories.normalizationJobs.enqueue(enqueueInput());
    repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-a",
      now: queuedAt,
      leaseExpiresAt: firstLeaseExpiry
    });

    const recovered = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-b",
      now: retryAt,
      leaseExpiresAt: secondLeaseExpiry
    });

    expect(recovered).toMatchObject({ state: "leased", attempts: 2, leaseOwner: "worker-b" });
    expect(() =>
      repositories.normalizationJobs.complete({
        id: recovered?.id ?? "missing",
        leaseOwner: "worker-a",
        completedAt
      })
    ).toThrow(RepositoryJobLeaseError);

    const completed = repositories.normalizationJobs.complete({
      id: recovered?.id ?? "missing",
      leaseOwner: "worker-b",
      completedAt
    });

    expect(completed).toMatchObject({
      state: "completed",
      attempts: 2,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt
    });
    expect(
      repositories.normalizationJobs.claimNext({
        leaseOwner: "worker-c",
        now: secondLeaseExpiry,
        leaseExpiresAt: "2026-07-17T12:04:00.000Z"
      })
    ).toBeNull();
  });

  it("schedules one bounded retry and then moves an exhausted job to dead letter", () => {
    repositories.normalizationJobs.enqueue(enqueueInput());
    const firstClaim = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-a",
      now: queuedAt,
      leaseExpiresAt: firstLeaseExpiry
    });

    const retryable = repositories.normalizationJobs.fail({
      id: firstClaim?.id ?? "missing",
      leaseOwner: "worker-a",
      retryable: true,
      failedAt: firstFailureAt,
      retryAt,
      errorCode: "normalization.invalid_payload",
      errorCategory: "validation"
    });

    expect(retryable).toMatchObject({
      state: "retryable",
      attempts: 1,
      availableAt: retryAt,
      lastErrorCode: "normalization.invalid_payload",
      lastErrorCategory: "validation",
      completedAt: null
    });
    expect(
      repositories.normalizationJobs.claimNext({
        leaseOwner: "worker-b",
        now: firstLeaseExpiry,
        leaseExpiresAt: retryAt
      })
    ).toBeNull();

    const secondClaim = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-b",
      now: retryAt,
      leaseExpiresAt: secondLeaseExpiry
    });
    const deadLetter = repositories.normalizationJobs.fail({
      id: secondClaim?.id ?? "missing",
      leaseOwner: "worker-b",
      retryable: true,
      failedAt: completedAt,
      retryAt: secondLeaseExpiry,
      errorCode: "normalization.internal",
      errorCategory: "internal"
    });

    expect(deadLetter).toMatchObject({
      state: "dead_letter",
      attempts: 2,
      leaseOwner: null,
      lastErrorCode: "normalization.internal",
      lastErrorCategory: "internal",
      completedAt: null
    });
    expect(
      repositories.normalizationJobs.claimNext({
        leaseOwner: "worker-c",
        now: secondLeaseExpiry,
        leaseExpiresAt: "2026-07-17T12:04:00.000Z"
      })
    ).toBeNull();
  });

  it("requires the matching lease owner for failure", () => {
    repositories.normalizationJobs.enqueue(enqueueInput());
    const claimed = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-a",
      now: queuedAt,
      leaseExpiresAt: firstLeaseExpiry
    });

    expect(() =>
      repositories.normalizationJobs.fail({
        id: claimed?.id ?? "missing",
        leaseOwner: "worker-b",
        retryable: true,
        failedAt: firstFailureAt,
        retryAt,
        errorCode: "normalization.internal",
        errorCategory: "internal"
      })
    ).toThrow(RepositoryJobLeaseError);
    expect(repositories.normalizationJobs.getById(claimed?.id ?? "missing")?.state).toBe("leased");
  });

  it("dead-letters a permanent failure after its real first attempt", () => {
    repositories.normalizationJobs.enqueue(
      enqueueInput({ maxAttempts: 5, idempotencyKey: "d".repeat(64) })
    );
    const claimed = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-a",
      now: queuedAt,
      leaseExpiresAt: firstLeaseExpiry
    });

    const deadLetter = repositories.normalizationJobs.fail({
      id: claimed?.id ?? "missing",
      leaseOwner: "worker-a",
      retryable: false,
      failedAt: firstFailureAt,
      retryAt,
      errorCode: "normalization.provider_refused",
      errorCategory: "permanent_provider"
    });

    expect(deadLetter).toMatchObject({
      state: "dead_letter",
      attempts: 1,
      maxAttempts: 5,
      lastErrorCode: "normalization.provider_refused",
      lastErrorCategory: "permanent_provider",
      completedAt: null
    });
    expect(
      repositories.normalizationJobs.claimNext({
        leaseOwner: "worker-b",
        now: retryAt,
        leaseExpiresAt: secondLeaseExpiry
      })
    ).toBeNull();
  });

  it("rolls back an enqueue when its surrounding transaction fails", () => {
    expect(() =>
      repositories.transaction((transactionRepositories) => {
        transactionRepositories.normalizationJobs.enqueue(enqueueInput());
        throw new Error("job rollback probe");
      })
    ).toThrow("job rollback probe");

    expect(repositories.normalizationJobs.count()).toBe(0);
  });
});
