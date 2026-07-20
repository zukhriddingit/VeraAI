import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteRepositories, migrateDatabase, openDatabase } from "@vera/db";
import {
  CanonicalListingCollectionResponseSchema,
  ListingsUnavailableResponseSchema
} from "@vera/domain";

import { runDemoSearch } from "../../../lib/demo-search-service.ts";
import { seedAndEvaluateProductionEvidence } from "../../../test-support/production-seed.ts";

import { GET } from "./route.ts";

const temporaryDirectories: string[] = [];
const originalDataDirectory = process.env.VERA_DATA_DIR;
const originalDemoMode = process.env.VERA_DEMO_MODE;

function temporaryDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "vera-listings-route-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  if (originalDataDirectory === undefined) {
    delete process.env.VERA_DATA_DIR;
  } else {
    process.env.VERA_DATA_DIR = originalDataDirectory;
  }
  if (originalDemoMode === undefined) {
    delete process.env.VERA_DEMO_MODE;
  } else {
    process.env.VERA_DEMO_MODE = originalDemoMode;
  }

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe.sequential("GET /api/listings", () => {
  it("returns eight schema-valid seeded canonical listings", async () => {
    const dataDirectory = temporaryDataDirectory();
    process.env.VERA_DATA_DIR = dataDirectory;
    const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

    try {
      migrateDatabase(connection);
      seedAndEvaluateProductionEvidence(createSqliteRepositories(connection));
    } finally {
      connection.close();
    }

    const response = await GET();
    const body: unknown = await response.json();
    const parsed = CanonicalListingCollectionResponseSchema.parse(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(parsed.count).toBe(8);
    expect(parsed.listings.filter((listing) => listing.duplicateCount > 0)).toHaveLength(3);
    expect(parsed.listings.every(({ alertLatencySeconds }) => alertLatencySeconds === null)).toBe(
      true
    );
    expect(
      parsed.listings.every(({ freshestSourcePostedAt }) => freshestSourcePostedAt === null)
    ).toBe(true);
    expect(
      parsed.listings.find(({ title }) => title === "Juniper Row one-bedroom")?.highestRiskSeverity
    ).toBe("high");
  });

  it("fails closed with a safe response when the database is uninitialized", async () => {
    process.env.VERA_DATA_DIR = temporaryDataDirectory();

    const response = await GET();
    const body: unknown = await response.json();
    const parsed = ListingsUnavailableResponseSchema.parse(body);

    expect(response.status).toBe(503);
    expect(parsed.code).toBe("database_unavailable");
    expect(JSON.stringify(parsed)).not.toContain(process.env.VERA_DATA_DIR);
  });

  it("hides staged demo listings until the audited fixture search completes", async () => {
    const dataDirectory = temporaryDataDirectory();
    process.env.VERA_DATA_DIR = dataDirectory;
    process.env.VERA_DEMO_MODE = "1";
    const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

    try {
      migrateDatabase(connection);
      const repositories = createSqliteRepositories(connection);
      seedAndEvaluateProductionEvidence(repositories);

      const beforeResponse = await GET();
      const before = CanonicalListingCollectionResponseSchema.parse(await beforeResponse.json());
      expect(before.count).toBe(0);

      runDemoSearch({
        repositories,
        now: () => new Date("2026-07-17T12:30:00.000Z")
      });
    } finally {
      connection.close();
    }

    const afterResponse = await GET();
    const after = CanonicalListingCollectionResponseSchema.parse(await afterResponse.json());
    expect(after.count).toBe(8);
  });
});
