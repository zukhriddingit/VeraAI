import { randomUUID } from "node:crypto";

import {
  createPostgresBetaAccessRepository,
  createPostgresBrowserGatewayAssignmentRepository,
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig
} from "@vera/db";
import { VeraUserIdSchema } from "@vera/domain";
import type { SourcePolicyRegistry } from "@vera/policy";
import { afterAll, describe, expect, it } from "vitest";

import { createPersistedPolicyRegistry } from "./connector-registry.ts";
import { createLiveSearchDependencies } from "./live-search-service.ts";
import { createRentalResearchDependencies, runRentalResearch } from "./rental-research-service.ts";
import { BrowserGatewayRuntimeResolver } from "./server/browser-gateway-runtime-resolver.ts";
import { EnvironmentBrowserGatewaySecretStore } from "./server/browser-gateway-secret-store.ts";

const enabled =
  process.env.VERA_RUN_LIVE_ZILLOW_RESEARCH_TESTS === "1" &&
  process.env.VERA_ZILLOW_BROWSER_RESEARCH_ENABLED === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.VERA_LIVE_TEST_USER_ID) &&
  Boolean(process.env.VERA_LIVE_TEST_PROFILE_ID);

const connection = enabled ? openPostgresConnection(parsePostgresConfig(process.env)) : null;

afterAll(async () => {
  await connection?.close();
});

describe.skipIf(!enabled)("opt-in live founder Zillow research", () => {
  it("imports at least one observed listing through the bounded source job", async () => {
    if (!connection) throw new Error("Live Zillow test connection is unavailable.");
    const userId = VeraUserIdSchema.parse(process.env.VERA_LIVE_TEST_USER_ID);
    const profileId = process.env.VERA_LIVE_TEST_PROFILE_ID!;
    const repositoryProvider = createPostgresRepositoryProvider(connection);
    const repositories = repositoryProvider.forUser(userId);
    const runtimeResolver = new BrowserGatewayRuntimeResolver({
      assignments: createPostgresBrowserGatewayAssignmentRepository(connection),
      betaAccess: createPostgresBetaAccessRepository(connection),
      repositoryProvider,
      secretStore: new EnvironmentBrowserGatewaySecretStore(process.env),
      environment: process.env,
      now: () => new Date()
    });
    const browserRuntime = await runtimeResolver.resolveForUser(userId);
    if (!browserRuntime) throw new Error("Live Zillow test browser assignment is unavailable.");
    const policy: SourcePolicyRegistry = await createPersistedPolicyRegistry(repositories);
    const live = createLiveSearchDependencies(
      userId,
      repositories,
      repositoryProvider,
      {
        ...process.env,
        RENTCAST_API_KEY: process.env.RENTCAST_API_KEY ?? "unused-zillow-only",
        MARITIME_API_KEY: process.env.MARITIME_API_KEY ?? "unused-zillow-only",
        MARITIME_OPENCLAW_AGENT_ID: process.env.MARITIME_OPENCLAW_AGENT_ID ?? "unused-zillow-only"
      },
      policy
    );
    const runId = randomUUID();
    const result = await runRentalResearch(
      {
        veraRunId: runId,
        searchProfileId: profileId,
        selectedSources: ["zillow"],
        confirmedExternalUsage: true
      },
      createRentalResearchDependencies(
        userId,
        repositories,
        repositoryProvider,
        live,
        browserRuntime,
        process.env
      )
    );

    const zillow = result.sources.find((source) => source.source === "zillow");
    expect(zillow).toMatchObject({
      state: expect.stringMatching(/^(?:completed|partial)$/u),
      importedCount: expect.any(Number)
    });
    expect(zillow!.importedCount).toBeGreaterThan(0);
    const events = (await repositories.activityEvents.list()).filter(
      (event) => event.correlationId === runId
    );
    const imported = events.find(
      (event) => event.action === "live_listing_imported" && event.metadata.provider === "zillow"
    );
    expect(imported).toBeDefined();
    const raw = await repositories.rawListings.getById(imported!.targetId);
    expect(raw).toMatchObject({
      source: "zillow",
      acquisitionMode: "local_browser",
      captureMethod: "local_browser",
      sourceUrl: expect.stringMatching(/^https:\/\/www\.zillow\.com\//u),
      captureMetadata: {
        connectorId: "zillow.browser-research.v1",
        extractionMethod: "openclaw_semantic_snapshot",
        searchProfileId: profileId
      }
    });
    expect(JSON.stringify(raw)).not.toMatch(/cookie|credential|rawSnapshot|screenshot/iu);
    const actions = events
      .filter((event) => event.action === "browser.zillow_research_action_checked")
      .map((event) => event.metadata.action);
    expect(actions).not.toEqual(
      expect.arrayContaining(["contact", "apply", "tour", "message", "payment"])
    );
  }, 120_000);
});
