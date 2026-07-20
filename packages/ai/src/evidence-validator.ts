import type {
  ListingExtraction,
  ListingExtractionFieldName,
  ListingExtractionRequest,
  MoneyObservation,
  RequiredRecurringFee
} from "@vera/domain";

import type { ExtractionValidationIssue } from "./prompt.ts";

export const MIN_PROVIDER_CONFIDENCE_BASIS_POINTS = 7_000;

function normalizeEvidence(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\s+/gu, " ").trim();
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeEvidence(needle).toLocaleLowerCase("en-US");
  return (
    normalizedNeedle.length > 0 &&
    normalizeEvidence(haystack).toLocaleLowerCase("en-US").includes(normalizedNeedle)
  );
}

function phoneDigits(value: string): string {
  return value.replace(/\D/gu, "");
}

function phoneOccurs(evidence: string, phone: string): boolean {
  const sought = phoneDigits(phone);
  if (sought.length < 7) return false;

  const candidates = evidence.match(/[+]?[\d().\-\s]{7,}/gu) ?? [];
  return candidates.some((candidate) => phoneDigits(candidate) === sought);
}

function urlOccurs(evidence: string, value: string): boolean {
  let sought: URL;
  try {
    sought = new URL(value);
  } catch {
    return false;
  }

  const candidates = evidence.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  return candidates.some((candidate) => {
    try {
      const trimmed = candidate.replace(/[),.;!?]+$/u, "");
      return new URL(trimmed).href === sought.href;
    } catch {
      return false;
    }
  });
}

function emailOccurs(evidence: string, value: string): boolean {
  return normalizedIncludes(evidence, value.toLocaleLowerCase("en-US"));
}

function amountMinorUnits(rawAmount: string): number | null {
  const match =
    /(?:^|[^\d])([0-9]{1,3}(?:[ ,][0-9]{3})*|[0-9]+)(?:[.,]([0-9]{1,2}))?(?:[^\d]|$)/u.exec(
      rawAmount
    );
  if (match?.[1] === undefined) return null;

  const majorText = match[1].replace(/[ ,]/gu, "");
  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  const combined = major * 100 + minor;
  return Number.isSafeInteger(combined) ? combined : null;
}

function currencyIsExplicit(rawAmount: string, currency: string): boolean {
  const upper = rawAmount.toLocaleUpperCase("en-US");
  if (upper.includes(currency)) return true;

  const explicitDollarPrefixes: Readonly<Record<string, readonly string[]>> = {
    USD: ["US$"],
    CAD: ["CA$", "C$"],
    AUD: ["AU$", "A$"],
    NZD: ["NZ$"],
    SGD: ["S$"],
    HKD: ["HK$"]
  };
  return (explicitDollarPrefixes[currency] ?? []).some((marker) => upper.includes(marker));
}

const BILLING_MARKERS: Readonly<Record<MoneyObservation["billingPeriod"], RegExp>> = {
  day: /(?:\/\s*(?:day|daily)|per\s+day|each\s+day)\b/iu,
  week: /(?:\/\s*(?:wk|week)|per\s+week|weekly)\b/iu,
  month: /(?:\/\s*(?:mo|month)|per\s+month|monthly)\b/iu,
  year: /(?:\/\s*(?:yr|year)|per\s+year|yearly|annually)\b/iu
};

function moneyIsSupported(evidence: string, money: MoneyObservation): boolean {
  return (
    normalizedIncludes(evidence, money.rawAmount) &&
    amountMinorUnits(money.rawAmount) === money.amountMinorUnits &&
    currencyIsExplicit(money.rawAmount, money.currency) &&
    BILLING_MARKERS[money.billingPeriod].test(money.rawAmount)
  );
}

function evidenceLines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => normalizeEvidence(line))
    .filter((line) => line.length > 0);
}

const NON_BASE_RENT_MARKER =
  /\b(?:pet|parking|garage|storage|utility|utilities|amenity|service|equipment)\s+rent\b/iu;
const BASE_RENT_MARKER =
  /\b(?:base\s+rent|monthly\s+rent)\b|(?:^|[.;]\s*|\bthe\s+)rent\s*(?::|=|-|is\b|of\b|costs?\b|runs?\b)/iu;

