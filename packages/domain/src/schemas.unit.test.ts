import { describe, expect, it } from "vitest";

import {
  ActivityEventSchema,
  ApprovalSchema,
  CanonicalListingSchema,
  ContactWorkflowSchema,
  DuplicateClusterSchema,
  FieldProvenanceSchema,
  ListingCaptureMethodSchema,
  ListingExtractionFieldNameSchema,
  ListingExtractionSchema,
  ListingPhotoSchema,
  ListingScoreSchema,
  ListingSourceLabelSchema,
  ListingSourceRecordSchema,
  RawListingSchema,
  RiskSignalSchema,
  SearchProfileSchema,
  SourcePolicyManifestSchema,
  ViewingSchema
} from "./index.ts";

const now = "2026-07-17T12:00:00.000Z";
const later = "2026-07-17T12:15:00.000Z";
const hash = "a".repeat(64);

const viewingWindow = {
  startsAt: now,
  endsAt: later,
  timeZone: "America/New_York",
  availabilitySource: "vera_rules_only",
  state: "vera_rules_only",
  availabilityCheckId: null,
  checkedAt: null,
  calendarsChecked: [],
  requiresConflictWarning: true,
  rules: {
    timeZone: "America/New_York",
    weeklyIntervals: {
      "1": [{ startsAt: "08:00", endsAt: "12:00" }],
      "2": [],
      "3": [],
      "4": [],
      "5": [],
      "6": [],
      "7": []
    },
    durationMinutes: 15,
    minimumNoticeMinutes: 0,
    travelMinutes: 0,
    bufferMinutes: 0,
    remindersMinutesBeforeStart: [],
    conflictCheckingEnabled: false,
    calendarIds: [],
    schemaVersion: 1
  },
  generatorVersion: "availability.v1"
} as const;

const address = {
  line1: "101 Juniper Row",
  unit: "1A",
  city: "Harbor City",
  region: "MA",
  postalCode: "02100",
  countryCode: "US"
} as const;

const petPolicy = {
  cats: "allowed",
  dogs: "unknown",
  notes: null
} as const;

const validRawListing = {
  id: "raw-zillow-juniper",
  source: "zillow",
  acquisitionMode: "fixture",
  sourceListingId: "fixture-z-001",
  sourceUrl: "https://example.invalid/fixtures/zillow/juniper",
  captureMethod: "fixture",
  observedAt: now,
  sourcePostedAt: null,
  rawText: "Sanitized synthetic fixture.",
  rawJson: null,
  captureMetadata: { fixture: true },
  contentHash: hash,
  idempotencyKey: hash,
  createdAt: now
} as const;

const validSourceRecord = {
  id: "src-zillow-juniper",
  rawListingId: validRawListing.id,
  source: "zillow",
  sourceListingId: validRawListing.sourceListingId,
  sourceUrl: validRawListing.sourceUrl,
  sourcePostedAt: null,
  contactChannel: "unknown",
  title: "Juniper Row apartment",
  address,
  monthlyRentCents: 245_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 680,
  propertyType: "apartment",
  availableOn: "2026-09-01",
  leaseTermMonths: 12,
  petPolicy,
  amenities: ["Laundry"],
  description: "Synthetic one-bedroom fixture.",
  extractionConfidenceBasisPoints: 10_000,
  completenessBasisPoints: 9_000,
  observedAt: now,
  createdAt: now
} as const;

const validCanonicalListing = {
  id: "can-juniper-1a",
  duplicateClusterId: "cluster-juniper",
  primarySourceRecordId: validSourceRecord.id,
  title: validSourceRecord.title,
  address,
  monthlyRentCents: validSourceRecord.monthlyRentCents,
  recurringFeesCents: validSourceRecord.recurringFeesCents,
  bedrooms: validSourceRecord.bedrooms,
  bathrooms: validSourceRecord.bathrooms,
  squareFeet: validSourceRecord.squareFeet,
  propertyType: validSourceRecord.propertyType,
  availableOn: validSourceRecord.availableOn,
  leaseTermMonths: validSourceRecord.leaseTermMonths,
  petPolicy,
  amenities: validSourceRecord.amenities,
  description: validSourceRecord.description,
  lifecycleState: "new",
  completenessBasisPoints: 9_000,
  freshestObservedAt: now,
  createdAt: now,
  updatedAt: now
} as const;

