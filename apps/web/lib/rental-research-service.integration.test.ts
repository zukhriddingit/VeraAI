import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import type {
  BrowserResearchOutput,
  BrowserResearchPlan,
  ZillowRentalResearchOutput
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLiveSearchDependencies } from "./live-search-service.ts";
import {
  getRentalResearchStatus,
  runRentalResearch,
  stopRentalResearch,
  type RentalResearchDependencies
} from "./rental-research-service.ts";

let directory: string;
let connection: VeraDatabaseConnection;
let provider: ReturnType<typeof createDemoRepositoryProvider>;
let nextId = 0;
const profile = {
  ...DEMO_SEARCH_PROFILE,
  id: "profile-zillow-boston",
  name: "Boston Zillow research",
  locationText: "Boston, MA",
  minimumBedrooms: 2,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 300_000,
  absoluteMonthlyMaximumCents: 350_000
};
const observedAt = "2026-07-30T12:00:00.000Z";
const sourceUrl = "https://www.zillow.com/homedetails/12-Beacon-St-Boston-MA-02108/123456_zpid/";

function output(overrides: Partial<ZillowRentalResearchOutput> = {}): ZillowRentalResearchOutput {
  return {
    version: "1",
    veraRunId: "run-zillow-1",
    state: "completed",
    pageState: "ready",
    manualAction: null,
    listings: [
      {
        sourceListingId: "123456",
        canonicalObservedUrl: sourceUrl,
        finalDetailPageUrl: sourceUrl,
        address: "12 Beacon St, Boston, MA 02108",
        rentUsd: 3_200,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 900,
        availability: "Available now",
        amenities: ["In-unit laundry"],
        observedAt,
        sourceFieldProvenance: [
          {
            field: "address",
            observedFrom: "detail_page",
            sourceUrl,
            extractionMethod: "openclaw_semantic_snapshot",
            confidenceBasisPoints: 9_500,
            observedAt
          }
        ],
        missingFields: [],
        safeExtractionWarnings: [],
        researchNotes: ["Opened one bounded same-tab Zillow listing detail page."]
      }
    ],
    resultCardsObserved: 1,
    detailPagesOpened: 1,
    resultPageExpansions: 0,
    startedAt: observedAt,
    completedAt: "2026-07-30T12:00:30.000Z",
    safeActionTrail: [],
    warnings: [],
    ...overrides
  };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "vera-rental-research-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  seedDatabase(createSqliteRepositories(connection));
  provider = createDemoRepositoryProvider(connection);
  await provider.forUser(DEMO_USER_ID).searchProfiles.insert(profile);
  nextId = 0;
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

function dependencies(
  zillowRun: RentalResearchDependencies["zillow"]["run"],
  browserResearchRun: RentalResearchDependencies["browserResearch"]["run"] = async () => {
    throw new Error("browser research is not used by this test");
  }
): RentalResearchDependencies {
  const repositories = provider.forUser(DEMO_USER_ID);
  const live = createLiveSearchDependencies(DEMO_USER_ID, repositories, provider, {
    NODE_ENV: "test",
    RENTCAST_API_KEY: "rentcast-test-key",
    MARITIME_API_KEY: "maritime-test-key",
    MARITIME_OPENCLAW_AGENT_ID: "agent-test"
  });
  return {
    userId: DEMO_USER_ID,
    repositories,
    repositoryProvider: provider,
    liveSearch: live,
    zillow: { run: zillowRun },
    zillowEnvironment: {
      founderUserId: DEMO_USER_ID,
      sourceEnabled: true,
      browserDisabled: false
    },
    browserResearch: { run: browserResearchRun },
    browserResearchEnvironment: {
      founderUserId: DEMO_USER_ID,
      browserDisabled: false,
      planSigningKey: "test-browser-research-signing-key-0000000000000000",
      enabledSources: new Set(["apartments_com", "facebook_marketplace"])
    },
    now: () => new Date("2026-07-30T12:01:00.000Z"),
    createId: () => `research-id-${String(++nextId)}`
  };
}

const request = {
  veraRunId: "run-zillow-1",
  searchProfileId: profile.id,
  selectedSources: ["zillow"],
  confirmedExternalUsage: true
} as const;

const excludedAdditionalSources = [
  { source: "apartments_com", state: "excluded_by_user" },
  { source: "facebook_marketplace", state: "excluded_by_user" }
] as const;

describe("founder Zillow rental research service", () => {
  it("imports observed Zillow evidence into the normal RawListing and normalization queue", async () => {
    const deps = dependencies(async () => output());
    const status = await runRentalResearch(request, deps);

    expect(status).toMatchObject({
      searchRunId: "run-zillow-1",
      phase: "importing",
      sources: [
        { source: "rentcast", state: "excluded_by_user" },
        {
          source: "zillow",
          state: "completed",
          retrievedCount: 1,
          importedCount: 1,
          rejectedCount: 0
        },
        ...excludedAdditionalSources
      ]
    });
    const imports = (await deps.repositories.activityEvents.list()).filter(
      (event) =>
        event.correlationId === request.veraRunId && event.action === "live_listing_imported"
    );
    expect(imports).toHaveLength(1);
    const raw = await deps.repositories.rawListings.getById(imports[0]!.targetId);
    expect(raw).toMatchObject({
      source: "zillow",
      acquisitionMode: "local_browser",
      sourceListingId: "123456",
      sourceUrl,
      captureMetadata: {
        connectorId: "zillow.browser-research.v1",
        searchProfileId: profile.id,
        extractionMethod: "openclaw_semantic_snapshot"
      }
    });
    expect(JSON.stringify(raw)).not.toMatch(/cookie|credential|rawSnapshot/iu);
    expect(await deps.repositories.normalizationJobs.getByRawListingId(raw!.id)).not.toBeNull();
  });

  it("surfaces a manual blocker without creating a RawListing", async () => {
    const deps = dependencies(async () =>
      output({
        state: "manual_action_required",
        pageState: "ready",
        manualAction: "no_shared_tab",
        listings: [],
        resultCardsObserved: 0,
        detailPagesOpened: 0,
        completedAt: "2026-07-30T12:00:01.000Z"
      })
    );
    const status = await runRentalResearch(request, deps);
    expect(status).toMatchObject({
      phase: "completed",
      sources: [
        { source: "rentcast", state: "excluded_by_user" },
        {
          source: "zillow",
          state: "failed",
          manualAction: "no_shared_tab",
          importedCount: 0
        },
        ...excludedAdditionalSources
      ]
    });
    expect(await deps.repositories.rawListings.count()).toBe(12);
    expect(await deps.repositories.sourceJobs.getById(request.veraRunId)).toMatchObject({
      status: "manual_action_required",
      manualAction: { blocker: "user_intervention_required" }
    });
  });

  it("stops the exact source job and imports nothing returned after cancellation", async () => {
    let release = (_value: ZillowRentalResearchOutput) => {};
    const gate = new Promise<ZillowRentalResearchOutput>((resolve) => {
      release = resolve;
    });
    const deps = dependencies(async () => gate);
    const run = runRentalResearch(request, deps);
    await vi.waitFor(async () => {
      expect(await deps.repositories.sourceJobs.getById(request.veraRunId)).toMatchObject({
        status: "running"
      });
    });

    await stopRentalResearch(request.veraRunId, deps);
    release(output());
    await run;

    expect(await getRentalResearchStatus(request.veraRunId, deps)).toMatchObject({
      phase: "completed",
      sources: [
        { source: "rentcast", state: "excluded_by_user" },
        { source: "zillow", state: "failed", manualAction: "cancelled", importedCount: 0 },
        ...excludedAdditionalSources
      ]
    });
    expect(await deps.repositories.rawListings.count()).toBe(12);
    expect(await deps.repositories.sourceJobs.getById(request.veraRunId)).toMatchObject({
      status: "cancelled_by_policy"
    });
  });
});

function browserOutput(
  plan: BrowserResearchPlan,
  overrides: Partial<BrowserResearchOutput> = {}
): BrowserResearchOutput {
  const isApartments = plan.source === "apartments_com";
  const sourceUrl = isApartments
    ? "https://www.apartments.com/beacon-hill-boston-ma/abc123/"
    : "https://www.facebook.com/marketplace/item/123456789/";
  return {
    version: "1",
    veraRunId: plan.veraRunId,
    source: plan.source,
    state: "completed",
    pageState: "ready",
    manualAction: null,
    listings: [
      {
        source: plan.source,
        sourceListingId: isApartments ? "abc123" : "123456789",
        canonicalObservedUrl: sourceUrl,
        finalDetailPageUrl: sourceUrl,
        propertyName: isApartments ? "Beacon Hill Apartments" : null,
        address: isApartments
          ? "20 Beacon St, Boston, MA 02108"
          : "45 Cambridge St, Boston, MA 02114",
        rentUsd: isApartments ? 2_750 : 2_400,
        bedrooms: 1,
        bathrooms: 1,
        squareFeet: isApartments ? 700 : null,
        availability: "Available now",
        amenities: isApartments ? ["Laundry"] : [],
        fees: isApartments ? ["Application fee visible; amount not shown"] : [],
        observedAt,
        sourceFieldProvenance: [
          {
            field: "address",
            observedFrom: "detail_page",
            sourceUrl,
            extractionMethod: "openclaw_semantic_snapshot",
            confidenceBasisPoints: 9_500,
            observedAt
          }
        ],
        missingFields: isApartments ? [] : ["square_footage", "amenities", "fees"],
        safeExtractionWarnings: [],
        researchNotes: ["Read-only bounded browser extraction completed."]
      }
    ],
    resultCardsObserved: 1,
    detailPagesOpened: 1,
    actionsUsed: 8,
    startedAt: observedAt,
    completedAt: "2026-07-30T12:00:30.000Z",
    safeActionTrail: [],
    warnings: [],
    ...overrides
  };
}

describe("multi-source browser research service", () => {
  it("imports Apartments.com through RawListing and preserves visible fee evidence", async () => {
    let observedPlan: BrowserResearchPlan | null = null;
    const deps = dependencies(
      async () => output(),
      async (plan) => {
        observedPlan = plan;
        return browserOutput(plan);
      }
    );
    const status = await runRentalResearch(
      {
        veraRunId: "run-apartments-1",
        searchProfileId: profile.id,
        selectedSources: ["apartments_com"],
        confirmedExternalUsage: true
      },
      deps
    );

    const capturedPlan = observedPlan as BrowserResearchPlan | null;
    expect(capturedPlan).toMatchObject({
      version: "1",
      source: "apartments_com",
      maxResults: 10,
      maxDetailPages: 5,
      allowedHostnames: ["www.apartments.com"]
    });
    expect(capturedPlan?.signature).toMatch(/^[a-f0-9]{64}$/u);
    expect(status.sources).toMatchObject([
      { source: "rentcast", state: "excluded_by_user" },
      { source: "zillow", state: "excluded_by_user" },
      { source: "apartments_com", state: "completed", importedCount: 1 },
      { source: "facebook_marketplace", state: "excluded_by_user" }
    ]);
    const imported = (await deps.repositories.activityEvents.list()).findLast(
      (event) =>
        event.action === "live_listing_imported" && event.metadata.provider === "apartments_com"
    );
    const raw = await deps.repositories.rawListings.getById(imported!.targetId);
    expect(raw).toMatchObject({
      source: "apartments_com",
      sourceUrl: "https://www.apartments.com/beacon-hill-boston-ma/abc123/",
      captureMetadata: {
        connectorId: "apartments-com.browser-research.v1",
        visibleFees: ["Application fee visible; amount not shown"]
      }
    });
    expect(await deps.repositories.normalizationJobs.getByRawListingId(raw!.id)).not.toBeNull();
  });

  it("reports Facebook login as a manual child-run blocker without erasing Apartments.com", async () => {
    const deps = dependencies(
      async () => output(),
      async (plan) =>
        plan.source === "apartments_com"
          ? browserOutput(plan)
          : browserOutput(plan, {
              state: "manual_action_required",
              pageState: "login_required",
              manualAction: "login_required",
              listings: [],
              resultCardsObserved: 0,
              detailPagesOpened: 0,
              actionsUsed: 2,
              completedAt: "2026-07-30T12:00:05.000Z"
            })
    );
    const status = await runRentalResearch(
      {
        veraRunId: "run-browser-partial-1",
        searchProfileId: profile.id,
        selectedSources: ["apartments_com", "facebook_marketplace"],
        confirmedExternalUsage: true
      },
      deps
    );

    expect(status.partial).toBe(true);
    expect(status.sources).toMatchObject([
      { source: "rentcast", state: "excluded_by_user" },
      { source: "zillow", state: "excluded_by_user" },
      { source: "apartments_com", state: "completed", importedCount: 1 },
      {
        source: "facebook_marketplace",
        state: "login_required",
        manualAction: "login_required",
        importedCount: 0
      }
    ]);
    const imports = (await deps.repositories.activityEvents.list()).filter(
      (event) =>
        event.correlationId === "run-browser-partial-1" && event.action === "live_listing_imported"
    );
    expect(imports).toHaveLength(1);
  });
});
