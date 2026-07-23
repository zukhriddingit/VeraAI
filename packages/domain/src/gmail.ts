import { z } from "zod";

import { SafeReturnToSchema } from "./calendar.ts";
import { VeraUserIdSchema } from "./identity.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly" as const;

export const GmailAlertExternalReferenceSchema = z
  .object({
    messageId: z.string().trim().min(1).max(256),
    historyId: z.string().regex(/^\d+$/u).max(64).nullable()
  })
  .strict();

export const GmailOAuthStateSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    stateHash: Sha256Schema,
    codeVerifierHash: Sha256Schema,
    redirectPath: z.literal("/settings/integrations"),
    requestedScopes: z.array(z.literal(GMAIL_READONLY_SCOPE)).length(1),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    consumedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((state, context) => {
    if (Date.parse(state.expiresAt) <= Date.parse(state.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Gmail OAuth state must expire after it is created."
      });
    }
  });

export const GmailAlertCursorSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    sourceConfigurationId: EntityIdSchema,
    historyId: z.string().regex(/^\d+$/u).max(64).nullable(),
    lastSuccessfulAt: IsoDateTimeSchema.nullable(),
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const GmailAlertExternalReferenceRecordSchema = GmailAlertExternalReferenceSchema.extend({
  id: EntityIdSchema,
  userId: VeraUserIdSchema,
  rawListingId: EntityIdSchema,
  contentHash: Sha256Schema,
  importedAt: IsoDateTimeSchema
}).strict();

export const GmailAlertQuerySchema = z
  .object({
    label: z.literal("Vera").nullable(),
    allowedSenders: z.array(z.email().max(320)).max(20),
    subjectTerms: z.array(z.string().trim().min(1).max(120)).max(20),
    afterHistoryId: z.string().regex(/^\d+$/u).max(64).nullable(),
    maxResults: z.number().int().positive().max(100)
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.label === null &&
      query.allowedSenders.length === 0 &&
      query.subjectTerms.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Gmail alert searches require a Vera label or configured sender/subject filter."
      });
    }
  });

export const GmailAuthorizationRequestSchema = z.object({ returnTo: SafeReturnToSchema }).strict();

export const GmailAuthorizationResponseSchema = z
  .object({ authorizationUrl: z.string().url().startsWith("https://accounts.google.com/") })
  .strict();

export const GmailGrantStateSchema = z.enum([
  "granted",
  "missing",
  "expired",
  "revoked",
  "disconnected",
  "unconfigured"
]);

export const GmailIntegrationStatusSchema = z
  .object({
    state: GmailGrantStateSchema,
    accountEmail: z.email().max(320).nullable(),
    lastSuccessfulUseAt: IsoDateTimeSchema.nullable(),
    scheduledIngestionEnabled: z.boolean()
  })
  .strict();

export type GmailAlertExternalReference = z.infer<typeof GmailAlertExternalReferenceSchema>;
export type GmailOAuthState = z.infer<typeof GmailOAuthStateSchema>;
export type GmailAlertCursor = z.infer<typeof GmailAlertCursorSchema>;
export type GmailAlertExternalReferenceRecord = z.infer<
  typeof GmailAlertExternalReferenceRecordSchema
>;
export type GmailAlertQuery = z.infer<typeof GmailAlertQuerySchema>;
export type GmailAuthorizationRequest = z.infer<typeof GmailAuthorizationRequestSchema>;
export type GmailAuthorizationResponse = z.infer<typeof GmailAuthorizationResponseSchema>;
export type GmailGrantState = z.infer<typeof GmailGrantStateSchema>;
export type GmailIntegrationStatus = z.infer<typeof GmailIntegrationStatusSchema>;
