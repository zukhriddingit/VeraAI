import type { HardConstraintEvaluation, SearchProfile } from "@vera/domain";

import type { RankingConfig } from "./config.ts";
import type { CanonicalScoreInput, RawRankingFactor } from "./types.ts";

function factor(
  code: RawRankingFactor["code"],
  valueStatus: RawRankingFactor["valueStatus"],
  inputValue: unknown | null,
  scoreBasisPoints: number | null,
  reasonCodes: readonly string[],
  provenanceIds: readonly string[] = [],
  unknownBehavior: RawRankingFactor["unknownBehavior"] = "neutral"
): RawRankingFactor {
  return {
    code,
    valueStatus,
    inputValue,
    scoreBasisPoints,
    reasonCodes,
    provenanceIds: [...new Set(provenanceIds)].sort(),
    unknownBehavior
  };
}

function provenanceFor(listing: CanonicalScoreInput, ...paths: readonly string[]): string[] {
  const pathSet = new Set(paths);
  return listing.selectedFieldConfidences
    .filter((field) => pathSet.has(field.fieldPath))
    .map((field) => field.provenanceId)
    .sort();
}

function costFactor(profile: SearchProfile, listing: CanonicalScoreInput): RawRankingFactor {
  if (profile.targetMonthlyTotalCents === null && profile.absoluteMonthlyMaximumCents === null) {
    return factor("monthly_housing_cost", "unknown", null, null, [
      "budget_preference_not_configured"
    ]);
  }
  if (listing.monthlyRentCents === null || listing.recurringFeesCents === null) {
    return factor("monthly_housing_cost", "unknown", null, null, [
      listing.monthlyRentCents === null ? "rent_unknown" : "recurring_fees_unknown"
    ]);
  }
  const total = listing.monthlyRentCents + listing.recurringFeesCents;
  const target = profile.targetMonthlyTotalCents;
  const maximum = profile.absoluteMonthlyMaximumCents;
  let score = 10_000;
  let reason = "known_total_within_target";
  if (maximum !== null && total >= maximum) {
    score = total > maximum ? 0 : 2_500;
    reason = total > maximum ? "known_total_above_maximum" : "known_total_at_maximum";
  } else if (target !== null && total > target && maximum !== null && maximum > target) {
    score = Math.round(((maximum - total) / (maximum - target)) * 7_500 + 2_500);
    reason = "known_total_between_target_and_maximum";
  } else if (target !== null && total > target) {
    score = 5_000;
    reason = "known_total_above_target";
  }
  return factor(
    "monthly_housing_cost",
    "known",
    total,
    Math.max(0, Math.min(10_000, score)),
    [reason],
    provenanceFor(listing, "monthlyRentCents", "recurringFeesCents")
  );
}

function minimumFactor(
  code: "bedrooms" | "bathrooms",
  minimum: number | null,
  observed: number | null,
  listing: CanonicalScoreInput
): RawRankingFactor {
  if (minimum === null) {
    return factor(code, "unknown", null, null, [`${code}_preference_not_configured`]);
  }
  if (observed === null) return factor(code, "unknown", null, null, [`${code}_unknown`]);
  const difference = observed - minimum;
  const score = difference < 0 ? 0 : Math.min(10_000, 8_000 + difference * 1_000);
  return factor(
    code,
    "known",
    observed,
    Math.round(score),
    [difference < 0 ? `${code}_below_minimum` : `${code}_meets_minimum`],
    provenanceFor(listing, code)
  );
}

function moveInFactor(profile: SearchProfile, listing: CanonicalScoreInput): RawRankingFactor {
  if (profile.moveInEarliest === null && profile.moveInLatest === null) {
    return factor("move_in_timing", "unknown", null, null, ["move_in_window_not_configured"]);
  }
  if (listing.availableOn === null) {
    return factor("move_in_timing", "unknown", null, null, ["availability_unknown"]);
  }
  const afterLatest = profile.moveInLatest !== null && listing.availableOn > profile.moveInLatest;
  return factor(
    "move_in_timing",
    "known",
    listing.availableOn,
    afterLatest ? 0 : 10_000,
    [afterLatest ? "availability_after_latest_move_in" : "availability_compatible"],
    provenanceFor(listing, "availableOn")
  );
}

function petFactor(profile: SearchProfile, listing: CanonicalScoreInput): RawRankingFactor {
  const requirements = profile.petRequirements.filter(({ required }) => required);
  if (requirements.length === 0) {
    return factor("pet_policy", "unknown", null, null, ["pet_preference_not_configured"]);
  }
  if (listing.petPolicy === null) {
    return factor("pet_policy", "unknown", null, null, ["pet_policy_unknown"]);
  }
  const permissions = requirements.map((requirement) =>
    requirement.animal === "cat"
      ? listing.petPolicy!.cats
      : requirement.animal === "dog"
        ? listing.petPolicy!.dogs
        : "unknown"
  );
  if (permissions.includes("not_allowed")) {
    return factor(
      "pet_policy",
      "known",
      permissions,
      0,
      ["required_pet_disallowed"],
      provenanceFor(listing, "petPolicy")
    );
  }
  if (permissions.includes("unknown")) {
    return factor("pet_policy", "unknown", null, null, ["pet_permission_unknown"]);
  }
  return factor(
    "pet_policy",
    "known",
    permissions,
    10_000,
    ["required_pet_allowed"],
    provenanceFor(listing, "petPolicy")
  );
}

