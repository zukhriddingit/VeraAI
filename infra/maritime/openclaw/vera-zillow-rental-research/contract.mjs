export const TOOL_NAME = "vera_zillow_rental_research_v1";
export const MAX_RESULTS = 10;
export const MAX_DETAIL_PAGES = 5;
export const MAX_RESULT_EXPANSIONS = 2;
export const MAX_DURATION_MS = 90_000;

const PROPERTY_TYPES = new Set(["apartment", "house", "townhouse", "condo"]);
export const SINGLE_SHARED_TAB_CONSENT_REFERENCE = "explicitly_shared_zillow_rental_tab";
const MANUAL_ACTIONS = new Set([
  "login_required",
  "two_factor_required",
  "captcha_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "browser_offline",
  "no_shared_tab",
  "multiple_shared_tabs",
  "shared_tab_changed",
  "cancelled"
]);
const LISTING_KEYS = new Set([
  "sourceListingId",
  "canonicalObservedUrl",
  "finalDetailPageUrl",
  "address",
  "rentUsd",
  "bedrooms",
  "bathrooms",
  "squareFeet",
  "availability",
  "amenities",
  "observedAt",
  "sourceFieldProvenance",
  "missingFields",
  "safeExtractionWarnings",
  "researchNotes"
]);
const OBSERVED_FIELDS = new Set([
  "source_listing_id",
  "canonical_observed_url",
  "final_detail_page_url",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities"
]);
const MISSING_FIELDS = new Set([
  "source_listing_id",
  "address",
  "rent",
  "bedrooms",
  "bathrooms",
  "square_footage",
  "availability",
  "amenities"
]);
const SAFE_ACTIONS = new Set([
  "verify_shared_tab",
  "snapshot",
  "set_reviewed_filter",
  "navigate_observed",
  "scroll_bounded",
  "open_observed_listing",
  "return_to_results"
]);
const INPUT_KEYS = new Set([
  "version",
  "veraRunId",
  "profile",
  "maxResults",
  "maxDetailPages",
  "startingTabReference"
]);
const PROFILE_KEYS = new Set([
  "location",
  "maximumRentUsd",
  "minimumBedrooms",
  "minimumBathrooms",
  "rentalPropertyType"
]);
const TAB_KEYS = new Set(["kind", "value"]);

export class VeraZillowResearchError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "VeraZillowResearchError";
    this.code = code;
    this.pageState = options.pageState ?? "ready";
    this.manualAction = options.manualAction ?? null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requiredText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function boundedNumber(value, minimum, maximum) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function validateResearchInput(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, INPUT_KEYS)) {
    throw new VeraZillowResearchError("invalid_tool_input");
  }
  if (
    value.version !== "1" ||
    !requiredText(value.veraRunId, 160) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value.veraRunId) ||
    !boundedInteger(value.maxResults, 1, MAX_RESULTS) ||
    !boundedInteger(value.maxDetailPages, 0, MAX_DETAIL_PAGES)
  ) {
    throw new VeraZillowResearchError("invalid_tool_input");
  }
  if (
    !isRecord(value.profile) ||
    !hasOnlyKeys(value.profile, PROFILE_KEYS) ||
    !requiredText(value.profile.location, 160) ||
    !boundedInteger(value.profile.maximumRentUsd, 1, 1_000_000) ||
    !boundedNumber(value.profile.minimumBedrooms, 0, 20) ||
    (value.profile.minimumBathrooms !== undefined &&
      !boundedNumber(value.profile.minimumBathrooms, 0, 20)) ||
    (value.profile.rentalPropertyType !== undefined &&
      !PROPERTY_TYPES.has(value.profile.rentalPropertyType))
  ) {
    throw new VeraZillowResearchError("invalid_tool_input");
  }
  if (
    !isRecord(value.startingTabReference) ||
    !hasOnlyKeys(value.startingTabReference, TAB_KEYS) ||
    !(
      (value.startingTabReference.kind === "target_id" &&
        requiredText(value.startingTabReference.value, 256) &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value.startingTabReference.value)) ||
      (value.startingTabReference.kind === "single_shared_tab" &&
        value.startingTabReference.value === SINGLE_SHARED_TAB_CONSENT_REFERENCE)
    )
  ) {
    throw new VeraZillowResearchError("invalid_tool_input");
  }
  return Object.freeze({
    version: "1",
    veraRunId: value.veraRunId.trim(),
    profile: Object.freeze({
      location: value.profile.location.trim(),
      maximumRentUsd: value.profile.maximumRentUsd,
      minimumBedrooms: value.profile.minimumBedrooms,
      ...(value.profile.minimumBathrooms === undefined
        ? {}
        : { minimumBathrooms: value.profile.minimumBathrooms }),
      ...(value.profile.rentalPropertyType === undefined
        ? {}
        : { rentalPropertyType: value.profile.rentalPropertyType })
    }),
    maxResults: value.maxResults,
    maxDetailPages: value.maxDetailPages,
    startingTabReference: Object.freeze({
      kind: value.startingTabReference.kind,
      value: value.startingTabReference.value.trim()
    })
  });
}

