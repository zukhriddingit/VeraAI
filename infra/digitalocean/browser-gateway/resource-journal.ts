import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { PRIVATE_FILE_MODE } from "./config.ts";

export type DigitalOceanResourceKind =
  | "dns_zone"
  | "certificate"
  | "droplet"
  | "firewall"
  | "tag"
  | "ssh_key"
  | "load_balancer"
  | "dns_record";

export type ResourceCleanupState = "active" | "delete_pending" | "deleted" | "delete_failed";

export interface ResourceJournalEntry {
  kind: DigitalOceanResourceKind;
  name: string;
  id: string;
  status: string;
  createdAtUtc: string;
  cleanupState: ResourceCleanupState;
}

export interface ResourceJournalSnapshot {
  schemaVersion: 1;
  runId: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  resources: ResourceJournalEntry[];
}

export interface ResourceCreatedInput {
  kind: DigitalOceanResourceKind;
  name: string;
  id: string;
  status: string;
  createdAtUtc: string;
}

export interface ResourceJournalAtomicWriteHooks {
  beforeRename?: () => Promise<void>;
}

const RESOURCE_KINDS = new Set<DigitalOceanResourceKind>([
  "dns_zone",
  "certificate",
  "droplet",
  "firewall",
  "tag",
  "ssh_key",
  "load_balancer",
  "dns_record"
]);
const CLEANUP_STATES = new Set<ResourceCleanupState>([
  "active",
  "delete_pending",
  "deleted",
  "delete_failed"
]);
const RUN_ID = /^[0-9]{8}-[0-9]{2}$/u;
const BOUNDED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const BOUNDED_STATUS = /^[a-z0-9][a-z0-9_:-]{0,63}$/u;
const SECRET_PATTERN =
  /(?:dop_v1_|authorization|bearer\s|begin (?:openssh|rsa|ec) private key|[0-9a-f]{64})/iu;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertSecretFree(value: unknown): void {
  if (SECRET_PATTERN.test(JSON.stringify(value))) {
    throw new Error("resource_journal_secret_rejected");
  }
}

export function assertResourceJournalSnapshot(
  value: unknown
): asserts value is ResourceJournalSnapshot {
  const candidate = object(value);
  if (
    candidate === null ||
    !exactKeys(candidate, [
      "schemaVersion",
      "runId",
      "createdAtUtc",
      "updatedAtUtc",
      "resources"
    ]) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.runId !== "string" ||
    !RUN_ID.test(candidate.runId) ||
    !isIsoInstant(candidate.createdAtUtc) ||
    !isIsoInstant(candidate.updatedAtUtc) ||
    !Array.isArray(candidate.resources)
  ) {
    throw new Error("resource_journal_rejected");
  }

  const identities = new Set<string>();
  const providerIdentities = new Set<string>();
  for (const rawEntry of candidate.resources) {
    const entry = object(rawEntry);
    if (
      entry === null ||
      !exactKeys(entry, ["kind", "name", "id", "status", "createdAtUtc", "cleanupState"]) ||
      typeof entry.kind !== "string" ||
      !RESOURCE_KINDS.has(entry.kind as DigitalOceanResourceKind) ||
      typeof entry.name !== "string" ||
      !BOUNDED_IDENTIFIER.test(entry.name) ||
      typeof entry.id !== "string" ||
      !BOUNDED_IDENTIFIER.test(entry.id) ||
      typeof entry.status !== "string" ||
      !BOUNDED_STATUS.test(entry.status) ||
      !isIsoInstant(entry.createdAtUtc) ||
      typeof entry.cleanupState !== "string" ||
      !CLEANUP_STATES.has(entry.cleanupState as ResourceCleanupState)
    ) {
      throw new Error("resource_journal_rejected");
    }
    const identity = `${entry.kind}\u0000${entry.name}`;
    const providerIdentity = `${entry.kind}\u0000${entry.id}`;
    if (identities.has(identity) || providerIdentities.has(providerIdentity)) {
      throw new Error("resource_journal_rejected");
    }
    identities.add(identity);
    providerIdentities.add(providerIdentity);
  }
  assertSecretFree(candidate);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("resource_journal_directory_rejected");
  }
  if ((stat.mode & 0o777) !== 0o700) {
    throw new Error("resource_journal_directory_mode_rejected");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("resource_journal_directory_owner_rejected");
  }
}

