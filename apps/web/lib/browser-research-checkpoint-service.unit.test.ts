import {
  SourceJobSchema,
  type ActivityEvent,
  type SearchProfile,
  type SourceJob
} from "@vera/domain";
import { APARTMENTS_BROWSER_SOURCE_ADAPTER } from "@vera/connectors";
import { describe, expect, it } from "vitest";

import {
  checkBrowserResearchAction,
  parseBrowserResearchCheckpointEnvironment,
  type BrowserResearchCheckpointDependencies
} from "./browser-research-checkpoint-service.ts";

const founderUserId = "00000000-0000-4000-8000-000000000013";
const now = "2026-08-04T15:00:00.000Z";
const signingKey = "generic-browser-checkpoint-test-key-00000000000000000";
const profile: SearchProfile = {
  id: "profile-1",
  name: "Boston",
  version: 1,
  locationText: "Boston, MA",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 300_000,
  absoluteMonthlyMaximumCents: 300_000,
  moveInEarliest: null,
  moveInLatest: null,
  petRequirements: [],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: now,
  updatedAt: now
};
const plan = APARTMENTS_BROWSER_SOURCE_ADAPTER.createPlan({
  veraRunId: "run-apartments-1",
  profile,
  startingTabReference: {
    kind: "single_shared_tab",
    value: "explicitly_shared_zillow_rental_tab"
  },
  signingKey,
  issuedAt: new Date(now)
});
const job = SourceJobSchema.parse({
  id: plan.veraRunId,
  correlationId: "parent-run-1",
  connectorId: APARTMENTS_BROWSER_SOURCE_ADAPTER.connectorId,
  source: "apartments_com",
  acquisitionMode: "local_browser",
  manifestVersion: 1,
  trigger: "manual",
  capability: "browser.capture",
  approvalId: "approval-run-apartments-1",
  operation: APARTMENTS_BROWSER_SOURCE_ADAPTER.operation,
  payload: {
    acquisitionMode: "local_browser",
    captureKind: "research_tab",
    nodeId: "remote-extension-gateway",
    profileId: "official-chrome-extension",
    startingTabReference: plan.startingTabReference,
    limits: {
      maxPages: 6,
      maxRecords: 10,
      maxBytes: 250_000,
      maxDurationMilliseconds: 90_000,
      maxConcurrency: 1
    },
    maxDetailPages: 5,
    maxResultPageExpansions: 2
  },
  payloadHash: "a".repeat(64),
  idempotencyKey: "b".repeat(64),
  status: "running",
  attempts: 1,
  maxAttempts: 1,
  manualAction: null,
  deferredReason: null,
  result: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null
});
const request = {
  version: "1",
  plan,
  action: "snapshot",
  activeTabReference: plan.startingTabReference,
  sharedTabCount: 1,
  hostname: "www.apartments.com",
  elapsedMilliseconds: 1_000,
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  actionsUsed: 1,
  requestedAt: now
} as const;

function fixture(currentJob: SourceJob | null = job) {
  const activities: ActivityEvent[] = [];
  const dependencies: BrowserResearchCheckpointDependencies = {
    userId: founderUserId,
    environment: {
      founderUserId,
      enabledSources: new Set(["apartments_com"]),
      browserDisabled: false,
      planSigningKey: signingKey
    },
    repositories: {
      sourceJobs: { getById: async () => currentJob },
      activityEvents: {
        append: async (activity) => {
          activities.push(activity);
          return activity;
        }
      }
    },
    createId: () => `activity-${String(activities.length + 1)}`,
    now: () => now
  };
  return { activities, dependencies };
}

describe("checkBrowserResearchAction", () => {
  it("authorizes a signed active founder run and records only redacted tab evidence", async () => {
    const { activities, dependencies } = fixture();
    await expect(checkBrowserResearchAction(dependencies, request)).resolves.toEqual({
      allowed: true,
      reason: "allowed",
      checkedAt: now
    });
    expect(activities[0]).toMatchObject({
      action: "browser.research_action_checked",
      policyDecision: "authorized",
      metadata: {
        protocol: "vera-browser-research-checkpoint.v1",
        source: "apartments_com",
        action: "snapshot"
      }
    });
    expect(JSON.stringify(activities[0])).not.toContain("explicitly_shared_zillow_rental_tab");
    expect(JSON.stringify(activities[0])).not.toContain(signingKey);
  });

  it("denies a modified signature, disabled source, and cancelled job", async () => {
    await expect(
      checkBrowserResearchAction(fixture().dependencies, {
        ...request,
        plan: { ...plan, signature: "c".repeat(64) }
      })
    ).resolves.toMatchObject({ allowed: false, reason: "plan_signature_invalid" });
    const configured = fixture().dependencies;
    const disabled: BrowserResearchCheckpointDependencies = {
      ...configured,
      environment: { ...configured.environment, enabledSources: new Set() }
    };
    await expect(checkBrowserResearchAction(disabled, request)).resolves.toMatchObject({
      allowed: false,
      reason: "source_disabled"
    });
    const cancelled = SourceJobSchema.parse({
      ...job,
      status: "cancelled_by_policy",
      completedAt: now
    });
    await expect(
      checkBrowserResearchAction(fixture(cancelled).dependencies, request)
    ).resolves.toMatchObject({
      allowed: false,
      reason: "cancelled"
    });
  });
});

describe("parseBrowserResearchCheckpointEnvironment", () => {
  it("is founder-bound and every source is disabled by default", () => {
    const environment = parseBrowserResearchCheckpointEnvironment({
      VERA_BROWSER_GATEWAY_FOUNDER_USER_ID: founderUserId,
      VERA_BROWSER_DISABLED: "0",
      VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY: signingKey
    });
    expect(environment.founderUserId).toBe(founderUserId);
    expect(environment.enabledSources.size).toBe(0);
    expect(environment.browserDisabled).toBe(false);
  });
});
