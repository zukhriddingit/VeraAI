import { BrowserNodeStatusSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  ZillowCurrentTabUrlError,
  canonicalizeZillowListingUrl,
  evaluateCurrentTabCapturePolicy,
  requireMatchingZillowCurrentTabUrl
} from "./browser-policy.ts";

const node = BrowserNodeStatusSchema.parse({
  nodeId: "node-1",
  providerId: "openclaw",
  nodeName: "Founder Mac",
  status: "online",
  pairingState: "paired",
  capabilityApprovalState: "approved",
  selectedProfileId: "vera-zillow",
  allowedProfileIds: ["vera-zillow"],
  reportedOpenClawVersion: "2026.6.33",
  expectedOpenClawVersion: "2026.6.33",
  versionCompatibility: "compatible",
  lastHeartbeatAt: "2026-07-21T12:00:00.000Z",
  heartbeatExpiresAt: "2026-07-21T12:02:00.000Z",
  lastSuccessfulCaptureAt: null,
  disabledAt: null,
  contractVersion: 2,
  capabilities: { navigation: false, capture: true, cancellation: true },
  createdAt: "2026-07-21T11:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z"
});

const enabledControls = {
  systemBrowserDisabled: false,
  userBrowserEnabled: true,
  zillowSourceEnabled: true,
  nodeDisabled: false,
  profileDisabled: false
} as const;

describe("Zillow current-tab URL policy", () => {
  it("accepts only a narrow listing path and strips documented tracking parameters", () => {
    expect(
      canonicalizeZillowListingUrl(
        "https://www.zillow.com/homedetails/12-Cedar-St-Cambridge-MA/12345_zpid/?utm_source=share"
      )
    ).toBe("https://www.zillow.com/homedetails/12-Cedar-St-Cambridge-MA/12345_zpid/");
  });

  it.each([
    "http://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
    "https://zillow.com/homedetails/12-Cedar-St/12345_zpid/",
    "https://www.zillow.com/homes/for_rent/",
    "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/?redirect=https://evil.test"
  ])("rejects %s", (url) => {
    expect(() => canonicalizeZillowListingUrl(url)).toThrow(ZillowCurrentTabUrlError);
  });

  it("rejects a different active listing instead of treating it as equivalent", () => {
    expect(() =>
      requireMatchingZillowCurrentTabUrl(
        "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
        "https://www.zillow.com/homedetails/14-Cedar-St/67890_zpid/"
      )
    ).toThrowError(/active_url_mismatch/u);
  });
});

describe("layered current-tab policy", () => {
  it("allows only the explicitly activated, session-bound, approved capture", () => {
    expect(
      evaluateCurrentTabCapturePolicy({
        expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
        profileId: "vera-zillow",
        node,
        controls: enabledControls,
        hasUserSession: true,
        hasApproval: true
      })
    ).toMatchObject({ allowed: true, connectorId: "zillow.current-tab.v1" });
  });

  it.each([
    ["systemBrowserDisabled", true, "system_browser_kill_switch_active"],
    ["userBrowserEnabled", false, "user_browser_kill_switch_active"],
    ["zillowSourceEnabled", false, "source_kill_switch_active"],
    ["nodeDisabled", true, "node_disabled"],
    ["profileDisabled", true, "profile_disabled"]
  ] as const)("fails closed for %s", (key, value, reason) => {
    expect(
      evaluateCurrentTabCapturePolicy({
        expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
        profileId: "vera-zillow",
        node,
        controls: { ...enabledControls, [key]: value },
        hasUserSession: true,
        hasApproval: true
      })
    ).toEqual({ allowed: false, reason });
  });

  it("denies a missing user session, approval, or allowlisted profile", () => {
    for (const input of [
      { hasUserSession: false, hasApproval: true, node },
      { hasUserSession: true, hasApproval: false, node },
      {
        hasUserSession: true,
        hasApproval: true,
        node: BrowserNodeStatusSchema.parse({
          ...node,
          selectedProfileId: null,
          allowedProfileIds: []
        })
      }
    ]) {
      expect(
        evaluateCurrentTabCapturePolicy({
          expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
          profileId: "vera-zillow",
          controls: enabledControls,
          ...input
        }).allowed
      ).toBe(false);
    }
  });
});
