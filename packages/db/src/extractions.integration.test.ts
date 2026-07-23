import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionRunSchema,
  type ActivityEvent,
  type ListingExtractionRun,
  type ListingSourceRecord,
  type RawListingCapture
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./demo/index.ts";

const now = "2026-07-17T13:00:00.000Z";
const completedAt = "2026-07-17T13:01:00.000Z";
const leaseExpiresAt = "2026-07-17T13:02:00.000Z";
const listingExtractionInsertSql = `INSERT INTO listing_extractions (
  id, raw_listing_id, listing_source_record_id, mode, input_hash,
  requested_fields, provider_id, model, response_id, prompt_version,
  extraction_version, provider_result, merged_extraction, input_tokens,
  output_tokens, total_tokens, latency_milliseconds, repair_count, completed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

let temporaryDirectory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

function capture(id = "raw-extraction-test"): RawListingCapture {
  return {
    id,
    source: "other",
    acquisitionMode: "user_capture",
    sourceListingId: null,
    sourceUrl: `https://example.invalid/manual/${id}`,
    captureMethod: "manual_text",
    observedAt: now,
    sourcePostedAt: null,
    rawText: `Synthetic user-supplied listing evidence for ${id}.`,
    rawJson: null,
    captureMetadata: { networkAccess: false, untrustedContent: true }
  };
}

function sourceRecord(
  rawListingId = "raw-extraction-test",
  id = "src-extraction-test"
): ListingSourceRecord {
  return {
    id,
    rawListingId,
    source: "other",
    sourceListingId: null,
    sourceUrl: `https://example.invalid/manual/${rawListingId}`,
    sourcePostedAt: null,
    contactChannel: "unknown",
    title: "Captured listing",
    address: {
      line1: null,
      unit: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null
    },
    monthlyRentCents: null,
    recurringFeesCents: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    latitude: null,
    longitude: null,
    propertyType: null,
    availableOn: null,
    leaseTermMonths: null,
    petPolicy: null,
    amenities: [],
    description: null,
    extractionConfidenceBasisPoints: 0,
    completenessBasisPoints: 0,
    observedAt: now,
    createdAt: completedAt
  };
}

const unknown = {
  status: "unknown",
  value: null,
  confidenceBasisPoints: 0,
  evidenceSnippet: null,
  reason: "not_present"
} as const;

function extractionRun(
  rawListingId = "raw-extraction-test",
  listingSourceRecordId = "src-extraction-test",
  id = "extraction-run-test"
): ListingExtractionRun {
  return ListingExtractionRunSchema.parse({
    id,
    rawListingId,
    listingSourceRecordId,
    mode: "deterministic_only",
    inputHash: "e".repeat(64),
    requestedFields: [],
    providerId: null,
    model: null,
    responseId: null,
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION,
    providerResult: null,
    mergedExtraction: {
      title: unknown,
      bedrooms: unknown,
      bathrooms: unknown,
      addressText: unknown,
      squareFeet: unknown,
      propertyType: unknown,
      baseRent: unknown,
      requiredRecurringFees: unknown,
      availabilityRaw: unknown,
      availableOn: unknown,
      leaseTermMonths: unknown,
      catsAllowed: unknown,
      dogsAllowed: unknown,
      amenities: unknown,
      sourcePostedAt: unknown,
      contactChannel: unknown,
      contactName: unknown,
      contactEmail: unknown,
      contactPhone: unknown,
      contactUrl: unknown
    },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMilliseconds: 0,
    repairCount: 0,
    completedAt
  });
}

function augmentedExtractionRun(
  rawListingId: string,
  listingSourceRecordId: string
): ListingExtractionRun {
  const deterministic = extractionRun(
    rawListingId,
    listingSourceRecordId,
    "extraction-run-augmented"
  );
  const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150 } as const;
  const providerResult = {
    providerId: "mock-llm",
    model: "synthetic-model",
    responseId: null,
    extraction: deterministic.mergedExtraction,
    usage,
    latencyMilliseconds: 25,
    repairCount: 1
  } as const;

  return ListingExtractionRunSchema.parse({
    ...deterministic,
    mode: "llm_augmented",
    requestedFields: ["title"],
    providerId: providerResult.providerId,
    model: providerResult.model,
    responseId: providerResult.responseId,
    providerResult,
    usage,
    latencyMilliseconds: providerResult.latencyMilliseconds,
    repairCount: providerResult.repairCount
  });
}

