import {
  createMaritimeRemoteExtensionClient,
  MaritimeRemoteExtensionError,
  type MaritimeRemoteExtensionClient
} from "@vera/connectors";
import {
  ActivityEventSchema,
  RemoteExtensionSnapshotConfirmationSchema,
  RemoteExtensionSnapshotResponseSchema,
  VeraUserIdSchema,
  type RemoteExtensionSnapshotFailureCode,
  type RemoteExtensionSnapshotResponse,
  type VeraUserId
} from "@vera/domain";
import { sha256Text, type UserRepositories } from "@vera/db";

import { parseHostedRuntimePolicy } from "./server/hosted-runtime-policy.ts";

export class RemoteExtensionSnapshotServiceError extends Error {
  constructor(
    readonly code: RemoteExtensionSnapshotFailureCode,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(`Remote browser snapshot stopped safely: ${code}.`);
    this.name = "RemoteExtensionSnapshotServiceError";
  }
}

export interface RemoteExtensionSnapshotEnvironment {
  readonly enabled: boolean;
  readonly browserDisabled: boolean;
  readonly founderUserId: VeraUserId | null;
  readonly gatewayConfigured: boolean;
}

export interface RemoteExtensionSnapshotDependencies {
  readonly userId: VeraUserId;
  readonly environment: RemoteExtensionSnapshotEnvironment;
  readonly client: Pick<MaritimeRemoteExtensionClient, "snapshot">;
  readonly repositories: Pick<UserRepositories, "activityEvents">;
  createId(): string;
}

export function parseRemoteExtensionSnapshotEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): RemoteExtensionSnapshotEnvironment {
  const founder = environment.VERA_BROWSER_GATEWAY_FOUNDER_USER_ID?.trim();
  const parsedFounder = founder ? VeraUserIdSchema.safeParse(founder) : null;
  if (parsedFounder && !parsedFounder.success) {
    throw new Error("VERA_BROWSER_GATEWAY_FOUNDER_USER_ID must be one exact Vera user UUID.");
  }
  return {
    enabled: environment.VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED === "1",
    browserDisabled: parseHostedRuntimePolicy(environment).browserDisabled,
    founderUserId: parsedFounder?.success ? parsedFounder.data : null,
    gatewayConfigured:
      Boolean(environment.MARITIME_BROWSER_GATEWAY_API_KEY?.trim()) &&
      Boolean(environment.MARITIME_BROWSER_GATEWAY_AGENT_ID?.trim())
  };
}

export function createRemoteExtensionSnapshotDependencies(
  userId: VeraUserId,
  repositories: UserRepositories,
  environment: Readonly<Record<string, string | undefined>> = process.env
): RemoteExtensionSnapshotDependencies {
  const parsedEnvironment = parseRemoteExtensionSnapshotEnvironment(environment);
  return {
    userId,
    repositories,
    environment: parsedEnvironment,
    client: parsedEnvironment.gatewayConfigured
      ? createMaritimeRemoteExtensionClient(environment)
      : {
          snapshot: async () => {
            throw new MaritimeRemoteExtensionError("gateway_unavailable", false);
          }
        },
    createId: crypto.randomUUID
  };
}

function mapClientError(error: MaritimeRemoteExtensionError): RemoteExtensionSnapshotServiceError {
  const code =
    error.code === "maritime_auth_failed"
      ? "maritime_auth_failed"
      : error.code === "snapshot_timed_out"
        ? "snapshot_timed_out"
        : error.code === "snapshot_invalid_response"
          ? "snapshot_invalid_response"
          : "gateway_unavailable";
  return new RemoteExtensionSnapshotServiceError(
    code,
    code === "maritime_auth_failed" || code === "snapshot_invalid_response" ? 409 : 503,
    error.retryable
  );
}

async function appendSnapshotAudit(input: {
  readonly dependencies: RemoteExtensionSnapshotDependencies;
  readonly requestId: string;
  readonly action: "browser.remote_snapshot_completed" | "browser.remote_snapshot_failed";
  readonly outcome: "succeeded" | "failed";
  readonly safeCode: string;
  readonly contentSha256?: string;
  readonly sourceSha256?: string;
  readonly returnedLineCount?: number;
  readonly sourceTruncated?: boolean;
  readonly occurredAt: string;
}): Promise<void> {
  await input.dependencies.repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: input.requestId,
      correlationId: input.requestId,
      causationId: null,
      actor: "vera",
      action: input.action,
      targetType: "remote_browser_snapshot",
      targetId: input.requestId,
      policyDecision: "authorized",
      approvalId: null,
      payloadHash:
        input.contentSha256 ??
        sha256Text(`remote-extension-snapshot:v1:${input.requestId}:${input.safeCode}`),
      outcome: input.outcome,
      errorCategory:
        input.outcome === "failed"
          ? input.safeCode === "maritime_auth_failed"
            ? "authentication"
            : input.safeCode === "snapshot_invalid_response"
              ? "validation"
              : "transient_provider"
          : null,
      metadata: {
        protocol: "vera-remote-extension-snapshot.v1",
        safeCode: input.safeCode,
        ...(input.sourceSha256 ? { sourceSha256: input.sourceSha256 } : {}),
        ...(input.returnedLineCount === undefined
          ? {}
          : { returnedLineCount: input.returnedLineCount }),
        ...(input.sourceTruncated === undefined ? {} : { sourceTruncated: input.sourceTruncated })
      },
      occurredAt: input.occurredAt
    })
  );
}

export async function requestRemoteExtensionSnapshot(
  dependencies: RemoteExtensionSnapshotDependencies,
  input: unknown
): Promise<RemoteExtensionSnapshotResponse> {
  RemoteExtensionSnapshotConfirmationSchema.parse(input);
  if (dependencies.environment.browserDisabled) {
    throw new RemoteExtensionSnapshotServiceError("browser_disabled", 409, false);
  }
  if (!dependencies.environment.enabled) {
    throw new RemoteExtensionSnapshotServiceError("spike_disabled", 409, false);
  }
  if (
    dependencies.environment.founderUserId === null ||
    dependencies.environment.founderUserId !== dependencies.userId
  ) {
    throw new RemoteExtensionSnapshotServiceError("founder_denied", 403, false);
  }
  if (!dependencies.environment.gatewayConfigured) {
    throw new RemoteExtensionSnapshotServiceError("browser_gateway_not_configured", 409, false);
  }
  const requestId = dependencies.createId();
  try {
    const snapshot = await dependencies.client.snapshot(requestId);
    await appendSnapshotAudit({
      dependencies,
      requestId,
      action: "browser.remote_snapshot_completed",
      outcome: "succeeded",
      safeCode: "minimized_snapshot_returned",
      contentSha256: snapshot.contentSha256,
      sourceSha256: snapshot.sourceSha256,
      returnedLineCount: snapshot.returnedLineCount,
      sourceTruncated: snapshot.sourceTruncated,
      occurredAt: snapshot.capturedAt
    });
    return RemoteExtensionSnapshotResponseSchema.parse({ requestId, snapshot });
  } catch (error) {
    if (error instanceof MaritimeRemoteExtensionError) {
      try {
        await appendSnapshotAudit({
          dependencies,
          requestId,
          action: "browser.remote_snapshot_failed",
          outcome: "failed",
          safeCode: error.code,
          occurredAt: new Date().toISOString()
        });
      } catch {
        // The original safe provider error remains authoritative when audit storage is unavailable.
      }
      throw mapClientError(error);
    }
    throw error;
  }
}
