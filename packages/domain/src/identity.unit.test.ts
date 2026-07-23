import { describe, expect, it } from "vitest";

import {
  EncryptedCredentialEnvelopeSchema,
  IntegrationConnectionSchema,
  VeraUserIdSchema
} from "./identity.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
const envelope = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  keyId: "2026-07",
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: "c3ludGhldGlj",
  authenticationTag: "AAAAAAAAAAAAAAAAAAAAAA=="
};

describe("identity persistence contracts", () => {
  it("requires UUID user identities", () => {
    expect(VeraUserIdSchema.parse(userId)).toBe(userId);
    expect(() => VeraUserIdSchema.parse("demo-user")).toThrow();
  });

  it("rejects plaintext or extra credential fields", () => {
    expect(() =>
      EncryptedCredentialEnvelopeSchema.parse({
        ...envelope,
        plaintext: "forbidden"
      })
    ).toThrow();
  });

  it("sorts and deduplicates granted scopes", () => {
    const parsed = IntegrationConnectionSchema.parse({
      id: userId,
      userId,
      provider: "google",
      providerSubjectId: "google-subject",
      displayEmail: "user@example.test",
      encryptedRefreshToken: envelope,
      grantedScopes: ["openid", "email", "openid"],
      tokenExpiresAt: null,
      status: "connected",
      lastSuccessfulUseAt: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z"
    });

    expect(parsed.grantedScopes).toEqual(["email", "openid"]);
  });

  it("requires credential deletion when disconnected", () => {
    expect(() =>
      IntegrationConnectionSchema.parse({
        id: userId,
        userId,
        provider: "google",
        providerSubjectId: "google-subject",
        displayEmail: null,
        encryptedRefreshToken: envelope,
        grantedScopes: [],
        tokenExpiresAt: null,
        status: "disconnected",
        lastSuccessfulUseAt: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        updatedAt: "2026-07-20T12:00:00.000Z"
      })
    ).toThrow("cannot retain");
  });
});
