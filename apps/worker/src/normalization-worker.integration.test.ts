import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LLMAuthenticationError,
  LLMConfigurationError,
  LLMInvalidOutputError,
  LLMPermanentProviderError,
  LLMRateLimitError,
  LLMRefusalError,
  LLMTimeoutError,
  LLMTransientProviderError,
  MockLLMProvider,
  type LLMError
} from "@vera/ai";
import { projectListingExtraction } from "@vera/connectors";
import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  sha256Text,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "@vera/db";
import { DEMO_SEARCH_PROFILE } from "@vera/db/fixtures";
import {
  ListingExtractionFieldNameSchema,
  ListingExtractionProviderResultSchema,
  ListingExtractionSchema,
  type ExtractionUnknownReason,
  type ListingExtraction,
  type ListingExtractionRequest
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NORMALIZATION_LEASE_DURATION_MILLISECONDS,
  processNextNormalizationJob
} from "./normalization-worker.ts";

let directory = "";
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;
const capturedAt = "2026-07-17T21:00:00.000Z";
const processingAt = "2026-07-17T21:00:05.000Z";

const sparseText = [
  "Welcome to Sunny Haven, a synthetic listing.",
  "Base rent: USD 2375 per month",
  "2 beds and 1.5 baths",
  "Address: 55 Example Avenue",
  "Email example@example.invalid"
].join("\n");

const completeText = [
  "Title: Bright synthetic apartment",
  "2 beds and 1.5 baths",
  "Address: 100 Example Way, Demo City, NY 10001",
  "950 sq ft",
  "Property type: apartment",
  "Base rent: USD 2450 per month",
  "Required parking fee: USD 100 per month",
  "Availability: 2026-08-15",
  "Lease term: 12 months",
  "Cats allowed",
  "Dogs not allowed",
  "Amenities: Laundry, Dishwasher",
  "Posted: 2026-07-16T12:00:00Z",
  "Contact channel: email",
  "Contact name: Avery Example",
  "Email avery@example.invalid",
  "Phone 212-555-0100",
  "Contact URL: https://contact.example/listing/synthetic"
].join("\n");

function queueCapture(options: { maxAttempts?: number; text?: string } = {}): {
  rawListingId: string;
  jobId: string;
} {
  const imported = repositories.rawListings.import({
    id: randomUUID(),
    source: "other",
    acquisitionMode: "user_capture",
    sourceListingId: null,
    sourceUrl: "https://housing.example/listings/worker-fixture",
    captureMethod: "manual_text",
    observedAt: capturedAt,
    sourcePostedAt: null,
    rawText: options.text ?? sparseText,
    rawJson: null,
    captureMetadata: {
      connectorId: "manual.capture.v1",
      capability: "manual.capture",
      networkAccess: false,
      untrustedContent: true,
      browserAccess: "manual_policy_required"
    }
  });
  const jobId = randomUUID();
  repositories.normalizationJobs.enqueue({
    id: jobId,
    rawListingId: imported.record.id,
    idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
    availableAt: capturedAt,
    maxAttempts: options.maxAttempts ?? 3,
    correlationId: randomUUID(),
    causationId: randomUUID(),
    createdAt: capturedAt
  });
  return { rawListingId: imported.record.id, jobId };
}

function unknownExtraction(request: ListingExtractionRequest): ListingExtraction {
  const reasons = new Map(request.fieldRequests.map(({ field, reason }) => [field, reason]));
  return ListingExtractionSchema.parse(
    Object.fromEntries(
      ListingExtractionFieldNameSchema.options.map((field) => [
        field,
        {
          status: "unknown",
          value: null,
          confidenceBasisPoints: 0,
          evidenceSnippet: null,
          reason: reasons.get(field) ?? ("not_present" satisfies ExtractionUnknownReason)
        }
      ])
    )
  );
}

function titleProvider(): MockLLMProvider {
  return new MockLLMProvider({
    resolver(request) {
      const extraction = unknownExtraction(request);
      return ListingExtractionProviderResultSchema.parse({
        providerId: "mock",
        model: "mock-v1",
        responseId: "synthetic-response",
        extraction: {
          ...extraction,
          title: {
            status: "known",
            value: "Sunny Haven",
            confidenceBasisPoints: 9_000,
            evidenceSnippet: "Sunny Haven"
          }
        },
        usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        latencyMilliseconds: 25,
        repairCount: 0
      });
    }
  });
}

function throwingProvider(error: LLMError): MockLLMProvider {
  return new MockLLMProvider({
    resolver() {
      throw error;
    }
  });
}

