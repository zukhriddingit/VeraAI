import { describe, expect, it } from "vitest";

import {
  parseRemoteExtensionProxySmokeEnvironment,
  runRemoteExtensionProxySmoke,
  type WebSocketTransportRunner
} from "./remote-extension-proxy-smoke.ts";
import {
  sanitizeProtocols,
  type SanitizedWebSocketObservation,
  type WebSocketTransportCase
} from "./websocket-transport-probe.ts";

const validUrl = "wss://founder-browser.example.test/browser/extension";
const maritimeUrl =
  "wss://api.maritime.sh/a/00000000-1111-2222-3333-444444444444/browser/extension";
const extensionOrigin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const pairingSecret = "a".repeat(64);

function observation(
  input: WebSocketTransportCase,
  patch: Partial<SanitizedWebSocketObservation>
): SanitizedWebSocketObservation {
  const protocols = sanitizeProtocols(input.protocols, input.credentialProtocolIndexes);
  return {
    caseId: input.caseId,
    reachedOpen: false,
    httpStatus: 403,
    selectedProtocol: null,
    offeredProtocolCount: protocols.protocolCount,
    nonSecretProtocols: protocols.nonSecretProtocols,
    credentialProtocolSha256: protocols.credentialProtocolSha256,
    originPresent: input.origin !== null,
    originScheme: input.origin?.startsWith("chrome-extension://") ? "chrome-extension" : null,
    lifetimeMilliseconds: 10,
    closeCode: null,
    pingPong: "not_run",
    boundedEcho: "not_run",
    errorCode: "http_rejection",
    ...patch
  };
}

function passingRunner(expectedUrl = validUrl): WebSocketTransportRunner {
  return async (input) => {
    const isValid =
      input.url === expectedUrl &&
      input.protocols[0] === "openclaw-extension-relay" &&
      input.protocols[1] === `openclaw-extension-token.${pairingSecret}`;
    if (!isValid) return observation(input, { httpStatus: 401 });
    return observation(input, {
      reachedOpen: true,
      httpStatus: 101,
      selectedProtocol: "openclaw-extension-relay",
      lifetimeMilliseconds: input.stabilityMilliseconds,
      closeCode: 1000,
      pingPong: "passed",
      errorCode: "none"
    });
  };
}

describe("remote extension proxy smoke", () => {
  it("requires an explicit flag, route, origin, and pinned OpenClaw hex secret", () => {
    expect(
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: validUrl,
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret,
        VERA_REMOTE_EXTENSION_STABILITY_MS: "1000"
      })
    ).toEqual({
      enabled: true,
      extensionUrl: validUrl,
      extensionOrigin,
      pairingSecret,
      stabilityMilliseconds: 1000
    });
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: "https://founder-browser.example.test/",
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/must use WSS/u);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: `${validUrl}?token=secret`,
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/query, or fragment/u);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: validUrl,
        OPENCLAW_EXTENSION_ORIGIN: "https://founder-browser.example.test",
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/exact chrome-extension origin/u);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: validUrl,
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: "a".repeat(43)
      })
    ).toThrow(/64-character lowercase hexadecimal token/u);
    expect(
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: maritimeUrl,
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      }).extensionUrl
    ).toBe(maritimeUrl);
    expect(() =>
      parseRemoteExtensionProxySmokeEnvironment({
        VERA_REMOTE_EXTENSION_PROXY_SMOKE: "1",
        OPENCLAW_EXTENSION_GATEWAY_URL: "wss://api.maritime.sh/a/not-an-agent/browser/extension",
        OPENCLAW_EXTENSION_ORIGIN: extensionOrigin,
        OPENCLAW_EXTENSION_PAIRING_SECRET: pairingSecret
      })
    ).toThrow(/exact Maritime agent UUID prefix/u);
  });

  it("keeps unrelated-route denial inside the same Maritime agent prefix", async () => {
    const attemptedUrls: string[] = [];
    const runner: WebSocketTransportRunner = async (input) => {
      attemptedUrls.push(input.url);
      return await passingRunner(maritimeUrl)(input);
    };
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: maritimeUrl,
      extensionOrigin,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      transportRunner: runner
    });

    expect(result.outcome).toBe("passed");
    expect(attemptedUrls[0]).toBe(
      "wss://api.maritime.sh/a/00000000-1111-2222-3333-444444444444/__vera_remote_extension_unrelated__"
    );
  });

  it("passes only when failure paths deny and the valid route stays open", async () => {
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: validUrl,
      extensionOrigin,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      transportRunner: passingRunner()
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
    expect(JSON.stringify(result)).not.toContain(extensionOrigin);
    expect(result.observations.originScheme).toBe("chrome-extension");
    expect(result.observations.maritimePayloadLimit).toBe("requires_private_provider_evidence");
  });

  it("fails if the extension route opens with the wrong secret", async () => {
    const runner: WebSocketTransportRunner = async (input) => {
      const isRoute = input.url === validUrl;
      if (!isRoute) return observation(input, { httpStatus: 404 });
      return observation(input, {
        reachedOpen: true,
        httpStatus: 101,
        selectedProtocol: "openclaw-extension-relay",
        lifetimeMilliseconds: input.stabilityMilliseconds,
        closeCode: 1000,
        pingPong: "passed",
        errorCode: "none"
      });
    };
    const result = await runRemoteExtensionProxySmoke({
      extensionUrl: validUrl,
      extensionOrigin,
      pairingSecret,
      stabilityMilliseconds: 1000,
      timeoutMilliseconds: 1500,
      transportRunner: runner
    });

    expect(result.outcome).toBe("failed");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "wrong_pairing_secret_denied", status: "failed" })
    );
  });
});
