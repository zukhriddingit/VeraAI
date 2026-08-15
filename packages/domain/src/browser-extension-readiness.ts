import { z } from "zod";

import {
  BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION,
  BROWSER_CONNECTOR_EXTENSION_VERSION,
  BrowserConnectorInstallationDigestSchema
} from "./browser-connector-enrollment.ts";

export const BrowserExtensionTabReadinessSchema = z.enum([
  "not_shared",
  "preparing",
  "ready",
  "browser_extension_conflict",
  "debugger_conflict",
  "multiple_shared_tabs",
  "tab_not_shareable",
  "attachment_failed"
]);

export type BrowserExtensionTabReadiness = z.infer<typeof BrowserExtensionTabReadinessSchema>;

const BrowserExtensionReadinessBaseSchema = z.object({
  source: z.literal("vera-openclaw-extension"),
  type: z.literal("readiness"),
  paired: z.boolean(),
  relayState: z.enum(["off", "connecting", "on", "error"]),
  readiness: BrowserExtensionTabReadinessSchema,
  sharedTabCount: z.number().int().nonnegative().max(100)
});

export const BrowserExtensionReadinessMessageV1Schema = BrowserExtensionReadinessBaseSchema.extend({
  version: z.literal("1")
}).strict();

export const BrowserExtensionReadinessMessageV2Schema = BrowserExtensionReadinessBaseSchema.extend({
  version: z.literal("2"),
  extensionVersion: z.literal(BROWSER_CONNECTOR_EXTENSION_VERSION),
  enrollmentProtocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
  installationDigest: BrowserConnectorInstallationDigestSchema
}).strict();

export const BrowserExtensionReadinessMessageSchema = z.discriminatedUnion("version", [
  BrowserExtensionReadinessMessageV1Schema,
  BrowserExtensionReadinessMessageV2Schema
]);

export const BrowserExtensionEnrollmentResultMessageSchema = z
  .object({
    source: z.literal("vera-openclaw-extension"),
    type: z.literal("enrollment-result"),
    version: z.literal("1"),
    requestId: z.uuid(),
    state: z.enum([
      "connecting",
      "connected",
      "expired",
      "denied",
      "unavailable",
      "version_incompatible"
    ])
  })
  .strict();

export type BrowserExtensionReadinessMessage = z.infer<
  typeof BrowserExtensionReadinessMessageSchema
>;
export type BrowserExtensionEnrollmentResultMessage = z.infer<
  typeof BrowserExtensionEnrollmentResultMessageSchema
>;

export function browserExtensionReadyForResearch(
  message: BrowserExtensionReadinessMessage | null
): boolean {
  return (
    message !== null &&
    message.paired &&
    message.relayState === "on" &&
    message.readiness === "ready" &&
    message.sharedTabCount === 1
  );
}
