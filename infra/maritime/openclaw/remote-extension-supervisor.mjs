import { spawn } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DATA_DIRECTORY = "/data";
const STATE_DIRECTORY = "/data/.openclaw";
const ROUTE_FILTER = "/opt/vera/bin/remote-extension-route-filter.mjs";
export const GATEWAY_ARGUMENTS = Object.freeze([ROUTE_FILTER, "node", "openclaw.mjs", "gateway"]);

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function rejectBoundarySymlink(path) {
  const stat = lstatIfPresent(path);
  if (stat?.isSymbolicLink()) {
    throw new Error("Gateway state boundary must not be a symbolic link.");
  }
  if (stat && !stat.isDirectory()) {
    throw new Error("Gateway state boundary must be a directory.");
  }
}

function collectStateTree(stateDirectory) {
  const directories = [];
  const files = [];
  const pending = [stateDirectory];
  while (pending.length > 0) {
    const current = pending.pop();
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error("Gateway state tree must not contain symbolic links.");
    }
    if (!stat.isDirectory()) {
      throw new Error("Gateway state tree contains an unsupported entry.");
    }
    directories.push(current);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const entryStat = lstatSync(path);
      if (entryStat.isSymbolicLink()) {
        throw new Error("Gateway state tree must not contain symbolic links.");
      }
      if (entryStat.isDirectory()) pending.push(path);
      else if (entryStat.isFile()) files.push(path);
      else throw new Error("Gateway state tree contains an unsupported entry.");
    }
  }
  return { directories, files };
}

export function prepareRuntimeState({ dataDirectory, stateDirectory, uid, gid }) {
  if (uid !== 1000 || gid !== 1000) {
    throw new Error("Gateway runtime must run as UID/GID 1000:1000.");
  }
  if (resolve(stateDirectory) !== resolve(dataDirectory, ".openclaw")) {
    throw new Error("Gateway state directory must remain below the data boundary.");
  }

  rejectBoundarySymlink(dataDirectory);
  rejectBoundarySymlink(stateDirectory);
  const previousMask = process.umask(0o077);
  try {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    rejectBoundarySymlink(dataDirectory);
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    rejectBoundarySymlink(stateDirectory);
    for (const name of ["credentials", "state", "workspace"]) {
      mkdirSync(join(stateDirectory, name), { recursive: true, mode: 0o700 });
    }

    const tree = collectStateTree(stateDirectory);
    chmodSync(dataDirectory, 0o700);
    for (const directory of tree.directories) chmodSync(directory, 0o700);
    for (const file of tree.files) chmodSync(file, 0o600);
    return previousMask;
  } catch (error) {
    process.umask(previousMask);
    throw error;
  }
}

export async function runGatewaySupervisor({
  spawnImplementation = spawn,
  prepareImplementation = prepareRuntimeState,
  processImplementation = process
} = {}) {
  if (processImplementation.env.OPENCLAW_STATE_DIR !== STATE_DIRECTORY) {
    throw new Error("Gateway state directory environment is not the fixed boundary.");
  }
  const uid = processImplementation.getuid?.();
  const gid = processImplementation.getgid?.();
  prepareImplementation({
    dataDirectory: DATA_DIRECTORY,
    stateDirectory: STATE_DIRECTORY,
    uid,
    gid
  });

  const child = spawnImplementation(processImplementation.execPath, GATEWAY_ARGUMENTS, {
    cwd: "/app",
    env: processImplementation.env,
    stdio: "inherit"
  });
  let stopping = false;
  const forward = (signal) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  const forwardInterrupt = () => forward("SIGINT");
  const forwardTermination = () => forward("SIGTERM");
  processImplementation.once("SIGINT", forwardInterrupt);
  processImplementation.once("SIGTERM", forwardTermination);

  const exit = await new Promise((finish) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      finish(result);
    };
    child.once("error", () => settle({ code: 1, signal: null }));
    child.once("exit", (code, signal) => settle({ code, signal }));
  });
  processImplementation.off("SIGINT", forwardInterrupt);
  processImplementation.off("SIGTERM", forwardTermination);

  if (exit.signal) {
    processImplementation.kill(processImplementation.pid, exit.signal);
    return;
  }
  processImplementation.exitCode = exit.code ?? 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await runGatewaySupervisor();
}
