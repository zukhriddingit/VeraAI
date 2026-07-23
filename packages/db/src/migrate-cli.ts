import { parsePostgresConfig } from "./postgres/config.ts";
import { openPostgresConnection } from "./postgres/connection.ts";
import { migratePostgres } from "./postgres/migrations.ts";

const connection = openPostgresConnection(parsePostgresConfig(process.env));

try {
  await migratePostgres(connection);
  process.stdout.write(`${JSON.stringify({ event: "postgres_migration_completed" })}\n`);
} finally {
  await connection.close();
}
