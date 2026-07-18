import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidListingTransitionError,
  type ActivityEvent,
  type CanonicalListing,
  type ListingSourceRecord,
  type RawListingCapture
} from "@vera/domain";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type VeraDatabaseConnection,
  type VeraRepositories
} from "./index.ts";

const now = "2026-07-17T12:00:00.000Z";
const later = "2026-07-17T12:01:00.000Z";
const hash = "b".repeat(64);

let temporaryDirectory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;

const capture: RawListingCapture = {
  id: "raw-repository-test",
  source: "craigslist",
  sourceListingId: "fixture-repository-001",
  sourceUrl: "https://example.invalid/fixtures/craigslist/repository-test",
  captureMethod: "fixture",
  observedAt: now,
  sourcePostedAt: null,
  rawText: "Sanitized synthetic repository fixture.",
  rawJson: { fixture: true, rentCents: 220_000 },
  captureMetadata: { sanitized: true }
};

function sourceRecord(rawListingId: string): ListingSourceRecord {
  return {
    id: "src-repository-test",
    rawListingId,
    source: "craigslist",
    sourceListingId: capture.sourceListingId,
    sourceUrl: capture.sourceUrl,
    sourcePostedAt: null,
    contactChannel: "unknown",
    title: "Cedar Flat fixture",
    address: {
      line1: "22 Cedar Passage",
      unit: null,
      city: "Harbor City",
      region: "MA",
      postalCode: "02100",
      countryCode: "US"
    },
    monthlyRentCents: 220_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    propertyType: "apartment",
    availableOn: null,
    leaseTermMonths: 12,
    petPolicy: null,
    amenities: [],
    description: "Synthetic fixture used only for repository tests.",
    extractionConfidenceBasisPoints: 10_000,
    completenessBasisPoints: 7_000,
    observedAt: now,
    createdAt: now
  };
}

