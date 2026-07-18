import {
  ListingExtractionFieldNameSchema,
  ListingExtractionSchema,
  type ContactChannel,
  type ExtractedField,
  type ExtractionUnknownReason,
  type FieldExtractionMethod,
  type ListingExtraction,
  type ListingExtractionFieldName,
  type MoneyObservation,
  type PropertyType,
  type RequiredRecurringFee
} from "@vera/domain";

import {
  RawListingEnvelopeSchema,
  StructuredListingInputSchema,
  type RawListingEnvelope,
  type StructuredListingInput
} from "./contracts.ts";
import { validateAndClassifyProvenanceUrl } from "./url-policy.ts";

const MAX_EVIDENCE_LENGTH = 1_000;
const TEXT_SCAN_LIMIT = 250_000;

type DeterministicMethod = Exclude<FieldExtractionMethod, "ai">;

export interface DeterministicListingExtraction {
  readonly extraction: ListingExtraction;
  readonly extractionMethods: Readonly<Record<ListingExtractionFieldName, DeterministicMethod>>;
}

function boundedSnippet(value: string): string {
  return value.trim().slice(0, MAX_EVIDENCE_LENGTH);
}

function known<T>(
  value: T,
  evidenceSnippet: string,
  confidenceBasisPoints = 9_500
): ExtractedField<T> {
  return {
    status: "known",
    value,
    confidenceBasisPoints,
    evidenceSnippet: boundedSnippet(evidenceSnippet)
  };
}

function unknown<T>(reason: ExtractionUnknownReason = "not_present"): ExtractedField<T> {
  return {
    status: "unknown",
    value: null,
    confidenceBasisPoints: 0,
    evidenceSnippet: null,
    reason
  };
}

function allMatches(text: string, expression: RegExp): RegExpExecArray[] {
  return [...text.matchAll(expression)];
}

function chooseUnique<T>(
  candidates: readonly { readonly value: T; readonly evidence: string }[],
  options: {
    readonly missingReason?: ExtractionUnknownReason;
    readonly confidenceBasisPoints?: number;
  } = {}
): ExtractedField<T> {
  if (candidates.length === 0) return unknown(options.missingReason);
  const groups = new Map<string, { readonly value: T; readonly evidence: string }>();
  for (const candidate of candidates) groups.set(JSON.stringify(candidate.value), candidate);
  if (groups.size !== 1) return unknown("conflicting_evidence");
  const selected = groups.values().next().value;
  if (selected === undefined) return unknown(options.missingReason);
  return known(selected.value, selected.evidence, options.confidenceBasisPoints ?? 9_500);
}

function labeledString(text: string, label: RegExp, maximumLength: number): ExtractedField<string> {
  const matches = allMatches(
    text,
    new RegExp(`^\\s*(?:${label.source})\\s*[:=-]\\s*([^\\r\\n]{1,${maximumLength}})\\s*$`, "gimu")
  );
  return chooseUnique(
    matches.flatMap((match) => {
      const value = match[1]?.trim();
      return value === undefined || value.length === 0 ? [] : [{ value, evidence: match[0] }];
    })
  );
}

function halfUnitField(text: string, kind: "bedroom" | "bathroom"): ExtractedField<number> {
  const expression =
    kind === "bedroom"
      ? /\b(\d+(?:\.5)?)\s*(?:bedrooms?|beds?|br|bd)\b/gimu
      : /\b(\d+(?:\.5)?)\s*(?:bathrooms?|baths?|ba)\b/gimu;
  const candidates = allMatches(text, expression).flatMap((match) => {
    const value = match[1] === undefined ? Number.NaN : Number(match[1]);
    return Number.isFinite(value) && value >= 0 && value <= 50
      ? [{ value, evidence: match[0] }]
      : [];
  });
  if (kind === "bedroom") {
    for (const match of allMatches(text, /\bstudio\b/gimu)) {
      candidates.push({ value: 0, evidence: match[0] });
    }
  }
  return chooseUnique(candidates);
}

function squareFeetField(text: string): ExtractedField<number> {
  return chooseUnique(
    allMatches(text, /\b([\d,]+)\s*(?:sq\.?\s*ft\.?|square\s+feet)\b/gimu).flatMap((match) => {
      const value = Number.parseInt(match[1]?.replaceAll(",", "") ?? "", 10);
      return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000
        ? [{ value, evidence: match[0] }]
        : [];
    })
  );
}

