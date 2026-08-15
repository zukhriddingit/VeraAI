import { createHash } from "node:crypto";

import type {
  BrowserGatewayAssignment,
  BrowserIntegrationControl,
  BrowserNodeStatus,
  BrowserProfileControl,
  VeraUserId
} from "@vera/domain";
import type {
  BetaAccessRepository,
  BrowserGatewayAssignmentRepository,
  UserRepositories,
  UserRepositoryProvider
} from "@vera/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserGatewaySecretStore } from "./browser-gateway-secret-store.ts";
import {
  BrowserGatewayAuthorizationError,
  BrowserGatewayRuntimeResolver
} from "./browser-gateway-runtime-resolver.ts";

const userA = "22222222-2222-4222-8222-222222222222" as VeraUserId;
const userB = "33333333-3333-4333-8333-333333333333" as VeraUserId;
const checkpointToken = "checkpoint-token-a".repeat(3);
const checkpointTokenDigest = createHash("sha256").update(checkpointToken, "utf8").digest("hex");

const assignmentA: BrowserGatewayAssignment = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: userA,
  nodeId: "vera-browser-node-tester-a",
  maritimeAgentId: "vera-browser-gateway-tester-a",
  gatewayOrigin: "https://browser-a.verahousing.app",
  checkpointOrigin: "https://app.verahousing.app",
  secretReference: "TESTER_A_202608",
  relayCredentialDigest: "a".repeat(64),
  checkpointCredentialDigest: checkpointTokenDigest,
  status: "active",
  createdAt: "2026-08-13T18:00:00.000Z",
  activatedAt: "2026-08-13T18:05:00.000Z",
  revokedAt: null
};

const node: BrowserNodeStatus = {
  nodeId: assignmentA.nodeId,
  providerId: "openclaw-2026.6.33",
  nodeName: "Tester A browser",
  status: "online",
  pairingState: "paired",
  capabilityApprovalState: "approved",
  selectedProfileId: "vera-search",
  allowedProfileIds: ["vera-search"],
  reportedOpenClawVersion: "2026.6.33",
  expectedOpenClawVersion: "2026.6.33",
  versionCompatibility: "compatible",
  lastHeartbeatAt: "2026-08-13T18:00:00.000Z",
  heartbeatExpiresAt: "2026-08-13T18:30:00.000Z",
  lastSuccessfulCaptureAt: null,
  disabledAt: null,
  contractVersion: 2,
  capabilities: { navigation: false, capture: true, cancellation: true },
  createdAt: "2026-08-13T18:00:00.000Z",
  updatedAt: "2026-08-13T18:00:00.000Z"
};

const environment = {
  VERA_BETA_ACCESS_GATE_ENABLED: "1",
  VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED: "1",
  VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION: "sha256.v1",
  VERA_BROWSER_BETA_USER_IDS: userA,
  VERA_BROWSER_ENROLLMENT_ENABLED: "1",
  VERA_BROWSER_DISABLED: "0",
  VERA_GMAIL_ALERTS_DISABLED: "1",
  VERA_INTEGRATIONS_DISABLED: "1",
  VERA_NOTIFICATIONS_DISABLED: "1",
  VERA_ZILLOW_BROWSER_RESEARCH_ENABLED: "1",
  VERA_APARTMENTS_BROWSER_RESEARCH_ENABLED: "1"
} as const;

