import { describe, expect, it } from "vitest";

import {
  CreateSearchProfileRequestSchema,
  SearchIntentDraftSchema,
  SearchIntentInterpretRequestSchema
} from "./search-intent.ts";

const validDraft = {
  schemaVersion: "1" as const,
  profileName: "Boston September search",
  locationText: "Boston, MA",
  targetMonthlyBudgetDollars: 2_700,
  maximumMonthlyBudgetDollars: 2_900,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-15",
  pets: [],
  commuteAnchors: [
    {
      label: "BU",
      locationText: "Boston University",
      maximumMinutes: 35,
      mode: "transit" as const
    }
  ],
  amenities: [
    { code: "laundry_in_unit" as const, priority: "preferred" as const },
    { code: "laundry_in_building" as const, priority: "required" as const }
  ],
  ambiguities: []
};

describe("search intent contracts", () => {
  it("accepts an exact reviewed search draft", () => {
    expect(SearchIntentDraftSchema.parse(validDraft)).toEqual(validDraft);
    expect(
      CreateSearchProfileRequestSchema.parse({
        draft: validDraft,
        basedOnProfileId: null
      })
    ).toEqual({ draft: validDraft, basedOnProfileId: null });
  });

  it.each([
    ["ZIP code", "02134"],
    ["city and state", "Cambridge, MA"],
    ["punctuated city", "Coeur d'Alene, ID"]
  ])("accepts a %s location", (_name, locationText) => {
    expect(SearchIntentDraftSchema.parse({ ...validDraft, locationText }).locationText).toBe(
      locationText
    );
  });

  it.each([
    ["missing state", "Boston"],
    ["lowercase state", "Boston, ma"],
    ["state name", "Boston, Massachusetts"],
    ["ZIP plus suffix", "02134-1234"],
    ["provider URL", "https://example.com/search"]
  ])("rejects a %s location", (_name, locationText) => {
    expect(() => SearchIntentDraftSchema.parse({ ...validDraft, locationText })).toThrow();
  });

  it.each([
    ["extra draft field", { ...validDraft, rawDescription: "private" }],
    [
      "extra amenity field",
      {
        ...validDraft,
        amenities: [{ code: "laundry_in_unit", priority: "preferred", note: "private" }]
      }
    ],
    [
      "unallowlisted amenity",
      { ...validDraft, amenities: [{ code: "roof_deck", priority: "preferred" }] }
    ],
    [
      "duplicate amenity",
      {
        ...validDraft,
        amenities: [
          { code: "parking", priority: "required" },
          { code: "parking", priority: "preferred" }
        ]
      }
    ],
    ["fractional budget", { ...validDraft, maximumMonthlyBudgetDollars: 2_900.5 }],
    [
      "target over maximum",
      {
        ...validDraft,
        targetMonthlyBudgetDollars: 3_000,
        maximumMonthlyBudgetDollars: 2_900
      }
    ],
    ["reversed dates", { ...validDraft, moveInEarliest: "2026-10-01", moveInLatest: "2026-09-01" }],
    [
      "too many commute anchors",
      {
        ...validDraft,
        commuteAnchors: Array.from({ length: 6 }, (_, index) => ({
          label: `Anchor ${String(index)}`,
          locationText: `Place ${String(index)}`,
          maximumMinutes: 30,
          mode: "transit"
        }))
      }
    ]
  ])("rejects %s", (_name, draft) => {
    expect(() => SearchIntentDraftSchema.parse(draft)).toThrow();
  });

  it("allows unknown interpretation values but not an incomplete reviewed save", () => {
    const unknownDraft = {
      schemaVersion: "1" as const,
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
      ambiguities: ["Which city and state should Vera search?"]
    };

    expect(SearchIntentDraftSchema.parse(unknownDraft)).toEqual(unknownDraft);
    expect(() =>
      CreateSearchProfileRequestSchema.parse({
        draft: unknownDraft,
        basedOnProfileId: null
      })
    ).toThrow();
  });

  it("rejects arbitrary interpretation metadata and oversized input", () => {
    expect(() =>
      SearchIntentInterpretRequestSchema.parse({
        description: "One bedroom in Boston",
        metadata: { source: "browser" }
      })
    ).toThrow();
    expect(() =>
      SearchIntentInterpretRequestSchema.parse({ description: "x".repeat(2_001) })
    ).toThrow();
  });
});
