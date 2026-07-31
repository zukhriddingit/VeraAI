import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin, { researchZillowRentals } from "./index.mjs";
import { validateResearchInput } from "./contract.mjs";
import {
  detectManualBlocker,
  extractResultCards,
  parseZillowSnapshot,
  validateZillowUrl
} from "./zillow-snapshot.mjs";

const readyFixture = JSON.parse(
  readFileSync(new URL("./fixtures/ready-results.json", import.meta.url), "utf8")
) as Record<string, unknown>;
const blockerFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/manual-blockers.json", import.meta.url), "utf8")
) as Record<string, string>;

const input = {
  version: "1",
  veraRunId: "run-1",
  profile: {
    location: "Boston, MA",
    maximumRentUsd: 3_500,
    minimumBedrooms: 2,
    minimumBathrooms: 1
  },
  maxResults: 1,
  maxDetailPages: 1,
  startingTabReference: { kind: "target_id", value: "shared-tab-1" }
} as const;
const consentInput = {
  ...input,
  startingTabReference: {
    kind: "single_shared_tab",
    value: "explicitly_shared_zillow_rental_tab"
  }
} as const;
const resultUrl = "https://www.zillow.com/boston-ma/rentals/";
const detailUrl = "https://www.zillow.com/homedetails/12-Beacon-St-Boston-MA-02108/123456_zpid/";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function snapshotForState(stage: string, currentUrl: string) {
  if (currentUrl === detailUrl) {
    return {
      ok: true,
      format: "ai",
      targetId: "shared-tab-1",
      url: detailUrl,
      snapshot:
        '- heading "12 Beacon St, Boston, MA 02108" [ref=e20]\n- text "$3,200/mo"\n- text "2 beds 1 bath 900 sq ft"\n- text "Available now"\n- text "In-unit laundry Dishwasher"',
      refs: {
        e20: { role: "heading", name: "12 Beacon St, Boston, MA 02108" }
      }
    };
  }
  if (stage === "price") {
    return {
      ok: true,
      format: "ai",
      targetId: "shared-tab-1",
      url: resultUrl,
      snapshot: '- combobox "Max price" [ref=e4]\n- button "Done" [ref=e5]',
      refs: {
        e4: { role: "combobox", name: "Max price" },
        e5: { role: "button", name: "Done" }
      }
    };
  }
  if (stage === "beds") {
    return {
      ok: true,
      format: "ai",
      targetId: "shared-tab-1",
      url: resultUrl,
      snapshot:
        '- button "2 Bedrooms" [ref=e6]\n- button "1 Bathrooms" [ref=e7]\n- button "Done" [ref=e5]',
      refs: {
        e6: { role: "button", name: "2 Bedrooms" },
        e7: { role: "button", name: "1 Bathrooms" },
        e5: { role: "button", name: "Done" }
      }
    };
  }
  return readyFixture;
}

function happyFetch() {
  let stage = "results";
  let currentUrl = resultUrl;
  const calls: Array<{ url: string; method: string; body: unknown; origin: string | null }> = [];
  const fetchImplementation = vi.fn<typeof fetch>(async (request, init) => {
    const url = String(request);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ url, method, body, origin: new Headers(init?.headers).get("origin") });
    if (url === "https://vera.example.test/api/internal/browser-research/checkpoint") {
      return jsonResponse({
        allowed: true,
        reason: "allowed",
        checkedAt: "2026-07-30T12:00:00.000Z"
      });
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/tabs") {
      return jsonResponse({
        tabs: [{ targetId: "shared-tab-1", title: "Boston rentals", url: currentUrl }]
      });
    }
    if (parsed.pathname === "/snapshot") {
      return jsonResponse(snapshotForState(stage, currentUrl));
    }
    if (parsed.pathname === "/act") {
      const action = body as { kind?: string; ref?: string };
      if (action.kind === "click" && action.ref === "e2") stage = "price";
      if (action.kind === "click" && action.ref === "e3") stage = "beds";
      if (action.kind === "click" && action.ref === "e5") stage = "results";
      return jsonResponse({ ok: true, targetId: "shared-tab-1", url: currentUrl });
    }
    if (parsed.pathname === "/navigate") {
      currentUrl = (body as { url: string }).url;
      stage = "results";
      return jsonResponse({ ok: true, targetId: "shared-tab-1", url: currentUrl });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });
  return { calls, fetchImplementation };
}

