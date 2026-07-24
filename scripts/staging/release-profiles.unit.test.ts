import { describe, expect, it } from "vitest";

import {
  RELEASE_PROFILES,
  RELEASE_PHASES,
  capabilitiesMatchProfile,
  classifyRequiredPhaseStates,
  type ReleasePhaseId,
  type ReleasePhaseResultState
} from "./release-profiles.ts";

function states(
  resultState: ReleasePhaseResultState,
  configurationBlockerValid = resultState === "blocked_missing_configuration"
) {
  return RELEASE_PROFILES.founder_core.requiredPhaseIds.map((phaseId) => ({
    phaseId,
    resultState,
    configurationBlockerValid
  }));
}

function replace(
  input: ReturnType<typeof states>,
  phaseId: ReleasePhaseId,
  resultState: ReleasePhaseResultState,
  configurationBlockerValid = resultState === "blocked_missing_configuration"
) {
  return input.map((state) =>
    state.phaseId === phaseId ? { phaseId, resultState, configurationBlockerValid } : state
  );
}

describe("founder release profiles", () => {
  it("defines the exact capability sets and substitutes browser-disabled proof for core", () => {
    expect(RELEASE_PROFILES.founder_core.capabilities).toEqual({
      browserCapture: false,
      directCapture: true,
      gmailAlerts: true,
      calendar: true,
      webPush: true,
      maritimeWorker: true
    });
    expect(RELEASE_PROFILES.founder_browser_experimental.capabilities).toEqual({
      browserCapture: true,
      directCapture: true,
      gmailAlerts: true,
      calendar: true,
      webPush: true,
      maritimeWorker: true
    });
    expect(RELEASE_PROFILES.founder_core.requiredPhaseIds).toContain(
      "browser_global_kill_switch_enabled"
    );
    expect(RELEASE_PROFILES.founder_core.requiredPhaseIds).not.toContain(
      "founder_positive_current_tab_capture"
    );
    expect(RELEASE_PROFILES.founder_browser_experimental.requiredPhaseIds).toContain(
      "founder_positive_current_tab_capture"
    );
    expect(RELEASE_PROFILES.founder_browser_experimental.releaseEligible).toBe(false);
  });

  it("requires a closed capability object that exactly matches the selected profile", () => {
    expect(
      capabilitiesMatchProfile("founder_core", RELEASE_PROFILES.founder_core.capabilities)
    ).toBe(true);
    expect(
      capabilitiesMatchProfile(
        "founder_core",
        RELEASE_PROFILES.founder_browser_experimental.capabilities
      )
    ).toBe(false);
    expect(
      capabilitiesMatchProfile("founder_core", {
        ...RELEASE_PROFILES.founder_core.capabilities,
        arbitrary: true
      })
    ).toBe(false);
  });

  it.each([
    ["all automated passes", states("passed_automated"), "go_founder_only_core_beta"],
    ["all manual passes", states("passed_manual_evidence"), "go_founder_only_core_beta"],
    [
      "passes plus one valid configuration blocker",
      replace(states("passed_automated"), "postgresql_restore", "blocked_missing_configuration"),
      "conditional_go_founder_only_staging"
    ],
    [
      "all eligible live phases blocked and static phases passed",
      RELEASE_PROFILES.founder_core.requiredPhaseIds.map((phaseId) => ({
        phaseId,
        resultState: RELEASE_PHASES[phaseId].configurationBlockerAllowed
          ? ("blocked_missing_configuration" as const)
          : ("passed_automated" as const),
        configurationBlockerValid: RELEASE_PHASES[phaseId].configurationBlockerAllowed
      })),
      "conditional_go_founder_only_staging"
    ],
    [
      "failed assertion",
      replace(states("passed_automated"), "direct_capture", "failed_assertion"),
      "no_go"
    ],
    [
      "failed provider",
      replace(states("passed_automated"), "web_push_delivery", "failed_provider"),
      "no_go"
    ],
    [
      "mandatory N/A",
      replace(
        states("passed_automated"),
        "gmail_readonly_verification",
        "not_applicable_with_approved_reason"
      ),
      "no_go"
    ],
    [
      "invalid configuration blocker",
      replace(
        states("passed_automated"),
        "postgresql_restore",
        "blocked_missing_configuration",
        false
      ),
      "no_go"
    ],
    [
      "configuration blocker on a static phase",
      replace(
        states("passed_automated"),
        "release_static_readiness",
        "blocked_missing_configuration"
      ),
      "no_go"
    ]
  ])("classifies %s", (_label, phaseStates, expected) => {
    expect(classifyRequiredPhaseStates("founder_core", phaseStates)).toBe(expected);
  });

  it("rejects missing, duplicate, and unexpected phase rows", () => {
    const complete = states("passed_automated");
    expect(classifyRequiredPhaseStates("founder_core", complete.slice(1))).toBe("no_go");
    expect(classifyRequiredPhaseStates("founder_core", [...complete, complete[0]!])).toBe("no_go");
    expect(
      classifyRequiredPhaseStates("founder_core", [
        ...complete.slice(1),
        {
          phaseId: "gateway_restart",
          resultState: "passed_automated"
        }
      ])
    ).toBe("no_go");
  });

  it("keeps browser experimental no-go even if every required phase passes", () => {
    const browserStates = RELEASE_PROFILES.founder_browser_experimental.requiredPhaseIds.map(
      (phaseId) => ({ phaseId, resultState: "passed_automated" as const })
    );
    expect(classifyRequiredPhaseStates("founder_browser_experimental", browserStates)).toBe(
      "no_go"
    );
  });
});
