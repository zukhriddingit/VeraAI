import { createHealthReport } from "@vera/domain";
import { randomUUID } from "node:crypto";

import {
  createAsyncWorkerPoller,
  createWorkerLifecycle,
  installGracefulShutdown,
  type SignalSource
} from "./lifecycle.js";
import { createWorkerLogger, safeWorkerErrorFields } from "./logger.js";
import { createWorkerMetrics, workerMetricOutcome } from "./metrics.js";
import type { NormalizationWorkerResult } from "./normalization-worker.js";
import type { DecisionWorkerResult } from "./decision-worker.js";
import type { AcquisitionWorkerResult } from "./acquisition-worker.js";
import type { ScheduleWorkerResult } from "./maritime-scheduler.js";
import type { NotificationWorkerResult } from "./notification-worker.js";
import { createPostgresWorkerRuntime } from "./postgres-runtime.js";
import { createWorkerServiceServer } from "./service-server.js";
import type { ReadinessReport } from "@vera/domain";
import { parseWorkerRuntimeConfig } from "./runtime-config.js";

export interface CliOutput {
  write(message: string): void;
}

export interface WorkerCliDependencies {
  output: CliOutput;
  signalSource: SignalSource;
  now: () => Date;
  createId: () => string;
  nodeVersion: string;
  version: string;
  environment?: Readonly<Record<string, string | undefined>>;
  validateRuntimeConfiguration(
    environment: Readonly<Record<string, string | undefined>>,
    command: "start" | "run-once" | "serve"
  ): void;
  createNormalizationRuntime(
    leaseOwner: string,
    environment: Readonly<Record<string, string | undefined>>,
    command: "start" | "run-once" | "serve"
  ): NormalizationRuntime;
}

export interface NormalizationRuntime {
  readonly rotationSize?: number;
  processNext(signal: AbortSignal): Promise<{
    readonly kind:
      "schedule" | "notification" | "health" | "acquisition" | "normalization" | "decision";
    readonly result:
      | ScheduleWorkerResult
      | NotificationWorkerResult
      | { readonly status: "idle" | "completed" }
      | AcquisitionWorkerResult
      | NormalizationWorkerResult
      | DecisionWorkerResult;
  }>;
  readiness?(): Promise<ReadinessReport>;
  close(): Promise<void>;
}

function createDefaultNormalizationRuntime(
  leaseOwner: string,
  environment: Readonly<Record<string, string | undefined>>,
  command: "start" | "run-once" | "serve"
): NormalizationRuntime {
  return createPostgresWorkerRuntime(leaseOwner, environment, command);
}

const defaultDependencies: WorkerCliDependencies = {
  output: process.stdout,
  signalSource: process,
  now: () => new Date(),
  createId: randomUUID,
  nodeVersion: process.versions.node,
  version: process.env.npm_package_version ?? "0.1.0",
  environment: process.env,
  validateRuntimeConfiguration: (environment, command) => {
    parseWorkerRuntimeConfig(environment, command);
  },
  createNormalizationRuntime: createDefaultNormalizationRuntime
};

