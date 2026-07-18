import { describe, expect, it } from "vitest";

import {
  AcquisitionModeSchema,
  BrowserNodeStatusSchema,
  InvalidSourceJobTransitionError,
  JobAttemptSchema,
  ManualActionBlockerSchema,
  ProductionAcquisitionModeSchema,
  SourceJobPayloadSchema,
  SourceJobResultSchema,
  SourceJobSchema,
  SourceJobStatusSchema,
  SourcePolicyStateSchema,
  isBrowserNodeStale,
  transitionSourceJobStatus
} from "./index.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const LATER = "2026-07-18T12:05:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const browserPayload = {
  acquisitionMode: "local_browser",
  nodeId: "node-local-1",
  savedSearchId: "saved-search-1",
  savedSearchUrl: "https://www.zillow.com/homes/for_rent/",
  committedCursor: null,
  limits: {
    maxPages: 2,
    maxRecords: 20,
    maxBytes: 1_000_000,
    maxDurationMilliseconds: 60_000,
    maxConcurrency: 1
  }
} as const;

const completedResult = {
  jobId: "source-job-1",
  connectorId: "zillow.browser.v1",
  source: "zillow",
  acquisitionMode: "local_browser",
  operation: "discover",
  status: "completed",
  correlationId: "correlation-source-job-1",
  payloadHash: HASH_A,
  idempotencyKey: HASH_B,
  resultHash: HASH_A,
  recordCount: 2,
  previousCursor: null,
  cursorCandidate: {
    value: "listing-123",
    observedAt: LATER
  },
  error: null,
  completedAt: LATER,
  idempotentReplay: false,
  untrustedInput: true
} as const;

const queuedJob = {
  id: "source-job-1",
  correlationId: "correlation-source-job-1",
  connectorId: "zillow.browser.v1",
  source: "zillow",
  acquisitionMode: "local_browser",
  manifestVersion: 1,
  trigger: "scheduled",
  operation: "discover",
  payload: browserPayload,
  payloadHash: HASH_A,
  idempotencyKey: HASH_B,
  status: "queued",
  attempts: 0,
  maxAttempts: 3,
  manualAction: null,
  deferredReason: null,
  result: null,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null
} as const;

describe("source orchestration vocabularies", () => {
  it("keeps production acquisition modes separate from test-only fixture mode", () => {
    expect(ProductionAcquisitionModeSchema.options).toEqual([
      "official_api",
      "email_alert",
      "local_browser",
      "user_capture"
    ]);
    expect(AcquisitionModeSchema.options).toEqual([
      "official_api",
      "email_alert",
      "local_browser",
      "user_capture",
      "fixture"
    ]);
    expect(SourcePolicyStateSchema.options).toEqual([
      "approved",
      "user_triggered_only",
      "experimental_personal",
      "disabled"
    ]);
    expect(SourceJobStatusSchema.options).toEqual([
      "queued",
      "dispatched",
      "running",
      "completed",
      "retryable_failed",
      "permanently_failed",
      "deferred_node_offline",
      "manual_action_required",
      "cancelled_by_policy"
    ]);
    expect(ManualActionBlockerSchema.options).toEqual([
      "login",
      "reauthentication",
      "two_factor_authentication",
      "captcha",
      "consent",
      "camera_permission",
      "microphone_permission"
    ]);
  });
});

describe("source job payload schemas", () => {
  it("accepts only minimum, mode-specific control data", () => {
    expect(SourceJobPayloadSchema.parse(browserPayload)).toEqual(browserPayload);
    expect(
      SourceJobPayloadSchema.parse({
        acquisitionMode: "fixture",
        fixtureSetId: "demo-seed-v1"
      })
    ).toMatchObject({ acquisitionMode: "fixture" });
    expect(
      SourceJobPayloadSchema.parse({
        acquisitionMode: "user_capture",
        captureReference: "protected-capture-1"
      })
    ).toMatchObject({ acquisitionMode: "user_capture" });
    expect(
      SourceJobPayloadSchema.parse({
        acquisitionMode: "email_alert",
        sourceConfigurationId: "source-config-craigslist-alert",
        committedCursor: null
      })
    ).toMatchObject({ acquisitionMode: "email_alert" });
  });

  it("rejects credential, browser-profile, pasted-evidence, and arbitrary fields", () => {
    for (const forbidden of [
      { password: "must-reject" },
      { cookie: "must-reject" },
      { authorization: "must-reject" },
      { sessionExport: "must-reject" },
      { profilePath: "/tmp/must-reject" },
      { rawPageContent: "must-reject" }
    ]) {
      expect(() => SourceJobPayloadSchema.parse({ ...browserPayload, ...forbidden })).toThrow();
    }
  });

  it("accepts only safe, public, credential-free browser URLs", () => {
    for (const unsafeUrl of [
      "https://user:secret@www.zillow.com/homes/for_rent/",
      "https://www.zillow.com:8443/homes/for_rent/",
      "https://www.zillow.com/homes/for_rent/#results",
      "http://localhost/saved-search",
      "http://127.0.0.1/saved-search",
      "file:///tmp/browser-profile",
      "https://www.zillow.com/homes/for_rent/?access_token=must-reject",
      "https://www.zillow.com/homes/for_rent/?PaSsWoRd=must-reject",
      "https://www.zillow.com/homes/for_rent/?%61uth=must-reject",
      "https://www.zillow.com/homes/for_rent/?refresh%5Ftoken=must-reject",
      "https://www.zillow.com/homes/for_rent/?API%5FKEY=must-reject",
      "https://www.zillow.com/homes/for_rent/?SESSIONID=must-reject",
      "https://www.zillow.com/homes/for_rent/?searchQueryState=%E0%A4%A"
    ]) {
      expect(() =>
        SourceJobPayloadSchema.parse({ ...browserPayload, savedSearchUrl: unsafeUrl })
      ).toThrow();
    }

    const safeSavedSearchUrl =
      "https://www.zillow.com/homes/for_rent/?searchQueryState=cambridge&beds=2&authentic=true&sessionType=map";
    expect(
      SourceJobPayloadSchema.parse({
        ...browserPayload,
        savedSearchUrl: safeSavedSearchUrl
      })
    ).toMatchObject({
      acquisitionMode: "local_browser",
      savedSearchUrl: safeSavedSearchUrl
    });
  });
});

