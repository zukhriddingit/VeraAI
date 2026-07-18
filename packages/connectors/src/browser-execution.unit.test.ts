import { describe, expect, it } from "vitest";
import type { BrowserNodeStatus, ManualActionBlocker } from "@vera/domain";

import {
  BrowserCaptureRequestSchema,
  BrowserExecutionResultSchema,
  BrowserHeartbeatRequestSchema,
  BrowserNavigationRequestSchema,
  MockBrowserExecutionProvider,
  type BrowserCaptureRequest,
  type BrowserNavigationRequest,
  type MockBrowserOutcome
} from "./browser-execution.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const LATER = "2026-07-18T12:05:00.000Z";
const TARGET_URL = "https://www.zillow.com/homes/for_rent/";

const LIMITS = {
  maxPages: 2,
  maxRecords: 20,
  maxBytes: 1_000_000,
  maxDurationMilliseconds: 60_000,
  maxConcurrency: 1
} as const;

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

const validNavigation: BrowserNavigationRequest = {
  nodeId: onlineNode.nodeId,
  executionId: "execution-1",
  correlationId: "correlation-1",
  targetUrl: TARGET_URL,
  allowedUrls: [TARGET_URL],
  limits: LIMITS
};

const validCapture: BrowserCaptureRequest = {
  ...validNavigation,
  committedCursor: null
};

function providerFor(
  outcomes: readonly MockBrowserOutcome[],
  nodes: readonly BrowserNodeStatus[] = [onlineNode]
): MockBrowserExecutionProvider {
  return new MockBrowserExecutionProvider(outcomes, {
    nodes,
    now: () => new Date(NOW)
  });
}

describe("browser execution request schemas", () => {
  it("accepts only exact, safe allowlisted navigation", () => {
    expect(BrowserNavigationRequestSchema.parse(validNavigation)).toEqual(validNavigation);

    expect(() =>
      BrowserNavigationRequestSchema.parse({
        ...validNavigation,
        targetUrl: "https://outside.example/listing"
      })
    ).toThrow(/allowlist/iu);

    for (const targetUrl of [
      "https://user:secret@www.zillow.com/homes/for_rent/",
      "https://www.zillow.com:8443/homes/for_rent/",
      "https://www.zillow.com/homes/for_rent/#results",
      "http://localhost/saved-search",
      "file:///tmp/browser-profile"
    ]) {
      expect(() =>
        BrowserNavigationRequestSchema.parse({
          ...validNavigation,
          targetUrl,
          allowedUrls: [targetUrl]
        })
      ).toThrow();
    }
  });

  it("rejects credentials, session material, browser profiles, and unknown payload fields", () => {
    for (const forbidden of [
      { password: "must-reject" },
      { cookie: "must-reject" },
      { authorization: "must-reject" },
      { sessionExport: "must-reject" },
      { profilePath: "/tmp/must-reject" },
      { rawPageContent: "must-reject" }
    ]) {
      expect(() => BrowserCaptureRequestSchema.parse({ ...validCapture, ...forbidden })).toThrow();
    }
  });

  it("requires a correlation ID on strict heartbeat requests", () => {
    expect(
      BrowserHeartbeatRequestSchema.parse({
        nodeId: onlineNode.nodeId,
        correlationId: "correlation-heartbeat-1",
        observedAt: NOW
      })
    ).toMatchObject({ correlationId: "correlation-heartbeat-1" });
    expect(() =>
      BrowserHeartbeatRequestSchema.parse({
        nodeId: onlineNode.nodeId,
        correlationId: "correlation-heartbeat-1",
        observedAt: NOW,
        cookie: "must-reject"
      })
    ).toThrow();
  });
});

