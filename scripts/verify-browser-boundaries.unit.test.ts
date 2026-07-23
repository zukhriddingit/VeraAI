import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("browser boundary verifier", () => {
  it("accepts the reviewed current-tab implementation", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(import.meta.dirname, "verify-browser-boundaries.ts")],
      { encoding: "utf8" }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Browser security boundaries verified");
  });
});
