import { describe, expect, it } from "vitest";

import type { BrowserResearchOutput, BrowserResearchPlan } from "@vera/domain";

import { LoopbackBrowserResearchClient } from "./loopback-browser-research-client.ts";

const token = "loopback-browser-research-test-token-0000000000000000";
const plan = {
  version: "1",
  veraRunId: "run-1",
  source: "apartments_com",
  profile: { location: "Boston, MA", maximumRentUsd: 3_000, minimumBedrooms: 1 },
  maxResults: 10,
  maxDetailPages: 5,
  maxActions: 50,
  maxDurationMilliseconds: 90_000,
  startingTabReference: {
    kind: "single_shared_tab",
    value: "explicitly_shared_zillow_rental_tab"
  },
  allowedHostnames: ["www.apartments.com"],
  allowedUrlPatterns: ["^https://www\\.apartments\\.com/(?:[^?#]+/)?(?:\\?[^#]*)?$"],
  enabledSafeActionTypes: [
    "inspect_shared_tabs",
    "create_source_tab",
    "navigate_same_source",
    "snapshot",
    "scroll_bounded",
    "select_reviewed_filter",
    "fill_approved_search_field",
    "open_observed_listing",
    "return_to_results",
    "extract_observed_facts"
  ],
  issuedAt: "2026-08-04T15:00:00.000Z",
  expiresAt: "2026-08-04T15:02:00.000Z",
  signature: "a".repeat(64)
} as BrowserResearchPlan;
const output = {
  version: "1",
  veraRunId: "run-1",
  source: "apartments_com",
  state: "no_results",
  pageState: "no_results",
  manualAction: null,
  listings: [],
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  actionsUsed: 1,
  startedAt: "2026-08-04T15:00:01.000Z",
  completedAt: "2026-08-04T15:00:02.000Z",
  safeActionTrail: [],
  warnings: []
} as BrowserResearchOutput;

describe("LoopbackBrowserResearchClient", () => {
  it("posts only an exact plan to the authenticated loopback bridge", async () => {
    let captured: { method: string; authorization: string | null; body: unknown } | null = null;
    const client = new LoopbackBrowserResearchClient({
      url: "http://127.0.0.1:3002/research",
      token,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        captured = {
          method: request.method,
          authorization: request.headers.get("authorization"),
          body: await request.json()
        };
        return Response.json(output);
      }
    });
    await expect(client.run(plan, { signal: new AbortController().signal })).resolves.toEqual(
      output
    );
    expect(captured).toEqual({ method: "POST", authorization: `Bearer ${token}`, body: plan });
  });

  it("rejects non-loopback, credentialed, and non-exact bridge URLs", () => {
    for (const url of [
      "https://example.com/research",
      "http://user@127.0.0.1:3002/research",
      "http://127.0.0.1:3002/other",
      "http://127.0.0.1:3002/research?next=1"
    ]) {
      expect(() => new LoopbackBrowserResearchClient({ url, token })).toThrow();
    }
  });
});