describe("bounded Zillow contract", () => {
  it("accepts only strict saved-profile fields and fixed limits", () => {
    expect(validateResearchInput(input)).toMatchObject(input);
    for (const extra of [
      { url: resultUrl },
      { selector: ".search" },
      { javascript: "document.body.innerText" },
      { actions: [{ kind: "click", x: 1, y: 1 }] },
      { credentials: { password: "rejected" } }
    ]) {
      expect(() => validateResearchInput({ ...input, ...extra })).toThrowError(
        /invalid_tool_input/u
      );
    }
    expect(() => validateResearchInput({ ...input, maxResults: 11 })).toThrowError(
      /invalid_tool_input/u
    );
    expect(() => validateResearchInput({ ...input, maxDetailPages: 6 })).toThrowError(
      /invalid_tool_input/u
    );
  });

  it("registers exactly the Vera-owned versioned tool", () => {
    const tools: Array<{ name: string; parameters: unknown }> = [];
    plugin.register({
      registerTool(tool: { name: string; parameters: unknown }) {
        tools.push(tool);
      }
    });
    expect(tools.map((tool) => tool.name)).toEqual(["vera_zillow_rental_research_v1"]);
    expect(tools[0]?.parameters).toMatchObject({ additionalProperties: false });
  });
});

describe("Zillow semantic snapshot parser", () => {
  it("accepts only the reviewed result and detail paths", () => {
    expect(validateZillowUrl(resultUrl, "result")).toMatchObject({ kind: "result" });
    expect(validateZillowUrl(detailUrl, "detail")).toMatchObject({ kind: "detail" });
    for (const unsafe of [
      "https://zillow.com/boston-ma/rentals/",
      "https://www.zillow.com/for-sale/",
      "https://www.zillow.com/boston-ma/rentals/#map",
      "https://www.zillow.com/boston-ma/rentals/?session=secret"
    ]) {
      expect(() => validateZillowUrl(unsafe)).toThrow();
    }
  });

  it("extracts only observed card facts and observed detail destinations", () => {
    const document = parseZillowSnapshot(readyFixture);
    expect(extractResultCards(document, 10)).toEqual([
      expect.objectContaining({
        sourceListingId: "123456",
        canonicalObservedUrl: detailUrl,
        address: "12 Beacon St, Boston, MA 02108",
        rentUsd: 3_200,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 900,
        amenities: ["In-unit laundry"]
      })
    ]);
  });

  it.each([
    ["login_required", "login_required"],
    ["two_factor_required", "two_factor_required"],
    ["captcha_required", "captcha_required"],
    ["consent_required", "consent_required"],
    ["blocked", "blocked"]
  ])("detects %s without bypassing it", (fixtureName, pageState) => {
    expect(detectManualBlocker(blockerFixtures[fixtureName] ?? "")).toMatchObject({
      pageState
    });
  });
});

