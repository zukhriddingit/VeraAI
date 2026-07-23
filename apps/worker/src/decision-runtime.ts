import type { DecisionWorkerResult, DecisionWorkerDependencies } from "./decision-worker.js";
import { processNextDecisionJob } from "./decision-worker.js";
import type { NormalizationWorkerResult } from "./normalization-worker.js";
import type { AcquisitionWorkerResult } from "./acquisition-worker.js";
import type { ScheduleWorkerResult } from "./maritime-scheduler.js";
import type { NotificationWorkerResult } from "./notification-worker.js";

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

export interface RotatingWorkerRuntimeDependencies extends AlternatingWorkerRuntimeDependencies {
  readonly processAcquisition: (signal: AbortSignal) => Promise<AcquisitionWorkerResult>;
  readonly processSchedule?: (signal: AbortSignal) => Promise<ScheduleWorkerResult>;
  readonly processNotification?: (signal: AbortSignal) => Promise<NotificationWorkerResult>;
  readonly processHealth?: (
    signal: AbortSignal
  ) => Promise<{ readonly status: "idle" | "completed" }>;
}

export type RotatingWorkerResult =
  | { readonly kind: "acquisition"; readonly result: AcquisitionWorkerResult }
  | { readonly kind: "schedule"; readonly result: ScheduleWorkerResult }
  | { readonly kind: "notification"; readonly result: NotificationWorkerResult }
  | { readonly kind: "health"; readonly result: { readonly status: "idle" | "completed" } }
  | AlternatingWorkerResult;

export function createRotatingWorkerRuntime(dependencies: RotatingWorkerRuntimeDependencies) {
  const order = [
    ...(dependencies.processSchedule ? (["schedule"] as const) : []),
    "acquisition",
    "normalization",
    "decision",
    ...(dependencies.processNotification ? (["notification"] as const) : []),
    ...(dependencies.processHealth ? (["health"] as const) : [])
  ] as const;
  let index = 0;
  return {
    async processNext(signal: AbortSignal): Promise<RotatingWorkerResult> {
      const kind = order[index] ?? "acquisition";
      index = (index + 1) % order.length;
      switch (kind) {
        case "schedule":
          return { kind, result: await dependencies.processSchedule!(signal) };
        case "notification":
          return { kind, result: await dependencies.processNotification!(signal) };
        case "health":
          return { kind, result: await dependencies.processHealth!(signal) };
        case "acquisition":
          return { kind, result: await dependencies.processAcquisition(signal) };
        case "normalization":
          return { kind, result: await dependencies.processNormalization(signal) };
        case "decision":
          return { kind, result: await dependencies.processDecision(signal) };
      }
    }
  };
}
