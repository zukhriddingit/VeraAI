import { describe, expect, it, vi } from "vitest";

import type { BrowserGatewayRuntime, VeraUserId } from "@vera/domain";
import type { UserRepositories } from "@vera/db";
import { MaritimeRemoteExtensionError, type MaritimeRemoteExtensionClient } from "@vera/connectors";

import {
  createRemoteExtensionSnapshotDependencies,
  RemoteExtensionSnapshotServiceError,
  parseRemoteExtensionSnapshotEnvironment,
  requestRemoteExtensionSnapshot,
  type RemoteExtensionSnapshotDependencies
} from "./remote-extension-snapshot-service.ts";

const founderId = "11111111-1111-4111-8111-111111111111" as VeraUserId;
const otherUserId = "33333333-3333-4333-8333-333333333333" as VeraUserId;
const requestId = "22222222-2222-4222-8222-222222222222";

const confirmation = {
  sharedExactlyOneTab: true,
  approvesReadOnlySnapshot: true,
  understandsNoBrowserInteraction: true,
  understandsConnectivitySpikeOnly: true
};

function snapshot() {
  return {
    schemaVersion: "1" as const,
    capturedAt: "2026-07-25T20:00:00.000Z",
    page: { url: "https://example.test/", title: "Shared listing" },
    textLines: ['- heading "Shared listing"'],
    sourceLineCount: 2,
    returnedLineCount: 1,
    sourceTruncated: false,
    sourceSha256: "a".repeat(64),
    contentSha256: "b".repeat(64)
  };
}

function runtime(userId: VeraUserId): BrowserGatewayRuntime {
  return {
    assignment: {
      id: "44444444-4444-4444-8444-444444444444",
      userId,
      nodeId: "node-private-beta-1",
      maritimeAgentId: "agent-private-beta-1",
      gatewayOrigin: "https://gateway-one.verahousing.app",
      checkpointOrigin: "https://app.verahousing.app",
      secretReference: "BETA_USER_ONE",
      relayCredentialDigest: "a".repeat(64),
      checkpointCredentialDigest: "b".repeat(64),
      status: "active",
      createdAt: "2026-08-13T12:00:00.000Z",
      activatedAt: "2026-08-13T12:01:00.000Z",
      revokedAt: null
    },
    maritimeApiKey: "private-maritime-key",
    planSigningKey: "p".repeat(32),
    enabledSources: new Set(["zillow"])
  };
}

function dependencies(
  patch: Partial<RemoteExtensionSnapshotDependencies> = {}
): RemoteExtensionSnapshotDependencies {
  return {
    userId: founderId,
    environment: {
      enabled: true,
      browserDisabled: false,
      assignmentAuthorized: true,
      gatewayConfigured: true
    },
    client: {
      snapshot: vi.fn(async () => snapshot())
    } as unknown as Pick<MaritimeRemoteExtensionClient, "snapshot">,
    repositories: {
      activityEvents: {
        append: vi.fn(async (event) => event)
      }
    } as unknown as RemoteExtensionSnapshotDependencies["repositories"],
    createId: () => requestId,
    ...patch
  };
}

describe("remote extension snapshot service", () => {
  it("rejects a runtime assigned to another Vera user without a global fallback", async () => {
    const base = dependencies();
    const created = createRemoteExtensionSnapshotDependencies(
      founderId,
      base.repositories as UserRepositories,
      runtime(otherUserId),
      {
        VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED: "1",
        VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: founderId,
        MARITIME_BROWSER_GATEWAY_API_KEY: "legacy-global-key-must-be-ignored"
      }
    );

    expect(created.environment).toMatchObject({
      assignmentAuthorized: false,
      gatewayConfigured: false
    });
    await expect(created.client.snapshot({} as never)).rejects.toEqual(
      new MaritimeRemoteExtensionError("gateway_unavailable", false)
    );
  });

  it("parses a separate assignment-bound browser Gateway configuration", () => {
    expect(
      parseRemoteExtensionSnapshotEnvironment(
        {
          VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED: "1",
          VERA_BROWSER_DISABLED: "0",
          VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: "legacy-value-must-be-ignored",
          MARITIME_BROWSER_GATEWAY_API_KEY: "legacy-value-must-be-ignored"
        },
        true
      )
    ).toEqual({
      enabled: true,
      browserDisabled: false,
      assignmentAuthorized: true,
      gatewayConfigured: true
    });
  });

  it("returns only the strict minimized result for the bound founder", async () => {
    const input = dependencies();
    await expect(requestRemoteExtensionSnapshot(input, confirmation)).resolves.toEqual({
      requestId,
      snapshot: snapshot()
    });
    expect(input.repositories.activityEvents.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "browser.remote_snapshot_completed",
        targetId: requestId,
        payloadHash: "b".repeat(64),
        metadata: {
          protocol: "vera-remote-extension-snapshot.v1",
          safeCode: "minimized_snapshot_returned",
          sourceSha256: "a".repeat(64),
          returnedLineCount: 1,
          sourceTruncated: false
        }
      })
    );
  });

  it.each([
    [
      "browser kill switch",
      { browserDisabled: true },
      new RemoteExtensionSnapshotServiceError("browser_disabled", 409, false)
    ],
    [
      "disabled spike",
      { enabled: false },
      new RemoteExtensionSnapshotServiceError("spike_disabled", 409, false)
    ],
    [
      "wrong assignment",
      { assignmentAuthorized: false },
      new RemoteExtensionSnapshotServiceError("assignment_denied", 403, false)
    ],
    [
      "missing gateway",
      { gatewayConfigured: false },
      new RemoteExtensionSnapshotServiceError("browser_gateway_not_configured", 409, false)
    ]
  ])("fails closed for %s", async (_label, environmentPatch, expected) => {
    const base = dependencies();
    await expect(
      requestRemoteExtensionSnapshot(
        dependencies({
          environment: { ...base.environment, ...environmentPatch }
        }),
        confirmation
      )
    ).rejects.toEqual(expected);
  });

  it("maps the dedicated client error without fallback", async () => {
    const input = dependencies({
      client: {
        snapshot: vi.fn(async () => {
          throw new MaritimeRemoteExtensionError("snapshot_timed_out", false);
        })
      }
    });
    await expect(requestRemoteExtensionSnapshot(input, confirmation)).rejects.toEqual(
      new RemoteExtensionSnapshotServiceError("snapshot_timed_out", 503, false)
    );
    expect(input.repositories.activityEvents.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "browser.remote_snapshot_failed",
        outcome: "failed",
        errorCategory: "transient_provider",
        metadata: expect.objectContaining({ safeCode: "snapshot_timed_out" })
      })
    );
  });
});
