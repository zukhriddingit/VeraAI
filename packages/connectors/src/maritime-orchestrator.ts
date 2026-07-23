import { createHash } from "node:crypto";

import {
  AcquisitionModeSchema,
  ApprovalSchema,
  BrowserNodeStatusSchema,
  EntityIdSchema,
  ListingSourceLabelSchema,
  ManualActionRequiredSchema,
  SourceCapabilitySchema,
  SourceExecutionSchema,
  SourceJobPayloadSchema,
  SourceJobResultSchema,
  SourceJobSafeErrorSchema,
  SourceJobSchema,
  isBrowserNodeStale,
  transitionSourceJobStatus,
  type BrowserNodeStatus,
  type DeferredJobReason,
  type ManualActionRequired,
  type Approval,
  type SourceJob,
  type SourceJobResult,
  type SourceJobSafeError,
  type SourceJobStatus
} from "@vera/domain";
import type { SourcePolicyRegistry, SourcePolicyRequest } from "@vera/policy";
import { z } from "zod";

import {
  BrowserExecutionResultSchema,
  type BrowserExecutionProvider,
  type BrowserExecutionResult
} from "./browser-execution.ts";

export const ScheduleSourceJobInputSchema = z
  .object({
    id: EntityIdSchema,
    correlationId: EntityIdSchema,
    connectorId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    acquisitionMode: AcquisitionModeSchema,
    manifestVersion: z.number().int().positive(),
    trigger: SourceExecutionSchema,
    capability: SourceCapabilitySchema,
    operation: z.string().trim().min(1).max(160),
    payload: SourceJobPayloadSchema,
    maxAttempts: z.number().int().positive().max(100),
    approvalId: EntityIdSchema.nullable()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.acquisitionMode !== input.payload.acquisitionMode) {
      context.addIssue({
        code: "custom",
        path: ["payload", "acquisitionMode"],
        message: "Scheduled source-job payload mode must match its connector acquisition mode."
      });
    }
  });

export type ScheduleSourceJobInput = z.infer<typeof ScheduleSourceJobInputSchema>;

export interface MaritimeOrchestrator {
  scheduleConnectorJob(input: ScheduleSourceJobInput): Promise<SourceJob>;
  dispatchJob(jobId: string): Promise<SourceJob>;
  getJobStatus(jobId: string): Promise<SourceJob | null>;
  retryJob(jobId: string): Promise<SourceJob>;
  cancelByPolicy(jobId: string, reason: string): Promise<SourceJob>;
  receiveBrowserNodeHeartbeat(status: BrowserNodeStatus): Promise<BrowserNodeStatus>;
}

export interface SourceJobRuntimeAuthorizationProvider {
  isUserSessionAvailable(job: SourceJob): Promise<boolean>;
  getApprovalById(approvalId: string): Promise<Approval | null>;
}

interface SourceJobTransitionMetadata {
  readonly result?: SourceJobResult | null;
  readonly manualAction?: ManualActionRequired | null;
  readonly deferredReason?: DeferredJobReason | null;
  readonly attempts?: number;
}

const SafePolicyCancellationReasonSchema = z.string().trim().min(1).max(500);
const SafeRetryCategories = new Set<SourceJobSafeError["category"]>([
  "rate_limit",
  "transient_provider"
]);
const FailClosedRuntimeAuthorizationProvider: SourceJobRuntimeAuthorizationProvider = {
  async isUserSessionAvailable() {
    return false;
  },
  async getApprovalById() {
    return null;
  }
};

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) result[key] = canonicalize(entry);
    }
    return result;
  }
  throw new TypeError("Source-job hashing accepts only JSON-compatible values.");
}

function deterministicHash(namespace: string, value: unknown): string {
  return createHash("sha256")
    .update(`${namespace}:${JSON.stringify(canonicalize(value))}`, "utf8")
    .digest("hex");
}

function committedCursorFor(job: SourceJob) {
  return "committedCursor" in job.payload ? job.payload.committedCursor : null;
}

function sameCursor(
  left: ReturnType<typeof committedCursorFor>,
  right: ReturnType<typeof committedCursorFor>
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.value === right.value &&
      left.observedAt === right.observedAt)
  );
}

