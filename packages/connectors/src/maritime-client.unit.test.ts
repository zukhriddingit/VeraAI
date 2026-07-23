import { describe, expect, it, vi } from "vitest";

import {
  SdkMaritimeControlPlaneClient,
  type MaritimeControlPlaneError,
  type MaritimeSdkBoundary
} from "./maritime-client.ts";

const AGENT = {
  id: "agent-worker-1",
  name: "vera-worker",
  framework: "maritime",
  tier: "extended" as const,
  status: "active" as const,
  invocationCount: 1,
  totalComputeSeconds: 10,
  description: null,
  externalId: null,
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z"
};

describe("Maritime SDK client boundary", () => {
  it("wakes by agent ID without serializing a Vera job payload", async () => {
    const sdk: MaritimeSdkBoundary = {
      agents: {
        start: vi.fn(async () => AGENT),
        get: vi.fn(async () => AGENT),
        logs: vi.fn(async () => [])
      }
    };
    const client = new SdkMaritimeControlPlaneClient(sdk);
    await expect(client.wake("agent-worker-1")).resolves.toMatchObject({ status: "running" });
    expect(sdk.agents.start).toHaveBeenCalledWith("agent-worker-1");
    expect(JSON.stringify(vi.mocked(sdk.agents.start).mock.calls)).not.toMatch(
      /listing|cookie|oauth|snapshot|refresh_token/iu
    );
  });

  it("does not mislabel a public application URL as a diagnostic reference", async () => {
    const sdk: MaritimeSdkBoundary = {
      agents: {
        start: vi.fn(async () => ({ ...AGENT, publicUrl: "https://public.example.test" })),
        get: vi.fn(async () => ({ ...AGENT, publicUrl: "https://public.example.test" })),
        logs: vi.fn(async () => [])
      }
    };
    const client = new SdkMaritimeControlPlaneClient(sdk);

    await expect(client.getStatus("agent-worker-1")).resolves.toMatchObject({
      diagnosticUrl: null
    });
  });

  it("maps rate limits to a typed retryable error", async () => {
    const sdk: MaritimeSdkBoundary = {
      agents: {
        start: vi.fn(async () => {
          const error = new Error("rate limited") as Error & { status: number };
          error.status = 429;
          throw error;
        }),
        get: vi.fn(async () => AGENT),
        logs: vi.fn(async () => [])
      }
    };
    const client = new SdkMaritimeControlPlaneClient(sdk);
    await expect(client.wake("agent-worker-1")).rejects.toEqual(
      expect.objectContaining<Partial<MaritimeControlPlaneError>>({
        code: "maritime_rate_limited",
        retryable: true
      })
    );
  });

  it("returns sanitized log projections only", async () => {
    const sdk: MaritimeSdkBoundary = {
      agents: {
        start: vi.fn(async () => AGENT),
        get: vi.fn(async () => AGENT),
        logs: vi.fn(async () => [
          {
            id: "log-1",
            level: "info",
            message: "worker ready token=not-returned",
            source: "worker",
            timestamp: "2026-07-22T12:00:00.000Z"
          }
        ])
      }
    };
    const client = new SdkMaritimeControlPlaneClient(sdk);
    await expect(client.getDiagnostics("agent-worker-1")).resolves.toEqual([
      {
        id: "log-1",
        level: "info",
        source: "worker",
        timestamp: "2026-07-22T12:00:00.000Z"
      }
    ]);
  });
});
