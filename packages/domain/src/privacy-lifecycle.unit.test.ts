import { describe, expect, it } from "vitest";

import {
  PRIVACY_DELETION_CONFIRMATION,
  PRIVACY_EXPORT_MAX_LINE_BYTES,
  PRIVACY_EXPORT_MAX_TOTAL_BYTES,
  PRIVACY_EXPORT_SCHEMA_VERSION,
  PRIVACY_EXPORT_WARNING,
  PrivacyDeletionChallengeRequestSchema,
  PrivacyDeletionChallengeResponseSchema,
  PrivacyDeletionReceiptSchema,
  PrivacyDeletionRequestSchema,
  PrivacyDeletionResponseSchema,
  PrivacyExportManifestSchema,
  PrivacyExportRecordSchema,
  PrivacyRevocationStatusSchema,
  serializePrivacyExportNdjson
} from "./privacy-lifecycle.ts";

const userId = "10000000-0000-4000-8000-000000000001";
const generatedAt = "2026-08-16T12:00:00.000Z";

describe("privacy lifecycle contracts", () => {
  it("requires a strict two-step deletion request", () => {
    expect(
      PrivacyDeletionChallengeRequestSchema.parse({ confirmation: "request_account_deletion" })
    ).toEqual({ confirmation: "request_account_deletion" });
    expect(() =>
      PrivacyDeletionChallengeRequestSchema.parse({
        confirmation: "request_account_deletion",
        userId
      })
    ).toThrow();
    expect(() =>
      PrivacyDeletionRequestSchema.parse({
        challengeToken: "a".repeat(43),
        confirmation: "DELETE ACCOUNT"
      })
    ).toThrow();
    expect(
      PrivacyDeletionRequestSchema.parse({
        challengeToken: "a".repeat(43),
        confirmation: PRIVACY_DELETION_CONFIRMATION
      })
    ).toBeDefined();
  });

  it("accepts only fixed-size base64url challenge responses and closed deletion responses", () => {
    expect(
      PrivacyDeletionChallengeResponseSchema.parse({
        challengeToken: "A_-" + "a".repeat(40),
        expiresAt: generatedAt
      })
    ).toMatchObject({ expiresAt: generatedAt });
    expect(() =>
      PrivacyDeletionChallengeResponseSchema.parse({
        challengeToken: "short",
        expiresAt: generatedAt
      })
    ).toThrow();
    expect(
      PrivacyDeletionResponseSchema.parse({
        status: "deleted",
        receiptId: "20000000-0000-4000-8000-000000000002"
      })
    ).toMatchObject({ status: "deleted" });
  });

  it("keeps deletion receipts closed and free of raw identity or credentials", () => {
    const receipt = PrivacyDeletionReceiptSchema.parse({
      id: "20000000-0000-4000-8000-000000000002",
      formerUserId: userId,
      subjectDigest: "a".repeat(64),
      providerRevocation: "confirmed",
      browserRevocation: "not_configured",
      completedAt: generatedAt,
      backupEraseAfter: "2026-09-15T12:00:00.000Z",
      legalHoldUntil: null
    });
    expect(PrivacyRevocationStatusSchema.options).toEqual([
      "confirmed",
      "unconfirmed",
      "not_configured"
    ]);
    expect(JSON.stringify(receipt)).not.toMatch(/email|token|secret|credential|nonce|url/iu);
    expect(() =>
      PrivacyDeletionReceiptSchema.parse({ ...receipt, email: "owner@example.test" })
    ).toThrow();
  });

  it("serializes a manifest-first bounded NDJSON export", () => {
    const manifest = PrivacyExportManifestSchema.parse({
      type: "manifest",
      schemaVersion: PRIVACY_EXPORT_SCHEMA_VERSION,
      userId,
      generatedAt,
      recordCounts: { users: 1 },
      recordHashes: { users: "b".repeat(64) },
      warning: PRIVACY_EXPORT_WARNING
    });
    const record = PrivacyExportRecordSchema.parse({
      type: "record",
      table: "users",
      data: { id: userId, name: "Vera renter" }
    });
    const serialized = Array.from(serializePrivacyExportNdjson([manifest, record]), (byte) =>
      String.fromCharCode(byte)
    ).join("");
    expect(serialized).toBe(`${JSON.stringify(manifest)}\n${JSON.stringify(record)}\n`);
    expect(PRIVACY_EXPORT_MAX_LINE_BYTES).toBe(1_048_576);
    expect(PRIVACY_EXPORT_MAX_TOTAL_BYTES).toBe(52_428_800);
    expect(() => serializePrivacyExportNdjson([record, manifest])).toThrow("manifest");
    expect(() =>
      serializePrivacyExportNdjson([
        manifest,
        { ...record, data: { oversized: "x".repeat(PRIVACY_EXPORT_MAX_LINE_BYTES) } }
      ])
    ).toThrow("line");
  });
});
