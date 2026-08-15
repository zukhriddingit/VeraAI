import { describe, expect, it, vi } from "vitest";

import type {
  BrowserExtensionReadinessMessage,
  BrowserGatewayOnboardingStatus
} from "@vera/domain";

import {
  BrowserEnrollmentClientError,
  browserEnrollmentRecovery,
  connectBrowser,
  connectionAction
} from "./browser-enrollment-client.ts";

const assignment: BrowserGatewayOnboardingStatus = {
  status: "active",
  browserReady: false,
  nodeState: "setup_required",
  enabledSources: [],
  recoveryCode: "complete_browser_setup"
};
const compatibleUnpaired: BrowserExtensionReadinessMessage = {
  source: "vera-openclaw-extension",
  type: "readiness",
  version: "2",
  paired: false,
  relayState: "off",
  readiness: "not_shared",
  sharedTabCount: 0,
  extensionVersion: "2.2.0",
  enrollmentProtocolVersion: "1",
  installationDigest: "a".repeat(64)
};
const compatiblePaired: BrowserExtensionReadinessMessage = {
  ...compatibleUnpaired,
  paired: true,
  relayState: "on"
};

function browserWindowFixture() {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const browserWindow = {
    location: { origin: "https://app.verahousing.app" },
    addEventListener: vi.fn(
      (_type: "message", listener: (event: MessageEvent<unknown>) => void) => {
        listeners.add(listener);
      }
    ),
    removeEventListener: vi.fn(
      (_type: "message", listener: (event: MessageEvent<unknown>) => void) => {
        listeners.delete(listener);
      }
    ),
    postMessage: vi.fn((message: unknown) => {
      const requestId = (message as { readonly requestId: string }).requestId;
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            source: browserWindow,
            origin: browserWindow.location.origin,
            data: {
              source: "vera-openclaw-extension",
              type: "enrollment-result",
              version: "1",
              requestId,
              state: "connected"
            }
          } as unknown as MessageEvent<unknown>);
        }
      });
    }),
    setTimeout: vi.fn((handler: () => void, milliseconds: number) =>
      Number(setTimeout(handler, milliseconds))
    ),
    clearTimeout: vi.fn((timer: number) => clearTimeout(timer))
  };
  return browserWindow;
}

describe("Browser Connector one-click enrollment client", () => {
  it("selects the safe primary state from extension and assignment readiness", () => {
    expect(connectionAction({ extension: null, assignment })).toBe("install");
    expect(connectionAction({ extension: compatibleUnpaired, assignment: null })).toBe(
      "onboarding"
    );
    expect(connectionAction({ extension: compatibleUnpaired, assignment })).toBe("connect");
    expect(connectionAction({ extension: compatiblePaired, assignment })).toBe("connected");
  });

  it("posts the exact confirmation and passes only the one-time ticket to the extension bridge", async () => {
    const browserWindow = browserWindowFixture();
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        confirmation: "connect_read_only_browser",
        extensionVersion: "2.2.0",
        protocolVersion: "1",
        installationDigest: "a".repeat(64),
        idempotencyKey: "b".repeat(64)
      });
      return Response.json(
        {
          protocolVersion: "1",
          ticket: "A".repeat(43),
          expiresAt: "2026-08-14T12:01:00.000Z",
          gatewayOrigin: "https://gateway-a.verahousing.app"
        },
        { status: 201 }
      );
    });

    const result = await connectBrowser(compatibleUnpaired, {
      windowImplementation: browserWindow,
      fetchImplementation,
      randomUUID: () => "10000000-0000-4000-8000-000000000013",
      digest: async () => "b".repeat(64)
    });
    expect(result).toBe("connected");

    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/settings/integrations/browser-agent/enrollment",
      expect.objectContaining({ method: "POST", cache: "no-store" })
    );
    expect(browserWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "vera-web",
        type: "connect-browser",
        version: "1",
        requestId: "10000000-0000-4000-8000-000000000013",
        confirmation: "connect_read_only_browser",
        ticket: "A".repeat(43),
        expiresAt: "2026-08-14T12:01:00.000Z",
        gatewayOrigin: "https://gateway-a.verahousing.app",
        protocolVersion: "1"
      },
      "https://app.verahousing.app"
    );
    expect(JSON.stringify(result)).not.toContain("A".repeat(43));
  });

  it("maps server and extension failures to actionable secret-free recovery", async () => {
    const browserWindow = browserWindowFixture();
    await expect(
      connectBrowser(compatibleUnpaired, {
        windowImplementation: browserWindow,
        fetchImplementation: async () =>
          Response.json({ code: "device_conflict", message: "Stopped safely." }, { status: 409 }),
        randomUUID: () => "10000000-0000-4000-8000-000000000013",
        digest: async () => "b".repeat(64)
      })
    ).rejects.toEqual(new BrowserEnrollmentClientError("device_conflict"));
    expect(browserEnrollmentRecovery("device_conflict")).toContain("Another Chrome profile");
    expect(browserEnrollmentRecovery("unavailable")).not.toMatch(/ticket|token|credential/iu);
  });
});
