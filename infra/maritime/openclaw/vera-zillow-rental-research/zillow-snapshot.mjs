import { VeraZillowResearchError } from "./contract.mjs";

const RESULT_PATH_PATTERNS = [
  /^\/homes\/for_rent\/?$/u,
  /^\/[a-z0-9-]+\/rentals\/?$/u,
  /^\/[a-z0-9-]+\/homes\/for_rent\/?$/u
];
const DETAIL_PATH_PATTERNS = [
  /^\/homedetails\/(?:[^/?#]+\/)*[1-9][0-9]*_zpid\/?$/u,
  /^\/apartments\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9]+\/?$/u
];
const SENSITIVE_QUERY_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "secret",
  "cookie",
  "session",
  "sessionid"
]);
const FORBIDDEN_CONTROL =
  /\b(?:contact|apply|tour|message|email|phone|payment|upload|download|sign\s*in|log\s*in|create account)\b/iu;
const BLOCKERS = [
  {
    pageState: "two_factor_required",
    manualAction: "two_factor_required",
    pattern: /\b(?:two[- ]factor|2fa|two[- ]step|verification code|security code)\b/iu
  },
  {
    pageState: "captcha_required",
    manualAction: "captcha_required",
    pattern: /\b(?:captcha|verify you are human|press and hold|human verification)\b/iu
  },
  {
    pageState: "consent_required",
    manualAction: "consent_required",
    pattern:
      /\b(?:accept all cookies|cookie consent|privacy consent|consent preferences|manage consent)\b/iu
  },
  {
    pageState: "blocked",
    manualAction: "blocked",
    pattern:
      /\b(?:access denied|temporarily blocked|unusual traffic|bot challenge|security check|pardon the interruption)\b/iu
  },
  {
    pageState: "login_required",
    manualAction: "login_required",
    pattern:
      /\b(?:sign in to (?:continue|zillow)|enter your (?:email|password)|forgot password|log in to continue)\b/iu
  }
];
const AMENITIES = [
  ["in-unit laundry", "In-unit laundry"],
  ["laundry in unit", "In-unit laundry"],
  ["dishwasher", "Dishwasher"],
  ["air conditioning", "Air conditioning"],
  ["central air", "Central air"],
  ["pet friendly", "Pet friendly"],
  ["parking", "Parking"],
  ["garage", "Garage"],
  ["balcony", "Balcony"],
  ["elevator", "Elevator"],
  ["gym", "Gym"],
  ["doorman", "Doorman"]
];

function cleanObservedText(value, maximum = 500) {
  return String(value ?? "")
    .replaceAll("\u0000", "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

export function validateZillowUrl(rawUrl, expectedKind = "either") {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VeraZillowResearchError("unsafe_zillow_url");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.zillow.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new VeraZillowResearchError("unsafe_zillow_url");
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      throw new VeraZillowResearchError("unsafe_zillow_url");
    }
  }
  const isResult = RESULT_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname));
  const isDetail = DETAIL_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname));
  if (
    (expectedKind === "result" && !isResult) ||
    (expectedKind === "detail" && !isDetail) ||
    (expectedKind === "either" && !isResult && !isDetail)
  ) {
    throw new VeraZillowResearchError("zillow_surface_not_allowed");
  }
  return { kind: isResult ? "result" : "detail", url: url.href };
}

export function detectManualBlocker(snapshot) {
  const text = cleanObservedText(snapshot, 65_536);
  const blocker = BLOCKERS.find((candidate) => candidate.pattern.test(text));
  return blocker ?? null;
}

function parseRefs(payload) {
  if (typeof payload.refs !== "object" || payload.refs === null || Array.isArray(payload.refs)) {
    return [];
  }
  const refs = [];
  for (const [ref, candidate] of Object.entries(payload.refs)) {
    if (
      !/^(?:e\d+|\d{1,9})$/iu.test(ref) ||
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const role = cleanObservedText(candidate.role, 40).toLowerCase();
    const name = cleanObservedText(candidate.name, 300);
    if (!role || !name) continue;
    refs.push(Object.freeze({ ref, role, name }));
  }
  return refs;
}

function parseLinks(snapshot) {
  const marker = "\n\nLinks:\n";
  const markerIndex = snapshot.indexOf(marker);
  if (markerIndex === -1) return [];
  const links = [];
  for (const line of snapshot.slice(markerIndex + marker.length).split(/\r?\n/u)) {
    const match = line.match(/^\d+\.\s+(.{1,500}?)\s+->\s+(https:\/\/\S+)$/u);
    if (!match) continue;
    try {
      const validated = validateZillowUrl(match[2], "detail");
      links.push({
        name: cleanObservedText(match[1], 300),
        url: validated.url
      });
    } catch {
      // Off-surface links are ignored and can never become navigation candidates.
    }
  }
  return links;
}

export function parseZillowSnapshot(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.ok !== true ||
    payload.format !== "ai" ||
    typeof payload.targetId !== "string" ||
    typeof payload.url !== "string" ||
    typeof payload.snapshot !== "string" ||
    payload.snapshot.length > 512 * 1024
  ) {
    throw new VeraZillowResearchError("invalid_snapshot_response");
  }
  const page = validateZillowUrl(payload.url, "either");
  const blocker = detectManualBlocker(payload.snapshot);
  if (blocker) {
    throw new VeraZillowResearchError(blocker.manualAction, blocker);
  }
  const refs = parseRefs(payload);
  const links = parseLinks(payload.snapshot);
  for (const link of links) {
    const matchedRef = refs.find(
      (candidate) => candidate.role === "link" && candidate.name === link.name
    );
    if (matchedRef) link.ref = matchedRef.ref;
  }
  return Object.freeze({
    targetId: payload.targetId,
    page,
    snapshot: payload.snapshot,
    refs: Object.freeze(refs),
    links: Object.freeze(links)
  });
}

