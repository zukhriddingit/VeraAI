import { RiskSignalV2Schema, type RiskSeverityV2, type RiskSignalV2 } from "@vera/domain";

import { sha256Canonical, stableEntityId } from "../determinism.ts";
import { DEFAULT_RISK_CONFIG, type RiskConfig, validateRiskConfig } from "./config.ts";
import { evaluateComparativeRiskCandidates } from "./comparative-rules.ts";
import { evaluateLanguageRiskCandidates } from "./language-rules.ts";
import type { RiskCandidate, RiskListingInput } from "./types.ts";

const severityOrder: Readonly<Record<RiskSeverityV2, number>> = {
  high: 3,
  medium: 2,
  low: 1,
  informational: 0
};

function mergeCandidates(candidates: readonly RiskCandidate[]): readonly RiskCandidate[] {
  const byCode = new Map<RiskCandidate["code"], RiskCandidate[]>();
  for (const candidate of candidates) {
    byCode.set(candidate.code, [...(byCode.get(candidate.code) ?? []), candidate]);
  }
  return [...byCode.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([code, matching]) => {
      const strongest = [...matching].sort((left, right) =>
        severityOrder[right.severity] === severityOrder[left.severity]
          ? right.confidenceBasisPoints - left.confidenceBasisPoints
          : severityOrder[right.severity] - severityOrder[left.severity]
      )[0]!;
      const evidenceMap = new Map<string, RiskCandidate["evidence"][number]>();
      for (const item of matching.flatMap(({ evidence }) => evidence)) {
        evidenceMap.set(
          `${item.sourceRecordId}\u0000${item.fieldPath ?? ""}\u0000${item.excerpt}`,
          item
        );
      }
      return {
        code,
        severity: strongest.severity,
        confidenceBasisPoints: Math.max(
          ...matching.map(({ confidenceBasisPoints }) => confidenceBasisPoints)
        ),
        evidence: [...evidenceMap.values()].sort((left, right) =>
          left.sourceRecordId === right.sourceRecordId
            ? (left.fieldPath ?? "").localeCompare(right.fieldPath ?? "", "en")
            : left.sourceRecordId.localeCompare(right.sourceRecordId, "en")
        ),
        verificationAction: strongest.verificationAction
      };
    });
}

export function evaluateRiskIndicators(
  listing: RiskListingInput,
  resultSet: readonly RiskListingInput[],
  createdAt: string,
  inputConfig: RiskConfig = DEFAULT_RISK_CONFIG
): readonly RiskSignalV2[] {
  const config = validateRiskConfig(inputConfig);
  if (
    !resultSet.some(({ canonicalListingId }) => canonicalListingId === listing.canonicalListingId)
  ) {
    throw new Error("Risk result-set context must include the evaluated canonical listing.");
  }
  const candidates = mergeCandidates([
    ...evaluateLanguageRiskCandidates(listing.sources, config),
    ...evaluateComparativeRiskCandidates(listing, resultSet, config)
  ]);
  return candidates
    .map((candidate) => {
      const inputHash = sha256Canonical({
        version: config.version,
        canonicalListingId: listing.canonicalListingId,
        code: candidate.code,
        severity: candidate.severity,
        confidenceBasisPoints: candidate.confidenceBasisPoints,
        evidence: candidate.evidence,
        verificationAction: candidate.verificationAction
      });
      const idempotencyKey = sha256Canonical({
        version: config.version,
        canonicalListingId: listing.canonicalListingId,
        code: candidate.code,
        sourceRecordIds: [
          ...new Set(candidate.evidence.map(({ sourceRecordId }) => sourceRecordId))
        ].sort(),
        evidenceHash: inputHash
      });
      return RiskSignalV2Schema.parse({
        id: stableEntityId("risk", [listing.canonicalListingId, candidate.code, idempotencyKey]),
        schemaVersion: 2,
        canonicalListingId: listing.canonicalListingId,
        algorithmVersion: config.version,
        inputHash,
        idempotencyKey,
        code: candidate.code,
        severity: candidate.severity,
        confidenceBasisPoints: candidate.confidenceBasisPoints,
        evidence: candidate.evidence,
        needsVerification: true,
        verificationAction: candidate.verificationAction,
        status: "open",
        createdAt
      });
    })
    .sort((left, right) =>
      severityOrder[right.severity] === severityOrder[left.severity]
        ? left.code === right.code
          ? left.idempotencyKey.localeCompare(right.idempotencyKey, "en")
          : left.code.localeCompare(right.code, "en")
        : severityOrder[right.severity] - severityOrder[left.severity]
    );
}
