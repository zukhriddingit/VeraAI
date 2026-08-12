import type { ListingEnrichmentSnapshot, VeraUserId } from "@vera/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { CANONICAL_FIXTURES, DEMO_SEARCH_PROFILE, SOURCE_FIXTURES } from "../fixtures.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { listingEnrichmentSnapshots, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;
const requestedAt = "2026-08-11T20:00:00.000Z";

function snapshot(listingSourceRecordId: string): ListingEnrichmentSnapshot {
  return {
    id: "enrichment-snapshot-1",
    listingSourceRecordId,
    source: "zillow",
    details: {
      sourceUrl: "https://www.zillow.com/homedetails/observed-listing/123_zpid/",
      sourceListingId: "123",
      propertyName: "Observed Place",
      description: "Observed description with no contact information.",
      baseRentCents: 237_500,
      fees: [
        {
          kind: "required_recurring",
          label: "Required amenity fee",
          amountCents: 2_500,
          cadence: "month",
          required: true
        }
      ],
      estimatedTotalMonthlyCostCents: 240_000,
      depositCents: 237_500,
      applicationFeeCents: 5_000,
      brokerFeeCents: null,
      availableOn: "2026-09-01",
      availabilityText: "Available September 1",
      leaseDurationText: "12 month lease",
      leaseTermMonths: 12,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 700,
      propertyType: "apartment",
      petDetails: null,
      parking: null,
      utilitiesIncluded: ["water"],
      laundry: "in_building",
      furnishedStatus: "unknown",
      amenities: ["Elevator"],
      propertyManagerName: null,
      allowedContactChannel: "platform_message",
      sourceUpdatedAt: null
    },
    photos: [
      {
        sourceUrl: "https://photos.zillowstatic.com/fp/sanitized.webp",
        position: 0,
        width: 1024,
        height: 768,
        safeContentHash: null,
        observedAt: "2026-08-11T20:01:00.000Z"
      }
    ],
    fieldProvenance: [
      {
        fieldPath: "baseRentCents",
        sourceUrl: "https://www.zillow.com/homedetails/observed-listing/123_zpid/",
        extractionMethod: "openclaw_semantic_snapshot",
        confidenceBasisPoints: 9_500,
        observedAt: "2026-08-11T20:01:00.000Z"
      }
    ],
    completeness: {
      basisPoints: 8_000,
      observedImportantFields: 12,
      importantFieldCount: 15,
      missingImportantFields: ["pet policy", "parking", "square footage"]
    },
    observedAt: "2026-08-11T20:01:00.000Z",
    freshUntil: "2026-08-12T02:01:00.000Z",
    createdAt: "2026-08-11T20:01:01.000Z"
  };
}

describe("PostgreSQL listing enrichment repository", () => {
  it("deduplicates work, persists append-only snapshots, and enforces ownership", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values([
        { id: aliceId, name: "Alice", email: "alice-enrichment@example.test", emailVerified: true },
        { id: bobId, name: "Bob", email: "bob-enrichment@example.test", emailVerified: true }
      ]);
      const provider = createPostgresRepositoryProvider(connection);
      const alice = provider.forUser(aliceId);
      const bob = provider.forUser(bobId);
      await alice.searchProfiles.insert(DEMO_SEARCH_PROFILE);
      const source = SOURCE_FIXTURES.find(({ sourceRecord }) => sourceRecord.source === "zillow")!;
      const canonical = CANONICAL_FIXTURES.find(({ memberSourceRecordIds }) =>
        memberSourceRecordIds.includes(source.sourceRecord.id)
      )!;
      const canonicalListing = {
        ...canonical.listing,
        id: "canonical-enrichment-test",
        duplicateClusterId: null,
        primarySourceRecordId: source.sourceRecord.id
      };
      await alice.rawListings.import(source.capture);
      await alice.sourceRecords.insert(source.sourceRecord);
      await alice.canonicalListings.insert(canonicalListing);
      await alice.canonicalListings.addSource({
        canonicalListingId: canonicalListing.id,
        listingSourceRecordId: source.sourceRecord.id,
        isPrimary: true
      });
      const secondSource = SOURCE_FIXTURES.find(
        ({ sourceRecord }) => sourceRecord.id !== source.sourceRecord.id
      )!;
      const secondCanonical = CANONICAL_FIXTURES.find(({ memberSourceRecordIds }) =>
        memberSourceRecordIds.includes(secondSource.sourceRecord.id)
      )!;
      await alice.rawListings.import(secondSource.capture);
      await alice.sourceRecords.insert(secondSource.sourceRecord);
      await alice.canonicalListings.insert({
        ...secondCanonical.listing,
        id: "canonical-enrichment-batch-control",
        duplicateClusterId: null,
        primarySourceRecordId: secondSource.sourceRecord.id
      });
      await alice.canonicalListings.addSource({
        canonicalListingId: "canonical-enrichment-batch-control",
        listingSourceRecordId: secondSource.sourceRecord.id,
        isPrimary: true
      });

      await expect(
        alice.listingEnrichments.queue({
          listingSourceRecordId: source.sourceRecord.id,
          reason: "listing_opened",
          requestedAt,
          force: false
        })
      ).resolves.toMatchObject({ queued: true, reusedFresh: false, record: { state: "queued" } });
      await expect(
        alice.listingEnrichments.queue({
          listingSourceRecordId: source.sourceRecord.id,
          reason: "listing_opened",
          requestedAt,
          force: false
        })
      ).resolves.toMatchObject({ queued: false, reusedFresh: false });

      const claimed = await provider.transaction(aliceId, (repositories) =>
        repositories.listingEnrichments.claim({
          leaseOwner: "enrichment-worker-1",
          now: requestedAt,
          leaseExpiresAt: "2026-08-11T20:02:00.000Z"
        })
      );
      expect(claimed).toMatchObject({ state: "enriching", attemptCount: 1 });
      await alice.listingEnrichments.complete({
        listingSourceRecordId: source.sourceRecord.id,
        leaseOwner: "enrichment-worker-1",
        snapshot: snapshot(source.sourceRecord.id),
        state: "enriched"
      });

      await expect(
        alice.listingEnrichments.getCurrentSnapshot(source.sourceRecord.id)
      ).resolves.toMatchObject({
        id: "enrichment-snapshot-1",
        completeness: { basisPoints: 8_000 },
        photos: [{ position: 0 }]
      });
      const querySpy = vi.spyOn(connection.pool, "query");
      const summaries = await alice.canonicalListings.listSummaries();
      expect(querySpy).toHaveBeenCalledTimes(6);
      querySpy.mockRestore();
      expect(summaries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: canonicalListing.id,
            monthlyRentCents: 237_500,
            recurringFeesCents: 2_500,
            detailCompletenessBasisPoints: 8_000,
            enrichmentState: "enriched",
            originalListingUrl: "https://www.zillow.com/homedetails/observed-listing/123_zpid/",
            primaryPhoto: expect.objectContaining({ position: 0 })
          })
        ])
      );
      await expect(
        alice.listingEnrichments.queue({
          listingSourceRecordId: source.sourceRecord.id,
          reason: "search_top_three",
          requestedAt: "2026-08-11T20:05:00.000Z",
          force: false
        })
      ).resolves.toMatchObject({ queued: false, reusedFresh: true });
      await expect(
        alice.listingEnrichments.markExpiredStale("2026-08-12T02:02:00.000Z")
      ).resolves.toBe(1);
      await expect(
        alice.listingEnrichments.getBySourceRecordId(source.sourceRecord.id)
      ).resolves.toMatchObject({ state: "stale" });
      await expect(
        bob.listingEnrichments.getBySourceRecordId(source.sourceRecord.id)
      ).resolves.toBeNull();
      await expect(
        db
          .update(listingEnrichmentSnapshots)
          .set({ source: "other" })
          .where(eq(listingEnrichmentSnapshots.id, "enrichment-snapshot-1"))
      ).rejects.toBeDefined();
      await expect(
        alice.listingEnrichments.getCurrentSnapshot(source.sourceRecord.id)
      ).resolves.toMatchObject({ source: "zillow" });
    });
  });
});
