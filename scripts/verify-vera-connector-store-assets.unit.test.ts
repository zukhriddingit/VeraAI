import { describe, expect, it } from "vitest";

import { findStoreAssetViolations } from "./verify-vera-connector-store-assets.ts";

const listing = {
  name: "Vera Browser Connector BETA",
  summary: "Share one tab.",
  detailedDescription: "THIS EXTENSION IS FOR BETA TESTING. Share one tab.",
  category: "Productivity",
  homepageUrl: "https://verahousing.app",
  privacyUrl: "https://verahousing.app/privacy/browser-connector",
  supportUrl: "https://verahousing.app/support/browser-connector",
  distribution: { visibility: "private", trustedTesters: true, deferredPublishing: true }
};
const permissionText = ["debugger", "tabs", "tabGroups", "storage", "alarms"].map((value) => `## ${value}`).join("\n");
const privacyText = "Chrome Web Store Limited Use requirements";

describe("Store source verifier", () => {
  it("accepts accurate private-beta metadata", () => expect(findStoreAssetViolations({ listing, permissionText, privacyText })).toEqual([]));
  it("rejects overclaims", () => expect(findStoreAssetViolations({ listing: { ...listing, detailedDescription: "THIS EXTENSION IS FOR BETA TESTING. Automatically contacts everyone." }, permissionText, privacyText })).not.toEqual([]));
  it("rejects a public distribution", () => expect(findStoreAssetViolations({ listing: { ...listing, distribution: { ...listing.distribution, visibility: "public" } }, permissionText, privacyText })).toContain("Store distribution must remain private and deferred."));
});
