import type { SearchProfile } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  amenityLabel,
  createBlankSearchDraft,
  profileToSearchDraft
} from "./search-composer-model.ts";

const profile: SearchProfile = {
  id: "profile-boston-v1",
  name: "Boston fall search",
  version: 1,
  locationText: "Boston, MA",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 270_000,
  absoluteMonthlyMaximumCents: 290_050,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  petRequirements: [{ animal: "dog", required: true, notes: null }],
  commuteAnchors: [
    {
      label: "BU",
      locationText: "Boston University",
      maximumMinutes: 35,
      mode: "transit"
    }
  ],
  hardConstraints: [
    {
      field: "amenities",
      operator: "contains",
      value: "laundry_in_building",
      unknownPolicy: "reject"
    },
    {
      field: "unsupported",
      operator: "equals",
      value: true,
      unknownPolicy: "allow"
    }
  ],
  weightedPreferences: [
    {
      code: "dishwasher",
      weightBasisPoints: 10_000,
      unknownBehavior: "neutral",
      description: "Dishwasher"
    },
    {
      code: "unsupported_code",
      weightBasisPoints: 1_000,
      unknownBehavior: "neutral",
      description: "Unsupported"
    }
  ],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: "2026-07-28T18:00:00.000Z",
  updatedAt: "2026-07-28T18:00:00.000Z"
};

describe("search composer mapping", () => {
  it("creates an explicit unknown manual draft", () => {
    expect(createBlankSearchDraft()).toEqual({
      schemaVersion: "1",
      profileName: null,
      locationText: null,
      targetMonthlyBudgetDollars: null,
      maximumMonthlyBudgetDollars: null,
      minimumBedrooms: null,
      minimumBathrooms: null,
      moveInEarliest: null,
      moveInLatest: null,
      pets: [],
      commuteAnchors: [],
      amenities: [],
      ambiguities: []
    });
  });

  it("maps a saved profile into an editable allowlisted draft", () => {
    expect(profileToSearchDraft(profile)).toEqual({
      schemaVersion: "1",
      profileName: "Boston fall search",
      locationText: "Boston, MA",
      targetMonthlyBudgetDollars: 2_700,
      maximumMonthlyBudgetDollars: 2_901,
      minimumBedrooms: 1,
      minimumBathrooms: 1,
      moveInEarliest: "2026-09-01",
      moveInLatest: "2026-09-30",
      pets: ["dog"],
      commuteAnchors: profile.commuteAnchors,
      amenities: [
        { code: "laundry_in_building", priority: "required" },
        { code: "dishwasher", priority: "preferred" }
      ],
      ambiguities: []
    });
  });

  it("has stable plain-language amenity labels", () => {
    expect(amenityLabel("laundry_in_unit")).toBe("Laundry in unit");
    expect(amenityLabel("air_conditioning")).toBe("Air conditioning");
  });
});
