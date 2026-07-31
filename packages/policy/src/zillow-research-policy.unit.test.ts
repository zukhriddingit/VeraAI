import {
  ZillowResearchCheckpointRequestSchema,
  type ZillowResearchCheckpointRequest
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import { evaluateZillowResearchAction } from "./zillow-research-policy.ts";

const now = "2026-07-30T12:00:00.000Z";
const checkpoint = ZillowResearchCheckpointRequestSchema.parse({
  version: "1",
  veraRunId: "run-1",
  action: "snapshot",
  startingTabReference: { kind: "target_id", value: "tab-1" },
  activeTabReference: { kind: "target_id", value: "tab-1" },
  sharedTabCount: 1,
  hostname: "www.zillow.com",
  elapsedMilliseconds: 1_000,
  resultCardsObserved: 0,
  detailPagesOpened: 0,
  resultPageExpansions: 0,
  observedReferenceHash: null,
  requestedAt: now
});
const runtime = {
  founderAuthorized: true,
  sourceEnabled: true,
  userTriggered: true,
  browserKillSwitchActive: false,
  runActive: true,
  cancelled: false,
  hasUserSession: true,
  hasApproval: true
} as const;

function evaluate(
  changes: Partial<ZillowResearchCheckpointRequest> = {},
  runtimeChanges: Partial<typeof runtime> = {}
) {
  return evaluateZillowResearchAction({
    checkpoint: { ...checkpoint, ...changes },
    runtime: { ...runtime, ...runtimeChanges },
    checkedAt: now
  });
}

describe("evaluateZillowResearchAction", () => {
  it("allows one reviewed user-triggered founder action", () => {
    expect(evaluate()).toEqual({ allowed: true, reason: "allowed", checkedAt: now });
  });

  it.each([
    ["founderAuthorized", false, "founder_denied"],
    ["sourceEnabled", false, "source_disabled"],
    ["userTriggered", false, "user_trigger_required"],
    ["browserKillSwitchActive", true, "browser_kill_switch_active"],
    ["runActive", false, "run_not_active"],
    ["cancelled", true, "cancelled"],
    ["hasUserSession", false, "source_policy_denied"],
    ["hasApproval", false, "source_policy_denied"]
  ] as const)("fails closed when %s is %s", (key, value, reason) => {
    expect(evaluate({}, { [key]: value })).toMatchObject({ allowed: false, reason });
  });

  it("requires one exact shared tab on the reviewed host", () => {
    expect(evaluate({ sharedTabCount: 0 })).toMatchObject({
      allowed: false,
      reason: "single_shared_tab_required"
    });
    expect(evaluate({ sharedTabCount: 2 })).toMatchObject({
      allowed: false,
      reason: "single_shared_tab_required"
    });
    expect(
      evaluate({ activeTabReference: { kind: "target_id", value: "different-tab" } })
    ).toMatchObject({ allowed: false, reason: "shared_tab_mismatch" });
    expect(evaluate({ hostname: "zillow.com" })).toMatchObject({
      allowed: false,
      reason: "hostname_not_allowed"
    });
  });

  it("enforces duration, result, detail, and expansion budgets", () => {
    expect(evaluate({ elapsedMilliseconds: 90_000 })).toMatchObject({
      allowed: false,
      reason: "run_limit_exceeded"
    });
    expect(evaluate({ resultCardsObserved: 11 })).toMatchObject({
      allowed: false,
      reason: "run_limit_exceeded"
    });
    expect(evaluate({ action: "open_observed_listing", detailPagesOpened: 5 })).toMatchObject({
      allowed: false,
      reason: "run_limit_exceeded"
    });
    expect(evaluate({ action: "scroll_bounded", resultPageExpansions: 2 })).toMatchObject({
      allowed: false,
      reason: "run_limit_exceeded"
    });
  });

  it("rejects every arbitrary or forbidden action at the strict boundary", () => {
    for (const action of [
      "evaluate",
      "coordinate_click",
      "screenshot",
      "download",
      "upload",
      "contact",
      "apply",
      "request_tour",
      "message",
      "payment",
      "login"
    ]) {
      expect(
        ZillowResearchCheckpointRequestSchema.safeParse({ ...checkpoint, action }).success
      ).toBe(false);
    }
  });
});
