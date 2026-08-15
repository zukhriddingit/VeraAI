import { z } from "zod";

import { IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION = "1" as const;
export const BROWSER_CONNECTOR_EXTENSION_VERSION = "2.2.0" as const;

export const BrowserConnectorInstallationIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const BrowserConnectorInstallationDigestSchema = Sha256Schema;
export const BrowserConnectorEnrollmentTicketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const BrowserConnectorGatewayOriginSchema = z.url().superRefine((value, context) => {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    context.addIssue({
      code: "custom",
      message: "Browser Connector Gateway must be one exact HTTPS origin."
    });
  }
});

export const CreateBrowserConnectorEnrollmentRequestSchema = z
  .object({
    confirmation: z.literal("connect_read_only_browser"),
    extensionVersion: z.literal(BROWSER_CONNECTOR_EXTENSION_VERSION),
    protocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
    installationDigest: BrowserConnectorInstallationDigestSchema,
    idempotencyKey: Sha256Schema
  })
  .strict();

export const CreateBrowserConnectorEnrollmentResponseSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
    ticket: BrowserConnectorEnrollmentTicketSchema,
    expiresAt: IsoDateTimeSchema,
    gatewayOrigin: BrowserConnectorGatewayOriginSchema
  })
  .strict();

export const BrowserConnectorEnrollmentCheckpointRequestSchema = z
  .object({
    ticket: BrowserConnectorEnrollmentTicketSchema,
    extensionVersion: z.literal(BROWSER_CONNECTOR_EXTENSION_VERSION),
    protocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
    installationId: BrowserConnectorInstallationIdSchema,
    requestedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserConnectorEnrollmentDenialReasonSchema = z.enum([
  "disabled",
  "assignment_unavailable",
  "ticket_invalid",
  "ticket_expired",
  "ticket_replayed",
  "binding_mismatch",
  "version_incompatible",
  "device_conflict"
]);

export const BrowserConnectorEnrollmentDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      assignmentId: z.uuid()
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      reason: BrowserConnectorEnrollmentDenialReasonSchema
    })
    .strict()
]);

export type CreateBrowserConnectorEnrollmentRequest = z.infer<
  typeof CreateBrowserConnectorEnrollmentRequestSchema
>;
export type CreateBrowserConnectorEnrollmentResponse = z.infer<
  typeof CreateBrowserConnectorEnrollmentResponseSchema
>;
export type BrowserConnectorEnrollmentCheckpointRequest = z.infer<
  typeof BrowserConnectorEnrollmentCheckpointRequestSchema
>;
export type BrowserConnectorEnrollmentDecision = z.infer<
  typeof BrowserConnectorEnrollmentDecisionSchema
>;
export type BrowserConnectorEnrollmentDenialReason = z.infer<
  typeof BrowserConnectorEnrollmentDenialReasonSchema
>;
