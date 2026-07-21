import {
  IntegrationConnectionSchema,
  IntegrationIdSchema,
  IntegrationProviderSchema,
  type IntegrationConnection,
  type VeraUserId
} from "@vera/domain";
import { and, asc, eq } from "drizzle-orm";

import type { AsyncRepository, IntegrationConnectionRepository } from "../repositories.ts";
import { mapPostgresError } from "./errors.ts";
import { integrationConnections } from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

function instant(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toEnvelope(row: typeof integrationConnections.$inferSelect) {
  const values = [
    row.credentialVersion,
    row.credentialAlgorithm,
    row.credentialKeyId,
    row.credentialNonce,
    row.credentialCiphertext,
    row.credentialAuthenticationTag
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Persisted integration credential envelope is incomplete.");
  }
  return {
    version: row.credentialVersion,
    algorithm: row.credentialAlgorithm,
    keyId: row.credentialKeyId,
    nonce: row.credentialNonce?.toString("base64"),
    ciphertext: row.credentialCiphertext?.toString("base64"),
    authenticationTag: row.credentialAuthenticationTag?.toString("base64")
  };
}

function mapRow(row: typeof integrationConnections.$inferSelect): IntegrationConnection {
  return IntegrationConnectionSchema.parse({
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerSubjectId: row.providerSubjectId,
    displayEmail: row.displayEmail,
    encryptedRefreshToken: toEnvelope(row),
    grantedScopes: row.grantedScopes,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    status: row.status,
    lastSuccessfulUseAt: row.lastSuccessfulUseAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function credentialColumns(connection: IntegrationConnection) {
  const credential = connection.encryptedRefreshToken;
  return {
    credentialVersion: credential?.version ?? null,
    credentialAlgorithm: credential?.algorithm ?? null,
    credentialKeyId: credential?.keyId ?? null,
    credentialNonce: credential ? Buffer.from(credential.nonce, "base64") : null,
    credentialCiphertext: credential ? Buffer.from(credential.ciphertext, "base64") : null,
    credentialAuthenticationTag: credential
      ? Buffer.from(credential.authenticationTag, "base64")
      : null
  };
}

export function createPostgresIntegrationConnectionRepository(
  db: PostgresExecutor,
  userId: VeraUserId
): AsyncRepository<IntegrationConnectionRepository> {
  return {
    async upsert(input) {
      const connection = IntegrationConnectionSchema.parse(input);
      if (connection.userId !== userId) {
        throw new Error("Integration ownership must match the scoped repository user.");
      }
      try {
        const rows = await db
          .insert(integrationConnections)
          .values({
            id: connection.id,
            userId,
            provider: connection.provider,
            providerSubjectId: connection.providerSubjectId,
            displayEmail: connection.displayEmail,
            ...credentialColumns(connection),
            grantedScopes: connection.grantedScopes,
            tokenExpiresAt: instant(connection.tokenExpiresAt),
            status: connection.status,
            lastSuccessfulUseAt: instant(connection.lastSuccessfulUseAt),
            createdAt: new Date(connection.createdAt),
            updatedAt: new Date(connection.updatedAt)
          })
          .onConflictDoUpdate({
            target: [integrationConnections.userId, integrationConnections.id],
            set: {
              providerSubjectId: connection.providerSubjectId,
              displayEmail: connection.displayEmail,
              ...credentialColumns(connection),
              grantedScopes: connection.grantedScopes,
              tokenExpiresAt: instant(connection.tokenExpiresAt),
              status: connection.status,
              lastSuccessfulUseAt: instant(connection.lastSuccessfulUseAt),
              updatedAt: new Date(connection.updatedAt)
            }
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error("Integration upsert returned no row.");
        return mapRow(row);
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async getById(input) {
      const id = IntegrationIdSchema.parse(input);
      const rows = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async getByProviderSubjectId(providerInput, subjectInput) {
      const provider = IntegrationProviderSchema.parse(providerInput);
      const providerSubjectId = subjectInput.trim();
      if (providerSubjectId.length === 0 || providerSubjectId.length > 255) {
        throw new Error("Integration provider subject ID is invalid.");
      }
      const rows = await db
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.userId, userId),
            eq(integrationConnections.provider, provider),
            eq(integrationConnections.providerSubjectId, providerSubjectId)
          )
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(integrationConnections)
        .where(eq(integrationConnections.userId, userId))
        .orderBy(asc(integrationConnections.createdAt), asc(integrationConnections.id));
      return rows.map(mapRow);
    },
    async delete(input) {
      const id = IntegrationIdSchema.parse(input);
      const rows = await db
        .delete(integrationConnections)
        .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
        .returning({ id: integrationConnections.id });
      return rows.length === 1;
    }
  };
}
