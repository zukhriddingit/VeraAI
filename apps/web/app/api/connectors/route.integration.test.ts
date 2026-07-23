import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "@vera/db/demo";
import { CaptureErrorResponseSchema, ConnectorStatusCollectionResponseSchema } from "@vera/domain";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route.ts";
import {
  clearTestApplication,
  registerTestDemoRuntime
} from "../../../test-support/demo-runtime.ts";

const originalDataDirectory = process.env.VERA_DATA_DIR;
const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "vera-connectors-route-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  clearTestApplication();
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe.sequential("GET /api/connectors", () => {
  it("shows fixture and manual connectors ready with network disabled", async () => {
    const directory = temporaryDirectory();
    process.env.VERA_DATA_DIR = directory;
    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });

    try {
      migrateDatabase(connection);
      seedDatabase(createSqliteRepositories(connection));
    } finally {
      connection.close();
    }
    const runtimeConnection = registerTestDemoRuntime(join(directory, "vera.sqlite"));

    const response = await GET(new Request("http://127.0.0.1/api/connectors"));
    const result = ConnectorStatusCollectionResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.count).toBe(2);
    expect(result.connectors.map((connector) => connector.status)).toEqual(["ready", "ready"]);
    expect(result.connectors.every((connector) => connector.networkAccess === false)).toBe(true);
    runtimeConnection.close();
  });

  it("fails closed without an initialized policy database", async () => {
    process.env.VERA_DATA_DIR = temporaryDirectory();
    const connection = openDatabase({ filePath: join(process.env.VERA_DATA_DIR!, "vera.sqlite") });
    const runtimeConnection = registerTestDemoRuntime(
      join(process.env.VERA_DATA_DIR!, "vera.sqlite")
    );
    connection.close();
    const response = await GET(new Request("http://127.0.0.1/api/connectors"));
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(503);
    expect(error.code).toBe("database_unavailable");
    runtimeConnection.close();
  });
});
