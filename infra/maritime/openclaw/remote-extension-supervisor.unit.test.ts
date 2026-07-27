import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// Plain ESM is intentional because this exact source is the final image entrypoint.
// @ts-expect-error The runtime module has no generated declaration file.
import {
  GATEWAY_ARGUMENTS,
  prepareRuntimeState,
  runGatewaySupervisor
} from "./remote-extension-supervisor.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runtimeBoundary(prefix = "vera-gateway-supervisor-") {
  const dataDirectory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(dataDirectory);
  return {
    dataDirectory,
    stateDirectory: join(dataDirectory, ".openclaw")
  };
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("remote extension Gateway supervisor", () => {
  it("requires the final UID/GID 1000:1000 identity", () => {
    const boundary = runtimeBoundary();
    expect(() => prepareRuntimeState({ ...boundary, uid: 0, gid: 0 })).toThrow(
      "Gateway runtime must run as UID/GID 1000:1000."
    );
  });

  it("creates and repairs the private state tree without exposing file contents", () => {
    const boundary = runtimeBoundary();
    mkdirSync(join(boundary.stateDirectory, "state"), {
      recursive: true,
      mode: 0o755
    });
    const existingEvidenceFile = join(boundary.stateDirectory, "state", "synthetic.json");
    writeFileSync(existingEvidenceFile, '{"synthetic":true}\n', {
      mode: 0o666
    });
    chmodSync(existingEvidenceFile, 0o666);

    const previousMask = prepareRuntimeState({
      ...boundary,
      uid: 1000,
      gid: 1000
    });

    expect(modeOf(boundary.stateDirectory)).toBe(0o700);
    expect(modeOf(join(boundary.stateDirectory, "credentials"))).toBe(0o700);
    expect(modeOf(join(boundary.stateDirectory, "state"))).toBe(0o700);
    expect(modeOf(join(boundary.stateDirectory, "workspace"))).toBe(0o700);
    expect(modeOf(existingEvidenceFile)).toBe(0o600);
    expect(readFileSync(existingEvidenceFile, "utf8")).toBe('{"synthetic":true}\n');
    process.umask(previousMask);
  });

  it("rejects symbolic links at or below the state boundary", () => {
    const boundary = runtimeBoundary("vera-gateway-supervisor-symlink-");
    const outside = mkdtempSync(join(tmpdir(), "vera-gateway-outside-"));
    temporaryDirectories.push(outside);
    symlinkSync(outside, boundary.stateDirectory);

    expect(() => prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 })).toThrow(
      "Gateway state boundary must not be a symbolic link."
    );

    rmSync(boundary.stateDirectory);
    mkdirSync(boundary.stateDirectory, { mode: 0o700 });
    symlinkSync(outside, join(boundary.stateDirectory, "nested"));
    expect(() => prepareRuntimeState({ ...boundary, uid: 1000, gid: 1000 })).toThrow(
      "Gateway state tree must not contain symbolic links."
    );
  });

  it("spawns only the fixed route-filter command and forwards termination", async () => {
    const child = new EventEmitter() as EventEmitter & {
      kill: (signal: NodeJS.Signals) => boolean;
    };
    const killedSignals: NodeJS.Signals[] = [];
    child.kill = (signal) => {
      killedSignals.push(signal);
      return true;
    };
    const fakeProcess = new EventEmitter() as EventEmitter & {
      env: NodeJS.ProcessEnv;
      execPath: string;
      exitCode?: number;
      pid: number;
      kill: (pid: number, signal: NodeJS.Signals) => boolean;
    };
    fakeProcess.env = { OPENCLAW_STATE_DIR: "/data/.openclaw" };
    fakeProcess.execPath = "/usr/bin/node";
    fakeProcess.pid = 42;
    const propagatedSignals: NodeJS.Signals[] = [];
    fakeProcess.kill = (_pid, signal) => {
      propagatedSignals.push(signal);
      return true;
    };
    const calls: unknown[][] = [];
    const running = runGatewaySupervisor({
      spawnImplementation: (...args: unknown[]) => {
        calls.push(args);
        return child;
      },
      prepareImplementation: () => 0o022,
      processImplementation: fakeProcess
    });

    fakeProcess.emit("SIGTERM");
    child.emit("exit", null, "SIGTERM");
    await running;

    expect(GATEWAY_ARGUMENTS).toEqual([
      "/opt/vera/bin/remote-extension-route-filter.mjs",
      "node",
      "openclaw.mjs",
      "gateway"
    ]);
    expect(calls).toEqual([
      ["/usr/bin/node", GATEWAY_ARGUMENTS, { cwd: "/app", env: fakeProcess.env, stdio: "inherit" }]
    ]);
    expect(killedSignals).toEqual(["SIGTERM"]);
    expect(propagatedSignals).toEqual(["SIGTERM"]);
  });
});
