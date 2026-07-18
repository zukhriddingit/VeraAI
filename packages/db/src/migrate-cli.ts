import { getDatabasePath } from "./paths.ts";
import { openDatabase } from "./connection.ts";
import { migrateDatabase } from "./migrations.ts";

const filePath = getDatabasePath();
const connection = openDatabase({ filePath });

try {
  migrateDatabase(connection);
  process.stdout.write(`Vera database migrated at ${filePath}\n`);
} finally {
  connection.close();
}
