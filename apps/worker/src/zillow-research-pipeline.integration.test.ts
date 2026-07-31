import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  zillowObservedListingToEnvelope,
  zillowResearchSafeCaptureMetadata
} from "@vera/connectors";
import {
  DEMO_SEARCH_PROFILE,
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  sha256Text,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import {
  RawListingCaptureSchema,
  type RawListingCapture,
  type ZillowObservedListing
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { processNextDecisionJob } from "./decision-worker.ts";
import { processNextNormalizationJob } from "./normalization-worker.ts";

let directory = "";
let connection: VeraDatabaseConnection;
let provider: ReturnType<typeof createDemoRepositoryProvider>;
const observedAt = "2026-07-30T12:00:00.000Z";
const address = "12 Beacon St, Boston, MA 02108";
const zillowUrl = "https://www.zillow.com/homedetails/12-Beacon-St-Boston-MA-02108/123456_zpid/";
const zillow: ZillowObservedListing = {
  sourceListingId: "123456",
  canonicalObservedUrl: zillowUrl,
  finalDetailPageUrl: zillowUrl,
  address,
  rentUsd: 3_200,
  bedrooms: 2,
  bathrooms: 1,
  squareFeet: 900,
  availability: "Available now",
  amenities: ["In-unit laundry"],
  observedAt,
  sourceFieldProvenance: [
    {
      field: "address",
      observedFrom: "detail_page",
      sourceUrl: zillowUrl,
      extractionMethod: "openclaw_semantic_snapshot",
      confidenceBasisPoints: 9_500,
      observedAt
    }
  ],
  missingFields: [],
  safeExtractionWarnings: [],
  researchNotes: ["Opened one bounded same-tab Zillow listing detail page."]
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-zillow-pipeline-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  seedDatabase(createSqliteRepositories(connection));
  provider = createDemoRepositoryProvider(connection);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("Zillow research canonical pipeline", () => {
  it("normalizes, cross-source deduplicates, scores, and exposes safe research notes", async () => {
    const repositories = provider.forUser(DEMO_USER_ID);
    const zillowEnvelope = zillowObservedListingToEnvelope(zillow);
    const captures: RawListingCapture[] = [
      RawListingCaptureSchema.parse({
        id: "raw-live-zillow-123456",
        source: zillowEnvelope.source,
        acquisitionMode: zillowEnvelope.acquisitionMode,
        sourceListingId: zillowEnvelope.sourceListingId,
        sourceUrl: zillowEnvelope.sourceUrl,
        captureMethod: zillowEnvelope.captureMethod,
        observedAt: zillowEnvelope.observedAt,
        sourcePostedAt: null,
        rawText: null,
        rawJson: zillowEnvelope.rawJson,
        captureMetadata: {
          ...zillowEnvelope.captureMetadata,
          ...zillowResearchSafeCaptureMetadata(zillow, {
            veraRunId: "run-zillow-pipeline",
            searchProfileId: DEMO_SEARCH_PROFILE.id
          })
        }
      }),
      RawListingCaptureSchema.parse({
        id: "raw-live-rentcast-duplicate",
        source: "rentcast",
        acquisitionMode: "official_api",
        sourceListingId: "rentcast-duplicate-12-beacon",
        sourceUrl: null,
        captureMethod: "official_api",
        observedAt,
        sourcePostedAt: null,
        rawText: null,
        rawJson: {
          source: "rentcast",
          sourceListingId: "rentcast-duplicate-12-beacon",
          monthlyRentCents: 320_000,
          baseRent: {
            amountMinorUnits: 320_000,
            currency: "USD",
            billingPeriod: "month",
            rawAmount: "$3,200/month"
          },
          bedrooms: 2,
          bathrooms: 1,
          addressText: address,
          squareFeet: 900,
          amenities: ["In-unit laundry"]
        },
        captureMetadata: {
          connectorId: "rentcast.rental-listings.v1",
          capability: "structured_feed.read",
          searchProfileId: DEMO_SEARCH_PROFILE.id,
          networkAccess: true,
          untrustedContent: true,
          browserAccess: "not_applicable"
        }
      })
    ];

    for (const capture of captures) {
      const imported = await repositories.rawListings.import(capture);
      await repositories.normalizationJobs.enqueue({
        id: `normalize-${capture.id}`,
        rawListingId: imported.record.id,
        idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
        availableAt: observedAt,
        maxAttempts: 3,
        correlationId: "run-zillow-pipeline",
        causationId: "import-zillow-pipeline",
        createdAt: observedAt
      });
    }

    for (let index = 0; index < captures.length; index += 1) {
      await expect(
        processNextNormalizationJob(
          {
            userId: DEMO_USER_ID,
            repositoryProvider: provider,
            repositories,
            leaseOwner: "zillow-normalizer",
            provider: null,
            now: () => new Date("2026-07-30T12:00:10.000Z"),
            createId: randomUUID
          },
          new AbortController().signal
        )
      ).resolves.toMatchObject({ status: "completed", mode: "deterministic_only" });
    }

    let completed = false;
    for (let index = 0; index < 3 && !completed; index += 1) {
      const decision = await processNextDecisionJob(
        {
          userId: DEMO_USER_ID,
          repositoryProvider: provider,
          repositories,
          leaseOwner: "zillow-decision",
          now: () => new Date("2026-07-30T12:00:20.000Z"),
          createId: randomUUID
        },
        new AbortController().signal
      );
      completed = decision.status === "completed";
    }
    expect(completed).toBe(true);

    const summaries = await repositories.canonicalListings.listSummaries();
    const stitched = summaries.find(
      (summary) =>
        summary.sourceLabels.includes("rentcast") &&
        summary.sourceLabels.includes("zillow") &&
        summary.address.line1 === address
    );
    expect(stitched).toMatchObject({
      sourceLabels: ["rentcast", "zillow"],
      sourceRecordCount: 2,
      duplicateCount: 1,
      monthlyRentCents: 320_000,
      fitScoreBasisPoints: expect.any(Number),
      researchNotes: ["Opened one bounded same-tab Zillow listing detail page."]
    });
    expect(stitched?.unknownFields).toContain("pet policy");

    const zillowRaw = await repositories.rawListings.getById("raw-live-zillow-123456");
    const sourceRecord = await repositories.sourceRecords.getByRawListingId(zillowRaw!.id);
    expect(sourceRecord).toMatchObject({
      source: "zillow",
      monthlyRentCents: 320_000,
      bedrooms: 2,
      bathrooms: 1,
      squareFeet: 900
    });
    expect(
      (await repositories.fieldProvenance.listBySourceRecordId(sourceRecord!.id)).some(
        (field) => field.fieldPath === "addressText" && field.valueStatus === "known"
      )
    ).toBe(true);
  });
});
