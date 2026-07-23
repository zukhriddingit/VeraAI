import { z } from "zod";

import {
  LISTING_EXTRACTION_PROMPT_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionModeSchema,
  ListingExtractionVersionSchema,
  ListingExtractionUsageSchema
} from "./extraction.ts";
import { DecisionJobSummarySchema } from "./decision.ts";
import { NormalizationJobStateSchema } from "./jobs.ts";
import {
  FieldExtractionMethodSchema,
  ProvenanceValueStatusSchema,
  UnknownFieldReasonSchema
} from "./listing.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";
import { SourceCapabilitySchema } from "./source-policy.ts";

export const CaptureAcceptedResponseSchema = z
  .object({
    correlationId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    contentHash: Sha256Schema,
    duplicate: z.boolean(),
    normalizationJobId: EntityIdSchema.nullable(),
    normalizationState: NormalizationJobStateSchema,
    decisionJob: DecisionJobSummarySchema.nullable().optional()
  })
  .strict();

export const CaptureStatusStateSchema = z.enum([
  "queued",
  "processing",
  "decision_queued",
  "decision_processing",
  "decision_failed",
  "completed",
  "failed",
  "duplicate_resolved"
]);

export const CaptureFieldUnknownReasonSchema = z.enum([
  ...UnknownFieldReasonSchema.options,
  "not_present",
  "ambiguous",
  "conflicting_evidence"
]);

export const CaptureFieldSummarySchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(200),
    status: ProvenanceValueStatusSchema,
    displayValue: z.string().trim().min(1).max(1_000).nullable(),
    unknownReason: CaptureFieldUnknownReasonSchema.nullable(),
    extractionMethod: FieldExtractionMethodSchema,
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    evidenceSnippet: z.string().trim().min(1).max(1_000).nullable(),
    explanation: z.string().trim().min(1).max(1_000)
  })
  .strict()
  .superRefine((field, context) => {
    if (field.status === "known") {
      if (field.displayValue === null) {
        context.addIssue({
          code: "custom",
          path: ["displayValue"],
          message: "Known fields require a display value."
        });
      }
      if (field.unknownReason !== null) {
        context.addIssue({
          code: "custom",
          path: ["unknownReason"],
          message: "Known fields cannot carry an unknown reason."
        });
      }
    } else {
      if (field.displayValue !== null) {
        context.addIssue({
          code: "custom",
          path: ["displayValue"],
          message: "Unknown fields cannot carry a display value."
        });
      }
      if (field.unknownReason === null) {
        context.addIssue({
          code: "custom",
          path: ["unknownReason"],
          message: "Unknown fields require a reason."
        });
      }
      if (field.confidenceBasisPoints !== 0) {
        context.addIssue({
          code: "custom",
          path: ["confidenceBasisPoints"],
          message: "Unknown fields must have zero confidence."
        });
      }
      if (field.evidenceSnippet !== null) {
        context.addIssue({
          code: "custom",
          path: ["evidenceSnippet"],
          message: "Unknown fields cannot carry an evidence snippet."
        });
      }
    }
  });

export const CaptureExtractionRunSummarySchema = z
  .object({
    mode: ListingExtractionModeSchema,
    providerId: z.string().trim().min(1).max(160).nullable(),
    model: z.string().trim().min(1).max(300).nullable(),
    promptVersion: z.literal(LISTING_EXTRACTION_PROMPT_VERSION),
    extractionVersion: ListingExtractionVersionSchema,
    requestedFields: z.array(ListingExtractionFieldNameSchema).max(20),
    requestedFieldCount: z.number().int().nonnegative().max(20),
    usage: ListingExtractionUsageSchema,
    latencyMilliseconds: z.number().int().nonnegative().safe(),
    repairCount: z.number().int().min(0).max(1),
    completedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((summary, context) => {
    if (new Set(summary.requestedFields).size !== summary.requestedFields.length) {
      context.addIssue({
        code: "custom",
        path: ["requestedFields"],
        message: "Requested extraction fields must be unique."
      });
    }
    if (summary.requestedFieldCount !== summary.requestedFields.length) {
      context.addIssue({
        code: "custom",
        path: ["requestedFieldCount"],
        message: "Requested field count must match the field list."
      });
    }

    if (summary.mode === "deterministic_only") {
      const hasProviderMetadata = summary.providerId !== null || summary.model !== null;
      const hasProviderMetrics =
        summary.usage.inputTokens !== 0 ||
        summary.usage.outputTokens !== 0 ||
        summary.usage.totalTokens !== 0 ||
        summary.latencyMilliseconds !== 0 ||
        summary.repairCount !== 0;
      if (hasProviderMetadata || hasProviderMetrics) {
        context.addIssue({
          code: "custom",
          path: ["mode"],
          message: "Deterministic-only summaries cannot contain provider metadata or usage."
        });
      }
    } else if (
      summary.providerId === null ||
      summary.model === null ||
      summary.requestedFields.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerId"],
        message: "LLM-augmented summaries require provider metadata and requested fields."
      });
    }
  });

export const CaptureStatusResponseSchema = z
  .object({
    correlationId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    duplicate: z.boolean(),
    state: CaptureStatusStateSchema,
    normalizationState: NormalizationJobStateSchema,
    decisionJob: DecisionJobSummarySchema.nullable().optional(),
    extractionRun: CaptureExtractionRunSummarySchema.nullable(),
    fields: z.array(CaptureFieldSummarySchema),
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const CaptureErrorCodeSchema = z.enum([
  "malformed_request",
  "unsupported_connector",
  "unsupported_source",
  "policy_denied",
  "capture_failed",
  "database_unavailable",
  "not_found"
]);

export const CaptureErrorResponseSchema = z
  .object({
    code: CaptureErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    correlationId: EntityIdSchema.nullable(),
    retryable: z.boolean()
  })
  .strict();

export const ConnectorStatusStateSchema = z.enum(["ready", "disabled", "denied"]);

export const ConnectorStatusSchema = z
  .object({
    connectorId: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(160),
    status: ConnectorStatusStateSchema,
    capabilities: z.array(SourceCapabilitySchema),
    networkAccess: z.boolean(),
    detail: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const ConnectorStatusCollectionResponseSchema = z
  .object({
    connectors: z.array(ConnectorStatusSchema),
    count: z.number().int().nonnegative(),
    generatedAt: IsoDateTimeSchema
  })
  .strict()
  .refine((response) => response.connectors.length === response.count, {
    message: "Connector response count does not match its collection.",
    path: ["count"]
  });

export type CaptureAcceptedResponse = z.infer<typeof CaptureAcceptedResponseSchema>;
export type CaptureStatusState = z.infer<typeof CaptureStatusStateSchema>;
export type CaptureFieldUnknownReason = z.infer<typeof CaptureFieldUnknownReasonSchema>;
export type CaptureFieldSummary = z.infer<typeof CaptureFieldSummarySchema>;
export type CaptureExtractionRunSummary = z.infer<typeof CaptureExtractionRunSummarySchema>;
export type CaptureStatusResponse = z.infer<typeof CaptureStatusResponseSchema>;
export type CaptureErrorCode = z.infer<typeof CaptureErrorCodeSchema>;
export type CaptureErrorResponse = z.infer<typeof CaptureErrorResponseSchema>;
export type ConnectorStatusState = z.infer<typeof ConnectorStatusStateSchema>;
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;
export type ConnectorStatusCollectionResponse = z.infer<
  typeof ConnectorStatusCollectionResponseSchema
>;
