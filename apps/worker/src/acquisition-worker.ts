import {
  BrowserCurrentTabCaptureRequestSchema,
  BrowserCurrentTabCaptureResultSchema,
  type BrowserExecutionProvider
} from "@vera/connectors";
import {
  acceptBrowserCapture,
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  ManualActionRequiredSchema,
  evaluateFounderBrowserAccess,
  isBrowserNodeStale,
  type DeferredJobReason,
  type JobAttempt,
  type ManualActionBlocker,
  type SourceJob,
  type SourceJobSafeError,
  type VeraUserId
} from "@vera/domain";
import { evaluateCurrentTabCapturePolicy } from "@vera/policy";

export const ACQUISITION_LEASE_DURATION_MILLISECONDS = 60_000;

export interface AcquisitionWorkerDependencies {
  readonly userId: VeraUserId;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly repositories: UserRepositories;
  readonly claimedJob: SourceJob;
  readonly provider: BrowserExecutionProvider | null;
  readonly founderBrowserUserIds: string | undefined;
  readonly systemBrowserDisabled: boolean;
  now(): Date;
  createId(): string;
}

export type AcquisitionWorkerResult =
  | { readonly status: "idle" }
  | { readonly status: "completed"; readonly jobId: string; readonly rawListingId: string }
  | { readonly status: "cancelled_by_policy"; readonly jobId: string; readonly reason: string }
  | {
      readonly status: "deferred_node_offline";
      readonly jobId: string;
      readonly reason: DeferredJobReason;
    }
  | {
      readonly status: "manual_action_required";
      readonly jobId: string;
      readonly blocker: ManualActionBlocker;
    }
  | {
      readonly status: "retryable_failed" | "permanently_failed";
      readonly jobId: string;
      readonly errorCode: string;
    };

function safeNow(dependencies: AcquisitionWorkerDependencies): string {
  const value = dependencies.now();
  if (Number.isNaN(value.getTime())) throw new Error("Acquisition worker clock is invalid.");
  return value.toISOString();
}

async function appendAttempt(
  dependencies: AcquisitionWorkerDependencies,
  job: SourceJob,
  attemptId: string,
  startedAt: string,
  completedAt: string,
  outcomeStatus: JobAttempt["outcomeStatus"],
  error: SourceJobSafeError | null,
  deferredReason: DeferredJobReason | null
): Promise<JobAttempt> {
  return dependencies.repositories.sourceJobAttempts.append({
    id: attemptId,
    sourceJobId: job.id,
    attemptNumber: job.attempts,
    startedAt,
    completedAt,
    outcomeStatus,
    error,
    deferredReason,
    correlationId: job.correlationId,
    payloadHash: job.payloadHash
  });
}

async function audit(
  dependencies: AcquisitionWorkerDependencies,
  job: SourceJob,
  action: string,
  outcome: "authorized" | "denied" | "succeeded" | "failed",
  errorCategory: SourceJobSafeError["category"] | null,
  metadata: Readonly<Record<string, string | number | boolean | null>>,
  occurredAt: string
): Promise<void> {
  await dependencies.repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: dependencies.createId(),
      correlationId: job.correlationId,
      causationId: job.id,
      actor: "system",
      action,
      targetType: "source_job",
      targetId: job.id,
      policyDecision: outcome === "denied" ? "denied" : "authorized",
      approvalId: job.approvalId,
      payloadHash: job.payloadHash,
      outcome,
      errorCategory,
      metadata,
      occurredAt
    })
  );
}

async function defer(
  dependencies: AcquisitionWorkerDependencies,
  job: SourceJob,
  attemptId: string,
  startedAt: string,
  reason: DeferredJobReason
): Promise<AcquisitionWorkerResult> {
  const at = safeNow(dependencies);
  await appendAttempt(
    dependencies,
    job,
    attemptId,
    startedAt,
    at,
    "deferred_node_offline",
    null,
    reason
  );
  await dependencies.repositories.sourceJobs.transition(job.id, "deferred_node_offline", at, {
    attempts: job.attempts,
    deferredReason: reason
  });
  await audit(
    dependencies,
    job,
    "browser.deferred_offline",
    "failed",
    "transient_provider",
    { reason },
    at
  );
  return { status: "deferred_node_offline", jobId: job.id, reason };
}

