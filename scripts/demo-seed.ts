import { join } from "node:path";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase
} from "../packages/db/src/index.ts";
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
  const result = seedDatabase(createSqliteRepositories(connection));
  process.stdout.write(`${JSON.stringify({ event: "demo_seed_completed", ...result })}\n`);
} finally {
  connection.close();
}
