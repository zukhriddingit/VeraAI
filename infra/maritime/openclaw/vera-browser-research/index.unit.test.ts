import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENRICHMENT_SAFE_ACTIONS, SAFE_ACTIONS, SOURCE_POLICY } from "./contract.mjs";
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

function signedFacebookPlan() {
  const issuedAt = new Date();
  const payload = {
    version: "1",
    veraRunId: "facebook-live-replay-1",
    source: "facebook_marketplace",
    profile: {
      location: "Boston, MA",
      maximumRentUsd: 3_000,
      minimumBedrooms: 1,
      minimumBathrooms: 1
    },
    maxResults: 10,
    maxDetailPages: 3,
    maxActions: 50,
    maxDurationMilliseconds: 90_000,
    startingTabReference: {
      kind: "single_shared_tab",
      value: "explicitly_shared_zillow_rental_tab"
    },
    allowedHostnames: [...SOURCE_POLICY.facebook_marketplace.hostnames],
    allowedUrlPatterns: [...SOURCE_POLICY.facebook_marketplace.urlPatterns],
    enabledSafeActionTypes: [...SAFE_ACTIONS],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString()
  };
  return {
    ...payload,
    signature: createHmac("sha256", signingKey).update(canonical(payload)).digest("hex")
  };
}

