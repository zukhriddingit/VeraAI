import { describe, expect, it } from "vitest";

import { parseWorkerRuntimeConfig } from "./runtime-config.ts";

const FOUNDER = "11111111-1111-4111-8111-111111111111";

describe("worker runtime configuration", () => {
  it("defaults every external side-effect lane to disabled", () => {
    expect(parseWorkerRuntimeConfig({}, "run-once")).toMatchObject({
      browserDisabled: true,
      gmailAlertsDisabled: true,
      integrationsDisabled: true,
      notificationsDisabled: true,
      openClawGatewayUrl: null,
      maritimeWorkerAgentId: null
    });
  });

  it.each([
    ["VERA_BROWSER_DISABLED", "maybe"],
    ["VERA_GMAIL_ALERTS_DISABLED", "yes"],
    ["VERA_INTEGRATIONS_DISABLED", "enabled"],
    ["VERA_NOTIFICATIONS_DISABLED", "no"]
  ])("rejects malformed %s", (name, value) => {
    expect(() => parseWorkerRuntimeConfig({ [name]: value }, "run-once")).toThrow(name);
  });

  it("rejects partial Maritime and OpenClaw tuples", () => {
    expect(() =>
      parseWorkerRuntimeConfig({ VERA_MARITIME_WORKER_AGENT_ID: "worker" }, "run-once")
    ).toThrow(/Maritime runtime configuration/u);
    expect(() =>
      parseWorkerRuntimeConfig({ OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789" }, "run-once")
    ).toThrow(/configured together/u);
  });

  it("allows ws only on loopback development and requires wss plus an absolute binary when hosted", () => {
    expect(() =>
      parseWorkerRuntimeConfig(
        {
          OPENCLAW_GATEWAY_URL: "ws://gateway.example.test",
          OPENCLAW_GATEWAY_TOKEN: "synthetic-token-value"
        },
        "run-once"
      )
    ).toThrow(/loopback/u);
    expect(
      parseWorkerRuntimeConfig(
        {
          OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
          OPENCLAW_GATEWAY_TOKEN: "synthetic-token-value"
        },
        "run-once"
      ).openClawGatewayUrl
    ).toBe("ws://127.0.0.1:18789");
    expect(() =>
      parseWorkerRuntimeConfig(
        {
          VERA_MARITIME_ENVIRONMENT: "production",
          OPENCLAW_GATEWAY_URL: "wss://gateway.example.test",
          OPENCLAW_GATEWAY_TOKEN: "synthetic-token-value",
          VERA_OPENCLAW_EXECUTABLE: "openclaw"
        },
        "run-once"
      )
    ).toThrow(/absolute/u);
  });

  it("requires a founder allowlist and full gateway tuple before enabling browser capture", () => {
    expect(() => parseWorkerRuntimeConfig({ VERA_BROWSER_DISABLED: "0" }, "run-once")).toThrow(
      /FOUNDER_USER_IDS/u
    );
    expect(
      parseWorkerRuntimeConfig(
        {
          VERA_BROWSER_DISABLED: "0",
          VERA_BROWSER_FOUNDER_USER_IDS: FOUNDER,
          OPENCLAW_GATEWAY_URL: "ws://localhost:18789",
          OPENCLAW_GATEWAY_TOKEN: "synthetic-token-value"
        },
        "run-once"
      ).browserDisabled
    ).toBe(false);
  });

  it("requires the complete control-plane tuple before hosted serve opens resources", () => {
    expect(() => parseWorkerRuntimeConfig({}, "serve")).toThrow(/Hosted serve mode/u);
    expect(() =>
      parseWorkerRuntimeConfig({ VERA_MARITIME_ENVIRONMENT: "prod" }, "run-once")
    ).toThrow(/development, staging, or production/u);
  });
});
