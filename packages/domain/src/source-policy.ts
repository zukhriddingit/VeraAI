import { z } from "zod";

import { IsoDateSchema, IsoDateTimeSchema, ListingSourceLabelSchema } from "./primitives.ts";

/** Closed by design: adding a capability requires a source-policy review. */
export const SourceCapabilitySchema = z.enum([
  "fixture.read",
  "manual.capture",
  "gmail.alert.read",
  "structured_feed.read",
  "browser.capture",
  "gmail.draft.create",
  "calendar.hold.create",
  "notification.local"
]);

export const SourceExecutionSchema = z.enum(["manual", "scheduled"]);
export const SourceHttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export const SourceDataClassificationSchema = z.enum(["synthetic", "user_supplied", "third_party"]);
export const SourceRedactionRuleSchema = z.enum([
  "raw_content_from_logs",
  "full_urls_from_logs",
  "contact_details_from_logs",
  "credentials_from_logs"
]);
export const ManualBlockerBehaviorSchema = z.literal("stop_and_request_user_action");

export const SourceDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u,
    "Policy domains must be exact public DNS hostnames."
  );

export const SourceOriginSchema = z
  .string()
  .url()
  .max(2_048)
  .regex(
    /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?\/?$/u,
    "Policy origins must be bare HTTP(S) origins without credentials or paths."
  );

const UniqueCapabilitiesSchema = z.array(SourceCapabilitySchema).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "Capabilities must be unique." });
  }
});

const UniqueOperationsSchema = z
  .array(z.string().trim().min(1).max(160))
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "Operations must be unique." });
    }
  });

export const SourcePolicyManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    connectorId: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(160),
    version: z.number().int().positive(),
    source: ListingSourceLabelSchema,
    enabled: z.boolean(),
    execution: SourceExecutionSchema,
    capabilities: UniqueCapabilitiesSchema,
    allowedOperations: UniqueOperationsSchema,
    allowedDomains: z.array(SourceDomainSchema),
    allowedOrigins: z.array(SourceOriginSchema),
    allowedHttpMethods: z.array(SourceHttpMethodSchema),
    requiresUserSession: z.boolean(),
    requiresApproval: z.boolean(),
    minimumIntervalSeconds: z.number().int().positive().nullable(),
    maxConcurrency: z.number().int().positive().max(100),
    globalKillSwitchKey: z.string().trim().min(1).max(160),
    connectorKillSwitchKey: z.string().trim().min(1).max(160),
    dataClassification: SourceDataClassificationSchema,
    redactionRules: z.array(SourceRedactionRuleSchema).min(1),
    manualBlockerBehavior: ManualBlockerBehaviorSchema,
    owner: z.string().trim().min(1).max(160),
    reviewedAt: IsoDateSchema,
    decisionRecord: z.string().trim().min(1).max(500),
    notes: z.string().trim().min(1).max(2_000),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    const exactSets: ReadonlyArray<readonly string[]> = [
      manifest.capabilities,
      manifest.allowedOperations,
      manifest.allowedDomains,
      manifest.allowedOrigins,
      manifest.allowedHttpMethods,
      manifest.redactionRules
    ];
    if (exactSets.some((values) => new Set(values).size !== values.length)) {
      context.addIssue({
        code: "custom",
        message: "Manifest policy arrays cannot contain duplicates."
      });
    }

    if (manifest.updatedAt < manifest.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Manifest update time cannot precede creation time."
      });
    }

    if (manifest.execution === "scheduled" && manifest.minimumIntervalSeconds === null) {
      context.addIssue({
        code: "custom",
        path: ["minimumIntervalSeconds"],
        message: "Scheduled manifests require a minimum interval."
      });
    }
  });

export type SourceCapability = z.infer<typeof SourceCapabilitySchema>;
export type SourceExecution = z.infer<typeof SourceExecutionSchema>;
export type SourceHttpMethod = z.infer<typeof SourceHttpMethodSchema>;
export type SourceDataClassification = z.infer<typeof SourceDataClassificationSchema>;
export type SourceRedactionRule = z.infer<typeof SourceRedactionRuleSchema>;
export type ManualBlockerBehavior = z.infer<typeof ManualBlockerBehaviorSchema>;
export type SourcePolicyManifest = z.infer<typeof SourcePolicyManifestSchema>;
