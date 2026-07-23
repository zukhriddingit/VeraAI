import { createHash } from "node:crypto";

import {
  BrowserNodeStatusSchema,
  MaritimeDispatchSchema,
  SourceJobSchema,
  transitionSourceJobStatus,
  type BrowserNodeStatus,
  type MaritimeDispatch,
  type MaritimeDispatchState,
  type SourceJob,
  type SourceJobStatus,
  type VeraUserId
} from "@vera/domain";
import type { SourcePolicyRegistry, SourcePolicyRequest } from "@vera/policy";

import type { MaritimeControlPlaneClient } from "./maritime-client.ts";
import {
  ScheduleSourceJobInputSchema,
  SourceJobDispatchError,
  SourceJobNotFoundError,
  SourceJobRetryError,
  type MaritimeOrchestrator,
  type ScheduleSourceJobInput,
  type SourceJobRuntimeAuthorizationProvider
} from "./maritime-orchestrator.ts";

export interface ProductionOrchestrationStore {
  readonly userId: VeraUserId;
  enqueueJob(job: SourceJob): Promise<{ readonly record: SourceJob; readonly inserted: boolean }>;
  getJob(id: string): Promise<SourceJob | null>;
  transitionJob(id: string, requested: SourceJobStatus, at: string): Promise<SourceJob>;
  createDispatch(dispatch: MaritimeDispatch): Promise<MaritimeDispatch>;
  transitionDispatch(
    id: string,
    expected: MaritimeDispatchState,
    requested: MaritimeDispatchState,
    at: string,
    patch?: { readonly maritimeRunId?: string | null; readonly rejectionCode?: string | null }
  ): Promise<MaritimeDispatch>;
  upsertNode(node: BrowserNodeStatus): Promise<BrowserNodeStatus>;
}

export interface ProductionMaritimeOrchestratorOptions {
  readonly store: ProductionOrchestrationStore;
  readonly policy: SourcePolicyRegistry;
  readonly client: MaritimeControlPlaneClient;
  readonly workerAgentId: string;
  readonly now: () => Date;
  readonly id: () => string;
  readonly nonce: () => string;
  readonly authorization?: SourceJobRuntimeAuthorizationProvider;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  throw new TypeError("Production job hashing accepts only JSON-compatible values.");
}

function hash(namespace: string, value: unknown): string {
  return createHash("sha256")
    .update(`${namespace}:${JSON.stringify(canonicalize(value))}`, "utf8")
    .digest("hex");
}

const FAIL_CLOSED_AUTHORIZATION: SourceJobRuntimeAuthorizationProvider = {
  async isUserSessionAvailable() {
    return false;
  },
  async getApprovalById() {
    return null;
  }
};

export class ProductionMaritimeOrchestrator implements MaritimeOrchestrator {
  readonly #authorization: SourceJobRuntimeAuthorizationProvider;

  constructor(private readonly options: ProductionMaritimeOrchestratorOptions) {
    this.#authorization = options.authorization ?? FAIL_CLOSED_AUTHORIZATION;
  }

  async scheduleConnectorJob(inputValue: ScheduleSourceJobInput): Promise<SourceJob> {
    const input = ScheduleSourceJobInputSchema.parse(inputValue);
    const now = this.safeNow();
    const payloadHash = hash("vera-source-job-payload:v1", input.payload);
    const idempotencyKey = hash("vera-source-job-idempotency:v2", {
      connectorId: input.connectorId,
      acquisitionMode: input.acquisitionMode,
      manifestVersion: input.manifestVersion,
      trigger: input.trigger,
      capability: input.capability,
      approvalId: input.approvalId,
      operation: input.operation,
      payloadHash
    });
    const job = SourceJobSchema.parse({
      ...input,
      payloadHash,
      idempotencyKey,
      status: "queued",
      attempts: 0,
      manualAction: null,
      deferredReason: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    });
    return (await this.options.store.enqueueJob(job)).record;
  }

