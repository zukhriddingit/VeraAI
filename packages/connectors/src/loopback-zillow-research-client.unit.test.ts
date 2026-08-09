import { describe, expect, it } from "vitest";

import type { ZillowRentalResearchInput, ZillowRentalResearchOutput } from "@vera/domain";

import { LoopbackZillowResearchClient } from "./loopback-zillow-research-client.ts";

const token = "loopback-zillow-research-test-token-000000000000000000";
const input = {
  version: "1",
  veraRunId: "zillow-loopback-run-1",
  profile: {
    location: "Boston, MA",
    maximumRentUsd: 3_000,
    minimumBedrooms: 1,
    minimumBathrooms: 1
  },
  maxResults: 10,
  maxDetailPages: 5,
  startingTabReference: {
    kind: "single_shared_tab",
    value: "explicitly_shared_zillow_rental_tab"
  }
} as ZillowRentalResearchInput;
const output = {
  version: "1",
  veraRunId: input.veraRunId,
  state: "failed",
  pageState: "ready",
  manualAction: null,
  listings: [],
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  resultPageExpansions: 0,
  startedAt: "2026-08-09T05:00:00.000Z",
  completedAt: "2026-08-09T05:00:01.000Z",
  safeActionTrail: [],
  warnings: ["Research stopped safely: layout_changed."]
} as ZillowRentalResearchOutput;

describe("LoopbackZillowResearchClient", () => {
  it("posts strict Zillow input only to the authenticated loopback Zillow route", async () => {
    let captured: { url: string; authorization: string | null; body: unknown } | null = null;
    const client = new LoopbackZillowResearchClient({
      url: "http://127.0.0.1:3002/research",
      token,
      fetch: async (requestInput, init) => {
        const request = new Request(requestInput, init);
        captured = {
          url: request.url,
          authorization: request.headers.get("authorization"),
          body: await request.json()
        };
        return Response.json(output);
      }
    });

    await expect(client.run(input, { signal: new AbortController().signal })).resolves.toEqual(
      output
    );
    expect(captured).toEqual({
      url: "http://127.0.0.1:3002/zillow-research",
      authorization: `Bearer ${token}`,
      body: input
    });
  });

  it("rejects non-loopback and non-exact bridge URLs", () => {
    for (const url of [
      "https://example.com/research",
      "http://user@127.0.0.1:3002/research",
      "http://127.0.0.1:3002/zillow-research",
      "http://127.0.0.1:3002/research?next=1"
    ]) {
      expect(() => new LoopbackZillowResearchClient({ url, token })).toThrow();
    }
  });
});
