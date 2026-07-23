import { z } from "zod";

import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";
import { BrowserProfileIdSchema, SafeBrowserUrlSchema } from "./source-orchestration.ts";

export const BrowserIntegrationControlSchema = z
  .object({
    userBrowserEnabled: z.boolean(),
    zillowSourceEnabled: z.boolean(),
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserProfileControlSchema = z
  .object({
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    disabledAt: IsoDateTimeSchema.nullable(),
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserCaptureAcceptanceSchema = z
  .object({
    id: EntityIdSchema,
    sourceJobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    payloadHash: Sha256Schema,
    invocationIdempotencyKey: Sha256Schema,
    resultHash: Sha256Schema,
    contentHash: Sha256Schema,
    canonicalUrl: SafeBrowserUrlSchema,
    rawListingId: EntityIdSchema,
    acceptedAt: IsoDateTimeSchema
  })
  .strict();

export type BrowserIntegrationControl = z.infer<typeof BrowserIntegrationControlSchema>;
export type BrowserProfileControl = z.infer<typeof BrowserProfileControlSchema>;
export type BrowserCaptureAcceptance = z.infer<typeof BrowserCaptureAcceptanceSchema>;
