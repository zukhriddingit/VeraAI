import { z } from "zod";

const BoundedMillisecondsSchema = z.coerce.number().int().min(250).max(120_000);

export const PostgresConfigSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith("postgresql://"), {
        message: "DATABASE_URL must use postgresql://"
      }),
    VERA_DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    VERA_DB_CONNECTION_TIMEOUT_MS: BoundedMillisecondsSchema.default(5_000),
    VERA_DB_STATEMENT_TIMEOUT_MS: BoundedMillisecondsSchema.default(15_000),
    VERA_DB_LOCK_TIMEOUT_MS: BoundedMillisecondsSchema.default(3_000),
    VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: BoundedMillisecondsSchema.default(10_000)
  })
  .passthrough();

export interface PostgresConfig {
  readonly connectionString: string;
  readonly poolMax: number;
  readonly connectionTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly idleTransactionTimeoutMilliseconds: number;
}

export function parsePostgresConfig(
  environment: Readonly<Record<string, string | undefined>>
): PostgresConfig {
  const value = PostgresConfigSchema.parse(environment);

  return {
    connectionString: value.DATABASE_URL,
    poolMax: value.VERA_DB_POOL_MAX,
    connectionTimeoutMilliseconds: value.VERA_DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMilliseconds: value.VERA_DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMilliseconds: value.VERA_DB_LOCK_TIMEOUT_MS,
    idleTransactionTimeoutMilliseconds: value.VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS
  };
}
