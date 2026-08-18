import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_ENTRYPOINT = Object.freeze([
  "/usr/bin/node",
  "/opt/vera/bin/remote-extension-supervisor.mjs"
]);
const EXPECTED_PROBE_NAME = "maritime-init";
const BANNED_RUNTIME_PATHS = Object.freeze([
  "/bin/bash",
  "/bin/busybox",
  "/bin/sh",
  "/usr/bin/corepack",
  "/usr/bin/curl",
  "/usr/bin/git",
  "/usr/bin/npm",
  "/usr/bin/pnpm",
  "/usr/bin/yarn",
  "/usr/lib/node_modules",
  "/usr/local/bin/busybox",
  "/usr/local/bin/corepack",
  "/usr/local/bin/npm",
  "/usr/local/bin/pnpm",
  "/usr/local/bin/yarn",
  "/sbin/maritime-init",
  "/usr/sbin/maritime-init"
]);

const RUNTIME_OBSERVATION_SOURCE = String.raw`
const fs = require("node:fs");
const localBinStat = fs.lstatSync("/usr/local/bin");
const systemSbinStat = fs.lstatSync("/usr/sbin");
const sbinStat = fs.lstatSync("/sbin");
const bannedPaths = ${JSON.stringify(BANNED_RUNTIME_PATHS)};
process.stdout.write(JSON.stringify({
  uid: process.getuid(),
  gid: process.getgid(),
  cwd: process.cwd(),
  path: process.env.PATH ?? null,
  localBin: {
    isDirectory: localBinStat.isDirectory(),
    isSymbolicLink: localBinStat.isSymbolicLink(),
    uid: localBinStat.uid,
    gid: localBinStat.gid,
    mode: localBinStat.mode & 0o777,
    entries: fs.readdirSync("/usr/local/bin").sort()
  },
  systemSbin: {
    isDirectory: systemSbinStat.isDirectory(),
    isSymbolicLink: systemSbinStat.isSymbolicLink(),
    uid: systemSbinStat.uid,
    gid: systemSbinStat.gid,
    mode: systemSbinStat.mode & 0o777,
    entries: fs.readdirSync("/usr/sbin").sort()
  },
  sbin: {
    isDirectory: sbinStat.isDirectory(),
    isSymbolicLink: sbinStat.isSymbolicLink(),
    uid: sbinStat.uid,
    gid: sbinStat.gid,
    mode: sbinStat.mode & 0o777,
    entries: fs.readdirSync("/sbin").sort()
  },
  usrBinEntries: fs.readdirSync("/usr/bin").sort(),
  bannedPathsPresent: bannedPaths.filter((path) => fs.existsSync(path))
}));
`;