export async function runCli(
  arguments_: readonly string[],
  dependencies: WorkerCliDependencies = defaultDependencies
): Promise<number> {
  const commandIndex = arguments_[0] === "--" ? 1 : 0;
  const command = arguments_[commandIndex] ?? "start";

  if (command === "health") {
    const report = createHealthReport({
      service: "vera-worker",
      version: dependencies.version,
      now: dependencies.now(),
      nodeVersion: dependencies.nodeVersion
    });
    dependencies.output.write(JSON.stringify(report) + "\n");
    return 0;
  }

  const logger = createWorkerLogger();
  const lifecycle = createWorkerLifecycle({
    logger,
    now: dependencies.now,
    createId: dependencies.createId
  });

  if (command === "noop") {
    lifecycle.start();
    lifecycle.runNoopJob();
    lifecycle.stop("command");
    return 0;
  }

  if (command !== "start" && command !== "run-once" && command !== "serve") {
    logger.error(
      {
        command,
        event: "worker_command_rejected"
      },
      "Unknown worker command."
    );
    return 1;
  }

  try {
    dependencies.validateRuntimeConfiguration(dependencies.environment ?? {}, command);
  } catch (error: unknown) {
    logger.error(
      { event: "worker_runtime_configuration_rejected", ...safeWorkerErrorFields(error) },
      "Worker runtime configuration is invalid."
    );
    return 1;
  }

  lifecycle.start();

  let normalizationRuntime: NormalizationRuntime;

  try {
    normalizationRuntime = dependencies.createNormalizationRuntime(
      dependencies.createId(),
      dependencies.environment ?? {},
      command
    );
  } catch (error: unknown) {
    logger.error(
      {
        event: "normalization_runtime_unavailable",
        ...safeWorkerErrorFields(error)
      },
      "Normalization runtime could not start."
    );
    lifecycle.stop("command");
    return 1;
  }
  const metrics = createWorkerMetrics();
  const processNextObserved = async (signal: AbortSignal) => {
    const startedAt = performance.now();
    const result = await normalizationRuntime.processNext(signal);
    metrics.observeJob(
      result.kind,
      workerMetricOutcome(result.result.status),
      performance.now() - startedAt
    );
    return result;
  };

  if (command === "run-once") {
    const abortController = new AbortController();
    try {
      const results = [];
      for (let index = 0; index < (normalizationRuntime.rotationSize ?? 3); index += 1) {
        results.push(await processNextObserved(abortController.signal));
      }
      dependencies.output.write(JSON.stringify({ status: "batch_completed", results }) + "\n");
      return results.some(
        ({ result }) => result.status === "dead_letter" || result.status === "cancelled"
      )
        ? 1
        : 0;
    } catch (error: unknown) {
      logger.error(
        { event: "normalization_run_once_failed", ...safeWorkerErrorFields(error) },
        "Normalization run-once failed safely."
      );
      return 1;
    } finally {
      await normalizationRuntime.close();
      lifecycle.stop("command");
    }
  }

  const port = Number.parseInt(dependencies.environment?.PORT ?? "8080", 10);
  const service =
    command === "serve"
      ? createWorkerServiceServer({
          port: Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 8080,
          version: dependencies.version,
          nodeVersion: dependencies.nodeVersion,
          now: dependencies.now,
          readiness: async () => {
            const readiness =
              normalizationRuntime.readiness ??
              (async () => ({
                service: "vera-worker" as const,
                status: "not_ready" as const,
                checkedAt: dependencies.now().toISOString(),
                database: { status: "unavailable" as const, migration: "unknown" as const }
              }));
            try {
              const report = await readiness();
              metrics.setReadiness(report.status === "ready");
              return report;
            } catch (error: unknown) {
              metrics.setReadiness(false);
              throw error;
            }
          },
          metrics: () => metrics.render()
        })
      : null;
  if (service) await service.start();

  await new Promise<void>((resolve) => {
    const poller = createAsyncWorkerPoller({
      poll: async (signal) => {
        const result = await processNextObserved(signal);
        if (result.result.status !== "idle") {
          logger.info(
            { event: `${result.kind}_job_processed`, ...result.result },
            "Worker job processed."
          );
        }
      },
      intervalMilliseconds: 500,
      onPollError() {
        logger.error({ event: "normalization_poll_failed" }, "Normalization poll failed safely.");
      }
    });
    const signalRegistration = { dispose: () => {} };
    let shuttingDown = false;

    signalRegistration.dispose = installGracefulShutdown(dependencies.signalSource, (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        await poller.stop();
        await service?.close();
        await normalizationRuntime.close();
        lifecycle.stop(signal);
        signalRegistration.dispose();
        resolve();
      })();
    });
    poller.start();
  });

  return 0;
}
