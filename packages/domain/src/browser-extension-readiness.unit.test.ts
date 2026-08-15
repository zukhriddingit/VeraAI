import { describe, expect, it } from "vitest";

import {
  BrowserExtensionReadinessMessageSchema,
  browserExtensionReadyForResearch
} from "./browser-extension-readiness.ts";

const ready = BrowserExtensionReadinessMessageSchema.parse({
  source: "vera-openclaw-extension",
  type: "readiness",
  version: "2",
  extensionVersion: "2.2.0",
  enrollmentProtocolVersion: "1",
  installationDigest: "a".repeat(64),
  paired: true,
  relayState: "on",
  readiness: "ready",
  sharedTabCount: 1
});

describe("browser extension readiness", () => {
  it("requires pairing, relay connectivity, one shared tab, and an owned debugger lease", () => {
    expect(browserExtensionReadyForResearch(ready)).toBe(true);
    expect(browserExtensionReadyForResearch({ ...ready, relayState: "error" })).toBe(false);
    expect(
      browserExtensionReadyForResearch({
        ...ready,
        readiness: "browser_extension_conflict"
      })
    ).toBe(false);
    expect(browserExtensionReadyForResearch({ ...ready, sharedTabCount: 2 })).toBe(false);
  });

  it("rejects spoof-shaped messages with extra fields or unknown states", () => {
    expect(
      BrowserExtensionReadinessMessageSchema.safeParse({
        ...ready,
        readiness: "pretend_ready"
      }).success
    ).toBe(false);
    expect(
      BrowserExtensionReadinessMessageSchema.safeParse({
        ...ready,
        token: "must-never-cross-the-bridge"
      }).success
    ).toBe(false);
  });

  it("keeps the accepted v1 readiness shape compatible during rollout", () => {
    const legacy = BrowserExtensionReadinessMessageSchema.parse({
      source: "vera-openclaw-extension",
      type: "readiness",
      version: "1",
      paired: true,
      relayState: "on",
      readiness: "ready",
      sharedTabCount: 1
    });
    expect(browserExtensionReadyForResearch(legacy)).toBe(true);
  });
});