const BOOTSTRAP_SIMULATION_SOURCE = String.raw`
const fs = require("node:fs");
const directory = "/sbin";
const filename = ${JSON.stringify(EXPECTED_PROBE_NAME)};
const path = directory + "/" + filename;
const bootPath = path;
let descriptor;
let created = false;
let metadata = null;
let bootPathResolved = false;
try {
  descriptor = fs.openSync(path, "wx", 0o500);
  fs.writeFileSync(descriptor, "disposable provider bootstrap layout probe\n");
  fs.closeSync(descriptor);
  descriptor = undefined;
  fs.chmodSync(path, 0o500);
  const stat = fs.lstatSync(path);
  created = true;
  metadata = {
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode & 0o777
  };
  bootPathResolved = fs.realpathSync(bootPath) === path;
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor);
  fs.rmSync(path, { force: true });
}
process.stdout.write(JSON.stringify({
  created,
  filename,
  uid: metadata?.uid ?? null,
  gid: metadata?.gid ?? null,
  mode: metadata?.mode ?? null,
  helperPath: path,
  bootPath,
  bootPathResolved,
  removed: !fs.existsSync(path),
  directoryEmpty: fs.readdirSync(directory).length === 0
}));
`;

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function findGatewayImageLayoutViolations(observation) {
  const violations = [];
  if (
    observation?.localBin?.isDirectory !== true ||
    observation?.localBin?.isSymbolicLink !== false
  ) {
    violations.push("/usr/local/bin must be a real directory.");
  }
  if (observation?.localBin?.uid !== 0 || observation?.localBin?.gid !== 0) {
    violations.push("/usr/local/bin must be owned by root:root.");
  }
  if (observation?.localBin?.mode !== 0o755) {
    violations.push("/usr/local/bin must have mode 0755.");
  }
  if (!sameArray(observation?.localBin?.entries, [])) {
    violations.push("/usr/local/bin must be empty in the immutable image.");
  }
  if (
    observation?.systemSbin?.isDirectory !== true ||
    observation?.systemSbin?.isSymbolicLink !== false
  ) {
    violations.push("/usr/sbin must be a real directory.");
  }
  if (observation?.systemSbin?.uid !== 0 || observation?.systemSbin?.gid !== 0) {
    violations.push("/usr/sbin must be owned by root:root.");
  }
  if (observation?.systemSbin?.mode !== 0o755) {
    violations.push("/usr/sbin must have mode 0755.");
  }
  if (!sameArray(observation?.systemSbin?.entries, [])) {
    violations.push("/usr/sbin must be empty in the immutable image.");
  }
  if (observation?.sbin?.isDirectory !== true || observation?.sbin?.isSymbolicLink !== false) {
    violations.push("/sbin must be a real directory.");
  }
  if (observation?.sbin?.uid !== 0 || observation?.sbin?.gid !== 0) {
    violations.push("/sbin must be owned by root:root.");
  }
  if (observation?.sbin?.mode !== 0o755) {
    violations.push("/sbin must have mode 0755.");
  }
  if (!sameArray(observation?.sbin?.entries, [])) {
    violations.push("/sbin must be empty in the immutable image.");
  }
  if (observation?.uid !== 1000 || observation?.gid !== 1000) {
    violations.push("Gateway runtime must use UID/GID 1000:1000.");
  }
  if (observation?.cwd !== "/app" || observation?.configuredWorkingDirectory !== "/app") {
    violations.push("Gateway working directory must remain /app.");
  }
  if (observation?.path !== "/usr/bin") {
    violations.push("Gateway application PATH must be exactly /usr/bin.");
  }
  if (!sameArray(observation?.usrBinEntries, ["node"])) {
    violations.push("Gateway /usr/bin executable inventory must contain only node.");
  }
  if (!sameArray(observation?.bannedPathsPresent, [])) {
    violations.push("Gateway runtime contains a banned executable or package-manager path.");
  }
  if (!sameArray(observation?.entrypoint, EXPECTED_ENTRYPOINT)) {
    violations.push("Gateway entrypoint does not match the approved Node supervisor.");
  }
  return violations;
}

export function findBootstrapSimulationViolations(observation) {
  const violations = [];
  if (observation?.created !== true || observation?.filename !== EXPECTED_PROBE_NAME) {
    violations.push("Simulated provider bootstrap helper was not created as expected.");
  }
  if (observation?.uid !== 0 || observation?.gid !== 0 || observation?.mode !== 0o500) {
    violations.push("Simulated provider bootstrap helper metadata is outside the test contract.");
  }
  if (
    observation?.helperPath !== "/sbin/maritime-init" ||
    observation?.bootPath !== "/sbin/maritime-init" ||
    observation?.bootPathResolved !== true
  ) {
    violations.push("Simulated provider bootstrap path did not resolve through /sbin.");
  }
  if (observation?.removed !== true || observation?.directoryEmpty !== true) {
    violations.push("Simulated provider bootstrap helper was not removed cleanly.");
  }
  return violations;
}