function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validZillowUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.zillow.com" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function nullableText(value, maximum) {
  return value === null || requiredText(value, maximum);
}

function nullableNumber(value, maximum, integer = false) {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= maximum &&
      (!integer || Number.isInteger(value)))
  );
}

function safeTextArray(value, maximumItems, maximumCharacters) {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((entry) => requiredText(entry, maximumCharacters))
  );
}

export function validateResearchOutput(value) {
  if (!isRecord(value)) throw new VeraZillowResearchError("invalid_tool_output");
  const expectedKeys = new Set([
    "version",
    "veraRunId",
    "state",
    "pageState",
    "manualAction",
    "listings",
    "resultCardsObserved",
    "detailPagesOpened",
    "resultPageExpansions",
    "startedAt",
    "completedAt",
    "safeActionTrail",
    "warnings"
  ]);
  if (!hasOnlyKeys(value, expectedKeys) || Object.keys(value).length !== expectedKeys.size) {
    throw new VeraZillowResearchError("invalid_tool_output");
  }
  if (
    value.version !== "1" ||
    !requiredText(value.veraRunId, 160) ||
    !["completed", "partial", "failed", "manual_action_required"].includes(value.state) ||
    ![
      "ready",
      "login_required",
      "two_factor_required",
      "captcha_required",
      "consent_required",
      "blocked",
      "layout_changed"
    ].includes(value.pageState) ||
    !Array.isArray(value.listings) ||
    value.listings.length > MAX_RESULTS ||
    !boundedInteger(value.resultCardsObserved, 0, MAX_RESULTS) ||
    !boundedInteger(value.detailPagesOpened, 0, MAX_DETAIL_PAGES) ||
    !boundedInteger(value.resultPageExpansions, 0, MAX_RESULT_EXPANSIONS) ||
    !isIsoDateTime(value.startedAt) ||
    !isIsoDateTime(value.completedAt) ||
    !Array.isArray(value.safeActionTrail) ||
    value.safeActionTrail.length > 100 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 20
  ) {
    throw new VeraZillowResearchError("invalid_tool_output");
  }
  if (
    (value.state === "manual_action_required") !==
    (typeof value.manualAction === "string" && MANUAL_ACTIONS.has(value.manualAction))
  ) {
    throw new VeraZillowResearchError("invalid_tool_output");
  }
  for (const listing of value.listings) {
    if (
      !isRecord(listing) ||
      !hasOnlyKeys(listing, LISTING_KEYS) ||
      Object.keys(listing).length !== LISTING_KEYS.size ||
      !nullableText(listing.sourceListingId, 200) ||
      !validZillowUrl(listing.canonicalObservedUrl) ||
      (listing.finalDetailPageUrl !== null && !validZillowUrl(listing.finalDetailPageUrl)) ||
      !nullableText(listing.address, 300) ||
      !nullableNumber(listing.rentUsd, 1_000_000, true) ||
      !nullableNumber(listing.bedrooms, 20) ||
      !nullableNumber(listing.bathrooms, 20) ||
      !nullableNumber(listing.squareFeet, 1_000_000, true) ||
      !nullableText(listing.availability, 200) ||
      !safeTextArray(listing.amenities, 30, 160) ||
      !isIsoDateTime(listing.observedAt) ||
      !Array.isArray(listing.sourceFieldProvenance) ||
      listing.sourceFieldProvenance.length > 30 ||
      !Array.isArray(listing.missingFields) ||
      listing.missingFields.length > MISSING_FIELDS.size ||
      !listing.missingFields.every((field) => MISSING_FIELDS.has(field)) ||
      new Set(listing.missingFields).size !== listing.missingFields.length ||
      !safeTextArray(listing.safeExtractionWarnings, 20, 240) ||
      !safeTextArray(listing.researchNotes, 20, 240)
    ) {
      throw new VeraZillowResearchError("invalid_tool_output");
    }
    const provenanceFields = new Set();
    for (const provenance of listing.sourceFieldProvenance) {
      if (
        !isRecord(provenance) ||
        !hasOnlyKeys(
          provenance,
          new Set([
            "field",
            "observedFrom",
            "sourceUrl",
            "extractionMethod",
            "confidenceBasisPoints",
            "observedAt"
          ])
        ) ||
        Object.keys(provenance).length !== 6 ||
        !OBSERVED_FIELDS.has(provenance.field) ||
        provenanceFields.has(provenance.field) ||
        !["result_card", "detail_page"].includes(provenance.observedFrom) ||
        !validZillowUrl(provenance.sourceUrl) ||
        provenance.extractionMethod !== "openclaw_semantic_snapshot" ||
        !boundedInteger(provenance.confidenceBasisPoints, 0, 10_000) ||
        !isIsoDateTime(provenance.observedAt)
      ) {
        throw new VeraZillowResearchError("invalid_tool_output");
      }
      provenanceFields.add(provenance.field);
    }
  }
  for (const action of value.safeActionTrail) {
    if (
      !isRecord(action) ||
      !hasOnlyKeys(
        action,
        new Set(["action", "hostname", "observedReferenceHash", "result", "occurredAt"])
      ) ||
      Object.keys(action).length !== 5 ||
      !SAFE_ACTIONS.has(action.action) ||
      action.hostname !== "www.zillow.com" ||
      (action.observedReferenceHash !== null &&
        !/^[a-f0-9]{64}$/u.test(action.observedReferenceHash)) ||
      !["allowed", "completed", "stopped"].includes(action.result) ||
      !isIsoDateTime(action.occurredAt)
    ) {
      throw new VeraZillowResearchError("invalid_tool_output");
    }
  }
  if (!safeTextArray(value.warnings, 20, 240)) {
    throw new VeraZillowResearchError("invalid_tool_output");
  }
  return value;
}

