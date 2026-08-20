import { describe, expect, it } from "vitest";

import {
  BrowserGatewaySecretUnavailableError,
  EnvironmentBrowserGatewaySecretStore
} from "./browser-gateway-secret-store.ts";

describe("environment browser Gateway secret store", () => {
  it("reads only the expected server secret names for an assignment", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY: "m".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY: "s".repeat(32),
      MARITIME_BROWSER_GATEWAY_API_KEY: "legacy-founder-value",
      VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY: "legacy-founder-signing-value"
    });
    await expect(store.resolve("TESTER_A_202608")).resolves.toEqual({
      maritimeApiKey: "m".repeat(32),
      planSigningKey: "s".repeat(32)
    });
  });

  it("binds an optional loopback browser transport to the exact assignment reference", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY: "m".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY: "s".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_URL:
        "http://127.0.0.1:3002/research",
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_TOKEN: "t".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_PLAN_SIGNING_KEY:
        "l".repeat(32)
    });
    await expect(store.resolve("TESTER_A_202608")).resolves.toEqual({
      maritimeApiKey: "m".repeat(32),
      planSigningKey: "s".repeat(32),
      browserResearchLoopback: {
        url: "http://127.0.0.1:3002/research",
        token: "t".repeat(32),
        planSigningKey: "l".repeat(32)
      }
    });
  });

  it("fails closed for incomplete assignment-scoped loopback material", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY: "m".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY: "s".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_URL:
        "http://127.0.0.1:3002/research"
    });
    await expect(store.resolve("TESTER_A_202608")).rejects.toEqual(
      new BrowserGatewaySecretUnavailableError()
    );
  });

  it("fails closed without the loopback transport's distinct plan-signing key", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY: "m".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY: "s".repeat(32),
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_URL:
        "http://127.0.0.1:3002/research",
      VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_BROWSER_RESEARCH_LOOPBACK_TOKEN: "t".repeat(32)
    });
    await expect(store.resolve("TESTER_A_202608")).rejects.toEqual(
      new BrowserGatewaySecretUnavailableError()
    );
  });

  it("fails closed without exact assignment secrets", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({
      MARITIME_BROWSER_GATEWAY_API_KEY: "legacy-founder-value",
      VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY: "legacy-founder-signing-value"
    });
    await expect(store.resolve("TESTER_A_202608")).rejects.toEqual(
      new BrowserGatewaySecretUnavailableError()
    );
  });

  it("rejects a raw or unsafe secret reference before environment lookup", async () => {
    const store = new EnvironmentBrowserGatewaySecretStore({});
    await expect(store.resolve("TESTER/A?token=value")).rejects.toThrow();
  });
});
