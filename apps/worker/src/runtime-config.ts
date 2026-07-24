import { isAbsolute } from "node:path";

import { VeraUserIdSchema } from "@vera/domain";

const DISABLED_FLAGS = new Set(["1", "true", "0", "false"]);
const MARITIME_ENVIRONMENTS = new Set(["development", "staging", "production"]);

export interface WorkerRuntimeConfig {
  readonly command: "start" | "run-once" | "serve";
  readonly browserDisabled: boolean;
  readonly gmailAlertsDisabled: boolean;
  readonly integrationsDisabled: boolean;
  readonly notificationsDisabled: boolean;
  readonly maritimeEnvironment: "development" | "staging" | "production";
  readonly maritimeWorkerAgentId: string | null;
  readonly maritimeGatewayAgentId: string | null;
  readonly maritimeApiKey: string | null;
  readonly openClawGatewayUrl: string | null;
  readonly openClawGatewayToken: string | null;
  readonly openClawExecutable: string;
}

function optional(environment: Readonly<Record<string, string | undefined>>, name: string) {
  const value = environment[name]?.trim();
  return value ? value : null;
}

function disabledByDefault(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): boolean {
  const raw = optional(environment, name)?.toLowerCase() ?? "1";
  if (!DISABLED_FLAGS.has(raw)) throw new Error(`${name} must be one of 1, true, 0, or false.`);
  return raw === "1" || raw === "true";
}

function validateFounderIds(value: string | null): void {
  if (value === null)
    throw new Error("VERA_BROWSER_FOUNDER_USER_IDS is required when browser capture is enabled.");
  const ids = value.split(",").map((entry) => entry.trim());
  if (ids.length === 0 || ids.some((entry) => !VeraUserIdSchema.safeParse(entry).success)) {
    throw new Error("VERA_BROWSER_FOUNDER_USER_IDS must contain exact Vera user UUIDs.");
  }
}

function validateGatewayUrl(value: string, productionShaped: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OPENCLAW_GATEWAY_URL must be a valid WebSocket URL.");
  }
  if (productionShaped) {
    if (parsed.protocol !== "wss:") throw new Error("Hosted OpenClaw gateways require TLS wss://.");
    return;
  }
  if (parsed.protocol === "wss:") return;
  const loopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "ws:" || !loopback) {
    throw new Error("Plain ws:// is allowed only for a loopback development gateway.");
  }
}

export function parseWorkerRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  command: WorkerRuntimeConfig["command"]
): WorkerRuntimeConfig {
  const maritimeEnvironmentRaw =
    optional(environment, "VERA_MARITIME_ENVIRONMENT") ?? "development";
  if (!MARITIME_ENVIRONMENTS.has(maritimeEnvironmentRaw)) {
    throw new Error("VERA_MARITIME_ENVIRONMENT must be development, staging, or production.");
  }
  const maritimeEnvironment = maritimeEnvironmentRaw as WorkerRuntimeConfig["maritimeEnvironment"];

  const browserDisabled = disabledByDefault(environment, "VERA_BROWSER_DISABLED");
  const gmailAlertsDisabled = disabledByDefault(environment, "VERA_GMAIL_ALERTS_DISABLED");
  const integrationsDisabled = disabledByDefault(environment, "VERA_INTEGRATIONS_DISABLED");
  const notificationsDisabled = disabledByDefault(environment, "VERA_NOTIFICATIONS_DISABLED");
  const maritimeWorkerAgentId = optional(environment, "VERA_MARITIME_WORKER_AGENT_ID");
  const maritimeGatewayAgentId = optional(environment, "VERA_MARITIME_GATEWAY_AGENT_ID");
  const maritimeApiKey = optional(environment, "MARITIME_API_KEY");
  const maritimeWorkerConfigured = [maritimeWorkerAgentId, maritimeApiKey].filter(Boolean).length;
  if (maritimeWorkerConfigured !== 0 && maritimeWorkerConfigured !== 2) {
    throw new Error(
      "Maritime runtime configuration must provide the worker agent ID and scoped API key together."
    );
  }
  if (command === "serve" && maritimeWorkerConfigured !== 2) {
    throw new Error("Hosted serve mode requires complete Maritime runtime configuration.");
  }
  if (browserDisabled && maritimeGatewayAgentId !== null) {
    throw new Error(
      "VERA_MARITIME_GATEWAY_AGENT_ID must be absent while browser capture is disabled."
    );
  }
  if (command === "serve" && !browserDisabled && maritimeGatewayAgentId === null) {
    throw new Error("Hosted browser capture requires VERA_MARITIME_GATEWAY_AGENT_ID.");
  }
  if (maritimeWorkerConfigured === 2) {
    if (
      maritimeWorkerAgentId!.length > 160 ||
      (maritimeGatewayAgentId?.length ?? 0) > 160 ||
      maritimeApiKey!.length > 4_096
    ) {
      throw new Error("Maritime runtime identifiers or credentials exceed their bounded contract.");
    }
    let maritimeApiUrl: URL;
    try {
      maritimeApiUrl = new URL(
        optional(environment, "MARITIME_API_URL") ?? "https://api.maritime.sh"
      );
    } catch {
      throw new Error("MARITIME_API_URL must be a valid HTTPS URL.");
    }
    if (maritimeApiUrl.protocol !== "https:") {
      throw new Error("MARITIME_API_URL must use HTTPS.");
    }
  }

  const openClawGatewayUrl = optional(environment, "OPENCLAW_GATEWAY_URL");
  const openClawGatewayToken = optional(environment, "OPENCLAW_GATEWAY_TOKEN");
  if ((openClawGatewayUrl === null) !== (openClawGatewayToken === null)) {
    throw new Error("OpenClaw gateway URL and token must be configured together.");
  }
  if (browserDisabled && openClawGatewayUrl !== null) {
    throw new Error(
      "OpenClaw gateway configuration must be absent while browser capture is disabled."
    );
  }
  if (
    openClawGatewayToken !== null &&
    (openClawGatewayToken.length < 16 || openClawGatewayToken.length > 4_096)
  ) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN must satisfy the bounded server credential contract.");
  }
  const openClawExecutable = optional(environment, "VERA_OPENCLAW_EXECUTABLE") ?? "openclaw";
  const productionShaped = command === "serve" || maritimeEnvironment !== "development";
  if (openClawGatewayUrl !== null) validateGatewayUrl(openClawGatewayUrl, productionShaped);
  if (productionShaped && openClawGatewayUrl !== null && !isAbsolute(openClawExecutable)) {
    throw new Error(
      "Hosted OpenClaw execution requires an absolute lockfile-installed executable path."
    );
  }
  if (!browserDisabled) {
    validateFounderIds(optional(environment, "VERA_BROWSER_FOUNDER_USER_IDS"));
    if (openClawGatewayUrl === null || openClawGatewayToken === null) {
      throw new Error(
        "Browser capture cannot be enabled without a complete OpenClaw gateway tuple."
      );
    }
  }

  return {
    command,
    browserDisabled,
    gmailAlertsDisabled,
    integrationsDisabled,
    notificationsDisabled,
    maritimeEnvironment,
    maritimeWorkerAgentId,
    maritimeGatewayAgentId,
    maritimeApiKey,
    openClawGatewayUrl,
    openClawGatewayToken,
    openClawExecutable
  };
}
