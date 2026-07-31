import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin, { researchZillowRentals } from "./index.mjs";

const input = {
  version: "1",
  veraRunId: "restart-run-1",
  profile: {
    location: "Boston, MA",
    maximumRentUsd: 3_500,
    minimumBedrooms: 0
  },
  maxResults: 1,
  maxDetailPages: 0,
  startingTabReference: { kind: "target_id", value: "shared-tab-1" }
} as const;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("bounded Zillow plugin restart behavior", () => {
  beforeEach(() => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "synthetic-openclaw-token";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL =
      "https://vera.example.test/api/internal/browser-research/checkpoint";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN = "r".repeat(32);
  });

  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN;
    vi.restoreAllMocks();
  });

  it("registers the same single tool on each startup without mutable registration state", () => {
    const first: string[] = [];
    const second: string[] = [];
    plugin.register({ registerTool: (tool: { name: string }) => first.push(tool.name) });
    plugin.register({ registerTool: (tool: { name: string }) => second.push(tool.name) });
    expect(first).toEqual(["vera_zillow_rental_research_v1"]);
    expect(second).toEqual(first);
  });

  it("starts every invocation with fresh limits and still honors revocation after restart", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
      if (String(request).startsWith("https://vera.example.test/")) {
        return jsonResponse({
          allowed: false,
          reason: "cancelled",
          checkedAt: "2026-07-30T12:00:00.000Z"
        });
      }
      return jsonResponse({ error: "browser work must remain stopped" });
    });
    const dependencies = {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    };
    const first = await researchZillowRentals(input, dependencies);
    const afterRestart = await researchZillowRentals(
      { ...input, veraRunId: "restart-run-2" },
      dependencies
    );
    expect(first).toMatchObject({
      state: "manual_action_required",
      manualAction: "cancelled",
      resultCardsObserved: 0,
      detailPagesOpened: 0,
      resultPageExpansions: 0
    });
    expect(afterRestart).toMatchObject({
      state: "manual_action_required",
      manualAction: "cancelled",
      resultCardsObserved: 0,
      detailPagesOpened: 0,
      resultPageExpansions: 0
    });
    expect(
      fetchImplementation.mock.calls.some(([request]) =>
        String(request).startsWith("http://127.0.0.1:18792/")
      )
    ).toBe(false);
  });
});
