import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MaritimeOpenClawClient, RentCastConnector } from "@vera/connectors";
import {
  DEMO_SEARCH_PROFILE,
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import { SOURCE_FIXTURES } from "@vera/db/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertLiveSearchFounder,
  LiveSearchServiceError,
  parseLiveSearchEnvironment,
  runLiveSearch,
  type LiveSearchServiceDependencies
} from "./live-search-service.ts";

let directory: string;
let connection: VeraDatabaseConnection;
let provider: ReturnType<typeof createDemoRepositoryProvider>;
let nextId: number;
const LIVE_PROFILE = {
  ...DEMO_SEARCH_PROFILE,
  id: "profile-live-boston",
  name: "Live Boston search",
  locationText: "Boston, MA",
  radiusKilometers: null
};

const rentCastResponse = [
  {
    id: "rc-live-1",
    formattedAddress: "10 Beacon St, Harbor City, MA 02108",
    propertyType: "Apartment",
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 850,
    status: "Active",
    price: 2400,
    listedDate: "2026-07-20T10:00:00.000Z",
    lastSeenDate: "2026-07-24T10:00:00.000Z",
    daysOnMarket: 4
  }
];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "vera-live-search-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  seedDatabase(createSqliteRepositories(connection));
  provider = createDemoRepositoryProvider(connection);
  await provider.forUser(DEMO_USER_ID).searchProfiles.insert(LIVE_PROFILE);
  nextId = 0;
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

function dependencies(
  options: { providerGate?: Promise<void>; maritimeResponse?: string } = {}
): LiveSearchServiceDependencies {
  const repositories = provider.forUser(DEMO_USER_ID);
  const rentCastFetch = vi.fn<typeof fetch>(async () => {
    await options.providerGate;
    return new Response(JSON.stringify(rentCastResponse), { status: 200 });
  });
  const maritimeFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { conversation_id: string };
    return new Response(
      JSON.stringify({
        response:
          options.maritimeResponse ??
          JSON.stringify({
            schemaVersion: "1",
            searchRunId: body.conversation_id,
            recommendations: [
              {
                providerListingId: "rc-live-1",
                recommended: true,
                confidence: 0.8,
                summary: "Matches the explicit budget and bedroom criteria.",
                strengths: ["Within the maximum stated rent."],
                watchouts: ["Pet policy is unknown."],
                missingFacts: ["Required recurring fees."]
              }
            ]
          })
      }),
      { status: 200 }
    );
  });
  return {
    userId: DEMO_USER_ID,
    repositoryProvider: provider,
    repositories,
    rentCast: new RentCastConnector({
      apiKey: "rentcast-secret-test",
      fetch: rentCastFetch,
      now: () => new Date("2026-07-24T12:00:00.000Z")
    }),
    maritime: new MaritimeOpenClawClient({
      apiKey: "maritime-secret-test",
      agentId: "agent-test",
      fetch: maritimeFetch,
      now: () => new Date("2026-07-24T12:00:01.000Z")
    }),
    now: () => new Date("2026-07-24T12:00:02.000Z"),
    createId: () => `live-id-${String(++nextId)}`
  };
}

const request = {
  searchProfileId: LIVE_PROFILE.id,
  confirmedExternalUsage: true
} as const;