function baseRentIsSupported(evidenceSnippet: string, money: MoneyObservation): boolean {
  return evidenceLines(evidenceSnippet).some(
    (line) =>
      moneyIsSupported(line, money) &&
      BASE_RENT_MARKER.test(line) &&
      !NON_BASE_RENT_MARKER.test(line)
  );
}

const REQUIRED_FEE_MARKER =
  /\b(?:required|mandatory|compulsory|non[- ]optional|must\s+(?:be\s+)?paid)\b/iu;
const REQUIRED_FEE_HEADER = /\brequired\s+(?:recurring|monthly)\s+fees?\b/iu;

function isBaseRentLabel(label: string): boolean {
  return /^(?:(?:base|monthly)\s+)?rent$/iu.test(normalizeEvidence(label));
}

function recurringFeeIsSupported(evidenceSnippet: string, fee: RequiredRecurringFee): boolean {
  if (isBaseRentLabel(fee.label)) return false;
  const lines = evidenceLines(evidenceSnippet);
  const hasRequiredHeader = lines.some((line) => REQUIRED_FEE_HEADER.test(line));
  return lines.some(
    (line) =>
      normalizedIncludes(line, fee.label) &&
      moneyIsSupported(line, fee.amount) &&
      (hasRequiredHeader || REQUIRED_FEE_MARKER.test(line))
  );
}

function exactDateOccurs(evidence: string, isoDate: string): boolean {
  if (normalizedIncludes(evidence, isoDate)) return true;

  const [yearText, monthText, dayText] = isoDate.split("-");
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false;
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const year = Number(yearText);
  const monthNames = [
    ["january", "jan"],
    ["february", "feb"],
    ["march", "mar"],
    ["april", "apr"],
    ["may", "may"],
    ["june", "jun"],
    ["july", "jul"],
    ["august", "aug"],
    ["september", "sep"],
    ["october", "oct"],
    ["november", "nov"],
    ["december", "dec"]
  ] as const;
  const month = monthNames[monthIndex];
  if (month === undefined || !Number.isInteger(day) || !Number.isInteger(year)) return false;

  const normalized = normalizeEvidence(evidence).toLocaleLowerCase("en-US");
  return month.some((name) =>
    new RegExp(`\\b${name}\\s+0?${day}(?:st|nd|rd|th)?[,]?\\s+${year}\\b`, "u").test(normalized)
  );
}

function dateIsSupported(evidence: string, isoDate: string): boolean {
  return evidence.split(/\r?\n/u).some((line) => {
    if (/\b(?:early|mid|late|around|approximately|approx\.?|about|next)\b/iu.test(line)) {
      return false;
    }
    return exactDateOccurs(line, isoDate);
  });
}

function explicitNoRecurringFees(evidence: string): boolean {
  return /\b(?:no|required\s+none)\s+(?:additional\s+)?(?:required\s+)?(?:recurring\s+|monthly\s+)?fees?\b/iu.test(
    evidence
  );
}

function petValueIsSupported(
  evidence: string,
  field: "catsAllowed" | "dogsAllowed",
  value: boolean
): boolean {
  const species = field === "catsAllowed" ? "cats?" : "dogs?";
  const normalized = normalizeEvidence(evidence);
  const allowed = new RegExp(
    `\\b${species}\\b.{0,40}\\b(?:allowed|accepted|welcome|yes|ok(?:ay)?)\\b|\\b(?:allowed|accepts?|welcomes?)\\b.{0,40}\\b${species}\\b`,
    "iu"
  );
  const prohibited = new RegExp(
    `\\b(?:no|not|prohibited|forbidden)\\b.{0,40}\\b${species}\\b|\\b${species}\\b.{0,40}\\b(?:not\\s+allowed|prohibited|forbidden|no)\\b`,
    "iu"
  );
  if (value) {
    return (
      allowed.test(normalized) ||
      /\ball\s+pets?\s+(?:are\s+)?(?:allowed|welcome)\b/iu.test(normalized)
    );
  }
  return prohibited.test(normalized) || /\bno\s+pets?\b/iu.test(normalized);
}

