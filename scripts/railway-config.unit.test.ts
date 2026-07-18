import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Railway configuration", () => {
  it("uses the approved build, start, health, and restart contract", () => {
    expect(readFileSync("railway.toml", "utf8")).toBe(`[build]
builder = "RAILPACK"
buildCommand = "pnpm build"

[deploy]
startCommand = "pnpm deploy:railway"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
`);
  });

  it("exposes a compiled production bootstrap through root scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe(
      "pnpm -r --if-present run build && node scripts/build-railway-start.mjs"
    );
    expect(packageJson.scripts["deploy:railway"]).toBe("node dist/railway-start.mjs");
    expect(packageJson.dependencies["better-sqlite3"]).toBe("12.11.1");
  });
});
