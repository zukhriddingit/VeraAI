import { SourceJobSchema, type ActivityEvent, type SourceJob } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  checkZillowResearchAction,
  createZillowResearchCheckpointDependencies,
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
        listByTarget: async () => activities,
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

  it("binds a safe consent reference to one exact shared tab without persisting the raw ID", async () => {
    const consentJob = SourceJobSchema.parse({
      ...job,
      payload: {
        ...payload,
        startingTabReference: {
          kind: "single_shared_tab",
          value: "explicitly_shared_zillow_rental_tab"
        }
      }
    });
    const { activities, dependencies } = fixture(consentJob);
    const consentRequest = {
      ...request,
      startingTabReference: {
        kind: "single_shared_tab",
        value: "explicitly_shared_zillow_rental_tab"
      } as const,
      activeTabReference: { kind: "target_id", value: "bound-tab-17" } as const
    };
    await expect(checkZillowResearchAction(dependencies, consentRequest)).resolves.toMatchObject({
      allowed: true
    });
    await expect(
      checkZillowResearchAction(dependencies, {
        ...consentRequest,
        activeTabReference: { kind: "target_id", value: "different-tab" }
      })
    ).resolves.toMatchObject({ allowed: false, reason: "shared_tab_mismatch" });
    expect(JSON.stringify(activities)).not.toContain("bound-tab-17");
    expect(JSON.stringify(activities)).not.toContain("different-tab");
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
  it("creates IDs through a bound Web Crypto call", () => {
    const dependencies = createZillowResearchCheckpointDependencies(
      founderUserId,
      fixture().dependencies.repositories,
      {
        VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: founderUserId,
        VERA_ZILLOW_BROWSER_RESEARCH_ENABLED: "1",
        VERA_BROWSER_DISABLED: "0"
      }
    );

    expect(dependencies.createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

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
