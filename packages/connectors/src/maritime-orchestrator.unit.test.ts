import {
  SourceJobPayloadSchema,
  SourceJobSchema,
  type BrowserNodeStatus,
  type DeferredJobReason,
  type ManualActionBlocker,
  type SourcePolicyManifest
} from "@vera/domain";
import { SourcePolicyRegistry } from "@vera/policy";
import { describe, expect, it } from "vitest";

import { MockBrowserExecutionProvider, type MockBrowserOutcome } from "./browser-execution.ts";
import {
  LocalMockMaritimeOrchestrator,
  ScheduleSourceJobInputSchema,
  type ScheduleSourceJobInput
} from "./maritime-orchestrator.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const LATER = "2026-07-18T12:05:00.000Z";
const TARGET_URL = "https://www.zillow.com/homes/for_rent/";

const onlineNode: BrowserNodeStatus = {
  nodeId: "node-local-1",
  providerId: "mock-openclaw",
  status: "online",
  lastHeartbeatAt: NOW,
  heartbeatExpiresAt: LATER,
  contractVersion: 1,
  capabilities: {
    navigation: true,
    capture: true,
    cancellation: true
  },
  updatedAt: NOW
};

const browserManifest = {
  schemaVersion: 2,
  connectorId: "zillow.browser.saved-search.v1",
  displayName: "Zillow saved-search browser contract",
  version: 1,
  source: "zillow",
  acquisitionMode: "local_browser",
  policyState: "approved",
  enabled: true,
  execution: "scheduled",
  capabilities: ["browser.capture"],
  allowedOperations: ["browser.capture_saved_search"],
  allowedDomains: ["www.zillow.com"],
  allowedOrigins: ["https://www.zillow.com"],
  allowedHttpMethods: ["GET"],
  requiresUserSession: false,
  requiresApproval: false,
  minimumIntervalSeconds: 300,
  maxConcurrency: 1,
  globalKillSwitchKey: "integrations.disabled",
  connectorKillSwitchKey: "connectors.zillow.browser.saved-search.v1.disabled",
  dataClassification: "third_party",
  redactionRules: [
    "raw_content_from_logs",
    "full_urls_from_logs",
    "contact_details_from_logs",
    "credentials_from_logs"
  ],
  manualBlockerBehavior: "stop_and_request_user_action",
  owner: "Vera maintainers",
  reviewedAt: "2026-07-18",
  decisionRecord: "docs/DECISIONS/0007-maritime-openclaw-contract-boundaries.md",
  notes: "Contract-only test manifest for one exact sanitized saved-search URL.",
  createdAt: NOW,
  updatedAt: NOW
} as const satisfies SourcePolicyManifest;

const validBrowserJobInput = {
  id: "source-job-1",
  correlationId: "correlation-source-job-1",
  connectorId: browserManifest.connectorId,
  source: "zillow",
  acquisitionMode: "local_browser",
  manifestVersion: browserManifest.version,
  trigger: "scheduled",
  capability: "browser.capture",
  operation: "browser.capture_saved_search",
  payload: {
    acquisitionMode: "local_browser",
    nodeId: onlineNode.nodeId,
    savedSearchId: "saved-search-1",
    savedSearchUrl: TARGET_URL,
    committedCursor: {
      value: "listing-100",
      observedAt: "2026-07-18T11:55:00.000Z"
    },
    limits: {
      maxPages: 2,
      maxRecords: 20,
      maxBytes: 1_000_000,
      maxDurationMilliseconds: 60_000,
      maxConcurrency: 1
    }
  },
  maxAttempts: 3,
  hasUserSession: false,
  hasApproval: false
} as const satisfies ScheduleSourceJobInput;

function providerFor(
  outcomes: readonly MockBrowserOutcome[],
  nodes: readonly BrowserNodeStatus[] = [onlineNode]
): MockBrowserExecutionProvider {
  return new MockBrowserExecutionProvider(outcomes, {
    nodes,
    now: () => new Date(NOW)
  });
}

function orchestratorFor(
  outcomes: readonly MockBrowserOutcome[],
  options: {
    readonly manifest?: SourcePolicyManifest;
    readonly providerNodes?: readonly BrowserNodeStatus[];
  } = {}
): LocalMockMaritimeOrchestrator {
  return new LocalMockMaritimeOrchestrator(
    new SourcePolicyRegistry([options.manifest ?? browserManifest]),
    providerFor(outcomes, options.providerNodes),
    () => new Date(NOW)
  );
}

