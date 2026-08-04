import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SAFE_ACTIONS, SOURCE_POLICY } from "./contract.mjs";
import { researchRentals } from "./index.mjs";

const signingKey = "generic-gateway-replay-signing-key-000000000000000";
const checkpointToken = "generic-gateway-checkpoint-token-00000000000000000";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function signedPlan() {
  const issuedAt = new Date();
  const payload = {
    version: "1",
    veraRunId: "apartments-live-replay-1",
    source: "apartments_com",
    profile: {
      location: "Boston, MA",
      maximumRentUsd: 3_000,
      minimumBedrooms: 1,
      minimumBathrooms: 1
    },
    maxResults: 10,
    maxDetailPages: 5,
    maxActions: 50,
    maxDurationMilliseconds: 90_000,
    startingTabReference: {
      kind: "single_shared_tab",
      value: "explicitly_shared_zillow_rental_tab"
    },
    allowedHostnames: [...SOURCE_POLICY.apartments_com.hostnames],
    allowedUrlPatterns: [...SOURCE_POLICY.apartments_com.urlPatterns],
    enabledSafeActionTypes: [...SAFE_ACTIONS],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString()
  };
  return {
    ...payload,
    signature: createHmac("sha256", signingKey).update(canonical(payload)).digest("hex")
  };
}

function snapshot(mode: "base" | "price" | "beds", currentUrl: string) {
  const listingName = "The Longwood, Boston, MA";
  const common = {
    ok: true,
    format: "ai",
    targetId: "shared-target-1",
    url: currentUrl
  };
  if (mode === "price") {
    return {
      ...common,
      refs: {
        e3: { role: "textbox", name: "maximum Rent Input" },
        e4: { role: "button", name: "Done" }
      },
      snapshot: '- textbox "maximum Rent Input" [ref=e3]\n- button "Done" [ref=e4]'
    };
  }
  if (mode === "beds") {
    return {
      ...common,
      refs: {
        e5: { role: "button", name: "1+" },
        e6: { role: "button", name: "1+" },
        e7: { role: "button", name: "Done" }
      },
      snapshot:
        '- generic: Beds\n- button "1+" [ref=e5]\n- generic: Baths\n- button "1+" [ref=e6]\n- button "Done" [ref=e7]'
    };
  }
  return {
    ...common,
    refs: {
      e1: { role: "button", name: "Price" },
      e2: { role: "button", name: "Beds/Baths" },
      e8: { role: "link", name: listingName },
      e9: { role: "button", name: "Email" }
    },
    snapshot: [
      '- button "Price" [ref=e1]',
      '- button "Beds/Baths" [ref=e2]',
      `- link "${listingName}" [ref=e8]`,
      '  - generic "1575 Tremont St, Boston, MA 02120"',
      "  - generic: 1 Bed",
      "  - generic: $2,793+",
      "  - paragraph: Pets Allowed, Fitness Center, Dishwasher, In Unit Washer & Dryer",
      '- button "Email" [ref=e9]',
      "",
      "Links:",
      `1. ${listingName} -> https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/`
    ].join("\n")
  };
}

describe("vera_browser_research_v1 local adapter replay", () => {
  beforeEach(() => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "synthetic-openclaw-token";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL =
      "https://vera-checkpoint.example.test/api/internal/browser-research/checkpoint";
    process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN = checkpointToken;
    process.env.VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY = signingKey;
  });

  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL;
    delete process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN;
    delete process.env.VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY;
  });

  it("applies reviewed filters and extracts one real-shaped card without a forbidden action", async () => {
    let currentUrl = "https://www.zillow.com/homes/for_rent/";
    let mode: "base" | "price" | "beds" = "base";
    const browserBodies: unknown[] = [];
    let monotonic = 1_000;
    const result = await researchRentals(signedPlan(), {
      now: () => new Date(),
      monotonicNow: () => (monotonic += 10),
      wait: async () => {},
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.hostname === "vera-checkpoint.example.test") {
          return Response.json({
            allowed: true,
            reason: "allowed",
            checkedAt: new Date().toISOString()
          });
        }
        if (url.pathname === "/tabs") {
          return Response.json({
            tabs: [
              {
                targetId: "shared-target-1",
                tabId: "stable-tab-1",
                url: currentUrl
              }
            ]
          });
        }
        if (url.pathname === "/snapshot") return Response.json(snapshot(mode, currentUrl));
        const body = JSON.parse(String(init?.body)) as {
          kind?: string;
          ref?: string;
          url?: string;
        };
        browserBodies.push(body);
        if (url.pathname === "/navigate" && typeof body.url === "string") currentUrl = body.url;
        if (url.pathname === "/act" && body.ref === "e1") mode = "price";
        if (url.pathname === "/act" && body.ref === "e4") mode = "base";
        if (url.pathname === "/act" && body.ref === "e2") mode = "beds";
        if (url.pathname === "/act" && body.ref === "e7") mode = "base";
        return Response.json({ ok: true, targetId: "shared-target-1", url: currentUrl });
      }
    });

    expect(result).toMatchObject({
      source: "apartments_com",
      state: "partial",
      pageState: "ready",
      resultCardsObserved: 1,
      detailPagesOpened: 0,
      listings: [
        {
          sourceListingId: "r7nkvh2",
          address: "1575 Tremont St, Boston, MA 02120",
          rentUsd: 2_793,
          bedrooms: 1
        }
      ]
    });
    expect(JSON.stringify(browserBodies)).not.toMatch(
      /contact|apply|tour|message|email|phone|payment|upload|download/iu
    );
    expect(
      browserBodies.every((body) => {
        const kind = (body as { kind?: string }).kind;
        return kind === undefined || ["click", "type", "scrollIntoView"].includes(kind);
      })
    ).toBe(true);
  });
});
