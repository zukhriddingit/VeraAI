import type { ListingAddress } from "@vera/domain";

export type AddressNormalizationReasonCode =
  | "address_missing"
  | "address_normalized"
  | "unit_extracted"
  | "raw_address_fallback"
  | "conflicting_unit_evidence"
  | "ambiguous_postal_code";

export interface NormalizedUsAddress {
  readonly line1: string | null;
  readonly unit: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly matchKey: string | null;
  readonly reasonCodes: readonly AddressNormalizationReasonCode[];
  readonly ambiguous: boolean;
}

interface NormalizeUsAddressInput {
  readonly address: ListingAddress;
  readonly rawAddressPhrase?: string | null;
}

const tokenAliases: Readonly<Record<string, string>> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  highway: "hwy",
  parkway: "pkwy",
  place: "pl",
  terrace: "ter",
  trail: "trl",
  way: "way"
};

const regionAliases: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY"
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.,;:()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeStreet(value: string): string | null {
  const normalized = normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => tokenAliases[token] ?? token)
    .join(" ")
    .replace(/[^a-z0-9#'\-/ ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeComponent(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9'\-/ ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeUnit(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizeText(value)
    .replace(/^(?:apartment|apt|unit|suite|ste)\s*#?\s*/u, "")
    .replace(/^#\s*/u, "")
    .replace(/[^a-z0-9]/gu, "");
  return normalized.length === 0 ? null : normalized;
}

function extractTrailingUnit(value: string): { line1: string; unit: string | null } {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  const match =
    /(?:^|\s)(?:apartment|apt|unit|suite|ste)\.?\s*#?\s*([a-z0-9][a-z0-9-]*)\s*$/iu.exec(
      normalized
    );
  const hashMatch = match ?? /(?:^|\s)#\s*([a-z0-9][a-z0-9-]*)\s*$/iu.exec(normalized);
  if (!hashMatch || hashMatch.index === undefined) return { line1: value, unit: null };
  return {
    line1: normalized.slice(0, hashMatch.index).trim(),
    unit: normalizeUnit(hashMatch[1] ?? null)
  };
}

function normalizeRegion(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizeText(value);
  if (/^[a-z]{2}$/u.test(normalized)) return normalized.toUpperCase();
  return regionAliases[normalized] ?? normalized.toUpperCase();
}

function normalizePostalCode(value: string | null): {
  value: string | null;
  ambiguous: boolean;
} {
  if (value === null) return { value: null, ambiguous: false };
  const digits = value.normalize("NFKC").replace(/\D/gu, "");
  if (digits.length === 5) return { value: digits, ambiguous: false };
  if (digits.length === 9) {
    return { value: `${digits.slice(0, 5)}-${digits.slice(5)}`, ambiguous: false };
  }
  const preserved = normalizeComponent(value);
  return { value: preserved, ambiguous: preserved !== null };
}

export function normalizeUsAddress(input: NormalizeUsAddressInput): NormalizedUsAddress {
  const reasonCodes: AddressNormalizationReasonCode[] = [];
  const usedRawFallback = input.address.line1 === null && input.rawAddressPhrase != null;
  const originalLine = input.address.line1 ?? input.rawAddressPhrase ?? null;
  const extracted = originalLine === null ? null : extractTrailingUnit(originalLine);
  const extractedUnit = extracted?.unit ?? null;
  const structuredUnit = normalizeUnit(input.address.unit);
  const line1 = extracted === null ? null : normalizeStreet(extracted.line1);
  const unit = structuredUnit ?? extractedUnit;
  const city = normalizeComponent(input.address.city);
  const region = normalizeRegion(input.address.region);
  const postal = normalizePostalCode(input.address.postalCode);
  const countryCode =
    input.address.countryCode === null
      ? null
      : input.address.countryCode.normalize("NFKC").trim().toUpperCase();
  let ambiguous = postal.ambiguous || usedRawFallback;

  const hasAnyValue = [line1, unit, city, region, postal.value, countryCode].some(
    (value) => value !== null
  );
  if (!hasAnyValue) {
    return {
      line1: null,
      unit: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
      matchKey: null,
      reasonCodes: ["address_missing"],
      ambiguous: false
    };
  }

  reasonCodes.push("address_normalized");
  if (extractedUnit !== null) reasonCodes.push("unit_extracted");
  if (usedRawFallback) reasonCodes.push("raw_address_fallback");
  if (structuredUnit !== null && extractedUnit !== null && structuredUnit !== extractedUnit) {
    ambiguous = true;
    reasonCodes.push("conflicting_unit_evidence");
  }
  if (postal.ambiguous) reasonCodes.push("ambiguous_postal_code");

  const matchKey = [
    line1 ?? "__unknown_line__",
    unit ?? "__unknown_unit__",
    city ?? "__unknown_city__",
    region ?? "__unknown_region__",
    postal.value ?? "__unknown_postal__",
    countryCode ?? "__unknown_country__"
  ].join("|");

  return {
    line1,
    unit,
    city,
    region,
    postalCode: postal.value,
    countryCode,
    matchKey,
    reasonCodes,
    ambiguous
  };
}
