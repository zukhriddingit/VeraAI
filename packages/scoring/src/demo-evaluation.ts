import type {
  CanonicalListing,
  ListingSourceRecord,
  RiskSignal,
  ScoreFactor,
  SearchProfile
} from "@vera/domain";

export const DEMO_SCORE_ALGORITHM_VERSION = "demo-fit-v1";
export const DEMO_RISK_ALGORITHM_VERSION = "demo-risk-v1";

export interface DemoListingEvaluation {
  readonly totalScoreBasisPoints: number;
  readonly factors: readonly ScoreFactor[];
  readonly reasonCodes: readonly string[];
  readonly topPositiveReason: string;
  readonly topConcern: string;
}

interface FactorResult {
  readonly factor: ScoreFactor;
  readonly positive: string | null;
  readonly concern: string | null;
}

const factorWeightBasisPoints = 2_500;

function factor(code: string, scoreBasisPoints: number, reasonCode: string): ScoreFactor {
  return {
    code,
    scoreBasisPoints,
    weightBasisPoints: factorWeightBasisPoints,
    reasonCode
  };
}

function budgetFactor(profile: SearchProfile, listing: CanonicalListing): FactorResult {
  const rent = listing.monthlyRentCents;
  const target = profile.targetMonthlyTotalCents;
  const maximum = profile.absoluteMonthlyMaximumCents;

  if (rent === null || (target === null && maximum === null)) {
    return {
      factor: factor("budget_fit", 0, "budget_unknown"),
      positive: null,
      concern: "Rent needs verification before budget fit can be confirmed."
    };
  }

  const knownTotal = rent + (listing.recurringFeesCents ?? 0);
  const feesUnknown = listing.recurringFeesCents === null;

  if (maximum !== null && knownTotal > maximum) {
    return {
      factor: factor("budget_fit", -10_000, "budget_above_maximum"),
      positive: null,
      concern: "Known monthly cost is above the profile maximum."
    };
  }

  if (target !== null && knownTotal <= target) {
    return {
      factor: factor(
        "budget_fit",
        10_000,
        feesUnknown ? "base_rent_within_target" : "total_within_target"
      ),
      positive: feesUnknown
        ? "Base rent is within target; recurring fees still need verification."
        : "Known monthly cost is within the target budget.",
      concern: feesUnknown ? "Recurring fees are unknown." : null
    };
  }

  return {
    factor: factor("budget_fit", 5_000, "budget_between_target_and_maximum"),
    positive: "Known monthly cost remains below the absolute maximum.",
    concern: feesUnknown ? "Recurring fees are unknown." : "Known monthly cost is above the target."
  };
}

function bedroomFactor(profile: SearchProfile, listing: CanonicalListing): FactorResult {
  if (profile.minimumBedrooms === null) {
    return {
      factor: factor("bedroom_fit", 0, "bedroom_requirement_not_set"),
      positive: null,
      concern: null
    };
  }

  if (listing.bedrooms === null) {
    return {
      factor: factor("bedroom_fit", 0, "bedrooms_unknown"),
      positive: null,
      concern: "Bedroom count needs verification."
    };
  }

  const matches = listing.bedrooms >= profile.minimumBedrooms;
  return {
    factor: factor(
      "bedroom_fit",
      matches ? 10_000 : -10_000,
      matches ? "bedrooms_match" : "bedrooms_below_minimum"
    ),
    positive: matches ? "Bedroom count meets the profile requirement." : null,
    concern: matches ? null : "Bedroom count is below the profile minimum."
  };
}

function petFactor(profile: SearchProfile, listing: CanonicalListing): FactorResult {
  const required = profile.petRequirements.filter((requirement) => requirement.required);
  if (required.length === 0) {
    return {
      factor: factor("pet_compatibility", 0, "pet_requirement_not_set"),
      positive: null,
      concern: null
    };
  }

  if (listing.petPolicy === null) {
    return {
      factor: factor("pet_compatibility", 0, "pet_policy_unknown"),
      positive: null,
      concern: "Pet policy needs verification."
    };
  }

  const permissions = required.flatMap((requirement) => {
    if (requirement.animal === "cat") return [listing.petPolicy?.cats ?? "unknown"];
    if (requirement.animal === "dog") return [listing.petPolicy?.dogs ?? "unknown"];
    return ["unknown" as const];
  });

  if (permissions.includes("not_allowed")) {
    return {
      factor: factor("pet_compatibility", -10_000, "required_pet_not_allowed"),
      positive: null,
      concern: "The stated pet policy conflicts with the profile requirement."
    };
  }

  if (permissions.includes("unknown")) {
    return {
      factor: factor("pet_compatibility", 0, "pet_policy_unknown"),
      positive: null,
      concern: "Pet policy needs verification."
    };
  }

  return {
    factor: factor("pet_compatibility", 10_000, "required_pet_allowed"),
    positive: "The stated pet policy matches the profile requirement.",
    concern: null
  };
}

