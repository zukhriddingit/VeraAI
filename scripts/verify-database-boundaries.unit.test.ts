import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findDatabaseBoundaryViolations,
  findDatabasePackageBoundaryViolations
} from "./verify-database-boundaries.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("database import boundary verifier", () => {
  it("rejects demo and SQLite imports from hosted code", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-boundary-"));
    directories.push(root);
    mkdirSync(join(root, "apps/web/lib"), { recursive: true });
    writeFileSync(join(root, "apps/web/lib/bad.ts"), 'import "@vera/db/demo";\n');
    expect(findDatabaseBoundaryViolations(["apps/web/lib/bad.ts"], root)).toEqual([
      { file: "apps/web/lib/bad.ts", specifier: "@vera/db/demo" }
    ]);
  });

  it("allows the hosted PostgreSQL public boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "vera-boundary-"));
    directories.push(root);
    mkdirSync(join(root, "apps/worker/src"), { recursive: true });
    writeFileSync(join(root, "apps/worker/src/good.ts"), 'import { x } from "@vera/db";\n');
    expect(findDatabaseBoundaryViolations(["apps/worker/src/good.ts"], root)).toEqual([]);
  });

  it("keeps the SQLite native runtime out of hosted production dependencies", () => {
    expect(
      findDatabasePackageBoundaryViolations({
        dependencies: { "better-sqlite3": "12.11.1" },
        devDependencies: {}
      })
    ).toEqual([
      expect.objectContaining({ specifier: expect.stringContaining("production dependency") }),
      expect.objectContaining({ specifier: expect.stringContaining("demo-only") })
    ]);
    expect(
      findDatabasePackageBoundaryViolations({
        dependencies: { pg: "8.22.0" },
        devDependencies: { "better-sqlite3": "12.11.1" }
      })
    ).toEqual([]);
  });
});