describe("source job schemas", () => {
  it("validates internally consistent queued and completed jobs", () => {
    expect(SourceJobSchema.parse(queuedJob).status).toBe("queued");
    expect(
      SourceJobSchema.parse({
        ...queuedJob,
        status: "completed",
        attempts: 1,
        result: completedResult,
        updatedAt: LATER,
        completedAt: LATER
      }).result
    ).toEqual(completedResult);
    expect(SourceJobResultSchema.parse(completedResult).recordCount).toBe(2);
  });

  it("rejects mode mismatches and false-success metadata", () => {
    expect(() =>
      SourceJobSchema.parse({ ...queuedJob, acquisitionMode: "official_api" })
    ).toThrow();
    expect(() =>
      SourceJobSchema.parse({
        ...queuedJob,
        status: "deferred_node_offline",
        deferredReason: "node_offline",
        result: completedResult,
        updatedAt: LATER
      })
    ).toThrow();
    expect(() =>
      SourceJobSchema.parse({
        ...queuedJob,
        status: "manual_action_required",
        updatedAt: LATER
      })
    ).toThrow();
  });

  it("validates completed attempt records with only safe error metadata", () => {
    expect(
      JobAttemptSchema.parse({
        id: "source-job-attempt-1",
        sourceJobId: queuedJob.id,
        attemptNumber: 1,
        startedAt: NOW,
        completedAt: LATER,
        outcomeStatus: "retryable_failed",
        error: {
          code: "provider_temporarily_unavailable",
          category: "transient_provider"
        },
        deferredReason: null,
        correlationId: queuedJob.correlationId,
        payloadHash: queuedJob.payloadHash
      }).outcomeStatus
    ).toBe("retryable_failed");
  });
});

describe("source job lifecycle", () => {
  it("accepts legal dispatch, failure, manual, and retry transitions", () => {
    expect(transitionSourceJobStatus("queued", "dispatched")).toBe("dispatched");
    expect(transitionSourceJobStatus("dispatched", "deferred_node_offline")).toBe(
      "deferred_node_offline"
    );
    expect(transitionSourceJobStatus("running", "manual_action_required")).toBe(
      "manual_action_required"
    );
    expect(transitionSourceJobStatus("retryable_failed", "queued")).toBe("queued");
  });

  it("rejects illegal transitions from terminal states", () => {
    expect(() => transitionSourceJobStatus("completed", "queued")).toThrow(
      InvalidSourceJobTransitionError
    );
    expect(() => transitionSourceJobStatus("cancelled_by_policy", "queued")).toThrow(
      InvalidSourceJobTransitionError
    );
  });
});

describe("browser node heartbeat state", () => {
  const node = BrowserNodeStatusSchema.parse({
    nodeId: "node-local-1",
    providerId: "mock-openclaw",
    status: "online",
    lastHeartbeatAt: "2026-07-18T11:59:30.000Z",
    heartbeatExpiresAt: NOW,
    contractVersion: 1,
    capabilities: {
      navigation: true,
      capture: true,
      cancellation: true
    },
    updatedAt: "2026-07-18T11:59:30.000Z"
  });

  it("derives stale heartbeat state from an injected clock", () => {
    expect(isBrowserNodeStale(node, new Date("2026-07-18T11:59:59.999Z"))).toBe(false);
    expect(isBrowserNodeStale(node, new Date("2026-07-18T12:00:00.001Z"))).toBe(true);
  });

  it("treats an explicitly stale node as stale before expiry", () => {
    expect(
      isBrowserNodeStale(
        BrowserNodeStatusSchema.parse({ ...node, status: "stale" }),
        new Date("2026-07-18T11:59:59.999Z")
      )
    ).toBe(true);
  });
});
