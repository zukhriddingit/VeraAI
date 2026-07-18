import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  createRailwayProcessLaunches,
  superviseRailwayProcesses,
  type ManagedRailwayProcess,
  type RailwayLogger
} from "./railway-runtime.ts";

describe("Railway process launch plan", () => {
  it("starts Next from the web workspace so it can find the production build", () => {
    const rootDirectory = "/workspace";
    const launches = createRailwayProcessLaunches(
      {
        childEnvironment: { VERA_DEMO_MODE: "1" },
        dataDirectory: "/data",
        port: 8080
      },
      rootDirectory
    );

    expect(launches.worker.options.cwd).toBe(rootDirectory);
    expect(launches.web.options.cwd).toBe("/workspace/apps/web");
    expect(launches.web.args).toContain("start");
    expect(launches.web.args).toContain("8080");
  });
});

class FakeProcess extends EventEmitter implements ManagedRailwayProcess {
  killed = false;
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }
}

function recordingLogger() {
  const info: Readonly<Record<string, unknown>>[] = [];
  const errors: Readonly<Record<string, unknown>>[] = [];
  const logger: RailwayLogger = {
    info(record) {
      info.push(record);
    },
    error(record) {
      errors.push(record);
    }
  };

  return { errors, info, logger };
}

describe("Railway process supervisor", () => {
  it("terminates the sibling and fails when one child exits", async () => {
    const signals = new EventEmitter();
    const web = new FakeProcess();
    const worker = new FakeProcess();
    const logs = recordingLogger();
    const result = superviseRailwayProcesses(
      [
        { name: "web", process: web },
        { name: "worker", process: worker }
      ],
      signals,
      logs.logger
    );

    web.emit("exit", 1, null);

    await expect(result).resolves.toBe(1);
    expect(worker.signals).toEqual(["SIGTERM"]);
    expect(logs.errors).toEqual([{ event: "web_process_exited" }]);
  });

  it("fails when a child emits a spawn error", async () => {
    const signals = new EventEmitter();
    const web = new FakeProcess();
    const worker = new FakeProcess();
    const logs = recordingLogger();
    const result = superviseRailwayProcesses(
      [
        { name: "web", process: web },
        { name: "worker", process: worker }
      ],
      signals,
      logs.logger
    );

    worker.emit("error", new Error("sensitive local path must not be logged"));

    await expect(result).resolves.toBe(1);
    expect(web.signals).toEqual(["SIGTERM"]);
    expect(logs.errors).toEqual([{ event: "worker_process_error" }]);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("forwards %s and exits cleanly", async (signal) => {
    const signals = new EventEmitter();
    const web = new FakeProcess();
    const worker = new FakeProcess();
    const logs = recordingLogger();
    const result = superviseRailwayProcesses(
      [
        { name: "web", process: web },
        { name: "worker", process: worker }
      ],
      signals,
      logs.logger
    );

    signals.emit(signal);

    await expect(result).resolves.toBe(0);
    expect(web.signals).toEqual([signal]);
    expect(worker.signals).toEqual([signal]);
    expect(logs.info).toEqual([{ event: "railway_shutdown_requested", signal }]);
  });
});
