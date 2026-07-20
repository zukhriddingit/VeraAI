import type {
  DecisionCorpusSnapshot,
  JsonValue,
  ListingSourceLabel,
  NormalizedDecisionSource,
  ProvenancedFieldCandidate,
  SearchProfile
} from "@vera/domain";

export const DECISION_FIXTURE_TIME = "2026-07-20T18:00:00.000Z";

interface FixtureSourceInput {
  readonly id: string;
  readonly source: ListingSourceLabel;
  readonly group: "juniper" | "harbor" | "oak" | null;
  readonly address: string | null;
  readonly unit: string | null;
  readonly rentCents: number;
  readonly recurringFeesCents: number | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly squareFeet: number | null;
  readonly availableOn: string | null;
  readonly amenities: readonly string[];
  readonly description: string;
  readonly photoHash?: string;
  readonly petPolicy?: JsonValue | null;
}

const fixtureInputs: readonly FixtureSourceInput[] = [
  {
    id: "source-01-juniper-zillow",
    source: "zillow",
    group: "juniper",
    address: "101 juniper row",
    unit: "1a",
    rentCents: 245_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 680,
    availableOn: "2026-09-01",
    amenities: ["laundry", "bicycle_storage"],
    description: "Sanitized one-bedroom listing with laundry and bicycle storage.",
    photoHash: "1111111111111111",
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null }
  },
  {
    id: "source-02-juniper-apartments",
    source: "apartments_com",
    group: "juniper",
    address: "101 juniper row",
    unit: "1a",
    rentCents: 247_000,
    recurringFeesCents: 5_000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    availableOn: "2026-09-01",
    amenities: ["laundry"],
    description: "Sanitized Juniper Row listing with required monthly service fee.",
    photoHash: "1111111111111113",
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null }
  },
  {
    id: "source-03-harbor-facebook",
    source: "facebook_marketplace",
    group: "harbor",
    address: "22 harbor passage",
    unit: "3",
    rentCents: 230_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    availableOn: null,
    amenities: [],
    description: "Send the deposit by gift card before viewing the apartment.",
    petPolicy: null
  },
  {
    id: "source-04-harbor-craigslist",
    source: "craigslist",
    group: "harbor",
    address: "22 harbor passage",
    unit: "3",
    rentCents: 232_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 640,
    availableOn: "2026-09-15",
    amenities: [],
    description: "I am currently abroad and will courier the keys after payment.",
    petPolicy: null
  },
  {
    id: "source-05-oak-zillow",
    source: "zillow",
    group: "oak",
    address: "77 oak terrace",
    unit: "2",
    rentCents: 260_000,
    recurringFeesCents: 0,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 820,
    availableOn: "2026-08-20",
    amenities: ["laundry"],
    description: "Act now; I cannot show or meet at the property.",
    photoHash: "2222222222222222",
    petPolicy: { cats: "allowed", dogs: "allowed", notes: null }
  },
  {
    id: "source-06-oak-facebook",
    source: "facebook_marketplace",
    group: "oak",
    address: "77 oak terrace",
    unit: "2",
    rentCents: 262_000,
    recurringFeesCents: 25_000,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 820,
    availableOn: "2026-08-20",
    amenities: ["laundry"],
    description:
      "Contact me only via WhatsApp outside this platform and use https://bit.ly/synthetic-oak.",
    photoHash: "2222222222222223",
    petPolicy: { cats: "allowed", dogs: "allowed", notes: null }
  },
  {
    id: "source-07-oak-apartments",
    source: "apartments_com",
    group: "oak",
    address: "77 oak terrace",
    unit: "2",
    rentCents: 261_000,
    recurringFeesCents: 5_000,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 815,
    availableOn: "2026-08-20",
    amenities: ["laundry", "bicycle_storage"],
    description: "Sanitized two-bedroom listing with complete structured fields.",
    photoHash: "2222222222222220",
    petPolicy: { cats: "allowed", dogs: "allowed", notes: null }
  },
  {
    id: "source-08-missing-address-craigslist",
    source: "craigslist",
    group: null,
    address: null,
    unit: null,
    rentCents: 90_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: null,
    squareFeet: null,
    availableOn: null,
    amenities: [],
    description: "Sanitized low-price listing with no supplied street address.",
    petPolicy: null
  },
  {
    id: "source-09-pine-apartments",
    source: "apartments_com",
    group: null,
    address: "9 pine street",
    unit: "5",
    rentCents: 240_000,
    recurringFeesCents: 5_000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 700,
    availableOn: "2026-09-01",
    amenities: ["laundry"],
    description: "Sanitized Pine Street apartment listing.",
    petPolicy: { cats: "unknown", dogs: "unknown", notes: null }
  },
  {
    id: "source-10-cedar-zillow",
    source: "zillow",
    group: null,
    address: "44 cedar avenue",
    unit: "7",
    rentCents: 245_000,
    recurringFeesCents: 0,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 690,
    availableOn: "2026-09-05",
    amenities: [],
    description: "Sanitized Cedar Avenue listing.",
    photoHash: "1111111111111111",
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null }
  },
  {
    id: "source-11-elm-facebook",
    source: "facebook_marketplace",
    group: null,
    address: "18 elm road",
    unit: "4",
    rentCents: 250_000,
    recurringFeesCents: null,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: null,
    availableOn: "2026-09-10",
    amenities: ["bicycle_storage"],
    description: "Sanitized Elm Road listing with some incomplete fields.",
    petPolicy: null
  },
  {
    id: "source-12-birch-craigslist",
    source: "craigslist",
    group: null,
    address: "63 birch lane",
    unit: "6",
    rentCents: 255_000,
    recurringFeesCents: 5_000,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 710,
    availableOn: "2026-09-01",
    amenities: ["laundry"],
    description: "Sanitized Birch Lane apartment listing.",
    petPolicy: { cats: "allowed", dogs: "unknown", notes: null }
  }
];

