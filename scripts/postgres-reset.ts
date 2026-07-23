import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface LocalPostgresResetTarget {
  readonly hostname: "127.0.0.1" | "localhost";
  readonly database: "vera";
  readonly username: "vera";
}

export function validateLocalPostgresReset(
  environment: Readonly<Record<string, string | undefined>>
): LocalPostgresResetTarget {
  if (environment.NODE_ENV === "production") {
    throw new Error("postgres:reset is disabled in production.");
  }
  const value = environment.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for postgres:reset.");
  const url = new URL(value);
  if (url.protocol !== "postgresql:") throw new Error("PostgreSQL is required.");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("postgres:reset accepts only a loopback host.");
  }
  if (url.pathname !== "/vera" || url.username !== "vera") {
    throw new Error("postgres:reset accepts only the local vera database and vera user.");
  }
  return { hostname: url.hostname, database: "vera", username: "vera" };
}

type Runner = (args: readonly string[]) => string;

function defaultRunner(args: readonly string[]): string {
  return execFileSync("docker", [...args], { encoding: "utf8" });
}

export function resetLocalPostgres(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runner: Runner = defaultRunner
): void {
  validateLocalPostgresReset(environment);
  const status = runner(["compose", "ps", "--format", "json", "postgres"]);
  if (!status.includes('"Service":"postgres"') || !status.includes('"Project":"vera"')) {
    throw new Error("The expected Vera Compose PostgreSQL service is not active.");
  }
  runner(["compose", "down", "--volumes"]);
  runner(["compose", "up", "-d", "postgres"]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  resetLocalPostgres();
  process.stdout.write(`${JSON.stringify({ event: "local_postgres_reset_started" })}\n`);
}
