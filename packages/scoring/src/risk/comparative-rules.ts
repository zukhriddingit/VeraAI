import { photoHashHammingDistance } from "../photos.ts";
import type { RiskConfig } from "./config.ts";
import { structuredEvidence } from "./evidence.ts";
import type { RiskCandidate, RiskListingInput } from "./types.ts";

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function representativeRent(listing: RiskListingInput): number | null {
  const rents = listing.sources.flatMap((source) =>
    source.rentCents === null ? [] : [source.rentCents]
  );
  return rents.length === 0 ? null : median(rents);
}

function materialRelativeDifference(
  left: number,
  right: number,
  minimumCents: number,
  percent: number
): boolean {
  const difference = Math.abs(left - right);
  return difference > minimumCents && difference * 100 > Math.max(left, right) * percent;
}

function reusedPhotoCandidate(
  listing: RiskListingInput,
  resultSet: readonly RiskListingInput[],
  config: RiskConfig
): RiskCandidate | null {
  const evidence = [];
  const otherSources = resultSet
    .filter((candidate) => candidate.canonicalListingId !== listing.canonicalListingId)
    .flatMap((candidate) => candidate.sources);
  for (const source of listing.sources) {
    if (source.normalizedAddress === null) continue;
    for (const other of otherSources) {
      if (
        other.normalizedAddress === null ||
        other.normalizedAddress === source.normalizedAddress
      ) {
        continue;
      }
      let bestDistance = 65;
      for (const photo of source.photoHashes) {
        for (const otherPhoto of other.photoHashes) {
          bestDistance = Math.min(
            bestDistance,
            photoHashHammingDistance(photo.hash, otherPhoto.hash)
          );
        }
      }
      if (bestDistance <= config.reusedPhotoMaximumHammingDistance) {
        evidence.push(
          structuredEvidence(
            source.sourceRecordId,
            "photoHashes",
            "A near-identical supplied photo appears with a different normalized address.",
            `Perceptual-hash distance ${String(bestDistance)} across different addresses.`,
            config.evidenceWindowCharacters
          ),
          structuredEvidence(
            other.sourceRecordId,
            "photoHashes",
            "The comparison source has a materially different normalized address.",
            `Perceptual-hash distance ${String(bestDistance)} across different addresses.`,
            config.evidenceWindowCharacters
          )
        );
      }
    }
  }
  if (evidence.length === 0) return null;
  return {
    code: "reused_photos_different_addresses",
    severity: "medium",
    confidenceBasisPoints: 9_000,
    evidence: evidence.slice(0, 100),
    verificationAction:
      "Reused photos across different addresses are a risk indicator; verify the property address and image provenance."
  };
}

function inconsistencyCandidate(
  listing: RiskListingInput,
  config: RiskConfig
): RiskCandidate | null {
  const sources = [...listing.sources].sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
  );
  const evidence = [];
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = sources[leftIndex]!;
      const right = sources[rightIndex]!;
      const differences: string[] = [];
      if (
        left.rentCents !== null &&
        right.rentCents !== null &&
        materialRelativeDifference(
          left.rentCents,
          right.rentCents,
          config.rentInconsistencyMinimumCents,
          config.rentInconsistencyPercent
        )
      ) {
        differences.push("base rent");
      }
      if (
        left.requiredRecurringFeeCents !== null &&
        right.requiredRecurringFeeCents !== null &&
        materialRelativeDifference(
          left.requiredRecurringFeeCents,
          right.requiredRecurringFeeCents,
          config.feeInconsistencyMinimumCents,
          config.feeInconsistencyPercent
        )
      ) {
        differences.push("required recurring fees");
      }
      if (
        left.bedrooms !== null &&
        right.bedrooms !== null &&
        Math.abs(left.bedrooms - right.bedrooms) >= config.roomInconsistencyMinimum
      ) {
        differences.push("bedrooms");
      }
      if (
        left.bathrooms !== null &&
        right.bathrooms !== null &&
        Math.abs(left.bathrooms - right.bathrooms) >= config.roomInconsistencyMinimum
      ) {
        differences.push("bathrooms");
      }
      if (differences.length > 0) {
        const excerpt = `Materially different fields: ${differences.join(", ")}.`;
        evidence.push(
          structuredEvidence(
            left.sourceRecordId,
            "duplicateCluster",
            "Duplicate-source evidence contains material field differences.",
            excerpt,
            config.evidenceWindowCharacters
          ),
          structuredEvidence(
            right.sourceRecordId,
            "duplicateCluster",
            "The comparison source contains materially different listing facts.",
            excerpt,
            config.evidenceWindowCharacters
          )
        );
      }
    }
  }
  if (evidence.length === 0) return null;
  return {
    code: "material_duplicate_inconsistency",
    severity: "medium",
    confidenceBasisPoints: 9_000,
    evidence: evidence.slice(0, 100),
    verificationAction:
      "Material inconsistencies inside a duplicate cluster are a risk indicator; confirm the current facts with a verified property contact."
  };
}

function lowPriceOutlierCandidate(
  listing: RiskListingInput,
  resultSet: readonly RiskListingInput[],
  config: RiskConfig
): RiskCandidate | null {
  if (listing.sources.some((source) => source.normalizedAddress !== null)) return null;
  const rent = representativeRent(listing);
  if (rent === null) return null;
  const comparableRents = resultSet
    .map(representativeRent)
    .filter((value): value is number => value !== null);
  if (comparableRents.length < config.outlierMinimumComparableListings) return null;
  const resultMedian = median(comparableRents);
  if (rent * 100 > resultMedian * config.outlierMaximumMedianRatioPercent) return null;
  const deviations = comparableRents.map((value) => Math.abs(value - resultMedian));
  const medianAbsoluteDeviation = median(deviations);
  const extremeByModifiedZ =
    medianAbsoluteDeviation === 0 ||
    (resultMedian - rent) * 6_745 >=
      medianAbsoluteDeviation * config.outlierModifiedZThresholdTimesTenThousand;
  if (!extremeByModifiedZ) return null;
  const source = [...listing.sources].sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
  )[0];
  if (source === undefined) return null;
  return {
    code: "missing_address_extreme_low_price",
    severity: "medium",
    confidenceBasisPoints: 8_500,
    evidence: [
      structuredEvidence(
        source.sourceRecordId,
        "rentCents",
        "The address is missing and the rent is an extreme low-price outlier in this result set.",
        `Rent ${String(rent)} cents; result-set median ${String(resultMedian)} cents; ${medianAbsoluteDeviation === 0 ? "zero-MAD ratio gate" : `median absolute deviation ${String(medianAbsoluteDeviation)} cents`}.`,
        config.evidenceWindowCharacters
      )
    ],
    verificationAction:
      "A missing address combined with an extreme low price is a risk indicator; verify the address, poster, and full housing cost."
  };
}

export function evaluateComparativeRiskCandidates(
  listing: RiskListingInput,
  resultSet: readonly RiskListingInput[],
  config: RiskConfig
): readonly RiskCandidate[] {
  return [
    reusedPhotoCandidate(listing, resultSet, config),
    inconsistencyCandidate(listing, config),
    lowPriceOutlierCandidate(listing, resultSet, config)
  ].filter((value): value is RiskCandidate => value !== null);
}
