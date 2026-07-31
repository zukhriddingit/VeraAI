import {
  ZillowObservedListingSchema,
  type JsonObject,
  type ZillowObservedListing
} from "@vera/domain";

import {
  RawListingEnvelopeSchema,
  StructuredListingInputSchema,
  type RawListingEnvelope
} from "./contracts.ts";

export const ZILLOW_BROWSER_RESEARCH_CONNECTOR_ID = "zillow.browser-research.v1";

export function zillowObservedListingToEnvelope(
  rawListing: ZillowObservedListing
): RawListingEnvelope {
  const listing = ZillowObservedListingSchema.parse(rawListing);
  const sourceUrl = listing.finalDetailPageUrl ?? listing.canonicalObservedUrl;
  const structured = StructuredListingInputSchema.parse({
    source: "zillow",
    sourceListingId: listing.sourceListingId,
    url: sourceUrl,
    monthlyRentCents: listing.rentUsd === null ? null : listing.rentUsd * 100,
    baseRent:
      listing.rentUsd === null
        ? null
        : {
            amountMinorUnits: listing.rentUsd * 100,
            currency: "USD",
            billingPeriod: "month",
            rawAmount: `$${listing.rentUsd.toLocaleString("en-US")}/month`
          },
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    addressText: listing.address,
    squareFeet: listing.squareFeet,
    availabilityRaw: listing.availability,
    amenities: listing.amenities
  });
  return RawListingEnvelopeSchema.parse({
    connectorId: ZILLOW_BROWSER_RESEARCH_CONNECTOR_ID,
    capability: "browser.capture",
    acquisitionMode: "local_browser",
    source: "zillow",
    sourceListingId: listing.sourceListingId,
    sourceUrl,
    captureMethod: "local_browser",
    observedAt: listing.observedAt,
    sourcePostedAt: null,
    rawText: null,
    rawJson: structured,
    captureMetadata: {
      networkAccess: true,
      untrustedContent: true,
      browserAccess: "policy_entry_present"
    }
  });
}

export function zillowResearchSafeCaptureMetadata(
  rawListing: ZillowObservedListing,
  input: {
    readonly veraRunId: string;
    readonly searchProfileId: string;
  }
): JsonObject {
  const listing = ZillowObservedListingSchema.parse(rawListing);
  return {
    connectorId: ZILLOW_BROWSER_RESEARCH_CONNECTOR_ID,
    capability: "browser.capture",
    searchProfileId: input.searchProfileId,
    veraRunId: input.veraRunId,
    extractionMethod: "openclaw_semantic_snapshot",
    missingFields: listing.missingFields,
    safeExtractionWarnings: listing.safeExtractionWarnings,
    researchNotes: listing.researchNotes,
    sourceFieldProvenance: listing.sourceFieldProvenance
  };
}
