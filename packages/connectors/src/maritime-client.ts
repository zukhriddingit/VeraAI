import {
  Maritime,
  MaritimeAPIError,
  MaritimeAuthError,
  MaritimeConnectionError,
  MaritimeNotFoundError,
  MaritimePaymentRequiredError,
  MaritimeRateLimitError,
  type Agent,
  type LogEntry
} from "maritime-sdk";
import { z } from "zod";

const AgentIdSchema = z.string().trim().min(1).max(160);
const MaritimeAgentSchema = z
  .object({
    id: AgentIdSchema,
    status: z.enum(["sleeping", "active", "deploying", "error", "stopped"]),
    framework: z.string().trim().min(1).max(120),
    updatedAt: z.string().datetime({ offset: true }),
    publicUrl: z.string().url().max(2_048).nullable().optional()
  })
  .passthrough();
const MaritimeLogSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    level: z.string().trim().min(1).max(40),
    source: z.string().trim().min(1).max(120).nullable().optional(),
    timestamp: z.string().datetime({ offset: true }).nullable()
  })
  .passthrough();

export const MaritimeControlPlaneStatusSchema = z
  .object({
    agentId: AgentIdSchema,
    status: z.enum(["sleeping", "starting", "running", "unavailable", "stopped"]),
    version: z.string().trim().min(1).max(120),
    diagnosticUrl: z.string().url().max(2_048).nullable(),
    checkedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const MaritimeDiagnosticReferenceSchema = z
  .object({
    id: AgentIdSchema,
    level: z.string().trim().min(1).max(40),
    source: z.string().trim().min(1).max(120).nullable(),
    timestamp: z.string().datetime({ offset: true }).nullable()
  })
  .strict();

export type MaritimeControlPlaneStatus = z.infer<typeof MaritimeControlPlaneStatusSchema>;
export type MaritimeDiagnosticReference = z.infer<typeof MaritimeDiagnosticReferenceSchema>;

export type MaritimeControlPlaneErrorCode =
  | "maritime_configuration_error"
  | "maritime_authentication_error"
  | "maritime_rate_limited"
  | "maritime_not_found"
  | "maritime_payment_required"
  | "maritime_unavailable";

export class MaritimeControlPlaneError extends Error {
  constructor(
    readonly code: MaritimeControlPlaneErrorCode,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = "MaritimeControlPlaneError";
  }
}

export interface MaritimeSdkBoundary {
  readonly agents: {
    start(agentId: string): Promise<Agent>;
    get(agentId: string): Promise<Agent>;
    logs(agentId: string, options?: { readonly limit?: number }): Promise<LogEntry[]>;
  };
}

export interface MaritimeControlPlaneClient {
  wake(agentId: string): Promise<MaritimeControlPlaneStatus>;
  getStatus(agentId: string): Promise<MaritimeControlPlaneStatus>;
  getDiagnostics(agentId: string): Promise<readonly MaritimeDiagnosticReference[]>;
}

function mappedStatus(
  status: z.infer<typeof MaritimeAgentSchema>["status"]
): MaritimeControlPlaneStatus["status"] {
  switch (status) {
    case "active":
      return "running";
    case "deploying":
      return "starting";
    case "sleeping":
      return "sleeping";
    case "stopped":
      return "stopped";
    case "error":
      return "unavailable";
  }
}

function mapError(error: unknown): MaritimeControlPlaneError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { readonly status?: unknown }).status
      : undefined;
  if (error instanceof MaritimeRateLimitError || status === 429) {
    return new MaritimeControlPlaneError("maritime_rate_limited", true);
  }
  if (error instanceof MaritimeAuthError || status === 401 || status === 403) {
    return new MaritimeControlPlaneError("maritime_authentication_error", false);
  }
  if (error instanceof MaritimePaymentRequiredError || status === 402) {
    return new MaritimeControlPlaneError("maritime_payment_required", false);
  }
  if (error instanceof MaritimeNotFoundError || status === 404) {
    return new MaritimeControlPlaneError("maritime_not_found", false);
  }
  if (error instanceof MaritimeConnectionError || error instanceof MaritimeAPIError) {
    return new MaritimeControlPlaneError("maritime_unavailable", true);
  }
  return new MaritimeControlPlaneError("maritime_unavailable", true);
}

export class SdkMaritimeControlPlaneClient implements MaritimeControlPlaneClient {
  constructor(private readonly sdk: MaritimeSdkBoundary) {}

  async wake(agentIdInput: string): Promise<MaritimeControlPlaneStatus> {
    const agentId = AgentIdSchema.parse(agentIdInput);
    try {
      return this.status(MaritimeAgentSchema.parse(await this.sdk.agents.start(agentId)));
    } catch (error: unknown) {
      throw mapError(error);
    }
  }

  async getStatus(agentIdInput: string): Promise<MaritimeControlPlaneStatus> {
    const agentId = AgentIdSchema.parse(agentIdInput);
    try {
      return this.status(MaritimeAgentSchema.parse(await this.sdk.agents.get(agentId)));
    } catch (error: unknown) {
      throw mapError(error);
    }
  }

  async getDiagnostics(agentIdInput: string): Promise<readonly MaritimeDiagnosticReference[]> {
    const agentId = AgentIdSchema.parse(agentIdInput);
    try {
      return (await this.sdk.agents.logs(agentId, { limit: 50 })).map((entry) => {
        const safe = MaritimeLogSchema.parse(entry);
        return MaritimeDiagnosticReferenceSchema.parse({
          id: safe.id,
          level: safe.level,
          source: safe.source ?? null,
          timestamp: safe.timestamp
        });
      });
    } catch (error: unknown) {
      throw mapError(error);
    }
  }

  private status(agent: z.infer<typeof MaritimeAgentSchema>): MaritimeControlPlaneStatus {
    return MaritimeControlPlaneStatusSchema.parse({
      agentId: agent.id,
      status: mappedStatus(agent.status),
      version: "maritime-sdk@0.5.0",
      // A public application URL is not a sanitized diagnostic or log reference.
      diagnosticUrl: null,
      checkedAt: agent.updatedAt
    });
  }
}

export function createMaritimeControlPlaneClient(
  environment: NodeJS.ProcessEnv
): MaritimeControlPlaneClient {
  const apiKey = environment.MARITIME_API_KEY?.trim();
  if (!apiKey) throw new MaritimeControlPlaneError("maritime_configuration_error", false);
  const baseUrl = environment.MARITIME_API_URL?.trim() || "https://api.maritime.sh";
  return new SdkMaritimeControlPlaneClient(
    new Maritime({ apiKey, baseUrl, timeout: 10_000, maxRetries: 0 })
  );
}
