import { describe, expect, it, vi } from "vitest";

import { measureImportedModuleMemory } from "./measure-web-startup-memory.ts";

describe("web startup memory diagnostic", () => {
  it("returns only rounded numeric memory measurements", async () => {
    const importer = vi.fn(async () => ({ ignored: "module details" }));
    const snapshots = [
      { rss: 100 * 1_048_576, heapUsed: 40 * 1_048_576 },
      { rss: 112.34 * 1_048_576, heapUsed: 44.56 * 1_048_576 }
    ];
    const readMemory = vi.fn(() => snapshots.shift()!);

    const measurement = await measureImportedModuleMemory(importer, readMemory);

    expect(importer).toHaveBeenCalledOnce();
    expect(measurement).toEqual({
      rssBeforeMb: 100,
      rssAfterMb: 112.3,
      rssDeltaMb: 12.3,
      heapUsedBeforeMb: 40,
      heapUsedAfterMb: 44.6,
      heapUsedDeltaMb: 4.6
    });
    expect(Object.values(measurement).every((value) => typeof value === "number")).toBe(true);
    expect(JSON.stringify(measurement)).not.toContain("module details");
  });

  it("reports a zero delta when garbage collection lowers a measurement", async () => {
    const snapshots = [
      { rss: 120 * 1_048_576, heapUsed: 50 * 1_048_576 },
      { rss: 110 * 1_048_576, heapUsed: 45 * 1_048_576 }
    ];

    const measurement = await measureImportedModuleMemory(
      async () => {},
      () => snapshots.shift()!
    );

    expect(measurement).toMatchObject({
      rssDeltaMb: 0,
      heapUsedDeltaMb: 0
    });
  });
});
