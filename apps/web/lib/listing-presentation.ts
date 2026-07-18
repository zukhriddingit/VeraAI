import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Text, type VeraRepositories } from "@vera/db/runtime";
import {
  ActivityEventSchema,
  ActivityPresentationSchema,
  CanonicalListingDetailResponseSchema,
  EntityIdSchema,
  ShortlistResponseSchema,
  type ActivityEvent,
  type ActivityPresentation,
  type CanonicalListingDetailResponse,
  type ShortlistResponse
} from "@vera/domain";

const sourceNames = {
  zillow: "Zillow",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  apartments_com: "Apartments.com",
  other: "Other"
} as const;

function safeActivityDetail(event: ActivityEvent): string | null {
  switch (event.action) {
    case "demo.search.completed":
      return "Sanitized fixture search completed with 12 records, 8 homes, and 3 duplicate clusters.";
    case "capture.policy_authorized":
      return "The configured source policy authorized this sanitized capture.";
    case "capture.policy_denied":
      return "Source policy denied the requested capture.";
    case "capture.completed":
      return "Immutable source evidence was accepted through the capture boundary.";
    case "normalization.reused":
      return "Existing deterministic normalization for a staged sanitized fixture was reused.";
    case "normalization.completed":
      return "Deterministic normalization completed.";
    case "listing.shortlisted":
      return "Listing added to the shortlist.";
    case "listing.shortlist_removed":
      return "Listing removed from the shortlist.";
    case "seed.completed":
      return "Sanitized demo fixtures were seeded.";
    default:
      return null;
  }
}

export function projectActivityEvent(event: ActivityEvent): ActivityPresentation {
  return ActivityPresentationSchema.parse({
    id: event.id,
    correlationId: event.correlationId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    policyDecision: event.policyDecision,
    outcome: event.outcome,
    detail: safeActivityDetail(event),
    occurredAt: event.occurredAt
  });
}

function duplicateExplanation(
  repositories: VeraRepositories,
  listingId: string,
  duplicateClusterId: string | null,
  sourceLabels: readonly string[]
): string | null {
  if (duplicateClusterId === null) return null;
  const cluster = repositories.duplicateClusters.getById(duplicateClusterId);
  if (!cluster || !cluster.reasonCodes.includes("fixture_declared_duplicate")) return null;
  const names = sourceLabels.map(
    (source) => sourceNames[source as keyof typeof sourceNames] ?? source
  );
  return `Same normalized address and unit; listed across ${names.join(", ")} sanitized fixtures. Fixture relationships preserve every source record.`;
}

export function getListingDetail(
  repositories: VeraRepositories,
  listingIdInput: string,
  now: () => Date = () => new Date()
): CanonicalListingDetailResponse | null {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const canonical = repositories.canonicalListings.getById(listingId);
  if (!canonical) return null;
  const summary = repositories.canonicalListings
    .listSummaries()
    .find((candidate) => candidate.id === listingId);
  if (!summary) return null;
  const sourceRecords = repositories.sourceRecords.listByCanonicalListingId(listingId);
  const rawIds = new Set(sourceRecords.map((record) => record.rawListingId));
  const activity = repositories.activityEvents
    .list()
    .filter(
      (event) =>
        (event.targetType === "canonical_listing" && event.targetId === listingId) ||
        (event.targetType === "raw_listing" && rawIds.has(event.targetId))
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map(projectActivityEvent);

  return CanonicalListingDetailResponseSchema.parse({
    canonical,
    summary,
    sources: sourceRecords.map((record) => ({
      record,
      provenance: repositories.fieldProvenance.listBySourceRecordId(record.id)
    })),
    duplicateExplanation: duplicateExplanation(
      repositories,
      listingId,
      canonical.duplicateClusterId,
      summary.sourceLabels
    ),
    score: repositories.listingScores.listByCanonicalListingId(listingId)[0] ?? null,
    risks: repositories.riskSignals.listByCanonicalListingId(listingId),
    activity,
    generatedAt: now().toISOString()
  });
}

export interface SetListingShortlistDependencies {
  readonly repositories: VeraRepositories;
  now(): Date;
  createId?(): string;
}

export function setListingShortlist(
  listingIdInput: string,
  shortlisted: boolean,
  dependencies: SetListingShortlistDependencies
): ShortlistResponse {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const updatedAt = dependencies.now().toISOString();
  const createId = dependencies.createId ?? randomUUID;
  const targetState = shortlisted ? "shortlisted" : "new";
  const payloadHash = sha256Text(
    `listing-shortlist:v1:${canonicalJson({ listingId, shortlisted })}`
  );
  const activityEventId = createId();

  const listing = dependencies.repositories.transaction((repositories) => {
    const updated = repositories.canonicalListings.transitionLifecycle(
      listingId,
      targetState,
      updatedAt
    );
    repositories.activityEvents.append(
      ActivityEventSchema.parse({
        id: activityEventId,
        correlationId: createId(),
        causationId: null,
        actor: "user",
        action: shortlisted ? "listing.shortlisted" : "listing.shortlist_removed",
        targetType: "canonical_listing",
        targetId: listingId,
        policyDecision: "not_applicable",
        approvalId: null,
        payloadHash,
        outcome: "succeeded",
        errorCategory: null,
        metadata: { lifecycleState: targetState },
        occurredAt: updatedAt
      })
    );
    return updated;
  });

  return ShortlistResponseSchema.parse({
    listingId,
    lifecycleState: listing.lifecycleState,
    shortlisted: listing.lifecycleState === "shortlisted",
    activityEventId,
    updatedAt
  });
}
