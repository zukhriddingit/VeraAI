import { randomBytes } from "node:crypto";

import type { IntegrationId, VeraUserId } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  CredentialConfigurationError,
  CredentialDecryptionError,
  decryptCredential,
  encryptCredential,
  StaticCredentialKeyProvider
} from "./credentials.ts";

const context = {
  userId: "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId,
  integrationId: "018f9f64-7b5a-7c91-a12e-123456789abd" as IntegrationId,
  provider: "google" as const
};

describe("credential envelopes", () => {
  it("round-trips without serializing plaintext", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const envelope = await encryptCredential("synthetic-refresh-token", context, keys);

    expect(JSON.stringify(envelope)).not.toContain("synthetic-refresh-token");
    await expect(decryptCredential(envelope, context, keys)).resolves.toBe(
      "synthetic-refresh-token"
    );
  });

  it("uses a fresh nonce for each encryption", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const first = await encryptCredential("same-token", context, keys);
    const second = await encryptCredential("same-token", context, keys);

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects ciphertext moved to another user", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const envelope = await encryptCredential("synthetic-refresh-token", context, keys);

    await expect(
      decryptCredential(
        {
          ...envelope
        },
        { ...context, userId: "018f9f64-7b5a-7c91-a12e-123456789abe" as VeraUserId },
        keys
      )
    ).rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it("rejects tampering without exposing cryptographic details", async () => {
    const keys = new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(32)]]));
    const envelope = await encryptCredential("synthetic-refresh-token", context, keys);

    await expect(
      decryptCredential({ ...envelope, ciphertext: "dGFtcGVyZWQ=" }, context, keys)
    ).rejects.toThrow("reconnect is required");
  });

  it("requires exactly 256-bit keys", () => {
    expect(
      () => new StaticCredentialKeyProvider("key-1", new Map([["key-1", randomBytes(31)]]))
    ).toThrow(CredentialConfigurationError);
  });
});
