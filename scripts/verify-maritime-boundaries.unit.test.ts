import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Maritime boundary verifier", () => {
  it("accepts the pinned server-only control-plane dependencies", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(import.meta.dirname, "verify-maritime-boundaries.ts")],
      { encoding: "utf8" }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Maritime execution boundaries verified");
  });
});
