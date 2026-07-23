import { describe, expect, it, vi } from "vitest";

import {
  FOUNDER_RELEASE_PHASES,
  parseFounderStagingEnvironment,
  renderSafeSmokeMarkdownReport,
  runFounderReleaseSmoke,
  serializeSafeSmokeReport,
  type FounderReleasePhaseId,
  type SmokePhaseRunner
} from "./founder-release-smoke.ts";

const validEnvironment = {
  VERA_FOUNDER_STAGING_SMOKE: "1",
  VERA_RELEASE_MANIFEST_PATH: "release-evidence/private/founder-release-manifest.json",
  MARITIME_TOKEN: "maritime-secret",
  VERA_MARITIME_WORKER_AGENT_ID: "worker-private-id",
  VERA_MARITIME_GATEWAY_AGENT_ID: "gateway-public-id",
  VERA_STAGING_BASE_URL: "https://vera-staging.example.test",
  VERA_PLAYWRIGHT_STORAGE_STATE_PATH: "/private/tmp/vera-founder-storage-state.json",
  VERA_FOUNDER_USER_ID: "00000000-0000-4000-8000-000000000001",
  VERA_OPENCLAW_APPROVED_ZILLOW_URL:
    "https://www.zillow.com/homedetails/123-Test-St-Unit-4/123456_zpid/",
  VERA_OPENCLAW_NODE_ID: "founder-node-id",
  VERA_OPENCLAW_PROFILE_ID: "vera-zillow",
  OPENCLAW_GATEWAY_URL: "wss://openclaw-staging.example.test",
  OPENCLAW_GATEWAY_TOKEN: "gateway-secret"
} as const;

describe("founder release smoke environment", () => {
  it("refuses live execution without the exact explicit flag", () => {
    expect(() => parseFounderStagingEnvironment({})).toThrow(
      "VERA_FOUNDER_STAGING_SMOKE must be exactly 1."
    );
    expect(() =>
      parseFounderStagingEnvironment({ ...validEnvironment, VERA_FOUNDER_STAGING_SMOKE: "true" })
    ).toThrow("VERA_FOUNDER_STAGING_SMOKE must be exactly 1.");
  });

  it("requires immutable identity and protected local inputs", () => {
    const environment = parseFounderStagingEnvironment(validEnvironment);

    expect(environment.releaseManifestPath).toContain("founder-release-manifest.json");
    expect(environment.stagingBaseUrl).toBe("https://vera-staging.example.test/");
    expect(environment.gatewayWebSocketUrl).toBe("wss://openclaw-staging.example.test/");
    expect(environment.gatewayUrl).toBe("https://openclaw-staging.example.test/");
    expect(environment.sensitiveValues).toContain("maritime-secret");
    expect(environment.sensitiveValues).toContain("founder-node-id");
  });

  it.each([
    ["VERA_STAGING_BASE_URL", "http://vera-staging.example.test"],
    ["OPENCLAW_GATEWAY_URL", "wss://token@example.test"],
    ["VERA_PLAYWRIGHT_STORAGE_STATE_PATH", "tmp/storage.json"],
    ["VERA_FOUNDER_USER_ID", "not-a-uuid"],
    ["VERA_OPENCLAW_APPROVED_ZILLOW_URL", "https://example.test/listing/1"]
  ])("rejects unsafe %s", (name, value) => {
    expect(() => parseFounderStagingEnvironment({ ...validEnvironment, [name]: value })).toThrow();
  });
});

describe("founder release phase runner", () => {
  it("runs every phase in fixed order and continues negative controls after a failure", async () => {
    const calls: FounderReleasePhaseId[] = [];
    const phaseRunners = Object.fromEntries(
      FOUNDER_RELEASE_PHASES.map(({ id }) => [
        id,
        vi.fn(async () => {
          calls.push(id);
          return id === "exact_current_tab_capture"
            ? { status: "failed" as const, code: "capture_failed" }
            : { status: "passed" as const, code: `${id}_passed` };
        })
      ])
    ) as Record<FounderReleasePhaseId, SmokePhaseRunner>;

    const report = await runFounderReleaseSmoke({
      phaseRunners,
      now: () => new Date("2026-07-22T12:00:00.000Z")
    });

    expect(calls).toEqual(FOUNDER_RELEASE_PHASES.map(({ id }) => id));
    expect(report.phases.find(({ id }) => id === "gateway_unauthorized")?.status).toBe("passed");
    expect(report.phases.find(({ id }) => id === "source_kill_switch")?.status).toBe("passed");
    expect(report.outcome).toBe("failed");
  });

  it("turns thrown errors and omitted runners into safe blocking results", async () => {
    const report = await runFounderReleaseSmoke({
      phaseRunners: {
        release_manifest: async () => {
          throw new Error("Bearer maritime-secret https://private.test/?token=secret");
        }
      },
      now: () => new Date("2026-07-22T12:00:00.000Z")
    });

    expect(report.phases[0]).toMatchObject({
      id: "release_manifest",
      status: "failed",
      code: "phase_runner_threw"
    });
    expect(report.phases[1]).toMatchObject({
      status: "skipped_with_blocker",
      code: "phase_dependency_not_configured"
    });
    expect(JSON.stringify(report)).not.toContain("maritime-secret");
    expect(report.outcome).toBe("failed");
  });
});

describe("founder release report sanitization", () => {
  const rawReport = {
    outcome: "failed",
    phases: [
      {
        id: "result_integrity_denial",
        status: "passed",
        code: "payload_hash_mismatch",
        detail:
          "Bearer maritime-secret gateway-secret session-cookie user@example.test +1 617 555 0100 postgresql://vera:secret@db.test/vera?sslmode=require https://private.test/path?token=secret"
      }
    ],
    accessToken: "maritime-secret"
  };

  it("redacts configured secrets and contact, credential, and query-shaped values", () => {
    const report = serializeSafeSmokeReport(rawReport, [
      "maritime-secret",
      "gateway-secret",
      "session-cookie"
    ]);

    expect(report).not.toMatch(
      /maritime-secret|gateway-secret|session-cookie|user@example\.test|617 555 0100|postgresql:\/\/|token=secret/u
    );
    expect(report).toContain("payload_hash_mismatch");
    expect(report).toContain("[redacted]");
  });

  it("renders a safe Markdown phase table without raw details", () => {
    const report = renderSafeSmokeMarkdownReport(rawReport, ["maritime-secret"]);

    expect(report).toContain("payload_hash_mismatch");
    expect(report).not.toContain("user@example.test");
    expect(report).not.toContain("token=secret");
  });
});
