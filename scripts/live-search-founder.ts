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

import {
  assertLiveSearchFounder,
  LiveSearchServiceError,
  parseLiveSearchEnvironment,
  runLiveSearch
} from "../apps/web/lib/live-search-service.ts";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value?.trim() || null;
}

function founderUserId(founders: ReadonlySet<string>): string {
  const requested = option("--user");
  if (requested) return VeraUserIdSchema.parse(requested);
  if (founders.size !== 1) {
    throw new Error("Pass --user <Vera user UUID> when the founder allowlist is not singular.");
  }
  return VeraUserIdSchema.parse([...founders][0]);
}

async function main(): Promise<void> {
  const liveEnvironment = parseLiveSearchEnvironment(process.env);
  const userId = founderUserId(liveEnvironment.founderUserIds);
  assertLiveSearchFounder(userId, liveEnvironment);
  const connection = openPostgresConnection(parsePostgresConfig(process.env));
  try {
    const repositoryProvider = createPostgresRepositoryProvider(connection);
    const repositories = repositoryProvider.forUser(userId);
    const profiles = await repositories.searchProfiles.list();
    const requestedProfileId = option("--profile");
    const profile =
      requestedProfileId === null
        ? profiles.length === 1
          ? profiles[0]
          : null
        : profiles.find((candidate) => candidate.id === requestedProfileId);
    if (!profile) {
      throw new Error(
        "Pass --profile <profile ID>; the founder must already own one real search profile."
      );
    }
    const policy = new SourcePolicyRegistry(await repositories.sourcePolicyManifests.listLatest(), {
      activeKillSwitches: new Set(
        (process.env.VERA_ACTIVE_KILL_SWITCHES ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    });
    const result = await runLiveSearch(
      { searchProfileId: profile.id, confirmedExternalUsage: true },
      {
        userId,
        repositories,
        repositoryProvider,
        rentCast: new RentCastConnector({
          apiKey: process.env.RENTCAST_API_KEY ?? "",
          timeoutMilliseconds: Number(process.env.VERA_RENTCAST_TIMEOUT_MS ?? 12_000),
          maxResponseBytes: Number(process.env.VERA_RENTCAST_MAX_RESPONSE_BYTES ?? 1_000_000),
          policyRegistry: policy
        }),
        maritime: new MaritimeOpenClawClient({
          apiKey: process.env.MARITIME_API_KEY ?? "",
          agentId: process.env.MARITIME_OPENCLAW_AGENT_ID ?? "",
          timeoutMilliseconds: Number(process.env.VERA_LIVE_AGENT_TIMEOUT_MS ?? 30_000),
          maxResponseBytes: Number(process.env.VERA_LIVE_AGENT_MAX_RESPONSE_BYTES ?? 100_000),
          promptVersion:
            process.env.VERA_LIVE_AGENT_PROMPT_VERSION ?? DEFAULT_LIVE_AGENT_PROMPT_VERSION
        }),
        now: () => new Date(),
        createId: randomUUID
      }
    );
    process.stdout.write(
      JSON.stringify({
        searchRunId: result.searchRunId,
        state: result.state,
        retrievedCount: result.retrievedCount,
        importedCount: result.importedCount,
        rejectedCount: result.rejectedCount
      }) + "\n"
    );
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  const safe =
    error instanceof LiveSearchServiceError
      ? {
          code: error.code,
          searchRunId: error.searchRunId,
          retryable: error.retryable
        }
      : { code: "live_search_configuration_error", searchRunId: null, retryable: false };
  process.stderr.write(JSON.stringify({ ok: false, error: safe }) + "\n");
  process.exitCode = 1;
});
