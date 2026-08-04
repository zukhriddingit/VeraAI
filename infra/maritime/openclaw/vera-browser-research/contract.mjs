import { createHmac, timingSafeEqual } from "node:crypto";

export const TOOL_NAME = "vera_browser_research_v1";
export const MAX_RESULTS = 10;
export const MAX_DETAIL_PAGES = 5;
export const MAX_ACTIONS = 50;
export const MAX_DURATION_MS = 90_000;
export const SINGLE_SHARED_TAB_CONSENT_REFERENCE = "explicitly_shared_zillow_rental_tab";

export const SOURCE_POLICY = Object.freeze({
  zillow: Object.freeze({
    hostnames: Object.freeze(["www.zillow.com"]),
    urlPatterns: Object.freeze([
      "^https://www\\.zillow\\.com/(?:homes/for_rent|homedetails|apartments)(?:/|\\?|$)"
    ]),
    maxDetailPages: 5
  }),
  apartments_com: Object.freeze({
    hostnames: Object.freeze(["www.apartments.com"]),
    urlPatterns: Object.freeze(["^https://www\\.apartments\\.com/(?:[^?#]+/)?(?:\\?[^#]*)?$"]),
    maxDetailPages: 5
  }),
  facebook_marketplace: Object.freeze({
    hostnames: Object.freeze(["www.facebook.com"]),
    urlPatterns: Object.freeze([
      "^https://www\\.facebook\\.com/marketplace/(?:[a-z0-9-]+/(?:category/propertyrentals|propertyrentals)|item/[0-9]+)(?:/|\\?|$)"
    ]),
    maxDetailPages: 3
  })
});

export const SAFE_ACTIONS = Object.freeze([
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
]);

const PROPERTY_TYPES = new Set(["apartment", "house", "townhouse", "condo"]);
const PLAN_KEYS = new Set([
  "version",
  "veraRunId",
  "source",
  "profile",
  "maxResults",
  "maxDetailPages",
  "maxActions",
  "maxDurationMilliseconds",
  "startingTabReference",
  "allowedHostnames",
  "allowedUrlPatterns",
  "enabledSafeActionTypes",
  "issuedAt",
  "expiresAt",
  "signature"
]);
const PROFILE_KEYS = new Set([
  "location",
  "maximumRentUsd",
  "minimumBedrooms",
  "minimumBathrooms",
  "rentalPropertyType"
]);

export class VeraBrowserResearchError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "VeraBrowserResearchError";
    this.code = code;
    this.pageState = options.pageState ?? "ready";
    this.manualAction = options.manualAction ?? null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.has(key));
}

function text(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function number(value, minimum, maximum) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function iso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function validateTabReference(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(["kind", "value"]))) return false;
  if (value.kind === "single_shared_tab") {
    return value.value === SINGLE_SHARED_TAB_CONSENT_REFERENCE;
  }
  return (
    value.kind === "target_id" &&
    text(value.value, 256) &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value.value)
  );
}

function verifySignature(plan, key) {
  if (typeof key !== "string" || key.length < 32 || key.length > 4_096) return false;
  const { signature, ...payload } = plan;
  const expected = createHmac("sha256", key).update(canonical(payload)).digest("hex");
  if (!/^[a-f0-9]{64}$/u.test(signature)) return false;
  const suppliedBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function validateResearchPlan(
  value,
  signingKey = process.env.VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY
) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, PLAN_KEYS) ||
    Object.keys(value).length !== PLAN_KEYS.size
  ) {
    throw new VeraBrowserResearchError("invalid_tool_input");
  }
  const policy = SOURCE_POLICY[value.source];
  if (
    value.version !== "1" ||
    !text(value.veraRunId, 160) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value.veraRunId) ||
    policy === undefined ||
    !integer(value.maxResults, 1, MAX_RESULTS) ||
    !integer(value.maxDetailPages, 0, policy.maxDetailPages) ||
    !integer(value.maxActions, 1, MAX_ACTIONS) ||
    !integer(value.maxDurationMilliseconds, 1_000, MAX_DURATION_MS) ||
    !validateTabReference(value.startingTabReference) ||
    !exactArray(value.allowedHostnames, policy.hostnames) ||
    !exactArray(value.allowedUrlPatterns, policy.urlPatterns) ||
    !exactArray(value.enabledSafeActionTypes, SAFE_ACTIONS) ||
    !iso(value.issuedAt) ||
    !iso(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
    Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 120_000 ||
    Date.parse(value.expiresAt) <= Date.now()
  ) {
    throw new VeraBrowserResearchError("invalid_tool_input");
  }
  const profile = value.profile;
  if (
    !isRecord(profile) ||
    !hasOnlyKeys(profile, PROFILE_KEYS) ||
    !text(profile.location, 160) ||
    !integer(profile.maximumRentUsd, 1, 1_000_000) ||
    !number(profile.minimumBedrooms, 0, 20) ||
    (profile.minimumBathrooms !== undefined && !number(profile.minimumBathrooms, 0, 20)) ||
    (profile.rentalPropertyType !== undefined && !PROPERTY_TYPES.has(profile.rentalPropertyType))
  ) {
    throw new VeraBrowserResearchError("invalid_tool_input");
  }
  if (!verifySignature(value, signingKey)) {
    throw new VeraBrowserResearchError("plan_signature_invalid");
  }
  return Object.freeze(structuredClone(value));
}

