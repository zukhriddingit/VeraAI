import { createHash } from "node:crypto";

import {
  LIVE_RENTAL_SEARCH_MAX_RESULTS,
  SearchProfileSchema,
  type AgentRentalRecommendation,
  type SearchProfile
} from "@vera/domain";
import {
  INITIAL_LOCAL_MANIFESTS,
  SourcePolicyRegistry,
  type SourcePolicyDecision
} from "@vera/policy";
import { z } from "zod";

import {
  RawListingEnvelopeSchema,
  StructuredListingInputSchema,
  type RawListingEnvelope,
  type StructuredListingInput
} from "./contracts.ts";

export const RENTCAST_CONNECTOR_ID = "rentcast.rental-listings.v1";
export const RENTCAST_RENTAL_ENDPOINT = "https://api.rentcast.io/v1/listings/rental/long-term";

const RentCastRangeSchema = z.string().regex(/^(?:\d+(?:\.\d+)?|\*):(?:\d+(?:\.\d+)?|\*)$/u);

export const RentCastRentalQuerySchema = z
  .object({
    city: z.string().trim().min(1).max(100).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .optional(),
    zipCode: z
      .string()
      .regex(/^\d{5}$/u)
      .optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    radius: z.number().positive().max(100).optional(),
    bedrooms: RentCastRangeSchema.optional(),
    bathrooms: RentCastRangeSchema.optional(),
    price: RentCastRangeSchema.optional(),
    status: z.literal("Active"),
    limit: z.literal(LIVE_RENTAL_SEARCH_MAX_RESULTS)
  })
  .strict()
  .superRefine((query, context) => {
    const hasCoordinates =
      query.latitude !== undefined && query.longitude !== undefined && query.radius !== undefined;
    const hasLocationText =
      query.zipCode !== undefined || (query.city !== undefined && query.state !== undefined);
    if (!hasCoordinates && !hasLocationText) {
      context.addIssue({
        code: "custom",
        message: "RentCast requires explicit coordinates, ZIP, or city and state."
      });
    }
    const coordinateCount = [query.latitude, query.longitude, query.radius].filter(
      (value) => value !== undefined
    ).length;
    if (coordinateCount !== 0 && coordinateCount !== 3) {
      context.addIssue({
        code: "custom",
        message: "Latitude, longitude, and radius must be supplied together."
      });
    }
    if ((query.city === undefined) !== (query.state === undefined)) {
      context.addIssue({
        code: "custom",
        message: "City and state must be supplied together."
      });
    }
  });

const RentCastListingResponseSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    formattedAddress: z.string().trim().min(1).max(300),
    addressLine1: z.string().trim().min(1).max(200).nullish(),
    addressLine2: z.string().trim().min(1).max(100).nullish(),
    city: z.string().trim().min(1).max(100).nullish(),
    state: z.string().trim().min(1).max(100).nullish(),
    zipCode: z.string().trim().min(1).max(20).nullish(),
    latitude: z.number().finite().min(-90).max(90).nullish(),
    longitude: z.number().finite().min(-180).max(180).nullish(),
    propertyType: z.string().trim().min(1).max(100).nullish(),
    bedrooms: z.number().nonnegative().max(50).nullish(),
    bathrooms: z.number().nonnegative().max(50).nullish(),
    squareFootage: z.number().int().positive().max(1_000_000).nullish(),
    status: z.literal("Active"),
    price: z.number().int().nonnegative().safe(),
    listedDate: z.string().datetime({ offset: true }).nullish(),
    lastSeenDate: z.string().datetime({ offset: true }).nullish(),
    daysOnMarket: z.number().int().nonnegative().nullish(),
    mlsName: z.string().trim().min(1).max(160).nullish(),
    mlsNumber: z.string().trim().min(1).max(160).nullish(),
    listingOffice: z
      .object({
        name: z.string().trim().min(1).max(200).nullish(),
        website: z.string().url().max(2_048).nullish()
      })
      .passthrough()
      .nullish()
  })
  .passthrough();

const RentCastResponseSchema = z
  .array(RentCastListingResponseSchema)
  .max(LIVE_RENTAL_SEARCH_MAX_RESULTS)
  .superRefine((listings, context) => {
    if (new Set(listings.map((listing) => listing.id)).size !== listings.length) {
      context.addIssue({
        code: "custom",
        message: "RentCast response listing IDs must be unique."
      });
    }
  });

