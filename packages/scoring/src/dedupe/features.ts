import type { DuplicatePairFeatureCode, NormalizedDecisionSource } from "@vera/domain";

import { photoHashHammingDistance } from "../photos.ts";

export type PairFeatureScore =
  | {
      readonly code: DuplicatePairFeatureCode;
      readonly status: "known";
      readonly scoreBasisPoints: number;
      readonly reasonCode: string;
    }
  | {
      readonly code: DuplicatePairFeatureCode;
      readonly status: "unknown";
      readonly scoreBasisPoints: null;
      readonly reasonCode: string;
    };

function known(
  code: DuplicatePairFeatureCode,
  scoreBasisPoints: number,
  reasonCode: string
): PairFeatureScore {
  return {
    code,
    status: "known",
    scoreBasisPoints: Math.max(0, Math.min(10_000, Math.round(scoreBasisPoints))),
    reasonCode
  };
}

function unknown(code: DuplicatePairFeatureCode, reasonCode: string): PairFeatureScore {
  return { code, status: "unknown", scoreBasisPoints: null, reasonCode };
}

function dice<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length > 0)
  );
}

function trigrams(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const result = new Set<string>();
  if (normalized.length < 3) {
    if (normalized.length > 0) result.add(normalized);
    return result;
  }
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    result.add(normalized.slice(index, index + 3));
  }
  return result;
}

export function addressSimilarity(left: string | null, right: string | null): PairFeatureScore {
  if (left === null || right === null) return unknown("address", "address_missing");
  if (left === right) return known("address", 10_000, "address_exact");
  const tokenScore = dice(tokens(left), tokens(right));
  const trigramScore = dice(trigrams(left), trigrams(right));
  return known("address", (tokenScore * 0.6 + trigramScore * 0.4) * 10_000, "address_fuzzy");
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function geographicDistanceMeters(
  leftLatitude: number,
  leftLongitude: number,
  rightLatitude: number,
  rightLongitude: number
): number {
  const earthRadiusMeters = 6_371_008.8;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const leftRadians = radians(leftLatitude);
  const rightRadians = radians(rightLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftRadians) * Math.cos(rightRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function descendingLinear(value: number, fullThrough: number, zeroAt: number): number {
  if (value <= fullThrough) return 10_000;
  if (value >= zeroAt) return 0;
  return ((zeroAt - value) / (zeroAt - fullThrough)) * 10_000;
}

export function geographicSimilarity(
  leftLatitude: number | null,
  leftLongitude: number | null,
  rightLatitude: number | null,
  rightLongitude: number | null
): PairFeatureScore {
  if (
    leftLatitude === null ||
    leftLongitude === null ||
    rightLatitude === null ||
    rightLongitude === null
  ) {
    return unknown("geographic", "coordinates_missing");
  }
  const distance = geographicDistanceMeters(
    leftLatitude,
    leftLongitude,
    rightLatitude,
    rightLongitude
  );
  return known(
    "geographic",
    descendingLinear(distance, 25, 500),
    distance <= 25 ? "geographic_near" : distance >= 500 ? "geographic_far" : "geographic_scaled"
  );
}

function relativeDifference(left: number, right: number): number {
  const denominator = Math.max(Math.abs(left), Math.abs(right));
  return denominator === 0 ? 0 : Math.abs(left - right) / denominator;
}

export function rentSimilarity(left: number | null, right: number | null): PairFeatureScore {
  if (left === null || right === null) return unknown("rent", "rent_missing");
  const difference = relativeDifference(left, right);
  return known(
    "rent",
    descendingLinear(difference, 0.02, 0.2),
    difference <= 0.02 ? "rent_close" : difference >= 0.2 ? "rent_far" : "rent_scaled"
  );
}

function roomScore(left: number, right: number): number {
  const difference = Math.abs(left - right);
  if (difference === 0) return 10_000;
  if (difference === 0.5) return 5_000;
  if (difference > 1) return 0;
  return 2_500;
}

export function bedsBathsSimilarity(
  leftBeds: number | null,
  leftBaths: number | null,
  rightBeds: number | null,
  rightBaths: number | null
): PairFeatureScore {
  const scores: number[] = [];
  if (leftBeds !== null && rightBeds !== null) scores.push(roomScore(leftBeds, rightBeds));
  if (leftBaths !== null && rightBaths !== null) scores.push(roomScore(leftBaths, rightBaths));
  if (scores.length === 0) return unknown("beds_baths", "beds_baths_missing");
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return known(
    "beds_baths",
    score,
    score === 10_000
      ? "beds_baths_exact"
      : score === 0
        ? "beds_baths_conflict"
        : "beds_baths_scaled"
  );
}

export function squareFeetSimilarity(left: number | null, right: number | null): PairFeatureScore {
  if (left === null || right === null) return unknown("square_feet", "square_feet_missing");
  const difference = relativeDifference(left, right);
  return known(
    "square_feet",
    descendingLinear(difference, 0.05, 0.3),
    difference <= 0.05
      ? "square_feet_close"
      : difference >= 0.3
        ? "square_feet_far"
        : "square_feet_scaled"
  );
}

const textStopWords = new Set([
  "a",
  "an",
  "and",
  "apartment",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

function textTokens(value: string): Set<string> {
  return new Set(
    [...tokens(value)].filter((token) => token.length > 1 && !textStopWords.has(token))
  );
}

export function textSimilarity(left: string, right: string): PairFeatureScore {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return unknown("text", "text_missing");
  return known("text", dice(leftTokens, rightTokens) * 10_000, "text_token_dice");
}

export function photoSimilarity(
  left: NormalizedDecisionSource["photoHashes"],
  right: NormalizedDecisionSource["photoHashes"]
): PairFeatureScore {
  if (left.length === 0 || right.length === 0) return unknown("photo", "photo_missing");
  let bestDistance = 64;
  for (const leftPhoto of left) {
    for (const rightPhoto of right) {
      bestDistance = Math.min(
        bestDistance,
        photoHashHammingDistance(leftPhoto.hash, rightPhoto.hash)
      );
    }
  }
  return known(
    "photo",
    descendingLinear(bestDistance, 2, 16),
    bestDistance <= 2 ? "photo_near" : bestDistance >= 16 ? "photo_far" : "photo_scaled"
  );
}

export function postingTimeSimilarity(left: string | null, right: string | null): PairFeatureScore {
  if (left === null || right === null) return unknown("posting_time", "posting_time_missing");
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return unknown("posting_time", "posting_time_invalid");
  }
  const hours = Math.abs(leftTime - rightTime) / 3_600_000;
  return known(
    "posting_time",
    descendingLinear(hours, 24, 30 * 24),
    hours <= 24
      ? "posting_time_near"
      : hours >= 30 * 24
        ? "posting_time_far"
        : "posting_time_scaled"
  );
}

export function evaluatePairFeatures(
  left: NormalizedDecisionSource,
  right: NormalizedDecisionSource
): readonly PairFeatureScore[] {
  return [
    addressSimilarity(left.normalizedAddress, right.normalizedAddress),
    geographicSimilarity(left.latitude, left.longitude, right.latitude, right.longitude),
    rentSimilarity(left.rentCents, right.rentCents),
    bedsBathsSimilarity(left.bedrooms, left.bathrooms, right.bedrooms, right.bathrooms),
    squareFeetSimilarity(left.squareFeet, right.squareFeet),
    textSimilarity(left.descriptionText, right.descriptionText),
    photoSimilarity(left.photoHashes, right.photoHashes),
    postingTimeSimilarity(left.postedAt, right.postedAt)
  ];
}
