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

function snapshotForState(
  stage: string,
  currentUrl: string,
  targetId = "shared-tab-1",
  currentPriceControls = false
) {
  if (currentUrl === detailUrl) {
    return {
      ok: true,
      format: "ai",
      targetId,
      url: detailUrl,
      snapshot:
        '- heading "12 Beacon St, Boston, MA 02108" [ref=e20]\n- text "$3,200/mo"\n- text "2 beds 1 bath 900 sq ft"\n- text "Available now"\n- text "In-unit laundry Dishwasher"',
      refs: {
        e20: { role: "heading", name: "12 Beacon St, Boston, MA 02108" }
      }
    };
  }
  if (stage === "price") {
    if (currentPriceControls) {
      return {
        ok: true,
        format: "ai",
        targetId,
        url: resultUrl,
        snapshot:
          '- textbox "price min" [ref=e8]\n- textbox "price max" [ref=e4]\n- button "See 16,292 rentals available" [ref=e5]',
        refs: {
          e8: { role: "textbox", name: "price min" },
          e4: { role: "textbox", name: "price max" },
          e5: { role: "button", name: "See 16,292 rentals available" }
        }
      };
    }
    return {
      ok: true,
      format: "ai",
      targetId,
      url: resultUrl,
      snapshot: '- spinbutton "Max price" [ref=e4]\n- button "Done" [ref=e5]',
      refs: {
        e4: { role: "spinbutton", name: "Max price" },
        e5: { role: "button", name: "Done" }
      }
    };
  }
  if (stage === "beds") {
    return {
      ok: true,
      format: "ai",
      targetId,
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
  return { ...readyFixture, targetId };
}

function happyFetch(
  options: {
    readonly currentPriceControls?: boolean;
    readonly stableTabId?: string;
    readonly rotateTargetAfterLocation?: boolean;
    readonly rotateTargetBetweenTabCheckAndSnapshot?: boolean;
    readonly replaceStableTabBetweenTabCheckAndSnapshot?: boolean;
    readonly replaceStableTabAfterLocation?: boolean;
  } = {}
) {
  let stage = "results";
  let currentUrl = resultUrl;
  let currentTargetId = "shared-tab-1";
  let stableTabId = options.stableTabId;
  let rotateTargetBeforeNextSnapshot = false;
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
      const targetId = currentTargetId;
      const response = jsonResponse({
        tabs: [
          {
            targetId,
            ...(stableTabId === undefined
              ? {}
              : { tabId: stableTabId, suggestedTargetId: stableTabId }),
            title: "Boston rentals",
            url: currentUrl
          }
        ]
      });
      if (rotateTargetBeforeNextSnapshot) {
        currentTargetId = "navigation-target-between-check-and-snapshot";
        if (options.replaceStableTabBetweenTabCheckAndSnapshot) {
          stableTabId = "replacement-tab-between-check-and-snapshot";
        }
        rotateTargetBeforeNextSnapshot = false;
      }
      return response;
    }
    if (parsed.pathname === "/snapshot") {
      return jsonResponse(
        snapshotForState(stage, currentUrl, currentTargetId, options.currentPriceControls)
      );
    }
    if (parsed.pathname === "/act") {
      const action = body as { kind?: string; ref?: string };
      const actionTargetId = currentTargetId;
      if (action.kind === "type" && action.ref === "e1") {
        if (options.rotateTargetAfterLocation) currentTargetId = "navigation-target-2";
        if (options.rotateTargetBetweenTabCheckAndSnapshot) {
          rotateTargetBeforeNextSnapshot = true;
        }
        if (options.replaceStableTabAfterLocation) stableTabId = "replacement-tab-99";
      }
      if (action.kind === "click" && action.ref === "e2") stage = "price";
      if (action.kind === "click" && action.ref === "e3") stage = "beds";
      if (action.kind === "click" && action.ref === "e5") stage = "results";
      return jsonResponse({ ok: true, targetId: actionTargetId, url: currentUrl });
    }
    if (parsed.pathname === "/navigate") {
      currentUrl = (body as { url: string }).url;
      stage = "results";
      return jsonResponse({ ok: true, targetId: currentTargetId, url: currentUrl });
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

  it("applies Zillow's reviewed price max field and result-count apply button", async () => {
    const { calls, fetchImplementation } = happyFetch({ currentPriceControls: true });
    const result = await researchZillowRentals(input, {
      fetch: fetchImplementation,
      now: () => new Date("2026-08-01T05:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result).toMatchObject({
      state: "completed",
      pageState: "ready",
      listings: [expect.objectContaining({ sourceListingId: "123456" })]
    });
    const actionBodies = calls
      .filter((call) => new URL(call.url).pathname === "/act")
      .map((call) => call.body);
    expect(actionBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "type", ref: "e4", text: "3500" }),
        expect.objectContaining({ kind: "click", ref: "e5" })
      ])
    );
    expect(JSON.stringify(actionBodies)).not.toMatch(
      /Contact|Apply|Tour|Message|Phone|Email|payment|upload|download/iu
    );
  });

  it("pins the one shared tab behind the safe consent reference", async () => {
    const { calls, fetchImplementation } = happyFetch({
      stableTabId: "chrome-tab-42",
      rotateTargetAfterLocation: true
    });
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
          activeTabReference: {
            kind: "single_shared_tab",
            value: consentInput.startingTabReference.value
          }
        }),
        expect.objectContaining({
          activeTabReference: { kind: "target_id", value: "chrome-tab-42" }
        })
      ])
    );
    expect(
      checkpointBodies
        .map((body) => body.activeTabReference)
        .filter(
          (reference): reference is { kind: "target_id"; value: string } =>
            typeof reference === "object" &&
            reference !== null &&
            "kind" in reference &&
            reference.kind === "target_id" &&
            "value" in reference &&
            typeof reference.value === "string"
        )
        .map((reference) => reference.value)
    ).toEqual(expect.arrayContaining(["chrome-tab-42"]));
    expect(
      checkpointBodies
        .map((body) => body.activeTabReference)
        .filter(
          (reference): reference is { kind: "target_id"; value: string } =>
            typeof reference === "object" &&
            reference !== null &&
            "kind" in reference &&
            reference.kind === "target_id" &&
            "value" in reference &&
            typeof reference.value === "string"
        )
        .every((reference) => reference.value === "chrome-tab-42")
    ).toBe(true);
    const browserActionTargets = calls
      .filter((call) => ["/act", "/navigate"].includes(new URL(call.url).pathname))
      .map((call) => (call.body as { targetId?: string }).targetId);
    expect(browserActionTargets).toEqual(
      expect.arrayContaining(["shared-tab-1", "navigation-target-2"])
    );
  });

  it("rechecks consent and retries one snapshot across a navigation target race", async () => {
    const { fetchImplementation } = happyFetch({
      stableTabId: "chrome-tab-42",
      rotateTargetBetweenTabCheckAndSnapshot: true
    });
    const result = await researchZillowRentals(consentInput, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result.state).toBe("completed");
    expect(result.safeActionTrail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "snapshot", result: "stopped" }),
        expect.objectContaining({ action: "snapshot", result: "completed" })
      ])
    );
  });

  it("fails closed when the stable Chrome tab changes during the snapshot retry", async () => {
    const { calls, fetchImplementation } = happyFetch({
      stableTabId: "chrome-tab-42",
      rotateTargetBetweenTabCheckAndSnapshot: true,
      replaceStableTabBetweenTabCheckAndSnapshot: true
    });
    const result = await researchZillowRentals(consentInput, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result).toMatchObject({
      state: "manual_action_required",
      manualAction: "shared_tab_changed",
      listings: []
    });
    expect(result.safeActionTrail).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "snapshot", result: "stopped" })])
    );
    expect(
      calls.filter((call) => new URL(call.url).pathname === "/act").map((call) => call.body)
    ).toHaveLength(1);
  });

  it("keeps an explicitly approved starting target authorized through consent-tab rotation", async () => {
    const { calls, fetchImplementation } = happyFetch({
      stableTabId: "chrome-tab-42",
      rotateTargetAfterLocation: true
    });
    const result = await researchZillowRentals(input, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result.state).toBe("completed");
    const activeReferences = calls
      .filter((call) => call.url.includes("/browser-research/checkpoint"))
      .map(
        (call) =>
          (call.body as { activeTabReference?: { kind?: string; value?: string } })
            .activeTabReference
      );
    expect(activeReferences.every((reference) => reference?.value === "shared-tab-1")).toBe(true);
  });

  it("stops when the stable shared Chrome tab is replaced", async () => {
    const { calls, fetchImplementation } = happyFetch({
      stableTabId: "chrome-tab-42",
      rotateTargetAfterLocation: true,
      replaceStableTabAfterLocation: true
    });
    const result = await researchZillowRentals(consentInput, {
      fetch: fetchImplementation,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      monotonicNow: () => 1_000
    });

    expect(result).toMatchObject({
      state: "manual_action_required",
      manualAction: "shared_tab_changed",
      listings: []
    });
    expect(
      calls.filter((call) => new URL(call.url).pathname === "/act").map((call) => call.body)
    ).toHaveLength(1);
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
