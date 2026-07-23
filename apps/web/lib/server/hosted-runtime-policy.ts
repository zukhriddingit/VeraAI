import { z } from "zod";

const DisabledFlagSchema = z.enum(["1", "true", "0", "false"]);

export interface HostedRuntimePolicy {
  readonly browserDisabled: boolean;
  readonly gmailAlertsDisabled: boolean;
  readonly integrationsDisabled: boolean;
  readonly notificationsDisabled: boolean;
}

function disabledByDefault(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): boolean {
  const raw = environment[name]?.trim().toLowerCase() || "1";
  const parsed = DisabledFlagSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${name} must be one of 1, true, 0, or false.`);
  return parsed.data === "1" || parsed.data === "true";
}

export function parseHostedRuntimePolicy(
  environment: Readonly<Record<string, string | undefined>>
): HostedRuntimePolicy {
  return {
    browserDisabled: disabledByDefault(environment, "VERA_BROWSER_DISABLED"),
    gmailAlertsDisabled: disabledByDefault(environment, "VERA_GMAIL_ALERTS_DISABLED"),
    integrationsDisabled: disabledByDefault(environment, "VERA_INTEGRATIONS_DISABLED"),
    notificationsDisabled: disabledByDefault(environment, "VERA_NOTIFICATIONS_DISABLED")
  };
}
