import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { getDatabasePath } from "./paths.ts";
import { schema } from "./schema.ts";

export interface OpenDatabaseOptions {
  filePath?: string;
}

export interface VeraDatabaseConnection {
  readonly filePath: string;
  readonly sqlite: BetterSqlite3.Database;
  readonly db: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export class DatabaseInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseInitializationError";
  }
}

function initializeConnection(filePath: string): VeraDatabaseConnection {
  const sqlite = new BetterSqlite3(filePath);

  try {
    sqlite.pragma("foreign_keys = ON");
    const journalMode = sqlite.pragma("journal_mode = WAL", { simple: true });
    sqlite.pragma("busy_timeout = 5000");

    const foreignKeys = sqlite.pragma("foreign_keys", { simple: true });
    const busyTimeout = sqlite.pragma("busy_timeout", { simple: true });

    if (foreignKeys !== 1) {
      throw new DatabaseInitializationError("SQLite foreign-key enforcement could not be enabled.");
    }

    if (journalMode !== "wal") {
      throw new DatabaseInitializationError("SQLite WAL mode could not be enabled.");
    }

    if (busyTimeout !== 5_000) {
      throw new DatabaseInitializationError("SQLite busy timeout could not be configured.");
    }

    const db = drizzle(sqlite, { schema });

    return {
      filePath,
      sqlite,
      db,
      close() {
        sqlite.close();
      }
    };
  } catch (error: unknown) {
    sqlite.close();
    throw error;
  }
}

export function openDatabase(options: OpenDatabaseOptions = {}): VeraDatabaseConnection {
  const filePath = resolve(options.filePath ?? getDatabasePath());
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  return initializeConnection(filePath);
}

export function openExistingDatabase(options: OpenDatabaseOptions = {}): VeraDatabaseConnection {
  const filePath = resolve(options.filePath ?? getDatabasePath());

  if (!existsSync(filePath)) {
    throw new DatabaseInitializationError("The Vera database has not been initialized.");
  }

  return initializeConnection(filePath);
}
