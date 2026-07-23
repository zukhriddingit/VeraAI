import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteRepositories, migrateDatabase, openDatabase } from "@vera/db/demo";
import {
  DemoRunResponseSchema,
  DemoStatusResponseSchema,
  DemoUnavailableResponseSchema
} from "@vera/domain";
import { afterEach, describe, expect, it } from "vitest";

import { seedAndEvaluateProductionEvidence } from "../../../test-support/production-seed.ts";
import { POST as runDemo } from "./run/route.ts";
import { GET as getDemoStatus } from "./status/route.ts";
import {
  clearApplicationForTesting,
  registerApplication
} from "../../../lib/server/application-registry.ts";
import { createDemoApplication } from "../../../lib/server/demo-application.ts";
import {
  clearTestApplication,
  registerTestDemoRuntime
} from "../../../test-support/demo-runtime.ts";

const temporaryDirectories: string[] = [];
const originalDataDirectory = process.env.VERA_DATA_DIR;
const originalDemoMode = process.env.VERA_DEMO_MODE;
let runtimeConnection: ReturnType<typeof openDatabase> | null = null;

function temporaryDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "vera-demo-routes-"));
  temporaryDirectories.push(directory);
  return directory;
}

function restoreEnvironment(): void {
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;

  if (originalDemoMode === undefined) delete process.env.VERA_DEMO_MODE;
  else process.env.VERA_DEMO_MODE = originalDemoMode;
}

afterEach(() => {
  runtimeConnection?.close();
  runtimeConnection = null;
  clearTestApplication();
  restoreEnvironment();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe.sequential("demo API routes", () => {
  it("fails closed unless demo mode is exactly enabled", async () => {
    process.env.VERA_DEMO_MODE = "true";
    const directory = temporaryDataDirectory();
    runtimeConnection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    migrateDatabase(runtimeConnection);
    const demoApplication = createDemoApplication(runtimeConnection);
    clearApplicationForTesting();
    registerApplication({ ...demoApplication, mode: "hosted", demoUserId: null });
    const request = new Request("http://127.0.0.1/api/demo/status", {
      headers: { Origin: "http://127.0.0.1" }
    });

    for (const response of [await getDemoStatus(request), await runDemo(request)]) {
      expect(response.status).toBe(404);
      expect(DemoUnavailableResponseSchema.parse(await response.json())).toEqual({
        code: "demo_mode_disabled",
        message: "Demo mode is not enabled."
      });
    }
  });

  it("runs the seeded fixture path once and returns an idempotent replay", async () => {
    const dataDirectory = temporaryDataDirectory();
    process.env.VERA_DATA_DIR = dataDirectory;
    process.env.VERA_DEMO_MODE = "1";
    const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

    try {
      migrateDatabase(connection);
      seedAndEvaluateProductionEvidence(createSqliteRepositories(connection));
    } finally {
      connection.close();
    }
    runtimeConnection = registerTestDemoRuntime(join(dataDirectory, "vera.sqlite"));
    const request = new Request("http://127.0.0.1/api/demo/status", {
      headers: { Origin: "http://127.0.0.1" }
    });

    const before = DemoStatusResponseSchema.parse(await (await getDemoStatus(request)).json());
    expect(before.status).toBe("not_run");

    const firstResponse = await runDemo(request);
    const first = DemoRunResponseSchema.parse(await firstResponse.json());
    expect(firstResponse.status).toBe(200);
    expect(first).toMatchObject({
      sourceRecordsAnalyzed: 12,
      homesFound: 8,
      duplicateClusters: 3,
      idempotentReplay: false
    });

    const replay = DemoRunResponseSchema.parse(await (await runDemo(request)).json());
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.completedAt).toBe(first.completedAt);

    const after = DemoStatusResponseSchema.parse(await (await getDemoStatus(request)).json());
    expect(after.status).toBe("completed");
    expect(after.run?.completedAt).toBe(first.completedAt);
  });
});