function contactValueIsSupported(
  evidence: string,
  field: ListingExtractionFieldName,
  value: unknown
): boolean {
  if (typeof value !== "string") return false;
  switch (field) {
    case "contactEmail":
      return emailOccurs(evidence, value);
    case "contactPhone":
      return phoneOccurs(evidence, value);
    case "contactUrl":
      return urlOccurs(evidence, value);
    case "contactName":
      return normalizedIncludes(evidence, value);
    case "contactChannel":
      switch (value) {
        case "email":
          return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(evidence);
        case "phone":
          return (evidence.match(/[+]?[\d().\-\s]{7,}/gu) ?? []).length > 0;
        case "platform_message":
          return /\b(?:platform\s+message|message\s+(?:me|us|through|via)|send\s+(?:me|us)\s+a\s+message)\b/iu.test(
            evidence
          );
        case "website_form":
          return /\b(?:website|online|contact)\s+form\b/iu.test(evidence);
        case "other":
          return /\bcontact\b/iu.test(evidence);
        default:
          return false;
      }
    default:
      return true;
  }
}

function addIssue(
  issues: ExtractionValidationIssue[],
  code: ExtractionValidationIssue["code"],
  field: ListingExtractionFieldName
): void {
  if (!issues.some((issue) => issue.code === code && issue.field === field)) {
    issues.push({ code, field });
  }
}

export function validateExtractionEvidence(
  request: ListingExtractionRequest,
  extraction: ListingExtraction
): readonly ExtractionValidationIssue[] {
  const issues: ExtractionValidationIssue[] = [];
  const requested = new Set(request.fieldRequests.map((fieldRequest) => fieldRequest.field));

  for (const field of Object.keys(extraction) as ListingExtractionFieldName[]) {
    const extracted = extraction[field];
    if (extracted.status !== "known") continue;

    if (!requested.has(field)) addIssue(issues, "unrequested_field", field);
    if (extracted.confidenceBasisPoints < MIN_PROVIDER_CONFIDENCE_BASIS_POINTS) {
      addIssue(issues, "confidence_too_low", field);
    }
    if (!normalizedIncludes(request.evidenceText, extracted.evidenceSnippet)) {
      addIssue(issues, "evidence_not_found", field);
    }

    if (
      ["contactChannel", "contactName", "contactEmail", "contactPhone", "contactUrl"].includes(
        field
      ) &&
      !contactValueIsSupported(request.evidenceText, field, extracted.value)
    ) {
      addIssue(issues, "contact_not_found", field);
    }
  }

  if (
    extraction.baseRent.status === "known" &&
    !baseRentIsSupported(extraction.baseRent.evidenceSnippet, extraction.baseRent.value)
  ) {
    addIssue(issues, "money_not_supported", "baseRent");
  }

  if (extraction.requiredRecurringFees.status === "known") {
    const recurringFees = extraction.requiredRecurringFees;
    if (
      recurringFees.value.length === 0 &&
      !explicitNoRecurringFees(recurringFees.evidenceSnippet)
    ) {
      addIssue(issues, "empty_fees_not_supported", "requiredRecurringFees");
    }
    if (
      recurringFees.value.some(
        (fee) => !recurringFeeIsSupported(recurringFees.evidenceSnippet, fee)
      )
    ) {
      addIssue(issues, "money_not_supported", "requiredRecurringFees");
    }
  }

  if (
    extraction.availableOn.status === "known" &&
    !dateIsSupported(request.evidenceText, extraction.availableOn.value)
  ) {
    addIssue(issues, "availability_not_supported", "availableOn");
  }

  if (
    extraction.catsAllowed.status === "known" &&
    !petValueIsSupported(
      extraction.catsAllowed.evidenceSnippet,
      "catsAllowed",
      extraction.catsAllowed.value
    )
  ) {
    addIssue(issues, "pet_policy_not_supported", "catsAllowed");
  }
  if (
    extraction.dogsAllowed.status === "known" &&
    !petValueIsSupported(
      extraction.dogsAllowed.evidenceSnippet,
      "dogsAllowed",
      extraction.dogsAllowed.value
    )
  ) {
    addIssue(issues, "pet_policy_not_supported", "dogsAllowed");
  }

  return issues;
}
