import type { HardConstraintEvaluation, SearchConstraint, SearchProfile } from "@vera/domain";

import type { CanonicalScoreInput } from "./types.ts";

function evaluation(
  code: HardConstraintEvaluation["code"],
  status: HardConstraintEvaluation["status"],
  observedValue: HardConstraintEvaluation["observedValue"],
  requiredValue: HardConstraintEvaluation["requiredValue"],
  reasonCode: string,
  provenanceIds: readonly string[] = []
): HardConstraintEvaluation {
  return {
    code,
    status,
    observedValue,
    requiredValue,
    provenanceIds: [...provenanceIds].sort(),
    reasonCode
  };
}

function provenanceFor(listing: CanonicalScoreInput, ...fieldPaths: readonly string[]): string[] {
  const paths = new Set(fieldPaths);
  return listing.selectedFieldConfidences
    .filter((field) => paths.has(field.fieldPath))
    .map((field) => field.provenanceId)
    .sort();
}

function requiredFeatureConstraint(
  constraint: SearchConstraint,
  listing: CanonicalScoreInput
): HardConstraintEvaluation {
  const required = String(constraint.value).normalize("NFKC").trim().toLowerCase();
  const amenities = new Set(
    listing.amenities.map((value) => value.normalize("NFKC").trim().toLowerCase())
  );
  const absent = new Set(
    listing.explicitlyAbsentFeatures.map((value) => value.normalize("NFKC").trim().toLowerCase())
  );
  if (amenities.has(required)) {
    return evaluation(
      "required_feature_absent",
      "passed",
      required,
      required,
      "required_feature_present",
      provenanceFor(listing, "amenities")
    );
  }
  if (absent.has(required)) {
    return evaluation(
      "required_feature_absent",
      "failed",
      false,
      required,
      "required_feature_explicitly_absent",
      provenanceFor(listing, "amenities")
    );
  }
  return evaluation(
    "required_feature_absent",
    "unknown",
    null,
    required,
    "required_feature_unknown"
  );
}

export function evaluateHardConstraints(
  profile: SearchProfile,
  listing: CanonicalScoreInput
): readonly HardConstraintEvaluation[] {
  const results: HardConstraintEvaluation[] = [];
  if (profile.absoluteMonthlyMaximumCents !== null) {
    const required = profile.absoluteMonthlyMaximumCents;
    if (listing.monthlyRentCents === null) {
      results.push(evaluation("budget_exceeded", "unknown", null, required, "rent_unknown"));
    } else if (listing.monthlyRentCents > required) {
      results.push(
        evaluation(
          "budget_exceeded",
          "failed",
          listing.monthlyRentCents,
          required,
          "base_rent_exceeds_maximum",
          provenanceFor(listing, "monthlyRentCents")
        )
      );
    } else if (listing.recurringFeesCents === null) {
      results.push(
        evaluation(
          "budget_exceeded",
          "unknown",
          { baseRentCents: listing.monthlyRentCents, recurringFeesCents: null },
          required,
          "recurring_fees_unknown",
          provenanceFor(listing, "monthlyRentCents")
        )
      );
    } else {
      const total = listing.monthlyRentCents + listing.recurringFeesCents;
      results.push(
        evaluation(
          "budget_exceeded",
          total > required ? "failed" : "passed",
          total,
          required,
          total > required ? "known_total_exceeds_maximum" : "known_total_within_maximum",
          provenanceFor(listing, "monthlyRentCents", "recurringFeesCents")
        )
      );
    }
  }

  if (profile.minimumBedrooms !== null) {
    results.push(
      listing.bedrooms === null
        ? evaluation(
            "bedrooms_below_minimum",
            "unknown",
            null,
            profile.minimumBedrooms,
            "bedrooms_unknown"
          )
        : evaluation(
            "bedrooms_below_minimum",
            listing.bedrooms < profile.minimumBedrooms ? "failed" : "passed",
            listing.bedrooms,
            profile.minimumBedrooms,
            listing.bedrooms < profile.minimumBedrooms
              ? "bedrooms_below_minimum"
              : "bedrooms_meet_minimum",
            provenanceFor(listing, "bedrooms")
          )
    );
  }

  if (profile.minimumBathrooms !== null) {
    results.push(
      listing.bathrooms === null
        ? evaluation(
            "bathrooms_below_minimum",
            "unknown",
            null,
            profile.minimumBathrooms,
            "bathrooms_unknown"
          )
        : evaluation(
            "bathrooms_below_minimum",
            listing.bathrooms < profile.minimumBathrooms ? "failed" : "passed",
            listing.bathrooms,
            profile.minimumBathrooms,
            listing.bathrooms < profile.minimumBathrooms
              ? "bathrooms_below_minimum"
              : "bathrooms_meet_minimum",
            provenanceFor(listing, "bathrooms")
          )
    );
  }

  for (const requirement of profile.petRequirements.filter(({ required }) => required)) {
    const permission =
      requirement.animal === "cat"
        ? listing.petPolicy?.cats
        : requirement.animal === "dog"
          ? listing.petPolicy?.dogs
          : "unknown";
    results.push(
      permission === undefined || permission === "unknown"
        ? evaluation(
            "pets_explicitly_disallowed",
            "unknown",
            null,
            requirement.animal,
            "pet_permission_unknown"
          )
        : evaluation(
            "pets_explicitly_disallowed",
            permission === "not_allowed" ? "failed" : "passed",
            permission,
            requirement.animal,
            permission === "not_allowed" ? "required_pet_disallowed" : "required_pet_allowed",
            provenanceFor(listing, "petPolicy")
          )
    );
  }

  if (profile.moveInLatest !== null) {
    results.push(
      listing.availableOn === null
        ? evaluation(
            "availability_after_latest_move_in",
            "unknown",
            null,
            profile.moveInLatest,
            "availability_unknown"
          )
        : evaluation(
            "availability_after_latest_move_in",
            listing.availableOn > profile.moveInLatest ? "failed" : "passed",
            listing.availableOn,
            profile.moveInLatest,
            listing.availableOn > profile.moveInLatest
              ? "availability_after_latest_move_in"
              : "availability_by_latest_move_in",
            provenanceFor(listing, "availableOn")
          )
    );
  }

  const coreFields = new Set([
    "monthlyTotalCents",
    "monthlyRentCents",
    "bedrooms",
    "bathrooms",
    "availableOn"
  ]);
  for (const constraint of profile.hardConstraints) {
    if (coreFields.has(constraint.field)) continue;
    if (constraint.field === "amenities" && constraint.operator === "contains") {
      results.push(requiredFeatureConstraint(constraint, listing));
    } else {
      results.push(
        evaluation(
          "required_feature_absent",
          "unknown",
          null,
          constraint.value,
          "unsupported_constraint_needs_verification"
        )
      );
    }
  }

  const statusOrder = { failed: 0, unknown: 1, passed: 2 } as const;
  return results.sort((left, right) =>
    statusOrder[left.status] === statusOrder[right.status]
      ? left.code === right.code
        ? left.reasonCode.localeCompare(right.reasonCode, "en")
        : left.code.localeCompare(right.code, "en")
      : statusOrder[left.status] - statusOrder[right.status]
  );
}
