import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase
} from "@vera/db/demo";
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
  const syncRepositories = createSqliteRepositories(connection);
  const provider = createDemoRepositoryProvider(connection);
  return {
    directory,
    connection,
    syncRepositories,
    provider,
    repositories: provider.forUser(DEMO_USER_ID)
  };
}

describe.sequential("cockpit initial read model", () => {
  it("stages zero listings until the deterministic demo search completes", async () => {
    const { connection, repositories, syncRepositories, provider } = database();
    try {
      seedAndEvaluateProductionEvidence(syncRepositories);
      const staged = await projectCockpitInitialState(repositories, { demoMode: true, now });
      expect(staged).toMatchObject({
        kind: "ready",
        demoStatus: { status: "not_run" },
        listingCollection: { count: 0 }
      });

      await runDemoSearch({
        userId: DEMO_USER_ID,
        repositoryProvider: provider,
        repositories,
        now
      });
      const completed = await projectCockpitInitialState(repositories, { demoMode: true, now });
      expect(completed).toMatchObject({
        kind: "ready",
        demoStatus: { status: "completed" },
        listingCollection: { count: 8 }
      });
    } finally {
      connection.close();
    }
  });

  it("returns all current listings outside demo mode", async () => {
    const { connection, repositories, syncRepositories } = database();
    try {
      seedAndEvaluateProductionEvidence(syncRepositories);
      const state = await projectCockpitInitialState(repositories, { demoMode: false, now });
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

  it("renders a safe recovery model when the repository is unavailable", async () => {
    const { connection, repositories } = database();
    connection.close();
    await expect(loadCockpitInitialState(repositories, true)).resolves.toEqual({
      kind: "unavailable",
      demoMode: true,
      message: "Demo data is not ready. Run pnpm demo:reset and pnpm demo:seed."
    });
  });
});
