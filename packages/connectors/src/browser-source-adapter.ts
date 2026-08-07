import { createHmac } from "node:crypto";

import {
  BROWSER_RESEARCH_MAX_ACTIONS,
  BROWSER_RESEARCH_MAX_DURATION_MS,
  BROWSER_RESEARCH_MAX_RESULTS,
  BrowserResearchObservedListingSchema,
  BrowserResearchPlanPayloadSchema,
  BrowserResearchPlanSchema,
  BrowserResearchSourcePolicy,
  type BrowserResearchObservedListing,
  type BrowserResearchPlan,
  type BrowserResearchPlanPayload,
  type BrowserResearchSource,
  type JsonObject,
  type SearchProfile,
  type ZillowSharedTabReference
} from "@vera/domain";

import {
  RawListingEnvelopeSchema,
  StructuredListingInputSchema,
  type RawListingEnvelope
} from "./contracts.ts";

export const BROWSER_SOURCE_CONNECTOR_IDS = {
  zillow: "zillow.browser-research.v2",
  apartments_com: "apartments-com.browser-research.v1",
  facebook_marketplace: "facebook-marketplace.browser-research.v1"
} as const satisfies Record<BrowserResearchSource, string>;

export const BROWSER_SOURCE_OPERATIONS = {
  zillow: "zillow.rental_research.v2",
  apartments_com: "apartments_com.rental_research.v1",
  facebook_marketplace: "facebook_marketplace.rental_research.v1"
} as const satisfies Record<BrowserResearchSource, string>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function propertyType(
  profile: SearchProfile
): "apartment" | "house" | "townhouse" | "condo" | undefined {
  const constraint = profile.hardConstraints.find(
    (candidate) =>
      candidate.field.trim().toLowerCase() === "propertytype" &&
      candidate.operator === "equals" &&
      typeof candidate.value === "string"
  );
  const value = typeof constraint?.value === "string" ? constraint.value.trim().toLowerCase() : "";
  return ["apartment", "house", "townhouse", "condo"].includes(value)
    ? (value as "apartment" | "house" | "townhouse" | "condo")
    : undefined;
}

function profileInput(profile: SearchProfile) {
  const maximumCents = profile.absoluteMonthlyMaximumCents ?? profile.targetMonthlyTotalCents;
  if (maximumCents === null || maximumCents < 100) {
    throw new Error("browser_research_profile_incomplete");
  }
  const rentalPropertyType = propertyType(profile);
  return {
    location: profile.locationText,
    maximumRentUsd: Math.floor(maximumCents / 100),
    minimumBedrooms: profile.minimumBedrooms ?? 0,
    ...(profile.minimumBathrooms === null ? {} : { minimumBathrooms: profile.minimumBathrooms }),
    ...(rentalPropertyType === undefined ? {} : { rentalPropertyType })
  };
}

function observedFacts(listing: BrowserResearchObservedListing): {
  readonly rentUsd: number | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly separatedAdjacentFacebookMarkers: boolean;
} {
  if (
    listing.source !== "facebook_marketplace" ||
    listing.rentUsd === null ||
    listing.propertyName === null
  ) {
    return {
      rentUsd: listing.rentUsd,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      separatedAdjacentFacebookMarkers: false
    };
  }
  const adjacent = /^\$(\d{1,3}(?:,\d{3})?)(\d+(?:\.5)?)\s+Beds?\s+(\d+(?:\.5)?)\s+Baths?\b/iu.exec(
    listing.propertyName
  );
  if (!adjacent) {
    return {
      rentUsd: listing.rentUsd,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      separatedAdjacentFacebookMarkers: false
    };
  }
  const rentDigits = adjacent[1]!.replaceAll(",", "");
  const bedroomDigits = adjacent[2]!;
  const observedBedrooms = Number(bedroomDigits);
  const observedBathrooms = Number(adjacent[3]!);
  if (
    (listing.bedrooms !== null && observedBedrooms !== listing.bedrooms) ||
    (listing.bathrooms !== null && observedBathrooms !== listing.bathrooms) ||
    Number(`${rentDigits}${bedroomDigits.replace(".", "")}`) !== listing.rentUsd
  ) {
    return {
      rentUsd: listing.rentUsd,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      separatedAdjacentFacebookMarkers: false
    };
  }
  return {
    rentUsd: Number(rentDigits),
    bedrooms: listing.bedrooms ?? observedBedrooms,
    bathrooms: listing.bathrooms ?? observedBathrooms,
    separatedAdjacentFacebookMarkers: true
  };
}

export function signBrowserResearchPlan(
  rawPayload: BrowserResearchPlanPayload,
  signingKey: string
): BrowserResearchPlan {
  if (signingKey.length < 32 || signingKey.length > 4_096) {
    throw new Error("VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY must contain 32 to 4096 characters.");
  }
  const payload = BrowserResearchPlanPayloadSchema.parse(rawPayload);
  return BrowserResearchPlanSchema.parse({
    ...payload,
    signature: createHmac("sha256", signingKey).update(canonical(payload)).digest("hex")
  });
}