export function findReviewedControl(document, input) {
  const roles = new Set(input.roles);
  const candidate = document.refs.find(
    (entry) =>
      roles.has(entry.role) &&
      input.names.some((pattern) => pattern.test(entry.name)) &&
      !FORBIDDEN_CONTROL.test(entry.name)
  );
  return candidate ?? null;
}

function semanticLine(line) {
  const body = line.trim().replace(/^-\s+/u, "");
  const quoted = body.match(/^([a-z]+)\s+"([^"]{1,300})"/u);
  const labeled = body.match(/^(text|generic|paragraph):\s*(.{1,300})$/u);
  const role = quoted?.[1] ?? labeled?.[1] ?? "";
  const name = cleanObservedText(quoted?.[2] ?? labeled?.[2] ?? "", 300);
  const ref = line.match(/\[ref=((?:e\d+|\d{1,9}))\]/iu)?.[1] ?? null;
  return { name, ref, role };
}

function uniqueMarkerBoundary(lines, patterns, after = -1, side = "start") {
  const semanticLines = lines.map((line, index) => ({ index, ...semanticLine(line) }));
  const matches = semanticLines.filter(
    ({ index, name }) => index > after && patterns.some((pattern) => pattern.test(name))
  );
  if (matches.length === 2) {
    const [parent, child] = matches;
    if (
      child.index === parent.index + 1 &&
      parent.role === "group" &&
      child.role === "text" &&
      parent.name === child.name
    ) {
      return side === "start" ? child.index : parent.index;
    }
    return -1;
  }
  if (matches.length !== 1) return -1;

  const [match] = matches;
  const previous = semanticLines[match.index - 1];
  const next = semanticLines[match.index + 1];
  if (match.role === "group" && next?.role === "text") return -1;
  if (match.role === "text" && previous?.role === "group") return -1;
  return match.index;
}

