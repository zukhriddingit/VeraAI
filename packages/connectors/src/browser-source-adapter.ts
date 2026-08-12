import { createHmac } from "node:crypto";

import {
  BROWSER_RESEARCH_MAX_ACTIONS,
  BROWSER_RESEARCH_MAX_DURATION_MS,
  BROWSER_RESEARCH_MAX_RESULTS,
  BrowserResearchObservedListingSchema,
  BrowserResearchPlanPayloadSchema,
  BrowserResearchPlanSchema,
  BrowserResearchSourcePolicy,
  BU_OFF_CAMPUS_CONFIGURATION,
  BOSTON_CRAIGSLIST_CONFIGURATION,
  HousingSourceConfigurationSchema,
  configuredBrowserResearchPolicy,
  type BrowserResearchObservedListing,
  type BrowserResearchObservedListingInput,
  type BrowserResearchPlan,
  type BrowserResearchPlanPayload,
  type BrowserResearchSource,
  type HousingSourceConfiguration,
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
  facebook_marketplace: "facebook-marketplace.browser-research.v1",
  bu_off_campus: "offcampus-partners.browser-research.v1",
  custom_website: "generic-housing.browser-research.v1",
  craigslist: "craigslist.browser-research.v1"
} as const satisfies Record<BrowserResearchSource, string>;

export const BROWSER_SOURCE_OPERATIONS = {
  zillow: "zillow.rental_research.v2",
  apartments_com: "apartments_com.rental_research.v1",
  facebook_marketplace: "facebook_marketplace.rental_research.v1",
  bu_off_campus: "offcampus_partners.rental_research.v1",
  custom_website: "generic_housing.rental_research.v1",
  craigslist: "craigslist.rental_research.v1"
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
  readonly mode?: "discovery" | "enrichment" | "current_page";
  readonly targetListingUrl?: string;
  readonly sourceConfiguration?: HousingSourceConfiguration;
}

export interface BrowserSourceAdapter {
  readonly source: BrowserResearchSource;
  readonly connectorId: string;
  readonly operation: string;
  readonly maxDetailPages: number;
  createPlan(input: CreateBrowserResearchPlanInput): BrowserResearchPlan;
  toEnvelope(listing: BrowserResearchObservedListingInput): RawListingEnvelope;
  safeCaptureMetadata(
    listing: BrowserResearchObservedListingInput,
    input: { readonly veraRunId: string; readonly searchProfileId: string }
  ): JsonObject;
}