async function manual(
  dependencies: AcquisitionWorkerDependencies,
  job: SourceJob,
  attemptId: string,
  startedAt: string,
  blocker: ManualActionBlocker,
  instruction: string
): Promise<AcquisitionWorkerResult> {
  const at = safeNow(dependencies);
  await appendAttempt(
    dependencies,
    job,
    attemptId,
    startedAt,
    at,
    "manual_action_required",
    null,
    null
  );
  await dependencies.repositories.sourceJobs.transition(job.id, "manual_action_required", at, {
    attempts: job.attempts,
    manualAction: ManualActionRequiredSchema.parse({
      jobId: job.id,
      nodeId:
        job.payload.acquisitionMode === "local_browser" ? job.payload.nodeId : "unavailable-node",
      source: job.source,
      blocker,
      instruction,
      correlationId: job.correlationId,
      requiredAt: at
    })
  });
  await audit(
    dependencies,
    job,
    "browser.manual_action_required",
    "failed",
    "manual_action_required",
    { blocker },
    at
  );
  return { status: "manual_action_required", jobId: job.id, blocker };
}

async function cancelByPolicy(
  dependencies: AcquisitionWorkerDependencies,
  job: SourceJob,
  attemptId: string,
  startedAt: string,
  reason: string
): Promise<AcquisitionWorkerResult> {
  const at = safeNow(dependencies);
  await appendAttempt(
    dependencies,
    job,
    attemptId,
    startedAt,
    at,
    "cancelled_by_policy",
    null,
    null
  );
  await dependencies.repositories.sourceJobs.transition(job.id, "cancelled_by_policy", at, {
    attempts: job.attempts
  });
  await audit(dependencies, job, "browser.policy_rejected", "denied", null, { reason }, at);
  return { status: "cancelled_by_policy", jobId: job.id, reason };
}

