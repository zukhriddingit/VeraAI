import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public browser connector policy", () => {
  it("publishes every required disclosure", async () => {
    const privacy = await readFile(new URL("./privacy/browser-connector/page.tsx", import.meta.url), "utf8");
    for (const phrase of [
      "exactly one tab", "tab URL", "observed page content", "HTTPS and WSS", "do not sell",
      "advertising", "Chrome Web Store User Data Policy", "unpair", "deletion",
      "login, 2FA, CAPTCHA, consent"
    ]) expect(privacy).toContain(phrase);
    expect(privacy).toContain("support@verahousing.app");
  });
});
