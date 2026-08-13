import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { openPostgresConnection, parsePostgresConfig } from "@vera/db";

const PRIVATE_FILE_MODE_MASK = 0o077;
const SUPPORTED_QUERY_KEYS = new Set([
  "application_name",
  "sslmode",
  "sslrootcert",
  "uselibpqcompat"
]);
const REMOTE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function privateEvidencePath(input: string): string {
  if (!isAbsolute(input)) {
    throw new Error("Production PostgreSQL files must stay in a private evidence directory.");
  }
  const path = resolve(input);
  const repositoryPrivate = resolve("release-evidence/private");
  if (
    !path.startsWith("/private/tmp/") &&
    path !== repositoryPrivate &&
    !path.startsWith(`${repositoryPrivate}/`)
  ) {
    throw new Error("Production PostgreSQL files must stay in a private evidence directory.");
  }
  return path;
}

function parseDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2
  ) {
    throw new Error("Production PostgreSQL URL is invalid.");
  }
  for (const key of url.searchParams.keys()) {
    if (!SUPPORTED_QUERY_KEYS.has(key)) {
      throw new Error("Production PostgreSQL URL contains an unsupported option.");
    }
  }
  const sslMode = url.searchParams.get("sslmode") ?? "require";
  if (sslMode === "disable") {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error("Disabled PostgreSQL TLS is only permitted through loopback.");
    }
  } else if (!REMOTE_SSL_MODES.has(sslMode)) {
    throw new Error("Production PostgreSQL TLS mode is invalid.");
  }
  return url;
}

export function connectionEnvironment(
  value: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const url = parseDatabaseUrl(value);
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || "5432",
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
    PGUSER: decodeURIComponent(url.username)
  };
  const applicationName = url.searchParams.get("application_name");
  if (applicationName) environment.PGAPPNAME = applicationName;
  const rootCertificate = url.searchParams.get("sslrootcert");
  if (rootCertificate) environment.PGSSLROOTCERT = rootCertificate;
  return environment;
}

export function redactedDatabaseLabel(value: string): string {
  const url = parseDatabaseUrl(value);
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

export function restoreArguments(databaseName: string, dumpPath: string): string[] {
  if (!/^[a-zA-Z0-9_-]+$/u.test(databaseName)) {
    throw new Error("Restore database name is invalid.");
  }
  return ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", databaseName, dumpPath];
}

export function restoreTargetIsEmpty(input: {
  readonly schemaNames: unknown;
  readonly tableCount: unknown;
}): boolean {
  const schemaNames = Array.isArray(input.schemaNames)
    ? input.schemaNames
    : input.schemaNames === "{public}"
      ? ["public"]
      : [];
  const tableCount =
    typeof input.tableCount === "number"
      ? input.tableCount
      : typeof input.tableCount === "string" && /^\d+$/u.test(input.tableCount)
        ? Number(input.tableCount)
        : -1;
  const allowedEmptySchemaSets = [["public"], ["_heroku", "public"]];
  return (
    tableCount === 0 &&
    allowedEmptySchemaSets.some(
      (allowedSchemaNames) => JSON.stringify(schemaNames) === JSON.stringify(allowedSchemaNames)
    )
  );
}

async function checkedSpawn(
  command: "pg_dump" | "pg_restore",
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...arguments_], {
      env: environment,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errorBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.byteLength;
      if (errorBytes > 16_384) child.stderr.pause();
    });
    child.once("error", () => reject(new Error(`${command} is unavailable.`)));
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} failed with redacted output.`));
    });
  });
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function assertPrivateFile(path: string, label: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & PRIVATE_FILE_MODE_MASK) !== 0) {
    throw new Error(`${label} must be a mode-0600 regular private file.`);
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Production dump output already exists.");
}

async function prepareEmptyTarget(databaseUrl: string): Promise<void> {
  let connection: ReturnType<typeof openPostgresConnection> | null = null;
  try {
    connection = openPostgresConnection(
      parsePostgresConfig({
        DATABASE_URL: databaseUrl,
        VERA_DB_POOL_MAX: "1",
        VERA_DB_CONNECTION_TIMEOUT_MS: "5000",
        VERA_DB_STATEMENT_TIMEOUT_MS: "15000"
      })
    );
    const result = await connection.pool.query<{ schema_names: unknown; table_count: unknown }>(`
      select
        coalesce(
          array_agg(namespace.nspname order by namespace.nspname)
            filter (where namespace.nspname is not null),
          array[]::text[]
        ) as schema_names,
        (select count(*)::int
           from information_schema.tables
          where table_schema not in ('information_schema', 'pg_catalog')
            and table_schema not like 'pg_toast%'
            and table_schema not like 'pg_temp_%'
            and table_type = 'BASE TABLE') as table_count
      from pg_namespace namespace
      where namespace.nspname not in ('information_schema', 'pg_catalog')
        and namespace.nspname not like 'pg_toast%'
        and namespace.nspname not like 'pg_temp_%'
    `);
    const state = result.rows[0];
    if (
      !state ||
      !restoreTargetIsEmpty({ schemaNames: state.schema_names, tableCount: state.table_count })
    ) {
      throw new Error("Production restore target is not empty.");
    }
    await connection.pool.query("drop schema public");
  } catch (error) {
    if (error instanceof Error && error.message === "Production restore target is not empty.") {
      throw error;
    }
    throw new Error("Production restore target inspection failed with redacted output.");
  } finally {
    await connection?.close();
  }
}

function requiredArgument(arguments_: readonly string[], key: string): string {
  const index = arguments_.indexOf(key);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${key}.`);
  return privateEvidencePath(value);
}

async function main(): Promise<void> {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode !== "dump" && mode !== "list" && mode !== "restore") {
    throw new Error("Expected dump, list, or restore mode.");
  }

  const dumpPath = requiredArgument(arguments_, "--dump-file");
  if (mode === "list") {
    await assertPrivateFile(dumpPath, "Production dump");
    await checkedSpawn("pg_restore", ["--list", dumpPath], process.env);
  } else {
    const databaseUrlFile = requiredArgument(arguments_, "--database-url-file");
    await assertPrivateFile(databaseUrlFile, "Database URL file");
    const databaseUrl = (await readFile(databaseUrlFile, "utf8")).trim();
    const environment = connectionEnvironment(databaseUrl);

    if (mode === "dump") {
      await assertMissing(dumpPath);
      await checkedSpawn(
        "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--schema=public",
          "--schema=drizzle",
          "--file",
          dumpPath
        ],
        environment
      );
      await chmod(dumpPath, 0o600);
      await assertPrivateFile(dumpPath, "Production dump");
    } else {
      if (!arguments_.includes("--confirm-empty-target")) {
        throw new Error("Restore requires --confirm-empty-target.");
      }
      await assertPrivateFile(dumpPath, "Production dump");
      await prepareEmptyTarget(databaseUrl);
      const databaseName = environment.PGDATABASE;
      if (!databaseName) throw new Error("Restore target database name is missing.");
      await checkedSpawn("pg_restore", restoreArguments(databaseName, dumpPath), environment);
    }
  }

  const metadata = await stat(dumpPath);
  process.stdout.write(
    `${JSON.stringify({
      event: `production_postgres_${mode}_completed`,
      dumpBytes: metadata.size,
      dumpSha256: await fileSha256(dumpPath)
    })}\n`
  );
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.umask(0o077);
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Production transfer failed."}\n`
    );
    process.exitCode = 1;
  }
}
