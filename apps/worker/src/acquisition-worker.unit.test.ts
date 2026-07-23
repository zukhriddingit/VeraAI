import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import type { BrowserExecutionProvider } from "@vera/connectors";
import { SourceJobSchema, type BrowserNodeStatus, type SourceJob } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { processNextAcquisitionJob } from "./acquisition-worker.ts";

const NOW = "2026-07-21T15:00:00.000Z";
const HASH = "a".repeat(64);
const URL = "https://www.zillow.com/homedetails/12-Main-St/123456_zpid/";

function job(): SourceJob {
  return SourceJobSchema.parse({
    id: "browser-job",
    correlationId: "browser-correlation",
    connectorId: "zillow.current-tab.v1",
    source: "zillow",
    acquisitionMode: "local_browser",
    manifestVersion: 1,
    trigger: "manual",
    capability: "browser.capture",
    approvalId: "browser-approval",
    operation: "capture.current_tab",
    payload: {
      acquisitionMode: "local_browser",
      captureKind: "current_tab",
      nodeId: "node-founder",
      profileId: "vera-zillow",
      expectedUrl: URL,
      canonicalUrl: URL,
      limits: {
        maxPages: 1,
        maxRecords: 1,
        maxBytes: 250_000,
        maxDurationMilliseconds: 30_000,
        maxConcurrency: 1
      }
    },
    payloadHash: HASH,
    idempotencyKey: "b".repeat(64),
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null
  });
}

function node(overrides: Partial<BrowserNodeStatus> = {}): BrowserNodeStatus {
  return {
    nodeId: "node-founder",
    providerId: "openclaw-2026.6.33",
    nodeName: "Founder Mac",
    status: "online",
    pairingState: "paired",
    capabilityApprovalState: "approved",
    selectedProfileId: "vera-zillow",
    allowedProfileIds: ["vera-zillow"],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: NOW,
    heartbeatExpiresAt: "2026-07-21T15:05:00.000Z",
    lastSuccessfulCaptureAt: null,
    disabledAt: null,
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function repositories(input: {
  readonly control?: {
    readonly userBrowserEnabled: boolean;
    readonly zillowSourceEnabled: boolean;
  };
  readonly node?: BrowserNodeStatus | null;
}) {
  const transition = vi.fn(async () => job());
  const appendAttempt = vi.fn(async (attempt) => attempt);
  const appendEvent = vi.fn(async (event) => event);
  const value = {
    browserIntegrationControls: {
      get: vi.fn(async () => ({
        userBrowserEnabled: input.control?.userBrowserEnabled ?? true,
        zillowSourceEnabled: input.control?.zillowSourceEnabled ?? true,
        updatedAt: NOW
      }))
    },
    browserNodes: {
      getById: vi.fn(async () => (input.node === undefined ? node() : input.node))
    },
    browserProfileControls: {
      get: vi.fn(async () => ({
        nodeId: "node-founder",
        profileId: "vera-zillow",
        disabledAt: null,
        updatedAt: NOW
      }))
    },
    approvals: {
      getById: vi.fn(async () => ({
        id: "browser-approval",
        actor: "user",
        connectorId: "zillow.current-tab.v1",
        operation: "capture.current_tab",
        targetType: "source_job",
        targetId: "browser-job",
        payloadHash: HASH,
        state: "used",
        createdAt: "2026-07-21T14:59:00.000Z",
        expiresAt: "2026-07-21T15:05:00.000Z",
        usedAt: "2026-07-21T14:59:00.000Z"
      }))
    },
    sourceJobAttempts: { append: appendAttempt },
    sourceJobs: { transition },
    activityEvents: { append: appendEvent }
  } as unknown as UserRepositories;
  return { value, transition, appendAttempt, appendEvent };
}

function dependencies(repositories: UserRepositories) {
  let id = 0;
  return {
    userId: "00000000-0000-4000-8000-000000000001" as const,
    repositoryProvider: {} as UserRepositoryProvider,
    repositories,
    claimedJob: job(),
    provider: null,
    founderBrowserUserIds: "00000000-0000-4000-8000-000000000001",
    systemBrowserDisabled: false,
    now: () => new Date(NOW),
    createId: () => `generated-${++id}`
  };
}

describe("acquisition worker policy and readiness", () => {
  it("cancels a non-founder before invoking OpenClaw", async () => {
    const state = repositories({});
    const captureCurrentTab = vi.fn();
    const input = {
      ...dependencies(state.value),
      founderBrowserUserIds: "018f9f64-7b5a-7c91-a12e-123456789abc",
      provider: { providerId: "openclaw", captureCurrentTab } as unknown as BrowserExecutionProvider
    };

    await expect(processNextAcquisitionJob(input, new AbortController().signal)).resolves.toEqual({
      status: "cancelled_by_policy",
      jobId: "browser-job",
      reason: "founder_browser_user_denied"
    });
    expect(captureCurrentTab).not.toHaveBeenCalled();
  });

  it("cancels a disabled source without invoking a provider", async () => {
    const state = repositories({
      control: { userBrowserEnabled: true, zillowSourceEnabled: false }
    });
    const result = await processNextAcquisitionJob(
      dependencies(state.value),
      new AbortController().signal
    );
    expect(result).toEqual({
      status: "cancelled_by_policy",
      jobId: "browser-job",
      reason: "source_kill_switch_active"
    });
    expect(state.appendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeStatus: "cancelled_by_policy" })
    );
  });

  it("makes a missing node visibly deferred rather than successful", async () => {
    const state = repositories({ node: null });
    const result = await processNextAcquisitionJob(
      dependencies(state.value),
      new AbortController().signal
    );
    expect(result).toEqual({
      status: "deferred_node_offline",
      jobId: "browser-job",
      reason: "node_unregistered"
    });
    expect(state.transition).toHaveBeenCalledWith(
      "browser-job",
      "deferred_node_offline",
      NOW,
      expect.objectContaining({ deferredReason: "node_unregistered" })
    );
  });

  it("turns stale heartbeat and pending pairing into closed typed states", async () => {
    const staleState = repositories({
      node: node({ status: "stale", heartbeatExpiresAt: NOW })
    });
    await expect(
      processNextAcquisitionJob(dependencies(staleState.value), new AbortController().signal)
    ).resolves.toEqual(
      expect.objectContaining({ status: "deferred_node_offline", reason: "stale_heartbeat" })
    );

    const pairingState = repositories({ node: node({ pairingState: "pairing_pending" }) });
    await expect(
      processNextAcquisitionJob(dependencies(pairingState.value), new AbortController().signal)
    ).resolves.toEqual(
      expect.objectContaining({
        status: "manual_action_required",
        blocker: "node_pairing_required"
      })
    );
  });
});
