import { describe, expect, it } from "vitest";

import {
  parseRemoteExtensionProxySmokeEnvironment,
  runRemoteExtensionProxySmoke,
  type SmokeSocket,
  type SmokeSocketEvent,
  type SmokeSocketFactory
} from "./remote-extension-proxy-smoke.ts";

const validUrl = "wss://founder-browser.example.test/browser/extension";
const maritimeUrl =
  "wss://api.maritime.sh/a/00000000-1111-2222-3333-444444444444/browser/extension";
const pairingSecret = "a".repeat(64);

class FakeSocket implements SmokeSocket {
  protocol = "";
  readonly listeners = new Map<SmokeSocketEvent, Array<() => void>>();
  closed = false;

  addEventListener(type: SmokeSocketEvent, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: SmokeSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function passingFactory(): SmokeSocketFactory {
  return (url, protocols) => {
    const socket = new FakeSocket();
    queueMicrotask(() => {
      if (
        url === validUrl &&
        protocols[0] === "openclaw-extension-relay" &&
        protocols[1] === `openclaw-extension-token.${pairingSecret}`
      ) {
        socket.protocol = "openclaw-extension-relay";
        socket.emit("open");
      } else {
        socket.emit("error");
      }
    });
    return socket;
  };
}

describe("remote extension proxy smoke", () => {
  it("requires an explicit flag, exact WSS route, and pinned OpenClaw hex pairing secret", () => {
    expect(
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: validUrl,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret,
        VERA_REMOTE_EXTENSION_STABILITY_MS: "1000"
      })
    ).toEqual({
      enabled: true,
      extensionUrl: validUrl,
      pairingSecret,
      stabilityMilliseconds: 1000
    });
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: "https://founder-browser.example.test/",
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/must use WSS/u);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: `${validUrl}?token=secret`,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/query, or fragment/u);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: validUrl,
        OPENCLAW_EXTENSION_PAIRING_SECRET: "a".repeat(43)
      })
    ).toThrow(/64-character lowercase hexadecimal token/u);
    expect(
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: maritimeUrl,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      }).extensionUrl
    ).toBe(maritimeUrl);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: "wss://api.maritime.sh/a/not-an-agent/browser/extension",
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/exact Maritime agent UUID prefix/u);
  });

  it("keeps the unrelated-route denial inside the same Maritime agent prefix", async () => {
    const attemptedUrls: string[] = [];
    const factory: SmokeSocketFactory = (url, protocols) => {
      attemptedUrls.push(url);
      const socket = new FakeSocket();
      queueMicrotask(() => {
        if (
          url === maritimeUrl &&
          protocols[0] === "openclaw-extension-relay" &&
          protocols[1] === `openclaw-extension-token.${pairingSecret}`
        ) {
          socket.protocol = "openclaw-extension-relay";
          socket.emit("open");
        } else {
          socket.emit("error");
        }
      });
      return socket;
    };
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: maritimeUrl,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      socketFactory: factory
    });

    expect(result.outcome).toBe("passed");
    expect(attemptedUrls[0]).toBe(
      "wss://api.maritime.sh/a/00000000-1111-2222-3333-444444444444/__vera_remote_extension_unrelated__"
    );
  });

  it("passes only when unrelated routes and wrong secrets deny before the valid route stays open", async () => {
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: validUrl,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      socketFactory: passingFactory()
    });
    expect(result.outcome).toBe("passed");
    expect(result.checks).toEqual([
      expect.objectContaining({ id: "unrelated_websocket_route_denied", status: "passed" }),
      expect.objectContaining({ id: "wrong_pairing_secret_denied", status: "passed" }),
      expect.objectContaining({ id: "extension_wss_upgrade", status: "passed" }),
      expect.objectContaining({ id: "subprotocol_preserved", status: "passed" }),
      expect.objectContaining({ id: "bounded_connection_stable", status: "passed" }),
      expect.objectContaining({ id: "client_close_completed", status: "passed" })
    ]);
    expect(JSON.stringify(result)).not.toContain(pairingSecret);
    expect(JSON.stringify(result)).not.toContain("founder-browser.example.test");
    expect(result.observations.maritimePayloadLimit).toBe("requires_private_provider_evidence");
  });

  it("fails if the extension route opens with the wrong secret", async () => {
    const factory: SmokeSocketFactory = (url, protocols) => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        if (url === validUrl && protocols[0] === "openclaw-extension-relay") {
          socket.protocol = "openclaw-extension-relay";
          socket.emit("open");
        } else {
          socket.emit("error");
        }
      });
      return socket;
    };
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: validUrl,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      socketFactory: factory
    });
    expect(result.outcome).toBe("failed");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "wrong_pairing_secret_denied", status: "failed" })
    );
  });
});
