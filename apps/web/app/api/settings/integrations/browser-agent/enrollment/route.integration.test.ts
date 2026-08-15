import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserGatewayAssignment, VeraUserId } from "@vera/domain";
import { BrowserConnectorEnrollmentIssueError } from "@vera/db";
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

const validBody = {
  confirmation: "connect_read_only_browser",
  extensionVersion: "2.2.0",
  protocolVersion: "1",
  installationDigest: "c".repeat(64),
  idempotencyKey: "d".repeat(64)
};

function request(body: unknown = validBody, origin = "https://app.verahousing.app"): Request {
  return new Request(
    "https://app.verahousing.app/api/settings/integrations/browser-agent/enrollment",
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

function configureApplication(options?: { issueError?: Error }) {
  const append = vi.fn(async (event: unknown) => event);
  const issue = vi.fn(async (input: unknown) => {
    if (options?.issueError) throw options.issueError;
    return input;
  });
  const resolveEnrollmentForUser = vi.fn(async () => assignment);
  mocks.getHostedApplication.mockReturnValue({
    browserConnectorEnrollments: { issue },
    browserGatewayRuntime: { resolveEnrollmentForUser }
  });
  mocks.requireVeraSession.mockResolvedValue({
    userId,
    repositories: { activityEvents: { append } },
    repositoryProvider: {},
    demoMode: false
  });
  return { append, issue, resolveEnrollmentForUser };
}

describe("Browser Connector enrollment issuance route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues a short-lived ticket without placing it or credentials in the audit event", async () => {
    const configured = configureApplication();

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      protocolVersion: "1",
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      gatewayOrigin: assignment.gatewayOrigin
    });
    expect(configured.resolveEnrollmentForUser).toHaveBeenCalledWith(userId);
    expect(configured.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        assignmentId: assignment.id,
        installationDigest: validBody.installationDigest,
        ticketDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
      })
    );
    expect(configured.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "browser.connector_enrollment_issued",
        actor: "user",
        targetId: userId
      })
    );
    const auditJson = JSON.stringify(configured.append.mock.calls);
    expect(auditJson).not.toContain(body.ticket);
    expect(auditJson).not.toContain("relayCredential");
    expect(auditJson).not.toContain("checkpointCredential");
  });

  it("fails closed for cross-origin and malformed requests before issuing a ticket", async () => {
    const configured = configureApplication();

    expect((await POST(request(validBody, "https://evil.example"))).status).toBe(403);
    expect((await POST(request({ ...validBody, extensionVersion: "2.1.0" }))).status).toBe(400);
    expect(configured.issue).not.toHaveBeenCalled();
  });

  it("surfaces the atomic active-ticket guard as a bounded rate limit", async () => {
    configureApplication({ issueError: new BrowserConnectorEnrollmentIssueError("ticket_active") });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "rate_limited" });
  });
});
