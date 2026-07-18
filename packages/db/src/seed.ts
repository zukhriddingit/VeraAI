import {
  FieldProvenanceSchema,
  JsonValueSchema,
  type ActivityEvent,
  type CanonicalFieldSource,
  type FieldProvenance
} from "@vera/domain";

import {
  CANONICAL_FIXTURES,
  DEMO_RISK_FIXTURES,
  DEMO_SCORE_FIXTURES,
  DEMO_SEARCH_PROFILE,
  DUPLICATE_CLUSTER_FIXTURES,
  SOURCE_POLICY_MANIFEST_FIXTURES,
  SOURCE_FIXTURES,
  normalizedFactEntries
} from "./fixtures.ts";
import { canonicalJson, sha256Text } from "./hashing.ts";
import type { VeraRepositories } from "./repositories.ts";

export interface SeedResult {
  readonly searchProfiles: number;
  readonly rawListings: number;
  readonly sourceRecords: number;
  readonly canonicalListings: number;
  readonly duplicateClusters: number;
  readonly sourceMemberships: number;
  readonly fieldProvenance: number;
  readonly canonicalFieldSelections: number;
  readonly activityEvents: number;
  readonly listingScores: number;
  readonly riskSignals: number;
}

function assertFixtureMatch(label: string, expected: unknown, actual: unknown): void {
  const expectedJson = canonicalJson(JsonValueSchema.parse(expected));
  const actualJson = canonicalJson(JsonValueSchema.parse(actual));

  if (expectedJson !== actualJson) {
    throw new Error(`${label} already exists with data that does not match the sanitized seed.`);
  }
}

function ensureProvenance(
  repositories: VeraRepositories,
  provenance: FieldProvenance
): FieldProvenance {
  const existing = repositories.fieldProvenance.getById(provenance.id);

  if (existing) {
    assertFixtureMatch(`FieldProvenance ${provenance.id}`, provenance, existing);
    return existing;
  }

  return repositories.fieldProvenance.insert(FieldProvenanceSchema.parse(provenance));
}

function seedActivityEvent(): ActivityEvent {
  const seedShape = {
    fixtureVersion: 1,
    rawListings: SOURCE_FIXTURES.length,
    sourceRecords: SOURCE_FIXTURES.length,
    canonicalListings: CANONICAL_FIXTURES.length,
    duplicateClusters: DUPLICATE_CLUSTER_FIXTURES.length,
    sanitized: true
  };

  return {
    id: "event-seed-v1-completed",
    correlationId: "correlation-seed-v1",
    causationId: null,
    actor: "system",
    action: "seed.completed",
    targetType: "database",
    targetId: "vera-local",
    policyDecision: "not_applicable",
    approvalId: null,
    payloadHash: sha256Text(`seed:v1:${canonicalJson(seedShape)}`),
    outcome: "succeeded",
    errorCategory: null,
    metadata: seedShape,
    occurredAt: "2026-07-17T12:20:00.000Z"
  };
}

