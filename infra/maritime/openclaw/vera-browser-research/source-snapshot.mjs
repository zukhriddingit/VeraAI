import { VeraBrowserResearchError, validateObservedUrl } from "./contract.mjs";

const FORBIDDEN_CONTROL =
  /\b(?:reply|contact|apply|request\s+(?:a\s+)?tour|tour|message|messenger|email|phone|payment|pay|upload|download|create\s+(?:an?\s+)?account|sign\s*in|log\s*in|seller\s+profile|favorites?|save\s+search|notify\s+me|create\s+(?:a\s+)?posting|edit\s+(?:a\s+)?posting|create\s+new\s+listing)\b/iu;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_NUMBER = /(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/u;
const BLOCKERS = [
  [
    "two_factor_required",
    /\b(?:duo\s+(?:mobile|security|push|authentication|verification|prompt|passcode)|(?:open|launch|check|approve|use)\s+(?:the\s+)?duo(?:\s+mobile)?|two[- ]factor|2fa|two[- ]step|verification code|security code|approve your login)\b/iu
  ],
  ["captcha_required", /\b(?:captcha|verify you are human|press and hold|human verification)\b/iu],
  ["checkpoint_required", /\b(?:checkpoint|confirm your identity|security check)\b/iu],
  [
    "consent_required",
    /\b(?:accept all cookies|cookie consent|privacy consent|consent preferences|manage consent)\b/iu
  ],
  [
    "blocked",
    /\b(?:access denied|temporarily blocked|unusual traffic|bot challenge|pardon the interruption|rate limit|too many requests)\b/iu
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

function parseLinks(snapshot, plan, refs, pageUrl) {
  const marker = "\n\nLinks:\n";
  const index = snapshot.indexOf(marker);
  if (index < 0) return [];
  const links = [];
  for (const line of snapshot.slice(index + marker.length).split(/\r?\n/u)) {
    const match = line.match(/^\d+\.\s+(.{1,500}?)\s+->\s+(\S+)$/u);
    if (!match) continue;
    try {
      let observed = new URL(match[2], pageUrl);
      if (
        plan.source === "facebook_marketplace" &&
        /^\/marketplace\/item\/[0-9]+\/?$/u.test(observed.pathname)
      ) {
        observed = new URL(`${observed.origin}${observed.pathname.replace(/\/?$/u, "/")}`);
      }
      const validated = validateObservedUrl(
        observed.href,
        plan.source,
        "detail",
        plan.sourceConfiguration
      );
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

export function validateCurrentSharedUrl(rawUrl, plan) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      ![plan.allowedHostnames[0], "www.zillow.com"].includes(url.hostname) ||
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

export function parseSourceSnapshot(payload, planInput) {
  const plan =
    typeof planInput === "string"
      ? { source: planInput, sourceConfiguration: undefined }
      : planInput;
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
  const page = validateObservedUrl(payload.url, plan.source, "either", plan.sourceConfiguration);
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
    links: parseLinks(payload.snapshot, plan, refs, page.url)
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
  if (plan.sourceConfiguration) {
    if (plan.source === "craigslist") {
      const url = new URL(plan.sourceConfiguration.startingUrl);
      url.searchParams.set("max_price", String(plan.profile.maximumRentUsd));
      url.searchParams.set("min_bedrooms", String(Math.ceil(plan.profile.minimumBedrooms)));
      if (plan.profile.minimumBathrooms !== undefined) {
        url.searchParams.set("min_bathrooms", String(Math.ceil(plan.profile.minimumBathrooms)));
      }
      if (plan.profile.rentalPropertyType !== undefined) {
        const housingType = {
          apartment: "1",
          condo: "2",
          house: "6",
          townhouse: "9"
        }[plan.profile.rentalPropertyType];
        url.searchParams.set("housing_type", housingType);
      }
      return validateObservedUrl(url.href, plan.source, "result", plan.sourceConfiguration).url;
    }
    return validateObservedUrl(
      plan.sourceConfiguration.startingUrl,
      plan.source,
      "result",
      plan.sourceConfiguration
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
      ? /\b(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:bd|beds?|bedrooms?)\b/iu
      : /\b(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:ba|baths?|bathrooms?)\b/iu;
  const match = text.match(pattern);
  const value = match ? Number(match[1]) : null;
  return Number.isFinite(value) && value >= 0 && value <= 20 ? value : null;
}

function squareFeet(text) {
  const match = text.match(
    /\b([1-9][\d,]{2,8})\s*(?:sq\.?\s*ft\.?|square feet|ft²)(?=\s|[,.;]|$)/iu
  );
  const value = match ? Number(match[1].replaceAll(",", "")) : null;
  return Number.isSafeInteger(value) && value <= 1_000_000 ? value : null;
}

function amenities(text) {
  const lower = text.toLowerCase();
  return [
    ...new Set(AMENITIES.filter(([needle]) => lower.includes(needle)).map(([, label]) => label))
  ].slice(0, 30);
}

function visibleFees(text) {
  const match = text.match(
    /\b(?:plus fees|application fee|admin fee|amenity fee|move-in fee|parking fee)[^,.;]{0,100}/giu
  );
  return [...new Set((match ?? []).map((value) => clean(value, 200)).filter(Boolean))].slice(0, 20);
}

function observedFee(text, kind, label, cadence = "one_time") {
  const match = text.match(new RegExp(`\\b${kind}[^$\\n]{0,80}\\$\\s*([0-9][\\d,]{0,8})`, "iu"));
  const amount = match ? Number(match[1].replaceAll(",", "")) : null;
  return match
    ? {
        label,
        amountUsd: Number.isSafeInteger(amount) && amount <= 1_000_000 ? amount : null,
        cadence,
        required: true
      }
    : null;
}

function observedRecurringFees(text) {
  return [
    observedFee(
      text,
      "(?:monthly |required )?(?:amenity|service|admin|utility) fee",
      "Required recurring fee",
      "month"
    ),
    observedFee(text, "pet rent", "Pet rent", "month"),
    observedFee(text, "parking", "Parking", "month")
  ].filter(Boolean);
}

function detailParagraphs(snapshot) {
  return snapshot
    .split(/\r?\n/u)
    .map((line) =>
      clean(line.replace(/^\s*-\s*(?:paragraph|generic|blockquote):?\s*/iu, ""), 2_000)
    )
    .filter(
      (line) =>
        line.length >= 40 &&
        !FORBIDDEN_CONTROL.test(line) &&
        !EMAIL_ADDRESS.test(line) &&
        !PHONE_NUMBER.test(line) &&
        !/^Links:/u.test(line) &&
        !/^(?:https?:\/\/|\$[\d,]+(?:\/mo)?$)/u.test(line)
    );
}

function description(snapshot) {
  const paragraphs = detailParagraphs(snapshot).filter(
    (line) => !/^\d{1,6}\s+.+,\s*.+,\s*[A-Z]{2}\s+\d{5}$/u.test(line)
  );
  const value = [...new Set(paragraphs)].join("\n\n").slice(0, 20_000).trim();
  return value || null;
}

function photoHostAllowed(source, hostname, sourceConfiguration) {
  if (source === "zillow") return hostname === "photos.zillowstatic.com";
  if (source === "apartments_com") {
    return hostname === "images1.apartments.com" || hostname.endsWith(".apartments.com");
  }
  if (source === "facebook_marketplace") {
    return hostname === "scontent.xx.fbcdn.net" || hostname.endsWith(".fbcdn.net");
  }
  if (source === "craigslist") return hostname === "images.craigslist.org";
  return sourceConfiguration?.allowedDomain === hostname;
}

function observedPhotos(snapshot, source, sourceConfiguration) {
  const matches = snapshot.match(/https:\/\/[^\s"'<>]+/gu) ?? [];
  const photos = [];
  for (const raw of matches) {
    try {
      const url = new URL(raw.replace(/[),.;]+$/u, ""));
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        [...url.searchParams.keys()].some((key) =>
          /^(?:password|token|access_token|refresh_token|authorization|secret|cookie|session|sessionid)$/iu.test(
            key
          )
        ) ||
        !photoHostAllowed(source, url.hostname, sourceConfiguration)
      ) {
        continue;
      }
      if (!photos.some((photo) => photo.url === url.href)) {
        photos.push({ url: url.href, width: null, height: null });
      }
    } catch {
      // Invalid or unrelated URLs are never retained as listing media.
    }
    if (photos.length >= 30) break;
  }
  return photos;
}

function lease(text) {
  const match = text.match(/\b((\d{1,2})\s*(?:-?month|month)\s+lease|month-to-month)\b/iu);
  return {
    text: clean(match?.[1] ?? "", 300) || null,
    months: match?.[2] ? Number(match[2]) : null
  };
}

function dateOnly(text) {
  const match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/u);
  return match?.[0] ?? null;
}

function sourceUpdateTime(text, observedAt) {
  const explicit = text.match(
    /\b(?:last\s+updated|last\s+seen|listed|posted|updated)(?:\s+(?:on|at))?\s*:?\s*(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))/iu
  );
  if (explicit?.[1]) {
    const value = new Date(explicit[1]);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (/\b(?:last\s+updated|listed|posted|updated|time\s*:)\s+today\b/iu.test(text)) {
    return observedAt;
  }
  const relative = text.match(
    /\b(?:(?:last\s+updated|last\s+seen|listed|posted|updated|time\s*:?)\s+)?(\d{1,3})\s*(minutes?|hours?|days?|weeks?)\s+ago\b/iu
  );
  if (!relative?.[1] || !relative[2]) return null;
  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const multiplier = unit.startsWith("minute")
    ? 60_000
    : unit.startsWith("hour")
      ? 3_600_000
      : unit.startsWith("day")
        ? 86_400_000
        : 604_800_000;
  const observed = new Date(observedAt);
  if (!Number.isSafeInteger(amount) || Number.isNaN(observed.getTime())) return null;
  return new Date(observed.getTime() - amount * multiplier).toISOString();
}

function propertyTypeFromText(text) {
  const lower = text.toLowerCase();
  if (/\btownhouse|townhome\b/u.test(lower)) return "townhouse";
  if (/\bcondo(?:minium)?\b/u.test(lower)) return "condo";
  if (/\bsingle[- ]family|\bhouse\b/u.test(lower)) return "house";
  if (/\broom for rent|private room\b/u.test(lower)) return "room";
  if (/\bapartment|\bflat\b/u.test(lower)) return "apartment";
  return null;
}

function petPolicy(text) {
  const match = text.match(
    /\b(?:pets? (?:allowed|welcome|considered)|cats? (?:allowed|welcome)|dogs? (?:allowed|welcome)|no pets?)\b[^.;\n]{0,160}/iu
  );
  return clean((match?.[0] ?? "").split(/\s+-\s+(?:button|link)\b/iu, 1)[0], 500) || null;
}

function parking(text) {
  const match = text.match(
    /\b(?:garage|street|off-street|covered|assigned) parking\b[^.;\n]{0,160}/iu
  );
  return clean(match?.[0] ?? "", 500) || null;
}

function utilities(text) {
  const lower = text.toLowerCase();
  const values = [
    ["heat", "Heat"],
    ["hot water", "Hot water"],
    ["water", "Water"],
    ["electricity", "Electricity"],
    ["gas", "Gas"],
    ["internet", "Internet"],
    ["trash", "Trash"]
  ];
  return values
    .filter(([needle]) =>
      new RegExp(`(?:${needle}[^.]{0,40}included|utilities included[^.]{0,80}${needle})`, "u").test(
        lower
      )
    )
    .map(([, label]) => label);
}

function laundry(text) {
  const lower = text.toLowerCase();
  if (/in[- ]unit (?:washer|laundry)|washer(?: and|\/)dryer in unit/u.test(lower)) return "in_unit";
  if (/laundry (?:in|on)[ -]?(?:building|site)|shared laundry/u.test(lower)) return "in_building";
  if (/washer(?: and|\/)dryer hookups?|laundry hookups?/u.test(lower)) return "hookups";
  if (/no laundry/u.test(lower)) return "none";
  return "unknown";
}

function furnished(text) {
  if (/\bpartially furnished\b/iu.test(text)) return "partially_furnished";
  if (/\bunfurnished\b/iu.test(text)) return "unfurnished";
  if (/\bfurnished\b/iu.test(text)) return "furnished";
  return "unknown";
}

function propertyManager(text) {
  const match = text.match(
    /\b(?:property manager|managed by|listing provided by)\s*[:\-]?\s*([^\n.;]{2,200})/iu
  );
  const candidate = clean(match?.[1] ?? "", 300);
  return candidate && !EMAIL_ADDRESS.test(candidate) && !PHONE_NUMBER.test(candidate)
    ? candidate
    : null;
}

function allowedContactChannel(text, source) {
  if (source === "facebook_marketplace" && /\bMessage seller\b/iu.test(text)) {
    return "platform_message";
  }
  if (/\bEmail\b/iu.test(text)) return "email";
  if (/\bPhone|Call\b/iu.test(text)) return "phone";
  if (/\bContact form|Request information\b/iu.test(text)) return "website_form";
  return "unknown";
}

function address(text, source) {
  if (source === "facebook_marketplace") {
    return (
      clean(text.match(/(?:^|,\s)([A-Za-z .'-]{2,80},\s*[A-Z]{2})(?:,|$)/u)?.[1] ?? "", 300) || null
    );
  }
  if (source === "craigslist") {
    const full = clean(
      text.match(
        /\b(\d{1,6}(?:-\d{1,6})?\s+[^,]{2,120},\s*[^,]{2,60},\s*[A-Z]{2}(?:\s+\d{5})?)\b/u
      )?.[1] ?? "",
      300
    );
    if (full) return full;
    return clean(text.match(/\(([A-Za-z0-9 .'-]{2,80})\)/u)?.[1] ?? "", 300) || null;
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
  if (source === "facebook_marketplace") return url.match(/\/item\/([0-9]+)\//u)?.[1] ?? null;
  if (source === "zillow") {
    return (
      url.match(/\/([0-9]+)_zpid\/?/u)?.[1] ?? url.match(/\/([A-Za-z0-9]{5,16})\/$/u)?.[1] ?? null
    );
  }
  if (source === "craigslist") {
    return url.match(/\/view\/d\/[a-z0-9-]+\/([A-Za-z0-9]+)(?:\?|$)/u)?.[1] ?? null;
  }
  if (source === "bu_off_campus" || source === "custom_website") {
    return url.match(/\/([a-zA-Z0-9_-]{4,80})\/?(?:\?|$)/u)?.[1] ?? null;
  }
  return url.match(/\/([a-z0-9]{7})\/$/u)?.[1] ?? null;
}

export function extractSourceCardCandidates(document, plan, observedAt) {
  const seen = new Set();
  const cards = [];
  for (const link of document.links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const evidence = `${link.name} ${windowFor(document.snapshot, link.name)}`;
    if (
      ["bu_off_campus", "custom_website", "craigslist"].includes(plan.source) &&
      money(evidence) === null &&
      room(evidence, "bedrooms") === null &&
      room(evidence, "bathrooms") === null
    ) {
      continue;
    }
    const observedLease = lease(evidence);
    const listing = {
      source: plan.source,
      sourceConfiguration: plan.sourceConfiguration ?? null,
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
      fees: visibleFees(evidence),
      observedAt,
      sourceFieldProvenance: [],
      missingFields: [],
      safeExtractionWarnings: [],
      researchNotes: ["Observed in a bounded read-only result-card snapshot."],
      photos: observedPhotos(evidence, plan.source, plan.sourceConfiguration),
      description: null,
      recurringFees: [],
      estimatedTotalMonthlyCostUsd: null,
      depositUsd: null,
      applicationFeeUsd: null,
      brokerFeeUsd: null,
      availableDate: null,
      leaseDuration: observedLease.text,
      leaseTermMonths: observedLease.months,
      propertyType: propertyTypeFromText(evidence),
      petPolicyText: petPolicy(evidence),
      petFees: [],
      parkingText: parking(evidence),
      parkingMonthlyUsd: null,
      utilitiesIncluded: utilities(evidence),
      laundry: laundry(evidence),
      furnishedStatus: furnished(evidence),
      propertyManagerName: null,
      allowedContactChannel: "unknown",
      sourceUpdatedAt: sourceUpdateTime(evidence, observedAt)
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
      ["lease_duration", listing.leaseDuration],
      ["amenities", listing.amenities.length ? listing.amenities : null],
      ["fees", listing.fees.length ? listing.fees : null],
      ["photos", listing.photos.length ? listing.photos : null],
      ["source_updated_at", listing.sourceUpdatedAt]
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
      ["fees", listing.fees.length ? listing.fees : null],
      ["photos", listing.photos.length ? listing.photos : null]
    ]) {
      if (value === null) listing.missingFields.push(field);
    }
    if (listing.address === null || listing.rentUsd === null)
      listing.safeExtractionWarnings.push(
        "One or more core facts were not visible on the result card."
      );
    cards.push({
      listing,
      resultRef: link.ref,
      observedLinkName: link.name
    });
    if (cards.length >= plan.maxResults) break;
  }
  return cards;
}

export function extractSourceCards(document, plan, observedAt) {
  return extractSourceCardCandidates(document, plan, observedAt).map(
    (candidate) => candidate.listing
  );
}

export function enrichSourceListingFromDetail(listing, document, observedAt) {
  if (document.page.kind !== "detail") {
    throw new VeraBrowserResearchError("source_surface_not_allowed");
  }
  const evidence = clean(document.snapshot.split("\n\nLinks:\n", 1)[0], 50_000);
  const observed = {
    address: address(evidence, listing.source),
    rent: money(evidence),
    bedrooms: room(evidence, "bedrooms"),
    bathrooms: room(evidence, "bathrooms"),
    square_footage: squareFeet(evidence),
    availability:
      clean(
        evidence.match(
          /\b(?:available now|available (?:on )?[A-Za-z]{3,9}\s+\d{1,2}(?:,\s+\d{4})?)\b/iu
        )?.[0] ?? "",
        300
      ) || null,
    amenities: amenities(evidence),
    fees: visibleFees(evidence),
    photos: observedPhotos(document.snapshot, listing.source, listing.sourceConfiguration),
    description: description(document.snapshot),
    recurringFees: observedRecurringFees(evidence),
    deposit: observedFee(evidence, "(?:security )?deposit", "Security deposit"),
    applicationFee: observedFee(evidence, "application fee", "Application fee"),
    brokerFee: observedFee(evidence, "broker(?:'s)? fee", "Broker fee"),
    lease: lease(evidence),
    availableDate: dateOnly(evidence),
    propertyType: propertyTypeFromText(evidence),
    petPolicy: petPolicy(evidence),
    parking: parking(evidence),
    utilities: utilities(evidence),
    laundry: laundry(evidence),
    furnishedStatus: furnished(evidence),
    propertyManagerName: propertyManager(evidence),
    allowedContactChannel: allowedContactChannel(document.snapshot, listing.source),
    sourceUpdatedAt: sourceUpdateTime(evidence, observedAt)
  };
  const detailValues = new Map([
    ["address", observed.address],
    ["rent", observed.rent],
    ["bedrooms", observed.bedrooms],
    ["bathrooms", observed.bathrooms],
    ["square_footage", observed.square_footage],
    ["availability", observed.availability],
    ["amenities", observed.amenities.length ? observed.amenities : null],
    ["fees", observed.fees.length ? observed.fees : null],
    ["photos", observed.photos.length ? observed.photos : null],
    ["description", observed.description],
    ["deposit", observed.deposit],
    ["application_fee", observed.applicationFee],
    ["broker_fee", observed.brokerFee],
    ["lease_duration", observed.lease.text],
    ["property_type", observed.propertyType],
    ["pet_policy", observed.petPolicy],
    [
      "pet_fees",
      observed.recurringFees.some((fee) => /^Pet\b/iu.test(fee.label))
        ? observed.recurringFees.filter((fee) => /^Pet\b/iu.test(fee.label))
        : null
    ],
    ["parking", observed.parking],
    ["utilities", observed.utilities.length ? observed.utilities : null],
    ["laundry", observed.laundry === "unknown" ? null : observed.laundry],
    ["furnished_status", observed.furnishedStatus === "unknown" ? null : observed.furnishedStatus],
    ["property_manager", observed.propertyManagerName],
    [
      "contact_channel",
      observed.allowedContactChannel === "unknown" ? null : observed.allowedContactChannel
    ],
    ["source_updated_at", observed.sourceUpdatedAt]
  ]);
  const provenance = listing.sourceFieldProvenance.filter(
    (entry) => !detailValues.has(entry.field) || detailValues.get(entry.field) === null
  );
  provenance.push({
    field: "final_detail_page_url",
    observedFrom: "detail_page",
    sourceUrl: document.page.url,
    extractionMethod: "openclaw_semantic_snapshot",
    confidenceBasisPoints: 10_000,
    observedAt
  });
  for (const [field, value] of detailValues) {
    if (value === null) continue;
    provenance.push({
      field,
      observedFrom: "detail_page",
      sourceUrl: document.page.url,
      extractionMethod: "openclaw_semantic_snapshot",
      confidenceBasisPoints: 9_500,
      observedAt
    });
  }
  const enriched = {
    ...listing,
    finalDetailPageUrl: document.page.url,
    address: observed.address ?? listing.address,
    rentUsd: observed.rent ?? listing.rentUsd,
    bedrooms: observed.bedrooms ?? listing.bedrooms,
    bathrooms: observed.bathrooms ?? listing.bathrooms,
    squareFeet: observed.square_footage ?? listing.squareFeet,
    availability: observed.availability ?? listing.availability,
    amenities: observed.amenities.length > 0 ? observed.amenities : listing.amenities,
    fees: observed.fees.length > 0 ? observed.fees : listing.fees,
    photos: observed.photos.length > 0 ? observed.photos : listing.photos,
    description: observed.description ?? listing.description,
    recurringFees:
      observed.recurringFees.length > 0 ? observed.recurringFees : listing.recurringFees,
    estimatedTotalMonthlyCostUsd:
      (observed.rent ?? listing.rentUsd) !== null &&
      observed.recurringFees.length > 0 &&
      observed.recurringFees.every((fee) => fee.amountUsd !== null)
        ? (observed.rent ?? listing.rentUsd) +
          observed.recurringFees.reduce((total, fee) => total + fee.amountUsd, 0)
        : listing.estimatedTotalMonthlyCostUsd,
    depositUsd: observed.deposit?.amountUsd ?? listing.depositUsd,
    applicationFeeUsd: observed.applicationFee?.amountUsd ?? listing.applicationFeeUsd,
    brokerFeeUsd: observed.brokerFee?.amountUsd ?? listing.brokerFeeUsd,
    availableDate: observed.availableDate ?? listing.availableDate,
    leaseDuration: observed.lease.text ?? listing.leaseDuration,
    leaseTermMonths: observed.lease.months ?? listing.leaseTermMonths,
    propertyType: observed.propertyType ?? listing.propertyType,
    petPolicyText: observed.petPolicy ?? listing.petPolicyText,
    petFees: observed.recurringFees.filter((fee) => /^Pet\b/iu.test(fee.label)),
    parkingText: observed.parking ?? listing.parkingText,
    parkingMonthlyUsd:
      observed.recurringFees.find((fee) => /^Parking\b/iu.test(fee.label))?.amountUsd ??
      listing.parkingMonthlyUsd,
    utilitiesIncluded:
      observed.utilities.length > 0 ? observed.utilities : listing.utilitiesIncluded,
    laundry: observed.laundry !== "unknown" ? observed.laundry : listing.laundry,
    furnishedStatus:
      observed.furnishedStatus !== "unknown" ? observed.furnishedStatus : listing.furnishedStatus,
    propertyManagerName: observed.propertyManagerName ?? listing.propertyManagerName,
    allowedContactChannel:
      observed.allowedContactChannel !== "unknown"
        ? observed.allowedContactChannel
        : listing.allowedContactChannel,
    sourceUpdatedAt: observed.sourceUpdatedAt ?? listing.sourceUpdatedAt,
    sourceFieldProvenance: provenance,
    missingFields: [],
    safeExtractionWarnings: [],
    researchNotes: [
      ...listing.researchNotes,
      "Opened one bounded same-tab listing detail page and retained observed rental facts only."
    ]
  };
  for (const [field, value] of [
    ["source_listing_id", enriched.sourceListingId],
    ["property_name", enriched.propertyName],
    ["address", enriched.address],
    ["rent", enriched.rentUsd],
    ["bedrooms", enriched.bedrooms],
    ["bathrooms", enriched.bathrooms],
    ["square_footage", enriched.squareFeet],
    ["availability", enriched.availability],
    ["amenities", enriched.amenities.length ? enriched.amenities : null],
    ["fees", enriched.fees.length ? enriched.fees : null]
  ]) {
    if (value === null) enriched.missingFields.push(field);
  }
  if (enriched.address === null || enriched.rentUsd === null) {
    enriched.safeExtractionWarnings.push(
      "One or more core facts were not visible on the result card or bounded detail page."
    );
  }
  return enriched;
}

export function extractSourceDetailListing(
  source,
  targetUrl,
  document,
  observedAt,
  sourceConfiguration = null
) {
  const heading = clean(
    document.snapshot.match(/- heading(?: \[[^\]]+\])?\s+"([^"]+)"/u)?.[1] ?? "",
    300
  );
  return enrichSourceListingFromDetail(
    {
      source,
      sourceConfiguration,
      sourceListingId: sourceId(targetUrl, source),
      canonicalObservedUrl: targetUrl,
      finalDetailPageUrl: null,
      propertyName: heading || null,
      address: null,
      rentUsd: null,
      bedrooms: null,
      bathrooms: null,
      squareFeet: null,
      availability: null,
      amenities: [],
      fees: [],
      observedAt,
      sourceFieldProvenance: [],
      missingFields: [],
      safeExtractionWarnings: [],
      researchNotes: ["Opened one exact policy-validated listing URL for read-only enrichment."],
      photos: [],
      description: null,
      recurringFees: [],
      estimatedTotalMonthlyCostUsd: null,
      depositUsd: null,
      applicationFeeUsd: null,
      brokerFeeUsd: null,
      availableDate: null,
      leaseDuration: null,
      leaseTermMonths: null,
      propertyType: null,
      petPolicyText: null,
      petFees: [],
      parkingText: null,
      parkingMonthlyUsd: null,
      utilitiesIncluded: [],
      laundry: "unknown",
      furnishedStatus: "unknown",
      propertyManagerName: null,
      allowedContactChannel: "unknown",
      sourceUpdatedAt: null
    },
    document,
    observedAt
  );
}
