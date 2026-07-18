import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { VeraDatabaseConnection } from "./connection.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function migrateDatabase(connection: VeraDatabaseConnection): void {
  const foreignKeysEnabled = connection.sqlite.pragma("foreign_keys", { simple: true }) === 1;

  // SQLite table recreation cannot replace referenced parent tables while FK enforcement is on.
  // Drizzle runs migrations inside a transaction, where PRAGMA foreign_keys changes are ignored,
  // so bracket the migration at the connection boundary and verify integrity before returning.
  connection.sqlite.pragma("foreign_keys = OFF");

  try {
    migrate(connection.db, { migrationsFolder });
  } finally {
    if (foreignKeysEnabled) {
      connection.sqlite.pragma("foreign_keys = ON");
    }
  }

  const violations = connection.sqlite.pragma("foreign_key_check") as readonly unknown[];

  if (violations.length > 0) {
    throw new Error("Database migration left foreign-key integrity violations.");
  }
}
