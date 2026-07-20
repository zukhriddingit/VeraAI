import { describe, expect, it, vi } from "vitest";

import {
  DECISION_FIXTURE_EXPECTED_RISK_CODES,
  DECISION_FIXTURE_SNAPSHOT,
  DECISION_FIXTURE_TIME
} from "@vera/testing";

import { DEFAULT_DEDUPE_CONFIG } from "./dedupe/config.ts";
import type { DecisionEvaluationError } from "./evaluate-corpus.ts";
import { evaluateCorpus } from "./evaluate-corpus.ts";
import { evaluateFixtureMetrics, formatFixtureReport } from "./evaluate-fixtures-cli.ts";

describe("production decision corpus evaluation", () => {
  it("evaluates the twelve-record corpus into stable clusters, scores, and risk indicators", () => {
    const plan = evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME });

    expect(DECISION_FIXTURE_SNAPSHOT.sourceRecords).toHaveLength(12);
    expect(plan.canonicalPlans).toHaveLength(8);
    expect(
      plan.clusterPlans.filter(({ memberSourceRecordIds }) => memberSourceRecordIds.length > 1)
    ).toHaveLength(3);
    const riskCodes = new Set(plan.riskSignals.map(({ code }) => code));
    for (const expectedCode of DECISION_FIXTURE_EXPECTED_RISK_CODES) {
      expect(riskCodes.has(expectedCode)).toBe(true);
    }
    expect(plan.scoreSnapshots).toHaveLength(plan.canonicalPlans.length);
  });

  it("is deterministic across top-level source ordering", () => {
    const forward = evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME });
    const reversed = evaluateCorpus(
      {
        ...DECISION_FIXTURE_SNAPSHOT,
        sourceRecords: [...DECISION_FIXTURE_SNAPSHOT.sourceRecords].reverse(),
        activeOverrides: [...DECISION_FIXTURE_SNAPSHOT.activeOverrides].reverse(),
        priorCanonicals: [...DECISION_FIXTURE_SNAPSHOT.priorCanonicals].reverse()
      },
      { now: DECISION_FIXTURE_TIME }
    );

    expect(reversed).toEqual(forward);
  });

  it("fails visibly instead of silently truncating candidate generation", () => {
    expect(() =>
      evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, {
        now: DECISION_FIXTURE_TIME,
        dedupeConfig: { ...DEFAULT_DEDUPE_CONFIG, maxCandidatePairs: 1 }
      })
    ).toThrowError(
      expect.objectContaining<Partial<DecisionEvaluationError>>({
        code: "candidate_limit_exceeded",
        retryable: true
      })
    );
  });

  it("does not access the network", () => {
    const originalFetch = globalThis.fetch;
    const forbiddenFetch = vi.fn(() => {
      throw new Error("network access is forbidden in deterministic evaluation");
    });
    Object.assign(globalThis, { fetch: forbiddenFetch });
    try {
      expect(() =>
        evaluateCorpus(DECISION_FIXTURE_SNAPSHOT, { now: DECISION_FIXTURE_TIME })
      ).not.toThrow();
      expect(forbiddenFetch).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });

  it("reports honest fixture metrics and the small-sample caveat", () => {
    const metrics = evaluateFixtureMetrics();
    const report = formatFixtureReport(metrics);

    expect(metrics.precision).not.toBeNull();
    expect(metrics.recall).not.toBeNull();
    expect(metrics.precision!).toBeGreaterThanOrEqual(0.8);
    expect(metrics.recall!).toBeGreaterThanOrEqual(0.8);
    expect(metrics.missingExpectedRiskCodes).toEqual([]);
    expect(report).toContain("small-sample results are regression evidence");
    expect(report).toContain("TP=");
  });
});
