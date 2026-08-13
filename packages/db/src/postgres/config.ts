import { z } from "zod";

const BoundedMillisecondsSchema = z.coerce.number().int().min(250).max(120_000);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function withRequiredRemoteTls(value: string): string {
  const url = new URL(value);
  if (LOOPBACK_HOSTS.has(url.hostname)) return value;

  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "disable") {
    throw new Error("Remote PostgreSQL connections cannot disable TLS");
  }
  if (sslMode !== null) return value;

  // Heroku emits a standard PostgreSQL URL without query parameters. Node-postgres
  // otherwise attempts plaintext, so require encrypted libpq-compatible transport.
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

export const PostgresConfigSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(?:ql)?:\/\//u.test(value), {
        message: "DATABASE_URL must use a PostgreSQL URI"
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
    connectionString: withRequiredRemoteTls(value.DATABASE_URL),
    poolMax: value.VERA_DB_POOL_MAX,
    connectionTimeoutMilliseconds: value.VERA_DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMilliseconds: value.VERA_DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMilliseconds: value.VERA_DB_LOCK_TIMEOUT_MS,
    idleTransactionTimeoutMilliseconds: value.VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS
  };
}
