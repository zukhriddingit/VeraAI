import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { STATIC_ACCEPTANCE_SNAPSHOT_WARNING } from "./static-acceptance-warning.ts";

describe("LiveSearchPanel acceptance snapshot warning", () => {
  it("uses the exact required developer warning", () => {
    expect(STATIC_ACCEPTANCE_SNAPSHOT_WARNING).toBe(
      "Static acceptance snapshot — controls are not interactive."
    );
  });

  it("passes preserved hosted listings into the hydrated inbox", async () => {
    const source = await readFile(new URL("live-search-panel.tsx", import.meta.url), "utf8");

    expect(source).toContain("initialListings={initialListings}");
    expect(source).not.toContain(
      "initialListings={staticAcceptanceSnapshot ? initialListings : []}"
    );
  });
});
