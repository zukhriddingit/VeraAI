import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserGatewayAssignment, VeraUserId } from "@vera/domain";
import type * as SessionModule from "../../../../../../lib/server/session.ts";

const mocks = vi.hoisted(() => ({
  getHostedApplication: vi.fn(),
  requireVeraSession: vi.fn()
}));

vi.mock("../../../../../../lib/server/application.ts", () => ({
  getHostedApplication: mocks.getHostedApplication
}));
vi.mock("../../../../../../lib/server/session.ts", async (importOriginal) => {
  const original = await importOriginal<typeof SessionModule>();
  return { ...original, requireVeraSession: mocks.requireVeraSession };
});

import { POST as revokeAssignment } from "./revoke/route.ts";
import { GET as getAssignment } from "./route.ts";

const userA = "00000000-0000-4000-8000-000000000013" as VeraUserId;
const userB = "00000000-0000-4000-8000-000000000014" as VeraUserId;
const now = "2026-08-14T02:00:00.000Z";

const activeAssignment: BrowserGatewayAssignment = {
  id: "10000000-0000-4000-8000-000000000013",
  userId: userA,
  nodeId: "private-node-a",
  maritimeAgentId: "private-agent-a",
  gatewayOrigin: "https://gateway-a.verahousing.app",
  checkpointOrigin: "https://app.verahousing.app",
  secretReference: "BETA_USER_A",
  relayCredentialDigest: "a".repeat(64),
  checkpointCredentialDigest: "b".repeat(64),
  status: "active",
  createdAt: now,
  activatedAt: now,
  revokedAt: null
};

function configureApplication(initial: BrowserGatewayAssignment | null) {
  let latest = initial;
  const append = vi.fn(async (event: unknown) => event);
  const assignments = {
    getLatestForUser: vi.fn(async () => latest),
    listEnabledConnectorIdsForUser: vi.fn(async () => ["zillow.browser-research.v2"]),
    revokeForUser: vi.fn(
      async ({ userId, revokedAt }: { userId: VeraUserId; revokedAt: string }) => {
        if (!latest || latest.userId !== userId || latest.status === "revoked") return null;
        latest = { ...latest, status: "revoked", revokedAt };
        return latest;
      }
    )
  };
  const repositories = {
    browserNodes: { getById: vi.fn(async () => null) },
    activityEvents: { append }
  };
  mocks.getHostedApplication.mockReturnValue({
    browserGatewayAssignments: assignments,
    browserGatewayRuntime: null,
    repositoryProvider: {}
  });
  mocks.requireVeraSession.mockResolvedValue({
    userId: userA,
    repositories,
    repositoryProvider: {},
    demoMode: false
  });
  return { append, assignments };
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://app.verahousing.app${path}`, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            origin: "https://app.verahousing.app",
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        })
  });
}

describe("Browser Connector assignment routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a secret-free waiting state before concierge onboarding", async () => {
    configureApplication(null);

    const response = await getAssignment(
      request("/api/settings/integrations/browser-agent/assignment")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "waiting_for_onboarding",
      browserReady: false,
      nodeState: "not_registered",
      enabledSources: [],
      recoveryCode: "awaiting_concierge"
    });
    expect(JSON.stringify(body)).not.toMatch(/agent|origin|secret|digest|token|credential/iu);
  });

  it("revokes only the authenticated user's assignment and remains idempotent", async () => {
    const configured = configureApplication(activeAssignment);
    const url = "/api/settings/integrations/browser-agent/assignment/revoke";

    const first = await revokeAssignment(
      request(url, { confirmation: "revoke_browser_connector" })
    );
    const second = await revokeAssignment(
      request(url, { confirmation: "revoke_browser_connector" })
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "revoked", browserReady: false });
    expect(second.status).toBe(200);
    expect(configured.assignments.revokeForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userA })
    );
    expect(configured.assignments.revokeForUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: userB })
    );
    expect(configured.append).toHaveBeenCalledTimes(1);
    expect(configured.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "browser.assignment_revoked",
        actor: "user",
        targetId: activeAssignment.id
      })
    );
  });

  it("requires the exact confirmation and same-origin request", async () => {
    const configured = configureApplication(activeAssignment);
    const path = "/api/settings/integrations/browser-agent/assignment/revoke";
    expect((await revokeAssignment(request(path, { confirmation: "yes" }))).status).toBe(400);
    const crossOrigin = new Request(`https://app.verahousing.app${path}`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "revoke_browser_connector" })
    });
    expect((await revokeAssignment(crossOrigin)).status).toBe(403);
    expect(configured.assignments.revokeForUser).not.toHaveBeenCalled();
  });
});