function fixture() {
  const getActiveForUser = vi.fn<(userId: VeraUserId) => Promise<BrowserGatewayAssignment | null>>(
    async () => assignmentA
  );
  const getActiveByCheckpointDigest = vi.fn<
    (digest: string) => Promise<BrowserGatewayAssignment | null>
  >(async () => assignmentA);
  const listEnabledConnectorIdsForUser = vi.fn<(userId: VeraUserId) => Promise<readonly string[]>>(
    async () => ["zillow.browser-research.v2", "facebook-marketplace.browser-research.v1"]
  );
  const assignments = {
    getActiveForUser,
    getActiveByCheckpointDigest,
    listEnabledConnectorIdsForUser
  } as unknown as BrowserGatewayAssignmentRepository;
  const isActiveUser = vi.fn(async () => true);
  const betaAccess = { isActiveUser } as unknown as BetaAccessRepository;
  const getControl = vi.fn<() => Promise<BrowserIntegrationControl>>(async () => ({
    userBrowserEnabled: true,
    zillowSourceEnabled: true,
    updatedAt: "2026-08-13T18:00:00.000Z"
  }));
  const getNode = vi.fn<(nodeId: string) => Promise<BrowserNodeStatus | null>>(async () => node);
  const getProfile = vi.fn<
    (nodeId: string, profileId: string) => Promise<BrowserProfileControl | null>
  >(async () => ({
    nodeId: node.nodeId,
    profileId: "vera-search",
    disabledAt: null,
    updatedAt: "2026-08-13T18:00:00.000Z"
  }));
  const repositories = {
    browserIntegrationControls: { get: getControl },
    browserNodes: { getById: getNode },
    browserProfileControls: { get: getProfile }
  } as unknown as UserRepositories;
  const forUser = vi.fn((_userId: VeraUserId) => repositories);
  const repositoryProvider = { forUser } as unknown as UserRepositoryProvider;
  const resolveSecret = vi.fn(async () => ({
    maritimeApiKey: "m".repeat(32),
    planSigningKey: "s".repeat(32)
  }));
  const secretStore = { resolve: resolveSecret } satisfies BrowserGatewaySecretStore;
  const resolver = new BrowserGatewayRuntimeResolver({
    assignments,
    betaAccess,
    repositoryProvider,
    secretStore,
    environment,
    now: () => new Date("2026-08-13T18:10:00.000Z")
  });
  return {
    resolver,
    assignments,
    getActiveForUser,
    getActiveByCheckpointDigest,
    listEnabledConnectorIdsForUser,
    isActiveUser,
    getControl,
    getNode,
    getProfile,
    forUser,
    resolveSecret
  };
}