describe("strict Vera domain schemas", () => {
  it("accepts representative values for every required concept", () => {
    expect(
      SearchProfileSchema.parse({
        id: "profile-primary",
        name: "Primary search",
        version: 1,
        locationText: "Harbor City",
        centerLatitude: null,
        centerLongitude: null,
        radiusKilometers: null,
        minimumBedrooms: 1,
        minimumBathrooms: 1,
        targetMonthlyTotalCents: 250_000,
        absoluteMonthlyMaximumCents: 280_000,
        moveInEarliest: "2026-08-01",
        moveInLatest: "2026-09-15",
        petRequirements: [{ animal: "cat", required: true, notes: null }],
        commuteAnchors: [],
        hardConstraints: [],
        weightedPreferences: [],
        notificationRules: { enabled: true, minimumScoreBasisPoints: 7_500 },
        createdAt: now,
        updatedAt: now
      }).id
    ).toBe("profile-primary");

    expect(RawListingSchema.parse(validRawListing).id).toBe(validRawListing.id);
    expect(ListingSourceRecordSchema.parse(validSourceRecord).id).toBe(validSourceRecord.id);
    expect(CanonicalListingSchema.parse(validCanonicalListing).id).toBe(validCanonicalListing.id);

    expect(
      ListingPhotoSchema.parse({
        id: "photo-juniper-1",
        listingSourceRecordId: validSourceRecord.id,
        sourceUrl: null,
        fixtureAssetLabel: "synthetic-juniper-exterior",
        byteHash: null,
        perceptualHash: null,
        position: 0,
        observedAt: now
      }).position
    ).toBe(0);

    expect(
      ListingPhotoSchema.parse({
        id: "photo-juniper-decoded",
        listingSourceRecordId: validSourceRecord.id,
        sourceUrl: null,
        fixtureAssetLabel: "synthetic-juniper-decoded",
        byteHash: hash,
        byteSize: 1_024,
        width: 640,
        height: 480,
        mimeType: "image/png",
        perceptualHash: "0123456789abcdef",
        perceptualHashVersion: "listing-photo.dhash64.v1",
        position: 1,
        observedAt: now
      }).perceptualHashVersion
    ).toBe("listing-photo.dhash64.v1");

    expect(
      FieldProvenanceSchema.parse({
        id: "prov-juniper-rent",
        listingSourceRecordId: validSourceRecord.id,
        rawListingId: validRawListing.id,
        fieldPath: "monthlyRentCents",
        extractionMethod: "fixture_structured",
        valueStatus: "known",
        unknownReason: null,
        confidenceBasisPoints: 10_000,
        observedAt: now,
        evidenceExcerpt: null
      }).fieldPath
    ).toBe("monthlyRentCents");

    expect(
      DuplicateClusterSchema.parse({
        id: "cluster-juniper",
        clusterKey: hash,
        algorithmVersion: "fixture-v1",
        reasonCodes: ["fixture_declared_duplicate"],
        memberSourceRecordIds: [validSourceRecord.id, "src-craigslist-juniper"],
        createdAt: now
      }).memberSourceRecordIds
    ).toHaveLength(2);

    expect(
      ListingScoreSchema.parse({
        id: "score-juniper-v1",
        canonicalListingId: validCanonicalListing.id,
        searchProfileId: null,
        algorithmVersion: "fixture-v1",
        inputHash: hash,
        totalScoreBasisPoints: 8_000,
        factors: [],
        reasonCodes: ["fixture_only"],
        computedAt: now
      }).totalScoreBasisPoints
    ).toBe(8_000);

    expect(
      RiskSignalSchema.parse({
        id: "risk-juniper-missing-fees",
        canonicalListingId: validCanonicalListing.id,
        code: "fees_unknown",
        severity: "info",
        confidenceBasisPoints: 10_000,
        evidence: [
          {
            sourceRecordId: validSourceRecord.id,
            fieldPath: "recurringFeesCents",
            summary: "The fixture does not state recurring fees."
          }
        ],
        verificationAction: "Ask which recurring fees are required.",
        status: "open",
        createdAt: now,
        updatedAt: now
      }).code
    ).toBe("fees_unknown");

    expect(
      ContactWorkflowSchema.parse({
        id: "contact-juniper",
        canonicalListingId: validCanonicalListing.id,
        channel: "manual",
        recipientReference: null,
        missingFactQuestions: ["Which fees are required?"],
        draftReference: null,
        state: "questions_ready",
        createdAt: now,
        updatedAt: now
      }).state
    ).toBe("questions_ready");

    expect(
      ApprovalSchema.parse({
        id: "approval-juniper",
        actor: "user",
        connectorId: "fixture-only",
        operation: "fixture.review",
        targetType: "canonical_listing",
        targetId: validCanonicalListing.id,
        payloadHash: hash,
        state: "pending",
        createdAt: now,
        expiresAt: later,
        usedAt: null
      }).state
    ).toBe("pending");

    expect(
      ViewingSchema.parse({
        id: "viewing-juniper",
        canonicalListingId: validCanonicalListing.id,
        proposedWindows: [viewingWindow],
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone: "America/New_York",
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: {},
        createdAt: now,
        updatedAt: now
      }).state
    ).toBe("proposed");

    expect(
      ActivityEventSchema.parse({
        id: "event-seed-completed",
        correlationId: "correlation-seed-v1",
        causationId: null,
        actor: "system",
        action: "seed.completed",
        targetType: "database",
        targetId: "vera-local",
        policyDecision: "not_applicable",
        approvalId: null,
        payloadHash: hash,
        outcome: "succeeded",
        errorCategory: null,
        metadata: { sanitized: true },
        occurredAt: now
      }).action
    ).toBe("seed.completed");

    expect(
      SourcePolicyManifestSchema.parse({
        schemaVersion: 2,
        connectorId: "zillow.disabled.v1",
        displayName: "Disabled Zillow connector",
        version: 1,
        source: "zillow",
        acquisitionMode: "local_browser",
        policyState: "disabled",
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
        connectorKillSwitchKey: "connectors.zillow.disabled",
        dataClassification: "third_party",
        redactionRules: ["raw_content_from_logs"],
        manualBlockerBehavior: "stop_and_request_user_action",
        owner: "Vera maintainers",
        reviewedAt: "2026-07-17",
        decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
        notes: "Fixture label only. No platform capability is enabled.",
        createdAt: now,
        updatedAt: now
      }).enabled
    ).toBe(false);
  });

  it("rejects unknown fields and invalid boundary values", () => {
    expect(() => RawListingSchema.parse({ ...validRawListing, unexpected: true })).toThrow();
    expect(() =>
      FieldProvenanceSchema.parse({
        id: "prov-invalid",
        listingSourceRecordId: validSourceRecord.id,
        rawListingId: validRawListing.id,
        fieldPath: "monthlyRentCents",
        extractionMethod: "fixture_structured",
        valueStatus: "known",
        unknownReason: null,
        confidenceBasisPoints: 10_001,
        observedAt: now,
        evidenceExcerpt: null
      })
    ).toThrow();
    expect(() =>
      CanonicalListingSchema.parse({ ...validCanonicalListing, monthlyRentCents: -1 })
    ).toThrow();
    expect(() =>
      RawListingSchema.parse({ ...validRawListing, rawText: null, rawJson: null })
    ).toThrow();
    expect(() =>
      RawListingSchema.parse({ ...validRawListing, acquisitionMode: "official_api" })
    ).toThrow();
  });

  it("preserves unknown listing facts as null", () => {
    const parsed = ListingSourceRecordSchema.parse({
      ...validSourceRecord,
      monthlyRentCents: null,
      bathrooms: null,
      petPolicy: null
    });

    expect(parsed.monthlyRentCents).toBeNull();
    expect(parsed.bathrooms).toBeNull();
    expect(parsed.petPolicy).toBeNull();
  });

  it("keeps coordinate, photo-metadata, and canonical-projection state internally consistent", () => {
    expect(() =>
      ListingSourceRecordSchema.parse({ ...validSourceRecord, latitude: 42.36, longitude: null })
    ).toThrow(/coordinates/iu);
    expect(() =>
      ListingPhotoSchema.parse({
        id: "photo-partial-metadata",
        listingSourceRecordId: validSourceRecord.id,
        sourceUrl: null,
        fixtureAssetLabel: "synthetic-partial",
        byteHash: hash,
        byteSize: 100,
        perceptualHash: null,
        position: 0,
        observedAt: now
      })
    ).toThrow(/metadata/iu);
    expect(() =>
      CanonicalListingSchema.parse({
        ...validCanonicalListing,
        projectionState: "superseded",
        supersededById: null
      })
    ).toThrow(/survivor/iu);
  });

  it("supports manual captures and an explicit other source label", () => {
    expect(ListingSourceLabelSchema.parse("other")).toBe("other");
    expect(ListingCaptureMethodSchema.parse("manual_text")).toBe("manual_text");
    expect(ListingCaptureMethodSchema.parse("manual_structured")).toBe("manual_structured");
    expect(ListingCaptureMethodSchema.parse("official_api")).toBe("official_api");
    expect(ListingCaptureMethodSchema.parse("email_alert")).toBe("email_alert");
    expect(ListingCaptureMethodSchema.parse("local_browser")).toBe("local_browser");
  });

  it.each([
    ["fixture", "fixture"],
    ["manual_text", "user_capture"],
    ["manual_structured", "user_capture"],
    ["official_api", "official_api"],
    ["email_alert", "email_alert"],
    ["local_browser", "local_browser"]
  ] as const)("requires %s captures to use %s acquisition", (captureMethod, acquisitionMode) => {
    expect(
      RawListingSchema.parse({
        ...validRawListing,
        captureMethod,
        acquisitionMode
      })
    ).toMatchObject({ captureMethod, acquisitionMode });

    expect(() =>
      RawListingSchema.parse({
        ...validRawListing,
        captureMethod,
        acquisitionMode: acquisitionMode === "fixture" ? "official_api" : "fixture"
      })
    ).toThrow();
  });

  it("bounds serialized raw JSON evidence before persistence", () => {
    expect(() =>
      RawListingSchema.parse({
        ...validRawListing,
        rawText: null,
        rawJson: { oversized: "é".repeat(125_001) }
      })
    ).toThrow(/serialized bytes/iu);
  });

  it("enforces known and unknown field provenance", () => {
    const base = {
      id: "prov-juniper-bathrooms",
      listingSourceRecordId: validSourceRecord.id,
      rawListingId: validRawListing.id,
      fieldPath: "bathrooms",
      extractionMethod: "rule",
      observedAt: now
    } as const;

    expect(
      FieldProvenanceSchema.parse({
        ...base,
        valueStatus: "unknown",
        unknownReason: "missing_evidence",
        confidenceBasisPoints: 0,
        evidenceExcerpt: null
      }).valueStatus
    ).toBe("unknown");

    expect(() =>
      FieldProvenanceSchema.parse({
        ...base,
        valueStatus: "unknown",
        unknownReason: null,
        confidenceBasisPoints: 0,
        evidenceExcerpt: null
      })
    ).toThrow();
    expect(() =>
      FieldProvenanceSchema.parse({
        ...base,
        valueStatus: "unknown",
        unknownReason: "missing_evidence",
        confidenceBasisPoints: 1,
        evidenceExcerpt: null
      })
    ).toThrow();
    expect(() =>
      FieldProvenanceSchema.parse({
        ...base,
        valueStatus: "known",
        unknownReason: "missing_evidence",
        confidenceBasisPoints: 9_000,
        evidenceExcerpt: "1 bath"
      })
    ).toThrow();
  });

  it("keeps source manifests strict, closed, and schedulable only with a rate limit", () => {
    const manifest = {
      schemaVersion: 2,
      connectorId: "structured-feed.v1",
      displayName: "Structured feed",
      version: 1,
      source: "other",
      acquisitionMode: "official_api",
      policyState: "disabled",
      enabled: false,
      execution: "scheduled",
      capabilities: ["structured_feed.read"],
      allowedOperations: ["feed.read"],
      allowedDomains: ["feed.example"],
      allowedOrigins: ["https://feed.example/"],
      allowedHttpMethods: ["GET"],
      requiresUserSession: false,
      requiresApproval: false,
      minimumIntervalSeconds: 900,
      maxConcurrency: 1,
      globalKillSwitchKey: "integrations.disabled",
      connectorKillSwitchKey: "connectors.structured-feed.disabled",
      dataClassification: "third_party",
      redactionRules: ["raw_content_from_logs"],
      manualBlockerBehavior: "stop_and_request_user_action",
      owner: "Vera maintainers",
      reviewedAt: "2026-07-17",
      decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
      notes: "Disabled pending a separate source review.",
      createdAt: now,
      updatedAt: now
    } as const;

    expect(SourcePolicyManifestSchema.parse(manifest).schemaVersion).toBe(2);
    expect(() =>
      SourcePolicyManifestSchema.parse({ ...manifest, capabilities: ["arbitrary.fetch"] })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({ ...manifest, minimumIntervalSeconds: null })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({ ...manifest, allowedDomains: ["localhost"] })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({
        ...manifest,
        allowedOperations: ["feed.read", "feed.read"]
      })
    ).toThrow();
    expect(() => SourcePolicyManifestSchema.parse({ ...manifest, unexpected: true })).toThrow();
  });

  it("keeps policy state independent while enforcing its fail-closed ceiling", () => {
    const base = {
      schemaVersion: 2,
      connectorId: "policy-test.v1",
      displayName: "Policy test",
      version: 1,
      source: "other",
      acquisitionMode: "official_api",
      policyState: "approved",
      enabled: true,
      execution: "manual",
      capabilities: ["structured_feed.read"],
      allowedOperations: ["feed.read"],
      allowedDomains: [],
      allowedOrigins: [],
      allowedHttpMethods: [],
      requiresUserSession: false,
      requiresApproval: false,
      minimumIntervalSeconds: null,
      maxConcurrency: 1,
      globalKillSwitchKey: "integrations.disabled",
      connectorKillSwitchKey: "connectors.policy-test.disabled",
      dataClassification: "third_party",
      redactionRules: ["raw_content_from_logs"],
      manualBlockerBehavior: "stop_and_request_user_action",
      owner: "Vera maintainers",
      reviewedAt: "2026-07-18",
      decisionRecord: "docs/DECISIONS/0007-maritime-openclaw-contract-boundaries.md",
      notes: "Strict synthetic policy test only.",
      createdAt: now,
      updatedAt: now
    } as const;

    expect(SourcePolicyManifestSchema.parse(base).policyState).toBe("approved");
    expect(() =>
      SourcePolicyManifestSchema.parse({ ...base, policyState: "disabled", enabled: true })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({
        ...base,
        policyState: "user_triggered_only",
        execution: "scheduled",
        minimumIntervalSeconds: 900
      })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({
        ...base,
        policyState: "experimental_personal",
        acquisitionMode: "official_api"
      })
    ).toThrow();
    expect(() =>
      SourcePolicyManifestSchema.parse({
        ...base,
        acquisitionMode: "fixture",
        dataClassification: "third_party"
      })
    ).toThrow();
  });

  it("exports the complete extraction boundary with explicit unknown values", () => {
    const unknownField = {
      status: "unknown",
      value: null,
      confidenceBasisPoints: 0,
      evidenceSnippet: null,
      reason: "not_present"
    } as const;
    const unknownExtraction = Object.fromEntries(
      ListingExtractionFieldNameSchema.options.map((field) => [field, unknownField])
    );

    const parsed = ListingExtractionSchema.parse(unknownExtraction);
    expect(Object.keys(parsed)).toHaveLength(20);
    expect(parsed.baseRent.status).toBe("unknown");
    expect(parsed.contactEmail.status).toBe("unknown");
  });
});