export const RentCastCandidateSchema = z
  .object({
    providerListingId: z.string().trim().min(1).max(200),
    formattedAddress: z.string().trim().min(1).max(300),
    addressLine1: z.string().trim().min(1).max(200).nullable(),
    addressLine2: z.string().trim().min(1).max(100).nullable(),
    city: z.string().trim().min(1).max(100).nullable(),
    state: z.string().trim().min(1).max(100).nullable(),
    zipCode: z.string().trim().min(1).max(20).nullable(),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable(),
    propertyType: z.enum(["apartment", "condo", "house", "townhouse", "room", "other"]).nullable(),
    bedrooms: z.number().nonnegative().max(50).nullable(),
    bathrooms: z.number().nonnegative().max(50).nullable(),
    squareFeet: z.number().int().positive().max(1_000_000).nullable(),
    monthlyRentCents: z.number().int().nonnegative().safe(),
    listedAt: z.string().datetime({ offset: true }).nullable(),
    lastSeenAt: z.string().datetime({ offset: true }).nullable(),
    daysOnMarket: z.number().int().nonnegative().nullable(),
    mlsName: z.string().trim().min(1).max(160).nullable(),
    mlsNumber: z.string().trim().min(1).max(160).nullable(),
    listingOfficeName: z.string().trim().min(1).max(200).nullable(),
    listingOfficeWebsite: z.string().url().max(2_048).nullable(),
    observedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type RentCastRentalQuery = z.infer<typeof RentCastRentalQuerySchema>;
export type RentCastCandidate = z.infer<typeof RentCastCandidateSchema>;

export type RentCastFailureCode =
  | "provider_unavailable"
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_invalid_response"
  | "policy_denied";

export class RentCastConnectorError extends Error {
  constructor(
    readonly code: RentCastFailureCode,
    readonly retryable: boolean
  ) {
    super(`RentCast request failed: ${code}.`);
    this.name = "RentCastConnectorError";
  }
}

export interface RentCastConnectorOptions {
  readonly apiKey: string;
  readonly timeoutMilliseconds?: number;
  readonly maxResponseBytes?: number;
  readonly maxAttempts?: number;
  readonly fetch?: typeof fetch;
  readonly policyRegistry?: SourcePolicyRegistry;
  readonly now?: () => Date;
}

export interface RentCastSearchResult {
  readonly candidates: readonly RentCastCandidate[];
  readonly queryHash: string;
  readonly latencyMilliseconds: number;
}

function optional<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function mapPropertyType(value: string | null | undefined): RentCastCandidate["propertyType"] {
  const normalized = value?.toLowerCase().replaceAll(/[^a-z]/gu, "") ?? "";
  if (normalized.includes("apartment")) return "apartment";
  if (normalized.includes("condo")) return "condo";
  if (normalized.includes("townhouse") || normalized.includes("townhome")) return "townhouse";
  if (normalized.includes("singlefamily") || normalized.includes("house")) return "house";
  if (normalized.includes("room")) return "room";
  return value == null ? null : "other";
}

function parseExplicitLocation(locationText: string) {
  const value = locationText.trim();
  if (/^\d{5}$/u.test(value)) return { zipCode: value };
  const match = /^(?<city>[^,]{1,100}),\s*(?<state>[A-Za-z]{2})(?:\s+(?<zip>\d{5}))?$/u.exec(value);
  if (!match?.groups) {
    throw new RentCastConnectorError("provider_invalid_response", false);
  }
  return {
    city: match.groups.city!.trim(),
    state: match.groups.state!.toUpperCase(),
    ...(match.groups.zip === undefined ? {} : { zipCode: match.groups.zip })
  };
}

function providerRange(value: number): string {
  return `${value}:*`;
}

export function buildRentCastRentalQuery(inputProfile: SearchProfile): RentCastRentalQuery {
  const profile = SearchProfileSchema.parse(inputProfile);
  const coordinateFieldCount = [
    profile.centerLatitude,
    profile.centerLongitude,
    profile.radiusKilometers
  ].filter((value) => value !== null).length;
  if (coordinateFieldCount !== 0 && coordinateFieldCount !== 3) {
    throw new RentCastConnectorError("provider_invalid_response", false);
  }
  const hasCoordinates =
    profile.centerLatitude !== null &&
    profile.centerLongitude !== null &&
    profile.radiusKilometers !== null;
  const coordinates = hasCoordinates
    ? {
        latitude: profile.centerLatitude!,
        longitude: profile.centerLongitude!,
        radius: Math.round((profile.radiusKilometers! / 1.609344) * 100) / 100
      }
    : parseExplicitLocation(profile.locationText);

  return RentCastRentalQuerySchema.parse({
    ...coordinates,
    ...(profile.minimumBedrooms === null
      ? {}
      : { bedrooms: providerRange(profile.minimumBedrooms) }),
    ...(profile.minimumBathrooms === null
      ? {}
      : { bathrooms: providerRange(profile.minimumBathrooms) }),
    ...(profile.absoluteMonthlyMaximumCents === null
      ? {}
      : { price: `*:${Math.floor(profile.absoluteMonthlyMaximumCents / 100)}` }),
    status: "Active",
    limit: LIVE_RENTAL_SEARCH_MAX_RESULTS
  });
}

function querySearchParams(query: RentCastRentalQuery): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    parameters.set(key, String(value));
  }
  return parameters;
}

