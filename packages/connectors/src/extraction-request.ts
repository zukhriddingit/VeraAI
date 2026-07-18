import {
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionRequestSchema,
  type ListingExtractionRequest
} from "@vera/domain";

import type { DeterministicListingExtraction } from "./deterministic-extraction.ts";
import type { ListingEvidence } from "./listing-evidence.ts";

export function buildListingExtractionRequest(
  evidence: ListingEvidence,
  deterministic: DeterministicListingExtraction
): ListingExtractionRequest | null {
  const fieldRequests = ListingExtractionFieldNameSchema.options.flatMap((field) => {
    const extracted = deterministic.extraction[field];
    return extracted.status === "unknown" ? [{ field, reason: extracted.reason }] : [];
  });
  if (fieldRequests.length === 0) return null;
  return ListingExtractionRequestSchema.parse({
    evidenceText: evidence.evidenceText,
    inputHash: evidence.inputHash,
    fieldRequests,
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION
  });
}