export function validateObservedUrl(rawUrl, source, kind = "either") {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VeraBrowserResearchError("unsafe_source_url");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== SOURCE_POLICY[source]?.hostnames[0] ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new VeraBrowserResearchError("unsafe_source_url");
  }
  for (const key of url.searchParams.keys()) {
    if (
      /^(?:password|token|access_token|refresh_token|authorization|secret|cookie|session|sessionid)$/iu.test(
        key
      )
    ) {
      throw new VeraBrowserResearchError("unsafe_source_url");
    }
  }
  let actualKind = "result";
  if (source === "apartments_com") {
    actualKind = /^\/[a-z0-9-]+\/[a-z0-9]{7}\/$/u.test(url.pathname) ? "detail" : "result";
  } else if (source === "facebook_marketplace") {
    actualKind = /^\/marketplace\/item\/[0-9]+\/$/u.test(url.pathname) ? "detail" : "result";
  } else {
    actualKind = /^(?:\/homedetails\/|\/apartments\/)/u.test(url.pathname) ? "detail" : "result";
  }
  if (kind !== "either" && actualKind !== kind) {
    throw new VeraBrowserResearchError("source_surface_not_allowed");
  }
  return { kind: actualKind, url: url.href };
}

export function validateResearchOutput(value, plan) {
  if (
    !isRecord(value) ||
    value.version !== "1" ||
    value.veraRunId !== plan.veraRunId ||
    value.source !== plan.source ||
    !["completed", "partial", "no_results", "failed", "manual_action_required"].includes(
      value.state
    ) ||
    ![
      "ready",
      "login_required",
      "two_factor_required",
      "captcha_required",
      "checkpoint_required",
      "consent_required",
      "blocked",
      "layout_changed",
      "no_results"
    ].includes(value.pageState) ||
    !Array.isArray(value.listings) ||
    value.listings.length > plan.maxResults ||
    !integer(value.resultCardsObserved, 0, plan.maxResults) ||
    !integer(value.detailPagesOpened, 0, plan.maxDetailPages) ||
    !integer(value.actionsUsed, 0, plan.maxActions) ||
    !iso(value.startedAt) ||
    !iso(value.completedAt) ||
    !Array.isArray(value.safeActionTrail) ||
    value.safeActionTrail.length > plan.maxActions ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 20
  ) {
    throw new VeraBrowserResearchError("invalid_tool_output");
  }
  for (const listing of value.listings) {
    if (!isRecord(listing) || listing.source !== plan.source) {
      throw new VeraBrowserResearchError("invalid_tool_output");
    }
    validateObservedUrl(listing.canonicalObservedUrl, plan.source, "detail");
    if (listing.finalDetailPageUrl !== null)
      validateObservedUrl(listing.finalDetailPageUrl, plan.source, "detail");
  }
  return Object.freeze(value);
}

export const toolParameters = {
  type: "object",
  additionalProperties: false,
  required: [...PLAN_KEYS],
  properties: {
    version: { const: "1" },
    veraRunId: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$"
    },
    source: { enum: Object.keys(SOURCE_POLICY) },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["location", "maximumRentUsd", "minimumBedrooms"],
      properties: {
        location: { type: "string", minLength: 1, maxLength: 160 },
        maximumRentUsd: { type: "integer", minimum: 1, maximum: 1_000_000 },
        minimumBedrooms: { type: "number", minimum: 0, maximum: 20 },
        minimumBathrooms: { type: "number", minimum: 0, maximum: 20 },
        rentalPropertyType: { enum: [...PROPERTY_TYPES] }
      }
    },
    maxResults: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
    maxDetailPages: { type: "integer", minimum: 0, maximum: MAX_DETAIL_PAGES },
    maxActions: { type: "integer", minimum: 1, maximum: MAX_ACTIONS },
    maxDurationMilliseconds: { type: "integer", minimum: 1_000, maximum: MAX_DURATION_MS },
    startingTabReference: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: { kind: { enum: ["target_id", "single_shared_tab"] }, value: { type: "string" } }
    },
    allowedHostnames: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    allowedUrlPatterns: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
    enabledSafeActionTypes: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { enum: SAFE_ACTIONS }
    },
    issuedAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    signature: { type: "string", pattern: "^[a-f0-9]{64}$" }
  }
};
