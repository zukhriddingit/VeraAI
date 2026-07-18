export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface WorkerLogger {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface WorkerLifecycleDependencies {
  logger: WorkerLogger;
  now: () => Date;
  createId: () => string;
}

export interface NoopJobResult {
  correlationId: string;
  completedAt: string;
  status: "completed";
}

export interface WorkerLifecycle {
  isRunning(): boolean;
  runNoopJob(correlationId?: string): NoopJobResult;
  start(): void;
  stop(signal: ShutdownSignal | "command"): void;
}

export interface SignalSource {
  once(signal: ShutdownSignal, listener: () => void): void;
  off(signal: ShutdownSignal, listener: () => void): void;
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface AsyncWorkerPollerDependencies {
  readonly poll: (signal: AbortSignal) => Promise<unknown>;
  readonly intervalMilliseconds: number;
  readonly schedule?: (callback: () => void, delayMilliseconds: number) => TimerHandle;
  readonly cancel?: (handle: TimerHandle) => void;
  readonly onPollError: () => void;
}

export interface AsyncWorkerPoller {
  isRunning(): boolean;
  start(): void;
  stop(): Promise<void>;
}

export function createAsyncWorkerPoller(
  dependencies: AsyncWorkerPollerDependencies
): AsyncWorkerPoller {
  if (
    !Number.isSafeInteger(dependencies.intervalMilliseconds) ||
    dependencies.intervalMilliseconds < 1
  ) {
    throw new Error("Worker poll interval must be a positive integer.");
  }

  const schedule = dependencies.schedule ?? setTimeout;
  const cancel = dependencies.cancel ?? clearTimeout;
  const abortController = new AbortController();
  let activePoll: Promise<void> | null = null;
  let timer: TimerHandle | null = null;
  let running = false;
  let started = false;

  const executePoll = async (): Promise<void> => {
    if (!running || abortController.signal.aborted) return;

    const operation = Promise.resolve(dependencies.poll(abortController.signal))
      .then(() => undefined)
      .catch(() => {
        if (!abortController.signal.aborted) dependencies.onPollError();
      });
    activePoll = operation;
    await operation;
    if (activePoll === operation) activePoll = null;

    if (running && !abortController.signal.aborted) {
      timer = schedule(() => {
        timer = null;
        void executePoll();
      }, dependencies.intervalMilliseconds);
    }
  };

  return {
    isRunning() {
      return running;
    },
    start() {
      if (started) throw new Error("Async worker poller cannot be restarted.");
      started = true;
      running = true;
      void executePoll();
    },
    async stop() {
      running = false;
      abortController.abort();
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      await activePoll;
    }
  };
}

export function createWorkerLifecycle(dependencies: WorkerLifecycleDependencies): WorkerLifecycle {
  const workerCorrelationId = dependencies.createId();
  let running = false;

  return {
    isRunning() {
      return running;
    },

    start() {
      if (running) {
        throw new Error("Worker lifecycle is already running.");
      }

      running = true;
      dependencies.logger.info(
        {
          correlationId: workerCorrelationId,
          event: "worker_started",
          startedAt: dependencies.now().toISOString()
        },
        "Worker started."
      );
    },

    runNoopJob(correlationId = dependencies.createId()) {
      if (!running) {
        throw new Error("Worker must be running before a job can execute.");
      }

      const result: NoopJobResult = {
        correlationId,
        completedAt: dependencies.now().toISOString(),
        status: "completed"
      };

      dependencies.logger.info(
        {
          correlationId,
          event: "noop_job_completed",
          jobType: "noop",
          status: result.status,
          completedAt: result.completedAt
        },
        "No-op job completed."
      );

      return result;
    },

    stop(signal) {
      if (!running) {
        return;
      }

      running = false;
      dependencies.logger.info(
        {
          correlationId: workerCorrelationId,
          event: "worker_stopped",
          signal,
          stoppedAt: dependencies.now().toISOString()
        },
        "Worker stopped."
      );
    }
  };
}

export function installGracefulShutdown(
  source: SignalSource,
  shutdown: (signal: ShutdownSignal) => void
): () => void {
  let shuttingDown = false;

  const handleSignal = (signal: ShutdownSignal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    shutdown(signal);
  };

  const onSigint = () => {
    handleSignal("SIGINT");
  };
  const onSigterm = () => {
    handleSignal("SIGTERM");
  };

  source.once("SIGINT", onSigint);
  source.once("SIGTERM", onSigterm);

  return () => {
    source.off("SIGINT", onSigint);
    source.off("SIGTERM", onSigterm);
  };
}
