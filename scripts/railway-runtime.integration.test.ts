import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteRepositories, openDatabase } from "../packages/db/src/index.ts";

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
      evidenceChanged: true,
      decisionJobStatus: "queued",
      rawListings: 12,
      sourceRecords: 12
    });
    expect(second).toMatchObject({
      ...first,
      evidenceChanged: false
    });
    expect(second.decisionJobId).toBe(first.decisionJobId);

    const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });
    try {
      const repositories = createSqliteRepositories(connection);
      expect(repositories.canonicalListings.count()).toBe(0);
      expect(repositories.listingScores.count()).toBe(0);
      expect(repositories.riskSignals.count()).toBe(0);
      expect(repositories.decisionJobs.list()).toHaveLength(1);
    } finally {
      connection.close();
    }
    expect(existsSync(join(dataDirectory, "vera.sqlite"))).toBe(true);
  });
});
