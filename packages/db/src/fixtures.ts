import type {
  CanonicalListing,
  DuplicateCluster,
  ListingAddress,
  ListingSourceLabel,
  ListingSourceRecord,
  ListingScore,
  PetPolicy,
  RawListingCapture,
  RiskSignal,
  SearchProfile,
  SourcePolicyManifest
} from "@vera/domain";

import { sha256Text } from "./hashing.ts";

const createdAt = "2026-07-17T12:20:00.000Z";

interface SourceFixtureOptions {
  key: string;
  source: ListingSourceLabel;
  observedAt: string;
  title: string;
  address: ListingAddress;
  monthlyRentCents: number | null;
  recurringFeesCents: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  propertyType: ListingSourceRecord["propertyType"];
  availableOn: string | null;
  leaseTermMonths: number | null;
  petPolicy: PetPolicy | null;
  amenities: string[];
  description: string | null;
  completenessBasisPoints: number;
}

export interface SourceFixture {
  readonly capture: RawListingCapture;
  readonly sourceRecord: ListingSourceRecord;
  readonly request: {
    readonly kind: "fixture";
    readonly sanitized: true;
    readonly listing: {
      readonly source: ListingSourceLabel;
      readonly sourceListingId: string;
      readonly title: string;
      readonly url: string;
      readonly monthlyRentCents?: number;
      readonly bedrooms?: number;
      readonly bathrooms?: number;
      readonly addressText?: string;
      readonly squareFeet?: number;
      readonly propertyType?: NonNullable<ListingSourceRecord["propertyType"]>;
      readonly baseRent?: {
        readonly amountMinorUnits: number;
        readonly currency: "USD";
        readonly billingPeriod: "month";
        readonly rawAmount: string;
      };
      readonly requiredRecurringFees?: readonly {
        readonly label: string;
        readonly amount: {
          readonly amountMinorUnits: number;
          readonly currency: "USD";
          readonly billingPeriod: "month";
          readonly rawAmount: string;
        };
      }[];
      readonly availableOn?: string;
      readonly leaseTermMonths?: number;
      readonly catsAllowed?: boolean;
      readonly dogsAllowed?: boolean;
      readonly amenities: readonly string[];
    };
  };
}

export interface CanonicalFixture {
  readonly listing: CanonicalListing;
  readonly memberSourceRecordIds: readonly string[];
  readonly selectedSourceRecordByField: Readonly<Record<string, string>>;
}

