import { describe, expect, it } from "vitest";

import {
  BrowserControlMutationSchema,
  CreateCurrentTabCaptureRequestSchema
} from "./browser-agent-api.ts";

const HASH = "a".repeat(64);

describe("browser agent API contracts", () => {
  it("requires every explicit current-tab confirmation", () => {
    const input = {
      nodeId: "node-1",
      profileId: "vera-zillow",
      expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
      requestIdempotencyKey: HASH,
      confirmation: {
        openedIntendedListing: true,
        approvesVisiblePageCapture: true,
        understandsExperimentalStatus: true,
        understandsNoExternalAction: true
      }
    } as const;

    expect(CreateCurrentTabCaptureRequestSchema.parse(input)).toEqual(input);
    expect(() =>
      CreateCurrentTabCaptureRequestSchema.parse({
        ...input,
        confirmation: { ...input.confirmation, understandsNoExternalAction: false }
      })
    ).toThrow();
  });

  it("rejects profile paths, credentials, and partial profile controls", () => {
    expect(() =>
      CreateCurrentTabCaptureRequestSchema.parse({
        nodeId: "node-1",
        profileId: "/Users/founder/profile",
        expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
        requestIdempotencyKey: HASH,
        confirmation: {
          openedIntendedListing: true,
          approvesVisiblePageCapture: true,
          understandsExperimentalStatus: true,
          understandsNoExternalAction: true
        }
      })
    ).toThrow();
    expect(() => BrowserControlMutationSchema.parse({ profileId: "vera-zillow" })).toThrow();
    expect(() =>
      BrowserControlMutationSchema.parse({ userBrowserEnabled: true, token: "secret" })
    ).toThrow();
  });
});