  async dispatchJob(jobId: string): Promise<SourceJob> {
    const job = await this.requireJob(jobId);
    if (job.status === "completed" || job.status === "dispatched") return job;
    if (job.status !== "queued") throw new SourceJobDispatchError(job.id, job.status);
    if (!(await this.policyAllows(job))) {
      return this.options.store.transitionJob(job.id, "cancelled_by_policy", this.safeNow());
    }

    const issuedAt = this.safeNow();
    const expiresAt = new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString();
    const dispatch = MaritimeDispatchSchema.parse({
      id: this.options.id(),
      userId: this.options.store.userId,
      sourceJobId: job.id,
      issuer: "vera-control-plane",
      audience: this.options.workerAgentId,
      nonceHash: hash("vera-maritime-dispatch-nonce:v1", this.options.nonce()),
      payloadHash: job.payloadHash,
      state: "pending_wake",
      maritimeAgentId: this.options.workerAgentId,
      maritimeRunId: null,
      issuedAt,
      expiresAt,
      acceptedAt: null,
      consumedAt: null,
      rejectedAt: null,
      rejectionCode: null,
      createdAt: issuedAt,
      updatedAt: issuedAt
    });
    await this.options.store.createDispatch(dispatch);
    try {
      await this.options.client.wake(this.options.workerAgentId);
      await this.options.store.transitionDispatch(
        dispatch.id,
        "pending_wake",
        "accepted",
        this.safeNow()
      );
      return this.options.store.transitionJob(job.id, "dispatched", this.safeNow());
    } catch (error: unknown) {
      const rejectionCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "maritime_unavailable";
      await this.options.store.transitionDispatch(
        dispatch.id,
        "pending_wake",
        "rejected",
        this.safeNow(),
        { rejectionCode }
      );
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<SourceJob | null> {
    return this.options.store.getJob(jobId);
  }

  async retryJob(jobId: string): Promise<SourceJob> {
    const job = await this.requireJob(jobId);
    if (
      !["retryable_failed", "deferred_node_offline", "manual_action_required"].includes(job.status)
    ) {
      throw new SourceJobRetryError(job.id, `state ${job.status} is not retryable`);
    }
    if (job.attempts >= job.maxAttempts)
      throw new SourceJobRetryError(job.id, "attempt limit exhausted");
    if (!(await this.policyAllows(job))) {
      return this.options.store.transitionJob(job.id, "cancelled_by_policy", this.safeNow());
    }
    transitionSourceJobStatus(job.status, "queued");
    return this.options.store.transitionJob(job.id, "queued", this.safeNow());
  }

  async cancelByPolicy(jobId: string, _reason: string): Promise<SourceJob> {
    const job = await this.requireJob(jobId);
    if (job.status === "cancelled_by_policy") return job;
    transitionSourceJobStatus(job.status, "cancelled_by_policy");
    return this.options.store.transitionJob(job.id, "cancelled_by_policy", this.safeNow());
  }

  async receiveBrowserNodeHeartbeat(input: BrowserNodeStatus): Promise<BrowserNodeStatus> {
    return this.options.store.upsertNode(BrowserNodeStatusSchema.parse(input));
  }

  private async requireJob(id: string): Promise<SourceJob> {
    const job = await this.options.store.getJob(id);
    if (!job) throw new SourceJobNotFoundError(id);
    return job;
  }

  private safeNow(): string {
    const now = this.options.now();
    if (Number.isNaN(now.getTime()))
      throw new Error("Maritime orchestration requires a valid clock.");
    return now.toISOString();
  }

  private async policyAllows(job: SourceJob): Promise<boolean> {
    const manifest = this.options.policy.getManifest(job.connectorId);
    if (
      !manifest ||
      manifest.source !== job.source ||
      manifest.acquisitionMode !== job.acquisitionMode ||
      manifest.version !== job.manifestVersion
    ) {
      return false;
    }
    const [hasUserSession, approval] = await Promise.all([
      this.#authorization.isUserSessionAvailable(job),
      job.approvalId === null
        ? Promise.resolve(null)
        : this.#authorization.getApprovalById(job.approvalId)
    ]);
    const now = Date.parse(this.safeNow());
    const hasApproval =
      approval !== null &&
      approval.state === "used" &&
      approval.connectorId === job.connectorId &&
      approval.operation === job.operation &&
      approval.targetType === "source_job" &&
      approval.targetId === job.id &&
      approval.payloadHash === job.payloadHash &&
      approval.usedAt !== null &&
      Date.parse(approval.createdAt) <= Date.parse(approval.usedAt) &&
      Date.parse(approval.usedAt) <= now &&
      Date.parse(approval.expiresAt) > now;
    const browserUrl =
      job.payload.acquisitionMode === "local_browser"
        ? "savedSearchUrl" in job.payload
          ? job.payload.savedSearchUrl
          : job.payload.expectedUrl
        : null;
    const browserLocation = browserUrl === null ? null : new URL(browserUrl);
    const request: SourcePolicyRequest = {
      connectorId: job.connectorId,
      acquisitionMode: job.acquisitionMode,
      capability: job.capability,
      execution: job.trigger,
      operation: job.operation,
      hasUserSession,
      hasApproval,
      network:
        browserLocation === null
          ? null
          : {
              origin: `${browserLocation.origin}/`,
              domain: browserLocation.hostname,
              httpMethod: "GET"
            }
    };
    const decision = this.options.policy.evaluate(request);
    return decision.allowed && decision.manifestVersion === job.manifestVersion;
  }
}
