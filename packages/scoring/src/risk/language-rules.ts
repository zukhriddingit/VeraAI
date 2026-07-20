import type { NormalizedDecisionSource } from "@vera/domain";

import type { RiskConfig } from "./config.ts";
import { languageEvidence } from "./evidence.ts";
import type { RiskCandidate } from "./types.ts";

function candidate(
  source: NormalizedDecisionSource,
  text: string,
  match: RegExpExecArray,
  config: RiskConfig,
  details: Omit<RiskCandidate, "evidence">
): RiskCandidate {
  return {
    ...details,
    evidence: [
      languageEvidence(
        source.sourceRecordId,
        text,
        match,
        details.verificationAction,
        config.evidenceWindowCharacters
      )
    ]
  };
}

function unusualLinkMatch(
  text: string,
  config: RiskConfig
): { readonly match: RegExpExecArray; readonly reason: string } | null {
  const unsafeScheme = /\b(?:javascript|data|file|ftp):[^\s]*/iu.exec(text);
  if (unsafeScheme) return { match: unsafeScheme, reason: "non-HTTP external scheme" };
  const urlPattern = /https?:\/\/([^/\s?#:]+)(?::\d+)?([^\s]*)/giu;
  for (const match of text.matchAll(urlPattern)) {
    const host = (match[1] ?? "").toLowerCase();
    const remainder = match[2] ?? "";
    if (config.shortenerHosts.includes(host)) {
      return { match, reason: "URL shortener" };
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) {
      return { match, reason: "IP-literal link" };
    }
    if (host.includes("xn--")) return { match, reason: "punycode hostname" };
    if (/[?&](?:password|passwd|token|credential|login|redirect_uri)=/iu.test(remainder)) {
      return { match, reason: "credential-like link parameter" };
    }
  }
  return null;
}

export function evaluateLanguageRiskCandidates(
  sources: readonly NormalizedDecisionSource[],
  config: RiskConfig
): readonly RiskCandidate[] {
  const results: RiskCandidate[] = [];
  for (const source of [...sources].sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
  )) {
    const text = source.descriptionText;
    if (text.trim().length === 0) continue;

    const paymentMethod =
      /\b(?:wire\s+(?:transfer|money)|cryptocurrency|crypto\s+payment|bitcoin|gift\s+card)\b/iu.exec(
        text
      );
    if (paymentMethod) {
      results.push(
        candidate(source, text, paymentMethod, config, {
          code: "suspicious_payment_method",
          severity: "high",
          confidenceBasisPoints: 9_500,
          verificationAction:
            "Irreversible payment language is a risk indicator; independently verify the property and payment process."
        })
      );
    }

    const depositBeforeViewing =
      /\b(?:deposit|payment|pay|application fee|wire transfer|gift card|bitcoin)[\s\S]{0,120}\b(?:before|without)[\s\S]{0,50}\b(?:viewing|tour|showing|seeing)\b/iu.exec(
        text
      ) ??
      /\b(?:before|without)[\s\S]{0,50}\b(?:viewing|tour|showing|seeing)\b[\s\S]{0,120}\b(?:deposit|payment|pay|application fee|wire transfer|gift card|bitcoin)\b/iu.exec(
        text
      );
    if (depositBeforeViewing) {
      results.push(
        candidate(source, text, depositBeforeViewing, config, {
          code: "deposit_before_viewing",
          severity: "high",
          confidenceBasisPoints: 9_500,
          verificationAction:
            "Payment before a viewing is a risk indicator; do not pay until the listing and viewing process are independently verified."
        })
      );
    }

    const outOfCountryCourier =
      /\b(?:out of (?:the )?country|currently abroad|overseas)[\s\S]{0,240}\b(?:courier|mail|ship|send)[\s\S]{0,80}\b(?:key|keys)\b/iu.exec(
        text
      ) ??
      /\b(?:courier|mail|ship|send)[\s\S]{0,80}\b(?:key|keys)\b[\s\S]{0,240}\b(?:out of (?:the )?country|currently abroad|overseas)\b/iu.exec(
        text
      );
    if (outOfCountryCourier) {
      results.push(
        candidate(source, text, outOfCountryCourier, config, {
          code: "out_of_country_courier_keys",
          severity: "high",
          confidenceBasisPoints: 9_000,
          verificationAction:
            "An out-of-country courier-key story is a risk indicator; verify ownership and arrange a normal in-person viewing."
        })
      );
    }

    const pressureRefusal =
      /\b(?:act now|today only|immediately|many (?:people|renters) (?:are )?waiting|do not delay)[\s\S]{0,240}\b(?:cannot|can't|won't|will not|refuse)[\s\S]{0,80}\b(?:show|meet|view|tour)\b/iu.exec(
        text
      ) ??
      /\b(?:cannot|can't|won't|will not|refuse)[\s\S]{0,80}\b(?:show|meet|view|tour)\b[\s\S]{0,240}\b(?:act now|today only|immediately|many (?:people|renters) (?:are )?waiting|do not delay)\b/iu.exec(
        text
      );
    if (pressureRefusal) {
      results.push(
        candidate(source, text, pressureRefusal, config, {
          code: "pressure_or_refusal_to_show",
          severity: "medium",
          confidenceBasisPoints: 8_500,
          verificationAction:
            "Pressure combined with refusal to show is a risk indicator; pause and independently verify the listing."
        })
      );
    }

    const offPlatform =
      /\b(?:contact|message|reply|communicate)\s+(?:me\s+)?(?:only|exclusively)\s+(?:on|via|through)\s+(?:whatsapp|telegram|signal|a private email|text message)|\b(?:leave|move off|avoid)\s+(?:this|the)\s+platform\b/iu.exec(
        text
      );
    if (offPlatform) {
      results.push(
        candidate(source, text, offPlatform, config, {
          code: "suspicious_off_platform_contact",
          severity: "medium",
          confidenceBasisPoints: 8_000,
          verificationAction:
            "An instruction to communicate only off-platform is a risk indicator; keep a verifiable channel and confirm identity."
        })
      );
    }

    const unusualLink = unusualLinkMatch(text, config);
    if (unusualLink) {
      results.push(
        candidate(source, text, unusualLink.match, config, {
          code: "unusual_external_link",
          severity: "medium",
          confidenceBasisPoints: 9_000,
          verificationAction: `${unusualLink.reason} is a risk indicator; do not open it until the destination is independently verified.`
        })
      );
    }
  }
  return results;
}
