import { describe, expect, it } from "vitest";

import {
  GmailAlertCursorSchema,
  GmailAlertExternalReferenceSchema,
  GmailAuthorizationRequestSchema,
  GmailOAuthStateSchema
} from "./gmail.ts";

const NOW = "2026-07-22T12:00:00.000Z";
const LATER = "2026-07-22T12:05:00.000Z";
const HASH = "b".repeat(64);

describe("Gmail alert contracts", () => {
  it("stores only an external message reference and optional history marker", () => {
    expect(
      GmailAlertExternalReferenceSchema.parse({
        messageId: "message-123",
        historyId: "987654"
      })
    ).toEqual({ messageId: "message-123", historyId: "987654" });
    expect(() =>
      GmailAlertExternalReferenceSchema.parse({
        messageId: "message-123",
        historyId: "987654",
        rawMessage: "private mailbox content"
      })
    ).toThrow();
  });

  it("requires a bounded cursor tied to a configured source", () => {
    expect(
      GmailAlertCursorSchema.parse({
        id: "gmail-cursor-1",
        userId: "00000000-0000-4000-8000-000000000001",
        sourceConfigurationId: "gmail-alerts",
        historyId: "987654",
        lastSuccessfulAt: NOW,
        updatedAt: NOW
      })
    ).toMatchObject({ historyId: "987654" });
  });

  it("stores only hashed single-use OAuth state material", () => {
    expect(
      GmailOAuthStateSchema.parse({
        id: "gmail-oauth-1",
        userId: "00000000-0000-4000-8000-000000000001",
        stateHash: HASH,
        codeVerifierHash: HASH,
        redirectPath: "/settings/integrations",
        requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        createdAt: NOW,
        expiresAt: LATER,
        consumedAt: null
      })
    ).toMatchObject({ consumedAt: null });
    expect(() =>
      GmailOAuthStateSchema.parse({
        id: "gmail-oauth-1",
        userId: "00000000-0000-4000-8000-000000000001",
        stateHash: "raw-state",
        codeVerifierHash: HASH,
        redirectPath: "/settings/integrations",
        requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        createdAt: NOW,
        expiresAt: LATER,
        consumedAt: null
      })
    ).toThrow();
  });

  it("keeps Gmail authorization return paths on the Vera origin", () => {
    expect(GmailAuthorizationRequestSchema.parse({ returnTo: "/settings/integrations" })).toEqual({
      returnTo: "/settings/integrations"
    });
    expect(() =>
      GmailAuthorizationRequestSchema.parse({ returnTo: "https://attacker.example/" })
    ).toThrow();
  });
});
