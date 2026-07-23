import { describe, expect, it } from "vitest";

import {
  evaluateFounderBrowserAccess,
  FounderBrowserAuthorizationError,
  requireFounderBrowserAccess
} from "./founder-browser-access.ts";

const founder = "018f9f64-7b5a-7c91-a12e-123456789abc" as const;
const other = "118f9f64-7b5a-7c91-a12e-123456789abc" as const;

describe("founder browser access", () => {
  it("fails closed when the list is absent, malformed, empty, or does not contain the user", () => {
    expect(evaluateFounderBrowserAccess(founder, undefined)).toEqual({
      allowed: false,
      code: "founder_browser_allowlist_missing"
    });
    expect(evaluateFounderBrowserAccess(founder, "  ,  ")).toEqual({
      allowed: false,
      code: "founder_browser_allowlist_invalid"
    });
    expect(evaluateFounderBrowserAccess(founder, "not-a-uuid")).toEqual({
      allowed: false,
      code: "founder_browser_allowlist_invalid"
    });
    expect(evaluateFounderBrowserAccess(founder, other)).toEqual({
      allowed: false,
      code: "founder_browser_user_denied"
    });
  });

  it("allows only an exact configured Vera UUID", () => {
    expect(evaluateFounderBrowserAccess(founder, ` ${other},${founder} `)).toEqual({
      allowed: true,
      userId: founder
    });
    expect(evaluateFounderBrowserAccess(founder, founder.toUpperCase())).toEqual({
      allowed: false,
      code: "founder_browser_user_denied"
    });
  });

  it("throws only the safe denial code", () => {
    expect(() => requireFounderBrowserAccess(other, founder)).toThrow(
      new FounderBrowserAuthorizationError("founder_browser_user_denied")
    );
  });
});
