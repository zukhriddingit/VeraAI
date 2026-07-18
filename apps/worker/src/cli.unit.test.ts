import { HealthReportSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { runCli, type WorkerCliDependencies } from "./cli.js";
import type { ShutdownSignal, SignalSource } from "./lifecycle.js";

class FakeSignalSource implements SignalSource {
  readonly listeners = new Map<ShutdownSignal, () => void>();

  once(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.set(signal, listener);
  }

  off(signal: ShutdownSignal, listener: () => void): void {
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal);
  }

  emit(signal: ShutdownSignal): void {
    this.listeners.get(signal)?.();
  }
}

function createHealthDependencies(write: (message: string) => void): WorkerCliDependencies {
  return {
    output: { write },
    signalSource: {
      once() {},
      off() {}
    },
    now: () => new Date("2026-07-17T16:00:00.000Z"),
    createId: () => "unused-health-id",
    nodeVersion: "24.13.3",
    version: "0.1.0",
    createNormalizationRuntime: () => ({
      processNext: async () => ({ status: "idle" }),
      close() {}
    })
  };
}

describe("worker CLI", () => {
  it("accepts the conventional argument separator before the health command", async () => {
    const output: string[] = [];

    const exitCode = await runCli(
      ["--", "health"],
      createHealthDependencies((message) => output.push(message))
    );
    const report = HealthReportSchema.parse(JSON.parse(output.join("")));

    expect(exitCode).toBe(0);
    expect(report).toMatchObject({
      service: "vera-worker",
      status: "ok",
      version: "0.1.0"
    });
  });

  it("processes at most one normalization job with run-once", async () => {
    const output: string[] = [];
    let closed = false;
    const dependencies = createHealthDependencies((message) => output.push(message));
    dependencies.createNormalizationRuntime = () => ({
      processNext: async () => ({
        status: "completed",
        jobId: "job-1",
        mode: "deterministic_only",
        providerId: null,
        model: null,
        totalTokens: 0,
        latencyMilliseconds: 0
      }),
      close() {
        closed = true;
      }
    });

    const exitCode = await runCli(["run-once"], dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "completed",
      jobId: "job-1",
      mode: "deterministic_only"
    });
    expect(closed).toBe(true);
  });

  it("aborts and awaits the in-flight poll before closing on shutdown", async () => {
    const signalSource = new FakeSignalSource();
    let pollStarted = false;
    let observedAbort = false;
    let closed = false;
    const dependencies = createHealthDependencies(() => {});
    dependencies.signalSource = signalSource;
    dependencies.createNormalizationRuntime = () => ({
      processNext: async (signal) => {
        pollStarted = true;
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
        return { status: "cancelled", jobId: "job-leased" };
      },
      close() {
        closed = true;
      }
    });

    const running = runCli(["start"], dependencies);
    await Promise.resolve();
    expect(pollStarted).toBe(true);
    expect(closed).toBe(false);
    signalSource.emit("SIGTERM");

    await expect(running).resolves.toBe(0);
    expect(observedAbort).toBe(true);
    expect(closed).toBe(true);
  });
});
