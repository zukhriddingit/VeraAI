import { MaritimeControlPlaneError, type MaritimeControlPlaneClient } from "@vera/connectors";
import type { MaritimeDeployment, ServiceHeartbeat } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { reconcileHostedHealth } from "./health-reconciliation.ts";

const NOW = new Date("2026-07-22T12:00:00.000Z");

describe("hosted health reconciliation", () => {
  it("persists a visible unavailable gateway instead of treating provider failure as healthy", async () => {
    const deployments: MaritimeDeployment[] = [];
    const heartbeats: ServiceHeartbeat[] = [];
    const client: MaritimeControlPlaneClient = {
      wake: vi.fn(),
      getDiagnostics: vi.fn(async () => []),
      getStatus: vi.fn(async (agentId: string) => {
        if (agentId === "gateway-agent") {
          throw new MaritimeControlPlaneError("maritime_unavailable", true);
        }
        return {
          agentId,
          status: "running" as const,
          version: "maritime-sdk@0.5.0",
          diagnosticUrl: null,
          checkedAt: NOW.toISOString()
        };
      })
    };
    await reconcileHostedHealth({
      operations: {
        async upsertDeployment(value) {
          deployments.push(value);
          return value;
        },
        async listDeployments() {
          return deployments;
        },
        async upsertHeartbeat(value) {
          heartbeats.push(value);
          return value;
        },
        async listHeartbeats() {
          return heartbeats;
        }
      },
      client,
      workerAgentId: "worker-agent",
      gatewayAgentId: "gateway-agent",
      environment: "staging",
      now: () => NOW
    });

    expect(deployments.find(({ kind }) => kind === "openclaw_gateway")).toMatchObject({
      status: "unavailable",
      version: "unverified",
      safeErrorCode: "maritime_unavailable"
    });
    expect(heartbeats.find(({ service }) => service === "openclaw-gateway")).toMatchObject({
      status: "unavailable",
      version: "unverified",
      safeCode: "maritime_unavailable"
    });
  });

  it("does not misreport the SDK client version as the observed OpenClaw version", async () => {
    const deployments: MaritimeDeployment[] = [];
    const heartbeats: ServiceHeartbeat[] = [];
    const client: MaritimeControlPlaneClient = {
      wake: vi.fn(),
      getDiagnostics: vi.fn(async () => []),
      getStatus: vi.fn(async (agentId: string) => ({
        agentId,
        status: "running" as const,
        version: "maritime-sdk@0.5.0",
        diagnosticUrl: null,
        checkedAt: NOW.toISOString()
      }))
    };

    await reconcileHostedHealth({
      operations: {
        async upsertDeployment(value) {
          deployments.push(value);
          return value;
        },
        async listDeployments() {
          return deployments;
        },
        async upsertHeartbeat(value) {
          heartbeats.push(value);
          return value;
        },
        async listHeartbeats() {
          return heartbeats;
        }
      },
      client,
      workerAgentId: "worker-agent",
      gatewayAgentId: "gateway-agent",
      environment: "staging",
      now: () => NOW
    });

    expect(deployments.find(({ kind }) => kind === "openclaw_gateway")?.version).toBe("unverified");
    expect(heartbeats.find(({ service }) => service === "openclaw-gateway")?.version).toBe(
      "unverified"
    );
  });
});
