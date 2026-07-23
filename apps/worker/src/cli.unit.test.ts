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
    validateRuntimeConfiguration() {},
    createNormalizationRuntime: () => ({
      processNext: async () => ({ kind: "normalization", result: { status: "idle" } }),
      async close() {}
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

  it("rejects invalid hosted configuration before creating a runtime", async () => {
    const dependencies = createHealthDependencies(() => {});
    let runtimeCreated = false;
    dependencies.validateRuntimeConfiguration = () => {
      throw new Error("hosted_config_missing");
    };
    dependencies.createNormalizationRuntime = () => {
      runtimeCreated = true;
      throw new Error("must not run");
    };

    await expect(runCli(["serve"], dependencies)).resolves.toBe(1);
    expect(runtimeCreated).toBe(false);
  });

  it("processes one acquisition, normalization, and decision rotation with run-once", async () => {
    const output: string[] = [];
    let closed = false;
    const dependencies = createHealthDependencies((message) => output.push(message));
    let invocation = 0;
    dependencies.createNormalizationRuntime = () => ({
      processNext: async () => {
        invocation += 1;
        return invocation === 1
          ? {
              kind: "normalization" as const,
              result: {
                status: "completed" as const,
                jobId: "job-1",
                mode: "deterministic_only" as const,
                providerId: null,
                model: null,
                totalTokens: 0,
                latencyMilliseconds: 0,
                decisionJobId: "decision-job-1",
                targetCorpusRevision: 1
              }
            }
          : { kind: "decision" as const, result: { status: "idle" as const } };
      },
      async close() {
        closed = true;
      }
    });

    const exitCode = await runCli(["run-once"], dependencies);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "batch_completed",
      results: [
        {
          kind: "normalization",
          result: { status: "completed", jobId: "job-1", mode: "deterministic_only" }
        },
        { kind: "decision", result: { status: "idle" } },
        { kind: "decision", result: { status: "idle" } }
      ]
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
        return {
          kind: "normalization" as const,
          result: { status: "cancelled" as const, jobId: "job-leased" }
        };
      },
      async close() {
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