describe("live search application service", () => {
  it("imports idempotently and records material events in order", async () => {
    const deps = dependencies();
    const first = await runLiveSearch(request, deps);
    expect(first).toMatchObject({
      state: "importing",
      retrievedCount: 1,
      importedCount: 1,
      rejectedCount: 0
    });
    const actions = (await deps.repositories.activityEvents.list())
      .filter((event) => event.correlationId === first.searchRunId)
      .map((event) => event.action);
    expect(actions).toEqual([
      "live_search_requested",
      "live_provider_query_started",
      "live_provider_query_completed",
      "maritime_agent_analysis_started",
      "maritime_agent_analysis_completed",
      "live_listing_imported"
    ]);
    const imported = (await deps.repositories.activityEvents.list()).find(
      (event) =>
        event.correlationId === first.searchRunId && event.action === "live_listing_imported"
    )!;
    expect(await deps.repositories.rawListings.getById(imported.targetId)).toMatchObject({
      source: "rentcast",
      sourceListingId: "rc-live-1"
    });

    const second = await runLiveSearch(request, deps);
    expect(second).toMatchObject({ importedCount: 0, rejectedCount: 0 });
    expect(await deps.repositories.rawListings.count()).toBe(13);
  });

  it("preserves provider evidence when advisory agent output is invalid", async () => {
    const deps = dependencies({ maritimeResponse: "not-json" });

    const result = await runLiveSearch(request, deps);

    expect(result).toMatchObject({
      state: "importing",
      retrievedCount: 1,
      importedCount: 1,
      rejectedCount: 0,
      agentLatencyMilliseconds: null
    });
    const events = (await deps.repositories.activityEvents.list()).filter(
      (event) => event.correlationId === result.searchRunId
    );
    expect(events.map((event) => event.action)).toEqual([
      "live_search_requested",
      "live_provider_query_started",
      "live_provider_query_completed",
      "maritime_agent_analysis_started",
      "maritime_agent_analysis_unavailable",
      "live_listing_imported"
    ]);
    expect(
      events.find((event) => event.action === "maritime_agent_analysis_unavailable")
    ).toMatchObject({
      outcome: "failed",
      metadata: {
        resultState: "agent_invalid_response",
        continuedWithProviderEvidence: true
      }
    });
    expect(events.some((event) => event.action === "live_search_failed")).toBe(false);
    const imported = events.find((event) => event.action === "live_listing_imported")!;
    expect(await deps.repositories.rawListings.getById(imported.targetId)).toMatchObject({
      source: "rentcast",
      sourceListingId: "rc-live-1",
      rawJson: {
        liveEvidence: { agentAnalysis: null }
      }
    });
    expect(await deps.repositories.sourceJobs.getById(result.searchRunId)).toMatchObject({
      status: "completed",
      result: { status: "completed", recordCount: 1, error: null }
    });
  });

  it("queues decision reconciliation when an idempotent rerun is already normalized", async () => {
    const deps = dependencies();
    const first = await runLiveSearch(request, deps);
    const imported = (await deps.repositories.activityEvents.list()).find(
      (event) =>
        event.correlationId === first.searchRunId && event.action === "live_listing_imported"
    )!;
    const raw = await deps.repositories.rawListings.getById(imported.targetId);
    expect(raw).not.toBeNull();
    await deps.repositories.sourceRecords.insert({
      ...SOURCE_FIXTURES[0]!.sourceRecord,
      id: "src-live-idempotent-rerun",
      rawListingId: imported.targetId,
      source: "rentcast",
      sourceListingId: "rc-live-1",
      sourceUrl: raw!.sourceUrl,
      observedAt: raw!.observedAt,
      createdAt: raw!.observedAt
    });

    const second = await runLiveSearch(request, deps);

    expect(second).toMatchObject({
      state: "importing",
      importedCount: 0,
      rejectedCount: 0
    });
    expect(
      (await deps.repositories.decisionJobs.list()).some(
        (job) =>
          job.searchProfileId === LIVE_PROFILE.id &&
          job.trigger === "manual_recompute" &&
          job.status === "queued"
      )
    ).toBe(true);
  });

  it("prevents concurrent runs for the same profile", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = dependencies({ providerGate: gate });
    const first = runLiveSearch(request, deps);
    await vi.waitFor(async () => {
      expect(
        (await deps.repositories.sourceJobs.list()).some((job) => job.status === "running")
      ).toBe(true);
    });
    await expect(runLiveSearch(request, deps)).rejects.toMatchObject({
      code: "duplicate_run",
      status: 409
    });
    release();
    await first;
  });

  it("uses the source-job uniqueness boundary for simultaneous profile runs", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = dependencies({ providerGate: gate });
    const attempts = [runLiveSearch(request, deps), runLiveSearch(request, deps)].map((attempt) =>
      attempt.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      )
    );
    await vi.waitFor(async () => {
      expect((await deps.repositories.sourceJobs.list()).length).toBeGreaterThan(0);
    });
    release();
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { code: "duplicate_run" }
    });
    expect(
      (await deps.repositories.sourceJobs.list()).filter(
        (job) =>
          job.connectorId === "rentcast.rental-listings.v1" &&
          job.payload.acquisitionMode === "official_api" &&
          job.payload.sourceConfigurationId === LIVE_PROFILE.id
      )
    ).toHaveLength(1);
  });

  it("does not read a profile outside the tenant repository", async () => {
    const deps = dependencies();
    await expect(
      runLiveSearch({ ...request, searchProfileId: "another-users-profile" }, deps)
    ).rejects.toMatchObject({ code: "profile_not_found" });
  });

  it("requires both the exact live flag and founder allowlist", () => {
    const allowed = parseLiveSearchEnvironment({
      VERA_LIVE_AGENT_SEARCH_ENABLED: "1",
      VERA_LIVE_AGENT_FOUNDER_USER_IDS: DEMO_USER_ID
    });
    expect(() => assertLiveSearchFounder(DEMO_USER_ID, allowed)).not.toThrow();
    expect(() =>
      assertLiveSearchFounder(
        DEMO_USER_ID,
        parseLiveSearchEnvironment({
          VERA_LIVE_AGENT_SEARCH_ENABLED: "true",
          VERA_LIVE_AGENT_FOUNDER_USER_IDS: "00000000-0000-4000-8000-000000000999"
        })
      )
    ).toThrow(LiveSearchServiceError);
    expect(() =>
      assertLiveSearchFounder(
        DEMO_USER_ID,
        parseLiveSearchEnvironment({
          VERA_LIVE_AGENT_SEARCH_ENABLED: "0",
          VERA_LIVE_AGENT_FOUNDER_USER_IDS: DEMO_USER_ID
        })
      )
    ).toThrow(LiveSearchServiceError);
  });
});
