import { describe, expect, it } from "vitest";

import { CONSENT_DISCLOSURE, shareButtonLabel } from "./popup-copy.js";

describe("connector consent copy", () => {
  it("describes the exact processed data before sharing", () => {
    expect(CONSENT_DISCLOSURE).toContain("exactly one tab");
    expect(CONSENT_DISCLOSURE).toContain("tab URL");
    expect(CONSENT_DISCLOSURE).toContain("observed page content");
    expect(CONSENT_DISCLOSURE).toContain(
      "Cookies, saved passwords, browser storage, and authenticated headers are excluded"
    );
  });

  it("makes sharing affirmative and revocation explicit", () => {
    expect(shareButtonLabel(false)).toBe("Share this tab with Vera");
    expect(shareButtonLabel(true)).toBe("Stop sharing this tab");
  });
});