function propertyTypeField(text: string): ExtractedField<PropertyType> {
  const matches = allMatches(
    text,
    /^\s*property\s+type\s*[:=-]\s*(apartment|condo|house|townhouse|room|other)\s*$/gimu
  );
  return chooseUnique(
    matches.flatMap((match) => {
      const value = match[1]?.toLowerCase() as PropertyType | undefined;
      return value === undefined ? [] : [{ value, evidence: match[0] }];
    })
  );
}

const MONEY_BODY = String.raw`(?:(US\$|CA\$|\$|€|£|[A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(USD|CAD|EUR|GBP))\s*(?:\/|per\s+)?(day|daily|week|weekly|month|monthly|year|yearly|annual|annually)`;

function currencyFromMarker(marker: string): string | null {
  const normalized = marker.toUpperCase();
  if (normalized === "$") return null;
  if (normalized === "US$") return "USD";
  if (normalized === "CA$") return "CAD";
  if (marker === "€") return "EUR";
  if (marker === "£") return "GBP";
  return normalized;
}

function billingPeriod(value: string): MoneyObservation["billingPeriod"] {
  if (/^(?:day|daily)$/iu.test(value)) return "day";
  if (/^(?:week|weekly)$/iu.test(value)) return "week";
  if (/^(?:month|monthly)$/iu.test(value)) return "month";
  return "year";
}

function amountMinorUnits(raw: string): number | null {
  const normalized = raw.replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole = "", fraction = ""] = normalized.split(".");
  const value =
    Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function moneyFromMatch(match: RegExpExecArray): MoneyObservation | null {
  const marker = match[1] ?? match[4];
  const rawNumber = match[2] ?? match[3];
  const period = match[5];
  if (marker === undefined || rawNumber === undefined || period === undefined) return null;
  const amount = amountMinorUnits(rawNumber);
  const currency = currencyFromMarker(marker);
  if (amount === null || currency === null) return null;
  return {
    amountMinorUnits: amount,
    currency,
    billingPeriod: billingPeriod(period),
    rawAmount: match[0].trim()
  };
}

function baseRentField(text: string): ExtractedField<MoneyObservation> {
  const fullExpression = new RegExp(
    String.raw`^\s*(?:base\s+)?rent\s*[:=-]\s*(${MONEY_BODY})\s*$`,
    "gimu"
  );
  const labeledLines = allMatches(text, /^\s*(?:base\s+)?rent\s*[:=-]\s*[^\r\n]+$/gimu);
  const candidates = allMatches(text, fullExpression).flatMap((match) => {
    const nested = new RegExp(MONEY_BODY, "iu").exec(match[1] ?? "");
    const value = nested === null ? null : moneyFromMatch(nested);
    return value === null ? [] : [{ value, evidence: match[0] }];
  });
  if (
    candidates.length === 0 &&
    labeledLines.some((match) => /(?<![A-Za-z])\$(?=\s*[\d,])/u.test(match[0]))
  ) {
    return unknown("ambiguous");
  }
  if (candidates.length === 0 && labeledLines.length > 0) return unknown("unrecognized_format");
  return chooseUnique(candidates);
}

