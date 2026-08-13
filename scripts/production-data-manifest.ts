import { readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  openPostgresConnection,
  parsePostgresConfig,
  sha256Text,
  type PostgresConnection
} from "@vera/db";

import { privateEvidencePath } from "./production-postgres-transfer.ts";

const PRIVATE_FILE_MODE_MASK = 0o077;
const MIGRATION_IDENTITY = /^\d+:[a-f0-9]{4,128}$/u;
const TABLE_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const FORBIDDEN_BROWSER_ACTIONS = [
  "apply",
  "contact",
  "download",
  "email",
  "message",
  "messenger",
  "payment",
  "phone",
  "tour",
  "upload"
] as const;

export interface ProductionTableCount {
  readonly table: string;
  readonly rows: number;
}

export interface ProductionManifestControls {
  readonly appendOnlyTriggers: number;
  readonly tenantForeignKeys: number;
  readonly forbiddenBrowserActions: number;
}

export interface ProductionDataManifest {
  readonly version: "vera-production-data-manifest.v1";
  readonly capturedAt: string;
  readonly migrations: readonly string[];
  readonly tableCounts: readonly ProductionTableCount[];
  readonly controls: ProductionManifestControls;
  readonly contentHash: string;
}

interface ProductionManifestInput {
  readonly capturedAt: string;
  readonly migrations: readonly string[];
  readonly tableCounts: readonly ProductionTableCount[];
  readonly controls: ProductionManifestControls;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function manifestPayload(input: ProductionManifestInput) {
  const capturedAt = new Date(input.capturedAt);
  if (Number.isNaN(capturedAt.valueOf())) throw new Error("Production capture time is invalid.");

  const migrations = [...input.migrations].sort();
  if (
    migrations.some((migration) => !MIGRATION_IDENTITY.test(migration)) ||
    new Set(migrations).size !== migrations.length
  ) {
    throw new Error("Production migration identity is invalid.");
  }

  const tableCounts = [...input.tableCounts].sort((left, right) =>
    left.table.localeCompare(right.table)
  );
  if (
    tableCounts.some(({ table, rows }) => !TABLE_IDENTIFIER.test(table) || !validCount(rows)) ||
    new Set(tableCounts.map(({ table }) => table)).size !== tableCounts.length
  ) {
    throw new Error("Production table count is invalid.");
  }

  if (
    !validCount(input.controls.appendOnlyTriggers) ||
    !validCount(input.controls.tenantForeignKeys) ||
    !validCount(input.controls.forbiddenBrowserActions)
  ) {
    throw new Error("Production control count is invalid.");
  }
  if (input.controls.forbiddenBrowserActions !== 0) {
    throw new Error("Forbidden browser actions are nonzero.");
  }

  return {
    version: "vera-production-data-manifest.v1" as const,
    migrations,
    tableCounts,
    controls: {
      appendOnlyTriggers: input.controls.appendOnlyTriggers,
      tenantForeignKeys: input.controls.tenantForeignKeys,
      forbiddenBrowserActions: input.controls.forbiddenBrowserActions
    }
  };
}

export function createProductionDataManifest(
  input: ProductionManifestInput
): ProductionDataManifest {
  const payload = manifestPayload(input);
  return {
    ...payload,
    capturedAt: new Date(input.capturedAt).toISOString(),
    contentHash: sha256Text(canonicalJson(payload))
  };
}

function recreated(manifest: ProductionDataManifest): ProductionDataManifest {
  return createProductionDataManifest({
    capturedAt: manifest.capturedAt,
    migrations: manifest.migrations,
    tableCounts: manifest.tableCounts,
    controls: manifest.controls
  });
}

export function assertManifestMatches(
  expected: ProductionDataManifest,
  actual: ProductionDataManifest
): void {
  const expectedRecreated = recreated(expected);
  const actualRecreated = recreated(actual);
  if (
    !/^[a-f0-9]{64}$/u.test(expected.contentHash) ||
    !/^[a-f0-9]{64}$/u.test(actual.contentHash) ||
    expected.contentHash !== expectedRecreated.contentHash ||
    actual.contentHash !== actualRecreated.contentHash
  ) {
    throw new Error("Production data manifest self-hash is invalid.");
  }
  if (expected.contentHash !== actual.contentHash) {
    throw new Error("Production data manifests do not match.");
  }
}

function safeInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(`Production ${label} count is invalid.`);
  }
  const parsed = Number(value);
  if (!validCount(parsed)) throw new Error(`Production ${label} count is invalid.`);
  return parsed;
}