function deferredReasonFor(
  node: BrowserNodeStatus | undefined,
  now: Date
): DeferredJobReason | null {
  if (node === undefined) return "node_unregistered";
  if (node.status === "revoked") return "node_revoked";
  if (node.status === "offline") return "node_offline";
  if (node.status === "stale" || isBrowserNodeStale(node, now)) return "stale_heartbeat";
  return null;
}

function safeFailure(code: string, category: SourceJobSafeError["category"]): SourceJobSafeError {
  return SourceJobSafeErrorSchema.parse({ code, category });
}

export class SourceJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Source job ${jobId} was not found.`);
    this.name = "SourceJobNotFoundError";
  }
}

export class SourceJobDispatchError extends Error {
  constructor(jobId: string, status: SourceJobStatus) {
    super(`Source job ${jobId} cannot dispatch from ${status}.`);
    this.name = "SourceJobDispatchError";
  }
}

export class SourceJobRetryError extends Error {
  constructor(jobId: string, reason: string) {
    super(`Source job ${jobId} cannot retry: ${reason}.`);
    this.name = "SourceJobRetryError";
  }
}

export class LocalMockMaritimeOrchestrator implements MaritimeOrchestrator {
  readonly #jobs = new Map<string, SourceJob>();
  readonly #jobIdByIdempotencyKey = new Map<string, string>();
  readonly #nodes = new Map<string, BrowserNodeStatus>();
  readonly #resultsByIdempotencyKey = new Map<string, SourceJobResult>();

  constructor(
    private readonly policy: SourcePolicyRegistry,
    private readonly browser: BrowserExecutionProvider,
    private readonly now: () => Date,
    private readonly authorization: SourceJobRuntimeAuthorizationProvider = FailClosedRuntimeAuthorizationProvider
  ) {}

  async scheduleConnectorJob(inputValue: ScheduleSourceJobInput): Promise<SourceJob> {
    const input = ScheduleSourceJobInputSchema.parse(inputValue);
    const payloadHash = deterministicHash("vera-source-job-payload:v1", input.payload);
    const idempotencyKey = deterministicHash("vera-source-job-idempotency:v2", {
      connectorId: input.connectorId,
      acquisitionMode: input.acquisitionMode,
      manifestVersion: input.manifestVersion,
      trigger: input.trigger,
      capability: input.capability,
      approvalId: input.approvalId,
      operation: input.operation,
      payloadHash
    });

    const existingIdempotentJobId = this.#jobIdByIdempotencyKey.get(idempotencyKey);
    if (existingIdempotentJobId !== undefined) {
      return this.copyJob(this.requireJob(existingIdempotentJobId));
    }

    const existingJob = this.#jobs.get(input.id);
    if (existingJob !== undefined) {
      throw new Error(`Source job ${input.id} already exists with different immutable input.`);
    }

    const now = this.safeNowIso();
    const job = SourceJobSchema.parse({
      id: input.id,
      correlationId: input.correlationId,
      connectorId: input.connectorId,
      source: input.source,
      acquisitionMode: input.acquisitionMode,
      manifestVersion: input.manifestVersion,
      trigger: input.trigger,
      capability: input.capability,
      approvalId: input.approvalId,
      operation: input.operation,
      payload: input.payload,
      payloadHash,
      idempotencyKey,
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts,
      manualAction: null,
      deferredReason: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    });

    this.#jobs.set(job.id, job);
    this.#jobIdByIdempotencyKey.set(job.idempotencyKey, job.id);
    return this.copyJob(job);
  }

  async dispatchJob(jobIdValue: string): Promise<SourceJob> {
    const jobId = EntityIdSchema.parse(jobIdValue);
    const queued = this.requireJob(jobId);
    if (queued.status === "completed") return this.replayedJob(queued);
    if (queued.status !== "queued") throw new SourceJobDispatchError(queued.id, queued.status);

    if (!(await this.policyAllows(queued))) {
      return this.copyJob(this.transition(queued, "cancelled_by_policy"));
    }

    const dispatched = this.transition(queued, "dispatched", {
      attempts: queued.attempts + 1
    });

    if (
      dispatched.payload.acquisitionMode !== "local_browser" ||
      !("savedSearchUrl" in dispatched.payload)
    ) {
      return this.copyJob(
        this.failedJob(
          dispatched,
          "permanently_failed",
          safeFailure("mock_connector_execution_not_configured", "permanent_provider")
        )
      );
    }

    const node = this.#nodes.get(dispatched.payload.nodeId);
    const deferredReason = deferredReasonFor(node, this.safeNow());
    if (deferredReason !== null) {
      return this.copyJob(this.transition(dispatched, "deferred_node_offline", { deferredReason }));
    }

    return this.copyJob(await this.executeBrowserJob(dispatched));
  }

  async getJobStatus(jobIdValue: string): Promise<SourceJob | null> {
    const jobId = EntityIdSchema.parse(jobIdValue);
    const job = this.#jobs.get(jobId);
    return job === undefined ? null : this.copyJob(job);
  }

  async retryJob(jobIdValue: string): Promise<SourceJob> {
    const jobId = EntityIdSchema.parse(jobIdValue);
    const job = this.requireJob(jobId);
    if (
      !["retryable_failed", "deferred_node_offline", "manual_action_required"].includes(job.status)
    ) {
      throw new SourceJobRetryError(job.id, `state ${job.status} is not explicitly retryable`);
    }
    if (job.attempts >= job.maxAttempts) {
      throw new SourceJobRetryError(job.id, "the configured attempt limit is exhausted");
    }
    if (
      job.status === "retryable_failed" &&
      (job.result?.error === null ||
        job.result?.error === undefined ||
        !SafeRetryCategories.has(job.result.error.category))
    ) {
      throw new SourceJobRetryError(job.id, "the failure is not a safe transient class");
    }
    if (!(await this.policyAllows(job))) {
      return this.copyJob(this.transition(job, "cancelled_by_policy"));
    }

    return this.copyJob(
      this.transition(job, "queued", {
        result: null,
        manualAction: null,
        deferredReason: null
      })
    );
  }

  async cancelByPolicy(jobIdValue: string, reasonValue: string): Promise<SourceJob> {
    const jobId = EntityIdSchema.parse(jobIdValue);
    SafePolicyCancellationReasonSchema.parse(reasonValue);
    const job = this.requireJob(jobId);
    if (job.status === "cancelled_by_policy") return this.copyJob(job);
    return this.copyJob(this.transition(job, "cancelled_by_policy"));
  }

  async receiveBrowserNodeHeartbeat(statusValue: BrowserNodeStatus): Promise<BrowserNodeStatus> {
    const status = BrowserNodeStatusSchema.parse(statusValue);
    if (status.providerId !== this.browser.providerId) {
      throw new Error(
        `Browser node ${status.nodeId} belongs to provider ${status.providerId}, not ${this.browser.providerId}.`
      );
    }

    const current = this.#nodes.get(status.nodeId);
    if (current?.status === "revoked") return BrowserNodeStatusSchema.parse(current);
    if (
      current !== undefined &&
      Date.parse(status.lastHeartbeatAt) < Date.parse(current.lastHeartbeatAt)
    ) {
      return BrowserNodeStatusSchema.parse(current);
    }

    this.#nodes.set(status.nodeId, status);
    return BrowserNodeStatusSchema.parse(status);
  }

  private async executeBrowserJob(dispatched: SourceJob): Promise<SourceJob> {
    const payload = dispatched.payload;
    if (payload.acquisitionMode !== "local_browser" || !("savedSearchUrl" in payload)) {
      return this.failedJob(
        dispatched,
        "permanently_failed",
        safeFailure("mock_connector_execution_not_configured", "permanent_provider")
      );
    }

    let browserResult: BrowserExecutionResult;
    try {
      browserResult = BrowserExecutionResultSchema.parse(
        await this.browser.capture({
          nodeId: payload.nodeId,
          executionId: dispatched.id,
          correlationId: dispatched.correlationId,
          targetUrl: payload.savedSearchUrl,
          allowedUrls: [payload.savedSearchUrl],
          limits: payload.limits,
          committedCursor: payload.committedCursor
        })
      );
    } catch {
      return this.failedJob(
        dispatched,
        "permanently_failed",
        safeFailure("browser_provider_contract_rejected", "validation")
      );
    }

    if (!this.browserResultMatchesJob(browserResult, dispatched)) {
      return this.failedJob(
        dispatched,
        "permanently_failed",
        safeFailure("browser_provider_identity_mismatch", "validation")
      );
    }

    switch (browserResult.status) {
      case "completed": {
        const running = this.transition(dispatched, "running");
        const result = this.sourceJobResult(running, browserResult, "completed", null);
        this.#resultsByIdempotencyKey.set(result.idempotencyKey, result);
        return this.transition(running, "completed", { result });
      }
      case "manual_action_required": {
        if (browserResult.manualAction === null) {
          return this.failedJob(
            dispatched,
            "permanently_failed",
            safeFailure("browser_manual_action_missing", "validation")
          );
        }
        const manualAction = ManualActionRequiredSchema.parse({
          jobId: dispatched.id,
          nodeId: browserResult.nodeId,
          source: dispatched.source,
          blocker: browserResult.manualAction.blocker,
          instruction: browserResult.manualAction.instruction,
          correlationId: dispatched.correlationId,
          requiredAt: browserResult.manualAction.requiredAt
        });
        return this.transition(dispatched, "manual_action_required", { manualAction });
      }
      case "deferred_node_offline":
        if (browserResult.deferredReason === null) {
          return this.failedJob(
            dispatched,
            "permanently_failed",
            safeFailure("browser_deferred_reason_missing", "validation")
          );
        }
        return this.transition(dispatched, "deferred_node_offline", {
          deferredReason: browserResult.deferredReason
        });
      case "retryable_failed":
        if (
          browserResult.error === null ||
          !SafeRetryCategories.has(browserResult.error.category)
        ) {
          return this.failedJob(
            dispatched,
            "permanently_failed",
            browserResult.error ?? safeFailure("browser_failure_missing", "validation")
          );
        }
        return this.failedJob(dispatched, "retryable_failed", browserResult.error);
      case "permanently_failed":
        return this.failedJob(
          dispatched,
          "permanently_failed",
          browserResult.error ?? safeFailure("browser_failure_missing", "validation")
        );
      case "cancelled":
        return this.failedJob(
          dispatched,
          "permanently_failed",
          safeFailure("browser_execution_cancelled", "conflict")
        );
    }
  }

  private failedJob(
    job: SourceJob,
    status: "retryable_failed" | "permanently_failed",
    error: SourceJobSafeError
  ): SourceJob {
    const result = this.sourceJobResult(job, null, "failed", error);
    return this.transition(job, status, { result });
  }

  private sourceJobResult(
    job: SourceJob,
    browserResult: BrowserExecutionResult | null,
    status: "completed" | "failed",
    error: SourceJobSafeError | null
  ): SourceJobResult {
    const completedAt = browserResult?.completedAt ?? this.safeNowIso();
    const body = {
      jobId: job.id,
      connectorId: job.connectorId,
      source: job.source,
      acquisitionMode: job.acquisitionMode,
      operation: job.operation,
      status,
      correlationId: job.correlationId,
      payloadHash: job.payloadHash,
      idempotencyKey: job.idempotencyKey,
      recordCount: browserResult?.recordCount ?? 0,
      previousCursor: committedCursorFor(job),
      cursorCandidate: status === "completed" ? (browserResult?.cursorCandidate ?? null) : null,
      error,
      completedAt,
      untrustedInput: true as const
    };

    return SourceJobResultSchema.parse({
      ...body,
      resultHash: deterministicHash("vera-source-job-result:v1", body),
      idempotentReplay: false
    });
  }

  private browserResultMatchesJob(result: BrowserExecutionResult, job: SourceJob): boolean {
    return (
      result.providerId === this.browser.providerId &&
      job.payload.acquisitionMode === "local_browser" &&
      "committedCursor" in job.payload &&
      result.nodeId === job.payload.nodeId &&
      result.executionId === job.id &&
      result.operation === "capture" &&
      result.correlationId === job.correlationId &&
      sameCursor(result.previousCursor, job.payload.committedCursor)
    );
  }

  private async policyAllows(job: SourceJob): Promise<boolean> {
    const manifest = this.policy.getManifest(job.connectorId);
    if (
      manifest === null ||
      manifest.source !== job.source ||
      manifest.acquisitionMode !== job.acquisitionMode ||
      manifest.version !== job.manifestVersion
    ) {
      return false;
    }
    const runtimeAuthorization = await this.runtimeAuthorizationFor(job);
    const browserUrl =
      job.payload.acquisitionMode === "local_browser"
        ? "savedSearchUrl" in job.payload
          ? job.payload.savedSearchUrl
          : job.payload.expectedUrl
        : null;
    const network =
      browserUrl !== null
        ? {
            origin: new URL(browserUrl).origin,
            domain: new URL(browserUrl).hostname,
            httpMethod: "GET" as const
          }
        : null;
    const request: SourcePolicyRequest = {
      connectorId: job.connectorId,
      acquisitionMode: job.acquisitionMode,
      capability: job.capability,
      execution: job.trigger,
      operation: job.operation,
      hasUserSession: runtimeAuthorization.hasUserSession,
      hasApproval: runtimeAuthorization.hasApproval,
      network
    };
    const decision = this.policy.evaluate(request);
    return decision.allowed && decision.manifestVersion === job.manifestVersion;
  }

  private async runtimeAuthorizationFor(job: SourceJob): Promise<{
    readonly hasUserSession: boolean;
    readonly hasApproval: boolean;
  }> {
    try {
      const [hasUserSession, approvalInput] = await Promise.all([
        this.authorization.isUserSessionAvailable(job),
        job.approvalId === null
          ? Promise.resolve(null)
          : this.authorization.getApprovalById(job.approvalId)
      ]);
      const approvalResult = ApprovalSchema.safeParse(approvalInput);
      const approval = approvalResult.success ? approvalResult.data : null;
      const authorizationTime = this.safeNow().getTime();
      const hasApproval =
        approval !== null &&
        job.approvalId !== null &&
        approval.id === job.approvalId &&
        approval.state === "pending" &&
        approval.usedAt === null &&
        Date.parse(approval.createdAt) <= authorizationTime &&
        Date.parse(approval.expiresAt) > authorizationTime &&
        approval.connectorId === job.connectorId &&
        approval.operation === job.operation &&
        approval.payloadHash === job.payloadHash &&
        approval.targetType === "source_job" &&
        approval.targetId === job.id;

      return { hasUserSession: hasUserSession === true, hasApproval };
    } catch {
      return { hasUserSession: false, hasApproval: false };
    }
  }

  private transition(
    job: SourceJob,
    requested: SourceJobStatus,
    metadata: SourceJobTransitionMetadata = {}
  ): SourceJob {
    const status = transitionSourceJobStatus(job.status, requested);
    const updatedAt = this.safeNowIso();
    const terminal = ["completed", "permanently_failed", "cancelled_by_policy"].includes(status);
    const transitioned = SourceJobSchema.parse({
      ...job,
      status,
      attempts: metadata.attempts ?? job.attempts,
      manualAction: metadata.manualAction ?? null,
      deferredReason: metadata.deferredReason ?? null,
      result: metadata.result ?? null,
      updatedAt,
      completedAt: terminal ? updatedAt : null
    });
    this.#jobs.set(transitioned.id, transitioned);
    return transitioned;
  }

  private replayedJob(job: SourceJob): SourceJob {
    const result = this.#resultsByIdempotencyKey.get(job.idempotencyKey) ?? job.result;
    if (result === null) {
      throw new Error(`Completed source job ${job.id} is missing its immutable result.`);
    }
    return SourceJobSchema.parse({
      ...job,
      result: { ...result, idempotentReplay: true }
    });
  }

  private requireJob(jobId: string): SourceJob {
    const job = this.#jobs.get(jobId);
    if (job === undefined) throw new SourceJobNotFoundError(jobId);
    return job;
  }

  private copyJob(job: SourceJob): SourceJob {
    return SourceJobSchema.parse(job);
  }

  private safeNow(): Date {
    const now = this.now();
    if (Number.isNaN(now.getTime())) throw new RangeError("Maritime mock clock is invalid.");
    return now;
  }

  private safeNowIso(): string {
    return this.safeNow().toISOString();
  }
}