export function findReviewedControlInSection(document, input) {
  const lines = document.snapshot.split(/\r?\n/u);
  const start = uniqueMarkerBoundary(lines, input.startNames);
  const end = uniqueMarkerBoundary(lines, input.endNames, start, "end");
  if (start < 0 || end <= start) return null;
  const allowedRefs = new Set(
    lines
      .slice(start + 1, end)
      .map((line) => semanticLine(line).ref)
      .filter((ref) => ref !== null)
  );
  const roles = new Set(input.roles);
  const candidates = document.refs.filter(
    (entry) =>
      allowedRefs.has(entry.ref) &&
      roles.has(entry.role) &&
      input.names.some((pattern) => pattern.test(entry.name)) &&
      !FORBIDDEN_CONTROL.test(entry.name)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function extractAmount(text) {
  const match = text.match(/\$\s*([1-9][\d,]{2,8})(?:\s*\+)?(?:\s*\/\s*mo(?:nth)?)?/iu);
  if (!match) return null;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(amount) && amount <= 1_000_000 ? amount : null;
}

function extractRoomCount(text, kind) {
  const pattern =
    kind === "bedrooms"
      ? /\b(\d+(?:\.\d+)?)\s*(?:bd|beds?|bedrooms?)\b/iu
      : /\b(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/iu;
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 20 ? value : null;
}

function extractSquareFeet(text) {
  const match = text.match(/\b([1-9][\d,]{2,8})\s*(?:sq\.?\s*ft\.?|square feet)\b/iu);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(value) && value <= 1_000_000 ? value : null;
}

function extractAvailability(text) {
  const match = text.match(
    /\b(?:available now|available (?:on )?[A-Za-z]{3,9}\s+\d{1,2}(?:,\s+\d{4})?|move[- ]in (?:on )?[A-Za-z0-9, /-]{3,40})\b/iu
  );
  return match ? cleanObservedText(match[0], 200) : null;
}

function extractAmenities(text) {
  const lower = text.toLowerCase();
  return [
    ...new Set(AMENITIES.filter(([needle]) => lower.includes(needle)).map(([, label]) => label))
  ].slice(0, 30);
}

function extractAddress(preferred, text) {
  const label = cleanObservedText(preferred.replace(/\s+\|\s+Zillow.*$/iu, ""), 300);
  if (/^\d{1,6}\s+\S.{2,280}$/u.test(label)) return label;
  const embedded = label.match(
    /(?:^|[|,]\s*)(\d{1,6}\s+[^,|]{2,120},\s*[^,|]{2,60},\s*[A-Z]{2}(?:\s+\d{5})?)(?:$|[|])/u
  );
  if (embedded) return cleanObservedText(embedded[1], 300);
  const quoted = text.match(
    /["'](\d{1,6}\s+[^"'\n]{2,180}(?:,\s*[A-Za-z .'-]{2,60}){1,2}(?:\s+\d{5})?)["']/u
  );
  return quoted ? cleanObservedText(quoted[1], 300) : null;
}

function snapshotWindow(snapshot, linkName) {
  const main = snapshot.split("\n\nLinks:\n", 1)[0] ?? snapshot;
  const lines = main.split(/\r?\n/u);
  const normalizedName = cleanObservedText(linkName, 300);
  const index = lines.findIndex((line) => cleanObservedText(line, 1_000).includes(normalizedName));
  if (index === -1) return normalizedName;
  return lines
    .slice(Math.max(0, index - 10), Math.min(lines.length, index + 11))
    .join(" ")
    .slice(0, 8_000);
}

function snapshotWindowByReference(snapshot, reference) {
  const main = snapshot.split("\n\nLinks:\n", 1)[0] ?? snapshot;
  const lines = main.split(/\r?\n/u);
  const marker = `[ref=${reference}]`;
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) return "";
  return lines
    .slice(Math.max(0, index - 10), Math.min(lines.length, index + 21))
    .join(" ")
    .slice(0, 8_000);
}

function sourceListingId(url) {
  return url.match(/\/([1-9][0-9]*)_zpid\/?(?:\?|$)/u)?.[1] ?? null;
}

export function extractResultCards(document, maximum) {
  const seen = new Set();
  const cards = [];
  for (const link of document.links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const text = snapshotWindow(document.snapshot, link.name);
    cards.push({
      sourceListingId: sourceListingId(link.url),
      canonicalObservedUrl: link.url,
      finalDetailPageUrl: null,
      address: extractAddress(link.name, text),
      rentUsd: extractAmount(text),
      bedrooms: extractRoomCount(text, "bedrooms"),
      bathrooms: extractRoomCount(text, "bathrooms"),
      squareFeet: extractSquareFeet(text),
      availability: extractAvailability(text),
      amenities: extractAmenities(text),
      resultRef: link.ref ?? null
    });
    if (cards.length >= maximum) break;
  }
  if (cards.length > 0) return cards;

  for (const reference of document.refs) {
    if (reference.role !== "link" || FORBIDDEN_CONTROL.test(reference.name)) continue;
    const text = snapshotWindowByReference(document.snapshot, reference.ref);
    if (!text) continue;
    const address = extractAddress(reference.name, text);
    const rentUsd = extractAmount(text);
    const bedrooms = extractRoomCount(text, "bedrooms");
    const bathrooms = extractRoomCount(text, "bathrooms");
    if (address === null || rentUsd === null || bedrooms === null || bathrooms === null) continue;
    const key = `${address}\u0000${String(rentUsd)}\u0000${String(bedrooms)}\u0000${String(bathrooms)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      sourceListingId: null,
      canonicalObservedUrl: null,
      finalDetailPageUrl: null,
      address,
      rentUsd,
      bedrooms,
      bathrooms,
      squareFeet: extractSquareFeet(text),
      availability: extractAvailability(text),
      amenities: extractAmenities(text),
      resultRef: reference.ref,
      observedLinkName: reference.name
    });
    if (cards.length >= maximum) break;
  }
  return cards;
}

export function extractDetailEvidence(document) {
  const text = document.snapshot.split("\n\nLinks:\n", 1)[0] ?? document.snapshot;
  const heading =
    document.refs.find(
      (entry) => /^heading$/u.test(entry.role) && /^\d{1,6}\s+\S.{2,280}$/u.test(entry.name)
    )?.name ?? "";
  return {
    finalDetailPageUrl: document.page.url,
    address: extractAddress(heading, text),
    rentUsd: extractAmount(text),
    bedrooms: extractRoomCount(text, "bedrooms"),
    bathrooms: extractRoomCount(text, "bathrooms"),
    squareFeet: extractSquareFeet(text),
    availability: extractAvailability(text),
    amenities: extractAmenities(text)
  };
}

export function assertSafeControl(control) {
  if (
    !control ||
    !/^(?:e\d+|\d{1,9})$/iu.test(control.ref) ||
    FORBIDDEN_CONTROL.test(control.name)
  ) {
    throw new VeraZillowResearchError("forbidden_or_unobserved_control");
  }
  return control;
}
