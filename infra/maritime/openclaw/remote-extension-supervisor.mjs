import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DATA_DIRECTORY = "/data";
const STATE_DIRECTORY = "/data/.openclaw";
const ROUTE_FILTER = "/opt/vera/bin/remote-extension-route-filter.mjs";
export const EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME = "OPENCLAW_EXTENSION_PAIRING_SEED";
export const EXTENSION_PAIRING_SECRET_FILENAME = "browser-extension-relay.secret";
const EXTENSION_PAIRING_SEED_PATTERN = /^[0-9a-f]{64}$/u;
const PAIRING_BOOTSTRAP_ERROR = "Extension pairing credential bootstrap failed.";
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

function pairingSecretsMatch(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function installExtensionPairingSecretUnsafe({ stateDirectory, seed }) {
  if (!EXTENSION_PAIRING_SEED_PATTERN.test(seed)) {
    throw new Error("Invalid extension pairing credential.");
  }

  const credentialsDirectory = join(stateDirectory, "credentials");
  const credentialPath = join(credentialsDirectory, EXTENSION_PAIRING_SECRET_FILENAME);
  const credentialsStat = lstatSync(credentialsDirectory);
  if (credentialsStat.isSymbolicLink() || !credentialsStat.isDirectory()) {
    throw new Error("Invalid extension pairing credential boundary.");
  }

  let descriptor;
  try {
    descriptor = openSync(
      credentialPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    writeFileSync(descriptor, seed, "utf8");
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    const createdStat = fstatSync(descriptor);
    if (!createdStat.isFile() || (createdStat.mode & 0o777) !== 0o600) {
      throw new Error("Invalid extension pairing credential file.");
    }
    return;
  } catch (error) {
    if (descriptor !== undefined || error?.code !== "EEXIST") {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  const entryStat = lstatSync(credentialPath);
  if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
    throw new Error("Invalid extension pairing credential entry.");
  }
  const existingDescriptor = openSync(credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStat = fstatSync(existingDescriptor);
    const existing = readFileSync(existingDescriptor, "utf8");
    if (
      !openedStat.isFile() ||
      (openedStat.mode & 0o777) !== 0o600 ||
      !EXTENSION_PAIRING_SEED_PATTERN.test(existing) ||
      !pairingSecretsMatch(existing, seed)
    ) {
      throw new Error("Invalid extension pairing credential state.");
    }
  } finally {
    closeSync(existingDescriptor);
  }
}

export function installExtensionPairingSecret(input) {
  try {
    installExtensionPairingSecretUnsafe(input);
  } catch {
    throw new Error(PAIRING_BOOTSTRAP_ERROR);
  }
}

export async function runGatewaySupervisor({
  spawnImplementation = spawn,
  prepareImplementation = prepareRuntimeState,
  pairingInstallerImplementation = installExtensionPairingSecret,
  processImplementation = process
} = {}) {
  let pairingSeed = processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];
  delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];
  const childEnvironment = { ...processImplementation.env };
  delete childEnvironment[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];

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
  if (pairingSeed !== undefined) {
    pairingInstallerImplementation({
      stateDirectory: STATE_DIRECTORY,
      seed: pairingSeed
    });
  }
  pairingSeed = undefined;

  const child = spawnImplementation(processImplementation.execPath, GATEWAY_ARGUMENTS, {
    cwd: "/app",
    env: childEnvironment,
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
