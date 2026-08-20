import { describe, expect, it } from "vitest";

import {
  LoopbackBrowserResearchClient,
  LoopbackZillowResearchClient,
  MaritimeBrowserResearchClient,
  MaritimeZillowResearchClient
} from "@vera/connectors";
import type { BrowserGatewayRuntime } from "@vera/domain";

import {
  assignedBrowserResearchPlanSigningKey,
  createRentalResearchDependencies
} from "./rental-research-service.ts";

const userId = "22222222-2222-4222-8222-222222222222";

function runtime(overrides: Partial<BrowserGatewayRuntime> = {}): BrowserGatewayRuntime {
  return {
    assignment: {
      userId,
      maritimeAgentId: "vera-browser-gateway-founder"
    } as BrowserGatewayRuntime["assignment"],
    maritimeApiKey: "m".repeat(32),
    planSigningKey: "g".repeat(32),
    enabledSources: new Set(["apartments_com"]),
    ...overrides
  };
}

describe("assigned browser research plan signing key", () => {
  it("uses the assignment Gateway key for the Maritime transport", () => {
    expect(assignedBrowserResearchPlanSigningKey(runtime())).toBe("g".repeat(32));
  });

  it("uses the distinct assignment-scoped bridge input key for loopback plans", () => {
    expect(
      assignedBrowserResearchPlanSigningKey(
        runtime({
          browserResearchLoopback: {
            url: "http://127.0.0.1:3002/research",
            token: "t".repeat(32),
            planSigningKey: "l".repeat(32)
          }
        })
      )
    ).toBe("l".repeat(32));
  });

  it("fails closed without an authorized assignment runtime", () => {
    expect(assignedBrowserResearchPlanSigningKey(null)).toBe("");
  });

  it("selects both loopback clients only from assignment-scoped loopback material", () => {
    const dependencies = createRentalResearchDependencies(
      userId,
      {} as never,
      {} as never,
      {} as never,
      runtime({
        browserResearchLoopback: {
          url: "http://127.0.0.1:3002/research",
          token: "t".repeat(32),
          planSigningKey: "l".repeat(32)
        }
      }),
      { NODE_ENV: "test", VERA_BROWSER_DISABLED: "0" }
    );

    expect(dependencies.zillow).toBeInstanceOf(LoopbackZillowResearchClient);
    expect(dependencies.browserResearch).toBeInstanceOf(LoopbackBrowserResearchClient);
    expect(dependencies.browserResearchEnvironment.planSigningKey).toBe("l".repeat(32));
  });

  it("keeps Maritime as the assigned default when loopback material is absent", () => {
    const dependencies = createRentalResearchDependencies(
      userId,
      {} as never,
      {} as never,
      {} as never,
      runtime(),
      { NODE_ENV: "test", VERA_BROWSER_DISABLED: "0" }
    );

    expect(dependencies.zillow).toBeInstanceOf(MaritimeZillowResearchClient);
    expect(dependencies.browserResearch).toBeInstanceOf(MaritimeBrowserResearchClient);
    expect(dependencies.browserResearchEnvironment.planSigningKey).toBe("g".repeat(32));
  });
});
