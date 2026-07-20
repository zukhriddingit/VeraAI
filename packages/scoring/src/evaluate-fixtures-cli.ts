import {
  DECISION_FIXTURE_EXPECTED_RISK_CODES,
  DECISION_FIXTURE_PAIR_LABELS,
  DECISION_FIXTURE_SNAPSHOT,
  DECISION_FIXTURE_TIME
} from "@vera/testing";

import { evaluateCorpus } from "./evaluate-corpus.ts";

export interface FixtureEvaluationMetrics {
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly canonicalListingCount: number;
  readonly duplicateClusterCount: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly riskCounts: Readonly<Record<string, number>>;
  readonly riskSeverityCounts: Readonly<Record<string, number>>;
  readonly missingExpectedRiskCodes: readonly string[];
  readonly versions: Readonly<{
    plan: string;
    normalization: string;
    dedupe: string;
    stitch: string;
    score: string;
    risk: string;
  }>;
  readonly determinismVerified: boolean;
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("::");
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function evaluateFixtureMetrics(): FixtureEvaluationMetrics {
  const plan = evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME });
  const replay = evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME });
  const linkedPairs = new Set(
    plan.pairEvaluations
      .filter(({ decision }) => decision === "link")
      .map(({ leftSourceRecordId, rightSourceRecordId }) =>
        pairKey(leftSourceRecordId, rightSourceRecordId)
      )
  );
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  for (const label of DECISION_FIXTURE_PAIR_LABELS) {
    const predictedDuplicate = linkedPairs.has(
      pairKey(label.leftSourceRecordId, label.rightSourceRecordId)
    );
    if (predictedDuplicate && label.expectedDuplicate) truePositives += 1;
    else if (predictedDuplicate) falsePositives += 1;
    else if (label.expectedDuplicate) falseNegatives += 1;
    else trueNegatives += 1;
  }
  const riskCounts: Record<string, number> = {};
  const riskSeverityCounts: Record<string, number> = {};
  for (const signal of plan.riskSignals) {
    riskCounts[signal.code] = (riskCounts[signal.code] ?? 0) + 1;
    riskSeverityCounts[signal.severity] = (riskSeverityCounts[signal.severity] ?? 0) + 1;
  }
  const sourceCounts: Record<string, number> = {};
  for (const source of DECISION_FIXTURE_SNAPSHOT.sourceRecords) {
    sourceCounts[source.source] = (sourceCounts[source.source] ?? 0) + 1;
  }
  return {
    sourceCounts: Object.fromEntries(
      Object.entries(sourceCounts).sort(([left], [right]) => left.localeCompare(right, "en"))
    ),
    canonicalListingCount: plan.canonicalPlans.length,
    duplicateClusterCount: plan.clusterPlans.filter(
      ({ memberSourceRecordIds }) => memberSourceRecordIds.length > 1
    ).length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: safeRatio(truePositives, truePositives + falsePositives),
    recall: safeRatio(truePositives, truePositives + falseNegatives),
    riskCounts: Object.fromEntries(
      Object.entries(riskCounts).sort(([left], [right]) => left.localeCompare(right, "en"))
    ),
    riskSeverityCounts: Object.fromEntries(
      Object.entries(riskSeverityCounts).sort(([left], [right]) => left.localeCompare(right, "en"))
    ),
    missingExpectedRiskCodes: DECISION_FIXTURE_EXPECTED_RISK_CODES.filter(
      (code) => riskCounts[code] === undefined
    ),
    versions: {
      plan: plan.version,
      normalization: plan.normalizationVersion,
      dedupe: plan.dedupeVersion,
      stitch: plan.stitchVersion,
      score: plan.scoreVersion,
      risk: plan.riskVersion
    },
    determinismVerified: JSON.stringify(replay) === JSON.stringify(plan)
  };
}

function formatRatio(value: number | null): string {
  return value === null ? "not measurable" : value.toFixed(3);
}

export function formatFixtureReport(metrics: FixtureEvaluationMetrics): string {
  const sourceLines = Object.entries(metrics.sourceCounts).map(
    ([source, count]) => `  ${source}: ${String(count)}`
  );
  const riskLines = Object.entries(metrics.riskCounts).map(
    ([code, count]) => `  ${code}: ${String(count)}`
  );
  const severityLines = Object.entries(metrics.riskSeverityCounts).map(
    ([severity, count]) => `  ${severity}: ${String(count)}`
  );
  return [
    "Vera sanitized fixture decision-engine evaluation",
    "Source-record counts:",
    ...sourceLines,
    `Canonical listings: ${String(metrics.canonicalListingCount)}`,
    `Multi-record duplicate clusters: ${String(metrics.duplicateClusterCount)}`,
    `Duplicate labels: ${String(DECISION_FIXTURE_PAIR_LABELS.length)}`,
    `TP=${String(metrics.truePositives)} FP=${String(metrics.falsePositives)} FN=${String(metrics.falseNegatives)} TN=${String(metrics.trueNegatives)}`,
    `Precision: ${formatRatio(metrics.precision)}`,
    `Recall: ${formatRatio(metrics.recall)}`,
    "Risk-signal counts:",
    ...riskLines,
    "Risk-signal severity counts:",
    ...severityLines,
    `Missing expected risk codes: ${metrics.missingExpectedRiskCodes.join(", ") || "none"}`,
    `Versions: plan=${metrics.versions.plan} normalization=${metrics.versions.normalization} dedupe=${metrics.versions.dedupe} stitch=${metrics.versions.stitch} score=${metrics.versions.score} risk=${metrics.versions.risk}`,
    `Same-input determinism: ${metrics.determinismVerified ? "verified" : "FAILED"}`,
    "Sanitized fixture corpus; small-sample results are regression evidence, not production performance claims."
  ].join("\n");
}

function main(): void {
  const metrics = evaluateFixtureMetrics();
  process.stdout.write(`${formatFixtureReport(metrics)}\n`);
  if (
    metrics.precision === null ||
    metrics.recall === null ||
    metrics.precision < 0.8 ||
    metrics.recall < 0.8 ||
    metrics.missingExpectedRiskCodes.length > 0 ||
    !metrics.determinismVerified
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("evaluate-fixtures-cli.ts")) main();
