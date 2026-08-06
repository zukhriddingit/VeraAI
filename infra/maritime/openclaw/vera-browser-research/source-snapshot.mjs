import { VeraBrowserResearchError, validateObservedUrl } from "./contract.mjs";

const REVIEWED_HOSTS = new Set(["www.zillow.com", "www.apartments.com", "www.facebook.com"]);
const FORBIDDEN_CONTROL =
  /\b(?:contact|apply|request\s+(?:a\s+)?tour|tour|message|messenger|email|phone|payment|pay|upload|download|create\s+(?:an?\s+)?account|sign\s*in|log\s*in|seller\s+profile|favorites?|save\s+search|notify\s+me|create\s+new\s+listing)\b/iu;
const BLOCKERS = [
  [
    "two_factor_required",
    /\b(?:two[- ]factor|2fa|two[- ]step|verification code|security code|approve your login)\b/iu
  ],
  ["captcha_required", /\b(?:captcha|verify you are human|press and hold|human verification)\b/iu],
  ["checkpoint_required", /\b(?:checkpoint|confirm your identity|security check)\b/iu],
  [
    "consent_required",
    /\b(?:accept all cookies|cookie consent|privacy consent|consent preferences|manage consent)\b/iu
  ],
  [
    "blocked",
    /\b(?:access denied|temporarily blocked|unusual traffic|bot challenge|pardon the interruption)\b/iu
  ],
  [
    "login_required",
    /\b(?:sign in to continue|log in to continue|enter your (?:email|password)|forgot password)\b/iu
  ]
];
const AMENITIES = [
  ["in unit washer & dryer", "In-unit laundry"],
  ["in-unit laundry", "In-unit laundry"],
  ["laundry", "Laundry"],
  ["dishwasher", "Dishwasher"],
  ["air conditioning", "Air conditioning"],
  ["fitness center", "Fitness center"],
  ["pool", "Pool"],
  ["parking", "Parking"],
  ["garage", "Garage"],
  ["balcony", "Balcony"],
  ["elevator", "Elevator"],
  ["pets allowed", "Pets allowed"],
  ["pet friendly", "Pet friendly"]
];

function clean(value, maximum = 500) {
  return String(value ?? "")
    .replaceAll("\u0000", "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function parseRefs(payload) {
  if (typeof payload.refs !== "object" || payload.refs === null || Array.isArray(payload.refs))
    return [];
  return Object.entries(payload.refs).flatMap(([ref, candidate]) => {
    if (!/^(?:e\d+|\d{1,9})$/iu.test(ref) || typeof candidate !== "object" || candidate === null)
      return [];
    const role = clean(candidate.role, 40).toLowerCase();
    const name = clean(candidate.name, 300);
    return role && name ? [{ ref, role, name }] : [];
  });
}

function parseLinks(snapshot, source, refs) {
  const marker = "\n\nLinks:\n";
  const index = snapshot.indexOf(marker);
  if (index < 0) return [];
  const links = [];
  for (const line of snapshot.slice(index + marker.length).split(/\r?\n/u)) {
    const match = line.match(/^\d+\.\s+(.{1,500}?)\s+->\s+(https:\/\/\S+)$/u);
    if (!match) continue;
    try {
      let observed = new URL(match[2]);
      if (
        source === "facebook_marketplace" &&
        /^\/marketplace\/item\/[0-9]+\/?$/u.test(observed.pathname)
      ) {
        observed = new URL(`${observed.origin}${observed.pathname.replace(/\/?$/u, "/")}`);
      }
      const validated = validateObservedUrl(observed.href, source, "detail");
      const name = clean(match[1], 300);
      const matchingRef =
        refs.find((entry) => entry.role === "link" && entry.name === name)?.ref ?? null;
      links.push({ name, url: validated.url, ref: matchingRef });
    } catch {
      // Off-surface, fragment, seller, tracking-only, and unrelated links never become candidates.
    }
  }
  return links;
}

export function validateCurrentSharedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      !REVIEWED_HOSTS.has(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url;
  } catch {
    throw new VeraBrowserResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  }
}

