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
      return "Deterministic normalization completed and queued revisioned decision work.";
    case "decision.completed":
      return "Deterministic deduplication, ranking, and risk evaluation completed atomically.";
    case "seed.evidence_completed":
      return "Sanitized evidence was seeded and queued for production decision processing.";
    case "listing.shortlisted":
      return "Listing added to the shortlist.";
    case "listing.shortlist_removed":
      return "Listing removed from the shortlist.";
    case "seed.completed":
      return "Legacy sanitized fixtures were seeded for migration compatibility.";
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
  if (!cluster) return null;
  const names = sourceLabels.map(
    (source) => sourceNames[source as keyof typeof sourceNames] ?? source
  );
  const basis = cluster.reasonCodes.includes("fixture_declared_duplicate")
    ? "Same normalized address and unit; "
    : "";
  return `${basis}deterministic ${cluster.algorithmVersion} clustering linked records across ${names.join(", ")} while preserving every source record and its provenance. Reasons: ${cluster.reasonCodes.join(", ")}.`;
}

export function getListingDetail(
  repositories: VeraRepositories,
  listingIdInput: string,
  now: () => Date = () => new Date()
): CanonicalListingDetailResponse | null {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const canonical = repositories.canonicalListings.getById(listingId);
  if (!canonical || canonical.projectionState !== "active") return null;
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

  const score =
    canonical.updatedByDecisionRunId === null
      ? (repositories.listingScores.listByCanonicalListingId(listingId)[0] ?? null)
      : repositories.listingScores.getCurrentV2ByCanonicalListingId(
          listingId,
          canonical.updatedByDecisionRunId
        );
  const risks =
    canonical.updatedByDecisionRunId === null
      ? repositories.riskSignals.listByCanonicalListingId(listingId)
      : repositories.riskSignals.listCurrentV2ByCanonicalListingId(
          listingId,
          canonical.updatedByDecisionRunId
        );

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
    score,
    risks,
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
