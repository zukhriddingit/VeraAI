import { describe, expect, it } from "vitest";

import { findVeraExtensionViolations } from "./verify-vera-openclaw-extension.ts";

const icon = { "16": "images/icon-16.png", "32": "images/icon-32.png", "48": "images/icon-48.png", "128": "images/icon-128.png" };
const manifest = {
  manifest_version: 3,
  name: "Vera Browser Connector BETA",
  version: "2.1.0",
  description: "THIS EXTENSION IS FOR BETA TESTING. Share one dedicated housing-search tab with an approved Vera Browser Gateway.",
  permissions: ["debugger", "tabs", "tabGroups", "storage", "alarms"],
  content_scripts: [{ matches: ["http://127.0.0.1:3000/*", "http://localhost:3000/*", "https://app.verahousing.app/*"], js: ["readiness-bridge.js"], run_at: "document_idle" }],
  background: { service_worker: "background.js", type: "module" },
  action: { default_title: "Vera Browser Connector BETA", default_popup: "popup.html", default_icon: icon },
  icons: icon,
  minimum_chrome_version: "125"
};
const clean = {
  manifest,
  runtime: "Prepare Vera Search tab openclaw-extension-relay openclaw-extension-token. browser_extension_conflict about:blank https://www.zillow.com/homes/for_rent/",
  iconDimensions: new Map(
    [16, 32, 48, 128].map((size) => [`icon-${size}.png`, [size, size] as const])
  )
};

describe("Vera Store extension verifier", () => {
  it("accepts the reviewed Store boundary", () => expect(findVeraExtensionViolations(clean)).toEqual([]));
  it("rejects another readiness origin", () => expect(findVeraExtensionViolations({ ...clean, manifest: { ...manifest, content_scripts: [{ ...manifest.content_scripts[0], matches: [...manifest.content_scripts[0].matches, "https://verahousing.app/*"] }] } })).toContain("Readiness bridge origins are not exact."));
  it("rejects added browser authority", () => expect(findVeraExtensionViolations({ ...clean, manifest: { ...manifest, permissions: [...manifest.permissions, "scripting"] } })).toContain("Permissions are not exact."));
  it("rejects an incorrectly sized icon", () => expect(findVeraExtensionViolations({ ...clean, iconDimensions: new Map([["icon-16.png", [32, 32]]]) })).toContain("Extension icons are missing or incorrectly sized."));
});
