import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  ActivityCollectionResponseSchema,
  ActivityPresentationSchema,
  CanonicalListingDetailResponseSchema,
  DismissListingResponseSchema,
  EntityIdSchema,
  ShortlistResponseSchema,
  type ActivityEvent,
  type ActivityCollectionResponse,
  type ActivityPresentation,
  type CanonicalListingDetailResponse,
  type DismissListingResponse,
  type ShortlistResponse,
  type VeraUserId
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
    case "listing.dismissed":
      return "Listing dismissed from the active inbox.";
    case "seed.completed":
      return "Legacy sanitized fixtures were seeded for migration compatibility.";
    case "demo.viewing_fixture.prepared":
      return "A sanitized simulated reply made this demo listing eligible for the offline viewing walkthrough.";
    case "viewing.availability_saved":
      return "Viewing availability rules were saved.";
    case "calendar.authorization_requested":
      return "Google Calendar permission was requested for the selected capability.";
    case "calendar.authorization_completed":
      return "Google Calendar permission state was verified and updated.";
    case "calendar.authorization_denied":
      return "Google Calendar permission was denied, revoked, or unavailable.";
    case "calendar.freebusy_checked":
      return "The connected account's primary Google Calendar was checked using free/busy only.";
    case "calendar.freebusy_unavailable":
      return "Google Calendar free/busy was unavailable; Vera did not treat it as an empty calendar.";
    case "viewing.proposals_created":
      return "Viewing windows were proposed with their availability and Vera-rule provenance.";
    case "viewing.window_selected":
      return "A persisted proposed viewing window was selected.";
    case "calendar.hold_approval_recorded":
      return "Approval was recorded for the exact private tentative hold payload.";
    case "calendar.hold_final_check_conflict":
      return "A new conflict was found during the final check, so no hold was created.";
    case "calendar.hold_final_check_unavailable":
      return "The final Calendar check was unavailable; continuing requires a new warned approval.";
    case "calendar.hold_override_approved":
      return "The user explicitly approved creating the exact hold without a completed final conflict check.";
    case "calendar.hold_created":
      return "A private tentative hold was created without attendees, conferencing, or notifications.";
    case "calendar.hold_creation_failed":
      return "The approved tentative hold could not be created; no success was recorded.";
    case "viewing.reschedule_started":
      return "Rescheduling started in Vera only; an existing Google Calendar hold was not changed.";
    case "viewing.cancelled_internal":
      return "The viewing was cancelled in Vera only; an existing Google Calendar hold was not deleted.";
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

async function duplicateExplanation(
  repositories: UserRepositories,
  listingId: string,
  duplicateClusterId: string | null,
  sourceLabels: readonly string[]
): Promise<string | null> {
  if (duplicateClusterId === null) return null;
  const cluster = await repositories.duplicateClusters.getById(duplicateClusterId);
  if (!cluster) return null;
  const names = sourceLabels.map(
    (source) => sourceNames[source as keyof typeof sourceNames] ?? source
  );
  const basis = cluster.reasonCodes.includes("fixture_declared_duplicate")
    ? "Same normalized address and unit; "
    : "";
  return `${basis}deterministic ${cluster.algorithmVersion} clustering linked records across ${names.join(", ")} while preserving every source record and its provenance. Reasons: ${cluster.reasonCodes.join(", ")}.`;
}

const missingInformationCopy: Readonly<Record<string, { fieldPath: string; question: string }>> = {
  "monthly rent": {
    fieldPath: "monthlyRentCents",
    question: "What is the confirmed base monthly rent?"
  },
  "recurring fees": {
    fieldPath: "recurringFeesCents",
    question: "Which recurring fees are required in addition to rent?"
  },
  bedrooms: { fieldPath: "bedrooms", question: "How many legal bedrooms are included?" },
  bathrooms: { fieldPath: "bathrooms", question: "How many bathrooms are included?" },
  "square feet": { fieldPath: "squareFeet", question: "What is the approximate interior size?" },
  availability: { fieldPath: "availableOn", question: "What move-in date is actually available?" },
  "lease term": { fieldPath: "leaseTermMonths", question: "What lease term is required?" },
  "pet policy": { fieldPath: "petPolicy", question: "Are the required pets explicitly allowed?" }
};

export async function getActivityCollection(
  repositories: UserRepositories,
  now: () => Date = () => new Date()
): Promise<ActivityCollectionResponse> {
  const events = [...(await repositories.activityEvents.list())]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map(projectActivityEvent);
  return ActivityCollectionResponseSchema.parse({
    events,
    count: events.length,
    generatedAt: now().toISOString()
  });
}