function recurringFeesField(text: string): ExtractedField<RequiredRecurringFee[]> {
  const noFees = allMatches(
    text,
    /\b(?:no\s+(?:required\s+)?recurring\s+fees|no\s+additional\s+monthly\s+fees)\b/gimu
  );
  const lineExpression = new RegExp(
    String.raw`^\s*required\s+(?:recurring\s+)?([^:\r\n]{1,120})\s*[:=-]\s*(${MONEY_BODY})\s*$`,
    "gimu"
  );
  const candidates = allMatches(text, lineExpression).flatMap((match) => {
    const label = match[1]?.trim();
    const nested = new RegExp(MONEY_BODY, "iu").exec(match[2] ?? "");
    const amount = nested === null ? null : moneyFromMatch(nested);
    return label === undefined || label.length === 0 || amount === null
      ? []
      : [{ label, amount, evidence: match[0] }];
  });
  if (noFees.length > 0 && candidates.length > 0) return unknown("conflicting_evidence");
  if (noFees.length > 0) return known([], noFees[0]?.[0] ?? "No required recurring fees.");
  if (candidates.length === 0) {
    const feeLines = allMatches(
      text,
      /^\s*required\s+(?:recurring\s+)?[^:\r\n]+\s*[:=-]\s*[^\r\n]+$/gimu
    );
    if (feeLines.some((match) => /(?<![A-Za-z])\$(?=\s*[\d,])/u.test(match[0]))) {
      return unknown("ambiguous");
    }
    return feeLines.length > 0 ? unknown("unrecognized_format") : unknown();
  }
  const feesByLabel = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const labelKey = candidate.label.toLowerCase();
    const prior = feesByLabel.get(labelKey);
    if (prior !== undefined && JSON.stringify(prior.amount) !== JSON.stringify(candidate.amount)) {
      return unknown("conflicting_evidence");
    }
    if (prior === undefined) feesByLabel.set(labelKey, candidate);
  }
  const uniqueCandidates = [...feesByLabel.values()];
  const values = uniqueCandidates.map(({ label, amount }) => ({ label, amount }));
  return known(values, uniqueCandidates.map(({ evidence }) => evidence.trim()).join("\n"));
}

function availabilityFields(text: string): {
  readonly availabilityRaw: ExtractedField<string>;
  readonly availableOn: ExtractedField<string>;
} {
  const availabilityRaw = labeledString(text, /availability|available(?:\s+on)?/u, 300);
  if (availabilityRaw.status === "unknown") {
    return { availabilityRaw, availableOn: unknown(availabilityRaw.reason) };
  }
  const raw = availabilityRaw.value;
  if (/\b(?:around|approximately|approx\.?|early|mid|late|next|soon|immediately)\b/iu.test(raw)) {
    return { availabilityRaw, availableOn: unknown("ambiguous") };
  }
  const dates = [...raw.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/gu)].map((match) => match[1]);
  const uniqueDates = [...new Set(dates.filter((date): date is string => date !== undefined))];
  if (uniqueDates.length === 0)
    return { availabilityRaw, availableOn: unknown("unrecognized_format") };
  if (uniqueDates.length > 1)
    return { availabilityRaw, availableOn: unknown("conflicting_evidence") };
  const value = uniqueDates[0];
  const parsed = value === undefined ? null : new Date(`${value}T00:00:00.000Z`);
  if (
    value === undefined ||
    parsed === null ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return { availabilityRaw, availableOn: unknown("unrecognized_format") };
  }
  return {
    availabilityRaw,
    availableOn: known(value, availabilityRaw.evidenceSnippet, 9_500)
  };
}

function leaseTermField(text: string): ExtractedField<number> {
  const matches = allMatches(text, /^\s*lease\s+term\s*[:=-]\s*(\d+)\s*(months?|years?)\s*$/gimu);
  return chooseUnique(
    matches.flatMap((match) => {
      const count = Number.parseInt(match[1] ?? "", 10);
      const unit = match[2]?.toLowerCase();
      const value = unit?.startsWith("year") ? count * 12 : count;
      return Number.isSafeInteger(value) && value > 0 && value <= 120
        ? [{ value, evidence: match[0] }]
        : [];
    })
  );
}

function petField(text: string, species: "cat" | "dog"): ExtractedField<boolean> {
  const plural = `${species}s`;
  const positive = allMatches(
    text,
    new RegExp(
      `\\b(?:${plural}\\s+(?:are\\s+)?allowed|allows?\\s+${plural}|${plural}\\s+welcome)\\b`,
      "gimu"
    )
  );
  const inclusive = allMatches(text, /\bcats?\s+and\s+dogs?\s+(?:are\s+)?allowed\b/gimu);
  const negative = allMatches(
    text,
    new RegExp(
      `\\b(?:no\\s+${plural}|${plural}\\s+(?:are\\s+)?not\\s+allowed|prohibits?\\s+${plural})\\b`,
      "gimu"
    )
  );
  if ((positive.length > 0 || inclusive.length > 0) && negative.length > 0) {
    return unknown("conflicting_evidence");
  }
  if (positive.length > 0 || inclusive.length > 0) {
    const evidence = positive[0]?.[0] ?? inclusive[0]?.[0] ?? `${plural} allowed`;
    return known(true, evidence);
  }
  if (negative.length > 0) return known(false, negative[0]?.[0] ?? `${plural} not allowed`);
  if (/\b(?:pet[- ]friendly|pets?\s+(?:are\s+)?allowed)\b/iu.test(text))
    return unknown("ambiguous");
  return unknown();
}