async function readExistingJournal(path: string): Promise<ResourceJournalSnapshot | null> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("resource_journal_file_rejected");
  }
  if ((stat.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new Error("resource_journal_file_mode_rejected");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("resource_journal_file_owner_rejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("resource_journal_rejected");
  }
  assertResourceJournalSnapshot(parsed);
  return parsed;
}

export async function writeResourceJournalSnapshotAtomic(
  outputPath: string,
  snapshot: ResourceJournalSnapshot,
  hooks: ResourceJournalAtomicWriteHooks = {}
): Promise<void> {
  assertResourceJournalSnapshot(snapshot);
  const absolutePath = resolve(outputPath);
  const directory = dirname(absolutePath);
  await assertPrivateDirectory(directory);
  const temporaryPath = resolve(directory, `.${basename(absolutePath)}.${randomUUID()}.next`);
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE
  );
  try {
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await hooks.beforeRename?.();
    await rename(temporaryPath, absolutePath);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class ResourceJournal {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private current: ResourceJournalSnapshot,
    private readonly now: () => Date
  ) {}

  snapshot(): ResourceJournalSnapshot {
    return structuredClone(this.current);
  }

  find(kind: DigitalOceanResourceKind, name: string): ResourceJournalEntry[] {
    return this.current.resources
      .filter((entry) => entry.kind === kind && entry.name === name)
      .map((entry) => structuredClone(entry));
  }

  private async mutate(update: (snapshot: ResourceJournalSnapshot) => void): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const next = structuredClone(this.current);
      update(next);
      next.updatedAtUtc = this.now().toISOString();
      assertResourceJournalSnapshot(next);
      await writeResourceJournalSnapshotAtomic(this.path, next);
      this.current = next;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async recordCreated(input: ResourceCreatedInput): Promise<void> {
    await this.mutate((snapshot) => {
      const exact = snapshot.resources.find(
        (entry) => entry.kind === input.kind && entry.name === input.name
      );
      if (exact !== undefined) {
        if (
          exact.id !== input.id ||
          exact.status !== input.status ||
          exact.createdAtUtc !== input.createdAtUtc
        ) {
          throw new Error("resource_journal_identity_conflict");
        }
        return;
      }
      snapshot.resources.push({
        ...input,
        cleanupState: "active"
      });
    });
  }

  async updateStatus(kind: DigitalOceanResourceKind, id: string, status: string): Promise<void> {
    await this.mutate((snapshot) => {
      const entry = snapshot.resources.find(
        (candidate) => candidate.kind === kind && candidate.id === id
      );
      if (entry === undefined) throw new Error("resource_journal_entry_missing");
      entry.status = status;
    });
  }

  async markCleanup(
    kind: DigitalOceanResourceKind,
    id: string,
    cleanupState: Exclude<ResourceCleanupState, "active">
  ): Promise<void> {
    await this.mutate((snapshot) => {
      const entry = snapshot.resources.find(
        (candidate) => candidate.kind === kind && candidate.id === id
      );
      if (entry === undefined) throw new Error("resource_journal_entry_missing");
      entry.cleanupState = cleanupState;
    });
  }
}

export async function openResourceJournal(input: {
  path: string;
  runId: string;
  now?: () => Date;
}): Promise<ResourceJournal> {
  if (!RUN_ID.test(input.runId)) {
    throw new Error("resource_journal_run_id_rejected");
  }
  const absolutePath = resolve(input.path);
  await assertPrivateDirectory(dirname(absolutePath));
  const now = input.now ?? (() => new Date());
  let snapshot = await readExistingJournal(absolutePath);
  if (snapshot !== null && snapshot.runId !== input.runId) {
    throw new Error("resource_journal_run_id_mismatch");
  }
  if (snapshot === null) {
    const createdAtUtc = now().toISOString();
    snapshot = {
      schemaVersion: 1,
      runId: input.runId,
      createdAtUtc,
      updatedAtUtc: createdAtUtc,
      resources: []
    };
    await writeResourceJournalSnapshotAtomic(absolutePath, snapshot);
  }
  return new ResourceJournal(absolutePath, snapshot, now);
}
