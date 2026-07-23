import { z } from "zod";

import { IsoDateTimeSchema } from "./primitives.ts";

export const VeraUserIdSchema = z.uuid();
export const IntegrationIdSchema = z.uuid();
export const IntegrationProviderSchema = z.literal("google");
export const IntegrationConnectionStatusSchema = z.enum([
  "connected",
  "partial",
  "expired",
  "revoked",
  "disconnected",
  "reconnect_required"
]);
export const CredentialAlgorithmSchema = z.literal("aes-256-gcm");

const Base64Schema = z
  .string()
  .min(4)
  .max(65_536)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

const GrantedScopeSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);

export const EncryptedCredentialEnvelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: CredentialAlgorithmSchema,
    keyId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._:-]+$/u),
    nonce: Base64Schema,
    ciphertext: Base64Schema,
    authenticationTag: Base64Schema
  })
  .strict();

export const IntegrationConnectionSchema = z
  .object({
    id: IntegrationIdSchema,
    userId: VeraUserIdSchema,
    provider: IntegrationProviderSchema,
    providerSubjectId: z.string().min(1).max(255),
    displayEmail: z.email().max(320).nullable(),
    encryptedRefreshToken: EncryptedCredentialEnvelopeSchema.nullable(),
    grantedScopes: z
      .array(GrantedScopeSchema)
      .max(32)
      .transform((values) => [...new Set(values)].sort()),
    tokenExpiresAt: IsoDateTimeSchema.nullable(),
    status: IntegrationConnectionStatusSchema,
    lastSuccessfulUseAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    const hasCredential = value.encryptedRefreshToken !== null;
    if (value.status === "connected" && !hasCredential) {
      context.addIssue({
        code: "custom",
        message: "A connected integration requires encrypted refresh-token material.",
        path: ["encryptedRefreshToken"]
      });
    }

    if (value.status === "disconnected" && hasCredential) {
      context.addIssue({
        code: "custom",
        message: "A disconnected integration cannot retain refresh-token material.",
        path: ["encryptedRefreshToken"]
      });
    }
  });

export type VeraUserId = z.infer<typeof VeraUserIdSchema>;
export type IntegrationId = z.infer<typeof IntegrationIdSchema>;
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatusSchema>;
export type EncryptedCredentialEnvelope = z.infer<typeof EncryptedCredentialEnvelopeSchema>;
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
