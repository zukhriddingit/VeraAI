import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserGatewayAssignment, VeraUserId } from "@vera/domain";
import {
  BrowserGatewayAuthorizationError,
  type BrowserGatewayRuntimeResolver
} from "../../../../../../lib/server/browser-gateway-runtime-resolver.ts";

const mocks = vi.hoisted(() => ({ getHostedApplication: vi.fn() }));

vi.mock("../../../../../../lib/server/application.ts", () => ({
  getHostedApplication: mocks.getHostedApplication
}));

import { POST } from "./route.ts";

const userId = "00000000-0000-4000-8000-000000000013" as VeraUserId;
const assignment: BrowserGatewayAssignment = {
  id: "10000000-0000-4000-8000-000000000013",
  userId,
  nodeId: "private-node-a",
  maritimeAgentId: "private-agent-a",
  gatewayOrigin: "https://gateway-a.verahousing.app",
  checkpointOrigin: "https://app.verahousing.app",
  secretReference: "BETA_USER_A",
  relayCredentialDigest: "a".repeat(64),
  checkpointCredentialDigest: "b".repeat(64),
  status: "active",
  createdAt: "2026-08-14T02:00:00.000Z",
  activatedAt: "2026-08-14T02:00:00.000Z",
  revokedAt: null
};
const checkpoint = {
  ticket: "A".repeat(43),
  extensionVersion: "2.2.0",
  protocolVersion: "1",
  installationId: "c".repeat(64),
  requestedAt: "2026-08-14T12:00:10.000Z"
};

function request(
  body: unknown = checkpoint,
  options?: { origin?: string; token?: string }
): Request {
  return new Request(
    "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options?.token ?? "x".repeat(32)}`,
        origin: options?.origin ?? "https://app.verahousing.app",
        "content-type": "application/json"
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }
  );
}

function configureApplication(outcome: "consumed" | "ticket_replayed" = "consumed") {
  const append = vi.fn(async (event: unknown) => event);
  const consume = vi.fn(async () =>
    outcome === "consumed" ? { outcome, ticket: {} } : { outcome }
  );
  const authenticateEnrollmentCheckpoint = vi.fn(async () => ({ userId, assignment }));
  mocks.getHostedApplication.mockReturnValue({
    browserGatewayRuntime: {
      authenticateEnrollmentCheckpoint
    } as unknown as BrowserGatewayRuntimeResolver,
    browserConnectorEnrollments: { consume },
    repositoryProvider: {
      forUser: vi.fn(() => ({ activityEvents: { append } }))
    }
  });
  return { append, consume, authenticateEnrollmentCheckpoint };
}

describe("Browser Connector enrollment checkpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically consumes a ticket and returns only the allow decision", async () => {
    const configured = configureApplication();

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ allowed: true, assignmentId: assignment.id });
    expect(configured.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        assignmentId: assignment.id,
        ticketDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        installationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })
    );
    const auditJson = JSON.stringify(configured.append.mock.calls);
    expect(auditJson).not.toContain(checkpoint.ticket);
    expect(auditJson).not.toContain(checkpoint.installationId);
    expect(auditJson).not.toMatch(/relay|credential/iu);
  });

  it("preserves a typed replay denial and audits it without secret material", async () => {
    const configured = configureApplication("ticket_replayed");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed: false, reason: "ticket_replayed" });
    expect(configured.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "browser.connector_enrollment_denied",
        policyDecision: "denied",
        outcome: "denied"
      })
    );
  });

  it("authenticates the Gateway before attempting to parse an invalid body", async () => {
    const configured = configureApplication();
    configured.authenticateEnrollmentCheckpoint.mockRejectedValueOnce(
      new BrowserGatewayAuthorizationError()
    );

    const response = await POST(request("{definitely-not-json"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "checkpoint_unauthorized" });
    expect(configured.consume).not.toHaveBeenCalled();
  });

  it("rejects non-exact HTTPS origins before consuming a ticket", async () => {
    const configured = configureApplication();

    const response = await POST(request(checkpoint, { origin: "http://app.verahousing.app" }));

    expect(response.status).toBe(403);
    expect(configured.authenticateEnrollmentCheckpoint).not.toHaveBeenCalled();
    expect(configured.consume).not.toHaveBeenCalled();
  });
});
