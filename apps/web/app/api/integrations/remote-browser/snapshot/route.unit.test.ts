import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as RemoteExtensionSnapshotServiceModule from "../../../../../lib/remote-extension-snapshot-service.ts";
import type * as RequestSecurityModule from "../../../../../lib/server/request-security.ts";

const mocks = vi.hoisted(() => ({
  requireVeraSession: vi.fn(),
  assertSameOriginMutation: vi.fn(),
  requestRemoteExtensionSnapshot: vi.fn(),
  createRemoteExtensionSnapshotDependencies: vi.fn()
}));

vi.mock("../../../../../lib/server/session.ts", () => ({
  AuthenticationRequiredError: class AuthenticationRequiredError extends Error {},
  requireVeraSession: mocks.requireVeraSession
}));
vi.mock("../../../../../lib/server/request-security.ts", async (importOriginal) => {
  const original = await importOriginal<typeof RequestSecurityModule>();
  return {
    ...original,
    assertSameOriginMutation: mocks.assertSameOriginMutation
  };
});
vi.mock("../../../../../lib/remote-extension-snapshot-service.ts", async (importOriginal) => {
  const original = await importOriginal<typeof RemoteExtensionSnapshotServiceModule>();
  return {
    ...original,
    requestRemoteExtensionSnapshot: mocks.requestRemoteExtensionSnapshot,
    createRemoteExtensionSnapshotDependencies: mocks.createRemoteExtensionSnapshotDependencies
  };
});
vi.mock("../../../../../lib/server/application.ts", () => ({
  getHostedApplication: vi.fn(() => ({ mode: "hosted" }))
}));

import { POST } from "./route.ts";

const founderId = "11111111-1111-4111-8111-111111111111";
const confirmation = {
  sharedExactlyOneTab: true,
  approvesReadOnlySnapshot: true,
  understandsNoBrowserInteraction: true,
  understandsConnectivitySpikeOnly: true
};

describe("remote browser snapshot API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVeraSession.mockResolvedValue({
      userId: founderId,
      repositories: {},
      repositoryProvider: {},
      demoMode: false
    });
    mocks.createRemoteExtensionSnapshotDependencies.mockReturnValue({});
    mocks.requestRemoteExtensionSnapshot.mockResolvedValue({
      requestId: "22222222-2222-4222-8222-222222222222",
      snapshot: {
        schemaVersion: "1",
        capturedAt: "2026-07-25T20:00:00.000Z",
        page: { url: "https://example.test/", title: "Shared listing" },
        textLines: ['- heading "Shared listing"'],
        sourceLineCount: 1,
        returnedLineCount: 1,
        sourceTruncated: false,
        sourceSha256: "a".repeat(64),
        contentSha256: "b".repeat(64)
      }
    });
  });

  it("requires same-origin authenticated consent and returns the minimized result", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/integrations/remote-browser/snapshot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000"
        },
        body: JSON.stringify(confirmation)
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.assertSameOriginMutation).toHaveBeenCalledOnce();
    expect(mocks.requestRemoteExtensionSnapshot).toHaveBeenCalledWith({}, confirmation);
    const body = (await response.json()) as { snapshot: { textLines: string[] } };
    expect(body.snapshot.textLines).toEqual(['- heading "Shared listing"']);
  });

  it("rejects incomplete consent before calling the Gateway", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/integrations/remote-browser/snapshot", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000"
        },
        body: JSON.stringify({ ...confirmation, sharedExactlyOneTab: false })
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.requestRemoteExtensionSnapshot).not.toHaveBeenCalled();
  });
});
