import { createSqliteRepositories } from "./sqlite-repositories.ts";
import { openExistingDatabase } from "./connection.ts";
import { seedDatabase } from "./seed.ts";

const connection = openExistingDatabase();

try {
  const result = seedDatabase(createSqliteRepositories(connection));
  process.stdout.write(`${JSON.stringify({ event: "seed_completed", ...result })}\n`);
} finally {
  connection.close();
}
