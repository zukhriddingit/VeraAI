import { describe, expect, it } from "vitest";

import { findOpenClawConfigViolations } from "./verify-openclaw-config.ts";

function config(kind: "gateway" | "node", unsafe = false) {
  const base = {
    meta: { lastTouchedVersion: "2026.6.33" },
    update: { channel: "extended-stable", checkOnStart: false, auto: { enabled: false } },
    plugins: {
      enabled: kind === "node",
      bundledDiscovery: "allowlist",
      allow: kind === "node" ? ["browser"] : [],
      deny: [],
      load: { paths: [] },
      slots: { memory: "none" },
      entries: {
        browser: {
          enabled: true,
          hooks: { allowPromptInjection: false, allowConversationAccess: false }
        }
      }
    }
  };
  return kind === "gateway"
    ? {
        ...base,
        gateway: {
          mode: "local",
          bind: "lan",
          controlUi: { enabled: false },
          auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
          nodes: {
            browser: unsafe
              ? { mode: "auto" }
              : { mode: "manual", node: "${VERA_OPENCLAW_NODE_ID}" },
            pairing: { autoApproveCidrs: unsafe ? ["0.0.0.0/0"] : [] },
            allowCommands: unsafe ? ["browser.proxy", "system.run"] : ["browser.proxy"]
          }
        }
      }
    : {
        ...base,
        browser: { enabled: true, evaluateEnabled: unsafe },
        nodeHost: {
          browserProxy: {
            enabled: true,
            allowProfiles: unsafe ? ["vera-zillow", "default"] : ["vera-zillow"]
          }
        }
      };
}

describe("OpenClaw deployment config boundaries", () => {
  it("accepts the browser-only plugin and explicit node/profile routing", () => {
    expect(
      findOpenClawConfigViolations({ gateway: config("gateway"), node: config("node") })
    ).toEqual([]);
  });

  it("rejects broad plugins, auto-routing, auto-approval, and broad profiles", () => {
    expect(
      findOpenClawConfigViolations({ gateway: config("gateway", true), node: config("node", true) })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("additional node command"),
        expect.stringContaining("explicit node"),
        expect.stringContaining("manual"),
        expect.stringContaining("vera-zillow"),
        expect.stringContaining("evaluation")
      ])
    );
  });
});
