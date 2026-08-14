import {
  BrowserResearchCheckpointRequestSchema,
  BrowserResearchPlanSchema,
  BrowserResearchSourcePolicy,
  configuredBrowserResearchPolicy
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import { evaluateBrowserResearchAction } from "./browser-research-policy.ts";

const requestedAt = "2026-08-04T14:00:05.000Z";
const checkedAt = "2026-08-04T14:00:05.100Z";

function plan(source: "apartments_com" | "facebook_marketplace" = "apartments_com") {
  const policy = BrowserResearchSourcePolicy[source];
  return BrowserResearchPlanSchema.parse({
    version: "1",
    veraRunId: "research-run-1",
    source,
    profile: {
      location: "Boston, MA",
      maximumRentUsd: 2_900,
      minimumBedrooms: 1,
      minimumBathrooms: 1
    },
    maxResults: 10,
    maxDetailPages: policy.maxDetailPages,
    maxActions: 50,
    maxDurationMilliseconds: 90_000,
    startingTabReference: {
      kind: "single_shared_tab",
      value: "explicitly_shared_zillow_rental_tab"
    },
    allowedHostnames: [...policy.hostnames],
    allowedUrlPatterns: [...policy.urlPatterns],
    enabledSafeActionTypes: [
      "inspect_shared_tabs",
      "navigate_same_source",
      "snapshot",
      "scroll_bounded",
      "select_reviewed_filter",
      "fill_approved_search_field",
      "open_observed_listing",
      "return_to_results",
      "extract_observed_facts"
    ],
    issuedAt: "2026-08-04T14:00:00.000Z",
    expiresAt: "2026-08-04T14:02:00.000Z",
    signature: "a".repeat(64)
  });
}

function checkpoint(overrides: Record<string, unknown> = {}) {
  const researchPlan = plan();
  return BrowserResearchCheckpointRequestSchema.parse({
    version: "1",
    plan: researchPlan,
    action: "snapshot",
    activeTabReference: researchPlan.startingTabReference,
    sharedTabCount: 1,
    hostname: "www.apartments.com",
    elapsedMilliseconds: 1_000,
    resultCardsObserved: 0,
    detailPagesOpened: 0,
    actionsUsed: 1,
    requestedAt,
    ...overrides
  });
}

function customCheckpoint(hostname = "housing.example.edu") {
  const configuration = {
    sourceId: "custom:housing.example.edu",
    displayName: "Example Housing",
    adapterKind: "generic" as const,
    startingUrl: "https://housing.example.edu/search",
    allowedDomain: "housing.example.edu",
    loginRequired: "unknown" as const,
    defaultInclude: false
  };
  const policy = configuredBrowserResearchPolicy(configuration);
  const researchPlan = BrowserResearchPlanSchema.parse({
    ...plan(),
    source: "custom_website",
    sourceConfiguration: configuration,
    maxDetailPages: 3,
    allowedHostnames: [...policy.hostnames],
    allowedUrlPatterns: [...policy.urlPatterns]
  });
  return BrowserResearchCheckpointRequestSchema.parse({
    version: "1",
    plan: researchPlan,
    action: "snapshot",
    activeTabReference: researchPlan.startingTabReference,
    sharedTabCount: 1,
    hostname,
    elapsedMilliseconds: 1_000,
    resultCardsObserved: 0,
    detailPagesOpened: 0,
    actionsUsed: 1,
    requestedAt
  });
}

const authorizedRuntime = {
  assignmentAuthorized: true,
  sourceEnabled: true,
  userTriggered: true,
  browserKillSwitchActive: false,
  runActive: true,
  cancelled: false,
  hasUserSession: true,
  hasApproval: true,
  planSignatureValid: true
} as const;

describe("generic browser-research action policy", () => {
  it("allows only an active signed assigned plan on its exact source host", () => {
    expect(
      evaluateBrowserResearchAction({
        checkpoint: checkpoint(),
        runtime: authorizedRuntime,
        checkedAt
      })
    ).toEqual({ allowed: true, reason: "allowed", checkedAt });
  });

  it.each([
    [{ assignmentAuthorized: false }, "assignment_denied"],
    [{ sourceEnabled: false }, "source_disabled"],
    [{ browserKillSwitchActive: true }, "browser_kill_switch_active"],
    [{ cancelled: true }, "cancelled"],
    [{ planSignatureValid: false }, "plan_signature_invalid"]
  ] as const)("fails closed when runtime authorization changes", (override, reason) => {
    expect(
      evaluateBrowserResearchAction({
        checkpoint: checkpoint(),
        runtime: { ...authorizedRuntime, ...override },
        checkedAt
      })
    ).toMatchObject({ allowed: false, reason });
  });

  it("denies a second shared tab, a cross-source host, and exhausted limits", () => {
    expect(
      evaluateBrowserResearchAction({
        checkpoint: checkpoint({ sharedTabCount: 2 }),
        runtime: authorizedRuntime,
        checkedAt
      }).reason
    ).toBe("single_shared_tab_required");
    expect(
      evaluateBrowserResearchAction({
        checkpoint: checkpoint({ hostname: "www.facebook.com" }),
        runtime: authorizedRuntime,
        checkedAt
      }).reason
    ).toBe("hostname_not_allowed");
    expect(
      evaluateBrowserResearchAction({
        checkpoint: checkpoint({ actionsUsed: 50 }),
        runtime: authorizedRuntime,
        checkedAt
      }).reason
    ).toBe("run_limit_exceeded");
  });

  it("authorizes a signed custom source only on its exact configured domain", () => {
    expect(
      evaluateBrowserResearchAction({
        checkpoint: customCheckpoint(),
        runtime: authorizedRuntime,
        checkedAt
      })
    ).toEqual({ allowed: true, reason: "allowed", checkedAt });
    expect(
      evaluateBrowserResearchAction({
        checkpoint: customCheckpoint("housing.example.edu.evil.test"),
        runtime: authorizedRuntime,
        checkedAt
      }).reason
    ).toBe("hostname_not_allowed");
  });

  it.each([
    "contact",
    "apply",
    "tour",
    "message",
    "phone",
    "email",
    "payment",
    "upload",
    "download"
  ])("does not represent the forbidden %s action", (action) => {
    expect(() => checkpoint({ action })).toThrow();
  });
});
