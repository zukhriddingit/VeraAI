import {
  MaritimeControlPlaneError,
  type MaritimeControlPlaneClient,
  type MaritimeControlPlaneStatus
} from "@vera/connectors";
import type { MaritimeOperationsRepository } from "@vera/db";

function mappedStatus(status: "sleeping" | "starting" | "running" | "unavailable" | "stopped") {
  return status === "stopped" ? "unavailable" : status;
}

export async function reconcileHostedHealth(input: {
  readonly operations: MaritimeOperationsRepository;
  readonly client: MaritimeControlPlaneClient;
  readonly workerAgentId: string;
  readonly gatewayAgentId: string;
  readonly environment: "development" | "staging" | "production";
  readonly now: () => Date;
}): Promise<{ readonly status: "completed" }> {
  const now = input.now();
  const checkedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 90_000).toISOString();
  const [workerResult, gatewayResult] = await Promise.allSettled([
    input.client.getStatus(input.workerAgentId),
    input.client.getStatus(input.gatewayAgentId)
  ]);
  const safe = (result: PromiseSettledResult<MaritimeControlPlaneStatus>, fallbackCode: string) =>
    result.status === "fulfilled"
      ? { status: result.value, safeCode: null }
      : {
          status: {
            agentId:
              fallbackCode === "maritime_worker_unavailable"
                ? input.workerAgentId
                : input.gatewayAgentId,
            status: "unavailable" as const,
            version: "maritime-sdk@0.5.0",
            diagnosticUrl: null,
            checkedAt
          },
          safeCode:
            result.reason instanceof MaritimeControlPlaneError ? result.reason.code : fallbackCode
        };
  const workerProjection = safe(workerResult, "maritime_worker_unavailable");
  const gatewayProjection = safe(gatewayResult, "openclaw_gateway_unavailable");
  const worker = workerProjection.status;
  const gateway = gatewayProjection.status;
  const gatewayVersion =
    gatewayProjection.safeCode === null && gateway.version !== "maritime-sdk@0.5.0"
      ? gateway.version
      : "unverified";
  await input.operations.upsertDeployment({
    id: "maritime-vera-worker",
    kind: "vera_worker",
    maritimeAgentId: input.workerAgentId,
    environment: input.environment,
    status: mappedStatus(worker.status),
    version: worker.version,
    diagnosticUrl: worker.diagnosticUrl,
    lastCheckedAt: checkedAt,
    safeErrorCode: workerProjection.safeCode,
    createdAt: checkedAt,
    updatedAt: checkedAt
  });
  await input.operations.upsertDeployment({
    id: "maritime-openclaw-gateway",
    kind: "openclaw_gateway",
    maritimeAgentId: input.gatewayAgentId,
    environment: input.environment,
    status: mappedStatus(gateway.status),
    version: gatewayVersion,
    diagnosticUrl: gateway.diagnosticUrl,
    lastCheckedAt: checkedAt,
    safeErrorCode: gatewayProjection.safeCode,
    createdAt: checkedAt,
    updatedAt: checkedAt
  });
  await input.operations.upsertHeartbeat({
    id: "vera-worker-heartbeat",
    service: "vera-worker",
    deploymentId: "maritime-vera-worker",
    status:
      worker.status === "running"
        ? "ready"
        : worker.status === "unavailable"
          ? "unavailable"
          : "degraded",
    version: "0.1.0",
    checkedAt,
    expiresAt,
    safeCode:
      worker.status === "running"
        ? null
        : (workerProjection.safeCode ?? "maritime_worker_not_running")
  });
  await input.operations.upsertHeartbeat({
    id: "openclaw-gateway-heartbeat",
    service: "openclaw-gateway",
    deploymentId: "maritime-openclaw-gateway",
    status:
      gateway.status === "running"
        ? "ready"
        : gateway.status === "unavailable"
          ? "unavailable"
          : "degraded",
    version: gatewayVersion,
    checkedAt,
    expiresAt,
    safeCode:
      gateway.status === "running"
        ? null
        : (gatewayProjection.safeCode ?? "openclaw_gateway_not_running")
  });
  return { status: "completed" };
}
