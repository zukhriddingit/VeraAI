import { describe, expect, it } from "vitest";

import {
  rentalResearchRecoveryLabel,
  rentalResearchRecoveryReady,
  rentalResearchRecoverySources
} from "./live-search-recovery.ts";

const failedZillow = {
  source: "zillow",
  state: "failed",
  retrievedCount: 0,
  importedCount: 0,
  rejectedCount: 0,
  manualAction: null,
  message: "Zillow stopped safely."
} as const;

describe("rentalResearchRecoveryLabel", () => {
  it("offers Continue search for a manual Zillow checkpoint", () => {
    expect(
      rentalResearchRecoveryLabel([
        {
          ...failedZillow,
          state: "manual_action_required",
          manualAction: "captcha_required",
          message: "Complete the Zillow challenge manually, then continue."
        }
      ])
    ).toBe("Continue search");
  });

  it("keeps the ordinary retry label for provider failures", () => {
    expect(rentalResearchRecoveryLabel([failedZillow])).toBe("Retry failed source");
  });

  it("allows recovery once every source has stopped browser work", () => {
    const completedRentCast = {
      source: "rentcast",
      state: "completed",
      retrievedCount: 10,
      importedCount: 10,
      rejectedCount: 0,
      manualAction: null,
      message: null
    } as const;

    expect(rentalResearchRecoverySources([completedRentCast, failedZillow])).toEqual(["zillow"]);
    expect(rentalResearchRecoveryReady([completedRentCast, failedZillow])).toBe(true);
    expect(
      rentalResearchRecoveryReady([
        completedRentCast,
        failedZillow,
        { ...completedRentCast, source: "apartments_com", state: "searching" }
      ])
    ).toBe(false);
  });
});
