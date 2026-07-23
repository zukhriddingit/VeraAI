import type { MaritimeDispatch, SourceJob, VeraUserId } from "@vera/domain";
import { SourcePolicyRegistry, ZILLOW_CURRENT_TAB_MANIFEST } from "@vera/policy";
import { describe, expect, it, vi } from "vitest";

import type { MaritimeControlPlaneClient } from "./maritime-client.ts";
import {
  ProductionMaritimeOrchestrator,
  type ProductionOrchestrationStore
} from "./production-maritime-orchestrator.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const NOW = new Date("2026-07-22T12:00:00.000Z");

function manifest(enabled = true) {
  return {
    schemaVersion: 2 as const,
    connectorId: "fixture.feed.v1",
    displayName: "Fixture feed",
    version: 1,
    source: "other" as const,
    acquisitionMode: "fixture" as const,
    policyState: enabled ? ("approved" as const) : ("disabled" as const),
    enabled,
    execution: "manual" as const,
    capabilities: ["fixture.read" as const],
    allowedOperations: ["fixture.read_sanitized"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: false,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.fixture.disabled",
    dataClassification: "synthetic" as const,
    redactionRules: ["raw_content_from_logs" as const],
    manualBlockerBehavior: "stop_and_request_user_action" as const,
    owner: "Vera maintainers",
    reviewedAt: "2026-07-22",
    decisionRecord: "docs/DECISIONS/0011-maritime-production-execution.md",
    notes: "Sanitized fixture only.",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString()
  };
}

function memoryStore(
  options: {
    readonly onDispatchTransition?: (dispatch: MaritimeDispatch) => void;
  } = {}
): ProductionOrchestrationStore {
  const jobs = new Map<string, SourceJob>();
  const dispatches = new Map<string, MaritimeDispatch>();
  return {
    userId: USER_ID,
    async enqueueJob(job) {
      const prior = [...jobs.values()].find(
        (candidate) => candidate.idempotencyKey === job.idempotencyKey
      );
      if (prior) return { record: prior, inserted: false };
      jobs.set(job.id, job);
      return { record: job, inserted: true };
    },
    async getJob(id) {
      return jobs.get(id) ?? null;
    },
    async transitionJob(id, requested, at) {
      const job = jobs.get(id);
      if (!job) throw new Error("missing job");
      const next = {
        ...job,
        status: requested,
        updatedAt: at,
        completedAt: requested === "cancelled_by_policy" ? at : null
      } as SourceJob;
      jobs.set(id, next);
      return next;
    },
    async createDispatch(dispatch) {
      dispatches.set(dispatch.id, dispatch);
      return dispatch;
    },
    async transitionDispatch(id, expected, requested, at, patch) {
      const dispatch = dispatches.get(id);
      if (!dispatch || dispatch.state !== expected) throw new Error("dispatch conflict");
      const next = {
        ...dispatch,
        state: requested,
        maritimeRunId: patch?.maritimeRunId ?? dispatch.maritimeRunId,
        acceptedAt: requested === "accepted" ? at : dispatch.acceptedAt,
        rejectedAt: requested === "rejected" ? at : null,
        rejectionCode: requested === "rejected" ? (patch?.rejectionCode ?? "rejected") : null,
        updatedAt: at
      } as MaritimeDispatch;
      dispatches.set(id, next);
      options.onDispatchTransition?.(next);
      return next;
    },
    async upsertNode(node) {
      return node;
    }
  };
}

function client(): MaritimeControlPlaneClient {
  return {
    wake: vi.fn(async () => ({
      agentId: "agent-worker-1",
      status: "running" as const,
      version: "maritime-sdk@0.5.0",
      diagnosticUrl: null,
      checkedAt: NOW.toISOString()
    })),
    getStatus: vi.fn(),
    getDiagnostics: vi.fn(async () => [])
  };
}

describe("ProductionMaritimeOrchestrator", () => {
  it("persists a minimum-data dispatch before waking Maritime", async () => {
    let acceptedDispatch: MaritimeDispatch | null = null;
    const store = memoryStore({
      onDispatchTransition(dispatch) {
        acceptedDispatch = dispatch;
      }
    });
    const maritime = client();
    const orchestrator = new ProductionMaritimeOrchestrator({
      store,
      policy: new SourcePolicyRegistry([manifest()]),
      client: maritime,
      workerAgentId: "agent-worker-1",
      now: () => NOW,
      id: () => "dispatch-1",
      nonce: () => "one-time-nonce"
    });
    const job = await orchestrator.scheduleConnectorJob({
      id: "job-1",
      correlationId: "correlation-1",
      connectorId: "fixture.feed.v1",
      source: "other",
      acquisitionMode: "fixture",
      manifestVersion: 1,
      trigger: "manual",
      capability: "fixture.read",
      operation: "fixture.read_sanitized",
      payload: { acquisitionMode: "fixture", fixtureSetId: "default" },
      maxAttempts: 3,
      approvalId: null
    });
    await expect(orchestrator.dispatchJob(job.id)).resolves.toMatchObject({ status: "dispatched" });
    expect(maritime.wake).toHaveBeenCalledWith("agent-worker-1");
    expect(acceptedDispatch).toMatchObject({ state: "accepted", maritimeRunId: null });
    expect(JSON.stringify(vi.mocked(maritime.wake).mock.calls)).not.toMatch(
      /cookie|oauth|snapshot|refresh_token|raw_text/iu
    );
  });

  it("cancels rather than waking when policy is disabled after queueing", async () => {
    const store = memoryStore();
    const maritime = client();
    const enabled = new ProductionMaritimeOrchestrator({
      store,
      policy: new SourcePolicyRegistry([manifest()]),
      client: maritime,
      workerAgentId: "agent-worker-1",
      now: () => NOW,
      id: () => "dispatch-1",
      nonce: () => "one-time-nonce"
    });
    const job = await enabled.scheduleConnectorJob({
      id: "job-1",
      correlationId: "correlation-1",
      connectorId: "fixture.feed.v1",
      source: "other",
      acquisitionMode: "fixture",
      manifestVersion: 1,
      trigger: "manual",
      capability: "fixture.read",
      operation: "fixture.read_sanitized",
      payload: { acquisitionMode: "fixture", fixtureSetId: "default" },
      maxAttempts: 3,
      approvalId: null
    });
    const disabled = new ProductionMaritimeOrchestrator({
      store,
      policy: new SourcePolicyRegistry([manifest(false)]),
      client: maritime,
      workerAgentId: "agent-worker-1",
      now: () => NOW,
      id: () => "dispatch-2",
      nonce: () => "different-nonce"
    });
    await expect(disabled.dispatchJob(job.id)).resolves.toMatchObject({
      status: "cancelled_by_policy"
    });
    expect(maritime.wake).not.toHaveBeenCalled();
  });

  it("allows a new minimum-data dispatch attempt after a transient wake failure", async () => {
    const store = memoryStore();
    const maritime = client();
    vi.mocked(maritime.wake).mockRejectedValueOnce(
      Object.assign(new Error("unavailable"), { code: "maritime_unavailable" })
    );
    let sequence = 0;
    const orchestrator = new ProductionMaritimeOrchestrator({
      store,
      policy: new SourcePolicyRegistry([manifest()]),
      client: maritime,
      workerAgentId: "agent-worker-1",
      now: () => NOW,
      id: () => `dispatch-${++sequence}`,
      nonce: () => `nonce-${sequence}`
    });
    const job = await orchestrator.scheduleConnectorJob({
      id: "job-retry",
      correlationId: "correlation-retry",
      connectorId: "fixture.feed.v1",
      source: "other",
      acquisitionMode: "fixture",
      manifestVersion: 1,
      trigger: "manual",
      capability: "fixture.read",
      operation: "fixture.read_sanitized",
      payload: { acquisitionMode: "fixture", fixtureSetId: "default" },
      maxAttempts: 3,
      approvalId: null
    });
    await expect(orchestrator.dispatchJob(job.id)).rejects.toThrow("unavailable");
    await expect(orchestrator.dispatchJob(job.id)).resolves.toMatchObject({ status: "dispatched" });
    expect(maritime.wake).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a used browser approval has expired", async () => {
    const store = memoryStore();
    const maritime = client();
    let scheduledJob: SourceJob | null = null;
    const orchestrator = new ProductionMaritimeOrchestrator({
      store,
      policy: new SourcePolicyRegistry([{ ...ZILLOW_CURRENT_TAB_MANIFEST, enabled: true }]),
      client: maritime,
      workerAgentId: "agent-worker-1",
      now: () => NOW,
      id: () => "dispatch-expired-approval",
      nonce: () => "expired-approval-nonce",
      authorization: {
        async isUserSessionAvailable() {
          return true;
        },
        async getApprovalById() {
          if (!scheduledJob) return null;
          return {
            id: "approval-expired",
            actor: "user",
            connectorId: scheduledJob.connectorId,
            operation: scheduledJob.operation,
            targetType: "source_job",
            targetId: scheduledJob.id,
            payloadHash: scheduledJob.payloadHash,
            state: "used",
            createdAt: "2026-07-22T11:00:00.000Z",
            expiresAt: "2026-07-22T11:06:00.000Z",
            usedAt: "2026-07-22T11:01:00.000Z"
          };
        }
      }
    });
    scheduledJob = await orchestrator.scheduleConnectorJob({
      id: "job-expired-approval",
      correlationId: "correlation-expired-approval",
      connectorId: ZILLOW_CURRENT_TAB_MANIFEST.connectorId,
      source: "zillow",
      acquisitionMode: "local_browser",
      manifestVersion: ZILLOW_CURRENT_TAB_MANIFEST.version,
      trigger: "manual",
      capability: "browser.capture",
      operation: "capture.current_tab",
      payload: {
        acquisitionMode: "local_browser",
        captureKind: "current_tab",
        nodeId: "founder-node",
        profileId: "vera-founder",
        expectedUrl: "https://www.zillow.com/homedetails/123-Main-St/12345_zpid/",
        canonicalUrl: "https://www.zillow.com/homedetails/123-Main-St/12345_zpid/",
        limits: {
          maxPages: 1,
          maxRecords: 1,
          maxBytes: 250_000,
          maxDurationMilliseconds: 30_000,
          maxConcurrency: 1
        }
      },
      maxAttempts: 3,
      approvalId: "approval-expired"
    });

    await expect(orchestrator.dispatchJob(scheduledJob.id)).resolves.toMatchObject({
      status: "cancelled_by_policy"
    });
    expect(maritime.wake).not.toHaveBeenCalled();
  });
});
