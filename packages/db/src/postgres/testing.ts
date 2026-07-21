import { randomBytes } from "node:crypto";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { parsePostgresConfig } from "./config.ts";
import { openPostgresConnection, type PostgresConnection } from "./connection.ts";
import { migratePostgres } from "./migrations.ts";
import { schema } from "./schema.ts";

export interface PostgresTestContext {
  readonly connection: PostgresConnection;
  readonly db: NodePgDatabase<typeof schema>;
  readonly schemaName: string;
}

function parseTestDatabaseUrl(environment: Readonly<Record<string, string | undefined>>): string {
  const value = environment.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests.");

  const url = new URL(value);
  if (url.pathname !== "/vera_test") {
    throw new Error("PostgreSQL integration tests require the vera_test database.");
  }
  return value;
}

export async function withPostgresTestDatabase<T>(
  operation: (context: PostgresTestContext) => Promise<T>,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<T> {
  const connectionString = parseTestDatabaseUrl(environment);
  const schemaName = `vera_test_${randomBytes(12).toString("hex")}`;
  const administrator = new Pool({ connectionString, max: 1, application_name: "vera-test-admin" });
  let connection: PostgresConnection | null = null;
  let schemaCreated = false;

  try {
    await administrator.query(`create schema "${schemaName}"`);
    schemaCreated = true;
    const config = parsePostgresConfig({ ...environment, DATABASE_URL: connectionString });
    connection = openPostgresConnection(config, { searchPath: schemaName });
    await migratePostgres(connection, { migrationsSchema: schemaName });
    return await operation({ connection, db: connection.db, schemaName });
  } finally {
    await connection?.close();
    if (schemaCreated) {
      await administrator.query(`drop schema if exists "${schemaName}" cascade`);
    }
    await administrator.end();
  }
}