function adapter(
  source: BrowserResearchSource,
  configuredSource?: HousingSourceConfiguration
): BrowserSourceAdapter {
  const policy =
    configuredSource === undefined
      ? BrowserResearchSourcePolicy[source]
      : configuredBrowserResearchPolicy(configuredSource);
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
          maxResults:
            input.maxResults ??
            (input.mode === "enrichment" || input.mode === "current_page"
              ? 1
              : BROWSER_RESEARCH_MAX_RESULTS),
          maxDetailPages:
            input.maxDetailPages ??
            (input.mode === "enrichment" || input.mode === "current_page" ? 1 : 0),
          maxActions:
            input.mode === "enrichment" || input.mode === "current_page"
              ? 10
              : BROWSER_RESEARCH_MAX_ACTIONS,
          maxDurationMilliseconds: BROWSER_RESEARCH_MAX_DURATION_MS,
          startingTabReference: input.startingTabReference,
          allowedHostnames: [...policy.hostnames],
          allowedUrlPatterns: [...policy.urlPatterns],
          enabledSafeActionTypes:
            input.mode === "current_page"
              ? ["inspect_shared_tabs", "snapshot", "extract_observed_facts"]
              : input.mode === "enrichment"
                ? [
                    "inspect_shared_tabs",
                    "create_source_tab",
                    "navigate_same_source",
                    "snapshot",
                    "scroll_bounded",
                    "extract_observed_facts"
                  ]
                : [
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
          expiresAt: new Date(input.issuedAt.getTime() + 120_000).toISOString(),
          ...(input.mode === "enrichment"
            ? { mode: "enrichment" as const, targetListingUrl: input.targetListingUrl ?? null }
            : input.mode === "current_page"
              ? { mode: "current_page" as const, targetListingUrl: null }
              : {}),
          ...(configuredSource === undefined ? {} : { sourceConfiguration: configuredSource })
        },
        input.signingKey
      );
    },
    toEnvelope(rawListing) {
      const listing = BrowserResearchObservedListingSchema.parse(rawListing);
      if (listing.source !== source) throw new Error("browser_research_source_mismatch");
      if (
        configuredSource !== undefined &&
        JSON.stringify(listing.sourceConfiguration) !== JSON.stringify(configuredSource)
      ) {
        throw new Error("browser_research_configuration_mismatch");
      }
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
        sourcePostedAt: listing.sourceUpdatedAt,
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
      if (
        configuredSource !== undefined &&
        JSON.stringify(listing.sourceConfiguration) !== JSON.stringify(configuredSource)
      ) {
        throw new Error("browser_research_configuration_mismatch");
      }
      const observed = observedFacts(listing);
      return {
        connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
        capability: "browser.capture",
        searchProfileId: input.searchProfileId,
        veraRunId: input.veraRunId,
        extractionMethod: "openclaw_semantic_snapshot",
        visibleFees: listing.fees,
        originalListingUrl: listing.finalDetailPageUrl ?? listing.canonicalObservedUrl,
        firstObservedPhoto:
          listing.photos[0] === undefined
            ? null
            : {
                sourceUrl: listing.photos[0].url,
                position: 0,
                width: listing.photos[0].width,
                height: listing.photos[0].height,
                safeContentHash: null,
                observedAt: listing.observedAt
              },
        latestSourceUpdateTime: listing.sourceUpdatedAt,
        missingFields: listing.missingFields,
        safeExtractionWarnings: [
          ...listing.safeExtractionWarnings,
          ...(observed.separatedAdjacentFacebookMarkers
            ? ["Separated exact adjacent Facebook price and bedroom markers from visible evidence."]
            : [])
        ],
        researchNotes: listing.researchNotes,
        sourceFieldProvenance: listing.sourceFieldProvenance,
        sourceConfigurationId: listing.sourceConfiguration?.sourceId ?? null,
        sourceDisplayName: listing.sourceConfiguration?.displayName ?? null,
        allowedSourceDomain: listing.sourceConfiguration?.allowedDomain ?? null,
        sourceConfiguration: listing.sourceConfiguration ?? null
      };
    }
  };
}

export const ZILLOW_BROWSER_SOURCE_ADAPTER = adapter("zillow");
export const APARTMENTS_BROWSER_SOURCE_ADAPTER = adapter("apartments_com");
export const FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER = adapter("facebook_marketplace");
export class OffCampusPartnersAdapter implements BrowserSourceAdapter {
  readonly source = "bu_off_campus" as const;
  readonly connectorId = BROWSER_SOURCE_CONNECTOR_IDS.bu_off_campus;
  readonly operation = BROWSER_SOURCE_OPERATIONS.bu_off_campus;
  readonly maxDetailPages: number;
  readonly #delegate: BrowserSourceAdapter;

  constructor(readonly configuration: HousingSourceConfiguration) {
    if (configuration.adapterKind !== "offcampus_partners") {
      throw new Error("offcampus_partners_configuration_required");
    }
    this.#delegate = adapter(this.source, configuration);
    this.maxDetailPages = this.#delegate.maxDetailPages;
  }

  createPlan(input: CreateBrowserResearchPlanInput): BrowserResearchPlan {
    return this.#delegate.createPlan({ ...input, sourceConfiguration: this.configuration });
  }

  toEnvelope(listing: BrowserResearchObservedListingInput): RawListingEnvelope {
    return this.#delegate.toEnvelope(listing);
  }

  safeCaptureMetadata(
    listing: BrowserResearchObservedListingInput,
    input: { readonly veraRunId: string; readonly searchProfileId: string }
  ): JsonObject {
    return this.#delegate.safeCaptureMetadata(listing, input);
  }
}

export class GenericHousingSourceAdapter implements BrowserSourceAdapter {
  readonly source = "custom_website" as const;
  readonly connectorId = BROWSER_SOURCE_CONNECTOR_IDS.custom_website;
  readonly operation = BROWSER_SOURCE_OPERATIONS.custom_website;
  readonly maxDetailPages: number;
  readonly #delegate: BrowserSourceAdapter;