export function parseSourceSnapshot(payload, source) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.ok !== true ||
    payload.format !== "ai" ||
    typeof payload.targetId !== "string" ||
    typeof payload.url !== "string" ||
    typeof payload.snapshot !== "string" ||
    payload.snapshot.length > 512 * 1024
  )
    throw new VeraBrowserResearchError("invalid_snapshot_response");
  const page = validateObservedUrl(payload.url, source, "either");
  const blocker = BLOCKERS.find(([, pattern]) => pattern.test(payload.snapshot));
  if (blocker)
    throw new VeraBrowserResearchError(blocker[0], {
      pageState: blocker[0],
      manualAction: blocker[0]
    });
  const refs = parseRefs(payload);
  return Object.freeze({
    targetId: payload.targetId,
    page,
    snapshot: payload.snapshot,
    refs,
    links: parseLinks(payload.snapshot, source, refs)
  });
}

export function sourceStartUrl(plan) {
  const city = clean(plan.profile.location.split(",", 1)[0], 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  const state = clean(plan.profile.location.split(",")[1] ?? "", 20)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!city) throw new VeraBrowserResearchError("invalid_search_location");
  if (plan.source === "apartments_com") {
    return validateObservedUrl(
      `https://www.apartments.com/${city}${state ? `-${state}` : ""}/`,
      plan.source,
      "result"
    ).url;
  }
  if (plan.source === "facebook_marketplace") {
    return validateObservedUrl(
      `https://www.facebook.com/marketplace/${city}/propertyrentals/`,
      plan.source,
      "result"
    ).url;
  }
  throw new VeraBrowserResearchError("source_not_supported_by_generic_adapter");
}

export function findControl(document, roles, names, occurrence = 0) {
  const roleSet = new Set(roles);
  const candidates = document.refs.filter(
    (entry) =>
      roleSet.has(entry.role) &&
      names.some((pattern) => pattern.test(entry.name)) &&
      !FORBIDDEN_CONTROL.test(entry.name)
  );
  return candidates[occurrence] ?? null;
}

export function assertSafeControl(control) {
  if (
    !control ||
    !/^(?:e\d+|\d{1,9})$/iu.test(control.ref) ||
    FORBIDDEN_CONTROL.test(control.name)
  ) {
    throw new VeraBrowserResearchError("forbidden_or_unobserved_control");
  }
  return control;
}

function windowFor(snapshot, name) {
  const lines = snapshot.split("\n\nLinks:\n", 1)[0].split(/\r?\n/u);
  const index = lines.findIndex((line) => clean(line, 1_000).includes(name));
  return lines
    .slice(Math.max(0, index - 12), Math.min(lines.length, index + 24))
    .join(" ")
    .slice(0, 10_000);
}

function money(text) {
  const match = text.match(/\$\s*([1-9][\d,]{2,8})(?:\s*\+)?/u);
  const amount = match ? Number(match[1].replaceAll(",", "")) : null;
  return Number.isSafeInteger(amount) && amount <= 1_000_000 ? amount : null;
}