function makeSourceFixture(options: SourceFixtureOptions): SourceFixture {
  const rawListingId = `raw-${options.key}`;
  const sourceRecordId = `src-${options.key}`;
  const sourceListingId = `fixture-${options.key}`;
  const sourceUrl = `https://example.invalid/fixtures/${options.source}/${options.key}`;
  const addressText = [
    options.address.line1,
    options.address.unit,
    options.address.city,
    options.address.region,
    options.address.postalCode
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const listing = {
    source: options.source,
    sourceListingId,
    title: options.title,
    url: sourceUrl,
    ...(options.monthlyRentCents === null
      ? {}
      : {
          monthlyRentCents: options.monthlyRentCents,
          baseRent: {
            amountMinorUnits: options.monthlyRentCents,
            currency: "USD" as const,
            billingPeriod: "month" as const,
            rawAmount: `$${String(options.monthlyRentCents / 100)} per month`
          }
        }),
    ...(options.recurringFeesCents === null
      ? {}
      : {
          requiredRecurringFees: [
            {
              label: "Synthetic required fees",
              amount: {
                amountMinorUnits: options.recurringFeesCents,
                currency: "USD" as const,
                billingPeriod: "month" as const,
                rawAmount: `$${String(options.recurringFeesCents / 100)} per month`
              }
            }
          ]
        }),
    ...(options.bedrooms === null ? {} : { bedrooms: options.bedrooms }),
    ...(options.bathrooms === null ? {} : { bathrooms: options.bathrooms }),
    ...(addressText.length === 0 ? {} : { addressText }),
    ...(options.squareFeet === null ? {} : { squareFeet: options.squareFeet }),
    ...(options.propertyType === null ? {} : { propertyType: options.propertyType }),
    ...(options.availableOn === null ? {} : { availableOn: options.availableOn }),
    ...(options.leaseTermMonths === null ? {} : { leaseTermMonths: options.leaseTermMonths }),
    ...(options.petPolicy === null || options.petPolicy.cats === "unknown"
      ? {}
      : { catsAllowed: options.petPolicy.cats === "allowed" }),
    ...(options.petPolicy === null || options.petPolicy.dogs === "unknown"
      ? {}
      : { dogsAllowed: options.petPolicy.dogs === "allowed" }),
    amenities: options.amenities
  } as const;
  const request = { kind: "fixture", sanitized: true, listing } as const;
  const capture: RawListingCapture = {
    id: rawListingId,
    source: options.source,
    sourceListingId,
    sourceUrl,
    captureMethod: "fixture",
    observedAt: options.observedAt,
    sourcePostedAt: null,
    rawText: null,
    rawJson: listing,
    captureMetadata: {
      networkAccess: false,
      untrustedContent: true,
      browserAccess: "not_applicable",
      connectorId: "fixture.feed.v1",
      capability: "fixture.read"
    }
  };
  const sourceRecord: ListingSourceRecord = {
    id: sourceRecordId,
    rawListingId,
    source: options.source,
    sourceListingId,
    sourceUrl,
    sourcePostedAt: null,
    contactChannel: "unknown",
    title: options.title,
    address: options.address,
    monthlyRentCents: options.monthlyRentCents,
    recurringFeesCents: options.recurringFeesCents,
    bedrooms: options.bedrooms,
    bathrooms: options.bathrooms,
    squareFeet: options.squareFeet,
    propertyType: options.propertyType,
    availableOn: options.availableOn,
    leaseTermMonths: options.leaseTermMonths,
    petPolicy: options.petPolicy,
    amenities: options.amenities,
    description: options.description,
    extractionConfidenceBasisPoints: 10_000,
    completenessBasisPoints: options.completenessBasisPoints,
    observedAt: options.observedAt,
    createdAt
  };

  return { capture, sourceRecord, request };
}

const juniperZillow = makeSourceFixture({
  key: "juniper-zillow",
  source: "zillow",
  observedAt: "2026-07-17T12:12:00.000Z",
  title: "Juniper Row one-bedroom",
  address: {
    line1: "101 Juniper Row",
    unit: "1A",
    city: "Harbor City",
    region: "MA",
    postalCode: "00001",
    countryCode: "US"
  },
  monthlyRentCents: 245_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 680,
  propertyType: "apartment",
  availableOn: "2026-09-01",
  leaseTermMonths: 12,
  petPolicy: { cats: "allowed", dogs: "unknown", notes: null },
  amenities: ["Laundry", "Bicycle storage"],
  description: "Synthetic one-bedroom fixture near the fictional harbor greenway.",
  completenessBasisPoints: 9_200
});

const juniperCraigslist = makeSourceFixture({
  key: "juniper-craigslist",
  source: "craigslist",
  observedAt: "2026-07-17T12:05:00.000Z",
  title: "1BR on Juniper Row",
  address: { ...juniperZillow.sourceRecord.address },
  monthlyRentCents: 245_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: null,
  propertyType: "apartment",
  availableOn: "2026-09-01",
  leaseTermMonths: null,
  petPolicy: null,
  amenities: ["Laundry"],
  description:
    "Synthetic abbreviated duplicate fixture. Synthetic request: pay a gift card deposit before viewing.",
  completenessBasisPoints: 6_700
});

const juniperApartments = makeSourceFixture({
  key: "juniper-apartments",
  source: "apartments_com",
  observedAt: "2026-07-17T12:09:00.000Z",
  title: "Juniper Row Apartment 1A",
  address: { ...juniperZillow.sourceRecord.address },
  monthlyRentCents: 247_500,
  recurringFeesCents: 7_500,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 680,
  propertyType: "apartment",
  availableOn: "2026-09-01",
  leaseTermMonths: 12,
  petPolicy: { cats: "allowed", dogs: "not_allowed", notes: "Synthetic policy fixture." },
  amenities: ["Laundry", "Bicycle storage"],
  description: "Synthetic duplicate fixture with stated recurring fees.",
  completenessBasisPoints: 9_700
});

const harborFacebook = makeSourceFixture({
  key: "harbor-facebook",
  source: "facebook_marketplace",
  observedAt: "2026-07-17T12:10:00.000Z",
  title: "Bright harbor studio",
  address: {
    line1: "8 Harbor Walk",
    unit: null,
    city: "Harbor City",
    region: "MA",
    postalCode: "00002",
    countryCode: "US"
  },
  monthlyRentCents: 199_500,
  recurringFeesCents: null,
  bedrooms: 0,
  bathrooms: 1,
  squareFeet: null,
  propertyType: "apartment",
  availableOn: "2026-08-15",
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: [],
  description: "Synthetic studio fixture with an incomplete unit and size.",
  completenessBasisPoints: 6_600
});

const harborCraigslist = makeSourceFixture({
  key: "harbor-craigslist",
  source: "craigslist",
  observedAt: "2026-07-17T12:03:00.000Z",
  title: "Studio 4 at Harbor Walk",
  address: {
    ...harborFacebook.sourceRecord.address,
    unit: "Studio 4"
  },
  monthlyRentCents: 199_500,
  recurringFeesCents: null,
  bedrooms: 0,
  bathrooms: 1,
  squareFeet: 430,
  propertyType: "apartment",
  availableOn: null,
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: [],
  description: "Synthetic duplicate fixture with a unit and square footage.",
  completenessBasisPoints: 7_300
});

const mapleZillow = makeSourceFixture({
  key: "maple-zillow",
  source: "zillow",
  observedAt: "2026-07-17T12:08:00.000Z",
  title: "Maple Crescent two-bedroom",
  address: {
    line1: "44 Maple Crescent",
    unit: "2B",
    city: "Harbor City",
    region: "MA",
    postalCode: "00003",
    countryCode: "US"
  },
  monthlyRentCents: 285_000,
  recurringFeesCents: 5_000,
  bedrooms: 2,
  bathrooms: 1.5,
  squareFeet: 940,
  propertyType: "condo",
  availableOn: "2026-09-15",
  leaseTermMonths: 12,
  petPolicy: { cats: "allowed", dogs: "unknown", notes: null },
  amenities: ["Dishwasher", "Balcony"],
  description: "Synthetic two-bedroom fixture with an incomplete dog policy.",
  completenessBasisPoints: 9_300
});

const mapleApartments = makeSourceFixture({
  key: "maple-apartments",
  source: "apartments_com",
  observedAt: "2026-07-17T12:11:00.000Z",
  title: "Maple Crescent 2B",
  address: { ...mapleZillow.sourceRecord.address },
  monthlyRentCents: 285_000,
  recurringFeesCents: null,
  bedrooms: 2,
  bathrooms: 1.5,
  squareFeet: 940,
  propertyType: "condo",
  availableOn: "2026-09-15",
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: ["Dishwasher", "Balcony"],
  description: "Synthetic duplicate fixture with pet terms omitted.",
  completenessBasisPoints: 8_100
});

const orchardFacebook = makeSourceFixture({
  key: "orchard-facebook",
  source: "facebook_marketplace",
  observedAt: "2026-07-17T12:07:00.000Z",
  title: "Orchard Lane loft",
  address: {
    line1: "71 Orchard Lane",
    unit: "Loft 2",
    city: "Harbor City",
    region: "MA",
    postalCode: "00004",
    countryCode: "US"
  },
  monthlyRentCents: 260_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 760,
  propertyType: "apartment",
  availableOn: null,
  leaseTermMonths: 12,
  petPolicy: { cats: "unknown", dogs: "unknown", notes: null },
  amenities: ["High ceilings"],
  description: "Synthetic loft fixture with unknown availability.",
  completenessBasisPoints: 7_900
});

const cedarCraigslist = makeSourceFixture({
  key: "cedar-craigslist",
  source: "craigslist",
  observedAt: "2026-07-17T12:06:00.000Z",
  title: "Cedar Passage flat",
  address: {
    line1: "22 Cedar Passage",
    unit: null,
    city: "Harbor City",
    region: "MA",
    postalCode: "00005",
    countryCode: "US"
  },
  monthlyRentCents: 220_000,
  recurringFeesCents: null,
  bedrooms: 1,
  bathrooms: 1,
  squareFeet: 610,
  propertyType: "apartment",
  availableOn: "2026-08-20",
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: [],
  description: "Synthetic flat fixture with unknown recurring fees.",
  completenessBasisPoints: 7_600
});

const riverZillow = makeSourceFixture({
  key: "river-zillow",
  source: "zillow",
  observedAt: "2026-07-17T12:04:00.000Z",
  title: "River Way cottage",
  address: {
    line1: "90 River Way",
    unit: null,
    city: "Harbor City",
    region: "MA",
    postalCode: "00006",
    countryCode: "US"
  },
  monthlyRentCents: 310_000,
  recurringFeesCents: 0,
  bedrooms: 2,
  bathrooms: 1,
  squareFeet: null,
  propertyType: "house",
  availableOn: "2026-09-01",
  leaseTermMonths: 12,
  petPolicy: { cats: "allowed", dogs: "allowed", notes: null },
  amenities: ["Yard"],
  description: "Synthetic cottage fixture with square footage omitted.",
  completenessBasisPoints: 8_500
});

const pineApartments = makeSourceFixture({
  key: "pine-apartments",
  source: "apartments_com",
  observedAt: "2026-07-17T12:02:00.000Z",
  title: "Pine Court studio",
  address: {
    line1: "5 Pine Court",
    unit: "S1",
    city: "Harbor City",
    region: "MA",
    postalCode: "00007",
    countryCode: "US"
  },
  monthlyRentCents: 187_500,
  recurringFeesCents: 4_000,
  bedrooms: 0,
  bathrooms: 1,
  squareFeet: 405,
  propertyType: "apartment",
  availableOn: "2026-08-01",
  leaseTermMonths: 12,
  petPolicy: null,
  amenities: ["Laundry"],
  description: "Synthetic studio fixture with pet policy omitted.",
  completenessBasisPoints: 8_300
});

const marketFacebook = makeSourceFixture({
  key: "market-facebook",
  source: "facebook_marketplace",
  observedAt: "2026-07-17T12:01:00.000Z",
  title: "Market Terrace apartment",
  address: {
    line1: "33 Market Terrace",
    unit: "3C",
    city: "Harbor City",
    region: "MA",
    postalCode: "00008",
    countryCode: "US"
  },
  monthlyRentCents: null,
  recurringFeesCents: null,
  bedrooms: 2,
  bathrooms: 1,
  squareFeet: 820,
  propertyType: "apartment",
  availableOn: "2026-09-10",
  leaseTermMonths: null,
  petPolicy: { cats: "unknown", dogs: "unknown", notes: null },
  amenities: ["Storage"],
  description: "Synthetic apartment fixture with rent and lease term omitted.",
  completenessBasisPoints: 6_900
});

export const SOURCE_FIXTURES = [
  juniperZillow,
  juniperCraigslist,
  juniperApartments,
  harborFacebook,
  harborCraigslist,
  mapleZillow,
  mapleApartments,
  orchardFacebook,
  cedarCraigslist,
  riverZillow,
  pineApartments,
  marketFacebook
] as const satisfies readonly SourceFixture[];

function makeCluster(id: string, memberSourceRecordIds: readonly string[]): DuplicateCluster {
  return {
    id,
    clusterKey: sha256Text(`fixture-cluster:v1:${[...memberSourceRecordIds].sort().join(":")}`),
    algorithmVersion: "fixture-declaration-v1",
    reasonCodes: ["fixture_declared_duplicate"],
    memberSourceRecordIds: [...memberSourceRecordIds],
    createdAt
  };
}

export const DUPLICATE_CLUSTER_FIXTURES = [
  makeCluster("cluster-juniper-1a", [
    juniperZillow.sourceRecord.id,
    juniperCraigslist.sourceRecord.id,
    juniperApartments.sourceRecord.id
  ]),
  makeCluster("cluster-harbor-studio", [
    harborFacebook.sourceRecord.id,
    harborCraigslist.sourceRecord.id
  ]),
  makeCluster("cluster-maple-2b", [mapleZillow.sourceRecord.id, mapleApartments.sourceRecord.id])
] as const satisfies readonly DuplicateCluster[];

interface CanonicalOverrides {
  address?: ListingAddress;
  recurringFeesCents?: number | null;
  squareFeet?: number | null;
  completenessBasisPoints?: number;
  freshestObservedAt?: string;
}

function makeCanonical(
  id: string,
  primary: ListingSourceRecord,
  memberSourceRecordIds: readonly string[],
  duplicateClusterId: string | null,
  overrides: CanonicalOverrides = {},
  selectedSourceRecordByField: Readonly<Record<string, string>> = {}
): CanonicalFixture {
  const listing: CanonicalListing = {
    id,
    duplicateClusterId,
    primarySourceRecordId: primary.id,
    title: primary.title,
    address: overrides.address ?? primary.address,
    monthlyRentCents: primary.monthlyRentCents,
    recurringFeesCents: overrides.recurringFeesCents ?? primary.recurringFeesCents,
    bedrooms: primary.bedrooms,
    bathrooms: primary.bathrooms,
    squareFeet: overrides.squareFeet ?? primary.squareFeet,
    propertyType: primary.propertyType,
    availableOn: primary.availableOn,
    leaseTermMonths: primary.leaseTermMonths,
    petPolicy: primary.petPolicy,
    amenities: primary.amenities,
    description: primary.description,
    lifecycleState: "new",
    completenessBasisPoints: overrides.completenessBasisPoints ?? primary.completenessBasisPoints,
    freshestObservedAt: overrides.freshestObservedAt ?? primary.observedAt,
    createdAt,
    updatedAt: createdAt
  };

  return { listing, memberSourceRecordIds, selectedSourceRecordByField };
}

export const CANONICAL_FIXTURES = [
  makeCanonical(
    "can-juniper-1a",
    juniperZillow.sourceRecord,
    DUPLICATE_CLUSTER_FIXTURES[0].memberSourceRecordIds,
    DUPLICATE_CLUSTER_FIXTURES[0].id,
    {
      recurringFeesCents: juniperApartments.sourceRecord.recurringFeesCents,
      completenessBasisPoints: 9_700,
      freshestObservedAt: juniperZillow.sourceRecord.observedAt
    },
    { recurringFeesCents: juniperApartments.sourceRecord.id }
  ),
  makeCanonical(
    "can-harbor-studio",
    harborFacebook.sourceRecord,
    DUPLICATE_CLUSTER_FIXTURES[1].memberSourceRecordIds,
    DUPLICATE_CLUSTER_FIXTURES[1].id,
    {
      address: harborCraigslist.sourceRecord.address,
      squareFeet: harborCraigslist.sourceRecord.squareFeet,
      completenessBasisPoints: 8_100
    },
    {
      "address.unit": harborCraigslist.sourceRecord.id,
      squareFeet: harborCraigslist.sourceRecord.id
    }
  ),
  makeCanonical(
    "can-maple-2b",
    mapleZillow.sourceRecord,
    DUPLICATE_CLUSTER_FIXTURES[2].memberSourceRecordIds,
    DUPLICATE_CLUSTER_FIXTURES[2].id,
    { freshestObservedAt: mapleApartments.sourceRecord.observedAt }
  ),
  makeCanonical(
    "can-orchard-loft",
    orchardFacebook.sourceRecord,
    [orchardFacebook.sourceRecord.id],
    null
  ),
  makeCanonical(
    "can-cedar-flat",
    cedarCraigslist.sourceRecord,
    [cedarCraigslist.sourceRecord.id],
    null
  ),
  makeCanonical("can-river-house", riverZillow.sourceRecord, [riverZillow.sourceRecord.id], null),
  makeCanonical(
    "can-pine-studio",
    pineApartments.sourceRecord,
    [pineApartments.sourceRecord.id],
    null
  ),
  makeCanonical(
    "can-market-3c",
    marketFacebook.sourceRecord,
    [marketFacebook.sourceRecord.id],
    null
  )
] as const satisfies readonly CanonicalFixture[];

export const DEMO_SEARCH_PROFILE = {
  id: "profile-demo-harbor-city",
  name: "Harbor City September Search",
  version: 1,
  locationText: "Harbor City",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: 8,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 260_000,
  absoluteMonthlyMaximumCents: 300_000,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  petRequirements: [{ animal: "cat", required: true, notes: null }],
  commuteAnchors: [],
  hardConstraints: [
    {
      field: "monthlyTotalCents",
      operator: "at_most",
      value: 300_000,
      unknownPolicy: "allow"
    },
    { field: "bedrooms", operator: "at_least", value: 1, unknownPolicy: "allow" }
  ],
  weightedPreferences: [
    {
      code: "laundry",
      weightBasisPoints: 6_000,
      description: "Laundry in the building or unit"
    },
    {
      code: "bicycle_storage",
      weightBasisPoints: 4_000,
      description: "Secure bicycle storage"
    }
  ],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt,
  updatedAt: createdAt
} as const satisfies SearchProfile;

interface ScoreDefinition {
  readonly listingId: string;
  readonly values: readonly [number, number, number, number];
  readonly reasons: readonly [string, string, string, string];
}

const scoreDefinitions = [
  {
    listingId: "can-juniper-1a",
    values: [10_000, 10_000, 10_000, 10_000],
    reasons: [
      "total_within_target",
      "bedrooms_match",
      "required_pet_allowed",
      "move_in_window_match"
    ]
  },
  {
    listingId: "can-harbor-studio",
    values: [10_000, -10_000, 0, -10_000],
    reasons: [
      "base_rent_within_target",
      "bedrooms_below_minimum",
      "pet_policy_unknown",
      "move_in_window_conflict"
    ]
  },
  {
    listingId: "can-maple-2b",
    values: [5_000, 10_000, 10_000, 10_000],
    reasons: [
      "budget_between_target_and_maximum",
      "bedrooms_match",
      "required_pet_allowed",
      "move_in_window_match"
    ]
  },
  {
    listingId: "can-orchard-loft",
    values: [10_000, 10_000, 0, 0],
    reasons: [
      "base_rent_within_target",
      "bedrooms_match",
      "pet_policy_unknown",
      "availability_unknown"
    ]
  },
  {
    listingId: "can-cedar-flat",
    values: [10_000, 10_000, 0, -10_000],
    reasons: [
      "base_rent_within_target",
      "bedrooms_match",
      "pet_policy_unknown",
      "move_in_window_conflict"
    ]
  },
  {
    listingId: "can-river-house",
    values: [-10_000, 10_000, 10_000, 10_000],
    reasons: [
      "budget_above_maximum",
      "bedrooms_match",
      "required_pet_allowed",
      "move_in_window_match"
    ]
  },
  {
    listingId: "can-pine-studio",
    values: [10_000, -10_000, 0, -10_000],
    reasons: [
      "total_within_target",
      "bedrooms_below_minimum",
      "pet_policy_unknown",
      "move_in_window_conflict"
    ]
  },
  {
    listingId: "can-market-3c",
    values: [0, 10_000, 0, 10_000],
    reasons: ["budget_unknown", "bedrooms_match", "pet_policy_unknown", "move_in_window_match"]
  }
] as const satisfies readonly ScoreDefinition[];

const scoreFactorCodes = [
  "budget_fit",
  "bedroom_fit",
  "pet_compatibility",
  "move_in_compatibility"
] as const;

export const DEMO_SCORE_FIXTURES = scoreDefinitions.map((definition): ListingScore => {
  const factors = scoreFactorCodes.map((code, index) => ({
    code,
    scoreBasisPoints: definition.values[index] ?? 0,
    weightBasisPoints: 2_500,
    reasonCode: definition.reasons[index] ?? "unknown"
  }));
  const totalScoreBasisPoints = Math.round(
    factors.reduce((sum, factor) => sum + factor.scoreBasisPoints * factor.weightBasisPoints, 0) /
      10_000
  );

  return {
    id: `score:demo:${definition.listingId}`,
    canonicalListingId: definition.listingId,
    searchProfileId: DEMO_SEARCH_PROFILE.id,
    algorithmVersion: "demo-fit-v1",
    inputHash: sha256Text(
      `demo-score:v1:${DEMO_SEARCH_PROFILE.id}:${definition.listingId}:${definition.reasons.join(":")}`
    ),
    totalScoreBasisPoints,
    factors,
    reasonCodes: [...definition.reasons],
    computedAt: createdAt
  };
});

const juniperRiskEvidence = [
  {
    sourceRecordId: juniperCraigslist.sourceRecord.id,
    fieldPath: "description",
    summary: "Synthetic fixture requests a gift-card deposit before viewing."
  }
];

export const DEMO_RISK_FIXTURES = [
  {
    id: "risk:can-juniper-1a:payment_before_viewing",
    canonicalListingId: "can-juniper-1a",
    code: "payment_before_viewing",
    severity: "high",
    confidenceBasisPoints: 9_000,
    evidence: juniperRiskEvidence,
    verificationAction:
      "Do not pay before verifying the property and meeting through a trusted viewing process.",
    status: "open",
    createdAt,
    updatedAt: createdAt
  },
  {
    id: "risk:can-juniper-1a:high_risk_payment_language",
    canonicalListingId: "can-juniper-1a",
    code: "high_risk_payment_language",
    severity: "high",
    confidenceBasisPoints: 9_500,
    evidence: juniperRiskEvidence,
    verificationAction:
      "Verify the poster independently and do not use irreversible payment methods.",
    status: "open",
    createdAt,
    updatedAt: createdAt
  },
  {
    id: "risk:can-juniper-1a:conflicting_rent_evidence",
    canonicalListingId: "can-juniper-1a",
    code: "conflicting_rent_evidence",
    severity: "medium",
    confidenceBasisPoints: 10_000,
    evidence: [
      {
        sourceRecordId: juniperZillow.sourceRecord.id,
        fieldPath: "monthlyRentCents",
        summary: "Sanitized Zillow fixture lists 245000 cents per month."
      },
      {
        sourceRecordId: juniperApartments.sourceRecord.id,
        fieldPath: "monthlyRentCents",
        summary: "Sanitized Apartments.com fixture lists 247500 cents per month."
      }
    ],
    verificationAction: "Confirm the current rent and every required fee with a verified contact.",
    status: "open",
    createdAt,
    updatedAt: createdAt
  }
] as const satisfies readonly RiskSignal[];

const redactionRules = [
  "raw_content_from_logs",
  "full_urls_from_logs",
  "contact_details_from_logs",
  "credentials_from_logs"
] as const;

export const LOCAL_SOURCE_MANIFEST_FIXTURES = [
  {
    schemaVersion: 1,
    connectorId: "fixture.feed.v1",
    displayName: "Sanitized fixture feed",
    version: 1,
    source: "other",
    enabled: true,
    execution: "manual",
    capabilities: ["fixture.read"],
    allowedOperations: ["fixture.read_sanitized"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: false,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.fixture.feed.v1.disabled",
    dataClassification: "synthetic",
    redactionRules: [...redactionRules],
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-17",
    decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
    notes: "Reads only sanitized local fixture data and performs no network access.",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  },
  {
    schemaVersion: 1,
    connectorId: "manual.capture.v1",
    displayName: "Manual listing capture",
    version: 1,
    source: "other",
    enabled: true,
    execution: "manual",
    capabilities: ["manual.capture"],
    allowedOperations: ["capture.user_supplied"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: false,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.manual.capture.v1.disabled",
    dataClassification: "user_supplied",
    redactionRules: [...redactionRules],
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-17",
    decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
    notes: "Stores user-supplied text or structured data; provenance URLs are never fetched.",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  }
] as const satisfies readonly SourcePolicyManifest[];

export const DISABLED_SOURCE_MANIFEST_FIXTURES = [
  "zillow",
  "facebook_marketplace",
  "craigslist",
  "apartments_com"
].map((source): SourcePolicyManifest => ({
  schemaVersion: 1,
  connectorId: `fixture-label-${source}`,
  displayName: "Sanitized source label",
  version: 1,
  source: source as ListingSourceLabel,
  enabled: false,
  execution: "manual",
  capabilities: [],
  allowedOperations: [],
  allowedDomains: [],
  allowedOrigins: [],
  allowedHttpMethods: [],
  requiresUserSession: true,
  requiresApproval: true,
  minimumIntervalSeconds: null,
  maxConcurrency: 1,
  globalKillSwitchKey: "integrations.disabled",
  connectorKillSwitchKey: "integrations.legacy_source_labels",
  dataClassification: "synthetic",
  redactionRules: [...redactionRules],
  manualBlockerBehavior: "stop_and_request_user_action",
  owner: "Vera maintainers",
  reviewedAt: "2026-07-17",
  decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
  notes: "Sanitized source label only. No platform access capability is enabled.",
  createdAt,
  updatedAt: createdAt
}));

export const SOURCE_POLICY_MANIFEST_FIXTURES = [
  ...LOCAL_SOURCE_MANIFEST_FIXTURES,
  ...DISABLED_SOURCE_MANIFEST_FIXTURES
] as const satisfies readonly SourcePolicyManifest[];

type ProvenanceSource = ListingSourceRecord | CanonicalListing;

export function normalizedFactEntries(
  record: ProvenanceSource
): ReadonlyArray<readonly [string, unknown]> {
  const entries: Array<readonly [string, unknown]> = [
    ["title", record.title],
    ["address.line1", record.address.line1],
    ["address.unit", record.address.unit],
    ["address.city", record.address.city],
    ["address.region", record.address.region],
    ["address.postalCode", record.address.postalCode],
    ["address.countryCode", record.address.countryCode],
    ["monthlyRentCents", record.monthlyRentCents],
    ["recurringFeesCents", record.recurringFeesCents],
    ["bedrooms", record.bedrooms],
    ["bathrooms", record.bathrooms],
    ["squareFeet", record.squareFeet],
    ["propertyType", record.propertyType],
    ["availableOn", record.availableOn],
    ["leaseTermMonths", record.leaseTermMonths],
    ["amenities", record.amenities],
    ["description", record.description]
  ];

  if (record.petPolicy !== null) {
    entries.push(
      ["petPolicy.cats", record.petPolicy.cats],
      ["petPolicy.dogs", record.petPolicy.dogs],
      ["petPolicy.notes", record.petPolicy.notes]
    );
  }

  return entries.filter((entry) => entry[1] !== null);
}
