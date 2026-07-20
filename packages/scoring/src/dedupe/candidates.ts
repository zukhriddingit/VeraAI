import type { NormalizedDecisionSource } from "@vera/domain";

import { type DedupeConfig, validateDedupeConfig } from "./config.ts";

export interface CandidatePair {
  readonly leftSourceRecordId: string;
  readonly rightSourceRecordId: string;
}

export interface CandidateGenerationResult {
  readonly pairs: readonly CandidatePair[];
  readonly wasTruncated: boolean;
  readonly candidateCountBeforeLimit: number | null;
  readonly candidateCountLowerBound: number;
  readonly limit: number;
}

function addBlock(blocks: Map<string, string[]>, key: string, sourceId: string): void {
  blocks.set(key, [...(blocks.get(key) ?? []), sourceId]);
}

function postingMonth(postedAt: string | null): string | null {
  return postedAt === null ? null : postedAt.slice(0, 7);
}

function blockKeys(source: NormalizedDecisionSource): string[] {
  const keys: string[] = [];
  if (source.sourceListingId !== null) {
    keys.push(`source:${source.source}:${source.sourceListingId}`);
  }
  if (source.canonicalUrl !== null) keys.push(`url:${source.canonicalUrl}`);
  if (source.normalizedAddress !== null) {
    keys.push(`address:${source.normalizedAddress}:${source.normalizedUnit ?? "unknown"}`);
    for (const token of source.normalizedAddress.split(" ").filter((value) => value.length >= 2)) {
      keys.push(`street-token:${source.normalizedCity ?? "unknown"}:${token}`);
    }
  }
  if (source.normalizedPostalCode !== null) keys.push(`postal:${source.normalizedPostalCode}`);
  for (const fingerprint of source.contactFingerprints) keys.push(`contact:${fingerprint}`);
  for (const photo of source.photoHashes) {
    if (photo.byteHash !== null && photo.byteHash !== undefined) {
      keys.push(`photo-byte:${photo.byteHash}`);
    }
    keys.push(`photo-perceptual:${photo.hash}`);
  }
  if (source.rentCents !== null || source.bedrooms !== null) {
    const rentBand = source.rentCents === null ? "unknown" : Math.floor(source.rentCents / 25_000);
    const bedroomBand = source.bedrooms === null ? "unknown" : source.bedrooms;
    keys.push(
      `market-band:${source.normalizedCity ?? source.normalizedPostalCode ?? "unknown"}:${String(rentBand)}:${String(bedroomBand)}:${postingMonth(source.postedAt) ?? "unknown"}`
    );
  }
  return [...new Set(keys)].sort();
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function parsePairKey(key: string): CandidatePair {
  const [leftSourceRecordId, rightSourceRecordId] = key.split("\u0000");
  if (leftSourceRecordId === undefined || rightSourceRecordId === undefined) {
    throw new Error("Invalid internal candidate-pair key.");
  }
  return { leftSourceRecordId, rightSourceRecordId };
}

export function generateCandidatePairs(
  inputSources: readonly NormalizedDecisionSource[],
  inputConfig: DedupeConfig
): CandidateGenerationResult {
  const config = validateDedupeConfig(inputConfig);
  const sources = [...inputSources].sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
  );
  if (new Set(sources.map((source) => source.sourceRecordId)).size !== sources.length) {
    throw new Error("Candidate generation requires unique source-record IDs.");
  }

  const blocks = new Map<string, string[]>();
  const fallbackIds: string[] = [];
  for (const source of sources) {
    const keys = blockKeys(source);
    if (keys.length === 0) fallbackIds.push(source.sourceRecordId);
    for (const key of keys) addBlock(blocks, key, source.sourceRecordId);
  }

  const keys = new Set<string>();
  let truncated = false;
  const addPair = (left: string, right: string): void => {
    if (left === right || truncated) return;
    keys.add(pairKey(left, right));
    if (keys.size > config.maxCandidatePairs) truncated = true;
  };

  for (const blockName of [...blocks.keys()].sort()) {
    const members = [...new Set(blocks.get(blockName) ?? [])].sort();
    for (let leftIndex = 0; leftIndex < members.length && !truncated; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < members.length && !truncated;
        rightIndex += 1
      ) {
        addPair(members[leftIndex]!, members[rightIndex]!);
      }
    }
    if (truncated) break;
  }

  if (!truncated) {
    for (
      let chunkStart = 0;
      chunkStart < fallbackIds.length && !truncated;
      chunkStart += config.fallbackBlockSize
    ) {
      const chunk = fallbackIds.slice(chunkStart, chunkStart + config.fallbackBlockSize);
      for (let leftIndex = 0; leftIndex < chunk.length && !truncated; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < chunk.length && !truncated;
          rightIndex += 1
        ) {
          addPair(chunk[leftIndex]!, chunk[rightIndex]!);
        }
      }
    }
  }

  const sortedKeys = [...keys].sort();
  const pairs = sortedKeys.slice(0, config.maxCandidatePairs).map(parsePairKey);
  return {
    pairs,
    wasTruncated: truncated,
    candidateCountBeforeLimit: truncated ? null : sortedKeys.length,
    candidateCountLowerBound: truncated ? config.maxCandidatePairs + 1 : sortedKeys.length,
    limit: config.maxCandidatePairs
  };
}