  constructor(readonly configuration: HousingSourceConfiguration) {
    if (configuration.adapterKind !== "generic") {
      throw new Error("generic_housing_configuration_required");
    }
    this.#delegate = adapter(this.source, configuration);
    this.maxDetailPages = this.#delegate.maxDetailPages;
  }

  createPlan(input: CreateBrowserResearchPlanInput): BrowserResearchPlan {
    return this.#delegate.createPlan({ ...input, sourceConfiguration: this.configuration });
  }

  toEnvelope(listing: BrowserResearchObservedListingInput): RawListingEnvelope {
    return this.#delegate.toEnvelope(listing);
  }

  safeCaptureMetadata(
    listing: BrowserResearchObservedListingInput,
    input: { readonly veraRunId: string; readonly searchProfileId: string }
  ): JsonObject {
    return this.#delegate.safeCaptureMetadata(listing, input);
  }
}

export class CraigslistBrowserSourceAdapter implements BrowserSourceAdapter {
  readonly source = "craigslist" as const;
  readonly connectorId = BROWSER_SOURCE_CONNECTOR_IDS.craigslist;
  readonly operation = BROWSER_SOURCE_OPERATIONS.craigslist;
  readonly maxDetailPages: number;
  readonly #delegate: BrowserSourceAdapter;

  constructor(readonly configuration: HousingSourceConfiguration) {
    if (configuration.adapterKind !== "craigslist") {
      throw new Error("craigslist_configuration_required");
    }
    this.#delegate = adapter(this.source, configuration);
    this.maxDetailPages = this.#delegate.maxDetailPages;
  }

  createPlan(input: CreateBrowserResearchPlanInput): BrowserResearchPlan {
    return this.#delegate.createPlan({ ...input, sourceConfiguration: this.configuration });
  }

  toEnvelope(listing: BrowserResearchObservedListingInput): RawListingEnvelope {
    return this.#delegate.toEnvelope(listing);
  }

  safeCaptureMetadata(
    listing: BrowserResearchObservedListingInput,
    input: { readonly veraRunId: string; readonly searchProfileId: string }
  ): JsonObject {
    return this.#delegate.safeCaptureMetadata(listing, input);
  }
}

export const BU_OFF_CAMPUS_BROWSER_SOURCE_ADAPTER = new OffCampusPartnersAdapter(
  BU_OFF_CAMPUS_CONFIGURATION
);
export const CRAIGSLIST_BROWSER_SOURCE_ADAPTER = new CraigslistBrowserSourceAdapter(
  BOSTON_CRAIGSLIST_CONFIGURATION
);

export const BROWSER_SOURCE_ADAPTERS = {
  zillow: ZILLOW_BROWSER_SOURCE_ADAPTER,
  apartments_com: APARTMENTS_BROWSER_SOURCE_ADAPTER,
  facebook_marketplace: FACEBOOK_MARKETPLACE_BROWSER_SOURCE_ADAPTER,
  bu_off_campus: BU_OFF_CAMPUS_BROWSER_SOURCE_ADAPTER,
  craigslist: CRAIGSLIST_BROWSER_SOURCE_ADAPTER
} as const satisfies Record<Exclude<BrowserResearchSource, "custom_website">, BrowserSourceAdapter>;

export function getBrowserSourceAdapter(
  source: BrowserResearchSource,
  configuration?: HousingSourceConfiguration
): BrowserSourceAdapter {
  const configuredSource =
    configuration === undefined
      ? undefined
      : HousingSourceConfigurationSchema.parse({
          sourceId: configuration.sourceId,
          displayName: configuration.displayName,
          adapterKind: configuration.adapterKind,
          startingUrl: configuration.startingUrl,
          allowedDomain: configuration.allowedDomain,
          loginRequired: configuration.loginRequired,
          defaultInclude: configuration.defaultInclude
        });
  if (source === "custom_website") {
    if (configuredSource === undefined) throw new Error("custom_housing_configuration_required");
    return new GenericHousingSourceAdapter(configuredSource);
  }
  if (source === "bu_off_campus" && configuredSource !== undefined) {
    return new OffCampusPartnersAdapter(configuredSource);
  }
  if (source === "craigslist" && configuredSource !== undefined) {
    return new CraigslistBrowserSourceAdapter(configuredSource);
  }
  return BROWSER_SOURCE_ADAPTERS[source];
}
