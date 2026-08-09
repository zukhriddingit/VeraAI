import { describe, expect, it } from "vitest";

import {
  buildRelayWsProtocols,
  nearestGroupColor,
  parsePairingString,
  reconnectDelayMs
} from "./relay-core.js";

describe("Vera OpenClaw relay compatibility", () => {
  it("preserves the official pairing and WebSocket subprotocol shape", () => {
    const parsed = parsePairingString("wss://gateway.example/browser/extension#deadbeef");
    expect(parsed).toEqual({
      relayUrl: "wss://gateway.example/browser/extension",
      token: "deadbeef"
    });
    expect(buildRelayWsProtocols("deadbeef")).toEqual([
      "openclaw-extension-relay",
      "openclaw-extension-token.deadbeef"
    ]);
  });

  it("keeps official reconnect and group-color behavior", () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(50)).toBe(30_000);
    expect(nearestGroupColor("#FF4500")).toBe("orange");
  });
});
