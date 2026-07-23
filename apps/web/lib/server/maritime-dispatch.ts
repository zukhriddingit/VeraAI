import { randomUUID } from "node:crypto";

import {
  createMaritimeControlPlaneClient,
  MaritimeControlPlaneError,
  ProductionMaritimeOrchestrator,
  type MaritimeControlPlaneClient,
  type ProductionOrchestrationStore
} from "@vera/connectors";
import { sha256Text, type UserRepositories } from "@vera/db";
import {
  ActivityEventSchema,
  requireFounderBrowserAccess,
  type SourceJob,
  type VeraUserId
} from "@vera/domain";
import {
  evaluateCurrentTabCapturePolicy,
  SourcePolicyRegistry,
  ZILLOW_CURRENT_TAB_MANIFEST
} from "@vera/policy";
import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";

function activeKillSwitches(
  environment: Readonly<Record<string, string | undefined>>
): ReadonlySet<string> {
  return new Set(
    (environment.VERA_ACTIVE_KILL_SWITCHES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function orchestrationStore(
  userId: VeraUserId,
  repositories: UserRepositories
): ProductionOrchestrationStore {
  return {
    userId,
    enqueueJob: (job) => repositories.sourceJobs.enqueue(job),
    getJob: (id) => repositories.sourceJobs.getById(id),
    transitionJob: (id, requested, at) => repositories.sourceJobs.transition(id, requested, at),
    createDispatch: (dispatch) => repositories.maritimeDispatches.create(dispatch),
    transitionDispatch: (id, expected, requested, at, patch) =>
      repositories.maritimeDispatches.transition(id, expected, requested, at, patch),
    upsertNode: (node) => repositories.browserNodes.upsert(node)
  };
}

async function audit(
  repositories: UserRepositories,
  job: SourceJob,
  action: "browser.dispatched" | "browser.dispatch_failed",
  at: string,
  safeCode: string | null
): Promise<void> {
  const errorCategory =
    safeCode === null
      ? null
      : safeCode === "maritime_authentication_error"
        ? "authentication"
        : safeCode === "maritime_rate_limited"
          ? "rate_limit"
          : safeCode === "maritime_unavailable"
            ? "transient_provider"
            : "permanent_provider";
  await repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: randomUUID(),
      correlationId: job.correlationId,
      causationId: job.id,
      actor: "system",
      action,
      targetType: "source_job",
      targetId: job.id,
      policyDecision: "authorized",
      approvalId: job.approvalId,
      payloadHash: sha256Text(`maritime-dispatch-audit:v1:${job.id}:${action}:${safeCode ?? "ok"}`),
      outcome: action === "browser.dispatched" ? "recorded" : "failed",
      errorCategory,
      metadata: {
        executionPlane: "maritime",
        ...(safeCode === null ? {} : { safeCode })
      },
      occurredAt: at
    })
  );
}

export interface DispatchHostedSourceJobDependencies {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly client?: MaritimeControlPlaneClient;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly createNonce?: () => string;
}

/**
 * Wakes Maritime with an agent identifier only. Listing data remains in PostgreSQL
 * and is claimed by the worker from an accepted, expiring dispatch record.
 */
export async function dispatchHostedSourceJob(
  dependencies: DispatchHostedSourceJobDependencies,
  jobId: string
): Promise<SourceJob> {
  const environment = dependencies.environment ?? process.env;
  const runtimePolicy = parseHostedRuntimePolicy(environment);
  requireFounderBrowserAccess(dependencies.userId, environment.VERA_BROWSER_FOUNDER_USER_IDS);
  const workerAgentId = environment.VERA_MARITIME_WORKER_AGENT_ID?.trim();
  if (!workerAgentId) {
    throw new MaritimeControlPlaneError("maritime_configuration_error", false);
  }
  const job = await dependencies.repositories.sourceJobs.getById(jobId);
  if (!job) throw new Error("source_job_not_found");
  if (
    job.connectorId !== ZILLOW_CURRENT_TAB_MANIFEST.connectorId ||
    job.payload.acquisitionMode !== "local_browser" ||
    job.payload.captureKind !== "current_tab"
  ) {
    throw new Error("unsupported_hosted_dispatch");
  }

  const clock = dependencies.now ?? (() => new Date());
  const [control, node, profile, approval] = await Promise.all([
    dependencies.repositories.browserIntegrationControls.get(),
    dependencies.repositories.browserNodes.getById(job.payload.nodeId),
    dependencies.repositories.browserProfileControls.get(job.payload.nodeId, job.payload.profileId),
    job.approvalId === null
      ? Promise.resolve(null)
      : dependencies.repositories.approvals.getById(job.approvalId)
  ]);
  const approvalIsCurrent =
    approval !== null &&
    approval.state === "used" &&
    approval.connectorId === job.connectorId &&
    approval.operation === job.operation &&
    approval.targetType === "source_job" &&
    approval.targetId === job.id &&
    approval.payloadHash === job.payloadHash &&
    approval.usedAt !== null &&
    Date.parse(approval.expiresAt) > clock().getTime();
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
    hasApproval: approvalIsCurrent
  });
  if (!decision.allowed) throw new Error(`policy_denied:${decision.reason}`);

  // The founder-only browser connector is disabled at rest. This boundary just
  // revalidated the exact user, node, profile, URL, approval, and active kill switches;
  // activation may only flip `enabled` for the generic policy check below.
  const policy = new SourcePolicyRegistry([{ ...ZILLOW_CURRENT_TAB_MANIFEST, enabled: true }], {
    activeKillSwitches: activeKillSwitches(environment)
  });
  const orchestrator = new ProductionMaritimeOrchestrator({
    store: orchestrationStore(dependencies.userId, dependencies.repositories),
    policy,
    client:
      dependencies.client ?? createMaritimeControlPlaneClient(environment as NodeJS.ProcessEnv),
    workerAgentId,
    now: clock,
    id: dependencies.createId ?? randomUUID,
    nonce: dependencies.createNonce ?? randomUUID,
    authorization: {
      async isUserSessionAvailable(candidate) {
        return candidate.id === job.id;
      },
      getApprovalById: (approvalId) => dependencies.repositories.approvals.getById(approvalId)
    }
  });

  try {
    const dispatched = await orchestrator.dispatchJob(job.id);
    await audit(
      dependencies.repositories,
      dispatched,
      "browser.dispatched",
      clock().toISOString(),
      null
    );
    return dispatched;
  } catch (error: unknown) {
    const safeCode =
      error instanceof MaritimeControlPlaneError ? error.code : "maritime_unavailable";
    await audit(
      dependencies.repositories,
      job,
      "browser.dispatch_failed",
      clock().toISOString(),
      safeCode
    );
    throw error;
  }
}
