import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedEvidenceDatabase
} from "../packages/db/src/index.ts";
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
  const decision = await processNextDecisionJob(
    {
      repositories,
      leaseOwner: "demo-seed-worker",
      now: () => new Date("2026-07-20T18:00:00.000Z"),
      createId: randomUUID
    },
    new AbortController().signal
  );
  process.stdout.write(
    `${JSON.stringify({ event: "demo_seed_completed", ...result, decision })}\n`
  );
} finally {
  connection.close();
}
