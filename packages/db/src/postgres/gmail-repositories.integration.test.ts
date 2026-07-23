import type { VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { SOURCE_FIXTURES } from "../fixtures.ts";
import { sha256Text } from "../hashing.ts";
import { createPostgresRepositoryProvider } from "./repositories.ts";
import { users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const aliceId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const bobId = "018f9f64-7b5a-7c91-a12e-123456789abd" as VeraUserId;
const NOW = "2026-07-22T12:00:00.000Z";
const LATER = "2026-07-22T12:05:00.000Z";

describe("PostgreSQL Gmail alert repositories", () => {
  it("consumes hashed OAuth state once and isolates it by user", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values([
        { id: aliceId, name: "Alice", email: "alice-gmail@example.test", emailVerified: true },
        { id: bobId, name: "Bob", email: "bob-gmail@example.test", emailVerified: true }
      ]);
      const provider = createPostgresRepositoryProvider(connection);
      const state = {
        id: "gmail-oauth-state-1",
        userId: aliceId,
        stateHash: sha256Text("gmail-state"),
        codeVerifierHash: sha256Text("gmail-verifier"),
        redirectPath: "/settings/integrations" as const,
        requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly" as const],
        createdAt: NOW,
        expiresAt: "2026-07-22T12:10:00.000Z",
        consumedAt: null
      };
      await provider.forUser(aliceId).gmailOAuthStates.insert(state);
      await expect(
        provider.forUser(bobId).gmailOAuthStates.consume(state.stateHash, LATER)
      ).rejects.toThrow();
      await expect(
        provider.forUser(aliceId).gmailOAuthStates.consume(state.stateHash, LATER)
      ).resolves.toMatchObject({ consumedAt: LATER });
      await expect(
        provider.forUser(aliceId).gmailOAuthStates.consume(state.stateHash, LATER)
      ).rejects.toThrow(/already consumed/u);
    });
  });

  it("commits a cursor and stores only an idempotent message reference", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values([
        { id: aliceId, name: "Alice", email: "alice-gmail-ref@example.test", emailVerified: true },
        { id: bobId, name: "Bob", email: "bob-gmail-ref@example.test", emailVerified: true }
      ]);
      const provider = createPostgresRepositoryProvider(connection);
      const alice = provider.forUser(aliceId);
      const raw = await alice.rawListings.import(SOURCE_FIXTURES[0].capture);
      const cursor = {
        id: "gmail-cursor-1",
        userId: aliceId,
        sourceConfigurationId: "gmail-alerts",
        historyId: "123456",
        lastSuccessfulAt: NOW,
        updatedAt: NOW
      };
      await expect(alice.gmailAlertCursors.upsert(cursor)).resolves.toEqual(cursor);
      await expect(
        provider.forUser(bobId).gmailAlertCursors.getBySourceConfigurationId("gmail-alerts")
      ).resolves.toBeNull();
      const reference = {
        id: "gmail-reference-1",
        userId: aliceId,
        messageId: "message-123",
        historyId: "123456",
        rawListingId: raw.record.id,
        contentHash: sha256Text("sanitized parsed alert"),
        importedAt: NOW
      };
      await expect(alice.gmailAlertExternalReferences.insert(reference)).resolves.toEqual(
        reference
      );
      await expect(
        alice.gmailAlertExternalReferences.insert({ ...reference, id: "gmail-reference-2" })
      ).rejects.toMatchObject({ category: "conflict" });
      expect(
        JSON.stringify(await alice.gmailAlertExternalReferences.getByMessageId("message-123"))
      ).not.toMatch(/rawMessage|body|subject|sender/iu);
    });
  });
});