export const toolParameters = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "veraRunId",
    "profile",
    "maxResults",
    "maxDetailPages",
    "startingTabReference"
  ],
  properties: {
    version: { type: "string", enum: ["1"] },
    veraRunId: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$"
    },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["location", "maximumRentUsd", "minimumBedrooms"],
      properties: {
        location: { type: "string", minLength: 1, maxLength: 160 },
        maximumRentUsd: { type: "integer", minimum: 1, maximum: 1_000_000 },
        minimumBedrooms: { type: "number", minimum: 0, maximum: 20 },
        minimumBathrooms: { type: "number", minimum: 0, maximum: 20 },
        rentalPropertyType: {
          type: "string",
          enum: ["apartment", "house", "townhouse", "condo"]
        }
      }
    },
    maxResults: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
    maxDetailPages: { type: "integer", minimum: 0, maximum: MAX_DETAIL_PAGES },
    startingTabReference: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: {
        kind: { type: "string", enum: ["target_id", "single_shared_tab"] },
        value: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$"
        }
      },
      allOf: [
        {
          if: { properties: { kind: { const: "single_shared_tab" } } },
          then: {
            properties: {
              value: { const: SINGLE_SHARED_TAB_CONSENT_REFERENCE }
            }
          }
        }
      ]
    }
  }
};
