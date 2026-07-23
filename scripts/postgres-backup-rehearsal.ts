import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  openPostgresConnection,
  parsePostgresConfig,
  type PostgresConnection
} from "../packages/db/src/index.ts";

const RESTORE_NAME = /^vera_restore_rehearsal_[a-f0-9]{16}$/u;

export function validateBackupRehearsalTarget(value: string, confirmation: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:" ||
    url.pathname !== "/vera_test" ||
    confirmation !== "vera_test"
  ) {
    throw new Error("Backup rehearsal requires the exact vera_test database and confirmation.");
  }
  return url;
}

export function redactedDatabaseLabel(value: string): string {
  const url = new URL(value);
  const port = url.port ? `:${url.port}` : "";
  return `${url.hostname}${port}${url.pathname}`;
}

async function checkedSpawn(command: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errorBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.byteLength;
      if (errorBytes > 16_384) child.stderr.pause();
    });
    child.once("error", () =>
      reject(new Error(`PostgreSQL backup tool is unavailable: ${command}.`))
    );
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PostgreSQL backup rehearsal command failed: ${command}.`));
    });
  });
}

interface VerificationCounts extends Record<string, unknown> {
  readonly migrations: number;
  readonly triggers: number;
  readonly tenant_foreign_keys: number;
  readonly users: number;
  readonly raw_listings: number;
  readonly activity_events: number;
  readonly integration_connections: number;
  readonly encrypted_integrations: number;
  readonly web_push_subscriptions: number;
  readonly encrypted_web_push_bytes: number;
}

async function verification(connection: PostgresConnection): Promise<VerificationCounts> {
  const result = await connection.pool.query<VerificationCounts>(`
    select
      (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
      (select count(*)::int
        from pg_trigger trigger
        join pg_class relation on relation.oid = trigger.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where not trigger.tgisinternal
          and trigger.tgname like '%append_only'
          and namespace.nspname = 'public') as triggers,
      (select count(*)::int
        from pg_constraint constraint_record
        join pg_namespace namespace on namespace.oid = constraint_record.connamespace
        where constraint_record.contype = 'f'
          and constraint_record.conname like '%_tenant_fk'
          and namespace.nspname = 'public') as tenant_foreign_keys,
      (select count(*)::int from users) as users,
      (select count(*)::int from raw_listings) as raw_listings,
      (select count(*)::int from activity_events) as activity_events,
      (select count(*)::int from integration_connections) as integration_connections,
      (select count(*)::int from integration_connections where credential_ciphertext is not null) as encrypted_integrations,
      (select count(*)::int from web_push_subscriptions) as web_push_subscriptions,
      (select coalesce(sum(octet_length(credential_nonce) + octet_length(credential_ciphertext) + octet_length(credential_authentication_tag)), 0)::int from web_push_subscriptions) as encrypted_web_push_bytes
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Backup rehearsal verification returned no row.");
  return row;
}

export async function runBackupRehearsal(input: {
  readonly sourceUrl: string;
  readonly confirmation: string;
}): Promise<VerificationCounts> {
  const source = validateBackupRehearsalTarget(input.sourceUrl, input.confirmation);
  const restoreName = `vera_restore_rehearsal_${randomBytes(8).toString("hex")}`;
  if (!RESTORE_NAME.test(restoreName))
    throw new Error("Backup rehearsal target generation failed.");
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "vera-pg-rehearsal-"));
  const dumpPath = join(temporaryDirectory, "vera-test.backup");
  const administrator = new URL(source);
  administrator.pathname = "/postgres";
  const target = new URL(source);
  target.pathname = `/${restoreName}`;
  const sourceConnection = openPostgresConnection(
    parsePostgresConfig({ DATABASE_URL: source.href, VERA_DB_POOL_MAX: "1" })
  );
  let targetConnection: PostgresConnection | null = null;
  let targetCreated = false;

  try {
    await checkedSpawn("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--schema=drizzle",
      "--file",
      dumpPath,
      source.href
    ]);
    await checkedSpawn("createdb", ["--maintenance-db", administrator.href, restoreName]);
    targetCreated = true;
    await checkedSpawn("pg_restore", [
      "--no-owner",
      "--no-acl",
      "--clean",
      "--if-exists",
      "--exit-on-error",
      "--dbname",
      target.href,
      dumpPath
    ]);
    targetConnection = openPostgresConnection(
      parsePostgresConfig({ DATABASE_URL: target.href, VERA_DB_POOL_MAX: "1" })
    );
    const [sourceState, targetState] = await Promise.all([
      verification(sourceConnection),
      verification(targetConnection)
    ]);
    if (JSON.stringify(sourceState) !== JSON.stringify(targetState)) {
      throw new Error("Backup rehearsal restored counts do not match the source database.");
    }
    if (
      targetState.migrations < 5 ||
      targetState.triggers < 4 ||
      targetState.tenant_foreign_keys < 1
    ) {
      throw new Error("Backup rehearsal restored database is missing required controls.");
    }
    return targetState;
  } finally {
    await targetConnection?.close();
    await sourceConnection.close();
    try {
      if (targetCreated) {
        await checkedSpawn("dropdb", [
          "--if-exists",
          "--maintenance-db",
          administrator.href,
          restoreName
        ]);
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const confirmationIndex = process.argv.indexOf("--confirm");
  const confirmation = confirmationIndex >= 0 ? (process.argv[confirmationIndex + 1] ?? "") : "";
  const sourceUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
  const counts = await runBackupRehearsal({ sourceUrl, confirmation });
  process.stdout.write(
    `${JSON.stringify({
      event: "postgres_backup_rehearsal_completed",
      database: redactedDatabaseLabel(sourceUrl),
      counts,
      temporaryDatabaseRemoved: true
    })}\n`
  );
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
