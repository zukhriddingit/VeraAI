import type { RiskEvidenceV2 } from "@vera/domain";

const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;
const phonePattern = /(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}(?:\s*(?:ext\.?|x)\s*\d{1,8})?/giu;

export function redactRiskEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(emailPattern, "[redacted email]")
    .replace(phonePattern, "[redacted phone]")
    .replace(/\s+/gu, " ")
    .trim();
}

export function boundedEvidenceExcerpt(
  text: string,
  start: number,
  end: number,
  maximumCharacters: number
): string {
  const radius = Math.max(0, Math.floor((maximumCharacters - (end - start)) / 2));
  const raw = text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius));
  const redacted = redactRiskEvidence(raw);
  return redacted.length <= maximumCharacters
    ? redacted
    : redacted.slice(0, maximumCharacters).trimEnd();
}

export function languageEvidence(
  sourceRecordId: string,
  text: string,
  match: RegExpExecArray,
  summary: string,
  maximumCharacters: number
): RiskEvidenceV2 {
  return {
    sourceRecordId,
    fieldPath: "description",
    summary,
    excerpt: boundedEvidenceExcerpt(
      text,
      match.index,
      match.index + match[0].length,
      maximumCharacters
    )
  };
}

export function structuredEvidence(
  sourceRecordId: string,
  fieldPath: string,
  summary: string,
  excerpt: string,
  maximumCharacters: number
): RiskEvidenceV2 {
  return {
    sourceRecordId,
    fieldPath,
    summary: redactRiskEvidence(summary),
    excerpt: redactRiskEvidence(excerpt).slice(0, maximumCharacters).trimEnd()
  };
}
