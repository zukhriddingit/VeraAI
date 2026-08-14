import { describe, expect, it } from "vitest";

import { approvedBrowserConnectorLink } from "./browser-connector-release.ts";

const url = "https://chromewebstore.google.com/detail/vera-browser-connector/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("browser connector release link", () => {
  it("returns a Store URL only after private publication", () => {
    expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "published", VERA_CHROME_STORE_ITEM_URL: url })).toBe(url);
    expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "approved", VERA_CHROME_STORE_ITEM_URL: url })).toBeNull();
    expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "published", VERA_CHROME_STORE_ITEM_URL: "https://example.com" })).toBeNull();
  });
});
