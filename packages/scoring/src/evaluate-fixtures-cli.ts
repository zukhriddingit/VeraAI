import {
  DECISION_FIXTURE_EXPECTED_RISK_CODES,
  DECISION_FIXTURE_PAIR_LABELS,
  DECISION_FIXTURE_SNAPSHOT,
  DECISION_FIXTURE_TIME
} from "@vera/testing";

import { evaluateCorpus } from "./evaluate-corpus.ts";

export interface FixtureEvaluationMetrics {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly riskCounts: Readonly<Record<string, number>>;
  readonly missingExpectedRiskCodes: readonly string[];
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("::");
}

function safeRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function evaluateFixtureMetrics(): FixtureEvaluationMetrics {
  const plan = evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME });
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
  for (const signal of plan.riskSignals) {
    riskCounts[signal.code] = (riskCounts[signal.code] ?? 0) + 1;
  }
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: safeRatio(truePositives, truePositives + falsePositives),
    recall: safeRatio(truePositives, truePositives + falseNegatives),
    riskCounts: Object.fromEntries(
      Object.entries(riskCounts).sort(([left], [right]) => left.localeCompare(right, "en"))
    ),
    missingExpectedRiskCodes: DECISION_FIXTURE_EXPECTED_RISK_CODES.filter(
      (code) => riskCounts[code] === undefined
    )
  };
}

function formatRatio(value: number | null): string {
  return value === null ? "not measurable" : value.toFixed(3);
}

export function formatFixtureReport(metrics: FixtureEvaluationMetrics): string {
  const riskLines = Object.entries(metrics.riskCounts).map(
    ([code, count]) => `  ${code}: ${String(count)}`
  );
  return [
    "Vera sanitized fixture decision-engine evaluation",
    `Duplicate labels: ${String(DECISION_FIXTURE_PAIR_LABELS.length)}`,
    `TP=${String(metrics.truePositives)} FP=${String(metrics.falsePositives)} FN=${String(metrics.falseNegatives)} TN=${String(metrics.trueNegatives)}`,
    `Precision: ${formatRatio(metrics.precision)}`,
    `Recall: ${formatRatio(metrics.recall)}`,
    "Risk-signal counts:",
    ...riskLines,
    `Missing expected risk codes: ${metrics.missingExpectedRiskCodes.join(", ") || "none"}`,
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
    metrics.missingExpectedRiskCodes.length > 0
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("evaluate-fixtures-cli.ts")) main();
