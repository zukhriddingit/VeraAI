import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import type { UserRepositories, UserRepositoryProvider, VeraRepositories } from "@vera/db";
import { SOURCE_FIXTURES } from "@vera/db/fixtures";

import { seedAndEvaluateProductionEvidence } from "../test-support/production-seed.ts";
import { getDemoStatus, runDemoSearch } from "./demo-search-service.ts";
import { isDemoMode } from "./demo-mode.ts";

let directory: string;
let connection: VeraDatabaseConnection;
let repositories: VeraRepositories;
let asyncRepositories: UserRepositories;
let repositoryProvider: UserRepositoryProvider;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-demo-search-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  repositories = createSqliteRepositories(connection);
  repositoryProvider = createDemoRepositoryProvider(connection);
  asyncRepositories = repositoryProvider.forUser(DEMO_USER_ID);
  seedAndEvaluateProductionEvidence(repositories);
});

afterEach(() => {
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("demo search", () => {
  it("recognizes only the exact demo flag", () => {
    expect(isDemoMode({ VERA_DEMO_MODE: "1" })).toBe(true);
    expect(isDemoMode({ VERA_DEMO_MODE: "true" })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });

  it("reveals the staged graph once through the connector and policy path", async () => {
    expect((await getDemoStatus(asyncRepositories)).status).toBe("not_run");
    const before = {
      raw: repositories.rawListings.count(),
      source: repositories.sourceRecords.count(),
      canonical: repositories.canonicalListings.count(),
      clusters: repositories.duplicateClusters.count()
    };
    const first = await runDemoSearch({
      userId: DEMO_USER_ID,
      repositoryProvider,
      repositories: asyncRepositories,
      now: () => new Date("2026-07-17T12:30:00.000Z")
    });
    const eventsAfterFirst = repositories.activityEvents.count();
    const second = await runDemoSearch({
      userId: DEMO_USER_ID,
      repositoryProvider,
      repositories: asyncRepositories,
      now: () => new Date("2026-07-17T12:31:00.000Z")
    });

    expect(first).toMatchObject({
      sourceRecordsAnalyzed: 12,
      homesFound: 8,
      duplicateClusters: 3,
      idempotentReplay: false
    });
    expect(second.idempotentReplay).toBe(true);
    expect(repositories.activityEvents.count()).toBe(eventsAfterFirst);
    expect({
      raw: repositories.rawListings.count(),
      source: repositories.sourceRecords.count(),
      canonical: repositories.canonicalListings.count(),
      clusters: repositories.duplicateClusters.count()
    }).toEqual(before);
    expect(
      repositories.activityEvents
        .list()
        .filter((event) => event.action === "capture.policy_authorized")
    ).toHaveLength(12);
    expect(
      repositories.activityEvents.list().filter((event) => event.action === "normalization.reused")
    ).toHaveLength(12);
    expect(
      repositories.activityEvents.list().filter((event) => event.action === "demo.search.completed")
    ).toHaveLength(1);
    expect((await getDemoStatus(asyncRepositories)).status).toBe("completed");
  });

  it("stays ready when an unrelated manual record exists", async () => {
    const fixture = SOURCE_FIXTURES[0];
    repositories.rawListings.import({
      ...fixture.capture,
      id: "raw-unrelated-manual-record",
      sourceListingId: "manual-unrelated-record",
      observedAt: "2026-07-18T12:00:00.000Z"
    });
    repositories.sourceRecords.insert({
      ...fixture.sourceRecord,
      id: "src-unrelated-manual-record",
      rawListingId: "raw-unrelated-manual-record",
      sourceListingId: "manual-unrelated-record",
      title: "Unrelated manual fixture",
      observedAt: "2026-07-18T12:00:00.000Z",
      createdAt: "2026-07-18T12:00:00.000Z"
    });

    expect((await getDemoStatus(asyncRepositories)).status).toBe("not_run");
    expect(
      (
        await runDemoSearch({
          userId: DEMO_USER_ID,
          repositoryProvider,
          repositories: asyncRepositories,
          now: () => new Date("2026-07-18T12:01:00.000Z")
        })
      ).homesFound
    ).toBe(8);
  });
});
