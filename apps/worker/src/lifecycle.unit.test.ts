import { describe, expect, it, vi } from "vitest";

import {
  createWorkerLifecycle,
  createAsyncWorkerPoller,
  installGracefulShutdown,
  type ShutdownSignal,
  type SignalSource,
  type WorkerLogger
} from "./lifecycle.js";

interface CapturedLog {
  fields: Readonly<Record<string, unknown>>;
  message: string;
}

class CapturingLogger implements WorkerLogger {
  readonly entries: CapturedLog[] = [];

  info(fields: Readonly<Record<string, unknown>>, message: string): void {
    this.entries.push({ fields, message });
  }
}

class FakeSignalSource implements SignalSource {
  private readonly listeners = new Map<ShutdownSignal, () => void>();

  once(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.set(signal, listener);
  }

  off(signal: ShutdownSignal, listener: () => void): void {
    if (this.listeners.get(signal) === listener) {
      this.listeners.delete(signal);
    }
  }

  emit(signal: ShutdownSignal): void {
    this.listeners.get(signal)?.();
  }
}

function createSequentialIds(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];
    index += 1;

    if (id === undefined) {
      throw new Error("Test ID sequence was exhausted.");
    }

    return id;
  };
}

describe("worker lifecycle", () => {
  it("starts, completes a no-op job with a correlation ID, and stops", () => {
    const logger = new CapturingLogger();
    const lifecycle = createWorkerLifecycle({
      logger,
      now: () => new Date("2026-07-17T16:00:00.000Z"),
      createId: createSequentialIds(["worker-run-1", "job-correlation-1"])
    });

    lifecycle.start();
    const result = lifecycle.runNoopJob();
    lifecycle.stop("SIGTERM");

    expect(result).toEqual({
      correlationId: "job-correlation-1",
      completedAt: "2026-07-17T16:00:00.000Z",
      status: "completed"
    });
    expect(lifecycle.isRunning()).toBe(false);
    expect(logger.entries.map((entry) => entry.fields.event)).toEqual([
      "worker_started",
      "noop_job_completed",
      "worker_stopped"
    ]);
    expect(logger.entries[1]?.fields.correlationId).toBe("job-correlation-1");
  });

  it("rejects jobs before the worker starts", () => {
    const lifecycle = createWorkerLifecycle({
      logger: new CapturingLogger(),
      now: () => new Date("2026-07-17T16:00:00.000Z"),
      createId: () => "worker-run-1"
    });

    expect(() => lifecycle.runNoopJob()).toThrow(
      "Worker must be running before a job can execute."
    );
  });

  it("handles the first shutdown signal once and removes both handlers", () => {
    const source = new FakeSignalSource();
    const shutdown = vi.fn<(signal: ShutdownSignal) => void>();
    const cleanup = installGracefulShutdown(source, shutdown);

    source.emit("SIGINT");
    source.emit("SIGTERM");
    cleanup();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("SIGINT");
  });
});

describe("async worker poller", () => {
  it("schedules the next poll only after the active poll settles", async () => {
    let releaseFirst: (() => void) | undefined;
    let scheduled: (() => void) | undefined;
    let calls = 0;
    const poller = createAsyncWorkerPoller({
      poll: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      },
      intervalMilliseconds: 500,
      schedule(callback) {
        scheduled = callback;
        return 1;
      },
      cancel() {},
      onPollError() {}
    });

    poller.start();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(scheduled).toBeUndefined();

    releaseFirst?.();
    await vi.waitFor(() => expect(scheduled).toBeTypeOf("function"));
    scheduled?.();
    await Promise.resolve();
    expect(calls).toBe(2);
    await poller.stop();
  });

  it("aborts and awaits the active poll during shutdown", async () => {
    let observedAbort = false;
    const poller = createAsyncWorkerPoller({
      poll: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true }
          );
        });
      },
      intervalMilliseconds: 500,
      schedule: () => 1,
      cancel() {},
      onPollError() {}
    });

    poller.start();
    await Promise.resolve();
    await poller.stop();
    expect(observedAbort).toBe(true);
    expect(poller.isRunning()).toBe(false);
  });
});
