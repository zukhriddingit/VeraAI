import { z } from "zod";

import { BrowserResearchSourceSchema } from "./browser-research.ts";
import { VeraUserIdSchema } from "./identity.ts";
import { IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const BrowserAssignmentStatusSchema = z.enum(["pending", "active", "revoked"]);

export const BrowserGatewaySecretReferenceSchema = z.string().regex(/^[A-Z][A-Z0-9_]{7,31}$/u);

export const BrowserCredentialDigestSchema = Sha256Schema;

const BrowserRoutingIdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const ExactHttpsOriginSchema = z
  .url()
  .regex(
    /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[1-9][0-9]{0,4})?$/u,
    "Gateway origin must be one exact HTTPS origin without a path."
  );

export const BrowserGatewayAssignmentSchema = z
  .object({
    id: z.uuid(),
    userId: VeraUserIdSchema,
    nodeId: BrowserRoutingIdentifierSchema,
    maritimeAgentId: BrowserRoutingIdentifierSchema,
    gatewayOrigin: ExactHttpsOriginSchema,
    checkpointOrigin: z.literal("https://app.verahousing.app"),
    secretReference: BrowserGatewaySecretReferenceSchema,
    relayCredentialDigest: BrowserCredentialDigestSchema,
    checkpointCredentialDigest: BrowserCredentialDigestSchema,
    status: BrowserAssignmentStatusSchema,
    createdAt: IsoDateTimeSchema,
    activatedAt: IsoDateTimeSchema.nullable(),
    revokedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.status === "pending" && assignment.activatedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["activatedAt"],
        message: "A pending assignment cannot have an activation time."
      });
    }
    if (assignment.status === "active" && assignment.activatedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["activatedAt"],
        message: "An active assignment requires an activation time."
      });
    }
    if (assignment.status === "revoked" && assignment.revokedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "A revoked assignment requires a revocation time."
      });
    }
  });

export interface BrowserGatewayRuntime {
  readonly assignment: z.infer<typeof BrowserGatewayAssignmentSchema>;
  readonly maritimeApiKey: string;
  readonly planSigningKey: string;
  readonly enabledSources: ReadonlySet<z.infer<typeof BrowserResearchSourceSchema>>;
}

export const BrowserGatewayOnboardingStateSchema = z.enum([
  "waiting_for_onboarding",
  "pending",
  "active",
  "revoked"
]);

export const BrowserGatewaySafeNodeStateSchema = z.enum([
  "not_registered",
  "setup_required",
  "online",
  "offline",
  "revoked"
]);

export const BrowserGatewayRecoveryCodeSchema = z.enum([
  "awaiting_concierge",
  "awaiting_activation",
  "complete_browser_setup",
  "restore_browser_node",
  "revoked_by_user"
]);

export const BrowserGatewayOnboardingStatusSchema = z
  .object({
    status: BrowserGatewayOnboardingStateSchema,
    browserReady: z.boolean(),
    nodeState: BrowserGatewaySafeNodeStateSchema,
    enabledSources: z.array(BrowserResearchSourceSchema).max(6),
    recoveryCode: BrowserGatewayRecoveryCodeSchema.nullable()
  })
  .strict();

export const RevokeBrowserGatewayAssignmentRequestSchema = z
  .object({ confirmation: z.literal("revoke_browser_connector") })
  .strict();

export type BrowserAssignmentStatus = z.infer<typeof BrowserAssignmentStatusSchema>;
export type BrowserGatewayAssignment = z.infer<typeof BrowserGatewayAssignmentSchema>;
export type BrowserGatewayOnboardingStatus = z.infer<typeof BrowserGatewayOnboardingStatusSchema>;
export type BrowserGatewaySecretReference = z.infer<typeof BrowserGatewaySecretReferenceSchema>;
