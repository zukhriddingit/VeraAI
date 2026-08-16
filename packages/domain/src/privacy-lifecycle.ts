import { z } from "zod";

import { VeraUserIdSchema } from "./identity.ts";
import { IsoDateTimeSchema, JsonObjectSchema, Sha256Schema } from "./primitives.ts";

export const PRIVACY_EXPORT_SCHEMA_VERSION = "vera-privacy-export.v1" as const;
export const PRIVACY_DELETION_CONFIRMATION = "DELETE MY VERA ACCOUNT" as const;
export const PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS = 15 * 60 * 1_000;
export const PRIVACY_EXPORT_MAX_LINE_BYTES = 1_048_576;
export const PRIVACY_EXPORT_MAX_TOTAL_BYTES = 52_428_800;
export const PRIVACY_EXPORT_WARNING =
  "This export excludes passwords, sessions, OAuth tokens, browser credentials, and internal security material." as const;

const PrivacyExportTableSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u);

export const PrivacyDeletionChallengeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const PrivacyDeletionChallengeRequestSchema = z
  .object({ confirmation: z.literal("request_account_deletion") })
  .strict();

export const PrivacyDeletionChallengeResponseSchema = z
  .object({
    challengeToken: PrivacyDeletionChallengeTokenSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict();

export const PrivacyDeletionRequestSchema = z
  .object({
    challengeToken: PrivacyDeletionChallengeTokenSchema,
    confirmation: z.literal(PRIVACY_DELETION_CONFIRMATION)
  })
  .strict();

export const PrivacyRevocationStatusSchema = z.enum(["confirmed", "unconfirmed", "not_configured"]);

export const PrivacyDeletionReceiptSchema = z
  .object({
    id: z.uuid(),
    formerUserId: VeraUserIdSchema,
    subjectDigest: Sha256Schema,
    providerRevocation: PrivacyRevocationStatusSchema,
    browserRevocation: PrivacyRevocationStatusSchema,
    completedAt: IsoDateTimeSchema,
    backupEraseAfter: IsoDateTimeSchema,
    legalHoldUntil: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((receipt, context) => {
    const completedAt = Date.parse(receipt.completedAt);
    if (Date.parse(receipt.backupEraseAfter) < completedAt) {
      context.addIssue({
        code: "custom",
        message: "Backup erasure cannot precede account deletion.",
        path: ["backupEraseAfter"]
      });
    }
    if (receipt.legalHoldUntil !== null && Date.parse(receipt.legalHoldUntil) < completedAt) {
      context.addIssue({
        code: "custom",
        message: "A legal hold cannot end before account deletion.",
        path: ["legalHoldUntil"]
      });
    }
  });

export const PrivacyDeletionResponseSchema = z
  .object({
    status: z.literal("deleted"),
    receiptId: z.uuid()
  })
  .strict();

export const PrivacyExportRecordSchema = z
  .object({
    type: z.literal("record"),
    table: PrivacyExportTableSchema,
    data: JsonObjectSchema
  })
  .strict();

export const PrivacyExportManifestSchema = z
  .object({
    type: z.literal("manifest"),
    schemaVersion: z.literal(PRIVACY_EXPORT_SCHEMA_VERSION),
    userId: VeraUserIdSchema,
    generatedAt: IsoDateTimeSchema,
    recordCounts: z.record(PrivacyExportTableSchema, z.number().int().nonnegative()),
    recordHashes: z.record(PrivacyExportTableSchema, Sha256Schema),
    warning: z.literal(PRIVACY_EXPORT_WARNING)
  })
  .strict()
  .superRefine((manifest, context) => {
    const countTables = Object.keys(manifest.recordCounts).sort();
    const hashTables = Object.keys(manifest.recordHashes).sort();
    if (JSON.stringify(countTables) !== JSON.stringify(hashTables)) {
      context.addIssue({
        code: "custom",
        message: "Export counts and hashes must cover the same tables.",
        path: ["recordHashes"]
      });
    }
  });

export const PrivacyExportLineSchema = z.discriminatedUnion("type", [
  PrivacyExportManifestSchema,
  PrivacyExportRecordSchema
]);

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function serializePrivacyExportNdjson(lines: readonly unknown[]): Uint8Array {
  if (lines.length === 0) throw new Error("Privacy export requires a manifest.");
  const parsed = lines.map((line) => PrivacyExportLineSchema.parse(line));
  if (parsed[0]?.type !== "manifest" || parsed.slice(1).some((line) => line.type === "manifest")) {
    throw new Error("Privacy export must contain exactly one leading manifest.");
  }

  const encoded: Uint8Array[] = [];
  let totalBytes = 0;
  for (const line of parsed) {
    const json = encodeUtf8(JSON.stringify(line));
    if (json.byteLength > PRIVACY_EXPORT_MAX_LINE_BYTES) {
      throw new Error("Privacy export line exceeds the allowed size.");
    }
    const withNewline = new Uint8Array(json.byteLength + 1);
    withNewline.set(json);
    withNewline[json.byteLength] = 0x0a;
    totalBytes += withNewline.byteLength;
    if (totalBytes > PRIVACY_EXPORT_MAX_TOTAL_BYTES) {
      throw new Error("Privacy export exceeds the allowed total size.");
    }
    encoded.push(withNewline);
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const line of encoded) {
    output.set(line, offset);
    offset += line.byteLength;
  }
  return output;
}

export type PrivacyDeletionChallengeRequest = z.infer<typeof PrivacyDeletionChallengeRequestSchema>;
export type PrivacyDeletionChallengeResponse = z.infer<
  typeof PrivacyDeletionChallengeResponseSchema
>;
export type PrivacyDeletionRequest = z.infer<typeof PrivacyDeletionRequestSchema>;
export type PrivacyRevocationStatus = z.infer<typeof PrivacyRevocationStatusSchema>;
export type PrivacyDeletionReceipt = z.infer<typeof PrivacyDeletionReceiptSchema>;
export type PrivacyDeletionResponse = z.infer<typeof PrivacyDeletionResponseSchema>;
export type PrivacyExportRecord = z.infer<typeof PrivacyExportRecordSchema>;
export type PrivacyExportManifest = z.infer<typeof PrivacyExportManifestSchema>;
export type PrivacyExportLine = z.infer<typeof PrivacyExportLineSchema>;
