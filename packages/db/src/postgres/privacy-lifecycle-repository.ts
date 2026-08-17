import { createHash, randomUUID } from "node:crypto";

import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS,
  PRIVACY_EXPORT_SCHEMA_VERSION,
  PRIVACY_EXPORT_WARNING,
  PrivacyDeletionReceiptSchema,
  PrivacyExportManifestSchema,
  PrivacyExportRecordSchema,
  PrivacyRevocationStatusSchema,
  Sha256Schema,
  VeraUserIdSchema,
  type JsonObject,
  type PrivacyDeletionReceipt,
  type PrivacyExportManifest,
  type PrivacyExportRecord,
  type PrivacyRevocationStatus,
  type VeraUserId
} from "@vera/domain";
import type { PoolClient } from "pg";
import { z } from "zod";

import type { PostgresConnection } from "./connection.ts";
import { mapPostgresError } from "./errors.ts";
import {
  PRIVACY_OWNER_TABLE_POLICY,
  assertPrivacyExportDataSafe,
  privacyExportTableNames,
  privacyOwnerTableNames,
  type PrivacyOwnerTableName
} from "./privacy-owner-table-policy.ts";

const ExportInputSchema = z
  .object({ userId: VeraUserIdSchema, generatedAt: IsoDateTimeSchema })
  .strict();
