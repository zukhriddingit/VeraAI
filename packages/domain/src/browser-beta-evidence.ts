import { z } from "zod";

import {
  BrowserResearchSafeActionTypeSchema,
  BrowserResearchSourceSchema
} from "./browser-research.ts";
import { VeraUserIdSchema } from "./identity.ts";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.ts";
import { ZillowSafeActionKindSchema } from "./zillow-browser-research.ts";

const CheckpointActionTypeSchema = z.union([
  BrowserResearchSafeActionTypeSchema,
  ZillowSafeActionKindSchema
]);

export const BrowserBetaSessionEvidenceSchema = z
  .object({
    assignmentId: z.uuid(),
    userId: VeraUserIdSchema,
    testerRole: z.enum(["founder", "nonfounder"]),
    userTriggered: z.literal(true),
    sourceJobId: EntityIdSchema,
    source: BrowserResearchSourceSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    importedCount: z.number().int().min(0).max(1_000),
    checkpointActionTypes: z.array(CheckpointActionTypeSchema).max(20),
    forbiddenActionCount: z.number().int().min(0).max(1_000),
    unshareFollowUpState: z.enum(["passed", "failed"]),
    unpairState: z.enum(["passed", "failed"]),
    crossUserOwnerCheck: z.enum(["passed", "failed"]),
    credentialIncidentCount: z.number().int().min(0).max(1_000),
    backgroundExecutionIncidentCount: z.number().int().min(0).max(1_000),
    incidentSeverity: z.number().int().min(0).max(3)
  })
  .strict()
  .superRefine((record, context) => {
    if (Date.parse(record.completedAt) < Date.parse(record.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Browser beta completion cannot precede its start."
      });
    }
    if (new Set(record.checkpointActionTypes).size !== record.checkpointActionTypes.length) {
      context.addIssue({
        code: "custom",
        path: ["checkpointActionTypes"],
        message: "Checkpoint action types must be unique."
      });
    }
  });

export const BrowserBetaEvidenceLedgerSchema = z
  .object({
    version: z.literal("1"),
    founderFourSourceRegression: z.boolean(),
    incidentFreeDays: z.number().int().min(0).max(3_650),
    sessions: z.array(BrowserBetaSessionEvidenceSchema).max(1_000)
  })
  .strict();

export type BrowserBetaSessionEvidence = z.infer<typeof BrowserBetaSessionEvidenceSchema>;
export type BrowserBetaEvidenceLedger = z.infer<typeof BrowserBetaEvidenceLedgerSchema>;
