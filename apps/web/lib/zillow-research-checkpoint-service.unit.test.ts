import { SourceJobSchema, type ActivityEvent, type SourceJob } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  checkZillowResearchAction,
  parseZillowResearchCheckpointEnvironment,
  type ZillowResearchCheckpointDependencies
} from "./zillow-research-checkpoint-service.ts";

const founderUserId = "00000000-0000-4000-8000-000000000013";
const now = "2026-07-30T12:00:00.000Z";
const payload = {
  acquisitionMode: "local_browser",
  captureKind: "research_tab",
  nodeId: "remote-extension-gateway",
  profileId: "official-chrome-extension",
  startingTabReference: { kind: "target_id", value: "shared-tab-1" },
  limits: {
    maxPages: 6,
    maxRecords: 10,
    maxBytes: 250_000,
    maxDurationMilliseconds: 90_000,
    maxConcurrency: 1
  },
  maxDetailPages: 5,
  maxResultPageExpansions: 2
} as const;
const job = SourceJobSchema.parse({
  id: "run-1",
  correlationId: "run-1",
  connectorId: "zillow.browser-research.v1",
  source: "zillow",
  acquisitionMode: "local_browser",
  manifestVersion: 1,
  trigger: "manual",
  capability: "browser.capture",
  approvalId: "approval-run-1",
  operation: "zillow.rental_research.v1",
  payload,
  payloadHash: "a".repeat(64),
  idempotencyKey: "b".repeat(64),
  status: "running",
  attempts: 1,
  maxAttempts: 2,
  manualAction: null,
  deferredReason: null,
  result: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null
});
const request = {
  version: "1",
  veraRunId: "run-1",
  action: "snapshot",
  startingTabReference: { kind: "target_id", value: "shared-tab-1" },
  activeTabReference: { kind: "target_id", value: "shared-tab-1" },
  sharedTabCount: 1,
  hostname: "www.zillow.com",
  elapsedMilliseconds: 1_000,
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  resultPageExpansions: 0,
  observedReferenceHash: null,
  requestedAt: now
} as const;

function fixture(currentJob: SourceJob | null = job) {
  const activities: ActivityEvent[] = [];
  const dependencies: ZillowResearchCheckpointDependencies = {
    userId: founderUserId,
    environment: {
      founderUserId,
      sourceEnabled: true,
      browserDisabled: false
    },
    repositories: {
      sourceJobs: { getById: async () => currentJob },
      activityEvents: {
        append: async (event) => {
          activities.push(event);
          return event;
        }
      }
    },
    createId: () => `activity-${String(activities.length + 1)}`,
    now: () => now
  };
  return { activities, dependencies };
}

describe("checkZillowResearchAction", () => {
  it("authorizes an active founder run and appends a redacted action audit", async () => {
    const { activities, dependencies } = fixture();
    await expect(checkZillowResearchAction(dependencies, request)).resolves.toEqual({
      allowed: true,
      reason: "allowed",
      checkedAt: now
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      action: "browser.zillow_research_action_checked",
      policyDecision: "authorized",
      metadata: {
        protocol: "vera-zillow-research-checkpoint.v1",
        action: "snapshot",
        hostname: "www.zillow.com",
        allowed: true
      }
    });
    expect(JSON.stringify(activities[0])).not.toContain("shared-tab-1");
  });

  it("uses the server-persisted tab reference instead of trusting the caller", async () => {
    const { dependencies } = fixture();
    await expect(
      checkZillowResearchAction(dependencies, {
        ...request,
        startingTabReference: { kind: "target_id", value: "attacker-selected-tab" },
        activeTabReference: { kind: "target_id", value: "attacker-selected-tab" }
      })
    ).resolves.toMatchObject({ allowed: false, reason: "shared_tab_mismatch" });
  });

  it("denies missing, completed, and cancelled jobs", async () => {
    await expect(
      checkZillowResearchAction(fixture(null).dependencies, request)
    ).resolves.toMatchObject({ allowed: false, reason: "run_not_active" });
    await expect(
      checkZillowResearchAction(
        fixture(
          SourceJobSchema.parse({
            ...job,
            status: "cancelled_by_policy",
            completedAt: now
          })
        ).dependencies,
        request
      )
    ).resolves.toMatchObject({ allowed: false, reason: "cancelled" });
  });
});

describe("parseZillowResearchCheckpointEnvironment", () => {
  it("is founder-bound, source-disabled by default, and browser-disabled by default", () => {
    expect(
      parseZillowResearchCheckpointEnvironment({
        VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: founderUserId
      })
    ).toEqual({
      founderUserId,
      sourceEnabled: false,
      browserDisabled: true
    });
  });
});
