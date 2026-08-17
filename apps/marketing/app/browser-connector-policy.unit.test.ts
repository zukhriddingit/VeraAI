import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public browser connector policy", () => {
  it("publishes every required disclosure", async () => {
    const privacy = await readFile(
      new URL("./privacy/browser-connector/page.tsx", import.meta.url),
      "utf8"
    );
    for (const phrase of [
      "exactly one tab",
      "tab URL",
      "observed page content",
      "HTTPS and WSS",
      "do not sell",
      "advertising",
      "Chrome Web Store User Data Policy",
      "saved browser connection",
      "Connecting alone shares no tab",
      "installation digest",
      "deletion",
      "login, 2FA, CAPTCHA, consent"
    ])
      expect(privacy).toContain(phrase);
    expect(privacy).toContain("support@verahousing.app");
  });

  it("publishes implemented self-service privacy controls without overstating backup deletion", async () => {
    const [generalPrivacy, connectorPrivacy] = await Promise.all([
      readFile(new URL("./privacy/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("./privacy/browser-connector/page.tsx", import.meta.url), "utf8")
    ]);
    for (const text of [generalPrivacy, connectorPrivacy]) {
      expect(text).toContain("Settings → Privacy");
      expect(text).toContain("Export");
      expect(text).toContain("Delete");
      expect(text).toContain("backup");
      expect(text).toContain("Browser Connector");
    }
    expect(generalPrivacy).toContain("support@verahousing.app");
    expect(connectorPrivacy).toContain("best-effort");
    expect(connectorPrivacy).toContain("Chrome Web Store User Data Policy");
    expect(connectorPrivacy).toContain("Limited Use");
    expect(generalPrivacy).not.toContain("Self-service export and deletion remain unavailable");
  });
});
