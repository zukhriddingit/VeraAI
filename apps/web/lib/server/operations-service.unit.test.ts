import type { MaritimeOperationsRepository, UserRepositories } from "@vera/db";
import { MaritimeControlPlaneError } from "@vera/connectors";
import { describe, expect, it } from "vitest";

import { loadOperationsSnapshot } from "./operations-service.ts";

const NOW = "2026-07-22T12:00:00.000Z";

describe("operations snapshot", () => {
  it("shows a persisted gateway restart when live Maritime status is unavailable", async () => {
    const repositories = {
      sourceJobs: { list: async () => [] },
      productionSchedules: { list: async () => [], listRuns: async () => [] },
      notificationDeliveries: { list: async () => [] },
      browserNodes: { list: async () => [] },
      sourcePolicyManifests: { listLatest: async () => [] }
    } as unknown as UserRepositories;
    const globalOperations = {
      async listDeployments() {
        return [
          {
            id: "gateway-deployment",
            kind: "openclaw_gateway" as const,
            maritimeAgentId: "gateway-agent",
            environment: "staging" as const,
            status: "restarting" as const,
            version: "2026.6.33",
            diagnosticUrl: null,
            lastCheckedAt: NOW,
            safeErrorCode: null,
            createdAt: NOW,
            updatedAt: NOW
          }
        ];
      },
      async listHeartbeats() {
        return [];
      }
    } as unknown as MaritimeOperationsRepository;

    await expect(
      loadOperationsSnapshot({
        repositories,
        globalOperations,
        environment: {},
        now: () => new Date(NOW)
      })
    ).resolves.toMatchObject({ gateway: { status: "restarting", version: "2026.6.33" } });
  });

  it("keeps typed Maritime failures visible instead of treating them as empty status", async () => {
    const repositories = {
      sourceJobs: { list: async () => [] },
      productionSchedules: { list: async () => [], listRuns: async () => [] },
      notificationDeliveries: { list: async () => [] },
      browserNodes: { list: async () => [] },
      sourcePolicyManifests: { listLatest: async () => [] }
    } as unknown as UserRepositories;

    await expect(
      loadOperationsSnapshot({
        repositories,
        environment: {
          VERA_MARITIME_WORKER_AGENT_ID: "worker",
          VERA_MARITIME_GATEWAY_AGENT_ID: "gateway"
        },
        maritimeClient: {
          async wake() {
            throw new Error("not used");
          },
          async getStatus() {
            throw new MaritimeControlPlaneError("maritime_rate_limited", true);
          },
          async getDiagnostics() {
            return [];
          }
        },
        now: () => new Date(NOW)
      })
    ).resolves.toMatchObject({
      maritime: { status: "unknown", safeCode: "maritime_rate_limited" },
      gateway: { status: "unknown", version: "unverified", safeCode: "maritime_rate_limited" }
    });
  });
});
