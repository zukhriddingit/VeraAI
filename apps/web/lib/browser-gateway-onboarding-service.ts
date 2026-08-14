import { BROWSER_SOURCE_CONNECTOR_IDS } from "@vera/connectors";
import {
  BrowserGatewayOnboardingStatusSchema,
  type BrowserGatewayOnboardingStatus,
  type BrowserResearchSource,
  type VeraUserId
} from "@vera/domain";
import type { BrowserGatewayAssignmentRepository, UserRepositories } from "@vera/db";

import type { BrowserGatewayRuntimeResolver } from "./server/browser-gateway-runtime-resolver.ts";

const sourceOrder = Object.keys(BROWSER_SOURCE_CONNECTOR_IDS) as BrowserResearchSource[];

export interface BrowserGatewayOnboardingDependencies {
  readonly userId: VeraUserId;
  readonly assignments: BrowserGatewayAssignmentRepository;
  readonly runtimeResolver: BrowserGatewayRuntimeResolver | null;
  readonly repositories: Pick<UserRepositories, "browserNodes">;
}

function sourcesForConnectorIds(connectorIds: readonly string[]): BrowserResearchSource[] {
  const configured = new Set(connectorIds);
  return sourceOrder.filter((source) => configured.has(BROWSER_SOURCE_CONNECTOR_IDS[source]));
}

export async function getBrowserGatewayOnboardingStatus(
  dependencies: BrowserGatewayOnboardingDependencies
): Promise<BrowserGatewayOnboardingStatus> {
  const assignment = await dependencies.assignments.getLatestForUser(dependencies.userId);
  if (!assignment) {
    return BrowserGatewayOnboardingStatusSchema.parse({
      status: "waiting_for_onboarding",
      browserReady: false,
      nodeState: "not_registered",
      enabledSources: [],
      recoveryCode: "awaiting_concierge"
    });
  }

  if (assignment.status === "revoked") {
    return BrowserGatewayOnboardingStatusSchema.parse({
      status: "revoked",
      browserReady: false,
      nodeState: "revoked",
      enabledSources: [],
      recoveryCode: "revoked_by_user"
    });
  }

  const [connectorIds, node, runtime] = await Promise.all([
    dependencies.assignments.listEnabledConnectorIdsForUser(dependencies.userId),
    dependencies.repositories.browserNodes.getById(assignment.nodeId),
    assignment.status === "active"
      ? (dependencies.runtimeResolver?.resolveForUser(dependencies.userId) ?? null)
      : null
  ]);
  const enabledSources = sourcesForConnectorIds(connectorIds);
  if (assignment.status === "pending") {
    return BrowserGatewayOnboardingStatusSchema.parse({
      status: "pending",
      browserReady: false,
      nodeState: node === null ? "not_registered" : "setup_required",
      enabledSources,
      recoveryCode: "awaiting_activation"
    });
  }
  if (runtime !== null) {
    return BrowserGatewayOnboardingStatusSchema.parse({
      status: "active",
      browserReady: true,
      nodeState: "online",
      enabledSources: [...runtime.enabledSources],
      recoveryCode: null
    });
  }
  const nodeState =
    node === null
      ? "not_registered"
      : node.status === "offline" || node.status === "stale"
        ? "offline"
        : node.status === "revoked"
          ? "revoked"
          : "setup_required";
  return BrowserGatewayOnboardingStatusSchema.parse({
    status: "active",
    browserReady: false,
    nodeState,
    enabledSources,
    recoveryCode: nodeState === "offline" ? "restore_browser_node" : "complete_browser_setup"
  });
}
