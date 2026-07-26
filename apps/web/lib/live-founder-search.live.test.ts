import { randomUUID } from "node:crypto";

import {
  DEFAULT_LIVE_AGENT_PROMPT_VERSION,
  MaritimeOpenClawClient,
  RentCastConnector
} from "@vera/connectors";
import {
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig
} from "@vera/db";
import { VeraUserIdSchema } from "@vera/domain";
import { SourcePolicyRegistry } from "@vera/policy";
import { afterAll, describe, expect, it } from "vitest";

import { runLiveSearch } from "./live-search-service.ts";

const enabled =
  process.env.VERA_RUN_LIVE_FOUNDER_SEARCH_TESTS === "1" &&
  process.env.VERA_LIVE_AGENT_SEARCH_ENABLED === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.RENTCAST_API_KEY) &&
  Boolean(process.env.MARITIME_API_KEY) &&
  Boolean(process.env.MARITIME_OPENCLAW_AGENT_ID) &&
  Boolean(process.env.VERA_LIVE_TEST_USER_ID) &&
  Boolean(process.env.VERA_LIVE_TEST_PROFILE_ID);

const connection = enabled ? openPostgresConnection(parsePostgresConfig(process.env)) : null;

afterAll(async () => {
  await connection?.close();
});

describe.skipIf(!enabled)("live founder rental search", () => {
  it("persists RentCast evidence through the normal ingestion queue after Maritime analysis", async () => {
    if (!connection) throw new Error("Live test connection is unavailable.");
    const userId = VeraUserIdSchema.parse(process.env.VERA_LIVE_TEST_USER_ID);
    const profileId = process.env.VERA_LIVE_TEST_PROFILE_ID!;
    const repositoryProvider = createPostgresRepositoryProvider(connection);
    const repositories = repositoryProvider.forUser(userId);
    const policy = new SourcePolicyRegistry(await repositories.sourcePolicyManifests.listLatest());
    const result = await runLiveSearch(
      { searchProfileId: profileId, confirmedExternalUsage: true },
      {
        userId,
        repositoryProvider,
        repositories,
        rentCast: new RentCastConnector({
          apiKey: process.env.RENTCAST_API_KEY!,
          policyRegistry: policy
        }),
        maritime: new MaritimeOpenClawClient({
          apiKey: process.env.MARITIME_API_KEY!,
          agentId: process.env.MARITIME_OPENCLAW_AGENT_ID!,
          promptVersion:
            process.env.VERA_LIVE_AGENT_PROMPT_VERSION ?? DEFAULT_LIVE_AGENT_PROMPT_VERSION
        }),
        now: () => new Date(),
        createId: randomUUID
      }
    );
    expect(result.importedCount).toBeGreaterThan(0);
    const events = (await repositories.activityEvents.list()).filter(
      (event) => event.correlationId === result.searchRunId
    );
    expect(events.some((event) => event.action === "maritime_agent_analysis_completed")).toBe(true);
    const imported = events.find((event) => event.action === "live_listing_imported");
    expect(imported).toBeDefined();
    const raw = await repositories.rawListings.getById(imported!.targetId);
    expect(raw).toMatchObject({
      source: "rentcast",
      acquisitionMode: "official_api",
      sourceListingId: expect.any(String),
      observedAt: expect.any(String)
    });
    expect(await repositories.normalizationJobs.getByRawListingId(raw!.id)).not.toBeNull();
  }, 60_000);
});
