import { createHash } from "node:crypto";

import { BROWSER_SOURCE_CONNECTOR_IDS } from "@vera/connectors";
import type {
  BrowserGatewayAssignment,
  BrowserGatewayRuntime,
  BrowserResearchSource,
  VeraUserId
} from "@vera/domain";
import { VeraUserIdSchema } from "@vera/domain";
import type {
  BetaAccessRepository,
  BrowserGatewayAssignmentRepository,
  UserRepositoryProvider
} from "@vera/db";

import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";
import type { BrowserGatewaySecretStore } from "./browser-gateway-secret-store.ts";

const SOURCE_FLAGS = {
  zillow: "VERA_ZILLOW_BROWSER_RESEARCH_ENABLED",
  apartments_com: "VERA_APARTMENTS_BROWSER_RESEARCH_ENABLED",
  facebook_marketplace: "VERA_FACEBOOK_MARKETPLACE_BROWSER_RESEARCH_ENABLED",
  bu_off_campus: "VERA_BU_OFF_CAMPUS_BROWSER_RESEARCH_ENABLED",
  custom_website: "VERA_GENERIC_HOUSING_BROWSER_RESEARCH_ENABLED",
  craigslist: "VERA_CRAIGSLIST_BROWSER_RESEARCH_ENABLED"
} as const satisfies Record<BrowserResearchSource, string>;

export class BrowserGatewayAuthorizationError extends Error {
  readonly code = "browser_gateway_unauthorized" as const;

  constructor() {
    super("Browser Gateway authorization failed.");
    this.name = "BrowserGatewayAuthorizationError";
  }
}

export interface AuthenticatedBrowserCheckpoint {
  readonly userId: VeraUserId;
  readonly runtime: BrowserGatewayRuntime;
}

export interface BrowserGatewayRuntimeResolverDependencies {
  readonly assignments: BrowserGatewayAssignmentRepository;
  readonly betaAccess: BetaAccessRepository;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly secretStore: BrowserGatewaySecretStore;
  readonly environment: Readonly<Record<string, string | undefined>>;
  now(): Date;
}

function parseBrowserBetaUserIds(
  environment: Readonly<Record<string, string | undefined>>
): ReadonlySet<VeraUserId> {
  const raw = environment.VERA_BROWSER_BETA_USER_IDS?.trim() ?? "";
  if (!raw) return new Set();
  const values = raw.split(",").map((value) => VeraUserIdSchema.parse(value.trim()));
  if (values.length > 25 || new Set(values).size !== values.length) {
    throw new Error("VERA_BROWSER_BETA_USER_IDS must contain up to 25 unique Vera user UUIDs.");
  }
  return new Set(values);
}

function globallyEnabledSources(
  environment: Readonly<Record<string, string | undefined>>
): ReadonlySet<BrowserResearchSource> {
  const enabled = new Set<BrowserResearchSource>();
  for (const source of Object.keys(SOURCE_FLAGS) as BrowserResearchSource[]) {
    if (environment[SOURCE_FLAGS[source]] === "1") enabled.add(source);
  }
  return enabled;
}

function checkpointDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class BrowserGatewayRuntimeResolver {
  constructor(private readonly dependencies: BrowserGatewayRuntimeResolverDependencies) {}

  async resolveForUser(userIdInput: VeraUserId): Promise<BrowserGatewayRuntime | null> {
    const userId = VeraUserIdSchema.parse(userIdInput);
    if (!(await this.baseUserAuthorized(userId))) return null;
    const assignment = await this.dependencies.assignments.getActiveForUser(userId);
    if (!assignment) return null;
    return this.resolveAssignment(assignment);
  }

  async authenticateCheckpoint(input: {
    readonly bearerToken: string;
    readonly origin: string;
  }): Promise<AuthenticatedBrowserCheckpoint> {
    const token = input.bearerToken;
    if (
      token.length < 32 ||
      token.length > 512 ||
      token.trim() !== token ||
      /[\u0000-\u001f\u007f]/u.test(token)
    ) {
      throw new BrowserGatewayAuthorizationError();
    }
    const assignment = await this.dependencies.assignments.getActiveByCheckpointDigest(
      checkpointDigest(token)
    );
    if (!assignment || input.origin !== assignment.checkpointOrigin) {
      throw new BrowserGatewayAuthorizationError();
    }
    if (!(await this.baseUserAuthorized(assignment.userId))) {
      throw new BrowserGatewayAuthorizationError();
    }
    const runtime = await this.resolveAssignment(assignment);
    if (!runtime) throw new BrowserGatewayAuthorizationError();
    return { userId: assignment.userId, runtime };
  }

  private async baseUserAuthorized(userId: VeraUserId): Promise<boolean> {
    if (this.dependencies.environment.VERA_BETA_ACCESS_GATE_ENABLED !== "1") return false;
    if (!parseBrowserBetaUserIds(this.dependencies.environment).has(userId)) return false;
    if (parseHostedRuntimePolicy(this.dependencies.environment).browserDisabled) return false;
    return this.dependencies.betaAccess.isActiveUser(userId);
  }

  private async resolveAssignment(
    assignment: BrowserGatewayAssignment
  ): Promise<BrowserGatewayRuntime | null> {
    const repositories = this.dependencies.repositoryProvider.forUser(assignment.userId);
    const [controls, node, connectorIds] = await Promise.all([
      repositories.browserIntegrationControls.get(),
      repositories.browserNodes.getById(assignment.nodeId),
      this.dependencies.assignments.listEnabledConnectorIdsForUser(assignment.userId)
    ]);
    if (!controls.userBrowserEnabled || !node) return null;
    if (
      node.status !== "online" ||
      node.pairingState !== "paired" ||
      node.capabilityApprovalState !== "approved" ||
      node.versionCompatibility !== "compatible" ||
      node.disabledAt !== null ||
      !node.capabilities.capture ||
      !node.capabilities.cancellation ||
      Date.parse(node.heartbeatExpiresAt) <= this.dependencies.now().getTime() ||
      node.selectedProfileId === null ||
      !node.allowedProfileIds.includes(node.selectedProfileId)
    ) {
      return null;
    }
    const profile = await repositories.browserProfileControls.get(
      assignment.nodeId,
      node.selectedProfileId
    );
    if (!profile || profile.disabledAt !== null) return null;

    const permittedConnectors = new Set(connectorIds);
    const globallyEnabled = globallyEnabledSources(this.dependencies.environment);
    const enabledSources = new Set<BrowserResearchSource>();
    for (const source of Object.keys(BROWSER_SOURCE_CONNECTOR_IDS) as BrowserResearchSource[]) {
      if (
        globallyEnabled.has(source) &&
        permittedConnectors.has(BROWSER_SOURCE_CONNECTOR_IDS[source])
      ) {
        enabledSources.add(source);
      }
    }
    if (enabledSources.size === 0) return null;
    try {
      const secrets = await this.dependencies.secretStore.resolve(assignment.secretReference);
      return Object.freeze({ assignment, ...secrets, enabledSources });
    } catch {
      return null;
    }
  }
}
