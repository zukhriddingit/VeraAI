import type { Pool, PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PostgresConfig } from "./config.ts";
import { openPostgresConnection } from "./connection.ts";

const config: PostgresConfig = {
  connectionString: "postgresql://vera:synthetic@127.0.0.1:5432/vera",
  poolMax: 5,
  connectionTimeoutMilliseconds: 5_000,
  statementTimeoutMilliseconds: 15_000,
  lockTimeoutMilliseconds: 3_000,
  idleTransactionTimeoutMilliseconds: 10_000
};

describe("openPostgresConnection", () => {
  it("constructs one bounded pool and closes it once", async () => {
    let captured: PoolConfig | undefined;
    const end = vi.fn(async () => undefined);
    const pool = { end } as unknown as Pool;
    const connection = openPostgresConnection(config, {
      createPool(options) {
        captured = options;
        return pool;
      }
    });

    expect(captured).toMatchObject({
      connectionString: config.connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      lock_timeout: 3_000,
      idle_in_transaction_session_timeout: 10_000
    });
    await connection.close();
    await connection.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("rejects arbitrary search paths", () => {
    expect(() =>
      openPostgresConnection(config, {
        searchPath: "public; drop schema public",
        createPool: () => ({ end: vi.fn() }) as unknown as Pool
      })
    ).toThrow("search path is invalid");
  });
});
