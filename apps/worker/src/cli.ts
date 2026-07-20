import { createHealthReport } from "@vera/domain";
import { createSqliteRepositories, openExistingDatabase } from "@vera/db";
import { randomUUID } from "node:crypto";

import {
  createAsyncWorkerPoller,
  createWorkerLifecycle,
  installGracefulShutdown,
  type SignalSource
} from "./lifecycle.js";
import { createWorkerLogger, safeWorkerErrorFields } from "./logger.js";
import {
  processNextNormalizationJob,
  type NormalizationWorkerResult
} from "./normalization-worker.js";
import { processNextDecisionJob, type DecisionWorkerResult } from "./decision-worker.js";
import { createAlternatingWorkerRuntime } from "./decision-runtime.js";
import { createWorkerProviderRuntime } from "./provider-factory.js";

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
  createNormalizationRuntime(leaseOwner: string): NormalizationRuntime;
}

export interface NormalizationRuntime {
  processNext(signal: AbortSignal): Promise<{
    readonly kind: "normalization" | "decision";
    readonly result: NormalizationWorkerResult | DecisionWorkerResult;
  }>;
  close(): void;
}

function createDefaultNormalizationRuntime(leaseOwner: string): NormalizationRuntime {
  const providerRuntime = createWorkerProviderRuntime();
  const connection = openExistingDatabase();
  const repositories = createSqliteRepositories(connection);
  const runtime = createAlternatingWorkerRuntime({
    processNormalization: (signal) =>
      processNextNormalizationJob(
        {
          repositories,
          leaseOwner,
          provider: providerRuntime.provider,
          providerTimeoutMilliseconds: providerRuntime.timeoutMilliseconds,
          now: () => new Date(),
          createId: randomUUID
        },
        signal
      ),
    processDecision: (signal) =>
      processNextDecisionJob(
        {
          repositories,
          leaseOwner,
          now: () => new Date(),
          createId: randomUUID
        },
        signal
      )
  });

  return {
    processNext: runtime.processNext,
    close() {
      connection.close();
    }
  };
}

const defaultDependencies: WorkerCliDependencies = {
  output: process.stdout,
  signalSource: process,
  now: () => new Date(),
  createId: randomUUID,
  nodeVersion: process.versions.node,
  version: process.env.npm_package_version ?? "0.1.0",
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

  if (command !== "start" && command !== "run-once") {
    logger.error(
      {
        command,
        event: "worker_command_rejected"
      },
      "Unknown worker command."
    );
    return 1;
  }

  lifecycle.start();

  let normalizationRuntime: NormalizationRuntime;

  try {
    normalizationRuntime = dependencies.createNormalizationRuntime(dependencies.createId());
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

  if (command === "run-once") {
    const abortController = new AbortController();
    try {
      const results = [];
      for (let index = 0; index < 2; index += 1) {
        results.push(await normalizationRuntime.processNext(abortController.signal));
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
      normalizationRuntime.close();
      lifecycle.stop("command");
    }
  }

  await new Promise<void>((resolve) => {
    const poller = createAsyncWorkerPoller({
      poll: async (signal) => {
        const result = await normalizationRuntime.processNext(signal);
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
        normalizationRuntime.close();
        lifecycle.stop(signal);
        signalRegistration.dispose();
        resolve();
      })();
    });
    poller.start();
  });

  return 0;
}