const IssueChallengeInputSchema = z
  .object({
    id: z.uuid(),
    userId: VeraUserIdSchema,
    challengeDigest: Sha256Schema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict();
const ConsumeChallengeInputSchema = z
  .object({
    userId: VeraUserIdSchema,
    challengeDigest: Sha256Schema,
    consumedAt: IsoDateTimeSchema
  })
  .strict();
const DeleteOwnerInputSchema = z
  .object({
    userId: VeraUserIdSchema,
    consumedChallengeId: z.uuid(),
    subjectDigest: Sha256Schema,
    providerRevocation: PrivacyRevocationStatusSchema,
    browserRevocation: PrivacyRevocationStatusSchema,
    completedAt: IsoDateTimeSchema,
    backupEraseAfter: IsoDateTimeSchema,
    legalHoldUntil: IsoDateTimeSchema.nullable()
  })
  .strict();

type ProjectedTable = {
  [Table in PrivacyOwnerTableName]: (typeof PRIVACY_OWNER_TABLE_POLICY)[Table] extends "project"
    ? Table
    : never;
}[PrivacyOwnerTableName];

const SAFE_PROJECTIONS = {
  beta_memberships: `jsonb_build_object(
    'id', id, 'status', status, 'invited_at', invited_at,
    'activated_at', activated_at, 'revoked_at', revoked_at
  )`,
  browser_connector_devices: `jsonb_build_object(
    'id', id, 'extension_version', extension_version, 'protocol_version', protocol_version,
    'status', status, 'created_at', created_at, 'connected_at', connected_at,
    'last_seen_at', last_seen_at, 'revoked_at', revoked_at
  )`,
  browser_gateway_assignments: `jsonb_build_object(
    'id', id, 'status', status, 'created_at', created_at,
    'activated_at', activated_at, 'revoked_at', revoked_at
  )`,
  browser_nodes: `jsonb_build_object(
    'node_name', node_name, 'status', status, 'pairing_state', pairing_state,
    'capability_approval_state', capability_approval_state,
    'reported_openclaw_version', reported_openclaw_version,
    'expected_openclaw_version', expected_openclaw_version,
    'version_compatibility', version_compatibility,
    'last_heartbeat_at', last_heartbeat_at, 'heartbeat_expires_at', heartbeat_expires_at,
    'last_successful_capture_at', last_successful_capture_at, 'disabled_at', disabled_at,
    'contract_version', contract_version, 'capabilities', capabilities,
    'created_at', created_at, 'updated_at', updated_at
  )`,
  integration_connections: `jsonb_build_object(
    'id', id, 'provider', provider, 'display_email', display_email,
    'granted_scopes', granted_scopes, 'status', status, 'token_expires_at', token_expires_at,
    'last_successful_use_at', last_successful_use_at, 'created_at', created_at,
    'updated_at', updated_at
  )`,
  maritime_dispatches: `jsonb_build_object(
    'id', id, 'source_job_id', source_job_id, 'state', state,
    'maritime_run_id', maritime_run_id, 'issued_at', issued_at, 'expires_at', expires_at,
    'accepted_at', accepted_at, 'consumed_at', consumed_at, 'rejected_at', rejected_at,
    'rejection_code', rejection_code, 'payload_hash', payload_hash,
    'created_at', created_at, 'updated_at', updated_at
  )`,
  web_push_subscriptions: `jsonb_build_object(
    'id', id, 'status', status, 'created_at', created_at,
    'updated_at', updated_at, 'revoked_at', revoked_at
  )`
} as const satisfies Readonly<Record<ProjectedTable, string>>;

function safeProjection(table: PrivacyOwnerTableName): string {
  const projection = SAFE_PROJECTIONS[table as ProjectedTable];
  if (!projection) throw new Error(`Privacy projection for ${table} is unavailable.`);
  return projection;
}

export interface PrivacyDeletionChallenge {
  readonly id: string;
  readonly userId: VeraUserId;
  readonly challengeDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export interface PrivacyExportBundle {
  readonly manifest: PrivacyExportManifest;
  readonly records: readonly PrivacyExportRecord[];
}

export interface PrivacyLifecycleRepository {
  exportOwner(input: { userId: VeraUserId; generatedAt: string }): Promise<PrivacyExportBundle>;
  getDeletionIdentity(userId: VeraUserId): Promise<{
    normalizedEmail: string;
    providerSubject: string;
  }>;
  issueDeletionChallenge(input: {
    id: string;
    userId: VeraUserId;
    challengeDigest: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<PrivacyDeletionChallenge>;
  consumeDeletionChallenge(input: {
    userId: VeraUserId;
    challengeDigest: string;
    consumedAt: string;
  }): Promise<string>;
  deleteOwnerAccount(input: {
    userId: VeraUserId;
    consumedChallengeId: string;
    subjectDigest: string;
    providerRevocation: PrivacyRevocationStatus;
    browserRevocation: PrivacyRevocationStatus;
    completedAt: string;
    backupEraseAfter: string;
    legalHoldUntil: string | null;
  }): Promise<PrivacyDeletionReceipt>;
  reapplyDeletionReceipt(receipt: PrivacyDeletionReceipt): Promise<"absent" | "reapplied">;
  countOwnerRows(userId: VeraUserId): Promise<Readonly<Record<string, number>>>;
}

export class PrivacyLifecycleRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyLifecycleRepositoryError";
  }
}

interface ChallengeRow {
  readonly id: string;
  readonly userId: string;
  readonly challengeDigest: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

interface ReceiptRow {
  readonly id: string;
  readonly formerUserId: string;
  readonly subjectDigest: string;
  readonly providerRevocation: string;
  readonly browserRevocation: string;
  readonly completedAt: Date;
  readonly backupEraseAfter: Date;
  readonly legalHoldUntil: Date | null;
}

function mapChallenge(row: ChallengeRow): PrivacyDeletionChallenge {
  return {
    id: z.uuid().parse(row.id),
    userId: VeraUserIdSchema.parse(row.userId),
    challengeDigest: Sha256Schema.parse(row.challengeDigest),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null
  };
}

function mapReceipt(row: ReceiptRow): PrivacyDeletionReceipt {
  return PrivacyDeletionReceiptSchema.parse({
    ...row,
    completedAt: row.completedAt.toISOString(),
    backupEraseAfter: row.backupEraseAfter.toISOString(),
    legalHoldUntil: row.legalHoldUntil?.toISOString() ?? null
  });
}

function jsonObject(value: unknown): JsonObject {
  return JsonObjectSchema.parse(JSON.parse(JSON.stringify(value)) as unknown);
}

async function transaction<Result>(
  connection: Pick<PostgresConnection, "pool">,
  begin: string,
  operation: (client: PoolClient) => Promise<Result>
): Promise<Result> {
  const client = await connection.pool.connect();
  try {
    await client.query(begin);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof PrivacyLifecycleRepositoryError) throw error;
    throw mapPostgresError(error);
  } finally {
    client.release();
  }
}

async function loadExportRows(
  client: PoolClient,
  table: string,
  userId: VeraUserId
): Promise<readonly JsonObject[]> {
  if (table === "users") {
    const result = await client.query<{ data: unknown }>(
      `select jsonb_build_object(
        'id', id, 'name', name, 'email', email, 'email_verified', email_verified,
        'image', image, 'created_at', created_at, 'updated_at', updated_at
      ) as data from users where id = $1`,
      [userId]
    );
    return result.rows.map((row) => jsonObject(row.data));
  }

  const ownerTable = table as PrivacyOwnerTableName;
  const mode = PRIVACY_OWNER_TABLE_POLICY[ownerTable];
  if (mode === undefined || mode === "delete_only") {
    throw new Error(`Privacy export table ${table} is not allowlisted.`);
  }
  const expression = mode === "project" ? safeProjection(ownerTable) : "to_jsonb(owner_row)";
  const alias = mode === "project" ? "" : " owner_row";
  const result = await client.query<{ data: unknown }>(
    `select ${expression} as data from "${ownerTable}"${alias} where user_id = $1`,
    [userId]
  );
  return result.rows.map((row) => jsonObject(row.data));
}

async function countOwnerRowsWithClient(
  client: PoolClient,
  userId: VeraUserId
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {};
  for (const table of privacyOwnerTableNames) {
    const result = await client.query<{ count: number }>(
      `select count(*)::int as count from "${table}" where user_id = $1`,
      [userId]
    );
    counts[table] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

async function deleteNonOwnerIdentityRows(
  client: PoolClient,
  userId: VeraUserId,
  normalizedEmail: string
): Promise<void> {
  await client.query("delete from beta_access_requests where normalized_email = $1", [
    normalizedEmail
  ]);
  await client.query("delete from beta_memberships where user_id = $1 or normalized_email = $2", [
    userId,
    normalizedEmail
  ]);
  await client.query("delete from verifications where lower(btrim(identifier)) = $1", [
    normalizedEmail
  ]);
}

async function deleteOwnerGraph(client: PoolClient, userId: VeraUserId): Promise<void> {
  const deleted = await client.query<{ id: string }>(
    "delete from users where id = $1 returning id",
    [userId]
  );
  if (!deleted.rows[0]) {
    throw new PrivacyLifecycleRepositoryError("Privacy deletion owner was not found.");
  }
  const remaining = await countOwnerRowsWithClient(client, userId);
  const retained = Object.entries(remaining).filter(([, count]) => count !== 0);
  if (retained.length > 0) {
    throw new PrivacyLifecycleRepositoryError(
      `Privacy deletion retained owner rows in ${retained[0]?.[0] ?? "unknown"}.`
    );
  }
}

async function insertOrValidateReceipt(
  client: PoolClient,
  receipt: PrivacyDeletionReceipt
): Promise<PrivacyDeletionReceipt> {
  const result = await client.query<ReceiptRow>(
    `insert into privacy_deletion_receipts (
      id, former_user_id, subject_digest, provider_revocation, browser_revocation,
      completed_at, backup_erase_after, legal_hold_until
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (former_user_id) do nothing
    returning id, former_user_id as "formerUserId", subject_digest as "subjectDigest",
      provider_revocation as "providerRevocation", browser_revocation as "browserRevocation",
      completed_at as "completedAt", backup_erase_after as "backupEraseAfter",
      legal_hold_until as "legalHoldUntil"`,
    [
      receipt.id,
      receipt.formerUserId,
      receipt.subjectDigest,
      receipt.providerRevocation,
      receipt.browserRevocation,
      receipt.completedAt,
      receipt.backupEraseAfter,
      receipt.legalHoldUntil
    ]
  );
  if (result.rows[0]) return mapReceipt(result.rows[0]);
  const existing = await client.query<ReceiptRow>(
    `select id, former_user_id as "formerUserId", subject_digest as "subjectDigest",
      provider_revocation as "providerRevocation", browser_revocation as "browserRevocation",
      completed_at as "completedAt", backup_erase_after as "backupEraseAfter",
      legal_hold_until as "legalHoldUntil"
    from privacy_deletion_receipts where former_user_id = $1 for update`,
    [receipt.formerUserId]
  );
  const stored = existing.rows[0] ? mapReceipt(existing.rows[0]) : null;
  if (!stored || JSON.stringify(stored) !== JSON.stringify(receipt)) {
    throw new PrivacyLifecycleRepositoryError(
      "Privacy deletion receipt conflicts with the stored receipt."
    );
  }
  return stored;
}

export function createPostgresPrivacyLifecycleRepository(
  connection: Pick<PostgresConnection, "pool">
): PrivacyLifecycleRepository {
  return {
    async exportOwner(inputRaw) {
      const input = ExportInputSchema.parse(inputRaw);
      return transaction(
        connection,
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        async (client) => {
          const records: PrivacyExportRecord[] = [];
          const recordCounts: Record<string, number> = {};
          const recordHashes: Record<string, string> = {};
          const tables = ["users", ...privacyExportTableNames].sort();
          for (const table of tables) {
            const rows = [...(await loadExportRows(client, table, input.userId))].sort(
              (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))
            );
            rows.forEach((data) => assertPrivacyExportDataSafe(data));
            recordCounts[table] = rows.length;
            recordHashes[table] = createHash("sha256")
              .update(rows.map((row) => JSON.stringify(row)).join("\n"))
              .digest("hex");
            records.push(
              ...rows.map((data) =>
                PrivacyExportRecordSchema.parse({ type: "record", table, data })
              )
            );
          }
          const manifest = PrivacyExportManifestSchema.parse({
            type: "manifest",
            schemaVersion: PRIVACY_EXPORT_SCHEMA_VERSION,
            userId: input.userId,
            generatedAt: input.generatedAt,
            recordCounts,
            recordHashes,
            warning: PRIVACY_EXPORT_WARNING
          });
          return { manifest, records };
        }
      );
    },

    async getDeletionIdentity(userIdRaw) {
      const userId = VeraUserIdSchema.parse(userIdRaw);
      const result = await connection.pool.query<{
        normalizedEmail: string;
        providerSubject: string;
      }>(
        `select lower(btrim(users.email)) as "normalizedEmail",
          coalesce(
            (select provider_subject_id from integration_connections
              where user_id = users.id and provider = 'google' limit 1),
            (select account_id from accounts
              where user_id = users.id and provider_id = 'google' limit 1),
            'vera-user:' || users.id::text
          ) as "providerSubject"
        from users where id = $1`,
        [userId]
      );
      const identity = result.rows[0];
      if (!identity) throw new Error("Privacy deletion owner was not found.");
      return identity;
    },

    async issueDeletionChallenge(inputRaw) {
      const input = IssueChallengeInputSchema.parse(inputRaw);
      const lifetime = Date.parse(input.expiresAt) - Date.parse(input.createdAt);
      if (lifetime <= 0 || lifetime > PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS) {
        throw new Error("Privacy deletion challenge lifetime is invalid.");
      }
      return transaction(connection, "BEGIN", async (client) => {
        await client.query("delete from privacy_deletion_challenges where user_id = $1", [
          input.userId
        ]);
        const result = await client.query<ChallengeRow>(
          `insert into privacy_deletion_challenges (
            id, user_id, challenge_digest, created_at, expires_at, consumed_at
          ) values ($1, $2, $3, $4, $5, null)
          returning id, user_id as "userId", challenge_digest as "challengeDigest",
            created_at as "createdAt", expires_at as "expiresAt", consumed_at as "consumedAt"`,
          [input.id, input.userId, input.challengeDigest, input.createdAt, input.expiresAt]
        );
        const row = result.rows[0];
        if (!row) throw new Error("Privacy deletion challenge insert returned no row.");
        return mapChallenge(row);
      });
    },

    async consumeDeletionChallenge(inputRaw) {
      const input = ConsumeChallengeInputSchema.parse(inputRaw);
      const result = await connection.pool.query<{ id: string }>(
        `update privacy_deletion_challenges
        set consumed_at = $3
        where user_id = $1 and challenge_digest = $2 and consumed_at is null
          and created_at <= $3 and expires_at >= $3
        returning id`,
        [input.userId, input.challengeDigest, input.consumedAt]
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Privacy deletion challenge is invalid, expired, or already used.");
      return z.uuid().parse(id);
    },

    async deleteOwnerAccount(inputRaw) {
      const input = DeleteOwnerInputSchema.parse(inputRaw);
      const receipt = PrivacyDeletionReceiptSchema.parse({
        id: randomUUID(),
        formerUserId: input.userId,
        subjectDigest: input.subjectDigest,
        providerRevocation: input.providerRevocation,
        browserRevocation: input.browserRevocation,
        completedAt: input.completedAt,
        backupEraseAfter: input.backupEraseAfter,
        legalHoldUntil: input.legalHoldUntil
      });
      return transaction(connection, "BEGIN", async (client) => {
        const challenge = await client.query<{ id: string }>(
          `select id from privacy_deletion_challenges
          where id = $1 and user_id = $2 and consumed_at is not null for update`,
          [input.consumedChallengeId, input.userId]
        );
        if (!challenge.rows[0]) {
          throw new PrivacyLifecycleRepositoryError(
            "Consumed privacy deletion challenge was not found."
          );
        }
        const owner = await client.query<{ normalizedEmail: string }>(
          `select lower(btrim(email)) as "normalizedEmail" from users where id = $1 for update`,
          [input.userId]
        );
        const normalizedEmail = owner.rows[0]?.normalizedEmail;
        if (!normalizedEmail) {
          throw new PrivacyLifecycleRepositoryError("Privacy deletion owner was not found.");
        }
        const storedReceipt = await insertOrValidateReceipt(client, receipt);
        await deleteNonOwnerIdentityRows(client, input.userId, normalizedEmail);
        await deleteOwnerGraph(client, input.userId);
        return storedReceipt;
      });
    },

    async reapplyDeletionReceipt(receiptRaw) {
      const receipt = PrivacyDeletionReceiptSchema.parse(receiptRaw);
      return transaction(connection, "BEGIN", async (client) => {
        const owner = await client.query<{ normalizedEmail: string }>(
          `select lower(btrim(email)) as "normalizedEmail" from users where id = $1 for update`,
          [receipt.formerUserId]
        );
        const normalizedEmail = owner.rows[0]?.normalizedEmail;
        await insertOrValidateReceipt(client, receipt);
        if (normalizedEmail) {
          await deleteNonOwnerIdentityRows(client, receipt.formerUserId, normalizedEmail);
          await deleteOwnerGraph(client, receipt.formerUserId);
        }
        return normalizedEmail ? "reapplied" : "absent";
      });
    },

    async countOwnerRows(userIdRaw) {
      const userId = VeraUserIdSchema.parse(userIdRaw);
      const client = await connection.pool.connect();
      try {
        return await countOwnerRowsWithClient(client, userId);
      } finally {
        client.release();
      }
    }
  };
}
