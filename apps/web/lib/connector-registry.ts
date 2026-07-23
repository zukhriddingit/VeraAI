import {
  FixtureConnector,
  ManualCaptureConnector,
  type CaptureSourceConnector
} from "@vera/connectors";
import type { UserRepositories } from "@vera/db";
import { SourcePolicyRegistry } from "@vera/policy";

const connectors = Object.freeze([
  new FixtureConnector(),
  new ManualCaptureConnector()
]) satisfies readonly CaptureSourceConnector[];

function activeKillSwitches(environment: NodeJS.ProcessEnv): ReadonlySet<string> {
  return new Set(
    (environment.VERA_ACTIVE_KILL_SWITCHES ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
  );
}

export function listSourceConnectors(): readonly CaptureSourceConnector[] {
  return connectors;
}

export async function createPersistedPolicyRegistry(
  repositories: UserRepositories,
  environment: NodeJS.ProcessEnv = process.env
): Promise<SourcePolicyRegistry> {
  return new SourcePolicyRegistry(await repositories.sourcePolicyManifests.listLatest(), {
    activeKillSwitches: activeKillSwitches(environment)
  });
}
