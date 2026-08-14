import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserGatewayRuntime } from "@vera/domain";
import type * as RequestSecurityModule from "../../../../../lib/server/request-security.ts";

const mocks = vi.hoisted(() => ({
  getHostedApplication: vi.fn(),
  readBoundedJson: vi.fn()
}));

vi.mock("../../../../../lib/server/application.ts", () => ({
  getHostedApplication: mocks.getHostedApplication
}));
vi.mock("../../../../../lib/server/request-security.ts", async (importOriginal) => {
  const original = await importOriginal<typeof RequestSecurityModule>();
  return { ...original, readBoundedJson: mocks.readBoundedJson };
});

import { BrowserGatewayAuthorizationError } from "../../../../../lib/server/browser-gateway-runtime-resolver.ts";
import { checkpointRequestOrigin, parseCheckpointBearer, POST } from "./route.ts";

const userA = "00000000-0000-4000-8000-000000000013";
const userB = "00000000-0000-4000-8000-000000000014";
const bearerA = "checkpoint-a".repeat(4);
const now = "2026-08-14T01:00:00.000Z";
const checkpointBody = {
  version: "1",
  veraRunId: "job-owned-by-user-b",
  action: "snapshot",
  startingTabReference: { kind: "target_id", value: "shared-tab-a" },
  activeTabReference: { kind: "target_id", value: "shared-tab-a" },
  sharedTabCount: 1,
  hostname: "www.zillow.com",
  elapsedMilliseconds: 1_000,
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  resultPageExpansions: 0,
  observedReferenceHash: null,
  requestedAt: now
} as const;

function runtime(): BrowserGatewayRuntime {
  return {
    assignment: {
      id: "10000000-0000-4000-8000-000000000013",
      userId: userA,
      nodeId: "browser-node-a",
      maritimeAgentId: "maritime-agent-a",
      gatewayOrigin: "https://gateway-a.verahousing.app",
      checkpointOrigin: "https://app.verahousing.app",
      secretReference: "BETA_USER_A",
      relayCredentialDigest: "a".repeat(64),
      checkpointCredentialDigest: "b".repeat(64),
      status: "active",
      createdAt: now,
      activatedAt: now,
      revokedAt: null
    },
    maritimeApiKey: "m".repeat(32),
    planSigningKey: "p".repeat(32),
    enabledSources: new Set(["zillow"])
  };
}

function checkpointRequest(overrides: { authorization?: string; origin?: string } = {}): Request {
  return new Request("https://app.verahousing.app/api/internal/browser-research/checkpoint", {
    method: "POST",
    headers: {
      authorization: overrides.authorization ?? `Bearer ${bearerA}`,
      origin: overrides.origin ?? "https://app.verahousing.app",
      "content-type": "application/json"
    },
    body: JSON.stringify(checkpointBody)
  });
}

function configureApplication() {
  const activityEvents = {
    listByTarget: vi.fn(async () => []),
    append: vi.fn(async (event: unknown) => event)
  };
  const repositoriesA = {
    sourceJobs: { getById: vi.fn(async () => null) },
    activityEvents
  };
  const authenticateCheckpoint = vi.fn(async () => ({ userId: userA, runtime: runtime() }));
  const forUser = vi.fn((userId: string) => {
    if (userId !== userA) throw new Error("cross-user repository selection");
    return repositoriesA;
  });
  mocks.getHostedApplication.mockReturnValue({
    browserGatewayRuntime: { authenticateCheckpoint },
    repositoryProvider: { forUser }
  });
  return { authenticateCheckpoint, forUser, repositoriesA };
}

describe("assignment-authenticated browser checkpoint route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERA_BROWSER_DISABLED", "0");
    mocks.readBoundedJson.mockResolvedValue(checkpointBody);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("selects the tenant only after credential authentication and bounded body parsing", async () => {
    const configured = configureApplication();

    const response = await POST(checkpointRequest());

    expect(response.status).toBe(200);
    expect(configured.authenticateCheckpoint).toHaveBeenCalledWith({
      bearerToken: bearerA,
      origin: "https://app.verahousing.app"
    });
    expect(configured.forUser).toHaveBeenCalledWith(userA);
    expect(configured.authenticateCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readBoundedJson.mock.invocationCallOrder[0]!
    );
    expect(mocks.readBoundedJson.mock.invocationCallOrder[0]).toBeLessThan(
      configured.forUser.mock.invocationCallOrder[0]!
    );
  });

  it("cannot use assignment A's credential to select assignment B's repositories", async () => {
    const configured = configureApplication();

    const response = await POST(checkpointRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      allowed: false,
      reason: "run_not_active"
    });
    expect(configured.repositoriesA.sourceJobs.getById).toHaveBeenCalledWith("job-owned-by-user-b");
    expect(configured.forUser).not.toHaveBeenCalledWith(userB);
  });

  it("denies a revoked checkpoint credential before reading the body", async () => {
    const configured = configureApplication();
    configured.authenticateCheckpoint.mockRejectedValue(new BrowserGatewayAuthorizationError());

    const response = await POST(checkpointRequest());

    expect(response.status).toBe(401);
    expect(mocks.readBoundedJson).not.toHaveBeenCalled();
    expect(configured.forUser).not.toHaveBeenCalled();
  });

  it("fails closed for malformed credentials, origins, and missing resolver configuration", async () => {
    configureApplication();
    expect(parseCheckpointBearer(`Bearer ${bearerA}`)).toBe(bearerA);
    expect(() => parseCheckpointBearer(null)).toThrow(BrowserGatewayAuthorizationError);
    expect(() => parseCheckpointBearer("Basic abc")).toThrow(BrowserGatewayAuthorizationError);
    expect(checkpointRequestOrigin(checkpointRequest())).toBe("https://app.verahousing.app");
    expect(() =>
      checkpointRequestOrigin(checkpointRequest({ origin: "https://app.verahousing.app/path" }))
    ).toThrow();

    mocks.getHostedApplication.mockReturnValue({
      browserGatewayRuntime: null,
      repositoryProvider: { forUser: vi.fn() }
    });
    expect((await POST(checkpointRequest())).status).toBe(503);
    expect(mocks.readBoundedJson).not.toHaveBeenCalled();
  });
});
