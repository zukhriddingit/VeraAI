import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeRawListing, RawListingEnvelopeSchema } from "@vera/connectors";
import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "@vera/db/demo";
import {
  CaptureAcceptedResponseSchema,
  CaptureErrorResponseSchema,
  CaptureStatusResponseSchema,
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionRunSchema,
  type CaptureAcceptedResponse,
  type ListingExtractionRun
} from "@vera/domain";
import { evaluateCorpus } from "@vera/scoring";
import { afterEach, describe, expect, it } from "vitest";

import { POST } from "../route.ts";
import { GET } from "./route.ts";
import {
  clearTestApplication,
  registerTestDemoRuntime
} from "../../../../test-support/demo-runtime.ts";

const originalDataDirectory = process.env.VERA_DATA_DIR;
const completedAt = "2099-07-17T18:00:00.000Z";
let directory = "";
let runtimeConnection: ReturnType<typeof openDatabase> | null = null;

afterEach(() => {
  runtimeConnection?.close();
  runtimeConnection = null;
  clearTestApplication();
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

function initializeDatabase(): void {
  directory = mkdtempSync(join(tmpdir(), "vera-capture-status-"));
  process.env.VERA_DATA_DIR = directory;
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });

  try {
    migrateDatabase(connection);
    seedDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
  runtimeConnection = registerTestDemoRuntime(join(directory, "vera.sqlite"));
}

async function capture(input: unknown): Promise<CaptureAcceptedResponse> {
  const response = await POST(
    new Request("http://127.0.0.1/api/captures", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" },
      body: JSON.stringify(input)
    })
  );
  expect(response.status).toBe(202);
  return CaptureAcceptedResponseSchema.parse(await response.json());
}

async function status(rawListingId: string): Promise<Response> {
  return GET(new Request("http://127.0.0.1"), {
    params: Promise.resolve({ rawListingId })
  });
}

function completeCapture(
  accepted: CaptureAcceptedResponse,
  options: { readonly augmented?: boolean } = {}
): ListingExtractionRun {
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });

  try {
    const repositories = createSqliteRepositories(connection);
    const raw = repositories.rawListings.getById(accepted.rawListingId);
    if (!raw) throw new Error("Expected captured raw listing.");
    const metadata = raw.captureMetadata;
    const envelope = RawListingEnvelopeSchema.parse({
      connectorId: metadata.connectorId,
      capability: metadata.capability,
      acquisitionMode: raw.acquisitionMode,
      source: raw.source,
      sourceListingId: raw.sourceListingId,
      sourceUrl: raw.sourceUrl,
      captureMethod: raw.captureMethod,
      observedAt: raw.observedAt,
      sourcePostedAt: raw.sourcePostedAt,
      rawText: raw.rawText,
      rawJson: raw.rawJson,
      captureMetadata: {
        networkAccess: metadata.networkAccess,
        untrustedContent: metadata.untrustedContent,
        browserAccess: metadata.browserAccess
      }
    });
    let nextId = 0;
    const normalized = normalizeRawListing(envelope, {
      rawListingId: raw.id,
      createId: () => `${raw.id}:capture-detail-${++nextId}`,
      now: () => new Date(completedAt)
    });
    const augmentedAmenities = {
      status: "known",
      value: ["Roof deck"],
      confidenceBasisPoints: 8_800,
      evidenceSnippet: "Amenities: Roof deck"
    } as const;
    const mergedExtraction = options.augmented
      ? { ...normalized.extraction, amenities: augmentedAmenities }
      : normalized.extraction;
    const provenance = normalized.provenance.map((entry) =>
      options.augmented && entry.fieldPath === "amenities"
        ? {
            ...entry,
            extractionMethod: "ai" as const,
            confidenceBasisPoints: augmentedAmenities.confidenceBasisPoints,
            valueStatus: "known" as const,
            unknownReason: null,
            evidenceExcerpt: augmentedAmenities.evidenceSnippet
          }
        : entry
    );
    const usage = options.augmented
      ? { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const providerResult = options.augmented
      ? {
          providerId: "mock-provider",
          model: "synthetic-model",
          responseId: "opaque-response-id-must-not-leak",
          extraction: mergedExtraction,
          usage,
          latencyMilliseconds: 25,
          repairCount: 1
        }
      : null;
    const run = ListingExtractionRunSchema.parse({
      id: `extraction:${raw.id}`,
      rawListingId: raw.id,
      listingSourceRecordId: normalized.sourceRecord.id,
      mode: options.augmented ? "llm_augmented" : "deterministic_only",
      inputHash: raw.contentHash,
      requestedFields: options.augmented ? ["amenities"] : [],
      providerId: providerResult?.providerId ?? null,
      model: providerResult?.model ?? null,
      responseId: providerResult?.responseId ?? null,
      promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
      extractionVersion: LISTING_EXTRACTION_VERSION,
      providerResult,
      mergedExtraction,
      usage,
      latencyMilliseconds: providerResult?.latencyMilliseconds ?? 0,
      repairCount: providerResult?.repairCount ?? 0,
      completedAt
    });
    const job = repositories.normalizationJobs.claimNext({
      leaseOwner: "capture-detail-test",
      now: completedAt,
      leaseExpiresAt: "2099-07-17T18:01:00.000Z"
    });
    if (!job || job.rawListingId !== raw.id) throw new Error("Expected normalization job.");

    repositories.transaction((transactionRepositories) => {
      transactionRepositories.sourceRecords.insert({
        ...normalized.sourceRecord,
        amenities: options.augmented ? ["Roof deck"] : normalized.sourceRecord.amenities
      });
      for (const field of provenance) transactionRepositories.fieldProvenance.insert(field);
      transactionRepositories.listingExtractions.insert(run);
      transactionRepositories.normalizationJobs.complete({
        id: job.id,
        leaseOwner: "capture-detail-test",
        completedAt
      });
    });

    return run;
  } finally {
    connection.close();
  }
}