describe("MockBrowserExecutionProvider", () => {
  it("returns deterministic completed navigation and bounded untrusted capture evidence", async () => {
    const provider = providerFor([
      {
        operation: "navigate",
        status: "completed",
        completedAt: NOW,
        evidence: [],
        cursorCandidate: null
      },
      {
        operation: "capture",
        status: "completed",
        completedAt: NOW,
        evidence: [
          {
            captureId: "capture-1",
            sourceUrl: TARGET_URL,
            observedAt: NOW,
            mediaType: "text/plain",
            content: "Synthetic listing evidence"
          }
        ],
        cursorCandidate: {
          value: "listing-123",
          observedAt: NOW
        }
      }
    ]);

    await expect(provider.navigate(validNavigation)).resolves.toMatchObject({
      status: "completed",
      operation: "navigate",
      correlationId: validNavigation.correlationId,
      recordCount: 0,
      untrustedInput: true
    });

    const captured = await provider.capture(validCapture);
    expect(BrowserExecutionResultSchema.parse(captured)).toEqual(captured);
    expect(captured).toMatchObject({
      status: "completed",
      operation: "capture",
      correlationId: validCapture.correlationId,
      recordCount: 1,
      cursorCandidate: { value: "listing-123" },
      untrustedInput: true
    });
    expect(() =>
      BrowserExecutionResultSchema.parse({ ...captured, evidence: [], recordCount: 0 })
    ).toThrow(/cursor candidate/iu);
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
    "returns a typed manual-action result for %s without evidence or cursor advancement",
    async (blocker) => {
      const provider = providerFor([
        {
          operation: "capture",
          status: "manual_action_required",
          blocker,
          instruction: "Complete this prompt manually in the dedicated local browser profile.",
          completedAt: NOW
        }
      ]);

      await expect(provider.capture(validCapture)).resolves.toMatchObject({
        status: "manual_action_required",
        evidence: [],
        recordCount: 0,
        cursorCandidate: null,
        manualAction: { blocker }
      });
    }
  );

  it.each([
    ["missing", [], "node_unregistered"],
    ["offline", [{ ...onlineNode, status: "offline" }], "node_offline"],
    [
      "stale",
      [
        {
          ...onlineNode,
          lastHeartbeatAt: "2026-07-18T11:55:00.000Z",
          heartbeatExpiresAt: "2026-07-18T11:59:59.000Z",
          updatedAt: NOW
        }
      ],
      "stale_heartbeat"
    ],
    ["revoked", [{ ...onlineNode, status: "revoked" }], "node_revoked"]
  ] as const)(
    "returns visible deferred_node_offline for a %s node without consuming a success outcome",
    async (_label, nodes, deferredReason) => {
      const provider = providerFor(
        [
          {
            operation: "capture",
            status: "completed",
            completedAt: NOW,
            evidence: [],
            cursorCandidate: null
          }
        ],
        nodes
      );

      await expect(provider.capture(validCapture)).resolves.toMatchObject({
        status: "deferred_node_offline",
        deferredReason,
        evidence: [],
        recordCount: 0,
        cursorCandidate: null
      });
    }
  );

  it("supports correlated cancellation and makes later work visibly cancelled", async () => {
    const provider = providerFor([]);
    const cancelled = await provider.cancel({
      nodeId: onlineNode.nodeId,
      executionId: validCapture.executionId,
      correlationId: "correlation-cancel-1",
      reason: "cancelled_by_policy",
      requestedAt: NOW
    });

    expect(cancelled).toMatchObject({
      status: "cancelled",
      correlationId: "correlation-cancel-1",
      alreadyCancelled: false
    });
    await expect(provider.capture(validCapture)).resolves.toMatchObject({
      status: "cancelled",
      correlationId: validCapture.correlationId,
      recordCount: 0,
      cursorCandidate: null
    });
  });

  it("returns a typed failure instead of inventing success when the script is exhausted", async () => {
    await expect(providerFor([]).navigate(validNavigation)).resolves.toMatchObject({
      status: "permanently_failed",
      error: { code: "mock_outcome_missing" },
      evidence: [],
      cursorCandidate: null
    });
  });

  it("fails closed when captured evidence exceeds bounds or falls outside the exact allowlist", async () => {
    const outside = providerFor([
      {
        operation: "capture",
        status: "completed",
        completedAt: NOW,
        evidence: [
          {
            captureId: "capture-outside-1",
            sourceUrl: "https://outside.example/listing",
            observedAt: NOW,
            mediaType: "text/plain",
            content: "Synthetic listing evidence"
          }
        ],
        cursorCandidate: null
      }
    ]);
    await expect(outside.capture(validCapture)).resolves.toMatchObject({
      status: "permanently_failed",
      error: { code: "browser_evidence_outside_allowlist" },
      evidence: [],
      cursorCandidate: null
    });

    const oversized = providerFor([
      {
        operation: "capture",
        status: "completed",
        completedAt: NOW,
        evidence: [
          {
            captureId: "capture-oversized-1",
            sourceUrl: TARGET_URL,
            observedAt: NOW,
            mediaType: "text/plain",
            content: "too many bytes"
          }
        ],
        cursorCandidate: null
      }
    ]);
    await expect(
      oversized.capture({
        ...validCapture,
        limits: { ...validCapture.limits, maxBytes: 4 }
      })
    ).resolves.toMatchObject({
      status: "permanently_failed",
      error: { code: "browser_capture_limit_exceeded" },
      evidence: [],
      cursorCandidate: null
    });
  });

  it("validates scripted outcomes and never serializes secret-bearing fields", async () => {
    const unsafeOutcome = {
      operation: "capture",
      status: "completed",
      completedAt: NOW,
      evidence: [],
      cursorCandidate: null,
      cookie: "must-reject"
    } as unknown as MockBrowserOutcome;

    await expect(providerFor([unsafeOutcome]).capture(validCapture)).rejects.toThrow();

    const serialized = JSON.stringify(
      await providerFor([
        {
          operation: "capture",
          status: "manual_action_required",
          blocker: "captcha",
          instruction: "Complete the challenge manually.",
          completedAt: NOW
        }
      ]).capture(validCapture)
    );
    expect(serialized).not.toMatch(/password|cookie|authorization|profilePath|sessionExport/iu);
  });

  it("reports configured node health and a safe offline status for an unknown node", async () => {
    const provider = providerFor([]);
    await expect(
      provider.heartbeat({
        nodeId: onlineNode.nodeId,
        correlationId: "correlation-heartbeat-1",
        observedAt: NOW
      })
    ).resolves.toEqual({
      correlationId: "correlation-heartbeat-1",
      node: onlineNode,
      untrustedInput: true
    });

    await expect(
      provider.heartbeat({
        nodeId: "node-unknown",
        correlationId: "correlation-heartbeat-2",
        observedAt: NOW
      })
    ).resolves.toMatchObject({
      correlationId: "correlation-heartbeat-2",
      node: {
        nodeId: "node-unknown",
        providerId: "mock-openclaw",
        status: "offline"
      }
    });

    const staleProvider = providerFor(
      [],
      [
        {
          ...onlineNode,
          lastHeartbeatAt: "2026-07-18T11:55:00.000Z",
          heartbeatExpiresAt: "2026-07-18T11:59:59.000Z"
        }
      ]
    );
    await expect(
      staleProvider.heartbeat({
        nodeId: onlineNode.nodeId,
        correlationId: "correlation-heartbeat-3",
        observedAt: NOW
      })
    ).resolves.toMatchObject({
      correlationId: "correlation-heartbeat-3",
      node: { status: "stale" }
    });
  });
});
