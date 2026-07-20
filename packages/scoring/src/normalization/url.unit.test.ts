import { describe, expect, it } from "vitest";

import { canonicalizeListingUrl } from "./url.ts";

describe("canonicalizeListingUrl", () => {
  it("removes closed tracking keys and sorts retained identity parameters", () => {
    expect(
      canonicalizeListingUrl(
        "HTTPS://Listings.Example.COM:443/search//item/?utm_source=test&unit=4B&id=22&fbclid=x"
      )
    ).toEqual({
      status: "known",
      url: "https://listings.example.com/search/item?id=22&unit=4B"
    });
  });

  it("preserves repeated retained query values in sorted order", () => {
    expect(canonicalizeListingUrl("https://example.com/a?tag=z&tag=a&b=2")).toEqual({
      status: "known",
      url: "https://example.com/a?b=2&tag=a&tag=z"
    });
  });

  it.each([
    "javascript:alert(1)",
    "https://user:secret@example.com/a",
    "https://127.0.0.1/a",
    "http://localhost/a",
    "https://example.com:444/a",
    "https://example.com/a#fragment"
  ])("fails closed for unsafe URL %s", (input) => {
    expect(canonicalizeListingUrl(input).status).toBe("unknown");
  });

  it("does not make a network request", () => {
    const runtime = globalThis as unknown as Record<string, unknown>;
    const previousFetch = runtime["fetch"];
    runtime["fetch"] = () => {
      throw new Error("network access attempted");
    };
    try {
      expect(canonicalizeListingUrl("https://example.com/listing").status).toBe("known");
    } finally {
      if (previousFetch === undefined) delete runtime["fetch"];
      else runtime["fetch"] = previousFetch;
    }
  });
});
