import { z } from "zod";

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

export const BrowserExtensionReadinessMessageSchema = z
  .object({
    source: z.literal("vera-openclaw-extension"),
    type: z.literal("readiness"),
    version: z.literal("1"),
    paired: z.boolean(),
    relayState: z.enum(["off", "connecting", "on", "error"]),
    readiness: BrowserExtensionTabReadinessSchema,
    sharedTabCount: z.number().int().nonnegative().max(100)
  })
  .strict();

export type BrowserExtensionReadinessMessage = z.infer<
  typeof BrowserExtensionReadinessMessageSchema
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
