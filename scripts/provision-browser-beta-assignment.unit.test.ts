import { describe, expect, it, vi } from "vitest";

import type {
  BetaAccessRepository,
  BrowserGatewayAssignmentRepository,
  UserRepositories
} from "@vera/db";
import type { BrowserNodeStatus, VeraUserId } from "@vera/domain";

import {
  parseBrowserAssignmentCommand,
  provisionBrowserAssignment,
  type ProvisionBrowserAssignmentDependencies
} from "./provision-browser-beta-assignment.ts";

const userA = "00000000-0000-4000-8000-000000000013" as VeraUserId;
const assignmentId = "10000000-0000-4000-8000-000000000013";
const now = "2026-08-14T02:00:00.000Z";
const arguments_ = [
  "--confirm-user",
  userA,
  "--node-id",
  "browser-node-a",
  "--agent-id",
  "maritime-agent-a",
  "--gateway-origin",
  "https://gateway-a.verahousing.app",
  "--secret-reference",
  "TESTER_A_202608",
  "--relay-digest-file",
  "/private/relay.digest",
  "--checkpoint-digest-file",
  "/private/checkpoint.digest"
] as const;

const node: BrowserNodeStatus = {
  nodeId: "browser-node-a",
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
  lastHeartbeatAt: now,
  heartbeatExpiresAt: "2026-08-14T02:05:00.000Z",
  lastSuccessfulCaptureAt: null,
  disabledAt: null,
  contractVersion: 2,
  capabilities: { navigation: false, capture: true, cancellation: true },
  createdAt: now,
  updatedAt: now
};

function dependencies(): ProvisionBrowserAssignmentDependencies {
  const createPending = vi.fn(
    async (input: Parameters<BrowserGatewayAssignmentRepository["createPending"]>[0]) => ({
      ...input,
      status: "pending" as const,
      activatedAt: null,
      revokedAt: null
    })
  );
  return {
    betaAccess: { isActiveUser: vi.fn(async () => true) } as Pick<
      BetaAccessRepository,
      "isActiveUser"
    >,
    assignments: {
      createPending,
      getLatestForUser: vi.fn(async () => null)
    } as unknown as BrowserGatewayAssignmentRepository,
    repositories: {
      browserIntegrationControls: {
        get: vi.fn(async () => ({
          userBrowserEnabled: true,
          zillowSourceEnabled: true,
          updatedAt: now
        }))
      },
      browserNodes: { list: vi.fn(async () => [node]) },
      browserProfileControls: {
        get: vi.fn(async () => ({
          nodeId: node.nodeId,
          profileId: node.selectedProfileId!,
          disabledAt: null,
          updatedAt: now
        }))
      }
    } as unknown as Pick<
      UserRepositories,
      "browserNodes" | "browserProfileControls" | "browserIntegrationControls"
    >,
    browserBetaUserIds: new Set([userA]),
    readDigestFile: vi.fn((path: string) =>
      path.includes("relay") ? "a".repeat(64) : "b".repeat(64)
    ),
    createId: () => assignmentId,
    now: () => new Date(now)
  };
}

describe("browser beta assignment provisioning", () => {
  it("requires the exact safe flag set", () => {
    expect(parseBrowserAssignmentCommand(arguments_)).toMatchObject({
      kind: "create",
      userId: userA,
      nodeId: node.nodeId,
      agentId: "maritime-agent-a",
      secretReference: "TESTER_A_202608"
    });
    expect(() => parseBrowserAssignmentCommand([...arguments_, "--extra", "value"])).toThrow();
    expect(
      parseBrowserAssignmentCommand([
        "--activate-assignment",
        "20000000-0000-4000-8000-000000000013"
      ])
    ).toEqual({
      kind: "activate",
      assignmentId: "20000000-0000-4000-8000-000000000013"
    });
  });

  it("creates only a pending assignment and returns no raw credential or routing material", async () => {
    const input = parseBrowserAssignmentCommand(arguments_);
    if (input.kind !== "create") throw new Error("expected create command");
    const configured = dependencies();

    const output = await provisionBrowserAssignment(input, configured);

    expect(output).toEqual({
      assignmentId,
      userId: userA,
      status: "pending",
      secretReference: "TESTER_A_202608"
    });
    expect(JSON.stringify(output)).not.toMatch(
      /wss:|Bearer|pairing|checkpoint-a|maritime-key|gateway-a/iu
    );
    expect(configured.assignments.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        relayCredentialDigest: "a".repeat(64),
        checkpointCredentialDigest: "b".repeat(64),
        checkpointOrigin: "https://app.verahousing.app"
      })
    );
  });

  it("fails closed for a user outside the allowlist or inactive membership", async () => {
    const input = parseBrowserAssignmentCommand(arguments_);
    if (input.kind !== "create") throw new Error("expected create command");
    const notAllowed = dependencies();
    Object.assign(notAllowed, { browserBetaUserIds: new Set<VeraUserId>() });
    await expect(provisionBrowserAssignment(input, notAllowed)).rejects.toThrow("allowlist");

    const inactive = dependencies();
    vi.mocked(inactive.betaAccess.isActiveUser).mockResolvedValue(false);
    await expect(provisionBrowserAssignment(input, inactive)).rejects.toThrow("active Vera beta");
    expect(inactive.assignments.createPending).not.toHaveBeenCalled();
  });
});
