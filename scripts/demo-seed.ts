import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  prepareDemoViewingFixture,
  seedEvidenceDatabase
} from "../packages/db/src/demo/index.ts";
// The demo script is the only composition root allowed to construct SQLite.
import { processNextDecisionJob } from "../apps/worker/src/decision-worker.ts";
import { demoEnvironment } from "./demo-environment.ts";

const environment = demoEnvironment();
const dataDirectory = environment.VERA_DATA_DIR;

if (!dataDirectory) {
  throw new Error("Demo data directory is unavailable.");
}

Object.assign(process.env, environment);
const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

try {
  migrateDatabase(connection);
  const repositories = createSqliteRepositories(connection);
  const result = seedEvidenceDatabase(repositories);
  const repositoryProvider = createDemoRepositoryProvider(connection);
  const decision = await processNextDecisionJob(
    {
      userId: DEMO_USER_ID,
      repositoryProvider,
      repositories: repositoryProvider.forUser(DEMO_USER_ID),
      leaseOwner: "demo-seed-worker",
      now: () => new Date("2026-07-20T18:00:00.000Z"),
      createId: randomUUID
    },
    new AbortController().signal
  );
  await prepareDemoViewingFixture(repositoryProvider);
  process.stdout.write(
    `${JSON.stringify({ event: "demo_seed_completed", ...result, decision })}\n`
  );
} finally {
  connection.close();
}
