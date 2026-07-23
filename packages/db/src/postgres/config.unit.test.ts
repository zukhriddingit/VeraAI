import { describe, expect, it } from "vitest";

import { parsePostgresConfig } from "./config.ts";

const valid = {
  DATABASE_URL: "postgresql://vera:vera_dev_only@127.0.0.1:5432/vera",
  VERA_DB_POOL_MAX: "5",
  VERA_DB_CONNECTION_TIMEOUT_MS: "5000",
  VERA_DB_STATEMENT_TIMEOUT_MS: "15000",
  VERA_DB_LOCK_TIMEOUT_MS: "3000",
  VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000"
};

describe("parsePostgresConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => parsePostgresConfig({})).toThrow("DATABASE_URL");
  });

  it("rejects an oversized pool", () => {
    expect(() => parsePostgresConfig({ ...valid, VERA_DB_POOL_MAX: "51" })).toThrow(
      "VERA_DB_POOL_MAX"
    );
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() =>
      parsePostgresConfig({ ...valid, DATABASE_URL: "https://database.example.test/vera" })
    ).toThrow("DATABASE_URL must use postgresql://");
  });

  it("returns bounded production settings", () => {
    expect(parsePostgresConfig(valid)).toEqual({
      connectionString: valid.DATABASE_URL,
      poolMax: 5,
      connectionTimeoutMilliseconds: 5_000,
      statementTimeoutMilliseconds: 15_000,
      lockTimeoutMilliseconds: 3_000,
      idleTransactionTimeoutMilliseconds: 10_000
    });
  });
});
