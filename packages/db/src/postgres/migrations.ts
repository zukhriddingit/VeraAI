import { fileURLToPath } from "node:url";

import { type ReadinessReport, ReadinessReportSchema } from "@vera/domain";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { PostgresConnection } from "./connection.ts";

export const postgresMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface PostgresMigrationOptions {
  readonly migrationsFolder?: string;
  readonly migrationsSchema?: string;
}

export async function migratePostgres(
  connection: PostgresConnection,
  options: PostgresMigrationOptions = {}
): Promise<void> {
  await migrate(connection.db, {
    migrationsFolder: options.migrationsFolder ?? postgresMigrationsFolder,
    migrationsSchema: options.migrationsSchema ?? "drizzle"
  });
}

export async function checkPostgresReadiness(
  connection: PostgresConnection,
  input: {
    readonly service: "vera-web" | "vera-worker";
    readonly now?: () => Date;
    readonly migrationsFolder?: string;
    readonly migrationsSchema?: string;
  }
): Promise<ReadinessReport> {
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  const migrationsFolder = input.migrationsFolder ?? postgresMigrationsFolder;
  const migrationsSchema = input.migrationsSchema ?? "drizzle";
  if (migrationsSchema !== "drizzle" && !/^vera_test_[a-f0-9]{16,64}$/u.test(migrationsSchema)) {
    throw new Error("The migration schema name is invalid.");
  }
  const expected = readMigrationFiles({ migrationsFolder }).at(-1)?.hash;

  try {
    await connection.pool.query("select 1 as ready");
    const result = await connection.pool.query<{ hash: string }>(
      `select hash from "${migrationsSchema}"."__drizzle_migrations" order by created_at desc limit 1`
    );
    const current = expected !== undefined && result.rows[0]?.hash === expected;

    return ReadinessReportSchema.parse({
      service: input.service,
      status: current ? "ready" : "not_ready",
      checkedAt,
      database: {
        status: current ? "ready" : "migration_behind",
        migration: current ? "current" : "behind"
      }
    });
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    const databaseReachable = code === "42P01" || code === "3F000";

    return ReadinessReportSchema.parse({
      service: input.service,
      status: "not_ready",
      checkedAt,
      database: {
        status: databaseReachable
          ? "migration_behind"
          : code === "57014"
            ? "timed_out"
            : "unavailable",
        migration: databaseReachable ? "behind" : "unknown"
      }
    });
  }
}
