import { describe, expect, it } from "vitest";

import { browserReadinessObservationIsFresh } from "./browser-readiness-preflight.ts";

const ready = {
  source: "vera-openclaw-extension",
  type: "readiness",
  version: "1",
  paired: true,
  relayState: "on",
  readiness: "ready",
  sharedTabCount: 1
} as const;

describe("browser search readiness preflight", () => {
  it("requires a new ready observation after the user presses Search", () => {
    expect(browserReadinessObservationIsFresh(ready, 1_000, 1_000)).toBe(false);
    expect(browserReadinessObservationIsFresh(ready, 1_001, 1_000)).toBe(true);
  });

  it("rejects a fresh observation after the shared tab is revoked", () => {
    expect(
      browserReadinessObservationIsFresh(
        { ...ready, readiness: "not_shared", sharedTabCount: 0 },
        1_001,
        1_000
      )
    ).toBe(false);
  });
});