function signedZillowEnrichmentPlan() {
  const issuedAt = new Date();
  const payload = {
    version: "1",
    veraRunId: "zillow-enrichment-replay-1",
    source: "zillow",
    profile: {
      location: "Boston, MA",
      maximumRentUsd: 3_000,
      minimumBedrooms: 1,
      minimumBathrooms: 1
    },
    maxResults: 1,
    maxDetailPages: 1,
    maxActions: 10,
    maxDurationMilliseconds: 90_000,
    startingTabReference: {
      kind: "single_shared_tab",
      value: "explicitly_shared_zillow_rental_tab"
    },
    allowedHostnames: [...SOURCE_POLICY.zillow.hostnames],
    allowedUrlPatterns: [...SOURCE_POLICY.zillow.urlPatterns],
    enabledSafeActionTypes: [...ENRICHMENT_SAFE_ACTIONS],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString(),
    mode: "enrichment",
    targetListingUrl: "https://www.zillow.com/apartments/allston-ma/kelton-street/CjkfBg/"
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

function facebookSnapshot(currentUrl: string) {
  const listingName = "2 Beds 1 Bath - Apartment, $1,995, Allston, MA, listing 123456789";
  return {
    ok: true,
    format: "ai",
    targetId: "shared-target-1",
    url: currentUrl,
    refs: {
      e1: { role: "textbox", name: "Maximum range" },
      e2: { role: "button", name: "Bedrooms" },
      e3: { role: "radio", name: "1+" },
      e4: { role: "button", name: "Bathrooms" },
      e5: { role: "link", name: listingName },
      e6: { role: "button", name: "Message seller" }
    },
    snapshot: [
      '- textbox "Maximum range" [ref=e1]',
      '- button "Bedrooms" [ref=e2]',
      '- radio "1+" [ref=e3]',
      '- button "Bathrooms" [ref=e4]',
      `- link "${listingName}" [ref=e5]`,
      '- button "Message seller" [ref=e6]',
      "",
      "Links:",
      `1. ${listingName} -> https://www.facebook.com/marketplace/item/123456789/?ref=category_feed`
    ].join("\n")
  };
}

function facebookMultiSnapshot(currentUrl: string) {
  if (currentUrl.includes("/marketplace/item/")) {
    const id = currentUrl.match(/\/item\/([0-9]+)\//u)?.[1] ?? "0";
    return {
      ok: true,
      format: "ai",
      targetId: "shared-target-1",
      url: currentUrl,
      refs: { e99: { role: "button", name: "Message seller" } },
      snapshot: [
        `- heading "Rental ${id}"`,
        "- paragraph: $2,100, 2 Beds, 1 Bath, 850 sq ft, Boston, MA",
        "- paragraph: Available now. Dishwasher and laundry.",
        '- button "Message seller" [ref=e99]'
      ].join("\n")
    };
  }
  const links = Array.from({ length: 4 }, (_, index) => {
    const id = String(123456780 + index);
    return {
      ref: `e${String(10 + index)}`,
      name: `2 Beds 1 Bath - Apartment, $2,${String(100 + index)}, Boston, MA, listing ${id}`,
      url: `https://www.facebook.com/marketplace/item/${id}/`
    };
  });
  return {
    ok: true,
    format: "ai",
    targetId: "shared-target-1",
    url: currentUrl,
    refs: {
      e1: { role: "textbox", name: "Maximum range" },
      e2: { role: "button", name: "Bedrooms" },
      e3: { role: "radio", name: "1+" },
      e4: { role: "button", name: "Bathrooms" },
      ...Object.fromEntries(links.map((link) => [link.ref, { role: "link", name: link.name }]))
    },
    snapshot: [
      '- textbox "Maximum range" [ref=e1]',
      '- button "Bedrooms" [ref=e2]',
      '- radio "1+" [ref=e3]',
      '- button "Bathrooms" [ref=e4]',
      ...links.map((link) => `- link "${link.name}" [ref=${link.ref}]`),
      "",
      "Links:",
      ...links.map((link, index) => `${String(index + 1)}. ${link.name} -> ${link.url}`)
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

  it("enriches one exact observed Zillow URL without exposing a generic browser surface", async () => {
    let currentUrl = "https://www.zillow.com/homes/for_rent/";
    const browserBodies: unknown[] = [];
    let monotonic = 500;
    const result = await researchRentals(signedZillowEnrichmentPlan(), {
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
            tabs: [{ targetId: "shared-target-1", tabId: "stable-tab-1", url: currentUrl }]
          });
        }
        if (url.pathname === "/snapshot") {
          return Response.json({
            ok: true,
            format: "ai",
            targetId: "shared-target-1",
            url: currentUrl,
            refs: { e1: { role: "button", name: "Contact property manager" } },
            snapshot: [
              '- heading "Kelton Street"',
              "- paragraph: 221 Kelton St, Allston, MA 02134",
              "- paragraph: $2,375, 1 Bed, 1 Bath, 620 sq ft",
              "- paragraph: Available 2026-09-01. 12 month lease. Cats allowed. Heat and hot water included.",
              "- paragraph: In-unit washer and dryer. Dishwasher. Professionally managed by Example Property Management.",
              "- image: https://photos.zillowstatic.com/fp/example-photo.webp",
              '- button "Contact property manager" [ref=e1]'
            ].join("\n")
          });
        }
        const body = JSON.parse(String(init?.body)) as { url?: string; kind?: string };
        browserBodies.push(body);
        if (url.pathname === "/navigate" && body.url) currentUrl = body.url;
        return Response.json({ ok: true, targetId: "shared-target-1", url: currentUrl });
      }
    });

    expect(result).toMatchObject({
      state: "completed",
      source: "zillow",
      resultCardsObserved: 0,
      detailPagesOpened: 1,
      listings: [
        {
          sourceListingId: "CjkfBg",
          rentUsd: 2_375,
          bedrooms: 1,
          bathrooms: 1,
          leaseTermMonths: 12,
          laundry: "in_unit",
          photos: [{ url: "https://photos.zillowstatic.com/fp/example-photo.webp" }]
        }
      ]
    });
    expect(browserBodies).toEqual([
      expect.objectContaining({
        url: "https://www.zillow.com/apartments/allston-ma/kelton-street/CjkfBg/"
      })
    ]);
    expect(result.safeActionTrail).toContainEqual(
      expect.objectContaining({ action: "navigate_same_source", result: "completed" })
    );
    expect(result.safeActionTrail).not.toContainEqual(
      expect.objectContaining({ action: "open_observed_listing" })
    );
    expect(JSON.stringify(browserBodies)).not.toMatch(/contact|apply|tour|message|email|phone/iu);
  });

  it("applies reviewed filters and extracts one real-shaped card without a forbidden action", async () => {
    let currentUrl = "https://www.zillow.com/homes/for_rent/";
    let mode: "base" | "price" | "beds" = "base";
    let transientTabFailures = 0;
    const waits: number[] = [];
    const browserBodies: unknown[] = [];
    let monotonic = 1_000;
    const result = await researchRentals(signedPlan(), {
      now: () => new Date(),
      monotonicNow: () => (monotonic += 10),
      wait: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
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
          if (currentUrl.includes("apartments.com") && transientTabFailures < 4) {
            transientTabFailures += 1;
            return Response.json({ code: "relay_reconnecting" }, { status: 503 });
          }
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
      detailPagesOpened: 1,
      listings: [
        {
          sourceListingId: "r7nkvh2",
          finalDetailPageUrl: "https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/",
          address: "1575 Tremont St, Boston, MA 02120",
          rentUsd: 2_793,
          bedrooms: 1
        }
      ]
    });
    expect(JSON.stringify(browserBodies)).not.toMatch(
      /contact|apply|tour|message|email|phone|payment|upload|download/iu
    );
    expect(browserBodies).toContainEqual(
      expect.objectContaining({ kind: "scrollIntoView", ref: "e8" })
    );
    expect(browserBodies).toContainEqual(
      expect.objectContaining({
        url: "https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/"
      })
    );
    expect(
      browserBodies.every((body) => {
        const kind = (body as { kind?: string }).kind;
        return kind === undefined || ["click", "type", "scrollIntoView"].includes(kind);
      })
    ).toBe(true);
    expect(transientTabFailures).toBe(4);
    expect(waits).toEqual(expect.arrayContaining([750, 1_500, 3_000, 6_000]));
  });

  it("bounds browser-read reconnect retries without repeating the navigation action", async () => {
    let currentUrl = "https://www.zillow.com/homes/for_rent/";
    let tabReads = 0;
    let navigateCalls = 0;
    const waits: number[] = [];
    let monotonic = 1_500;
    const result = await researchRentals(signedPlan(), {
      now: () => new Date(),
      monotonicNow: () => (monotonic += 10),
      wait: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
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
          tabReads += 1;
          if (tabReads > 1) {
            return Response.json({ code: "relay_reconnecting" }, { status: 503 });
          }
          return Response.json({
            tabs: [{ targetId: "shared-target-1", tabId: "stable-tab-1", url: currentUrl }]
          });
        }
        if (url.pathname === "/navigate") {
          navigateCalls += 1;
          const body = JSON.parse(String(init?.body)) as { url?: string };
          if (body.url) currentUrl = body.url;
          return Response.json({ ok: true, targetId: "shared-target-1", url: currentUrl });
        }
        throw new Error(`Unexpected browser request: ${url.pathname}`);
      }
    });

    expect(result).toMatchObject({
      state: "manual_action_required",
      pageState: "ready",
      manualAction: "browser_offline",
      resultCardsObserved: 0,
      detailPagesOpened: 0
    });
    expect(tabReads).toBe(6);
    expect(navigateCalls).toBe(1);
    expect(waits).toEqual([1_500, 750, 1_500, 3_000, 6_000]);
    expect(
      result.safeActionTrail.filter((entry) => entry.action === "navigate_same_source")
    ).toEqual([expect.objectContaining({ action: "navigate_same_source", result: "completed" })]);
  });

  it("uses the live Facebook rentals route and extracts an observed card without forbidden actions", async () => {
    let currentUrl = "https://www.facebook.com/marketplace/";
    const browserBodies: unknown[] = [];
    let monotonic = 2_000;
    const result = await researchRentals(signedFacebookPlan(), {
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
        if (url.pathname === "/snapshot") return Response.json(facebookSnapshot(currentUrl));
        const body = JSON.parse(String(init?.body)) as {
          kind?: string;
          url?: string;
        };
        browserBodies.push(body);
        if (url.pathname === "/navigate" && typeof body.url === "string") currentUrl = body.url;
        return Response.json({ ok: true, targetId: "shared-target-1", url: currentUrl });
      }
    });

    expect(result).toMatchObject({
      source: "facebook_marketplace",
      state: "partial",
      pageState: "ready",
      resultCardsObserved: 1,
      detailPagesOpened: 1,
      listings: [
        {
          sourceListingId: "123456789",
          canonicalObservedUrl: "https://www.facebook.com/marketplace/item/123456789/",
          finalDetailPageUrl: "https://www.facebook.com/marketplace/item/123456789/",
          address: "Allston, MA",
          rentUsd: 1_995,
          bedrooms: 2,
          bathrooms: 1
        }
      ]
    });
    expect(browserBodies[0]).toMatchObject({
      url: "https://www.facebook.com/marketplace/boston/propertyrentals/"
    });
    expect(browserBodies).toContainEqual(
      expect.objectContaining({ kind: "scrollIntoView", ref: "e5" })
    );
    expect(JSON.stringify(browserBodies)).not.toMatch(
      /contact|apply|tour|message|messenger|email|phone|payment|upload|download/iu
    );
    expect(
      browserBodies.every((body) => {
        const kind = (body as { kind?: string }).kind;
        return kind === undefined || ["click", "type", "scrollIntoView"].includes(kind);
      })
    ).toBe(true);
  });

  it("uses the reviewed Facebook detail allowance instead of stopping after one result snapshot", async () => {
    let currentUrl = "https://www.facebook.com/marketplace/";
    const browserBodies: unknown[] = [];
    let monotonic = 3_000;
    const result = await researchRentals(signedFacebookPlan(), {
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
            tabs: [{ targetId: "shared-target-1", tabId: "stable-tab-1", url: currentUrl }]
          });
        }
        if (url.pathname === "/snapshot") {
          return Response.json(facebookMultiSnapshot(currentUrl));
        }
        const body = JSON.parse(String(init?.body)) as { url?: string };
        browserBodies.push(body);
        if (url.pathname === "/navigate" && typeof body.url === "string") currentUrl = body.url;
        return Response.json({ ok: true, targetId: "shared-target-1", url: currentUrl });
      }
    });

    expect(result).toMatchObject({
      source: "facebook_marketplace",
      state: "partial",
      resultCardsObserved: 4,
      detailPagesOpened: 3
    });
    expect(result.listings).toHaveLength(4);
    expect(result.listings.filter((listing) => listing.finalDetailPageUrl !== null)).toHaveLength(
      3
    );
    expect(JSON.stringify(browserBodies)).not.toMatch(
      /contact|apply|tour|message|messenger|email|phone|payment|upload|download/iu
    );
  });
});
