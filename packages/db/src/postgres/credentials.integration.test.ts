import type { IntegrationId, VeraUserId } from "@vera/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { encryptCredential, StaticCredentialKeyProvider } from "../credentials.ts";
import { createPostgresIntegrationConnectionRepository } from "./integration-repository.ts";
import { integrationConnections, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const integrationId = "018f9f64-7b5a-7c91-a12e-123456789abe" as IntegrationId;

describe("PostgreSQL integration credential persistence", () => {
  it("stores only an authenticated encrypted envelope and isolates it by user", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await db.insert(users).values({
        id: userId,
        name: "Credential Test",
        email: "credential@example.test",
        emailVerified: true
      });
      const keyProvider = new StaticCredentialKeyProvider(
        "test-key",
        new Map([["test-key", new Uint8Array(32).fill(7)]])
      );
      const syntheticToken = "synthetic-refresh-token-never-plaintext";
      const encryptedRefreshToken = await encryptCredential(
        syntheticToken,
        { userId, integrationId, provider: "google" },
        keyProvider,
        { randomBytes: () => Buffer.alloc(12, 9) }
      );
      const repository = createPostgresIntegrationConnectionRepository(db, userId);
      const connection = {
        id: integrationId,
        userId,
        provider: "google" as const,
        providerSubjectId: "synthetic-google-subject",
        displayEmail: "credential@example.test",
        encryptedRefreshToken,
        grantedScopes: ["profile", "email", "openid"],
        tokenExpiresAt: null,
        status: "connected" as const,
        lastSuccessfulUseAt: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: "2026-07-20T12:00:00.000Z"
      };

      await expect(repository.upsert(connection)).resolves.toEqual({
        ...connection,
        grantedScopes: ["email", "openid", "profile"]
      });
      const rawRows = await db
        .select()
        .from(integrationConnections)
        .where(eq(integrationConnections.id, integrationId));
      expect(JSON.stringify(rawRows)).not.toContain(syntheticToken);
      expect(rawRows[0]?.credentialCiphertext?.toString("utf8")).not.toContain(syntheticToken);
      await expect(repository.getById(integrationId)).resolves.toMatchObject({
        encryptedRefreshToken
      });
    });
  });
});
