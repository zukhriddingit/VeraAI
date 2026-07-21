import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import type { PostgresConfig } from "./config.ts";
import { schema } from "./schema.ts";

export interface PostgresConnection {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
  close(): Promise<void>;
}

export interface OpenPostgresConnectionOptions {
  readonly createPool?: (options: PoolConfig) => Pool;
  readonly searchPath?: string;
}

function searchPathOptions(searchPath: string | undefined): string | undefined {
  if (searchPath === undefined) return undefined;
  if (!/^vera_test_[a-f0-9]{16,64}$/u.test(searchPath)) {
    throw new Error("The PostgreSQL test search path is invalid.");
  }
  return `-c search_path=${searchPath},public`;
}

export function openPostgresConnection(
  config: PostgresConfig,
  options: OpenPostgresConnectionOptions = {}
): PostgresConnection {
  const pool = (options.createPool ?? ((poolConfig) => new Pool(poolConfig)))({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
    statement_timeout: config.statementTimeoutMilliseconds,
    lock_timeout: config.lockTimeoutMilliseconds,
    idle_in_transaction_session_timeout: config.idleTransactionTimeoutMilliseconds,
    application_name: "vera",
    options: searchPathOptions(options.searchPath)
  });
  const db = drizzle(pool, { schema });
  let closing: Promise<void> | null = null;

  return {
    pool,
    db,
    close() {
      closing ??= pool.end();
      return closing;
    }
  };
}