async function collectManifest(connection: PostgresConnection): Promise<ProductionDataManifest> {
  const tablesResult = await connection.pool.query<{ table_name: string }>(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
     order by table_name
  `);
  const tableCounts: ProductionTableCount[] = [];
  for (const { table_name: table } of tablesResult.rows) {
    if (!TABLE_IDENTIFIER.test(table)) throw new Error("Production table identifier is invalid.");
    const result = await connection.pool.query<{ count: string }>(
      `select count(*)::text as count from "${table}"`
    );
    tableCounts.push({
      table,
      rows: safeInteger(result.rows[0]?.count, table)
    });
  }

  const migrationsResult = await connection.pool.query<{ id: string; hash: string }>(`
    select id::text as id, hash
      from drizzle.__drizzle_migrations
     order by id
  `);
  const controlsResult = await connection.pool.query<{
    append_only_triggers: string;
    forbidden_browser_actions: string;
    tenant_foreign_keys: string;
  }>(
    `select
       (select count(*)::text
          from pg_trigger trigger
          join pg_class relation on relation.oid = trigger.tgrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where not trigger.tgisinternal
           and trigger.tgname like '%append_only'
           and namespace.nspname = 'public') as append_only_triggers,
       (select count(*)::text
          from pg_constraint constraint_record
          join pg_namespace namespace on namespace.oid = constraint_record.connamespace
         where constraint_record.contype = 'f'
           and constraint_record.conname like '%_tenant_fk'
           and namespace.nspname = 'public') as tenant_foreign_keys,
       (select count(*)::text
          from activity_events
         where action in ('browser.research_action_checked', 'browser.zillow_research_action_checked')
           and lower(coalesce(metadata ->> 'action', '')) = any($1::text[])) as forbidden_browser_actions`,
    [FORBIDDEN_BROWSER_ACTIONS]
  );
  const controls = controlsResult.rows[0];
  if (!controls) throw new Error("Production database controls returned no row.");

  return createProductionDataManifest({
    capturedAt: new Date().toISOString(),
    migrations: migrationsResult.rows.map(({ id, hash }) => `${id}:${hash}`),
    tableCounts,
    controls: {
      appendOnlyTriggers: safeInteger(controls.append_only_triggers, "append-only trigger"),
      tenantForeignKeys: safeInteger(controls.tenant_foreign_keys, "tenant foreign key"),
      forbiddenBrowserActions: safeInteger(
        controls.forbidden_browser_actions,
        "forbidden browser action"
      )
    }
  });
}

async function assertPrivateRegularFile(path: string, label: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & PRIVATE_FILE_MODE_MASK) !== 0) {
    throw new Error(`${label} must be a mode-0600 regular private file.`);
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

function requiredArgument(arguments_: readonly string[], key: string): string {
  const index = arguments_.indexOf(key);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${key}.`);
  return privateEvidencePath(value);
}

function parseManifest(value: unknown): ProductionDataManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Production data manifest is invalid.");
  }
  const candidate = value as Partial<ProductionDataManifest>;
  if (
    candidate.version !== "vera-production-data-manifest.v1" ||
    typeof candidate.capturedAt !== "string" ||
    !Array.isArray(candidate.migrations) ||
    !Array.isArray(candidate.tableCounts) ||
    typeof candidate.controls !== "object" ||
    candidate.controls === null ||
    typeof candidate.contentHash !== "string"
  ) {
    throw new Error("Production data manifest is invalid.");
  }
  const manifest = candidate as ProductionDataManifest;
  assertManifestMatches(manifest, manifest);
  return manifest;
}

async function openPrivateDatabase(databaseUrlFile: string): Promise<{
  readonly connection: PostgresConnection;
  readonly manifest: ProductionDataManifest;
}> {
  let connection: PostgresConnection | null = null;
  try {
    await assertPrivateRegularFile(databaseUrlFile, "Database URL file");
    const databaseUrl = (await readFile(databaseUrlFile, "utf8")).trim();
    connection = openPostgresConnection(
      parsePostgresConfig({
        DATABASE_URL: databaseUrl,
        VERA_DB_POOL_MAX: "1",
        VERA_DB_CONNECTION_TIMEOUT_MS: "5000",
        VERA_DB_STATEMENT_TIMEOUT_MS: "120000",
        VERA_DB_LOCK_TIMEOUT_MS: "3000",
        VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000"
      })
    );
    return { connection, manifest: await collectManifest(connection) };
  } catch {
    await connection?.close();
    throw new Error("Production data manifest collection failed with redacted output.");
  }
}

async function main(): Promise<void> {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode !== "capture" && mode !== "compare") {
    throw new Error("Expected capture or compare mode.");
  }
  const databaseUrlFile = requiredArgument(arguments_, "--database-url-file");
  const outputFile = requiredArgument(arguments_, "--output-file");
  const { connection, manifest } = await openPrivateDatabase(databaseUrlFile);
  try {
    if (mode === "capture") {
      await writePrivateJson(outputFile, manifest);
    } else {
      const expectedFile = requiredArgument(arguments_, "--expected-file");
      await assertPrivateRegularFile(expectedFile, "Expected manifest");
      const expected = parseManifest(JSON.parse(await readFile(expectedFile, "utf8")) as unknown);
      assertManifestMatches(expected, manifest);
      await writePrivateJson(outputFile, {
        version: "vera-production-data-comparison.v1",
        verifiedAt: new Date().toISOString(),
        expectedContentHash: expected.contentHash,
        actualContentHash: manifest.contentHash,
        tableCount: manifest.tableCounts.length,
        matches: true
      });
    }
  } finally {
    await connection.close();
  }
  process.stdout.write(
    `${JSON.stringify({
      event: `production_data_manifest_${mode}_completed`,
      contentHash: manifest.contentHash,
      tableCount: manifest.tableCounts.length
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
      `${error instanceof Error ? error.message : "Manifest operation failed."}\n`
    );
    process.exitCode = 1;
  }
}
