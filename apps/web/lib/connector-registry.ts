import {
  FixtureConnector,
  ManualCaptureConnector,
  type CaptureSourceConnector
} from "@vera/connectors";
import type { UserRepositories } from "@vera/db";
import { SourcePolicyRegistry } from "@vera/policy";

export type ConnectorCompositionMode = "hosted" | "demo";

const manualConnector = new ManualCaptureConnector();
const hostedConnectors = Object.freeze([
  manualConnector
]) satisfies readonly CaptureSourceConnector[];
const demoConnectors = Object.freeze([
  new FixtureConnector(),
  manualConnector
]) satisfies readonly CaptureSourceConnector[];

function activeKillSwitches(environment: NodeJS.ProcessEnv): ReadonlySet<string> {
  return new Set(
    (environment.VERA_ACTIVE_KILL_SWITCHES ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
  );
}

export function listSourceConnectors(
  mode: ConnectorCompositionMode
): readonly CaptureSourceConnector[] {
  return mode === "demo" ? demoConnectors : hostedConnectors;
}

export async function createPersistedPolicyRegistry(
  repositories: UserRepositories,
  environment: NodeJS.ProcessEnv = process.env
): Promise<SourcePolicyRegistry> {
  return new SourcePolicyRegistry(await repositories.sourcePolicyManifests.listLatest(), {
    activeKillSwitches: activeKillSwitches(environment)
  });
}
