import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("founder live-search CLI packaging", () => {
  it("declares every internal workspace imported by the root command", () => {
    const command = readFileSync(resolve(repositoryRoot, "scripts/live-search-founder.ts"), "utf8");
    const packageManifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(packageManifest.dependencies ?? {}),
      ...Object.keys(packageManifest.devDependencies ?? {})
    ]);
    const internalImports = [...command.matchAll(/from\s+["'](@vera\/[^"']+)["']/gu)].map(
      (match) => match[1]
    );

    expect(internalImports).not.toHaveLength(0);
    expect(internalImports.filter((dependency) => !declared.has(dependency!))).toEqual([]);
  });
});
