import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { PUBLIC_DEMO_FIXTURE_VERSION, PUBLIC_DEMO_LISTINGS } from "./public-demo-fixtures.ts";

describe("public demo fixtures", () => {
  it("are versioned, useful, and sanitized", () => {
    expect(PUBLIC_DEMO_FIXTURE_VERSION).toBe("public-demo.v1");
    expect(PUBLIC_DEMO_LISTINGS).toHaveLength(3);
    expect(PUBLIC_DEMO_LISTINGS.some((listing) => listing.sourceBadges.length > 1)).toBe(true);
    expect(PUBLIC_DEMO_LISTINGS.every((listing) => listing.fitFactors.length >= 3)).toBe(true);
    expect(PUBLIC_DEMO_LISTINGS.every((listing) => listing.activity.length >= 2)).toBe(true);
  });

  it("contains only inert original-listing destinations", () => {
    for (const listing of PUBLIC_DEMO_LISTINGS) {
      for (const source of listing.sources) {
        expect(new URL(source.url).hostname).toBe("example.invalid");
      }
    }
  });

  it("contains no retained live-acceptance identifiers", () => {
    const serialized = JSON.stringify(PUBLIC_DEMO_LISTINGS);
    expect(serialized).not.toMatch(
      /221 Kelton|42027fd5|zillow\.com|facebook\.com|apartments\.com/i
    );
  });

  it("keeps the client component free of network and authenticated application imports", async () => {
    const source = await readFile(new URL("./public-demo.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /fetch\s*\(|@vera\/db|application-registry|requireVeraSession|\/api\//
    );
  });
});