function amenitiesField(text: string): ExtractedField<string[]> {
  const field = labeledString(text, /amenities?/u, 1_000);
  if (field.status === "unknown") return field;
  const values = [
    ...new Map(
      field.value
        .split(/[,;|]/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.length <= 120)
        .map((entry) => [entry.toLowerCase(), entry] as const)
    ).values()
  ];
  return values.length === 0
    ? unknown("unrecognized_format")
    : known(values, field.evidenceSnippet);
}

function sourcePostedAtField(text: string): ExtractedField<string> {
  const field = labeledString(text, /posted(?:\s+at|\s+on)?|post\s+date/u, 100);
  if (field.status === "unknown") return field;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(field.value)
    ? `${field.value}T00:00:00.000Z`
    : field.value;
  const parsed = new Date(dateOnly);
  return Number.isNaN(parsed.getTime())
    ? unknown("unrecognized_format")
    : known(parsed.toISOString(), field.evidenceSnippet);
}

function contactEmailField(text: string): ExtractedField<string> {
  return chooseUnique(
    allMatches(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gimu).map((match) => ({
      value: (match[0] ?? "").toLowerCase(),
      evidence: match[0]
    }))
  );
}

function contactPhoneField(text: string): ExtractedField<string> {
  return chooseUnique(
    allMatches(
      text,
      /(?:^|\D)((?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?:\D|$)/gimu
    ).flatMap((match) => {
      const value = match[1]?.trim();
      return value === undefined ? [] : [{ value, evidence: value }];
    })
  );
}

function contactUrlField(text: string): ExtractedField<string> {
  const field = labeledString(text, /contact\s+url/u, 2_048);
  if (field.status === "unknown") return field;
  try {
    const validated = validateAndClassifyProvenanceUrl(field.value);
    return known(validated.canonicalUrl, field.evidenceSnippet);
  } catch {
    return unknown("unrecognized_format");
  }
}

function contactChannelField(
  text: string,
  contactEmail: ExtractedField<string>,
  contactPhone: ExtractedField<string>
): ExtractedField<Exclude<ContactChannel, "unknown">> {
  const explicit = chooseUnique(
    allMatches(
      text,
      /^\s*contact\s+channel\s*[:=-]\s*(email|phone|platform_message|website_form|other)\s*$/gimu
    ).flatMap((match) => {
      const value = match[1] as Exclude<ContactChannel, "unknown"> | undefined;
      return value === undefined ? [] : [{ value, evidence: match[0] }];
    })
  );
  if (explicit.status === "known") return explicit;
  if (explicit.reason === "conflicting_evidence") return explicit;
  const candidates: { value: Exclude<ContactChannel, "unknown">; evidence: string }[] = [];
  if (contactEmail.status === "known")
    candidates.push({ value: "email", evidence: contactEmail.evidenceSnippet });
  if (contactPhone.status === "known")
    candidates.push({ value: "phone", evidence: contactPhone.evidenceSnippet });
  for (const match of allMatches(
    text,
    /\b(?:message|contact)\s+(?:me|us)\s+(?:on|through)\s+(?:the\s+)?platform\b/gimu
  )) {
    candidates.push({ value: "platform_message", evidence: match[0] });
  }
  for (const match of allMatches(text, /\b(?:contact|inquiry|enquiry)\s+form\b/gimu)) {
    candidates.push({ value: "website_form", evidence: match[0] });
  }
  return chooseUnique(candidates, { confidenceBasisPoints: 8_500 });
}

function structuredSnippet(field: keyof StructuredListingInput, value: unknown): string {
  return `${JSON.stringify(field)}:${JSON.stringify(value)}`;
}

function structuredValue<T>(
  field: keyof StructuredListingInput,
  value: T | null | undefined
): ExtractedField<T> {
  return value == null ? unknown() : known(value, structuredSnippet(field, value), 10_000);
}

function structuredExtraction(listing: StructuredListingInput): ListingExtraction {
  const contactChannel =
    listing.contactChannel == null || listing.contactChannel === "unknown"
      ? unknown<Exclude<ContactChannel, "unknown">>()
      : structuredValue("contactChannel", listing.contactChannel);
  const baseRent =
    listing.baseRent != null
      ? structuredValue("baseRent", listing.baseRent)
      : listing.monthlyRentCents != null
        ? unknown<MoneyObservation>("ambiguous")
        : unknown();
  const amenities =
    listing.amenities == null
      ? unknown<string[]>()
      : known(
          [...new Map(listing.amenities.map((value) => [value.toLowerCase(), value])).values()],
          structuredSnippet("amenities", listing.amenities),
          10_000
        );

  return ListingExtractionSchema.parse({
    title: structuredValue("title", listing.title),
    bedrooms: structuredValue("bedrooms", listing.bedrooms),
    bathrooms: structuredValue("bathrooms", listing.bathrooms),
    addressText: structuredValue("addressText", listing.addressText),
    squareFeet: structuredValue("squareFeet", listing.squareFeet),
    propertyType: structuredValue("propertyType", listing.propertyType),
    baseRent,
    requiredRecurringFees: structuredValue("requiredRecurringFees", listing.requiredRecurringFees),
    availabilityRaw: structuredValue("availabilityRaw", listing.availabilityRaw),
    availableOn: structuredValue("availableOn", listing.availableOn),
    leaseTermMonths: structuredValue("leaseTermMonths", listing.leaseTermMonths),
    catsAllowed: structuredValue("catsAllowed", listing.catsAllowed),
    dogsAllowed: structuredValue("dogsAllowed", listing.dogsAllowed),
    amenities,
    sourcePostedAt: structuredValue("sourcePostedAt", listing.sourcePostedAt),
    contactChannel,
    contactName: structuredValue("contactName", listing.contactName),
    contactEmail: structuredValue("contactEmail", listing.contactEmail),
    contactPhone: structuredValue("contactPhone", listing.contactPhone),
    contactUrl: structuredValue("contactUrl", listing.contactUrl)
  });
}

function textExtraction(textInput: string): ListingExtraction {
  const text = textInput.slice(0, TEXT_SCAN_LIMIT);
  const availability = availabilityFields(text);
  const contactEmail = contactEmailField(text);
  const contactPhone = contactPhoneField(text);
  return ListingExtractionSchema.parse({
    title: labeledString(text, /title/u, 300),
    bedrooms: halfUnitField(text, "bedroom"),
    bathrooms: halfUnitField(text, "bathroom"),
    addressText: labeledString(text, /address/u, 300),
    squareFeet: squareFeetField(text),
    propertyType: propertyTypeField(text),
    baseRent: baseRentField(text),
    requiredRecurringFees: recurringFeesField(text),
    availabilityRaw: availability.availabilityRaw,
    availableOn: availability.availableOn,
    leaseTermMonths: leaseTermField(text),
    catsAllowed: petField(text, "cat"),
    dogsAllowed: petField(text, "dog"),
    amenities: amenitiesField(text),
    sourcePostedAt: sourcePostedAtField(text),
    contactChannel: contactChannelField(text, contactEmail, contactPhone),
    contactName: labeledString(text, /contact\s+name/u, 200),
    contactEmail,
    contactPhone,
    contactUrl: contactUrlField(text)
  });
}

export function extractDeterministicListing(
  inputEnvelope: RawListingEnvelope
): DeterministicListingExtraction {
  const envelope = RawListingEnvelopeSchema.parse(inputEnvelope);
  const structuredEvidence = StructuredListingInputSchema.safeParse(envelope.rawJson);
  const method: DeterministicMethod =
    envelope.captureMethod === "fixture"
      ? "fixture_structured"
      : envelope.captureMethod === "manual_structured"
        ? "manual"
        : "rule";
  const extraction = structuredEvidence.success
    ? structuredExtraction(structuredEvidence.data)
    : textExtraction(envelope.rawText ?? "");
  const extractionMethods = Object.fromEntries(
    ListingExtractionFieldNameSchema.options.map((field) => [field, method])
  ) as Record<ListingExtractionFieldName, DeterministicMethod>;
  return { extraction, extractionMethods };
}
