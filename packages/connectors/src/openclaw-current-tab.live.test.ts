import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeZillowListingUrl } from "@vera/policy";

import { OpenClawBrowserExecutionProvider } from "./openclaw-browser-execution.ts";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const configuration = {
  enabled: process.env.VERA_OPENCLAW_LIVE_TEST === "1",
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
  nodeId: process.env.VERA_OPENCLAW_NODE_ID,
  profileId: process.env.VERA_OPENCLAW_PROFILE_ID,
  expectedUrl: process.env.VERA_OPENCLAW_APPROVED_ZILLOW_URL
};
const ready =
  configuration.enabled &&
  configuration.gatewayUrl &&
  configuration.gatewayToken &&
  configuration.nodeId &&
  configuration.profileId &&
  configuration.expectedUrl;

describe.skipIf(!ready)("OpenClaw current-tab live smoke", () => {
  it("captures exactly the approved current Zillow tab", async () => {
    const provider = new OpenClawBrowserExecutionProvider({
      config: {
        executable: process.env.VERA_OPENCLAW_EXECUTABLE ?? "openclaw",
        gatewayUrl: configuration.gatewayUrl!,
        gatewayToken: configuration.gatewayToken!,
        timeoutMilliseconds: 30_000,
        maxOutputBytes: 1_000_000
      }
    });
    const result = await provider.captureCurrentTab({
      nodeId: configuration.nodeId!,
      profileId: configuration.profileId!,
      executionId: "openclaw-live-smoke",
      correlationId: "openclaw-live-smoke",
      expectedUrl: configuration.expectedUrl!,
      canonicalUrl: canonicalizeZillowListingUrl(configuration.expectedUrl!),
      invocationIdempotencyKey: sha256("openclaw-live-smoke"),
      requestedAt: new Date().toISOString(),
      limits: {
        maxPages: 1,
        maxRecords: 1,
        maxBytes: 250_000,
        maxDurationMilliseconds: 30_000,
        maxConcurrency: 1
      }
    });
    expect(["completed", "manual_action_required"]).toContain(result.status);
  });
});
