import { randomUUID } from "node:crypto";

import { SOURCE_FIXTURES } from "@vera/db/fixtures";
import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  DEMO_SEARCH_COMPLETION_SUMMARY,
  DemoRunResponseSchema,
  DemoStatusResponseSchema,
  type DemoRunResponse,
  type DemoStatusResponse,
  type VeraUserId
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

async function runFromCompletionEvent(
  repositories: UserRepositories,
  idempotentReplay: boolean
): Promise<DemoRunResponse | null> {
  const event = await repositories.activityEvents.getById(DEMO_COMPLETION_EVENT_ID);
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

async function seededFixturesAreValid(repositories: UserRepositories): Promise<boolean> {
  const activeCanonicals = await repositories.canonicalListings.list();
  const decisionRuns = await repositories.decisionHistory.listRuns(DEMO_PROFILE_ID);
  const succeededJobs = (await repositories.decisionJobs.list()).filter(
    (job) => job.searchProfileId === DEMO_PROFILE_ID && job.status === "succeeded"
  );
  const fixturesExist = await Promise.all(
    SOURCE_FIXTURES.map(async (fixture) =>
      Boolean(
        (await repositories.rawListings.getById(fixture.capture.id)) &&
        (await repositories.sourceRecords.getById(fixture.sourceRecord.id))
      )
    )
  );

  return (
    (await repositories.searchProfiles.getById(DEMO_PROFILE_ID)) !== null &&
    fixturesExist.every(Boolean) &&
    activeCanonicals.length === 8 &&
    (await repositories.duplicateClusters.count()) === 3 &&
    decisionRuns.length === 1 &&
    succeededJobs.length === 1 &&
    decisionRuns[0]?.jobId === succeededJobs[0]?.id &&
    (
      await Promise.all(
        activeCanonicals.map((listing) =>
          repositories.listingScores.getCurrentV2ByCanonicalListingId(
            listing.id,
            decisionRuns[0]!.id
          )
        )
      )
    ).every((score) => score !== null)
  );
}

export async function getDemoStatus(
  repositories: UserRepositories,
  now: () => Date = () => new Date()
): Promise<DemoStatusResponse> {
  const profile = await repositories.searchProfiles.getById(DEMO_PROFILE_ID);
  if (!profile || !(await seededFixturesAreValid(repositories))) throw new DemoSearchStateError();
  const run = await runFromCompletionEvent(repositories, true);

  return DemoStatusResponseSchema.parse({
    demoMode: true,
    status: run ? "completed" : "not_run",
    profile,
    run,
    generatedAt: now().toISOString()
  });
}

export interface RunDemoSearchDependencies {
  readonly userId: VeraUserId;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly repositories: UserRepositories;
  readonly capture?: Omit<
    CaptureServiceDependencies,
    "repositories" | "policyRegistry" | "connectors" | "now"
  >;
  now(): Date;
}

export async function runDemoSearch(
  dependencies: RunDemoSearchDependencies
): Promise<DemoRunResponse> {
  const replay = await runFromCompletionEvent(dependencies.repositories, true);
  if (replay) return replay;
  if (!(await seededFixturesAreValid(dependencies.repositories))) throw new DemoSearchStateError();

  const connectors = listSourceConnectors("demo");
  const policyRegistry = await createPersistedPolicyRegistry(dependencies.repositories);
  const createId = dependencies.capture?.createId ?? randomUUID;

  for (const fixture of SOURCE_FIXTURES) {
    const result = await captureListing(fixture.request, {
      userId: dependencies.userId,
      repositoryProvider: dependencies.repositoryProvider,
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
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    let causationId: string | null = null;

    for (const fixture of SOURCE_FIXTURES) {
      const eventId = `event-demo-normalization-reused:${fixture.capture.id}`;
      const existing = await repositories.activityEvents.getById(eventId);
      if (!existing) {
        const raw = await repositories.rawListings.getById(fixture.capture.id);
        if (!raw) throw new DemoSearchStateError();
        await repositories.activityEvents.append(
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

    await repositories.activityEvents.append(
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

  const completed = await runFromCompletionEvent(dependencies.repositories, false);
  if (!completed) throw new DemoSearchStateError();
  return completed;
}
