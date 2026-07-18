import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveRailwayConfiguration } from "./railway-environment.ts";
import { initializeRailwayDatabase } from "./railway-runtime.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Railway database bootstrap", () => {
  it("migrates and seeds the mounted database idempotently", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "vera-railway-"));
    temporaryDirectories.push(dataDirectory);
    const configuration = resolveRailwayConfiguration(
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: dataDirectory },
      { expectedMountPath: dataDirectory }
    );

    const first = initializeRailwayDatabase(configuration, { rootDirectory: process.cwd() });
    const second = initializeRailwayDatabase(configuration, { rootDirectory: process.cwd() });

    expect(first).toMatchObject({
      activityEvents: 1,
      canonicalListings: 8,
      rawListings: 12,
      sourceRecords: 12
    });
    expect(second).toEqual(first);
    expect(existsSync(join(dataDirectory, "vera.sqlite"))).toBe(true);
  });
});
