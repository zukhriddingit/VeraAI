import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PrivacyDeletionReceiptSchema, type PrivacyDeletionReceipt } from "@vera/domain";
import {
  createPostgresPrivacyLifecycleRepository,
  openPostgresConnection,
  parsePostgresConfig,
  type PostgresConnection
} from "@vera/db";

const MAX_RECEIPT_FILE_BYTES = 10 * 1_024 * 1_024;

export interface ReapplyPrivacyDeletionDependencies {
  readonly readReceiptFile: (path: string) => Promise<string>;
  readonly assertPrivateRegularFile: (path: string) => Promise<void>;
  readonly reapply: (receipt: PrivacyDeletionReceipt) => Promise<"absent" | "reapplied">;
}

export interface ReapplyPrivacyDeletionResult {
  readonly checked: number;
  readonly absent: number;
  readonly reapplied: number;
  readonly failed: number;
}

interface ParsedArguments {
  readonly confirmation: string;
  readonly receiptFile: string;
}

interface RuntimeDependencies extends ReapplyPrivacyDeletionDependencies {
  readonly close: () => Promise<void>;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length !== 4) throw new Error("Privacy deletion restore arguments are invalid.");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag !== "--confirm" && flag !== "--receipt-file") ||
      value === undefined ||
      value.length === 0 ||
      values.has(flag)
    ) {
      throw new Error("Privacy deletion restore arguments are invalid.");
    }
    values.set(flag, value);
  }
  const confirmation = values.get("--confirm");
  const receiptFile = values.get("--receipt-file");
  if (!confirmation || !receiptFile) {
    throw new Error("Privacy deletion restore arguments are invalid.");
  }
  return { confirmation, receiptFile };
}

function assertDatabaseConfirmation(
  environment: Readonly<Record<string, string | undefined>>,
  confirmation: string
): void {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes("/") || confirmation !== databaseName) {
    throw new Error("Database confirmation does not match.");
  }
}

function parseReceiptFile(value: string): readonly PrivacyDeletionReceipt[] {
  if (Buffer.byteLength(value, "utf8") > MAX_RECEIPT_FILE_BYTES) {
    throw new Error("Privacy deletion receipt file is too large.");
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Privacy deletion receipts must be a JSON array.");
  const receipts = parsed.map((receipt) => PrivacyDeletionReceiptSchema.parse(receipt));
  const receiptIds = new Set<string>();
  const ownerIds = new Set<string>();
  for (const receipt of receipts) {
    if (receiptIds.has(receipt.id) || ownerIds.has(receipt.formerUserId)) {
      throw new Error("Privacy deletion receipt file contains duplicates.");
    }
    receiptIds.add(receipt.id);
    ownerIds.add(receipt.formerUserId);
  }
  return receipts.sort(
    (left, right) =>
      left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id)
  );
}

async function assertPrivateRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > MAX_RECEIPT_FILE_BYTES
  ) {
    throw new Error("Privacy deletion receipt file must be a bounded mode-0600 regular file.");
  }
}

function createDefaultDependencies(
  environment: Readonly<Record<string, string | undefined>>
): RuntimeDependencies {
  let connection: PostgresConnection | null = null;
  function repository() {
    connection ??= openPostgresConnection(
      parsePostgresConfig({ ...environment, VERA_DB_POOL_MAX: "1" })
    );
    return createPostgresPrivacyLifecycleRepository(connection);
  }
  return {
    readReceiptFile: (path) => readFile(path, "utf8"),
    assertPrivateRegularFile,
    reapply: (receipt) => repository().reapplyDeletionReceipt(receipt),
    async close() {
      await connection?.close();
    }
  };
}

export async function reapplyPrivacyDeletions(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies?: ReapplyPrivacyDeletionDependencies
): Promise<ReapplyPrivacyDeletionResult> {
  const arguments_ = parseArguments(argv);
  assertDatabaseConfirmation(environment, arguments_.confirmation);
  let defaultRuntime: RuntimeDependencies | null = null;
  const runtime = dependencies ?? (defaultRuntime = createDefaultDependencies(environment));
  try {
    await runtime.assertPrivateRegularFile(arguments_.receiptFile);
    const receipts = parseReceiptFile(await runtime.readReceiptFile(arguments_.receiptFile));
    const result = { checked: 0, absent: 0, reapplied: 0, failed: 0 };
    for (const receipt of receipts) {
      result.checked += 1;
      try {
        const state = await runtime.reapply(receipt);
        result[state] += 1;
      } catch {
        result.failed += 1;
        break;
      }
    }
    return result;
  } finally {
    await defaultRuntime?.close();
  }
}

async function main(): Promise<void> {
  const empty = { checked: 0, absent: 0, reapplied: 0, failed: 0 };
  try {
    const result = await reapplyPrivacyDeletions(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) process.exitCode = 1;
  } catch {
    process.stdout.write(`${JSON.stringify(empty)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
