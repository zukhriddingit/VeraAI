import type { DecisionWorkerResult, DecisionWorkerDependencies } from "./decision-worker.js";
import { processNextDecisionJob } from "./decision-worker.js";
import type { NormalizationWorkerResult } from "./normalization-worker.js";

export interface AlternatingWorkerRuntimeDependencies {
  readonly processNormalization: (signal: AbortSignal) => Promise<NormalizationWorkerResult>;
  readonly processDecision: (signal: AbortSignal) => Promise<DecisionWorkerResult>;
}

export type AlternatingWorkerResult =
  | { readonly kind: "normalization"; readonly result: NormalizationWorkerResult }
  | { readonly kind: "decision"; readonly result: DecisionWorkerResult };

export function createAlternatingWorkerRuntime(dependencies: AlternatingWorkerRuntimeDependencies) {
  let next: "normalization" | "decision" = "normalization";
  return {
    async processNext(signal: AbortSignal): Promise<AlternatingWorkerResult> {
      const kind = next;
      next = kind === "normalization" ? "decision" : "normalization";
      return kind === "normalization"
        ? { kind, result: await dependencies.processNormalization(signal) }
        : { kind, result: await dependencies.processDecision(signal) };
    }
  };
}

export function createDecisionProcessor(dependencies: DecisionWorkerDependencies) {
  return (signal: AbortSignal) => processNextDecisionJob(dependencies, signal);
}
