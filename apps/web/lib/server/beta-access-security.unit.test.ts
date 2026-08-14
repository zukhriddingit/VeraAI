import { describe, expect, it, vi } from "vitest";

import { betaRateLimitDigest, requirePublicBetaSubmissionBoundary } from "./beta-access-security.ts";

describe("beta access security", () => {
  it("derives an opaque key without retaining the network value", () => {
    const digest = betaRateLimitDigest("203.0.113.0/24", {
      VERA_BETA_RATE_LIMIT_KEY: "k".repeat(32)
    });
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toContain("203.0.113");
  });

  it("uses the rightmost Heroku router address", async () => {
    const consumeRateLimit = vi.fn().mockResolvedValue(true);
    const request = new Request("https://app.verahousing.app/api/beta-access", {
      method: "POST",
      headers: {
        origin: "https://app.verahousing.app",
        "x-forwarded-for": "198.51.100.4, 203.0.113.8"
      }
    });
    const previousBaseUrl = process.env.VERA_PUBLIC_BASE_URL;
    process.env.VERA_PUBLIC_BASE_URL = "https://app.verahousing.app";
    try {
      await requirePublicBetaSubmissionBoundary(
        request,
        { consumeRateLimit } as never,
        {
          NODE_ENV: "production",
          VERA_TRUST_HEROKU_ROUTER: "1",
          VERA_BETA_RATE_LIMIT_KEY: "k".repeat(32)
        }
      );
      expect(consumeRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          keyDigest: betaRateLimitDigest("203.0.113.8", {
            VERA_BETA_RATE_LIMIT_KEY: "k".repeat(32)
          })
        })
      );
    } finally {
      if (previousBaseUrl === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
      else process.env.VERA_PUBLIC_BASE_URL = previousBaseUrl;
    }
  });
});
