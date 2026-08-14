import { describe, expect, it, vi } from "vitest";

import type { VeraUserId } from "@vera/domain";
import { MaritimeRemoteExtensionError, type MaritimeRemoteExtensionClient } from "@vera/connectors";

import {
  RemoteExtensionSnapshotServiceError,
  parseRemoteExtensionSnapshotEnvironment,
  requestRemoteExtensionSnapshot,
  type RemoteExtensionSnapshotDependencies
} from "./remote-extension-snapshot-service.ts";

const founderId = "11111111-1111-4111-8111-111111111111" as VeraUserId;
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

function dependencies(
  patch: Partial<RemoteExtensionSnapshotDependencies> = {}
): RemoteExtensionSnapshotDependencies {
  return {
    userId: founderId,
    environment: {
      enabled: true,
      browserDisabled: false,
      founderUserId: founderId,
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
  it("parses a separate founder-bound browser Gateway configuration", () => {
    expect(
      parseRemoteExtensionSnapshotEnvironment({
        VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED: "1",
        VERA_BROWSER_DISABLED: "0",
        VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: founderId,
        MARITIME_BROWSER_GATEWAY_API_KEY: "synthetic-key",
        MARITIME_BROWSER_GATEWAY_AGENT_ID: "founder-browser-gateway"
      })
    ).toEqual({
      enabled: true,
      browserDisabled: false,
      founderUserId: founderId,
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
      "wrong founder",
      { founderUserId: "33333333-3333-4333-8333-333333333333" as VeraUserId },
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
