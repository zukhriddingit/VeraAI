import { describe, expect, it } from "vitest";

import type { FieldProvenance, ListingSourceRecord, PhotoHash, RawListing } from "@vera/domain";

import { normalizeDecisionSource } from "./index.ts";

const now = "2026-07-20T17:00:00.000Z";
const hash = "a".repeat(64);

const rawListing: RawListing = {
  id: "raw-a",
  source: "zillow",
  acquisitionMode: "fixture",
  sourceListingId: "source-listing-a",
  sourceUrl: "https://example.invalid/listing-a?utm_source=test&id=1",
  captureMethod: "fixture",
  observedAt: now,
  sourcePostedAt: null,
  rawText: "Synthetic fixture.",
  rawJson: null,
  captureMetadata: { sanitized: true },
  contentHash: hash,
  idempotencyKey: hash,
  createdAt: now
};

const sourceRecord: ListingSourceRecord = {
  id: "source-a",
  rawListingId: rawListing.id,
  source: "zillow",
  sourceListingId: rawListing.sourceListingId,
  sourceUrl: rawListing.sourceUrl,
  sourcePostedAt: null,
  contactChannel: "email",
  title: "Synthetic apartment",
  address: {
    line1: "12 North Main Street Apt 4B",
    unit: null,
    city: "Boston",
    region: "MA",
    postalCode: "02110",
    countryCode: "US"
  },
  monthlyRentCents: 245_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 680,
  latitude: null,
  longitude: null,
  propertyType: "apartment",
  availableOn: "2026-09-01",
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: [],
  description: "Sanitized listing description.",
  extractionConfidenceBasisPoints: 9_000,
  completenessBasisPoints: 8_000,
  observedAt: now,
  createdAt: now
};

const provenance: FieldProvenance = {
  id: "provenance-a-rent",
  listingSourceRecordId: sourceRecord.id,
  rawListingId: rawListing.id,
  fieldPath: "monthlyRentCents",
  extractionMethod: "fixture_structured",
  valueStatus: "known",
  unknownReason: null,
  confidenceBasisPoints: 10_000,
  observedAt: now,
  evidenceExcerpt: "$2,450/month"
};

const photoHashes: PhotoHash[] = [
  {
    listingPhotoId: "photo-a",
    hash: "0123456789abcdef",
    version: "listing-photo.dhash64.v1"
  }
];

describe("normalizeDecisionSource", () => {
  it("builds a strict deterministic source and keeps contacts protected", () => {
    const hashed: string[] = [];
    const result = normalizeDecisionSource(
      {
        sourceRecord,
        rawListing,
        connectorId: "fixture.official-api.v1",
        fieldCandidates: [{ provenance, value: 245_000 }],
        photoHashes,
        contacts: [
          { kind: "email", value: "RENTAL.FIXTURE@Example.COM" },
          { kind: "phone", value: "(617) 555-0123" }
        ]
      },
      {
        contactHasher: {
          hash(value) {
            hashed.push(value);
            return value.startsWith("email:") ? "a".repeat(64) : "b".repeat(64);
          }
        }
      }
    );

    expect(hashed).toEqual(["email:rental.fixture@example.com", "phone:+16175550123"]);
    expect(result).toMatchObject({
      sourceRecordId: "source-a",
      normalizedAddress: "12 n main st",
      normalizedUnit: "4b",
      canonicalUrl: "https://example.invalid/listing-a?id=1",
      rentCents: 245_000,
      requiredRecurringFeeCents: null,
      contactFingerprints: ["a".repeat(64), "b".repeat(64)]
    });
    expect(JSON.stringify(result)).not.toContain("rental.fixture");
    expect(JSON.stringify(result)).not.toContain("617555");
  });

  it("does not invent missing values and visibly rejects unsafe URLs/contacts", () => {
    const result = normalizeDecisionSource(
      {
        sourceRecord: {
          ...sourceRecord,
          sourceUrl: "http://127.0.0.1/private",
          monthlyRentCents: null,
          availableOn: null,
          address: {
            line1: null,
            unit: null,
            city: null,
            region: null,
            postalCode: null,
            countryCode: null
          }
        },
        rawListing,
        connectorId: "fixture.official-api.v1",
        fieldCandidates: [],
        photoHashes: [],
        contacts: [{ kind: "phone", value: "555-0123" }]
      },
      { contactHasher: { hash: () => "c".repeat(64) } }
    );

    expect(result.normalizedAddress).toBeNull();
    expect(result.rentCents).toBeNull();
    expect(result.availableOn).toBeNull();
    expect(result.canonicalUrl).toBeNull();
    expect(result.contactFingerprints).toEqual([]);
    expect(result.normalizationReasonCodes).toEqual([
      "url_rejected",
      "contact_rejected",
      "cost_partial",
      "field_unknown"
    ]);
  });
});