function moveInFactor(profile: SearchProfile, listing: CanonicalListing): FactorResult {
  const earliest = profile.moveInEarliest;
  const latest = profile.moveInLatest;
  if (earliest === null && latest === null) {
    return {
      factor: factor("move_in_compatibility", 0, "move_in_window_not_set"),
      positive: null,
      concern: null
    };
  }

  if (listing.availableOn === null) {
    return {
      factor: factor("move_in_compatibility", 0, "availability_unknown"),
      positive: null,
      concern: "Move-in availability needs verification."
    };
  }

  const withinEarliest = earliest === null || listing.availableOn >= earliest;
  const withinLatest = latest === null || listing.availableOn <= latest;
  const matches = withinEarliest && withinLatest;
  return {
    factor: factor(
      "move_in_compatibility",
      matches ? 10_000 : -10_000,
      matches ? "move_in_window_match" : "move_in_window_conflict"
    ),
    positive: matches ? "Availability falls inside the move-in window." : null,
    concern: matches ? null : "Availability falls outside the move-in window."
  };
}

export function scoreDemoListing(
  profile: SearchProfile,
  listing: CanonicalListing
): DemoListingEvaluation {
  const results = [
    budgetFactor(profile, listing),
    bedroomFactor(profile, listing),
    petFactor(profile, listing),
    moveInFactor(profile, listing)
  ];
  const weighted = results.reduce(
    (sum, result) => sum + result.factor.scoreBasisPoints * result.factor.weightBasisPoints,
    0
  );
  const totalScoreBasisPoints = Math.max(-10_000, Math.min(10_000, Math.round(weighted / 10_000)));

  return {
    totalScoreBasisPoints,
    factors: results.map((result) => result.factor),
    reasonCodes: results.map((result) => result.factor.reasonCode),
    topPositiveReason:
      results.find((result) => result.positive !== null)?.positive ??
      "Known facts do not yet establish a positive fit.",
    topConcern:
      results.find((result) => result.concern !== null)?.concern ??
      "No concern was identified from the four demo factors."
  };
}

function normalizedAddress(record: ListingSourceRecord): string {
  return [
    record.address.line1,
    record.address.unit,
    record.address.city,
    record.address.region,
    record.address.postalCode
  ]
    .filter((part): part is string => part !== null)
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
    )
    .join("|");
}

function signal(
  listing: CanonicalListing,
  code: string,
  severity: RiskSignal["severity"],
  confidenceBasisPoints: number,
  evidence: RiskSignal["evidence"],
  verificationAction: string,
  now: string
): RiskSignal {
  return {
    id: `risk:${listing.id}:${code}`,
    canonicalListingId: listing.id,
    code,
    severity,
    confidenceBasisPoints,
    evidence,
    verificationAction,
    status: "open",
    createdAt: now,
    updatedAt: now
  };
}

export function deriveDemoRiskSignals(
  listing: CanonicalListing,
  sourceRecords: readonly ListingSourceRecord[],
  now: string
): readonly RiskSignal[] {
  const signals: RiskSignal[] = [];
  const descriptions = sourceRecords.flatMap((record) =>
    record.description === null ? [] : [{ record, text: record.description }]
  );
  const beforeViewing = descriptions.find(({ text }) =>
    /(?:pay|payment|deposit).{0,50}before (?:a |the )?(?:viewing|tour|showing)/iu.test(text)
  );
  if (beforeViewing) {
    signals.push(
      signal(
        listing,
        "payment_before_viewing",
        "high",
        9_000,
        [
          {
            sourceRecordId: beforeViewing.record.id,
            fieldPath: "description",
            summary: "Synthetic fixture requests payment before a viewing."
          }
        ],
        "Do not pay before verifying the property and meeting through a trusted viewing process.",
        now
      )
    );
  }

  const prohibitedPayment = descriptions.find(({ text }) =>
    /\b(?:wire transfer|cryptocurrency|bitcoin|gift card)\b/iu.test(text)
  );
  if (prohibitedPayment) {
    signals.push(
      signal(
        listing,
        "high_risk_payment_language",
        "high",
        9_500,
        [
          {
            sourceRecordId: prohibitedPayment.record.id,
            fieldPath: "description",
            summary:
              "Synthetic fixture contains wire, cryptocurrency, or gift-card payment language."
          }
        ],
        "Verify the poster independently and do not use irreversible payment methods.",
        now
      )
    );
  }

  const knownRents = sourceRecords.filter(
    (record): record is ListingSourceRecord & { monthlyRentCents: number } =>
      record.monthlyRentCents !== null
  );
  if (new Set(knownRents.map((record) => record.monthlyRentCents)).size > 1) {
    signals.push(
      signal(
        listing,
        "conflicting_rent_evidence",
        "medium",
        10_000,
        knownRents.map((record) => ({
          sourceRecordId: record.id,
          fieldPath: "monthlyRentCents",
          summary: `Sanitized ${record.source} fixture lists ${String(record.monthlyRentCents)} cents per month.`
        })),
        "Confirm the current rent and all required fees with the verified property contact.",
        now
      )
    );
  }

  const addressGroups = new Map<string, ListingSourceRecord[]>();
  for (const record of sourceRecords) {
    const address = normalizedAddress(record);
    if (address.length === 0) continue;
    addressGroups.set(address, [...(addressGroups.get(address) ?? []), record]);
  }
  if (addressGroups.size > 1 && sourceRecords.length > 1) {
    signals.push(
      signal(
        listing,
        "conflicting_address_evidence",
        "medium",
        8_500,
        sourceRecords.map((record) => ({
          sourceRecordId: record.id,
          fieldPath: "address",
          summary: `Sanitized ${record.source} fixture contains a different normalized address or unit.`
        })),
        "Confirm the exact street address and unit before taking any external action.",
        now
      )
    );
  }

  return signals;
}
