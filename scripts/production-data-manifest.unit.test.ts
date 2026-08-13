import { describe, expect, it } from "vitest";

import {
  assertManifestMatches,
  createProductionDataManifest,
  type ProductionDataManifest
} from "./production-data-manifest.ts";

const input = {
  capturedAt: "2026-08-13T12:00:00.000Z",
  migrations: ["2:bbbb", "1:aaaa"],
  tableCounts: [
    { table: "raw_listings", rows: 294 },
    { table: "activity_events", rows: 10 }
  ],
  controls: { appendOnlyTriggers: 8, tenantForeignKeys: 20, forbiddenBrowserActions: 0 }
};

describe("production data manifest", () => {
  it("is deterministic across collection order and capture time", () => {
    const left = createProductionDataManifest(input);
    const right = createProductionDataManifest({
      ...input,
      capturedAt: "2026-08-13T12:05:00.000Z",
      migrations: [...input.migrations].reverse(),
      tableCounts: [...input.tableCounts].reverse()
    });

    expect(left.contentHash).toBe(right.contentHash);
    expect(left.migrations).toEqual(["1:aaaa", "2:bbbb"]);
    expect(left.tableCounts.map(({ table }) => table)).toEqual(["activity_events", "raw_listings"]);
    expect(() => assertManifestMatches(left, right)).not.toThrow();
  });

  it("rejects a lost immutable row", () => {
    const expected = createProductionDataManifest(input);
    const actual = createProductionDataManifest({
      ...input,
      tableCounts: input.tableCounts.map((entry) =>
        entry.table === "raw_listings" ? { ...entry, rows: 293 } : entry
      )
    });
    expect(() => assertManifestMatches(expected, actual)).toThrow("do not match");
  });

  it("rejects a tampered self-hash", () => {
    const manifest = createProductionDataManifest(input);
    const tampered = { ...manifest, contentHash: "0".repeat(64) } as ProductionDataManifest;
    expect(() => assertManifestMatches(tampered, manifest)).toThrow("self-hash");
  });

  it("rejects nonzero forbidden actions", () => {
    expect(() =>
      createProductionDataManifest({
        ...input,
        controls: { ...input.controls, forbiddenBrowserActions: 1 }
      })
    ).toThrow("Forbidden browser actions");
  });

  it.each([
    { ...input, capturedAt: "not-a-time" },
    { ...input, migrations: ["secret\nvalue"] },
    { ...input, tableCounts: [{ table: "raw_listings; drop table users", rows: 1 }] },
    { ...input, tableCounts: [{ table: "raw_listings", rows: -1 }] }
  ])("rejects invalid or unsafe manifest input", (invalid) => {
    expect(() => createProductionDataManifest(invalid)).toThrow();
  });
});
