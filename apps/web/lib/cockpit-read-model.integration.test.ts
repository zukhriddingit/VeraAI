import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteRepositories, migrateDatabase, openDatabase } from "@vera/db";
import { afterEach, describe, expect, it } from "vitest";

import { runDemoSearch } from "./demo-search-service.ts";
import { loadCockpitInitialState, projectCockpitInitialState } from "./cockpit-read-model.ts";
import { seedAndEvaluateProductionEvidence } from "../test-support/production-seed.ts";

const directories: string[] = [];
const originalDataDirectory = process.env.VERA_DATA_DIR;
const originalDemoMode = process.env.VERA_DEMO_MODE;
const now = () => new Date("2026-07-20T18:30:00.000Z");

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;
  if (originalDemoMode === undefined) delete process.env.VERA_DEMO_MODE;
  else process.env.VERA_DEMO_MODE = originalDemoMode;
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function database() {
  const directory = mkdtempSync(join(tmpdir(), "vera-cockpit-read-"));
  directories.push(directory);
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  return { directory, connection, repositories: createSqliteRepositories(connection) };
}

describe.sequential("cockpit initial read model", () => {
  it("stages zero listings until the deterministic demo search completes", () => {
    const { connection, repositories } = database();
    try {
      seedAndEvaluateProductionEvidence(repositories);
      const staged = projectCockpitInitialState(repositories, { demoMode: true, now });
      expect(staged).toMatchObject({
        kind: "ready",
        demoStatus: { status: "not_run" },
        listingCollection: { count: 0 }
      });

      runDemoSearch({ repositories, now });
      const completed = projectCockpitInitialState(repositories, { demoMode: true, now });
      expect(completed).toMatchObject({
        kind: "ready",
        demoStatus: { status: "completed" },
        listingCollection: { count: 8 }
      });
    } finally {
      connection.close();
    }
  });

  it("returns all current listings outside demo mode", () => {
    const { connection, repositories } = database();
    try {
      seedAndEvaluateProductionEvidence(repositories);
      const state = projectCockpitInitialState(repositories, { demoMode: false, now });
      expect(state).toMatchObject({
        kind: "ready",
        demoMode: false,
        demoStatus: null,
        listingCollection: { count: 8 }
      });
    } finally {
      connection.close();
    }
  });

  it("renders a safe recovery model when the database is absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "vera-cockpit-missing-"));
    directories.push(directory);
    process.env.VERA_DATA_DIR = directory;
    process.env.VERA_DEMO_MODE = "1";

    expect(loadCockpitInitialState()).toEqual({
      kind: "unavailable",
      demoMode: true,
      message: "Demo data is not ready. Run pnpm demo:reset and pnpm demo:seed."
    });
  });
});