export function seedDatabase(repositories: VeraRepositories): SeedResult {
  return repositories.transaction((transactionRepositories) => {
    const existingProfile = transactionRepositories.searchProfiles.getById(DEMO_SEARCH_PROFILE.id);
    if (existingProfile) {
      assertFixtureMatch(
        `SearchProfile ${DEMO_SEARCH_PROFILE.id}`,
        DEMO_SEARCH_PROFILE,
        existingProfile
      );
    } else {
      transactionRepositories.searchProfiles.insert(DEMO_SEARCH_PROFILE);
    }

    for (const fixture of SOURCE_FIXTURES) {
      const imported = transactionRepositories.rawListings.import(fixture.capture);

      if (imported.record.id !== fixture.capture.id) {
        throw new Error(
          `Raw fixture ${fixture.capture.id} resolved to unexpected record ${imported.record.id}.`
        );
      }

      const existingSource = transactionRepositories.sourceRecords.getById(fixture.sourceRecord.id);

      if (existingSource) {
        assertFixtureMatch(
          `ListingSourceRecord ${fixture.sourceRecord.id}`,
          fixture.sourceRecord,
          existingSource
        );
      } else {
        transactionRepositories.sourceRecords.insert(fixture.sourceRecord);
      }

      for (const [fieldPath] of normalizedFactEntries(fixture.sourceRecord)) {
        ensureProvenance(transactionRepositories, {
          id: `prov:${fixture.sourceRecord.id}:${fieldPath}`,
          listingSourceRecordId: fixture.sourceRecord.id,
          rawListingId: fixture.sourceRecord.rawListingId,
          fieldPath,
          extractionMethod: "fixture_structured",
          confidenceBasisPoints: fixture.sourceRecord.extractionConfidenceBasisPoints,
          valueStatus: "known",
          unknownReason: null,
          observedAt: fixture.sourceRecord.observedAt,
          evidenceExcerpt: null
        });
      }
    }

    for (const manifest of SOURCE_POLICY_MANIFEST_FIXTURES) {
      const existing = transactionRepositories.sourcePolicyManifests.get(
        manifest.connectorId,
        manifest.version
      );

      if (existing) {
        assertFixtureMatch(`SourcePolicyManifest ${manifest.connectorId}`, manifest, existing);
      } else {
        transactionRepositories.sourcePolicyManifests.insert(manifest);
      }
    }

    for (const cluster of DUPLICATE_CLUSTER_FIXTURES) {
      transactionRepositories.duplicateClusters.insert(cluster);
    }

    for (const fixture of CANONICAL_FIXTURES) {
      const existing = transactionRepositories.canonicalListings.getById(fixture.listing.id);

      if (existing) {
        assertFixtureMatch(`CanonicalListing ${fixture.listing.id}`, fixture.listing, existing);
      } else {
        transactionRepositories.canonicalListings.insert(fixture.listing);
      }

      for (const sourceRecordId of fixture.memberSourceRecordIds) {
        transactionRepositories.canonicalListings.addSource({
          canonicalListingId: fixture.listing.id,
          listingSourceRecordId: sourceRecordId,
          isPrimary: sourceRecordId === fixture.listing.primarySourceRecordId
        });
      }

      for (const [fieldPath] of normalizedFactEntries(fixture.listing)) {
        const sourceRecordId =
          fixture.selectedSourceRecordByField[fieldPath] ?? fixture.listing.primarySourceRecordId;
        const selection: CanonicalFieldSource = {
          canonicalListingId: fixture.listing.id,
          fieldPath,
          fieldProvenanceId: `prov:${sourceRecordId}:${fieldPath}`
        };

        if (!transactionRepositories.fieldProvenance.getById(selection.fieldProvenanceId)) {
          throw new Error(
            `Canonical field ${fixture.listing.id}.${fieldPath} has no source provenance.`
          );
        }

        transactionRepositories.canonicalListings.setFieldSource(selection);
      }
    }

    for (const score of DEMO_SCORE_FIXTURES) {
      const existing = transactionRepositories.listingScores.getById(score.id);
      if (existing) {
        assertFixtureMatch(`ListingScore ${score.id}`, score, existing);
      } else {
        transactionRepositories.listingScores.insert(score);
      }
    }

    for (const signal of DEMO_RISK_FIXTURES) {
      const existing = transactionRepositories.riskSignals.getById(signal.id);
      if (existing) {
        assertFixtureMatch(`RiskSignal ${signal.id}`, signal, existing);
      } else {
        transactionRepositories.riskSignals.insert(signal);
      }
    }

    const event = seedActivityEvent();
    const existingEvent = transactionRepositories.activityEvents.getById(event.id);

    if (existingEvent) {
      assertFixtureMatch(`ActivityEvent ${event.id}`, event, existingEvent);
    } else {
      transactionRepositories.activityEvents.append(event);
    }

    return {
      searchProfiles: transactionRepositories.searchProfiles.count(),
      rawListings: transactionRepositories.rawListings.count(),
      sourceRecords: transactionRepositories.sourceRecords.count(),
      canonicalListings: transactionRepositories.canonicalListings.count(),
      duplicateClusters: transactionRepositories.duplicateClusters.count(),
      sourceMemberships: transactionRepositories.canonicalListings.sourceMembershipCount(),
      fieldProvenance: transactionRepositories.fieldProvenance.count(),
      canonicalFieldSelections: transactionRepositories.canonicalListings.fieldSelectionCount(),
      activityEvents: transactionRepositories.activityEvents.count(),
      listingScores: transactionRepositories.listingScores.count(),
      riskSignals: transactionRepositories.riskSignals.count()
    };
  });
}
