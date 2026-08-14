import { describe, expect, it } from "vitest";

import { navigationBehavior, normalizedSectionHash } from "./motion-policy.ts";

describe("marketing motion policy", () => {
  it("uses smooth movement only when motion is allowed", () => {
    expect(navigationBehavior(false)).toBe("smooth");
    expect(navigationBehavior(true)).toBe("auto");
  });

  it("accepts only known section hashes", () => {
    expect(normalizedSectionHash("#evidence")).toBe("evidence");
    expect(normalizedSectionHash("#unknown")).toBeNull();
  });
});
