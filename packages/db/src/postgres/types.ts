import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";

import { schema } from "./schema.ts";

export type PostgresDatabase = NodePgDatabase<typeof schema>;
export type PostgresTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type PostgresExecutor = PostgresDatabase | PostgresTransaction;
