import type { HardConstraintEvaluation, ScoreFactorV2 } from "@vera/domain";

const factorLabels: Readonly<Record<ScoreFactorV2["code"], string>> = {
  monthly_housing_cost: "known monthly housing cost",
  bedrooms: "bedroom fit",
  bathrooms: "bathroom fit",
  move_in_timing: "move-in timing",
  pet_policy: "pet-policy fit",
  commute: "commute fit",
  must_haves: "required features",
  nice_to_haves: "nice-to-have features"
};

export interface ScoreExplanationInput {
  readonly eligible: boolean;
  readonly constraints: readonly HardConstraintEvaluation[];
  readonly factors: readonly ScoreFactorV2[];
  readonly stalePenaltyBasisPoints: number;
  readonly lowConfidencePenaltyBasisPoints: number;
  readonly riskPenaltyBasisPoints: number;
}

export function explainScore(input: ScoreExplanationInput): string {
  const sentences: string[] = [];
  const strongest = [...input.factors]
    .filter((factor) => factor.valueStatus === "known")
    .sort((left, right) =>
      right.contributionBasisPoints === left.contributionBasisPoints
        ? left.code.localeCompare(right.code, "en")
        : right.contributionBasisPoints - left.contributionBasisPoints
    )[0];
  if (strongest !== undefined) {
    sentences.push(`The strongest positive contribution is ${factorLabels[strongest.code]}.`);
  } else {
    sentences.push("Known evidence is not sufficient to identify a strongest fit factor.");
  }

  const failures = input.constraints.filter(({ status }) => status === "failed");
  if (failures.length > 0) {
    sentences.push(
      `The listing is ineligible because ${failures
        .map(({ reasonCode }) => reasonCode.replaceAll("_", " "))
        .join("; ")}.`
    );
  } else if (input.eligible) {
    sentences.push("No explicit evidence violates a configured hard constraint.");
  }

  const unknowns = input.factors.filter(({ valueStatus }) => valueStatus === "unknown");
  if (unknowns.length > 0) {
    sentences.push(
      `${unknowns.map(({ code }) => factorLabels[code]).join(", ")} need verification and are neutral unless the corresponding preference says to penalize unknown values.`
    );
  }
  if (input.stalePenaltyBasisPoints > 0) {
    sentences.push(
      `Freshness reduces the score by ${String(input.stalePenaltyBasisPoints)} basis points.`
    );
  }
  if (input.lowConfidencePenaltyBasisPoints > 0) {
    sentences.push(
      `Low-confidence selected fields reduce the score by ${String(input.lowConfidencePenaltyBasisPoints)} basis points.`
    );
  }
  if (input.riskPenaltyBasisPoints > 0) {
    sentences.push(
      `Evidence-backed risk indicators reduce the score by ${String(input.riskPenaltyBasisPoints)} basis points and need verification.`
    );
  }
  return sentences.join(" ");
}