function completedOutcome(): MockBrowserOutcome {
  return {
    operation: "capture",
    status: "completed",
    completedAt: NOW,
    evidence: [
      {
        captureId: "capture-1",
        sourceUrl: TARGET_URL,
        observedAt: NOW,
        mediaType: "text/plain",
        content: "Sanitized untrusted listing evidence"
      }
    ],
    cursorCandidate: {
      value: "listing-101",
      observedAt: NOW
    }
  };
}

async function registerOnlineNode(orchestrator: LocalMockMaritimeOrchestrator): Promise<void> {
  await orchestrator.receiveBrowserNodeHeartbeat(onlineNode);
}

describe("Maritime orchestration scheduling contract", () => {
  it("schedules and queries a strict queued job with deterministic hashes", async () => {
    const orchestrator = orchestratorFor([completedOutcome()]);
    const job = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

    expect(SourceJobSchema.parse(job)).toEqual(job);
    expect(job).toMatchObject({
      id: validBrowserJobInput.id,
      correlationId: validBrowserJobInput.correlationId,
      status: "queued",
      attempts: 0,
      result: null
    });
    expect(job.payloadHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(job.idempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
    await expect(orchestrator.getJobStatus(job.id)).resolves.toEqual(job);
    await expect(orchestrator.getJobStatus("missing-job")).resolves.toBeNull();
  });

  it("rejects secret-bearing or unknown schedule payloads before they can be serialized", async () => {
    for (const forbidden of [
      { password: "must-reject" },
      { cookie: "must-reject" },
      { authorization: "must-reject" },
      { sessionExport: "must-reject" },
      { profilePath: "/tmp/must-reject" },
      { rawPageContent: "must-reject" }
    ]) {
      expect(() =>
        ScheduleSourceJobInputSchema.parse({
          ...validBrowserJobInput,
          payload: { ...validBrowserJobInput.payload, ...forbidden }
        })
      ).toThrow();
    }

    const job = await orchestratorFor([]).scheduleConnectorJob(validBrowserJobInput);
    const serializedPayload = JSON.stringify(job.payload);
    expect(serializedPayload).not.toMatch(
      /password|cookie|authorization|sessionExport|profilePath|rawPageContent/iu
    );
    expect(SourceJobPayloadSchema.parse(job.payload)).toEqual(job.payload);
  });

  it("returns the original job when the same idempotent schedule is replayed", async () => {
    const orchestrator = orchestratorFor([]);
    const first = await orchestrator.scheduleConnectorJob(validBrowserJobInput);
    const replay = await orchestrator.scheduleConnectorJob({
      ...validBrowserJobInput,
      id: "source-job-replayed-schedule",
      correlationId: "correlation-replayed-schedule"
    });

    expect(replay).toEqual(first);
  });
});

describe("LocalMockMaritimeOrchestrator policy and node handling", () => {
  it("cancels by policy before browser execution when the manifest is disabled", async () => {
    const disabledManifest: SourcePolicyManifest = {
      ...browserManifest,
      policyState: "disabled",
      enabled: false
    };
    const orchestrator = orchestratorFor([completedOutcome()], {
      manifest: disabledManifest
    });
    await registerOnlineNode(orchestrator);
    const job = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

    await expect(orchestrator.dispatchJob(job.id)).resolves.toMatchObject({
      status: "cancelled_by_policy",
      result: null,
      completedAt: NOW
    });
  });

  it.each([
    ["missing", null, "node_unregistered"],
    ["offline", { ...onlineNode, status: "offline" }, "node_offline"],
    [
      "stale",
      {
        ...onlineNode,
        lastHeartbeatAt: "2026-07-18T11:55:00.000Z",
        heartbeatExpiresAt: "2026-07-18T11:59:59.000Z"
      },
      "stale_heartbeat"
    ],
    ["revoked", { ...onlineNode, status: "revoked" }, "node_revoked"]
  ] as const)(
    "makes a %s browser node visibly deferred without output or cursor advancement",
    async (_label, node, deferredReason) => {
      const orchestrator = orchestratorFor([completedOutcome()]);
      if (node !== null) await orchestrator.receiveBrowserNodeHeartbeat(node);
      const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

      const deferred = await orchestrator.dispatchJob(scheduled.id);
      expect(deferred).toMatchObject({
        status: "deferred_node_offline",
        deferredReason,
        result: null,
        completedAt: null
      });
      expect(deferred.payload).toEqual(scheduled.payload);
      if (deferred.payload.acquisitionMode === "local_browser") {
        expect(deferred.payload.committedCursor).toEqual(
          validBrowserJobInput.payload.committedCursor
        );
      }
    }
  );

  it("accepts validated browser-node heartbeats without allowing a revoked node to revive itself", async () => {
    const orchestrator = orchestratorFor([]);
    const revoked = { ...onlineNode, status: "revoked" } as const;
    await expect(orchestrator.receiveBrowserNodeHeartbeat(revoked)).resolves.toEqual(revoked);
    await expect(orchestrator.receiveBrowserNodeHeartbeat(onlineNode)).resolves.toEqual(revoked);

    await expect(
      orchestrator.receiveBrowserNodeHeartbeat({ ...onlineNode, providerId: "unexpected-provider" })
    ).rejects.toThrow(/provider/iu);
  });

  it("allows an explicit requeue after node deferral while preserving stable job identity", async () => {
    const orchestrator = orchestratorFor([completedOutcome()]);
    const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);
    const deferred = await orchestrator.dispatchJob(scheduled.id);
    await registerOnlineNode(orchestrator);

    const retried = await orchestrator.retryJob(deferred.id);
    expect(retried).toMatchObject({
      id: scheduled.id,
      correlationId: scheduled.correlationId,
      payloadHash: scheduled.payloadHash,
      idempotencyKey: scheduled.idempotencyKey,
      status: "queued",
      deferredReason: null
    });
    expect(retried.payload).toEqual(scheduled.payload);
  });
});

describe("LocalMockMaritimeOrchestrator execution outcomes", () => {
  it("completes a browser capture and returns an idempotent replay without executing twice", async () => {
    const orchestrator = orchestratorFor([completedOutcome()]);
    await registerOnlineNode(orchestrator);
    const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

    const completed = await orchestrator.dispatchJob(scheduled.id);
    expect(completed).toMatchObject({
      status: "completed",
      attempts: 1,
      result: {
        status: "completed",
        correlationId: scheduled.correlationId,
        payloadHash: scheduled.payloadHash,
        idempotencyKey: scheduled.idempotencyKey,
        recordCount: 1,
        previousCursor: validBrowserJobInput.payload.committedCursor,
        cursorCandidate: { value: "listing-101" },
        idempotentReplay: false,
        untrustedInput: true
      }
    });

    const replay = await orchestrator.dispatchJob(scheduled.id);
    expect(replay).toMatchObject({
      status: "completed",
      attempts: 1,
      result: { idempotentReplay: true, resultHash: completed.result?.resultHash }
    });
  });

  it.each([
    "login",
    "reauthentication",
    "two_factor_authentication",
    "captcha",
    "consent",
    "camera_permission",
    "microphone_permission"
  ] satisfies readonly ManualActionBlocker[])(
    "surfaces %s as manual_action_required with no output or cursor advancement",
    async (blocker) => {
      const orchestrator = orchestratorFor([
        {
          operation: "capture",
          status: "manual_action_required",
          blocker,
          instruction: "Complete the prompt manually in the dedicated local browser profile.",
          completedAt: NOW
        }
      ]);
      await registerOnlineNode(orchestrator);
      const job = await orchestrator.scheduleConnectorJob({
        ...validBrowserJobInput,
        id: `source-job-${blocker}`,
        correlationId: `correlation-${blocker}`
      });

      await expect(orchestrator.dispatchJob(job.id)).resolves.toMatchObject({
        status: "manual_action_required",
        manualAction: { blocker, jobId: job.id, correlationId: job.correlationId },
        result: null
      });
    }
  );

  it("marks only a transient provider failure retryable and requires an explicit safe retry", async () => {
    const outcomes: readonly MockBrowserOutcome[] = [
      {
        operation: "capture",
        status: "retryable_failed",
        error: { code: "provider_temporarily_unavailable", category: "transient_provider" },
        completedAt: NOW
      },
      completedOutcome()
    ];
    const orchestrator = orchestratorFor(outcomes);
    await registerOnlineNode(orchestrator);
    const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

    const failed = await orchestrator.dispatchJob(scheduled.id);
    expect(failed).toMatchObject({
      status: "retryable_failed",
      attempts: 1,
      result: { status: "failed", error: { category: "transient_provider" } }
    });

    const queued = await orchestrator.retryJob(failed.id);
    expect(queued).toMatchObject({
      status: "queued",
      attempts: 1,
      result: null,
      payloadHash: scheduled.payloadHash,
      idempotencyKey: scheduled.idempotencyKey
    });
    await expect(orchestrator.dispatchJob(queued.id)).resolves.toMatchObject({
      status: "completed",
      attempts: 2
    });
  });

  it("does not make permanent failures retryable", async () => {
    const orchestrator = orchestratorFor([
      {
        operation: "capture",
        status: "permanently_failed",
        error: { code: "provider_contract_rejected", category: "permanent_provider" },
        completedAt: NOW
      }
    ]);
    await registerOnlineNode(orchestrator);
    const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);
    const failed = await orchestrator.dispatchJob(scheduled.id);

    expect(failed.status).toBe("permanently_failed");
    await expect(orchestrator.retryJob(failed.id)).rejects.toThrow(/retry/iu);
  });

  it("fails closed when a non-browser connector executor has not been configured", async () => {
    const fixtureManifest: SourcePolicyManifest = {
      ...browserManifest,
      connectorId: "fixture.feed.v1",
      displayName: "Sanitized fixture feed",
      source: "other",
      acquisitionMode: "fixture",
      execution: "manual",
      capabilities: ["fixture.read"],
      allowedOperations: ["fixture.read_sanitized"],
      allowedDomains: [],
      allowedOrigins: [],
      allowedHttpMethods: [],
      minimumIntervalSeconds: null,
      dataClassification: "synthetic",
      connectorKillSwitchKey: "connectors.fixture.feed.v1.disabled"
    };
    const orchestrator = orchestratorFor([], { manifest: fixtureManifest });
    const fixtureJob = await orchestrator.scheduleConnectorJob({
      id: "source-job-fixture",
      correlationId: "correlation-source-job-fixture",
      connectorId: fixtureManifest.connectorId,
      source: "other",
      acquisitionMode: "fixture",
      manifestVersion: fixtureManifest.version,
      trigger: "manual",
      capability: "fixture.read",
      operation: "fixture.read_sanitized",
      payload: { acquisitionMode: "fixture", fixtureSetId: "ship-season-demo" },
      maxAttempts: 1,
      hasUserSession: false,
      hasApproval: false
    });

    await expect(orchestrator.dispatchJob(fixtureJob.id)).resolves.toMatchObject({
      status: "permanently_failed",
      result: {
        status: "failed",
        recordCount: 0,
        cursorCandidate: null,
        error: { code: "mock_connector_execution_not_configured" }
      }
    });
  });

  it("can cancel a queued job explicitly by policy", async () => {
    const orchestrator = orchestratorFor([]);
    const scheduled = await orchestrator.scheduleConnectorJob(validBrowserJobInput);

    await expect(
      orchestrator.cancelByPolicy(scheduled.id, "source kill switch activated")
    ).resolves.toMatchObject({ status: "cancelled_by_policy", result: null });
  });
});

describe("deterministic source-job payload hashing", () => {
  it("uses a canonical SHA-256 payload hash independent of input property order", async () => {
    const first = await orchestratorFor([]).scheduleConnectorJob(validBrowserJobInput);
    const reorderedPayload: ScheduleSourceJobInput["payload"] = {
      limits: validBrowserJobInput.payload.limits,
      committedCursor: validBrowserJobInput.payload.committedCursor,
      savedSearchUrl: validBrowserJobInput.payload.savedSearchUrl,
      savedSearchId: validBrowserJobInput.payload.savedSearchId,
      nodeId: validBrowserJobInput.payload.nodeId,
      acquisitionMode: "local_browser"
    };
    const second = await orchestratorFor([]).scheduleConnectorJob({
      ...validBrowserJobInput,
      id: "source-job-reordered-payload",
      correlationId: "correlation-reordered-payload",
      payload: reorderedPayload
    });

    expect(first.payloadHash).toHaveLength(64);
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("retains precise deferred reason vocabulary", async () => {
    const expected = new Set<DeferredJobReason>([
      "node_unregistered",
      "node_offline",
      "stale_heartbeat",
      "node_revoked"
    ]);
    expect(expected.size).toBe(4);
  });
});