function commuteFactor(profile: SearchProfile, listing: CanonicalScoreInput): RawRankingFactor {
  if (profile.commuteAnchors.length === 0) {
    return factor("commute", "unknown", null, null, ["commute_preference_not_configured"]);
  }
  const scores: number[] = [];
  const evidence: Record<string, number> = {};
  for (const anchor of profile.commuteAnchors) {
    const minutes = listing.commuteMinutesByAnchor[anchor.label];
    if (minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
      return factor("commute", "unknown", null, null, ["commute_evidence_unknown"]);
    }
    evidence[anchor.label] = minutes;
    scores.push(
      minutes <= anchor.maximumMinutes
        ? 10_000
        : minutes >= anchor.maximumMinutes * 2
          ? 0
          : Math.round(((anchor.maximumMinutes * 2 - minutes) / anchor.maximumMinutes) * 10_000)
    );
  }
  return factor(
    "commute",
    "known",
    evidence,
    Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
    ["commute_evidence_scored"]
  );
}

function mustHavesFactor(constraints: readonly HardConstraintEvaluation[]): RawRankingFactor {
  const relevant = constraints.filter(({ code }) => code === "required_feature_absent");
  if (relevant.length === 0) {
    return factor("must_haves", "unknown", null, null, ["must_haves_not_configured"]);
  }
  if (relevant.some(({ status }) => status === "failed")) {
    return factor("must_haves", "known", false, 0, ["must_have_explicitly_absent"]);
  }
  if (relevant.some(({ status }) => status === "unknown")) {
    return factor("must_haves", "unknown", null, null, ["must_have_unknown"]);
  }
  return factor("must_haves", "known", true, 10_000, ["must_haves_present"]);
}

function normalizedFeature(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function niceToHavesFactor(
  profile: SearchProfile,
  listing: CanonicalScoreInput,
  config: RankingConfig
): RawRankingFactor {
  if (profile.weightedPreferences.length === 0) {
    return factor("nice_to_haves", "unknown", null, null, ["nice_to_haves_not_configured"]);
  }
  const amenities = new Set(listing.amenities.map(normalizedFeature));
  const absent = new Set(listing.explicitlyAbsentFeatures.map(normalizedFeature));
  const evidence = profile.weightedPreferences.map((preference) => {
    const code = normalizedFeature(preference.code);
    if (amenities.has(code)) return { code, status: "present" as const, score: 10_000, preference };
    if (absent.has(code)) return { code, status: "absent" as const, score: 0, preference };
    return {
      code,
      status: "unknown" as const,
      score:
        preference.unknownBehavior === "penalize" ? config.unknownPenaltyScoreBasisPoints : null,
      preference
    };
  });
  const effective = evidence.filter(
    (entry): entry is typeof entry & { score: number } => entry.score !== null
  );
  const totalWeight = effective.reduce((sum, entry) => sum + entry.preference.weightBasisPoints, 0);
  if (totalWeight === 0) {
    return factor("nice_to_haves", "unknown", null, null, ["nice_to_haves_unknown_neutral"]);
  }
  const score = Math.round(
    effective.reduce((sum, entry) => sum + entry.score * entry.preference.weightBasisPoints, 0) /
      totalWeight
  );
  return factor(
    "nice_to_haves",
    "known",
    evidence.map(({ code, status }) => ({ code, status })),
    score,
    [
      evidence.some(
        ({ status, preference }) =>
          status === "unknown" && preference.unknownBehavior === "penalize"
      )
        ? "nice_to_haves_unknown_penalized"
        : "nice_to_haves_scored"
    ],
    provenanceFor(listing, "amenities")
  );
}

export function evaluateRankingFactors(
  profile: SearchProfile,
  listing: CanonicalScoreInput,
  constraints: readonly HardConstraintEvaluation[],
  config: RankingConfig
): readonly RawRankingFactor[] {
  return [
    costFactor(profile, listing),
    minimumFactor("bedrooms", profile.minimumBedrooms, listing.bedrooms, listing),
    minimumFactor("bathrooms", profile.minimumBathrooms, listing.bathrooms, listing),
    moveInFactor(profile, listing),
    petFactor(profile, listing),
    commuteFactor(profile, listing),
    mustHavesFactor(constraints),
    niceToHavesFactor(profile, listing, config)
  ];
}
