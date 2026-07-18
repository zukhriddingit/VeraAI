import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DatabaseInitializationError,
  getDataDirectory,
  migrateDatabase,
  openDatabase,
  openExistingDatabase,
  type VeraDatabaseConnection
} from "./index.ts";

const temporaryDirectories: string[] = [];
const openConnections: VeraDatabaseConnection[] = [];

function createTemporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "vera-db-connection-"));
  temporaryDirectories.push(directory);
  return join(directory, "vera.sqlite");
}

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("SQLite connection initialization", () => {
  it("enables foreign keys, WAL mode, and the bounded busy timeout", () => {
    const connection = openDatabase({ filePath: createTemporaryDatabasePath() });
    openConnections.push(connection);

    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(5_000);
  });

  it("applies the reviewed migration and append-only triggers", () => {
    const connection = openDatabase({ filePath: createTemporaryDatabasePath() });
    openConnections.push(connection);

    migrateDatabase(connection);

    const tables = connection.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => {
        if (typeof row !== "object" || row === null || !("name" in row)) {
          throw new Error("Unexpected sqlite_master table row.");
        }

        return row.name;
      });
    const triggers = connection.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((row) => {
        if (typeof row !== "object" || row === null || !("name" in row)) {
          throw new Error("Unexpected sqlite_master trigger row.");
        }

        return row.name;
      });

    expect(tables).toContain("raw_listings");
    expect(tables).toContain("activity_events");
    expect(tables).toContain("canonical_field_sources");
    expect(tables).toContain("listing_extractions");
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(triggers).toEqual([
      "activity_events_no_delete",
      "activity_events_no_update",
      "listing_extractions_no_delete",
      "listing_extractions_no_update",
      "raw_listings_no_delete",
      "raw_listings_no_update"
    ]);
  });

  it("refuses to create a database through the existing-only path", () => {
    const filePath = createTemporaryDatabasePath();

    expect(() => openExistingDatabase({ filePath })).toThrow(DatabaseInitializationError);
  });

  it("resolves explicit and platform-default data locations", () => {
    expect(
      getDataDirectory({
        environment: { VERA_DATA_DIR: "/tmp/vera-explicit" },
        platform: "linux",
        homeDirectory: "/users/tester"
      })
    ).toBe("/tmp/vera-explicit");
    expect(
      getDataDirectory({
        environment: {},
        platform: "darwin",
        homeDirectory: "/users/tester"
      })
    ).toBe("/users/tester/Library/Application Support/Vera");
    expect(
      getDataDirectory({
        environment: { XDG_DATA_HOME: "/users/tester/data" },
        platform: "linux",
        homeDirectory: "/users/tester"
      })
    ).toBe("/users/tester/data/vera");
  });
});
