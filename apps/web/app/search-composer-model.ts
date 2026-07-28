import {
  SearchAmenityCodeSchema,
  type SearchAmenityCode,
  type SearchIntentDraft,
  type SearchProfile
} from "@vera/domain";

const AMENITY_LABELS: Readonly<Record<SearchAmenityCode, string>> = {
  laundry_in_unit: "Laundry in unit",
  laundry_in_building: "Laundry in building",
  parking: "Parking",
  dishwasher: "Dishwasher",
  air_conditioning: "Air conditioning",
  elevator: "Elevator",
  outdoor_space: "Outdoor space"
};

export function amenityLabel(code: SearchAmenityCode): string {
  return AMENITY_LABELS[code];
}

export function createBlankSearchDraft(): SearchIntentDraft {
  return {
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
  };
}

function dollarsFromCents(cents: number | null, mode: "target" | "maximum"): number | null {
  if (cents === null) return null;
  return mode === "maximum" ? Math.ceil(cents / 100) : Math.round(cents / 100);
}

export function profileToSearchDraft(profile: SearchProfile): SearchIntentDraft {
  const requiredAmenities = profile.hardConstraints.flatMap((constraint) => {
    if (
      constraint.field !== "amenities" ||
      constraint.operator !== "contains" ||
      typeof constraint.value !== "string"
    ) {
      return [];
    }
    const parsed = SearchAmenityCodeSchema.safeParse(constraint.value);
    return parsed.success ? [{ code: parsed.data, priority: "required" as const }] : [];
  });
  const requiredCodes = new Set(requiredAmenities.map(({ code }) => code));
  const preferredAmenities = profile.weightedPreferences.flatMap((preference) => {
    const parsed = SearchAmenityCodeSchema.safeParse(preference.code);
    return parsed.success && !requiredCodes.has(parsed.data)
      ? [{ code: parsed.data, priority: "preferred" as const }]
      : [];
  });

  return {
    schemaVersion: "1",
    profileName: profile.name,
    locationText: profile.locationText,
    targetMonthlyBudgetDollars: dollarsFromCents(profile.targetMonthlyTotalCents, "target"),
    maximumMonthlyBudgetDollars: dollarsFromCents(profile.absoluteMonthlyMaximumCents, "maximum"),
    minimumBedrooms: profile.minimumBedrooms,
    minimumBathrooms: profile.minimumBathrooms,
    moveInEarliest: profile.moveInEarliest,
    moveInLatest: profile.moveInLatest,
    pets: [
      ...new Set(
        profile.petRequirements.filter(({ required }) => required).map(({ animal }) => animal)
      )
    ],
    commuteAnchors: profile.commuteAnchors,
    amenities: [...requiredAmenities, ...preferredAmenities],
    ambiguities: []
  };
}
