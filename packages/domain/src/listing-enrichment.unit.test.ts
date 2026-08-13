import { describe, expect, it } from "vitest";

import {
  ListingDetailFieldsSchema,
  ListingDetailPhotoSchema,
  ListingEnrichmentRecordSchema,
  ListingEnrichmentSnapshotSchema,
  computeListingDetailCompleteness,
  isExpectedSourcePhotoUrl,
  isExpectedSourceUrl,
  presentListingEnrichmentState
} from "./listing-enrichment.ts";

const fields = ListingDetailFieldsSchema.parse({
  sourceUrl: "https://www.zillow.com/homedetails/123456789_zpid/",
  sourceListingId: "123456789",
  propertyName: "Kelton Street",
  description: null,
  baseRentCents: 237_500,
  fees: [],
  estimatedTotalMonthlyCostCents: null,
  depositCents: null,
  applicationFeeCents: null,
  brokerFeeCents: null,
  availableOn: null,
  availabilityText: null,
  leaseDurationText: null,
  leaseTermMonths: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: null,
  propertyType: "apartment",
  petDetails: null,
  parking: null,
  utilitiesIncluded: [],
  laundry: "unknown",
  furnishedStatus: "unknown",
  amenities: [],
  propertyManagerName: null,
  allowedContactChannel: "unknown",
  sourceUpdatedAt: null
});

describe("listing detail enrichment", () => {
  it("accepts exactly the durable enrichment states", () => {
    const base = {
      listingSourceRecordId: "source-record-1",
      requestedReason: null,
      attemptCount: 0,
      availableAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      currentSnapshotId: null,
      manualAction: null,
      lastErrorCode: null,
      requestedAt: null,
      startedAt: null,
      completedAt: null,
      updatedAt: "2026-08-11T22:00:00.000Z"
    };
    for (const state of [
      "not_requested",
      "queued",
      "enriching",
      "enriched",
      "partial",
      "blocked_manual_action",
      "stale",
      "failed"
    ]) {
      expect(ListingEnrichmentRecordSchema.parse({ ...base, state }).state).toBe(state);
    }
    expect(() => ListingEnrichmentRecordSchema.parse({ ...base, state: "sent" })).toThrow();
  });

  it("distinguishes retrying and manual-action states for presentation", () => {
    const base = ListingEnrichmentRecordSchema.parse({
      listingSourceRecordId: "source-record-1",
      state: "queued",
      requestedReason: "listing_opened",
      attemptCount: 1,
      availableAt: "2026-08-11T22:01:00.000Z",
      leaseOwner: null,
      leaseExpiresAt: null,
      currentSnapshotId: null,
      manualAction: null,
      lastErrorCode: "gateway_timeout",
      requestedAt: "2026-08-11T22:00:00.000Z",
      startedAt: "2026-08-11T22:00:10.000Z",
      completedAt: null,
      updatedAt: "2026-08-11T22:00:30.000Z"
    });
    expect(presentListingEnrichmentState(base)).toBe("retrying");
    expect(
      presentListingEnrichmentState({
        ...base,
        state: "blocked_manual_action",
        manualAction: "captcha_required"
      })
    ).toBe("manual_action_required");
  });

  it("scores only important observed fields and stays separate from fit", () => {
    const completeness = computeListingDetailCompleteness(fields);
    expect(completeness).toMatchObject({
      observedImportantFields: 4,
      importantFieldCount: 15,
      basisPoints: 2667
    });
    expect(completeness.missingImportantFields).toContain("primary photo");
    expect(completeness).not.toHaveProperty("fitScoreBasisPoints");
  });

  it("counts an ordered safe photo and rejects non-HTTPS media", () => {
    const photo = ListingDetailPhotoSchema.parse({
      sourceUrl: "https://photos.zillowstatic.com/fp/example.webp",
      position: 0,
      width: 1024,
      height: 768,
      safeContentHash: null,
      observedAt: "2026-08-11T22:00:00.000Z"
    });
    expect(computeListingDetailCompleteness(fields, [photo]).observedImportantFields).toBe(5);
    expect(() =>
      ListingDetailPhotoSchema.parse({ ...photo, sourceUrl: "http://example.test/photo.jpg" })
    ).toThrow(/HTTPS/u);
  });

  it("rejects contact details from persisted enrichment text", () => {
    expect(() =>
      ListingDetailFieldsSchema.parse({
        ...fields,
        description: "Call 617-555-1212 before applying."
      })
    ).toThrow(/phone numbers/iu);
    expect(() =>
      ListingDetailFieldsSchema.parse({
        ...fields,
        propertyManagerName: "leasing@example.test"
      })
    ).toThrow(/email addresses/iu);
  });

  it("validates source links against exact reviewed domains", () => {
    expect(
      isExpectedSourceUrl("zillow", "https://www.zillow.com/apartments/allston-ma/example/")
    ).toBe(true);
    expect(
      isExpectedSourceUrl("zillow", "https://www.zillow.com.evil.test/apartments/example/")
    ).toBe(false);
    expect(isExpectedSourceUrl("zillow", "https://www.zillow.com/listing?token=secret")).toBe(
      false
    );
    expect(isExpectedSourceUrl("zillow", "https://user:pass@www.zillow.com/listing")).toBe(false);
    expect(isExpectedSourceUrl("zillow", "https://www.zillow.com:444/listing")).toBe(false);
    expect(isExpectedSourceUrl("rentcast", "https://api.rentcast.io/listings/example")).toBe(false);
    expect(
      isExpectedSourceUrl(
        "craigslist",
        "https://www.craigslist.org/view/d/somerville-renovated-apartment/eok9SmyfAgVn49wCv4TNYh"
      )
    ).toBe(true);
    expect(
      isExpectedSourceUrl("craigslist", "https://www.craigslist.org/search/area/boston?cat=apa")
    ).toBe(false);
    expect(
      isExpectedSourceUrl(
        "craigslist",
        "https://www.craigslist.org.evil.test/view/d/somerville-apartment/eok9SmyfAgVn49wCv4TNYh"
      )
    ).toBe(false);
    expect(
      isExpectedSourcePhotoUrl("zillow", "https://photos.zillowstatic.com/fp/example.webp")
    ).toBe(true);
    expect(
      isExpectedSourcePhotoUrl(
        "custom_website",
        "https://housing.example.edu/media/listing.webp",
        "https://housing.example.edu/listings/42"
      )
    ).toBe(true);
    expect(
      isExpectedSourcePhotoUrl(
        "zillow",
        "https://photos.zillowstatic.com/fp/example.webp?token=secret"
      )
    ).toBe(false);
    expect(() =>
      ListingEnrichmentSnapshotSchema.parse({
        id: "snapshot-unsafe-provenance",
        listingSourceRecordId: "source-record-1",
        source: "zillow",
        details: fields,
        photos: [],
        fieldProvenance: [
          {
            fieldPath: "baseRentCents",
            sourceUrl: "https://www.zillow.com.evil.test/listing",
            extractionMethod: "openclaw_semantic_snapshot",
            confidenceBasisPoints: 9_000,
            observedAt: "2026-08-11T22:00:00.000Z"
          }
        ],
        completeness: computeListingDetailCompleteness(fields),
        observedAt: "2026-08-11T22:00:00.000Z",
        freshUntil: "2026-08-12T04:00:00.000Z",
        createdAt: "2026-08-11T22:00:01.000Z"
      })
    ).toThrow(/provenance/iu);
  });
});