function hashQuery(query: RentCastRentalQuery): string {
  return createHash("sha256").update(querySearchParams(query).toString()).digest("hex");
}

function assertPolicy(registry: SourcePolicyRegistry): SourcePolicyDecision {
  const decision = registry.evaluate({
    connectorId: RENTCAST_CONNECTOR_ID,
    acquisitionMode: "official_api",
    capability: "structured_feed.read",
    execution: "manual",
    operation: "rentcast.rental_listings.search",
    hasUserSession: true,
    hasApproval: false,
    network: {
      origin: "https://api.rentcast.io/",
      domain: "api.rentcast.io",
      httpMethod: "GET"
    }
  });
  if (!decision.allowed) throw new RentCastConnectorError("policy_denied", false);
  return decision;
}

function retryableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RentCastConnectorError("provider_invalid_response", false);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new RentCastConnectorError("provider_invalid_response", false);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RentCastConnectorError("provider_invalid_response", false);
  }
}

export class RentCastConnector {
  readonly #apiKey: string;
  readonly #timeoutMilliseconds: number;
  readonly #maxResponseBytes: number;
  readonly #maxAttempts: number;
  readonly #fetch: typeof fetch;
  readonly #policyRegistry: SourcePolicyRegistry;
  readonly #now: () => Date;

  constructor(options: RentCastConnectorOptions) {
    if (options.apiKey.trim().length < 8) {
      throw new Error("RENTCAST_API_KEY is missing or invalid.");
    }
    this.#apiKey = options.apiKey;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 12_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#fetch = options.fetch ?? fetch;
    this.#policyRegistry =
      options.policyRegistry ?? new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    this.#now = options.now ?? (() => new Date());
  }

