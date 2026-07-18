import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { InvalidCaptureUrlError } from "./errors.ts";
import { validateAndClassifyProvenanceUrl } from "./url-policy.ts";

describe("validateAndClassifyProvenanceUrl", () => {
  it.each([
    ["https://www.zillow.com/homedetails/123", "zillow"],
    ["https://m.facebook.com/marketplace/item/123", "facebook_marketplace"],
    ["https://newyork.craigslist.org/apa/d/example/123.html", "craigslist"],
    ["https://www.apartments.com/example/abc", "apartments_com"]
  ] as const)("classifies %s as %s", (url, source) => {
    expect(validateAndClassifyProvenanceUrl(url)).toMatchObject({
      source,
      browserAccess: "policy_entry_present"
    });
  });

  it("normalizes hostname case and a trailing dot", () => {
    expect(validateAndClassifyProvenanceUrl("HTTPS://WWW.ZILLOW.COM./homedetails/123")).toEqual({
      canonicalUrl: "https://www.zillow.com/homedetails/123",
      hostname: "www.zillow.com",
      source: "zillow",
      browserAccess: "policy_entry_present"
    });
  });

  it("classifies unknown public domains as other without granting future browser access", () => {
    expect(validateAndClassifyProvenanceUrl("https://housing.example/path?q=listing")).toEqual({
      canonicalUrl: "https://housing.example/path?q=listing",
      hostname: "housing.example",
      source: "other",
      browserAccess: "manual_policy_required"
    });
  });

  it("does not classify an unrelated Facebook path as Marketplace", () => {
    expect(
      validateAndClassifyProvenanceUrl("https://www.facebook.com/groups/example")
    ).toMatchObject({
      source: "other",
      browserAccess: "manual_policy_required"
    });
  });

  it.each([
    "https://zillow.com.evil.example/listing",
    "https://facebook.com.evil.example/marketplace/item/1",
    "https://craigslist.org.evil.example/listing",
    "https://apartments.com.evil.example/listing"
  ])("uses exact or dot-boundary domain matching for %s", (url) => {
    expect(validateAndClassifyProvenanceUrl(url)).toMatchObject({
      source: "other",
      browserAccess: "manual_policy_required"
    });
  });

  it.each([
    "file:///etc/passwd",
    "ftp://housing.example/listing",
    "http://localhost/listing",
    "http://sub.localhost/listing",
    "http://router.local/listing",
    "http://intranet/listing",
    "http://127.0.0.1/listing",
    "http://[::1]/listing",
    "http://2130706433/listing",
    "http://0x7f000001/listing",
    "https://user:secret@housing.example/listing",
    "https://housing.example/listing#fragment",
    "https://housing.example:443/listing",
    "not a url",
    " https://housing.example/listing"
  ])("rejects SSRF-shaped or unsupported provenance URL %s", (url) => {
    expect(() => validateAndClassifyProvenanceUrl(url)).toThrow(InvalidCaptureUrlError);
  });

  it("uses URL parsing only and performs no network call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(validateAndClassifyProvenanceUrl("https://housing.example/listing").source).toBe(
      "other"
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const source = readFileSync(new URL("./url-policy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /node:(?:http|https|dns|net)|from\s+["'](?:undici|playwright|puppeteer)/u
    );
  });
});