function room(text, kind) {
  const pattern =
    kind === "bedrooms"
      ? /\b(\d+(?:\.\d+)?)\s*(?:bd|beds?|bedrooms?)\b/iu
      : /\b(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/iu;
  const match = text.match(pattern);
  const value = match ? Number(match[1]) : null;
  return Number.isFinite(value) && value >= 0 && value <= 20 ? value : null;
}

function squareFeet(text) {
  const match = text.match(/\b([1-9][\d,]{2,8})\s*(?:sq\.?\s*ft\.?|square feet)\b/iu);
  const value = match ? Number(match[1].replaceAll(",", "")) : null;
  return Number.isSafeInteger(value) && value <= 1_000_000 ? value : null;
}

function amenities(text) {
  const lower = text.toLowerCase();
  return [
    ...new Set(AMENITIES.filter(([needle]) => lower.includes(needle)).map(([, label]) => label))
  ].slice(0, 30);
}

function address(text, source) {
  if (source === "facebook_marketplace") {
    return (
      clean(text.match(/(?:^|,\s)([A-Za-z .'-]{2,80},\s*[A-Z]{2})(?:,|$)/u)?.[1] ?? "", 300) || null
    );
  }
  return (
    clean(
      text.match(
        /\b(\d{1,6}(?:-\d{1,6})?\s+[^,]{2,120},\s*[^,]{2,60},\s*[A-Z]{2}\s+\d{5})\b/u
      )?.[1] ?? "",
      300
    ) || null
  );
}

function propertyName(name, source) {
  if (source === "facebook_marketplace") return clean(name.split(/,\s*\$/u, 1)[0], 300) || null;
  return clean(name.replace(/,\s*[^,]+,\s*[A-Z]{2}$/u, ""), 300) || null;
}

function sourceId(url, source) {
  return source === "facebook_marketplace"
    ? (url.match(/\/item\/([0-9]+)\//u)?.[1] ?? null)
    : (url.match(/\/([a-z0-9]{7})\/$/u)?.[1] ?? null);
}

export function extractSourceCards(document, plan, observedAt) {
  const seen = new Set();
  const cards = [];
  for (const link of document.links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const evidence = `${link.name} ${windowFor(document.snapshot, link.name)}`;
    const listing = {
      source: plan.source,
      sourceListingId: sourceId(link.url, plan.source),
      canonicalObservedUrl: link.url,
      finalDetailPageUrl: null,
      propertyName: propertyName(link.name, plan.source),
      address: address(evidence, plan.source),
      rentUsd: money(evidence),
      bedrooms: room(evidence, "bedrooms"),
      bathrooms: room(evidence, "bathrooms"),
      squareFeet: squareFeet(evidence),
      availability:
        clean(
          evidence.match(
            /\b(?:available now|available (?:on )?[A-Za-z]{3,9}\s+\d{1,2}(?:,\s+\d{4})?)\b/iu
          )?.[0] ?? "",
          300
        ) || null,
      amenities: amenities(evidence),
      fees: /\b(?:plus fees|application fee|admin fee|amenity fee)\b/iu.test(evidence)
        ? [
            clean(
              evidence.match(
                /\b(?:plus fees|application fee|admin fee|amenity fee)[^,.;]{0,80}/iu
              )?.[0],
              200
            )
          ]
        : [],
      observedAt,
      sourceFieldProvenance: [],
      missingFields: [],
      safeExtractionWarnings: [],
      researchNotes: ["Observed in a bounded read-only result-card snapshot."]
    };
    for (const [field, value] of [
      ["source_listing_id", listing.sourceListingId],
      ["canonical_observed_url", listing.canonicalObservedUrl],
      ["property_name", listing.propertyName],
      ["address", listing.address],
      ["rent", listing.rentUsd],
      ["bedrooms", listing.bedrooms],
      ["bathrooms", listing.bathrooms],
      ["square_footage", listing.squareFeet],
      ["availability", listing.availability],
      ["amenities", listing.amenities.length ? listing.amenities : null],
      ["fees", listing.fees.length ? listing.fees : null]
    ]) {
      if (value !== null)
        listing.sourceFieldProvenance.push({
          field,
          observedFrom: "result_card",
          sourceUrl: link.url,
          extractionMethod: "openclaw_semantic_snapshot",
          confidenceBasisPoints: 9_000,
          observedAt
        });
    }
    for (const [field, value] of [
      ["source_listing_id", listing.sourceListingId],
      ["property_name", listing.propertyName],
      ["address", listing.address],
      ["rent", listing.rentUsd],
      ["bedrooms", listing.bedrooms],
      ["bathrooms", listing.bathrooms],
      ["square_footage", listing.squareFeet],
      ["availability", listing.availability],
      ["amenities", listing.amenities.length ? listing.amenities : null],
      ["fees", listing.fees.length ? listing.fees : null]
    ]) {
      if (value === null) listing.missingFields.push(field);
    }
    if (listing.address === null || listing.rentUsd === null)
      listing.safeExtractionWarnings.push(
        "One or more core facts were not visible on the result card."
      );
    cards.push(listing);
    if (cards.length >= plan.maxResults) break;
  }
  return cards;
}
