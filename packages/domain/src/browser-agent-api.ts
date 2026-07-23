import { z } from "zod";

import { IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";
import {
  BrowserNodeStatusSchema,
  BrowserProfileIdSchema,
  SafeBrowserUrlSchema,
  SourceJobSchema
} from "./source-orchestration.ts";

export const BrowserIntegrationSupportStatusSchema = z.literal("unsupported_experimental");

export const BrowserControlStateSchema = z
  .object({
    systemBrowserDisabled: z.boolean(),
    userBrowserEnabled: z.boolean(),
    zillowSourceEnabled: z.boolean(),
    nodeDisabled: z.boolean(),
    profileDisabled: z.boolean(),
    updatedAt: IsoDateTimeSchema.nullable()
  })
  .strict();

export const BrowserAgentReadinessSchema = z.enum([
  "not_configured",
  "pairing_required",
  "capability_approval_required",
  "online_ready",
  "offline",
  "manual_login_required",
  "manual_blocker",
  "version_incompatible",
  "disabled_by_policy"
]);

export const BrowserAgentStatusResponseSchema = z
  .object({
    supportStatus: BrowserIntegrationSupportStatusSchema,
    readiness: BrowserAgentReadinessSchema,
    sourcePolicyState: z.literal("experimental_personal"),
    node: BrowserNodeStatusSchema.nullable(),
    controls: BrowserControlStateSchema,
    currentJob: SourceJobSchema.nullable(),
    lastSuccessfulCanonicalListingId: z.string().trim().min(1).max(160).nullable(),
    privacyNotice: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const BrowserControlMutationSchema = z
  .object({
    userBrowserEnabled: z.boolean().optional(),
    zillowSourceEnabled: z.boolean().optional(),
    nodeId: z.string().trim().min(1).max(160).optional(),
    nodeEnabled: z.boolean().optional(),
    profileId: BrowserProfileIdSchema.optional(),
    profileEnabled: z.boolean().optional()
  })
  .strict()
  .superRefine((input, context) => {
    const profilePair = input.profileId !== undefined || input.profileEnabled !== undefined;
    if (profilePair && (input.profileId === undefined || input.profileEnabled === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["profileId"],
        message: "Profile controls require both profile identifier and enabled state."
      });
    }
    if (Object.keys(input).length === 0) {
      context.addIssue({ code: "custom", message: "At least one browser control must change." });
    }
  });

export const CurrentTabCaptureConfirmationSchema = z
  .object({
    openedIntendedListing: z.literal(true),
    approvesVisiblePageCapture: z.literal(true),
    understandsExperimentalStatus: z.literal(true),
    understandsNoExternalAction: z.literal(true)
  })
  .strict();

export const CreateCurrentTabCaptureRequestSchema = z
  .object({
    nodeId: z.string().trim().min(1).max(160),
    profileId: BrowserProfileIdSchema,
    expectedUrl: SafeBrowserUrlSchema,
    confirmation: CurrentTabCaptureConfirmationSchema,
    requestIdempotencyKey: Sha256Schema
  })
  .strict();

export const CreateCurrentTabCaptureResponseSchema = z
  .object({
    job: SourceJobSchema,
    inserted: z.boolean()
  })
  .strict();

export type BrowserIntegrationSupportStatus = z.infer<typeof BrowserIntegrationSupportStatusSchema>;
export type BrowserControlState = z.infer<typeof BrowserControlStateSchema>;
export type BrowserAgentReadiness = z.infer<typeof BrowserAgentReadinessSchema>;
export type BrowserAgentStatusResponse = z.infer<typeof BrowserAgentStatusResponseSchema>;
export type BrowserControlMutation = z.infer<typeof BrowserControlMutationSchema>;
export type CurrentTabCaptureConfirmation = z.infer<typeof CurrentTabCaptureConfirmationSchema>;
export type CreateCurrentTabCaptureRequest = z.infer<typeof CreateCurrentTabCaptureRequestSchema>;
export type CreateCurrentTabCaptureResponse = z.infer<typeof CreateCurrentTabCaptureResponseSchema>;