function dependencies(overrides: Partial<Parameters<typeof processNextNormalizationJob>[0]> = {}) {
  return {
    repositories,
    leaseOwner: "worker-test-1",
    provider: null,
    providerTimeoutMilliseconds: 20_000,
    now: () => new Date(processingAt),
    createId: randomUUID,
    ...overrides
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-normalization-worker-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  repositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("normalization worker extraction orchestration", () => {
  it("atomically completes deterministic extraction with 20 fields and 22 provenance rows", async () => {
    const { rawListingId } = queueCapture();
    const result = await processNextNormalizationJob(dependencies(), new AbortController().signal);

    expect(result).toMatchObject({
      status: "completed",
      mode: "deterministic_only",
      providerId: null,
      totalTokens: 0
    });
    const sourceRecord = repositories.sourceRecords.getByRawListingId(rawListingId);
    expect(sourceRecord).toMatchObject({
      monthlyRentCents: 237_500,
      bedrooms: 2,
      bathrooms: 1.5,
      contactChannel: "email"
    });
    const provenance = repositories.fieldProvenance.listBySourceRecordId(sourceRecord?.id ?? "");
    expect(provenance).toHaveLength(22);
    expect(provenance.some((item) => item.valueStatus === "known")).toBe(true);
    expect(provenance.some((item) => item.valueStatus === "unknown")).toBe(true);
    expect(repositories.listingExtractions.getByRawListingId(rawListingId)).toMatchObject({
      mode: "deterministic_only",
      providerId: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    });
    expect(repositories.normalizationJobs.getByRawListingId(rawListingId)?.state).toBe("completed");
    expect(repositories.decisionJobs.list()).toHaveLength(1);
    const completed = repositories.activityEvents
      .list()
      .find((event) => event.action === "normalization.completed");
    expect(completed?.metadata).toMatchObject({
      mode: "deterministic_only",
      knownFieldCount: expect.any(Number),
      unknownFieldCount: expect.any(Number),
      requestedFieldCount: expect.any(Number),
      totalTokens: 0
    });
    expect(JSON.stringify(completed)).not.toContain("example@example.invalid");
    expect(JSON.stringify(completed)).not.toContain("Sunny Haven");

    await expect(
      processNextNormalizationJob(dependencies(), new AbortController().signal)
    ).resolves.toEqual({ status: "idle" });
    expect(repositories.sourceRecords.count()).toBe(1);
  });

  it("does not call a configured provider when deterministic extraction has no missing field", async () => {
    const provider = new MockLLMProvider({
      resolver() {
        throw new Error("Provider must not be called for a complete deterministic record.");
      }
    });
    queueCapture({ text: completeText });

    const result = await processNextNormalizationJob(
      dependencies({ provider }),
      new AbortController().signal
    );
    expect(result).toMatchObject({ status: "completed", mode: "deterministic_only" });
    expect(provider.requests).toHaveLength(0);
  });

  it("uses a configured provider only for requested unknown fields", async () => {
    const provider = titleProvider();
    const { rawListingId } = queueCapture();
    const result = await processNextNormalizationJob(
      dependencies({ provider }),
      new AbortController().signal
    );

    expect(result).toMatchObject({
      status: "completed",
      mode: "llm_augmented",
      providerId: "mock",
      model: "mock-v1",
      totalTokens: 100
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.fieldRequests.some(({ field }) => field === "title")).toBe(true);
    expect(repositories.sourceRecords.getByRawListingId(rawListingId)?.title).toBe("Sunny Haven");
    expect(repositories.listingExtractions.getByRawListingId(rawListingId)).toMatchObject({
      mode: "llm_augmented",
      providerId: "mock",
      model: "mock-v1",
      usage: { totalTokens: 100 }
    });
  });

  it("finishes provider work before opening the success persistence transaction", async () => {
    let providerSettled = false;
    const provider = new MockLLMProvider({
      resolver(request) {
        providerSettled = true;
        return ListingExtractionProviderResultSchema.parse({
          providerId: "mock",
          model: "mock-v1",
          responseId: null,
          extraction: unknownExtraction(request),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          latencyMilliseconds: 1,
          repairCount: 0
        });
      }
    });
    queueCapture();
    const wrappedRepositories: VeraRepositories = {
      ...repositories,
      transaction(callback) {
        expect(providerSettled).toBe(true);
        return repositories.transaction(callback);
      }
    };

    await expect(
      processNextNormalizationJob(
        dependencies({ provider, repositories: wrappedRepositories }),
        new AbortController().signal
      )
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("rolls back every result row when atomic success persistence fails", async () => {
    const { rawListingId } = queueCapture();
    let transactionCall = 0;
    const wrappedRepositories: VeraRepositories = {
      ...repositories,
      transaction(callback) {
        transactionCall += 1;
        if (transactionCall !== 1) return repositories.transaction(callback);
        return repositories.transaction((transactionRepositories) =>
          callback({
            ...transactionRepositories,
            listingExtractions: {
              ...transactionRepositories.listingExtractions,
              insert() {
                throw new Error("Synthetic insertion failure with raw content.");
              }
            }
          })
        );
      }
    };

    const result = await processNextNormalizationJob(
      dependencies({ repositories: wrappedRepositories }),
      new AbortController().signal
    );
    expect(result).toMatchObject({
      status: "retryable",
      errorCode: "normalization_internal_error"
    });
    expect(repositories.sourceRecords.getByRawListingId(rawListingId)).toBeNull();
    expect(repositories.listingExtractions.getByRawListingId(rawListingId)).toBeNull();
    expect(repositories.fieldProvenance.count()).toBe(0);
  });
});

describe("normalization worker failure classification", () => {
  it("dead-letters with the claim time when the clock becomes invalid after extraction", async () => {
    const { rawListingId } = queueCapture();
    let clockIsInvalid = false;
    const result = await processNextNormalizationJob(
      dependencies({
        now: () => (clockIsInvalid ? new Date(Number.NaN) : new Date(processingAt)),
        projectExtraction(...arguments_) {
          const normalized = projectListingExtraction(...arguments_);
          clockIsInvalid = true;
          return normalized;
        }
      }),
      new AbortController().signal
    );

    expect(result).toMatchObject({
      status: "dead_letter",
      errorCode: "normalization_invalid_clock",
      errorCategory: "internal",
      retryable: false
    });
    expect(repositories.normalizationJobs.getByRawListingId(rawListingId)).toMatchObject({
      state: "dead_letter",
      lastErrorCode: "normalization_invalid_clock"
    });
    expect(
      repositories.activityEvents.list().find(({ action }) => action === "normalization.failed")
        ?.occurredAt
    ).toBe(processingAt);
  });

  it.each([
    new LLMInvalidOutputError({ providerId: "mock", model: "mock-v1" }),
    new LLMRefusalError({ providerId: "mock", model: "mock-v1" }),
    new LLMAuthenticationError({ providerId: "mock", model: "mock-v1" }),
    new LLMConfigurationError({ providerId: "mock", model: "mock-v1" }),
    new LLMPermanentProviderError({ providerId: "mock", model: "mock-v1" })
  ])("dead-letters permanent provider failure $code after one attempt", async (error) => {
    const { rawListingId } = queueCapture({ maxAttempts: 3 });
    const result = await processNextNormalizationJob(
      dependencies({ provider: throwingProvider(error) }),
      new AbortController().signal
    );

    expect(result).toMatchObject({
      status: "dead_letter",
      errorCode: error.code,
      retryable: false
    });
    expect(repositories.normalizationJobs.getByRawListingId(rawListingId)).toMatchObject({
      state: "dead_letter",
      attempts: 1,
      lastErrorCode: error.code
    });
    expect(repositories.sourceRecords.getByRawListingId(rawListingId)).toBeNull();
    expect(repositories.listingExtractions.getByRawListingId(rawListingId)).toBeNull();
  });

  it.each([
    new LLMTimeoutError({ providerId: "mock", model: "mock-v1" }),
    new LLMRateLimitError({ providerId: "mock", model: "mock-v1" }),
    new LLMTransientProviderError({ providerId: "mock", model: "mock-v1" })
  ])("schedules retryable provider failure $code with bounded retry", async (error) => {
    const { rawListingId } = queueCapture({ maxAttempts: 3 });
    const result = await processNextNormalizationJob(
      dependencies({ provider: throwingProvider(error) }),
      new AbortController().signal
    );

    expect(result).toMatchObject({ status: "retryable", errorCode: error.code, retryable: true });
    expect(repositories.normalizationJobs.getByRawListingId(rawListingId)).toMatchObject({
      state: "retryable",
      attempts: 1,
      lastErrorCode: error.code
    });
    const failedEvent = repositories.activityEvents
      .list()
      .find((event) => event.action === "normalization.failed");
    expect(failedEvent?.metadata).toEqual({
      jobId: expect.any(String),
      errorCode: error.code,
      errorCategory: expect.any(String),
      retryable: true,
      jobState: "retryable"
    });
    expect(JSON.stringify(failedEvent)).not.toContain(error.message);
    expect(JSON.stringify(failedEvent)).not.toContain(sparseText);
  });

  it("leaves an aborted in-flight provider job leased for expiry recovery", async () => {
    const { rawListingId } = queueCapture();
    const provider = new MockLLMProvider({
      resolver: () => new Promise(() => {})
    });
    const abortController = new AbortController();
    const processing = processNextNormalizationJob(
      dependencies({ provider }),
      abortController.signal
    );
    while (provider.requests.length === 0) await Promise.resolve();
    abortController.abort();

    await expect(processing).resolves.toMatchObject({ status: "cancelled" });
    expect(repositories.normalizationJobs.getByRawListingId(rawListingId)).toMatchObject({
      state: "leased",
      attempts: 1,
      leaseExpiresAt: new Date(
        new Date(processingAt).getTime() + NORMALIZATION_LEASE_DURATION_MILLISECONDS
      ).toISOString()
    });
    expect(repositories.sourceRecords.getByRawListingId(rawListingId)).toBeNull();
    expect(repositories.listingExtractions.getByRawListingId(rawListingId)).toBeNull();
    expect(
      repositories.activityEvents.list().some(({ action }) => action === "normalization.failed")
    ).toBe(false);
  });
});