describe.sequential("GET /api/captures/:rawListingId", () => {
  it("returns queued and leased capture status without fabricating fields", async () => {
    initializeDatabase();
    const accepted = await capture({
      kind: "manual_structured",
      listing: { source: "other", monthlyRentCents: 210_000 }
    });

    const queuedResponse = await status(accepted.rawListingId);
    const queued = CaptureStatusResponseSchema.parse(await queuedResponse.json());
    expect(queuedResponse.status).toBe(200);
    expect(queued).toMatchObject({
      rawListingId: accepted.rawListingId,
      state: "queued",
      normalizationState: "queued",
      extractionRun: null,
      fields: []
    });

    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      const claimed = createSqliteRepositories(connection).normalizationJobs.claimNext({
        leaseOwner: "capture-api-test",
        now: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()
      });
      expect(claimed?.rawListingId).toBe(accepted.rawListingId);
    } finally {
      connection.close();
    }

    const leasedResponse = await status(accepted.rawListingId);
    const leased = CaptureStatusResponseSchema.parse(await leasedResponse.json());
    expect(leased).toMatchObject({
      state: "processing",
      normalizationState: "leased",
      extractionRun: null,
      fields: []
    });
  });

  it("returns every deterministic field with evidence explanations and no provider metadata", async () => {
    initializeDatabase();
    const accepted = await capture({
      kind: "manual_text",
      sourceUrl: "https://housing.example/capture-detail/deterministic",
      listingText: [
        "Title: Bright synthetic apartment",
        "Base rent: USD 2450 per month",
        "1 bed and 1 bath",
        "Address: 101 Example Way, Harbor City, MA",
        "Contact me through the platform"
      ].join("\n")
    });
    completeCapture(accepted);

    const response = await status(accepted.rawListingId);
    const detail = CaptureStatusResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(detail.state).toBe("completed");
    expect(detail.normalizationState).toBe("completed");
    expect(detail.extractionRun).toMatchObject({
      mode: "deterministic_only",
      providerId: null,
      model: null,
      requestedFields: [],
      requestedFieldCount: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMilliseconds: 0,
      repairCount: 0
    });
    expect(
      detail.fields
        .slice(0, ListingExtractionFieldNameSchema.options.length)
        .map((field) => field.fieldPath)
    ).toEqual(ListingExtractionFieldNameSchema.options);
    expect(detail.fields).toHaveLength(ListingExtractionFieldNameSchema.options.length + 2);
    expect(detail.fields.find((field) => field.fieldPath === "baseRent")).toMatchObject({
      status: "known",
      displayValue: "$2,450/month",
      extractionMethod: "rule",
      explanation: "Matched supplied listing evidence with a deterministic rule."
    });
    expect(detail.fields.find((field) => field.fieldPath === "squareFeet")).toMatchObject({
      status: "unknown",
      displayValue: null,
      unknownReason: "not_present",
      confidenceBasisPoints: 0,
      evidenceSnippet: null
    });
    expect(detail.fields.every((field) => field.explanation.length > 0)).toBe(true);
  });

  it("maps extraction provenance into canonical decision fields without leaking contacts", async () => {
    initializeDatabase();
    const accepted = await capture({
      kind: "manual_text",
      sourceUrl: "https://housing.example/capture-detail/decision-aliases",
      listingText: [
        "Base rent: USD 2450 per month",
        "1 bed and 1 bath",
        "Address: 101 Decision Example Way, Harbor City, MA",
        "Posted: 2026-07-17",
        "Contact me through the platform"
      ].join("\n")
    });
    completeCapture(accepted);
    const unsupportedCurrency = await capture({
      kind: "manual_structured",
      listing: {
        source: "other",
        title: "Synthetic CAD listing",
        baseRent: {
          amountMinorUnits: 245_000,
          currency: "CAD",
          billingPeriod: "month",
          rawAmount: "CAD 2450 per month"
        }
      }
    });
    completeCapture(unsupportedCurrency);

    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      const repositories = createSqliteRepositories(connection);
      const sourceRecord = repositories.sourceRecords.getByRawListingId(accepted.rawListingId);
      const unsupportedCurrencyRecord = repositories.sourceRecords.getByRawListingId(
        unsupportedCurrency.rawListingId
      );
      expect(sourceRecord).not.toBeNull();
      expect(unsupportedCurrencyRecord).not.toBeNull();
      const job = repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
        id: "decision-alias-regression-job",
        searchProfileId: "profile-demo-harbor-city",
        trigger: "normalization",
        now: completedAt
      });
      const snapshot = repositories.decisionReconciliation.readSnapshot({
        searchProfileId: job.searchProfileId,
        targetCorpusRevision: job.targetCorpusRevision
      });
      const source = snapshot.sourceRecords.find(
        (candidate) => candidate.sourceRecordId === sourceRecord!.id
      );
      expect(source?.fieldCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: "address.line1",
            valueStatus: "known",
            value: "101 Decision Example Way, Harbor City, MA"
          }),
          expect.objectContaining({
            fieldPath: "monthlyRentCents",
            valueStatus: "known",
            value: 245_000
          })
        ])
      );
      expect(source?.fieldCandidates.some(({ fieldPath }) => fieldPath.startsWith("contact"))).toBe(
        false
      );
      const unsupportedCurrencySource = snapshot.sourceRecords.find(
        (candidate) => candidate.sourceRecordId === unsupportedCurrencyRecord!.id
      );
      expect(
        unsupportedCurrencySource?.fieldCandidates.find(
          ({ fieldPath }) => fieldPath === "monthlyRentCents"
        )
      ).toMatchObject({ valueStatus: "unknown", value: null, confidenceBasisPoints: 0 });

      const plan = evaluateCorpus(snapshot, { now: completedAt });
      const canonical = plan.canonicalPlans.find(({ memberSourceRecordIds }) =>
        memberSourceRecordIds.includes(sourceRecord!.id)
      );
      expect(
        canonical?.selectedFields.find(({ fieldPath }) => fieldPath === "monthlyRentCents")
      ).toMatchObject({ valueStatus: "known", value: 245_000 });
    } finally {
      connection.close();
    }
  });

  it("returns safe augmented metadata and requested fields without opaque provider data", async () => {
    initializeDatabase();
    const accepted = await capture({
      kind: "manual_text",
      sourceUrl: "https://housing.example/capture-detail/augmented",
      listingText: "Base rent: USD 2100 per month\nAmenities: Roof deck"
    });
    completeCapture(accepted, { augmented: true });

    const response = await status(accepted.rawListingId);
    const serialized = await response.text();
    const detail = CaptureStatusResponseSchema.parse(JSON.parse(serialized) as unknown);

    expect(detail.extractionRun).toEqual({
      mode: "llm_augmented",
      providerId: "mock-provider",
      model: "synthetic-model",
      promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
      extractionVersion: LISTING_EXTRACTION_VERSION,
      requestedFields: ["amenities"],
      requestedFieldCount: 1,
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      latencyMilliseconds: 25,
      repairCount: 1,
      completedAt
    });
    expect(detail.fields.find((field) => field.fieldPath === "amenities")).toMatchObject({
      status: "known",
      displayValue: "Roof deck",
      extractionMethod: "ai",
      confidenceBasisPoints: 8_800,
      evidenceSnippet: "Amenities: Roof deck",
      explanation:
        "Filled a requested missing field from the quoted evidence after schema and evidence validation."
    });
    expect(serialized).not.toContain("opaque-response-id-must-not-leak");
    expect(serialized).not.toContain("providerResult");
    expect(serialized).not.toContain("rawText");
    expect(serialized).not.toContain("rawJson");
    expect(serialized).not.toContain("API_KEY");
  });

  it("resolves duplicate captures to the original raw evidence", async () => {
    initializeDatabase();
    const input = {
      kind: "manual_structured",
      listing: { source: "other", title: "Synthetic duplicate", bedrooms: 1 }
    };
    const original = await capture(input);
    completeCapture(original);
    const duplicate = await capture(input);

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.rawListingId).toBe(original.rawListingId);
    const response = await status(duplicate.rawListingId);
    const detail = CaptureStatusResponseSchema.parse(await response.json());
    expect(detail.rawListingId).toBe(original.rawListingId);
    expect(detail.fields.find((field) => field.fieldPath === "title")?.displayValue).toBe(
      "Synthetic duplicate"
    );
  });

  it("uses the safe error schema for missing captures and database failures", async () => {
    initializeDatabase();
    const missingResponse = await status("raw-listing-not-found");
    expect(missingResponse.status).toBe(404);
    expect(CaptureErrorResponseSchema.parse(await missingResponse.json())).toEqual({
      code: "not_found",
      message: "The captured listing was not found.",
      correlationId: null,
      retryable: false
    });

    runtimeConnection?.close();
    runtimeConnection = null;
    const unavailableResponse = await status("raw-listing-unavailable");
    expect(unavailableResponse.status).toBe(503);
    expect(CaptureErrorResponseSchema.parse(await unavailableResponse.json())).toMatchObject({
      code: "database_unavailable",
      correlationId: null,
      retryable: true
    });
  });

  it("rejects inconsistent known and unknown response evidence", () => {
    expect(
      CaptureStatusResponseSchema.safeParse({
        correlationId: "correlation-inconsistent",
        rawListingId: "raw-inconsistent",
        duplicate: false,
        state: "completed",
        normalizationState: "completed",
        extractionRun: null,
        fields: [
          {
            fieldPath: "title",
            status: "unknown",
            displayValue: "Fabricated title",
            unknownReason: "not_present",
            extractionMethod: "rule",
            confidenceBasisPoints: 0,
            evidenceSnippet: null,
            explanation: "This must fail."
          }
        ],
        updatedAt: completedAt
      }).success
    ).toBe(false);
  });
});