describe("Vera Zillow research execution", () => {
  beforeEach(() => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "synthetic-openclaw-token";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL =
      "https://vera.example.test/api/internal/browser-research/checkpoint";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN = "c".repeat(32);
  });

  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN;
    vi.restoreAllMocks();
  });

  it("applies reviewed filters and imports one bounded observed detail", async () => {
    const { calls, fetchImplementation } = happyFetch();
    const result = await researchZillowRentals(input, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result).toMatchObject({
      state: "completed",
      pageState: "ready",
      resultCardsObserved: 1,
      detailPagesOpened: 1,
      listings: [
        {
          sourceListingId: "123456",
          canonicalObservedUrl: detailUrl,
          finalDetailPageUrl: detailUrl,
          address: "12 Beacon St, Boston, MA 02108",
          rentUsd: 3_200,
          bedrooms: 2,
          bathrooms: 1,
          squareFeet: 900,
          availability: "Available now",
          amenities: ["In-unit laundry", "Dishwasher"]
        }
      ]
    });
    expect(result.listings[0]?.sourceFieldProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "address", observedFrom: "detail_page" }),
        expect.objectContaining({ field: "rent", observedFrom: "detail_page" })
      ])
    );

    const browserCalls = calls.filter((call) => call.url.startsWith("http://127.0.0.1:18792/"));
    const checkpoints = calls.filter((call) => call.url.startsWith("https://vera.example.test/"));
    expect(checkpoints).toHaveLength(browserCalls.length);
    expect(checkpoints.every((call) => call.origin === "https://vera.example.test")).toBe(true);
    expect(browserCalls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining(["/tabs", "/snapshot", "/act", "/navigate"])
    );
    expect(browserCalls.map((call) => new URL(call.url).pathname)).not.toEqual(
      expect.arrayContaining(["/screenshot", "/download", "/upload"])
    );
    const serializedBodies = JSON.stringify(browserCalls.map((call) => call.body));
    expect(serializedBodies).not.toMatch(
      /evaluate|selector|clickCoords|Contact|Apply|Tour|Message|Phone|Email|payment|upload|download/iu
    );
    expect(
      browserCalls
        .filter((call) => new URL(call.url).pathname === "/act")
        .map((call) => (call.body as { kind: string }).kind)
    ).toEqual(expect.arrayContaining(["type", "click"]));
  });

  it("pins the one shared tab behind the safe consent reference", async () => {
    const { calls, fetchImplementation } = happyFetch();
    const result = await researchZillowRentals(consentInput, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result.state).toBe("completed");
    const checkpointBodies = calls
      .filter((call) => call.url.includes("/browser-research/checkpoint"))
      .map((call) => call.body as { activeTabReference?: unknown });
    expect(checkpointBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeTabReference: { kind: "target_id", value: "shared-tab-1" }
        })
      ])
    );
  });

  it("stops before browser work when Vera cancels the run", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (request) => {
      if (String(request).startsWith("https://vera.example.test/")) {
        return jsonResponse({
          allowed: false,
          reason: "cancelled",
          checkedAt: "2026-07-30T12:00:00.000Z"
        });
      }
      return jsonResponse({ error: "browser should not be called" }, 500);
    });
    const result = await researchZillowRentals(input, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });
    expect(result).toMatchObject({
      state: "manual_action_required",
      manualAction: "cancelled",
      listings: []
    });
    expect(
      fetchImplementation.mock.calls.some(([request]) =>
        String(request).startsWith("http://127.0.0.1:18792/")
      )
    ).toBe(false);
  });

  it("stops visibly for multiple tabs and CAPTCHA", async () => {
    const multipleTabs = vi.fn<typeof fetch>(async (request) => {
      if (String(request).startsWith("https://vera.example.test/")) {
        return jsonResponse({
          allowed: true,
          reason: "allowed",
          checkedAt: "2026-07-30T12:00:00.000Z"
        });
      }
      return jsonResponse({
        tabs: [
          { targetId: "shared-tab-1", title: "A", url: resultUrl },
          { targetId: "shared-tab-2", title: "B", url: resultUrl }
        ]
      });
    });
    await expect(
      researchZillowRentals(input, {
        fetch: multipleTabs,
        now: () => new Date("2026-07-30T12:00:00.000Z"),
        monotonicNow: () => 1_000
      })
    ).resolves.toMatchObject({
      state: "manual_action_required",
      manualAction: "multiple_shared_tabs"
    });

    const captcha = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.startsWith("https://vera.example.test/")) {
        return jsonResponse({
          allowed: true,
          reason: "allowed",
          checkedAt: "2026-07-30T12:00:00.000Z"
        });
      }
      if (new URL(url).pathname === "/tabs") {
        return jsonResponse({
          tabs: [{ targetId: "shared-tab-1", title: "Boston rentals", url: resultUrl }]
        });
      }
      return jsonResponse({
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: resultUrl,
        snapshot: blockerFixtures.captcha_required,
        refs: {}
      });
    });
    await expect(
      researchZillowRentals(input, {
        fetch: captcha,
        now: () => new Date("2026-07-30T12:00:00.000Z"),
        monotonicNow: () => 1_000
      })
    ).resolves.toMatchObject({
      state: "manual_action_required",
      pageState: "captcha_required",
      manualAction: "captcha_required"
    });
  });
});
