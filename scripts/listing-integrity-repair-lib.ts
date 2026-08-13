import {
  DecisionCorpusSnapshotSchema,
  EntityIdSchema,
  ListingIntegrityRepairCountsSchema,
  ListingIntegrityRepairInputSchema,
  ListingIntegrityRepairPreviewSchema,
  ListingIntegrityVisibleMetricsSchema,
  ListingSourceRecordDispositionEventSchema,
  VeraUserIdSchema,
  type DecisionCorpusSnapshot,
  type ListingIntegrityRepairCounts,
  type ListingIntegrityRepairInput,
  type ListingIntegrityRepairPreview,
  type ListingIntegrityVisibleMetrics,
  type ListingSourceRecord,
  type ListingSourceRecordDispositionEvent
} from "@vera/domain";
import { canonicalJson, sha256Text } from "@vera/db";

export {
  ListingIntegrityRepairCountsSchema,
  ListingIntegrityRepairInputSchema,
  ListingIntegrityRepairPreviewSchema,
  ListingIntegrityVisibleMetricsSchema
};
export type {
  ListingIntegrityRepairCounts,
  ListingIntegrityRepairInput,
  ListingIntegrityRepairPreview,
  ListingIntegrityVisibleMetrics
};

export function filterDecisionSnapshot(
  input: DecisionCorpusSnapshot,
  invalidSourceRecordIds: readonly string[]
): DecisionCorpusSnapshot {
  const snapshot = DecisionCorpusSnapshotSchema.parse(input);
  const invalid = new Set(invalidSourceRecordIds.map((id) => EntityIdSchema.parse(id)));
  const sourceRecords = snapshot.sourceRecords.filter(
    ({ sourceRecordId }) => !invalid.has(sourceRecordId)
  );
  const eligible = new Set(sourceRecords.map(({ sourceRecordId }) => sourceRecordId));
  const priorCanonicals = snapshot.priorCanonicals.flatMap((canonical) => {
    const memberSourceRecordIds = canonical.memberSourceRecordIds.filter((id) => eligible.has(id));
    if (memberSourceRecordIds.length === 0) return [];
    return [
      {
        ...canonical,
        memberSourceRecordIds,
        primarySourceRecordId: memberSourceRecordIds.includes(canonical.primarySourceRecordId)
          ? canonical.primarySourceRecordId
          : memberSourceRecordIds[0]!
      }
    ];
  });
  return DecisionCorpusSnapshotSchema.parse({ ...snapshot, sourceRecords, priorCanonicals });
}

export function computeRepairCorpusHash(
  snapshot: DecisionCorpusSnapshot,
  currentDispositions: readonly ListingSourceRecordDispositionEvent[]
): string {
  return sha256Text(
    canonicalJson({
      snapshot: DecisionCorpusSnapshotSchema.parse(snapshot),
      currentDispositions: [...currentDispositions].sort((left, right) =>
        left.listingSourceRecordId.localeCompare(right.listingSourceRecordId)
      )
    })
  );
}

export function createInvalidDisposition(input: {
  readonly userId: string;
  readonly record: ListingSourceRecord;
  readonly observedAt: string;
  readonly reasonCode: string;
}): ListingSourceRecordDispositionEvent {
  const userId = VeraUserIdSchema.parse(input.userId);
  const sourceUrl = input.record.sourceUrl;
  if (sourceUrl === null) throw new Error("A non-listing disposition requires an observed URL.");
  const payloadHash = sha256Text(
    canonicalJson({
      version: "listing-source-record-disposition.v1",
      userId,
      listingSourceRecordId: input.record.id,
      disposition: "invalid_non_listing",
      reasonCode: input.reasonCode,
      observedUrl: sourceUrl
    })
  );
  return ListingSourceRecordDispositionEventSchema.parse({
    id: `source-disposition:${payloadHash.slice(0, 40)}`,
    listingSourceRecordId: input.record.id,
    disposition: "invalid_non_listing",
    reasonCode: input.reasonCode,
    evidence: { observedUrl: sourceUrl, classification: "non_listing" },
    payloadHash,
    actor: "founder",
    observedAt: input.observedAt
  });
}

export function assertPredictedRelationships(
  predicted: readonly {
    readonly canonicalListingId: string;
    readonly memberSourceRecordIds: readonly string[];
  }[],
  repairInput: ListingIntegrityRepairInput
): void {
  const canonicalBySource = new Map<string, string>();
  for (const canonical of predicted) {
    for (const sourceRecordId of canonical.memberSourceRecordIds) {
      canonicalBySource.set(sourceRecordId, canonical.canonicalListingId);
    }
  }
  for (const [left, right] of repairInput.assertSeparatedPairs) {
    const leftCanonical = canonicalBySource.get(left);
    const rightCanonical = canonicalBySource.get(right);
    if (!leftCanonical || !rightCanonical || leftCanonical === rightCanonical) {
      throw new Error(`Repair preview did not separate ${left} and ${right}.`);
    }
  }
  for (const group of repairInput.assertJoinedGroups) {
    const canonicalIds = new Set(group.map((id) => canonicalBySource.get(id)));
    if (canonicalIds.has(undefined) || canonicalIds.size !== 1) {
      throw new Error(`Repair preview did not preserve joined group ${group.join(",")}.`);
    }
  }
}