function runDocker(arguments_) {
  const result = spawnSync("docker", arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
    shell: false
  });
  if (result.error) {
    throw new Error(`Docker could not start: ${result.error.code ?? "unknown_error"}.`);
  }
  if (result.status !== 0) {
    throw new Error(`Docker exited with status ${String(result.status)}.`);
  }
  return result.stdout.trim();
}

function parseArguments(arguments_) {
  let imageRef;
  let simulateBootstrap = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--" && index === 0) {
      continue;
    }
    if (argument === "--image-ref" && imageRef === undefined) {
      imageRef = arguments_[index + 1];
      index += 1;
    } else if (argument === "--simulate-bootstrap" && !simulateBootstrap) {
      simulateBootstrap = true;
    } else {
      throw new Error(
        "Usage: verify-gateway-image-layout --image-ref IMAGE [--simulate-bootstrap]"
      );
    }
  }
  if (typeof imageRef !== "string" || imageRef.length < 3) {
    throw new Error("A concrete --image-ref is required.");
  }
  return { imageRef, simulateBootstrap };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

export function verifyGatewayImageLayout(arguments_) {
  const { imageRef, simulateBootstrap } = parseArguments(arguments_);
  const imageConfig = parseJson(
    runDocker(["image", "inspect", "--format", "{{json .Config}}", imageRef]),
    "Docker image inspection"
  );
  const runtimeObservation = parseJson(
    runDocker([
      "run",
      "--rm",
      "--entrypoint",
      "/usr/bin/node",
      imageRef,
      "-e",
      RUNTIME_OBSERVATION_SOURCE
    ]),
    "Gateway runtime observation"
  );
  const layoutObservation = {
    ...runtimeObservation,
    configuredWorkingDirectory: imageConfig.WorkingDir,
    entrypoint: imageConfig.Entrypoint
  };
  const layoutViolations = findGatewayImageLayoutViolations(layoutObservation);

  let bootstrapObservation = null;
  let bootstrapViolations = [];
  if (simulateBootstrap) {
    bootstrapObservation = parseJson(
      runDocker([
        "run",
        "--rm",
        "--user",
        "0:0",
        "--entrypoint",
        "/usr/bin/node",
        imageRef,
        "-e",
        BOOTSTRAP_SIMULATION_SOURCE
      ]),
      "Simulated provider bootstrap"
    );
    bootstrapViolations = findBootstrapSimulationViolations(bootstrapObservation);
  }

  const violations = [...layoutViolations, ...bootstrapViolations];
  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
  return {
    schemaVersion: 1,
    imageLayoutAccepted: true,
    simulatedBootstrapAccepted: simulateBootstrap ? true : null,
    runtimeUid: layoutObservation.uid,
    runtimeGid: layoutObservation.gid,
    workingDirectory: layoutObservation.cwd,
    applicationPath: layoutObservation.path,
    localBin: layoutObservation.localBin,
    systemSbin: layoutObservation.systemSbin,
    sbin: layoutObservation.sbin,
    executableAllowlist: layoutObservation.usrBinEntries.map((name) => `/usr/bin/${name}`),
    bannedPathCount: layoutObservation.bannedPathsPresent.length,
    entrypoint: layoutObservation.entrypoint,
    bootstrapProbe:
      bootstrapObservation === null
        ? null
        : {
            filename: bootstrapObservation.filename,
            uid: bootstrapObservation.uid,
            gid: bootstrapObservation.gid,
            mode: bootstrapObservation.mode,
            helperPath: bootstrapObservation.helperPath,
            bootPath: bootstrapObservation.bootPath,
            bootPathResolved: bootstrapObservation.bootPathResolved,
            removed: bootstrapObservation.removed,
            directoryEmpty: bootstrapObservation.directoryEmpty
          }
  };
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(verifyGatewayImageLayout(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(
      `Gateway image-layout verification failed: ${
        error instanceof Error ? error.message : "unknown_error"
      }\n`
    );
    process.exitCode = 1;
  }
}