export async function processNextAcquisitionJob(
  dependencies: AcquisitionWorkerDependencies,
  signal: AbortSignal
): Promise<AcquisitionWorkerResult> {
  if (signal.aborted) return { status: "idle" };
  const job = dependencies.claimedJob;
  const startedAt = safeNow(dependencies);
  const attemptId = dependencies.createId();

  if (
    job.status !== "running" ||
    job.trigger !== "manual" ||
    job.connectorId !== "zillow.current-tab.v1" ||
    job.operation !== "capture.current_tab" ||
    job.payload.acquisitionMode !== "local_browser" ||
    job.payload.captureKind !== "current_tab"
  ) {
    return cancelByPolicy(dependencies, job, attemptId, startedAt, "unsupported_source_job");
  }

  const founderAccess = evaluateFounderBrowserAccess(
    dependencies.userId,
    dependencies.founderBrowserUserIds
  );
  if (!founderAccess.allowed) {
    return cancelByPolicy(dependencies, job, attemptId, startedAt, founderAccess.code);
  }

  const [control, node, profile, approval] = await Promise.all([
    dependencies.repositories.browserIntegrationControls.get(),
    dependencies.repositories.browserNodes.getById(job.payload.nodeId),
    dependencies.repositories.browserProfileControls.get(job.payload.nodeId, job.payload.profileId),
    job.approvalId === null
      ? Promise.resolve(null)
      : dependencies.repositories.approvals.getById(job.approvalId)
  ]);
  const approvalValid =
    approval !== null &&
    approval.state === "used" &&
    approval.connectorId === job.connectorId &&
    approval.operation === job.operation &&
    approval.targetType === "source_job" &&
    approval.targetId === job.id &&
    approval.payloadHash === job.payloadHash &&
    approval.usedAt !== null &&
    Date.parse(approval.usedAt) <= Date.parse(startedAt) &&
    Date.parse(approval.expiresAt) > Date.parse(startedAt);
  const decision = evaluateCurrentTabCapturePolicy({
    expectedUrl: job.payload.expectedUrl,
    profileId: job.payload.profileId,
    node,
    controls: {
      systemBrowserDisabled: dependencies.systemBrowserDisabled,
      userBrowserEnabled: control.userBrowserEnabled,
      zillowSourceEnabled: control.zillowSourceEnabled,
      nodeDisabled: node?.disabledAt !== null && node?.disabledAt !== undefined,
      profileDisabled: profile === null || profile.disabledAt !== null
    },
    hasUserSession: true,
    hasApproval: approvalValid
  });
  if (!decision.allowed) {
    if (decision.reason === "node_not_owned") {
      return defer(dependencies, job, attemptId, startedAt, "node_unregistered");
    }
    return cancelByPolicy(dependencies, job, attemptId, startedAt, decision.reason);
  }
  await audit(
    dependencies,
    job,
    "browser.policy_approved",
    "authorized",
    null,
    { connectorId: job.connectorId },
    startedAt
  );

  if (!node) return defer(dependencies, job, attemptId, startedAt, "node_unregistered");
  if (node.status === "revoked")
    return defer(dependencies, job, attemptId, startedAt, "node_revoked");
  if (node.status === "offline")
    return defer(dependencies, job, attemptId, startedAt, "node_offline");
  if (node.status === "stale" || isBrowserNodeStale(node, dependencies.now())) {
    return defer(dependencies, job, attemptId, startedAt, "stale_heartbeat");
  }
  if (node.pairingState !== "paired") {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "node_pairing_required",
      "Approve the OpenClaw device and node pairing, then retry."
    );
  }
  if (node.capabilityApprovalState !== "approved") {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "capability_approval_required",
      "Approve only the browser.proxy capability, then retry."
    );
  }
  if (node.versionCompatibility !== "compatible") {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "version_incompatible",
      "Run the tested OpenClaw 2026.6.33 release before retrying."
    );
  }
  if (!dependencies.provider) {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "policy_uncertain",
      "Configure the server-side OpenClaw gateway endpoint and token, then retry."
    );
  }

  const invocationIdempotencyKey = sha256Text(
    `openclaw-current-tab:v1:${job.id}:${job.payloadHash}:${job.payload.nodeId}:${job.payload.profileId}`
  );
  const request = BrowserCurrentTabCaptureRequestSchema.parse({
    nodeId: job.payload.nodeId,
    profileId: job.payload.profileId,
    executionId: `execution-${job.id}`,
    correlationId: job.correlationId,
    expectedUrl: job.payload.expectedUrl,
    canonicalUrl: job.payload.canonicalUrl,
    invocationIdempotencyKey,
    requestedAt: startedAt,
    limits: job.payload.limits
  });
  await audit(
    dependencies,
    job,
    "browser.capture_requested",
    "authorized",
    null,
    { providerId: dependencies.provider.providerId },
    startedAt
  );
  const result = BrowserCurrentTabCaptureResultSchema.parse(
    await dependencies.provider.captureCurrentTab(request)
  );
  if (
    result.nodeId !== request.nodeId ||
    result.profileId !== request.profileId ||
    result.executionId !== request.executionId ||
    result.correlationId !== request.correlationId
  ) {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "policy_uncertain",
      "The browser result identity did not match the approved job. Inspect the node before retrying."
    );
  }

  if (result.status === "deferred_node_offline") {
    return defer(dependencies, job, attemptId, startedAt, result.deferredReason ?? "node_offline");
  }
  if (result.status === "manual_action_required" && result.manualAction) {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      result.manualAction.blocker,
      result.manualAction.instruction
    );
  }
  if (result.status === "retryable_failed" || result.status === "permanently_failed") {
    const error = result.error ?? {
      code: "openclaw_unknown_failure",
      category: "internal" as const
    };
    const at = safeNow(dependencies);
    await appendAttempt(dependencies, job, attemptId, startedAt, at, result.status, error, null);
    await dependencies.repositories.sourceJobs.transition(job.id, result.status, at, {
      attempts: job.attempts,
      result: {
        jobId: job.id,
        connectorId: job.connectorId,
        source: job.source,
        acquisitionMode: job.acquisitionMode,
        operation: job.operation,
        status: "failed",
        correlationId: job.correlationId,
        payloadHash: job.payloadHash,
        idempotencyKey: job.idempotencyKey,
        resultHash: sha256Text(canonicalJson(result)),
        recordCount: 0,
        previousCursor: null,
        cursorCandidate: null,
        error,
        capture: null,
        completedAt: at,
        idempotentReplay: false,
        untrustedInput: true
      }
    });
    await audit(
      dependencies,
      job,
      "browser.capture_failed",
      "failed",
      error.category,
      { code: error.code },
      at
    );
    return { status: result.status, jobId: job.id, errorCode: error.code };
  }
  if (result.status !== "completed" || !result.evidence) {
    return manual(
      dependencies,
      job,
      attemptId,
      startedAt,
      "policy_uncertain",
      "The browser returned no acceptable result. Inspect the node before retrying."
    );
  }

  const completedAt = result.completedAt;
  await appendAttempt(
    dependencies,
    job,
    attemptId,
    startedAt,
    completedAt,
    "completed",
    null,
    null
  );
  const resultHash = sha256Text(canonicalJson(result));
  const accepted = await acceptBrowserCapture(
    dependencies.repositoryProvider,
    dependencies.userId,
    {
      sourceJobId: job.id,
      attemptId,
      nodeId: result.nodeId,
      profileId: result.profileId,
      payloadHash: job.payloadHash,
      invocationIdempotencyKey,
      resultHash,
      contentHash: result.evidence.contentHash,
      canonicalUrl: result.evidence.canonicalUrl,
      pageTitle: result.evidence.pageTitle,
      renderedText: result.evidence.renderedText,
      structuredMetadata: result.evidence.structuredMetadata,
      observedAt: result.evidence.observedAt,
      acceptedAt: completedAt
    }
  );
  return { status: "completed", jobId: job.id, rawListingId: accepted.rawListing.id };
}