export interface CreateBrowserResearchPlanInput {
  readonly veraRunId: string;
  readonly profile: SearchProfile;
  readonly startingTabReference: ZillowSharedTabReference;
  readonly signingKey: string;
  readonly issuedAt: Date;
  readonly maxResults?: number;
  readonly maxDetailPages?: number;
}

export interface BrowserSourceAdapter {
  readonly source: BrowserResearchSource;
  readonly connectorId: string;
  readonly operation: string;
  readonly maxDetailPages: number;
  createPlan(input: CreateBrowserResearchPlanInput): BrowserResearchPlan;
  toEnvelope(listing: BrowserResearchObservedListing): RawListingEnvelope;
  safeCaptureMetadata(
    listing: BrowserResearchObservedListing,
    input: { readonly veraRunId: string; readonly searchProfileId: string }
  ): JsonObject;
}

function adapter(source: BrowserResearchSource): BrowserSourceAdapter {
  const policy = BrowserResearchSourcePolicy[source];
  return {
    source,
    connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
    operation: BROWSER_SOURCE_OPERATIONS[source],
    maxDetailPages: policy.maxDetailPages,
    createPlan(input) {
      const issuedAt = input.issuedAt.toISOString();
      return signBrowserResearchPlan(
        {
          version: "1",
          veraRunId: input.veraRunId,
          source,
          profile: profileInput(input.profile),
          maxResults: input.maxResults ?? BROWSER_RESEARCH_MAX_RESULTS,
          maxDetailPages: input.maxDetailPages ?? policy.maxDetailPages,
          maxActions: BROWSER_RESEARCH_MAX_ACTIONS,
          maxDurationMilliseconds: BROWSER_RESEARCH_MAX_DURATION_MS,
          startingTabReference: input.startingTabReference,
          allowedHostnames: [...policy.hostnames],
          allowedUrlPatterns: [...policy.urlPatterns],
          enabledSafeActionTypes: [
            "inspect_shared_tabs",
            "create_source_tab",
            "navigate_same_source",
            "snapshot",
            "scroll_bounded",
            "select_reviewed_filter",
            "fill_approved_search_field",
            "open_observed_listing",
            "return_to_results",
            "extract_observed_facts"
          ],
          issuedAt,
          expiresAt: new Date(input.issuedAt.getTime() + 120_000).toISOString()
        },
        input.signingKey
      );
    },
    toEnvelope(rawListing) {
      const listing = BrowserResearchObservedListingSchema.parse(rawListing);
      if (listing.source !== source) throw new Error("browser_research_source_mismatch");
      const sourceUrl = listing.finalDetailPageUrl ?? listing.canonicalObservedUrl;
      const observed = observedFacts(listing);
      const structured = StructuredListingInputSchema.parse({
        source,
        sourceListingId: listing.sourceListingId,
        title: listing.propertyName,
        url: sourceUrl,
        monthlyRentCents: observed.rentUsd === null ? null : observed.rentUsd * 100,
        baseRent:
          observed.rentUsd === null
            ? null
            : {
                amountMinorUnits: observed.rentUsd * 100,
                currency: "USD",
                billingPeriod: "month",
                rawAmount: `$${observed.rentUsd.toLocaleString("en-US")}/month`
              },
        bedrooms: observed.bedrooms,
        bathrooms: observed.bathrooms,
        addressText: listing.address,
        squareFeet: listing.squareFeet,
        availabilityRaw: listing.availability,
        amenities: listing.amenities
      });
      return RawListingEnvelopeSchema.parse({
        connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
        capability: "browser.capture",
        acquisitionMode: "local_browser",
        source,
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
    },
    safeCaptureMetadata(rawListing, input) {
      const listing = BrowserResearchObservedListingSchema.parse(rawListing);
      if (listing.source !== source) throw new Error("browser_research_source_mismatch");
      const observed = observedFacts(listing);
      return {
        connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
        capability: "browser.capture",
        searchProfileId: input.searchProfileId,
        veraRunId: input.veraRunId,
        extractionMethod: "openclaw_semantic_snapshot",
        visibleFees: listing.fees,
        missingFields: listing.missingFields,
        safeExtractionWarnings: [
          ...listing.safeExtractionWarnings,
          ...(observed.separatedAdjacentFacebookMarkers
            ? ["Separated exact adjacent Facebook price and bedroom markers from visible evidence."]
            : [])
        ],
        researchNotes: listing.researchNotes,
        sourceFieldProvenance: listing.sourceFieldProvenance
      };
    }
  };
}

export const ZILLOW_BROWSER_SOURCE_ADAPTER = adapter("zillow");
export const APARTMENTS_BROWSER_SOURCE_ADAPTER = adapter("apartments_com");
export const FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER = adapter("facebook_marketplace");

export const BROWSER_SOURCE_ADAPTERS = {
  zillow: ZILLOW_BROWSER_SOURCE_ADAPTER,
  apartments_com: APARTMENTS_BROWSER_SOURCE_ADAPTER,
  facebook_marketplace: FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER
} as const satisfies Record<BrowserResearchSource, BrowserSourceAdapter>;

export function getBrowserSourceAdapter(source: BrowserResearchSource): BrowserSourceAdapter {
  return BROWSER_SOURCE_ADAPTERS[source];
}
