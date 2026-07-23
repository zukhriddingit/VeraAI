import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SOURCE_FIXTURES } from "../fixtures.ts";
import {
  DEMO_USER_ID,
  DEMO_GOOGLE_INTEGRATION,
  DemoTenantMismatchError,
  createDemoRepositoryProvider,
  migrateDatabase,
  openDatabase
} from "./index.ts";

const directories: string[] = [];

function database() {
  const directory = mkdtempSync(join(tmpdir(), "vera-demo-adapter-"));
  directories.push(directory);
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  return { connection, provider: createDemoRepositoryProvider(connection) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("explicit offline SQLite demo adapter", () => {
  it("is fixed to the deterministic demo owner and has no hosted identity tables", async () => {
    const { connection, provider } = database();
    try {
      expect(() => provider.forUser("018f9f64-7b5a-7c91-a12e-123456789abc")).toThrow(
        DemoTenantMismatchError
      );
      await expect(provider.forUser(DEMO_USER_ID).integrationConnections.list()).resolves.toEqual([
        DEMO_GOOGLE_INTEGRATION
      ]);
      expect(DEMO_GOOGLE_INTEGRATION.encryptedRefreshToken).toBeNull();
      const tableNames = connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(tableNames).not.toEqual(
        expect.arrayContaining([
          "users",
          "sessions",
          "accounts",
          "verifications",
          "integration_connections"
        ])
      );
    } finally {
      connection.close();
    }
  });

  it("serializes async transactions and rolls back on failure", async () => {
    const { connection, provider } = database();
    try {
      await expect(
        provider.transaction(DEMO_USER_ID, async (repositories) => {
          await repositories.rawListings.import(SOURCE_FIXTURES[0].capture);
          throw new Error("synthetic rollback");
        })
      ).rejects.toThrow("synthetic rollback");
      await expect(provider.forUser(DEMO_USER_ID).rawListings.count()).resolves.toBe(0);
    } finally {
      connection.close();
    }
  });
});