function activityEvent(): ActivityEvent {
  return {
    id: "event-extraction-rollback",
    correlationId: "correlation-extraction-test",
    causationId: "event-capture-completed",
    actor: "system",
    action: "normalization.completed",
    targetType: "raw_listing",
    targetId: "raw-extraction-test",
    policyDecision: "not_applicable",
    approvalId: null,
    payloadHash: "f".repeat(64),
    outcome: "succeeded",
    errorCategory: null,
    metadata: { mode: "deterministic_only" },
    occurredAt: completedAt
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-extractions-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  repositories.rawListings.import(capture());
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("SQLite listing extraction repository", () => {
  it("round-trips one immutable extraction by every supported identity", () => {
    const source = repositories.sourceRecords.insert(sourceRecord());
    const run = repositories.listingExtractions.insert(extractionRun());

    expect(repositories.listingExtractions.getById(run.id)).toEqual(run);
    expect(repositories.listingExtractions.getByRawListingId(source.rawListingId)).toEqual(run);
    expect(repositories.listingExtractions.getBySourceRecordId(source.id)).toEqual(run);
    expect("update" in repositories.listingExtractions).toBe(false);
    expect("delete" in repositories.listingExtractions).toBe(false);
    expect(() =>
      repositories.listingExtractions.insert(
        extractionRun(source.rawListingId, source.id, "extraction-run-duplicate")
      )
    ).toThrow(/UNIQUE/u);
  });

  it("rejects repository and SQL update/delete paths", () => {
    repositories.sourceRecords.insert(sourceRecord());
    const run = repositories.listingExtractions.insert(extractionRun());

    expect(() =>
      connection.sqlite
        .prepare("UPDATE listing_extractions SET mode = ? WHERE id = ?")
        .run("llm_augmented", run.id)
    ).toThrow(/append-only/u);
    expect(() =>
      connection.sqlite.prepare("DELETE FROM listing_extractions WHERE id = ?").run(run.id)
    ).toThrow(/append-only/u);
  });

  it("round-trips validated LLM-augmented JSON and scalar metrics", () => {
    repositories.rawListings.import(capture("raw-extraction-augmented"));
    const source = repositories.sourceRecords.insert(
      sourceRecord("raw-extraction-augmented", "src-extraction-augmented")
    );
    const run = augmentedExtractionRun(source.rawListingId, source.id);

    expect(repositories.listingExtractions.insert(run)).toEqual(run);
    expect(repositories.listingExtractions.getById(run.id)).toEqual(run);
  });

  it("strictly validates JSON on write and read", () => {
    const source = repositories.sourceRecords.insert(sourceRecord());
    const valid = extractionRun();

    expect(() =>
      repositories.listingExtractions.insert({
        ...valid,
        mergedExtraction: { unexpected: true }
      } as unknown as ListingExtractionRun)
    ).toThrow();

    connection.sqlite
      .prepare(listingExtractionInsertSql)
      .run(
        "extraction-invalid-json-shape",
        source.rawListingId,
        source.id,
        "deterministic_only",
        "a".repeat(64),
        "[]",
        null,
        null,
        null,
        LISTING_EXTRACTION_PROMPT_VERSION,
        LISTING_EXTRACTION_VERSION,
        null,
        JSON.stringify({ unexpected: true }),
        0,
        0,
        0,
        0,
        0,
        completedAt
      );

    expect(() =>
      repositories.listingExtractions.getById("extraction-invalid-json-shape")
    ).toThrow();
  });

  it("rejects missing foreign keys and mismatched raw/source pairs", () => {
    expect(() =>
      repositories.listingExtractions.insert(
        extractionRun("raw-extraction-test", "src-missing", "extraction-missing-source")
      )
    ).toThrow(/not found/u);

    expect(() =>
      connection.sqlite
        .prepare(listingExtractionInsertSql)
        .run(
          "extraction-missing-foreign-keys",
          "raw-missing",
          "src-missing",
          "deterministic_only",
          "a".repeat(64),
          "[]",
          null,
          null,
          null,
          LISTING_EXTRACTION_PROMPT_VERSION,
          LISTING_EXTRACTION_VERSION,
          null,
          JSON.stringify({ unexpected: true }),
          0,
          0,
          0,
          0,
          0,
          completedAt
        )
    ).toThrow(/FOREIGN KEY/u);

    repositories.rawListings.import(capture("raw-extraction-other"));
    repositories.sourceRecords.insert(sourceRecord("raw-extraction-other", "src-extraction-other"));
    expect(() =>
      repositories.listingExtractions.insert(
        extractionRun("raw-extraction-test", "src-extraction-other", "extraction-mismatched-source")
      )
    ).toThrow(/does not match/u);
  });

  it("rolls back normalized evidence, audit, extraction, and completion atomically", () => {
    const enqueued = repositories.normalizationJobs.enqueue({
      id: "job-extraction-rollback",
      rawListingId: "raw-extraction-test",
      idempotencyKey: "9".repeat(64),
      availableAt: now,
      maxAttempts: 3,
      correlationId: "correlation-extraction-test",
      causationId: "event-capture-completed",
      createdAt: now
    }).record;
    const leased = repositories.normalizationJobs.claimNext({
      leaseOwner: "worker-extraction-test",
      now,
      leaseExpiresAt
    });
    expect(leased?.id).toBe(enqueued.id);

    expect(() =>
      repositories.transaction((transactionRepositories) => {
        const source = transactionRepositories.sourceRecords.insert(sourceRecord());
        transactionRepositories.fieldProvenance.insert({
          id: "prov-extraction-rollback-title",
          listingSourceRecordId: source.id,
          rawListingId: source.rawListingId,
          fieldPath: "title",
          extractionMethod: "rule",
          valueStatus: "unknown",
          unknownReason: "missing_evidence",
          confidenceBasisPoints: 0,
          observedAt: now,
          evidenceExcerpt: null
        });
        transactionRepositories.listingExtractions.insert(extractionRun());
        transactionRepositories.activityEvents.append(activityEvent());
        transactionRepositories.normalizationJobs.complete({
          id: enqueued.id,
          leaseOwner: "worker-extraction-test",
          completedAt
        });
        throw new Error("extraction rollback probe");
      })
    ).toThrow("extraction rollback probe");

    expect(repositories.sourceRecords.getByRawListingId("raw-extraction-test")).toBeNull();
    expect(repositories.fieldProvenance.count()).toBe(0);
    expect(repositories.listingExtractions.getByRawListingId("raw-extraction-test")).toBeNull();
    expect(repositories.activityEvents.getById("event-extraction-rollback")).toBeNull();
    expect(repositories.normalizationJobs.getById(enqueued.id)?.state).toBe("leased");
  });
});
