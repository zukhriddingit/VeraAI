import { randomUUID } from "node:crypto";

import {
  createMaritimeControlPlaneClient,
  MaritimeControlPlaneError,
  type MaritimeControlPlaneClient
} from "@vera/connectors";
import { sha256Text, type MaritimeOperationsRepository, type UserRepositories } from "@vera/db";
import {
  OperationsSnapshotSchema,
  type OperationsSnapshot,
  type SourceJob,
  type VeraUserId
} from "@vera/domain";
import { evaluateCurrentTabCapturePolicy, SourcePolicyRegistry } from "@vera/policy";
import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";

function activeSwitches(
  environment: Readonly<Record<string, string | undefined>>
): ReadonlySet<string> {
  return new Set(
    (environment.VERA_ACTIVE_KILL_SWITCHES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function networkForJob(job: SourceJob) {
  if (job.acquisitionMode === "local_browser") {
    const url = new URL(
      job.payload.acquisitionMode === "local_browser" && job.payload.captureKind === "current_tab"
        ? job.payload.expectedUrl
        : job.payload.acquisitionMode === "local_browser"
          ? job.payload.savedSearchUrl
          : "https://invalid.example/"
    );
    return { origin: `${url.origin}/`, domain: url.hostname, httpMethod: "GET" as const };
  }
  if (job.acquisitionMode === "email_alert") {
    return {
      origin: "https://gmail.googleapis.com/" as const,
      domain: "gmail.googleapis.com" as const,
      httpMethod: "GET" as const
    };
  }
  return null;
}

export async function loadOperationsSnapshot(input: {
  readonly repositories: UserRepositories;
  readonly globalOperations?: MaritimeOperationsRepository;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maritimeClient?: MaritimeControlPlaneClient;
  readonly now?: () => Date;
}): Promise<OperationsSnapshot> {
  const environment = input.environment ?? process.env;
  parseHostedRuntimePolicy(environment);
  const now = (input.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();
  const [jobs, schedules, deliveries, nodes, manifests, deployments, heartbeats] =
    await Promise.all([
      input.repositories.sourceJobs.list(),
      input.repositories.productionSchedules.list(),
      input.repositories.notificationDeliveries.list(),
      input.repositories.browserNodes.list(),
      input.repositories.sourcePolicyManifests.listLatest(),
      input.globalOperations?.listDeployments() ?? Promise.resolve([]),
      input.globalOperations?.listHeartbeats() ?? Promise.resolve([])
    ]);
  const workerAgentId = environment.VERA_MARITIME_WORKER_AGENT_ID?.trim();
  const gatewayAgentId = environment.VERA_MARITIME_GATEWAY_AGENT_ID?.trim();
  let client = input.maritimeClient;
  let clientSafeCode: string | null = null;
  if (!client && environment.MARITIME_API_KEY?.trim()) {
    try {
      client = createMaritimeControlPlaneClient(environment as NodeJS.ProcessEnv);
    } catch (error: unknown) {
      client = undefined;
      clientSafeCode =
        error instanceof MaritimeControlPlaneError ? error.code : "maritime_configuration_error";
    }
  }
  const safeStatus = async (agentId: string | undefined) => {
    if (!client || !agentId) {
      return {
        status: null,
        safeCode: clientSafeCode ?? "maritime_configuration_error"
      } as const;
    }
    try {
      return { status: await client.getStatus(agentId), safeCode: null } as const;
    } catch (error: unknown) {
      return {
        status: null,
        safeCode: error instanceof MaritimeControlPlaneError ? error.code : "maritime_unavailable"
      } as const;
    }
  };
  const [workerMaritimeRead, gatewayMaritimeRead] = await Promise.all([
    safeStatus(workerAgentId),
    safeStatus(gatewayAgentId)
  ]);
  const workerMaritime = workerMaritimeRead.status;
  const gatewayMaritime = gatewayMaritimeRead.status;
  const workerHeartbeat = [...heartbeats]
    .filter((heartbeat) => heartbeat.service === "vera-worker")
    .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt))[0];
  const gatewayDeployment = deployments.find(
    (deployment) => deployment.kind === "openclaw_gateway"
  );
  const workerDeployment = deployments.find((deployment) => deployment.kind === "vera_worker");
  const node = [...nodes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const scheduleProjections = await Promise.all(
    schedules.map(async (schedule) => {
      const runs = await input.repositories.productionSchedules.listRuns(schedule.id);
      return {
        kind: schedule.kind,
        state: schedule.state,
        nextRunAt: schedule.nextRunAt,
        lastRunAt: schedule.lastRunAt,
        lastOutcome: runs.at(-1)?.state ?? null
      };
    })
  );
  const maritimeStatus = workerMaritime?.status ?? workerDeployment?.status;
  const gatewayStatus = gatewayMaritime?.status ?? gatewayDeployment?.status;
  return OperationsSnapshotSchema.parse({
    generatedAt,
    worker: {
      status:
        workerHeartbeat && Date.parse(workerHeartbeat.expiresAt) > now.getTime()
          ? workerHeartbeat.status
          : "unknown",
      checkedAt: workerHeartbeat?.checkedAt ?? generatedAt,
      safeCode: workerHeartbeat?.safeCode ?? null
    },
    maritime: {
      status:
        maritimeStatus === "running" ||
        maritimeStatus === "starting" ||
        maritimeStatus === "sleeping" ||
        maritimeStatus === "restarting"
          ? maritimeStatus
          : maritimeStatus === null || maritimeStatus === undefined
            ? "unknown"
            : "unavailable",
      checkedAt: workerMaritime?.checkedAt ?? generatedAt,
      diagnosticUrl: workerMaritime?.diagnosticUrl ?? null,
      safeCode: workerMaritimeRead.safeCode
    },
    gateway: {
      status:
        gatewayStatus === "running" ||
        gatewayStatus === "starting" ||
        gatewayStatus === "sleeping" ||
        gatewayStatus === "restarting"
          ? gatewayStatus
          : gatewayStatus === null || gatewayStatus === undefined
            ? "unknown"
            : "unavailable",
      version: gatewayDeployment?.version ?? "unverified",
      checkedAt: gatewayMaritime?.checkedAt ?? gatewayDeployment?.lastCheckedAt ?? generatedAt,
      safeCode: gatewayMaritimeRead.safeCode
    },
    browserNode: node
      ? {
          status:
            node.status === "online" && Date.parse(node.heartbeatExpiresAt) <= now.getTime()
              ? "stale"
              : node.status,
          pairingState: node.pairingState,
          capabilityState: node.capabilityApprovalState,
          lastHeartbeatAt: node.lastHeartbeatAt,
          version: node.reportedOpenClawVersion
        }
      : null,
    schedules: scheduleProjections,
    jobCounts: {
      queued: jobs.filter((job) => ["queued", "dispatched"].includes(job.status)).length,
      running: jobs.filter((job) => job.status === "running").length,
      deferred: jobs.filter((job) => job.status === "deferred_node_offline").length,
      manualAction: jobs.filter((job) => job.status === "manual_action_required").length,
      deadLetter: jobs.filter((job) => job.status === "permanently_failed").length
    },
    notificationCounts: {
      queued: deliveries.filter((delivery) =>
        ["queued", "leased", "deferred_quiet_hours", "deferred_rate_limit"].includes(delivery.state)
      ).length,
      delivered: deliveries.filter((delivery) => delivery.state === "delivered").length,
      failed: deliveries.filter((delivery) =>
        ["retryable_failed", "permanently_failed"].includes(delivery.state)
      ).length
    },
    killSwitches: manifests.map((manifest) => ({
      source: manifest.connectorId,
      enabled:
        !manifest.enabled ||
        activeSwitches(environment).has(manifest.globalKillSwitchKey) ||
        activeSwitches(environment).has(manifest.connectorKillSwitchKey)
    }))
  });
}

export async function retrySourceJob(input: {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly jobId: string;
  readonly expectedRevision: number;
  readonly correlationId: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}): Promise<SourceJob> {
  const clock = input.now ?? (() => new Date());
  const job = await input.repositories.sourceJobs.getById(input.jobId);
  if (!job || job.attempts !== input.expectedRevision) throw new Error("job_revision_conflict");
  const latestDispatch =
    job.status === "queued"
      ? await input.repositories.maritimeDispatches.getBySourceJobId(job.id)
      : null;
  const retryingRejectedWake =
    latestDispatch?.state === "rejected" &&
    new Set(["maritime_rate_limited", "maritime_unavailable"]).has(
      latestDispatch.rejectionCode ?? ""
    );
  if (
    !retryingRejectedWake &&
    !new Set(["retryable_failed", "deferred_node_offline", "manual_action_required"]).has(
      job.status
    )
  ) {
    throw new Error("unsafe_retry");
  }
  if (job.attempts >= job.maxAttempts) throw new Error("attempt_limit_reached");
  const environment = input.environment ?? process.env;
  const runtimePolicy = parseHostedRuntimePolicy(environment);
  if (
    job.connectorId === "zillow.current-tab.v1" &&
    job.payload.acquisitionMode === "local_browser" &&
    job.payload.captureKind === "current_tab"
  ) {
    const [control, node, profile, approval] = await Promise.all([
      input.repositories.browserIntegrationControls.get(),
      input.repositories.browserNodes.getById(job.payload.nodeId),
      input.repositories.browserProfileControls.get(job.payload.nodeId, job.payload.profileId),
      job.approvalId === null
        ? Promise.resolve(null)
        : input.repositories.approvals.getById(job.approvalId)
    ]);
    const decision = evaluateCurrentTabCapturePolicy({
      expectedUrl: job.payload.expectedUrl,
      profileId: job.payload.profileId,
      node,
      controls: {
        systemBrowserDisabled: runtimePolicy.browserDisabled,
        userBrowserEnabled: control.userBrowserEnabled,
        zillowSourceEnabled: control.zillowSourceEnabled,
        nodeDisabled: node?.disabledAt !== null && node?.disabledAt !== undefined,
        profileDisabled: profile === null || profile.disabledAt !== null
      },
      hasUserSession: true,
      hasApproval:
        approval !== null &&
        approval.state === "used" &&
        approval.payloadHash === job.payloadHash &&
        Date.parse(approval.expiresAt) > clock().getTime()
    });
    if (!decision.allowed) throw new Error(`policy_denied:${decision.reason}`);
  } else {
    const manifests = await input.repositories.sourcePolicyManifests.listLatest();
    const registry = new SourcePolicyRegistry(manifests, {
      activeKillSwitches: activeSwitches(environment)
    });
    const policy = registry.evaluate({
      connectorId: job.connectorId,
      acquisitionMode: job.acquisitionMode,
      capability: job.capability,
      execution: job.trigger,
      operation: job.operation,
      hasUserSession: true,
      hasApproval: job.approvalId !== null,
      network: networkForJob(job)
    });
    if (!policy.allowed) throw new Error(`policy_denied:${policy.reason}`);
  }
  const at = clock().toISOString();
  const queued = retryingRejectedWake
    ? job
    : await input.repositories.sourceJobs.transition(job.id, "queued", at);
  await input.repositories.activityEvents.append({
    id: randomUUID(),
    correlationId: input.correlationId,
    causationId: job.id,
    actor: "user",
    action: "operations.job_retry_queued",
    targetType: "source_job",
    targetId: job.id,
    policyDecision: "authorized",
    approvalId: job.approvalId,
    payloadHash: sha256Text(`operator-retry:v1:${job.id}:${job.attempts}`),
    outcome: "recorded",
    errorCategory: null,
    metadata: {
      previousStatus: job.status,
      retryKind: retryingRejectedWake ? "maritime_wake" : "source_job"
    },
    occurredAt: at
  });
  return queued;
}

export async function cancelSourceJob(input: {
  readonly repositories: UserRepositories;
  readonly jobId: string;
  readonly expectedRevision: number;
  readonly correlationId: string;
  readonly now?: () => Date;
}): Promise<SourceJob> {
  const job = await input.repositories.sourceJobs.getById(input.jobId);
  if (!job || job.attempts !== input.expectedRevision) throw new Error("job_revision_conflict");
  if (["completed", "permanently_failed", "cancelled_by_policy"].includes(job.status)) {
    throw new Error("unsafe_cancel");
  }
  const at = (input.now ?? (() => new Date()))().toISOString();
  const cancelled = await input.repositories.sourceJobs.transition(
    job.id,
    "cancelled_by_policy",
    at
  );
  await input.repositories.activityEvents.append({
    id: randomUUID(),
    correlationId: input.correlationId,
    causationId: job.id,
    actor: "user",
    action: "operations.job_cancelled_by_policy",
    targetType: "source_job",
    targetId: job.id,
    policyDecision: "denied",
    approvalId: job.approvalId,
    payloadHash: sha256Text(`operator-cancel:v1:${job.id}:${job.attempts}`),
    outcome: "recorded",
    errorCategory: null,
    metadata: { previousStatus: job.status },
    occurredAt: at
  });
  return cancelled;
}