export async function getListingDetail(
  repositories: UserRepositories,
  listingIdInput: string,
  now: () => Date = () => new Date()
): Promise<CanonicalListingDetailResponse | null> {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const canonical = await repositories.canonicalListings.getById(listingId);
  if (!canonical || canonical.projectionState !== "active") return null;
  const summary = (await repositories.canonicalListings.listSummaries()).find(
    (candidate) => candidate.id === listingId
  );
  if (!summary) return null;
  const sourceRecords = await repositories.sourceRecords.listByCanonicalListingId(listingId);
  const rawIds = new Set(sourceRecords.map((record) => record.rawListingId));
  const activity = (await repositories.activityEvents.list())
    .filter(
      (event) =>
        (event.targetType === "canonical_listing" && event.targetId === listingId) ||
        (event.targetType === "raw_listing" && rawIds.has(event.targetId))
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map(projectActivityEvent);

  const score =
    canonical.updatedByDecisionRunId === null
      ? ((await repositories.listingScores.listByCanonicalListingId(listingId))[0] ?? null)
      : await repositories.listingScores.getCurrentV2ByCanonicalListingId(
          listingId,
          canonical.updatedByDecisionRunId
        );
  const risks =
    canonical.updatedByDecisionRunId === null
      ? await repositories.riskSignals.listByCanonicalListingId(listingId)
      : await repositories.riskSignals.listCurrentV2ByCanonicalListingId(
          listingId,
          canonical.updatedByDecisionRunId
        );

  const sources = await Promise.all(
    sourceRecords.map(async (record) => ({
      record,
      provenance: await repositories.fieldProvenance.listBySourceRecordId(record.id)
    }))
  );

  return CanonicalListingDetailResponseSchema.parse({
    canonical,
    summary,
    sources,
    fieldSources: await repositories.canonicalListings.listFieldSources(listingId),
    missingInformation: summary.unknownFields.map((label) => {
      const copy = missingInformationCopy[label] ?? {
        fieldPath: label.replaceAll(" ", "_"),
        question: `What is the verified ${label}?`
      };
      return { fieldPath: copy.fieldPath, label, verificationQuestion: copy.question };
    }),
    duplicateExplanation: await duplicateExplanation(
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
  readonly userId: VeraUserId;
  readonly repositoryProvider: UserRepositoryProvider;
  now(): Date;
  createId?(): string;
}

export async function setListingShortlist(
  listingIdInput: string,
  shortlisted: boolean,
  dependencies: SetListingShortlistDependencies
): Promise<ShortlistResponse> {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const updatedAt = dependencies.now().toISOString();
  const createId = dependencies.createId ?? randomUUID;
  const targetState = shortlisted ? "shortlisted" : "new";
  const payloadHash = sha256Text(
    `listing-shortlist:v1:${canonicalJson({ listingId, shortlisted })}`
  );
  const activityEventId = createId();

  const listing = await dependencies.repositoryProvider.transaction(
    dependencies.userId,
    async (repositories) => {
      const updated = await repositories.canonicalListings.transitionLifecycle(
        listingId,
        targetState,
        updatedAt
      );
      await repositories.activityEvents.append(
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
    }
  );

  return ShortlistResponseSchema.parse({
    listingId,
    lifecycleState: listing.lifecycleState,
    shortlisted: listing.lifecycleState === "shortlisted",
    activityEventId,
    updatedAt
  });
}

export async function dismissListing(
  listingIdInput: string,
  dependencies: SetListingShortlistDependencies
): Promise<DismissListingResponse> {
  const listingId = EntityIdSchema.parse(listingIdInput);
  const updatedAt = dependencies.now().toISOString();
  const createId = dependencies.createId ?? randomUUID;
  const payloadHash = sha256Text(`listing-dismiss:v1:${canonicalJson({ listingId })}`);
  const activityEventId = createId();

  const listing = await dependencies.repositoryProvider.transaction(
    dependencies.userId,
    async (repositories) => {
      const updated = await repositories.canonicalListings.transitionLifecycle(
        listingId,
        "dismissed",
        updatedAt
      );
      await repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: activityEventId,
          correlationId: createId(),
          causationId: null,
          actor: "user",
          action: "listing.dismissed",
          targetType: "canonical_listing",
          targetId: listingId,
          policyDecision: "not_applicable",
          approvalId: null,
          payloadHash,
          outcome: "succeeded",
          errorCategory: null,
          metadata: { lifecycleState: "dismissed" },
          occurredAt: updatedAt
        })
      );
      return updated;
    }
  );

  return DismissListingResponseSchema.parse({
    listingId,
    lifecycleState: listing.lifecycleState,
    activityEventId,
    updatedAt
  });
}
