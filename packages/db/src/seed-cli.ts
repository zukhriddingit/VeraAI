import { parsePostgresConfig } from "./postgres/config.ts";
import { openPostgresConnection } from "./postgres/connection.ts";
import { seedPostgresGlobalPolicy } from "./postgres/seed.ts";

const connection = openPostgresConnection(parsePostgresConfig(process.env));

try {
  const result = await seedPostgresGlobalPolicy(connection);
  process.stdout.write(
    `${JSON.stringify({ event: "postgres_policy_seed_completed", ...result })}\n`
  );
} finally {
  await connection.close();
}