describe("browser Gateway runtime resolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not return a founder or another user's runtime when assignment is missing", async () => {
    const configured = fixture();
    configured.getActiveForUser.mockResolvedValueOnce(null);
    await expect(configured.resolver.resolveForUser(userA)).resolves.toBeNull();
    expect(configured.resolveSecret).not.toHaveBeenCalled();
    await expect(configured.resolver.resolveForUser(userB)).resolves.toBeNull();
    expect(configured.getActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("intersects exact per-user source controls with global flags", async () => {
    const configured = fixture();
    await expect(configured.resolver.resolveForUser(userA)).resolves.toMatchObject({
      assignment: assignmentA,
      maritimeApiKey: "m".repeat(32),
      planSigningKey: "s".repeat(32)
    });
    const runtime = await configured.resolver.resolveForUser(userA);
    expect(runtime?.enabledSources).toEqual(new Set(["zillow"]));
    expect(configured.forUser).toHaveBeenCalledWith(userA);
    expect(configured.resolveSecret).toHaveBeenCalledWith("TESTER_A_202608");
  });

  it("binds checkpoint credential, origin, and owner before runtime resolution", async () => {
    const configured = fixture();
    await expect(
      configured.resolver.authenticateCheckpoint({
        bearerToken: checkpointToken,
        origin: assignmentA.checkpointOrigin
      })
    ).resolves.toMatchObject({ userId: userA, runtime: { assignment: assignmentA } });
    expect(configured.getActiveByCheckpointDigest).toHaveBeenCalledWith(checkpointTokenDigest);
    expect(configured.forUser).toHaveBeenCalledWith(userA);

    await expect(
      configured.resolver.authenticateCheckpoint({
        bearerToken: checkpointToken,
        origin: "https://evil.example"
      })
    ).rejects.toEqual(new BrowserGatewayAuthorizationError());
  });

  it("authorizes enrollment without requiring a paired node or enabled browser jobs", async () => {
    const configured = fixture();
    const resolver = new BrowserGatewayRuntimeResolver({
      assignments: configured.assignments,
      betaAccess: { isActiveUser: configured.isActiveUser } as unknown as BetaAccessRepository,
      repositoryProvider: { forUser: configured.forUser } as unknown as UserRepositoryProvider,
      secretStore: { resolve: configured.resolveSecret },
      environment: { ...environment, VERA_BROWSER_DISABLED: "1" },
      now: () => new Date("2026-08-13T18:10:00.000Z")
    });
    configured.getNode.mockResolvedValueOnce({ ...node, pairingState: "not_paired" });

    await expect(resolver.resolveEnrollmentForUser(userA)).resolves.toEqual(assignmentA);
    await expect(
      resolver.authenticateEnrollmentCheckpoint({
        bearerToken: checkpointToken,
        origin: assignmentA.checkpointOrigin
      })
    ).resolves.toEqual({ userId: userA, assignment: assignmentA });
    expect(configured.forUser).not.toHaveBeenCalled();
    expect(configured.resolveSecret).not.toHaveBeenCalled();
  });

  it("fails enrollment closed when its dedicated flag or checkpoint origin is invalid", async () => {
    const configured = fixture();
    const disabled = new BrowserGatewayRuntimeResolver({
      assignments: configured.assignments,
      betaAccess: { isActiveUser: configured.isActiveUser } as unknown as BetaAccessRepository,
      repositoryProvider: { forUser: configured.forUser } as unknown as UserRepositoryProvider,
      secretStore: { resolve: configured.resolveSecret },
      environment: { ...environment, VERA_BROWSER_ENROLLMENT_ENABLED: "0" },
      now: () => new Date("2026-08-13T18:10:00.000Z")
    });
    await expect(disabled.resolveEnrollmentForUser(userA)).resolves.toBeNull();
    await expect(
      configured.resolver.authenticateEnrollmentCheckpoint({
        bearerToken: checkpointToken,
        origin: "https://evil.example"
      })
    ).rejects.toEqual(new BrowserGatewayAuthorizationError());
  });

  it("rejects short credentials before assignment or repository lookup", async () => {
    const configured = fixture();
    await expect(
      configured.resolver.authenticateCheckpoint({
        bearerToken: "short",
        origin: assignmentA.checkpointOrigin
      })
    ).rejects.toEqual(new BrowserGatewayAuthorizationError());
    expect(configured.getActiveByCheckpointDigest).not.toHaveBeenCalled();
    expect(configured.forUser).not.toHaveBeenCalled();
  });

  it("returns no runtime when the assignment secret reference cannot resolve", async () => {
    const configured = fixture();
    configured.resolveSecret.mockRejectedValueOnce(new Error("secret unavailable"));
    await expect(configured.resolver.resolveForUser(userA)).resolves.toBeNull();
  });

  it.each([
    ["browser disabled", { environment: { ...environment, VERA_BROWSER_DISABLED: "1" } }],
    ["beta gate disabled", { environment: { ...environment, VERA_BETA_ACCESS_GATE_ENABLED: "0" } }],
    [
      "assignment routing disabled",
      { environment: { ...environment, VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED: "0" } }
    ],
    [
      "assignment hash version missing",
      { environment: { ...environment, VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION: "" } }
    ],
    ["user control disabled", { userBrowserEnabled: false }],
    ["node unpaired", { pairingState: "not_paired" }],
    ["node expired", { heartbeatExpiresAt: "2026-08-13T18:09:59.000Z" }],
    ["profile disabled", { profileDisabledAt: "2026-08-13T18:09:00.000Z" }]
  ] as const)("fails closed when %s", async (_label, change) => {
    const configured = fixture();
    if ("environment" in change) {
      const resolver = new BrowserGatewayRuntimeResolver({
        assignments: configured.assignments,
        betaAccess: { isActiveUser: configured.isActiveUser } as unknown as BetaAccessRepository,
        repositoryProvider: { forUser: configured.forUser } as unknown as UserRepositoryProvider,
        secretStore: { resolve: configured.resolveSecret },
        environment: change.environment,
        now: () => new Date("2026-08-13T18:10:00.000Z")
      });
      await expect(resolver.resolveForUser(userA)).resolves.toBeNull();
      return;
    }
    if ("userBrowserEnabled" in change) {
      configured.getControl.mockResolvedValueOnce({
        userBrowserEnabled: change.userBrowserEnabled,
        zillowSourceEnabled: true,
        updatedAt: "2026-08-13T18:00:00.000Z"
      });
    }
    if ("pairingState" in change) {
      configured.getNode.mockResolvedValueOnce({ ...node, pairingState: change.pairingState });
    }
    if ("heartbeatExpiresAt" in change) {
      configured.getNode.mockResolvedValueOnce({
        ...node,
        heartbeatExpiresAt: change.heartbeatExpiresAt
      });
    }
    if ("profileDisabledAt" in change) {
      configured.getProfile.mockResolvedValueOnce({
        nodeId: node.nodeId,
        profileId: "vera-search",
        disabledAt: change.profileDisabledAt,
        updatedAt: "2026-08-13T18:10:00.000Z"
      });
    }
    await expect(configured.resolver.resolveForUser(userA)).resolves.toBeNull();
    expect(configured.resolveSecret).not.toHaveBeenCalled();
  });
});
