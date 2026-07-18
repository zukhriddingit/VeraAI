import { randomUUID } from "node:crypto";

import {
  CANONICAL_FIXTURES,
  DEMO_RISK_FIXTURES,
  DEMO_SCORE_FIXTURES,
  DUPLICATE_CLUSTER_FIXTURES,
  SOURCE_FIXTURES
} from "@vera/db/fixtures";
import { canonicalJson, sha256Text, type VeraRepositories } from "@vera/db/runtime";
import {
  ActivityEventSchema,
  DEMO_SEARCH_COMPLETION_SUMMARY,
  DemoRunResponseSchema,
  DemoStatusResponseSchema,
  type DemoRunResponse,
  type DemoStatusResponse
} from "@vera/domain";

import { captureListing, type CaptureServiceDependencies } from "./capture-service.ts";
import { createPersistedPolicyRegistry, listSourceConnectors } from "./connector-registry.ts";

export const DEMO_PROFILE_ID = "profile-demo-harbor-city";
export const DEMO_COMPLETION_EVENT_ID = "event-demo-search-v1-completed";
const demoCorrelationId = "correlation-demo-search-v1";
const demoTargetId = "demo-search-v1";

export class DemoSearchStateError extends Error {
  constructor(message = "The deterministic demo state is invalid. Reset and seed the demo.") {
    super(message);
    this.name = "DemoSearchStateError";
  }
}

function expectedPayloadHash(): string {
  return sha256Text(
    `demo-search:v1:${canonicalJson({
      fixtureVersion: 1,
      rawListingIds: SOURCE_FIXTURES.map((fixture) => fixture.capture.id),
      sourceListingIds: SOURCE_FIXTURES.map((fixture) => fixture.capture.sourceListingId)
    })}`
  );
}

function numberMetadata(value: unknown, expected: number): boolean {
  return typeof value === "number" && value === expected;
}

function runFromCompletionEvent(
  repositories: VeraRepositories,
  idempotentReplay: boolean
): DemoRunResponse | null {
  const event = repositories.activityEvents.getById(DEMO_COMPLETION_EVENT_ID);
  if (!event) return null;

  const valid =
    event.action === "demo.search.completed" &&
    event.outcome === "succeeded" &&
    event.payloadHash === expectedPayloadHash() &&
    numberMetadata(event.metadata.sourceRecordsAnalyzed, 12) &&
    numberMetadata(event.metadata.homesFound, 8) &&
    numberMetadata(event.metadata.duplicateClusters, 3) &&
    event.metadata.summary === DEMO_SEARCH_COMPLETION_SUMMARY;
  if (!valid) throw new DemoSearchStateError();

  return DemoRunResponseSchema.parse({
    status: "completed",
    sourceRecordsAnalyzed: 12,
    homesFound: 8,
    duplicateClusters: 3,
    summary: DEMO_SEARCH_COMPLETION_SUMMARY,
    completedAt: event.occurredAt,
    idempotentReplay
  });
}

function seededFixturesAreValid(repositories: VeraRepositories): boolean {
  return (
    repositories.searchProfiles.getById(DEMO_PROFILE_ID) !== null &&
    SOURCE_FIXTURES.every(
      (fixture) =>
        repositories.rawListings.getById(fixture.capture.id) !== null &&
        repositories.sourceRecords.getById(fixture.sourceRecord.id) !== null
    ) &&
    CANONICAL_FIXTURES.every(
      (fixture) => repositories.canonicalListings.getById(fixture.listing.id) !== null
    ) &&
    DUPLICATE_CLUSTER_FIXTURES.every(
      (fixture) => repositories.duplicateClusters.getById(fixture.id) !== null
    ) &&
    DEMO_SCORE_FIXTURES.every(
      (fixture) => repositories.listingScores.getById(fixture.id) !== null
    ) &&
    DEMO_RISK_FIXTURES.every((fixture) => repositories.riskSignals.getById(fixture.id) !== null)
  );
}

export function getDemoStatus(
  repositories: VeraRepositories,
  now: () => Date = () => new Date()
): DemoStatusResponse {
  const profile = repositories.searchProfiles.getById(DEMO_PROFILE_ID);
  if (!profile || !seededFixturesAreValid(repositories)) throw new DemoSearchStateError();
  const run = runFromCompletionEvent(repositories, true);

  return DemoStatusResponseSchema.parse({
    demoMode: true,
    status: run ? "completed" : "not_run",
    profile,
    run,
    generatedAt: now().toISOString()
  });
}

export interface RunDemoSearchDependencies {
  readonly repositories: VeraRepositories;
  readonly capture?: Omit<
    CaptureServiceDependencies,
    "repositories" | "policyRegistry" | "connectors" | "now"
  >;
  now(): Date;
}

export function runDemoSearch(dependencies: RunDemoSearchDependencies): DemoRunResponse {
  const replay = runFromCompletionEvent(dependencies.repositories, true);
  if (replay) return replay;
  if (!seededFixturesAreValid(dependencies.repositories)) throw new DemoSearchStateError();

  const connectors = listSourceConnectors();
  const policyRegistry = createPersistedPolicyRegistry(dependencies.repositories);
  const createId = dependencies.capture?.createId ?? randomUUID;

  for (const fixture of SOURCE_FIXTURES) {
    const result = captureListing(fixture.request, {
      repositories: dependencies.repositories,
      connectors,
      policyRegistry,
      now: () => new Date(fixture.capture.observedAt),
      createId
    });

    if (result.rawListingId !== fixture.capture.id || !result.duplicate) {
      throw new DemoSearchStateError("Fixture import did not resolve the staged immutable record.");
    }
  }

  const completedAt = dependencies.now().toISOString();
  dependencies.repositories.transaction((repositories) => {
    let causationId: string | null = null;

    for (const fixture of SOURCE_FIXTURES) {
      const eventId = `event-demo-normalization-reused:${fixture.capture.id}`;
      const existing = repositories.activityEvents.getById(eventId);
      if (!existing) {
        const raw = repositories.rawListings.getById(fixture.capture.id);
        if (!raw) throw new DemoSearchStateError();
        repositories.activityEvents.append(
          ActivityEventSchema.parse({
            id: eventId,
            correlationId: demoCorrelationId,
            causationId,
            actor: "system",
            action: "normalization.reused",
            targetType: "raw_listing",
            targetId: fixture.capture.id,
            policyDecision: "not_applicable",
            approvalId: null,
            payloadHash: raw.contentHash,
            outcome: "succeeded",
            errorCategory: null,
            metadata: {
              sourceRecordId: fixture.sourceRecord.id,
              reason: "staged_sanitized_fixture"
            },
            occurredAt: completedAt
          })
        );
      }
      causationId = eventId;
    }

    repositories.activityEvents.append(
      ActivityEventSchema.parse({
        id: DEMO_COMPLETION_EVENT_ID,
        correlationId: demoCorrelationId,
        causationId,
        actor: "system",
        action: "demo.search.completed",
        targetType: "demo_search",
        targetId: demoTargetId,
        policyDecision: "not_applicable",
        approvalId: null,
        payloadHash: expectedPayloadHash(),
        outcome: "succeeded",
        errorCategory: null,
        metadata: {
          fixtureVersion: 1,
          sourceRecordsAnalyzed: 12,
          homesFound: 8,
          duplicateClusters: 3,
          summary: DEMO_SEARCH_COMPLETION_SUMMARY,
          networkAccess: false
        },
        occurredAt: completedAt
      })
    );
  });

  const completed = runFromCompletionEvent(dependencies.repositories, false);
  if (!completed) throw new DemoSearchStateError();
  return completed;
}