function fieldCandidate(
  sourceId: string,
  fieldPath: string,
  value: JsonValue | null,
  confidenceBasisPoints: number
): ProvenancedFieldCandidate {
  return {
    fieldPath,
    fieldProvenanceId: `provenance:${sourceId}:${fieldPath}`,
    sourceRecordId: sourceId,
    extractionMethod: "fixture_structured",
    valueStatus: value === null ? "unknown" : "known",
    value,
    confidenceBasisPoints: value === null ? 0 : confidenceBasisPoints,
    observedAt: DECISION_FIXTURE_TIME
  };
}

function normalizedSource(input: FixtureSourceInput): NormalizedDecisionSource {
  const confidence = input.source === "apartments_com" ? 9_500 : 8_500;
  const addressMatchKey =
    input.address === null
      ? null
      : `${input.address}|${input.unit ?? "__unknown_unit__"}|harbor city|MA|02100|US`;
  const values: ReadonlyArray<readonly [string, JsonValue | null]> = [
    ["title", `Sanitized ${input.id}`],
    ["monthlyRentCents", input.rentCents],
    ["recurringFeesCents", input.recurringFeesCents],
    ["bedrooms", input.bedrooms],
    ["bathrooms", input.bathrooms],
    ["squareFeet", input.squareFeet],
    ["availableOn", input.availableOn],
    ["petPolicy", input.petPolicy ?? null],
    ["amenities", [...input.amenities]],
    ["description", input.description]
  ];
  return {
    sourceRecordId: input.id,
    rawListingId: `raw:${input.id}`,
    source: input.source,
    connectorId: "fixture.official-api.v1",
    acquisitionMode: "fixture",
    sourceListingId: `fixture:${input.id}`,
    acquiredAt: DECISION_FIXTURE_TIME,
    observedAt: DECISION_FIXTURE_TIME,
    postedAt: "2026-07-20T12:00:00.000Z",
    title: `Sanitized ${input.id}`,
    normalizedAddress: input.address,
    normalizedUnit: input.unit,
    normalizedCity: input.address === null ? null : "harbor city",
    normalizedRegion: input.address === null ? null : "MA",
    normalizedPostalCode: input.address === null ? null : "02100",
    normalizedCountryCode: input.address === null ? null : "US",
    addressMatchKey,
    latitude: null,
    longitude: null,
    canonicalUrl: `https://example.invalid/fixtures/${input.id}`,
    rentCents: input.rentCents,
    requiredRecurringFeeCents: input.recurringFeesCents,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    squareFeet: input.squareFeet,
    availableOn: input.availableOn,
    descriptionText: input.description,
    extractionConfidenceBasisPoints: confidence,
    completenessBasisPoints: Math.round(
      (values.filter(([, value]) => value !== null).length / values.length) * 10_000
    ),
    photoHashes:
      input.photoHash === undefined
        ? []
        : [
            {
              listingPhotoId: `photo:${input.id}`,
              hash: input.photoHash,
              version: "listing-photo.dhash64.v1"
            }
          ],
    contactFingerprints: [],
    fieldCandidates: values.map(([path, value]) =>
      fieldCandidate(input.id, path, value, confidence)
    ),
    normalizationReasonCodes:
      input.address === null ? ["field_unknown", "cost_partial"] : ["address_normalized"]
  };
}