function canonicalListing(primarySourceRecordId: string): CanonicalListing {
  const source = sourceRecord(capture.id);
  return {
    id: "can-repository-test",
    duplicateClusterId: null,
    primarySourceRecordId,
    title: source.title,
    address: source.address,
    monthlyRentCents: source.monthlyRentCents,
    recurringFeesCents: source.recurringFeesCents,
    bedrooms: source.bedrooms,
    bathrooms: source.bathrooms,
    squareFeet: source.squareFeet,
    propertyType: source.propertyType,
    availableOn: source.availableOn,
    leaseTermMonths: source.leaseTermMonths,
    petPolicy: source.petPolicy,
    amenities: source.amenities,
    description: source.description,
    lifecycleState: "new",
    completenessBasisPoints: source.completenessBasisPoints,
    freshestObservedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function activityEvent(id = "event-repository-test"): ActivityEvent {
  return {
    id,
    correlationId: "correlation-repository-test",
    causationId: null,
    actor: "system",
    action: "repository.tested",
    targetType: "database",
    targetId: "vera-test",
    policyDecision: "not_applicable",
    approvalId: null,
    payloadHash: hash,
    outcome: "succeeded",
    errorCategory: null,
    metadata: { sanitized: true },
    occurredAt: now
  };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-repositories-"));
  connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
});

afterEach(() => {
  connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("SQLite repositories", () => {
  it("imports identical raw evidence idempotently", () => {
    const first = repositories.rawListings.import(capture);
    const second = repositories.rawListings.import({ ...capture, id: "raw-retry-request" });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record).toEqual(first.record);
    expect(repositories.rawListings.count()).toBe(1);
  });

  it("creates a new immutable snapshot when evidence changes", () => {
    repositories.rawListings.import(capture);
    const changed = repositories.rawListings.import({
      ...capture,
      id: "raw-repository-changed",
      rawText: "Changed sanitized synthetic repository fixture."
    });

    expect(changed.inserted).toBe(true);
    expect(repositories.rawListings.count()).toBe(2);
  });

  it("round-trips manual other-source capture fields and known/unknown provenance", () => {
    const manualRaw = repositories.rawListings.import({
      id: "raw-manual-repository-test",
      source: "other",
      sourceListingId: null,
      sourceUrl: "https://housing.example/listing/repository-test",
      captureMethod: "manual_structured",
      observedAt: now,
      sourcePostedAt: "2026-07-16T18:00:00.000Z",
      rawText: null,
      rawJson: {
        sanitized: true,
        title: "Synthetic manual listing",
        contactChannel: "website_form"
      },
      captureMetadata: { networkAccess: false, untrustedContent: true }
    }).record;
    const source = repositories.sourceRecords.insert({
      ...sourceRecord(manualRaw.id),
      id: "src-manual-repository-test",
      source: "other",
      sourceListingId: null,
      sourceUrl: manualRaw.sourceUrl,
      sourcePostedAt: manualRaw.sourcePostedAt,
      contactChannel: "website_form"
    });
    const known = repositories.fieldProvenance.insert({
      id: "prov-manual-title",
      listingSourceRecordId: source.id,
      rawListingId: manualRaw.id,
      fieldPath: "title",
      extractionMethod: "manual",
      valueStatus: "known",
      unknownReason: null,
      confidenceBasisPoints: 10_000,
      observedAt: now,
      evidenceExcerpt: "Synthetic manual listing"
    });
    const unknown = repositories.fieldProvenance.insert({
      id: "prov-manual-rent",
      listingSourceRecordId: source.id,
      rawListingId: manualRaw.id,
      fieldPath: "monthlyRentCents",
      extractionMethod: "rule",
      valueStatus: "unknown",
      unknownReason: "missing_evidence",
      confidenceBasisPoints: 0,
      observedAt: now,
      evidenceExcerpt: null
    });

    expect(repositories.sourceRecords.getByRawListingId(manualRaw.id)).toEqual(source);
    expect(source).toMatchObject({
      source: "other",
      sourcePostedAt: "2026-07-16T18:00:00.000Z",
      contactChannel: "website_form"
    });
    expect(repositories.fieldProvenance.listBySourceRecordId(source.id)).toEqual([unknown, known]);
  });

  it("round-trips source and canonical records and enforces lifecycle transitions", () => {
    const raw = repositories.rawListings.import(capture).record;
    const source = repositories.sourceRecords.insert(sourceRecord(raw.id));
    repositories.canonicalListings.insert(canonicalListing(source.id));
    repositories.canonicalListings.addSource({
      canonicalListingId: "can-repository-test",
      listingSourceRecordId: source.id,
      isPrimary: true
    });

    const shortlisted = repositories.canonicalListings.transitionLifecycle(
      "can-repository-test",
      "shortlisted",
      later
    );

    expect(shortlisted.lifecycleState).toBe("shortlisted");
    expect(repositories.sourceRecords.listByCanonicalListingId(shortlisted.id)).toEqual([source]);

    expect(() =>
      repositories.canonicalListings.transitionLifecycle(shortlisted.id, "toured", later)
    ).toThrow(InvalidListingTransitionError);
    expect(repositories.canonicalListings.getById(shortlisted.id)?.lifecycleState).toBe(
      "shortlisted"
    );
  });

  it("enforces append-only raw listings and activity events at both API and trigger layers", () => {
    const raw = repositories.rawListings.import(capture).record;
    const event = repositories.activityEvents.append(activityEvent());

    expect("update" in repositories.rawListings).toBe(false);
    expect("delete" in repositories.rawListings).toBe(false);
    expect("update" in repositories.activityEvents).toBe(false);
    expect("delete" in repositories.activityEvents).toBe(false);
    expect(() =>
      connection.sqlite
        .prepare("UPDATE raw_listings SET raw_text = ? WHERE id = ?")
        .run("changed", raw.id)
    ).toThrow(/append-only/u);
    expect(() =>
      connection.sqlite.prepare("DELETE FROM raw_listings WHERE id = ?").run(raw.id)
    ).toThrow(/append-only/u);
    expect(() =>
      connection.sqlite
        .prepare("UPDATE activity_events SET action = ? WHERE id = ?")
        .run("changed", event.id)
    ).toThrow(/append-only/u);
    expect(() =>
      connection.sqlite.prepare("DELETE FROM activity_events WHERE id = ?").run(event.id)
    ).toThrow(/append-only/u);
  });

  it("rolls back every repository write when a transaction fails", () => {
    expect(() =>
      repositories.transaction((transactionRepositories) => {
        transactionRepositories.rawListings.import(capture);
        transactionRepositories.activityEvents.append(activityEvent());
        throw new Error("rollback probe");
      })
    ).toThrow("rollback probe");

    expect(repositories.rawListings.count()).toBe(0);
    expect(repositories.activityEvents.count()).toBe(0);
  });

  it("rejects invalid foreign-key references", () => {
    expect(() => repositories.sourceRecords.insert(sourceRecord("raw-does-not-exist"))).toThrow(
      /FOREIGN KEY/u
    );
  });

  it("round-trips the remaining domain repository concepts", () => {
    const raw = repositories.rawListings.import(capture).record;
    const source = repositories.sourceRecords.insert(sourceRecord(raw.id));
    const canonical = repositories.canonicalListings.insert(canonicalListing(source.id));
    repositories.canonicalListings.addSource({
      canonicalListingId: canonical.id,
      listingSourceRecordId: source.id,
      isPrimary: true
    });

    const profile = repositories.searchProfiles.insert({
      id: "profile-repository-test",
      name: "Repository fixture profile",
      version: 1,
      locationText: "Harbor City",
      centerLatitude: null,
      centerLongitude: null,
      radiusKilometers: null,
      minimumBedrooms: 1,
      minimumBathrooms: 1,
      targetMonthlyTotalCents: 230_000,
      absoluteMonthlyMaximumCents: 260_000,
      moveInEarliest: null,
      moveInLatest: null,
      petRequirements: [],
      commuteAnchors: [],
      hardConstraints: [],
      weightedPreferences: [],
      notificationRules: { enabled: false, minimumScoreBasisPoints: null },
      createdAt: now,
      updatedAt: now
    });
    const photo = repositories.listingPhotos.insert({
      id: "photo-repository-test",
      listingSourceRecordId: source.id,
      sourceUrl: null,
      fixtureAssetLabel: "synthetic-repository-photo",
      byteHash: null,
      perceptualHash: null,
      position: 0,
      observedAt: now
    });
    const provenance = repositories.fieldProvenance.insert({
      id: "prov-repository-test-title",
      listingSourceRecordId: source.id,
      rawListingId: raw.id,
      fieldPath: "title",
      extractionMethod: "fixture_structured",
      valueStatus: "known",
      unknownReason: null,
      confidenceBasisPoints: 10_000,
      observedAt: now,
      evidenceExcerpt: null
    });
    repositories.canonicalListings.setFieldSource({
      canonicalListingId: canonical.id,
      fieldPath: "title",
      fieldProvenanceId: provenance.id
    });
    const score = repositories.listingScores.insert({
      id: "score-repository-test",
      canonicalListingId: canonical.id,
      searchProfileId: profile.id,
      algorithmVersion: "repository-fixture-v1",
      inputHash: hash,
      totalScoreBasisPoints: 7_500,
      factors: [],
      reasonCodes: ["fixture_only"],
      computedAt: now
    });
    const risk = repositories.riskSignals.insert({
      id: "risk-repository-test",
      canonicalListingId: canonical.id,
      code: "missing_fees",
      severity: "info",
      confidenceBasisPoints: 10_000,
      evidence: [
        {
          sourceRecordId: source.id,
          fieldPath: "recurringFeesCents",
          summary: "The synthetic fixture does not state recurring fees."
        }
      ],
      verificationAction: "Verify recurring fees before deciding.",
      status: "open",
      createdAt: now,
      updatedAt: now
    });
    const workflow = repositories.contactWorkflows.insert({
      id: "workflow-repository-test",
      canonicalListingId: canonical.id,
      channel: "manual",
      recipientReference: null,
      missingFactQuestions: ["Which recurring fees apply?"],
      draftReference: null,
      state: "questions_ready",
      createdAt: now,
      updatedAt: now
    });
    const approval = repositories.approvals.insert({
      id: "approval-repository-test",
      actor: "user",
      connectorId: "fixture-only",
      operation: "fixture.review",
      targetType: "canonical_listing",
      targetId: canonical.id,
      payloadHash: hash,
      state: "pending",
      createdAt: now,
      expiresAt: "2026-07-17T12:15:00.000Z",
      usedAt: null
    });
    const viewing = repositories.viewings.insert({
      id: "viewing-repository-test",
      canonicalListingId: canonical.id,
      proposedWindows: [{ startsAt: now, endsAt: "2026-07-17T12:15:00.000Z" }],
      confirmedWindow: null,
      timeZone: "America/New_York",
      calendarReference: null,
      state: "proposed",
      notes: null,
      metadata: {},
      createdAt: now,
      updatedAt: now
    });
    const manifest = repositories.sourcePolicyManifests.insert({
      schemaVersion: 1,
      connectorId: "fixture-label-craigslist",
      displayName: "Sanitized Craigslist fixture label",
      version: 1,
      source: "craigslist",
      enabled: false,
      execution: "manual",
      capabilities: [],
      allowedOperations: [],
      allowedDomains: [],
      allowedOrigins: [],
      allowedHttpMethods: [],
      requiresUserSession: true,
      requiresApproval: true,
      minimumIntervalSeconds: null,
      maxConcurrency: 1,
      globalKillSwitchKey: "integrations.disabled",
      connectorKillSwitchKey: "connectors.fixture-label-craigslist.disabled",
      dataClassification: "synthetic",
      redactionRules: [
        "raw_content_from_logs",
        "full_urls_from_logs",
        "contact_details_from_logs",
        "credentials_from_logs"
      ],
      manualBlockerBehavior: "stop_and_request_user_action",
      owner: "Vera maintainers",
      reviewedAt: "2026-07-17",
      decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
      notes: "Fixture label only; no connector capability is enabled.",
      createdAt: now,
      updatedAt: now
    });
    const manifestVersionTwo = repositories.sourcePolicyManifests.insert({
      ...manifest,
      version: 2,
      updatedAt: later
    });

    expect(repositories.searchProfiles.getById(profile.id)).toEqual(profile);
    expect(repositories.listingPhotos.getById(photo.id)).toEqual(photo);
    expect(repositories.fieldProvenance.getById(provenance.id)).toEqual(provenance);
    expect(repositories.canonicalListings.fieldSelectionCount()).toBe(1);
    expect(repositories.listingScores.getById(score.id)).toEqual(score);
    expect(repositories.riskSignals.getById(risk.id)).toEqual(risk);
    expect(repositories.contactWorkflows.getById(workflow.id)).toEqual(workflow);
    expect(repositories.approvals.getById(approval.id)).toEqual(approval);
    expect(repositories.viewings.getById(viewing.id)).toEqual(viewing);
    expect(repositories.sourcePolicyManifests.get(manifest.connectorId, manifest.version)).toEqual(
      manifest
    );
    expect(repositories.sourcePolicyManifests.list()).toEqual([manifestVersionTwo, manifest]);
    expect(repositories.sourcePolicyManifests.listLatest()).toEqual([manifestVersionTwo]);
  });
});
