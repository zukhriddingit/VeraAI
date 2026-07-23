import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("worker build configuration", () => {
  it("keeps native and CommonJS runtime packages outside the ESM bundle", () => {
    const buildConfig = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");

    expect(buildConfig).toContain("__veraCreateRequire(import.meta.url)");
    expect(buildConfig).toContain('external: ["better-sqlite3", "pg", "pino", "sharp"]');
  });
});