  async search(queryInput: RentCastRentalQuery): Promise<RentCastSearchResult> {
    assertPolicy(this.#policyRegistry);
    const query = RentCastRentalQuerySchema.parse(queryInput);
    const url = new URL(RENTCAST_RENTAL_ENDPOINT);
    url.search = querySearchParams(query).toString();
    const startedAt = this.#now().getTime();

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          method: "GET",
          redirect: "error",
          headers: {
            Accept: "application/json",
            "X-Api-Key": this.#apiKey
          },
          signal: AbortSignal.timeout(this.#timeoutMilliseconds)
        });
        if (response.status === 401 || response.status === 403) {
          throw new RentCastConnectorError("provider_auth_failed", false);
        }
        if (response.status === 429) {
          throw new RentCastConnectorError("provider_rate_limited", false);
        }
        if (response.status === 404) {
          return {
            candidates: [],
            queryHash: hashQuery(query),
            latencyMilliseconds: Math.max(0, this.#now().getTime() - startedAt)
          };
        }
        if (!response.ok) {
          if (retryableStatus(response.status) && attempt < this.#maxAttempts) continue;
          throw new RentCastConnectorError(
            "provider_unavailable",
            retryableStatus(response.status)
          );
        }
        const parsed = RentCastResponseSchema.safeParse(
          await readBoundedJson(response, this.#maxResponseBytes)
        );
        if (!parsed.success) {
          throw new RentCastConnectorError("provider_invalid_response", false);
        }
        const observedAt = this.#now().toISOString();
        const candidates = parsed.data.map((listing) =>
          RentCastCandidateSchema.parse({
            providerListingId: listing.id,
            formattedAddress: listing.formattedAddress,
            addressLine1: optional(listing.addressLine1),
            addressLine2: optional(listing.addressLine2),
            city: optional(listing.city),
            state: optional(listing.state),
            zipCode: optional(listing.zipCode),
            latitude: optional(listing.latitude),
            longitude: optional(listing.longitude),
            propertyType: mapPropertyType(listing.propertyType),
            bedrooms: optional(listing.bedrooms),
            bathrooms: optional(listing.bathrooms),
            squareFeet: optional(listing.squareFootage),
            monthlyRentCents: listing.price * 100,
            listedAt: optional(listing.listedDate),
            lastSeenAt: optional(listing.lastSeenDate),
            daysOnMarket: optional(listing.daysOnMarket),
            mlsName: optional(listing.mlsName),
            mlsNumber: optional(listing.mlsNumber),
            listingOfficeName: optional(listing.listingOffice?.name),
            listingOfficeWebsite: optional(listing.listingOffice?.website),
            observedAt
          })
        );
        return {
          candidates,
          queryHash: hashQuery(query),
          latencyMilliseconds: Math.max(0, this.#now().getTime() - startedAt)
        };
      } catch (error) {
        if (error instanceof RentCastConnectorError) throw error;
        const isTimeout =
          error instanceof DOMException &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        if (!isTimeout && attempt < this.#maxAttempts) continue;
        throw new RentCastConnectorError(
          isTimeout ? "provider_timeout" : "provider_unavailable",
          !isTimeout
        );
      }
    }
    throw new RentCastConnectorError("provider_unavailable", true);
  }

  toEnvelope(
    candidate: RentCastCandidate,
    queryHash: string,
    analysis: AgentRentalRecommendation | null
  ): RawListingEnvelope {
    const listing: StructuredListingInput = StructuredListingInputSchema.parse({
      source: "rentcast",
      sourceListingId: candidate.providerListingId,
      title: `Rental at ${candidate.formattedAddress}`,
      monthlyRentCents: candidate.monthlyRentCents,
      baseRent: {
        amountMinorUnits: candidate.monthlyRentCents,
        currency: "USD",
        billingPeriod: "month",
        rawAmount: `$${(candidate.monthlyRentCents / 100).toFixed(2)}/month`
      },
      bedrooms: candidate.bedrooms,
      bathrooms: candidate.bathrooms,
      addressText: candidate.formattedAddress,
      squareFeet: candidate.squareFeet,
      propertyType: candidate.propertyType,
      sourcePostedAt: candidate.listedAt,
      liveEvidence: {
        provider: "rentcast",
        providerListingId: candidate.providerListingId,
        queryHash,
        observedAt: candidate.observedAt,
        activeStatus: "Active",
        addressComponents: {
          line1: candidate.addressLine1,
          line2: candidate.addressLine2,
          city: candidate.city,
          state: candidate.state,
          postalCode: candidate.zipCode
        },
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        listedAt: candidate.listedAt,
        lastSeenAt: candidate.lastSeenAt,
        daysOnMarket: candidate.daysOnMarket,
        mlsName: candidate.mlsName,
        mlsNumber: candidate.mlsNumber,
        listingOfficeName: candidate.listingOfficeName,
        listingOfficeWebsite: candidate.listingOfficeWebsite,
        agentAnalysis: analysis
      }
    });
    return RawListingEnvelopeSchema.parse({
      connectorId: RENTCAST_CONNECTOR_ID,
      capability: "structured_feed.read",
      acquisitionMode: "official_api",
      source: "rentcast",
      sourceListingId: candidate.providerListingId,
      sourceUrl: null,
      captureMethod: "official_api",
      observedAt: candidate.observedAt,
      sourcePostedAt: candidate.listedAt,
      rawText: null,
      rawJson: listing,
      captureMetadata: {
        networkAccess: true,
        untrustedContent: true,
        browserAccess: "not_applicable"
      }
    });
  }
}