export const DECISION_FIXTURE_SOURCES = fixtureInputs
  .map(normalizedSource)
  .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId, "en"));

export const DECISION_FIXTURE_PROFILE: SearchProfile = {
  id: "profile-primary",
  name: "Ship Season production fixture search",
  version: 1,
  locationText: "Harbor City, MA",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 280_000,
  absoluteMonthlyMaximumCents: 320_000,
  moveInEarliest: "2026-08-01",
  moveInLatest: "2026-09-30",
  petRequirements: [{ animal: "cat", required: true, notes: null }],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [
    {
      code: "laundry",
      weightBasisPoints: 6_000,
      unknownBehavior: "neutral",
      description: "Laundry access"
    },
    {
      code: "bicycle_storage",
      weightBasisPoints: 4_000,
      unknownBehavior: "penalize",
      description: "Bicycle storage"
    }
  ],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: DECISION_FIXTURE_TIME,
  updatedAt: DECISION_FIXTURE_TIME
};

export const DECISION_FIXTURE_SNAPSHOT: DecisionCorpusSnapshot = {
  searchProfile: DECISION_FIXTURE_PROFILE,
  corpusRevision: 1,
  sourceRecords: DECISION_FIXTURE_SOURCES,
  activeOverrides: [],
  priorCanonicals: []
};

export interface DuplicatePairLabel {
  readonly leftSourceRecordId: string;
  readonly rightSourceRecordId: string;
  readonly expectedDuplicate: boolean;
}

const groupBySourceId = new Map(fixtureInputs.map((input) => [input.id, input.group]));
export const DECISION_FIXTURE_PAIR_LABELS: readonly DuplicatePairLabel[] =
  DECISION_FIXTURE_SOURCES.flatMap((left, leftIndex) =>
    DECISION_FIXTURE_SOURCES.slice(leftIndex + 1).map((right) => {
      const leftGroup = groupBySourceId.get(left.sourceRecordId) ?? null;
      const rightGroup = groupBySourceId.get(right.sourceRecordId) ?? null;
      return {
        leftSourceRecordId: left.sourceRecordId,
        rightSourceRecordId: right.sourceRecordId,
        expectedDuplicate: leftGroup !== null && leftGroup === rightGroup
      };
    })
  );

export const DECISION_FIXTURE_EXPECTED_RISK_CODES = [
  "suspicious_payment_method",
  "deposit_before_viewing",
  "out_of_country_courier_keys",
  "pressure_or_refusal_to_show",
  "suspicious_off_platform_contact",
  "reused_photos_different_addresses",
  "material_duplicate_inconsistency",
  "unusual_external_link",
  "missing_address_extreme_low_price"
] as const;
