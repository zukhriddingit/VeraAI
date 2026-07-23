import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "@vera/db/demo";
import { DismissListingResponseSchema, ListingActionErrorResponseSchema } from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "./route.ts";
import {
  clearTestApplication,
  registerTestDemoRuntime
} from "../../../../../test-support/demo-runtime.ts";

const originalDataDirectory = process.env.VERA_DATA_DIR;
let directory = "";
let runtimeConnection: ReturnType<typeof openDatabase> | null = null;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-dismiss-route-"));
  process.env.VERA_DATA_DIR = directory;
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  try {
    migrateDatabase(connection);
    seedDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
  runtimeConnection = registerTestDemoRuntime(join(directory, "vera.sqlite"));
});

afterEach(() => {
  runtimeConnection?.close();
  runtimeConnection = null;
  clearTestApplication();
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function dismiss(id: string, body: unknown = { dismissed: true }): Promise<Response> {
  return POST(
    new Request("http://127.0.0.1/api/listings/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe.sequential("POST /api/listings/:id/dismiss", () => {
  it("dismisses through the lifecycle boundary and appends safe activity", async () => {
    const response = await dismiss("can-cedar-flat");
    const result = DismissListingResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.lifecycleState).toBe("dismissed");
    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      const repositories = createSqliteRepositories(connection);
      expect(repositories.canonicalListings.getById("can-cedar-flat")?.lifecycleState).toBe(
        "dismissed"
      );
      expect(
        repositories.activityEvents
          .listByTarget("canonical_listing", "can-cedar-flat")
          .map(({ action }) => action)
      ).toContain("listing.dismissed");
    } finally {
      connection.close();
    }
  });

  it("fails closed for malformed, missing, and repeated requests", async () => {
    const malformed = await dismiss("can-cedar-flat", { dismissed: false });
    expect(malformed.status).toBe(400);
    expect(ListingActionErrorResponseSchema.parse(await malformed.json()).code).toBe(
      "malformed_request"
    );

    const missing = await dismiss("missing-listing");
    expect(missing.status).toBe(404);

    expect((await dismiss("can-cedar-flat")).status).toBe(200);
    const repeated = await dismiss("can-cedar-flat");
    expect(repeated.status).toBe(409);
    expect(ListingActionErrorResponseSchema.parse(await repeated.json()).code).toBe(
      "invalid_transition"
    );
  });
});
