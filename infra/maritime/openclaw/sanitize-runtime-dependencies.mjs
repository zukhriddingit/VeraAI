import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const LOCK_PATH = "/opt/vera-build/remote-extension-runtime-lock.json";
const APP_ROOT = "/app";
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const OPENCLAW_IMAGE =
  "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c";
const CHAINGUARD_INDEX =
  "cgr.dev/chainguard/node@sha256:3a3fbc052438535cca1ac0eed75c2dabf04a7ce7de749667cd265f98dbf9c771";
const CHAINGUARD_AMD64 =
  "cgr.dev/chainguard/node@sha256:abd1ea54ba68e3b2526c26ad5ef615823121a99010b595f1b4ebab77d47d061d";
const APPROVED_REPAIRS = Object.freeze([
  {
    name: "@opentelemetry/propagator-jaeger",
    path: "node_modules/@opentelemetry/propagator-jaeger",
    fromVersion: "2.8.0",
    toVersion: "2.9.0",
    tarball:
      "https://registry.npmjs.org/@opentelemetry/propagator-jaeger/-/propagator-jaeger-2.9.0.tgz",
    integrity:
      "sha512-4mYGty27rYvSM0jtp1ZUOqd3LfVRCYg9H5G9OFzSx5HViYToU21MFhWfco7x1HwXr7ER8yGOiCIHZUwjPksc0Q==",
    dependencyNames: ["@opentelemetry/core"]
  },
  {
    name: "@vitest/browser",
    path: "node_modules/@vitest/browser",
    fromVersion: "4.1.9",
    toVersion: "4.1.10",
    tarball: "https://registry.npmjs.org/@vitest/browser/-/browser-4.1.10.tgz",
    integrity:
      "sha512-UDwuWGwXj646CBx/bQHOaJSX7np0I8JL/UKQYa1e4QrVHH8VdWtx8eaOuf8sy0ShwDgR6NjJAsp5eF6vjF6qng==",
    dependencyNames: [
      "@blazediff/core",
      "@vitest/mocker",
      "@vitest/utils",
      "magic-string",
      "pngjs",
      "sirv",
      "tinyrainbow",
      "ws"
    ]
  },
  {
    name: "brace-expansion",
    path: "node_modules/brace-expansion",
    fromVersion: "5.0.7",
    toVersion: "5.0.9",
    tarball: "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz",
    integrity:
      "sha512-ScQ4IuvIEF1TMlP7Zt+vjJ//9zlPb2SDcxWxM3bk8s6t6GGdJ7KO1dCcTidOPJKePW30LE/2cT7wCyPho9/Wxg==",
    dependencyNames: ["balanced-match"]
  },
  {
    name: "fast-uri",
    path: "node_modules/fast-uri",
    fromVersion: "3.1.2",
    toVersion: "3.1.5",
    tarball: "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.5.tgz",
    integrity:
      "sha512-gHwA1O9LDIcKunMKhObS/HimwtehO1nPUECKAu5TpKgaO19fcWEl4bliWe1jWxVFvIXztJjjQ4L8XQ1EU9f7Jw==",
    dependencyNames: []
  },
  {
    name: "ip-address",
    path: "node_modules/ip-address",
    fromVersion: "10.2.0",
    toVersion: "10.3.1",
    tarball: "https://registry.npmjs.org/ip-address/-/ip-address-10.3.1.tgz",
    integrity:
      "sha512-1e9d3kb97NHJTIJDZW9rKqW2h6+dFa50Dy0fpPSMQp2ADje5gvKsXmdiK6dwY5t76TaTt5+P5N1Y/LoToIxP6g==",
    dependencyNames: []
  },
  {
    name: "postcss",
    path: "node_modules/postcss",
    fromVersion: "8.5.16",
    toVersion: "8.5.18",
    tarball: "https://registry.npmjs.org/postcss/-/postcss-8.5.18.tgz",
    integrity:
      "sha512-xdB1oSLHbz1vRWgCDalrCqEFTWzFlhqFC5tIHLMOSUIjhm3XXQ1qrFy8S/ESr1JYRRXqM3c1QFiMZUJdUTqyMQ==",
    dependencyNames: ["nanoid", "picocolors", "source-map-js"]
  },
  {
    name: "undici",
    path: "node_modules/undici",
    fromVersion: "8.5.0",
    toVersion: "8.9.0",
    tarball: "https://registry.npmjs.org/undici/-/undici-8.9.0.tgz",
    integrity:
      "sha512-aWZpUj7XoGonMClx4gdDRfgBjqeA+F473aDmROQQbM9n6PRfK/u1q/a0X4wMTgcHfT8H6fpbt98PFuDUwFg2YA==",
    dependencyNames: []
  },
  {
    name: "undici",
    path: "node_modules/jsdom/node_modules/undici",
    fromVersion: "7.28.0",
    toVersion: "7.29.0",
    tarball: "https://registry.npmjs.org/undici/-/undici-7.29.0.tgz",
    integrity:
      "sha512-IDxfleLmmbSskfWSUATiN1nfn2rDuvnMOqb5CWR92iIfojA0Ud+ulOAAEQ57LPr9rWmsreUyf5lwyao+7GNNVw==",
    dependencyNames: []
  }
]);
const FORBIDDEN_FINAL_PATHS = Object.freeze([
  "/bin/sh",
  "/usr/bin/sh",
  "/usr/bin/busybox",
  "/usr/bin/npm",
  "/usr/bin/npx",
  "/usr/bin/node-gyp",
  "/usr/bin/corepack",
  "/usr/bin/pnpm",
  "/usr/lib/node_modules",
  "/usr/local/bin/npm",
  "/usr/local/bin/pnpm",
  "/usr/local/lib/node_modules/npm",
  "/usr/local/share/corepack"
]);
const ALLOWED_FINAL_EXECUTABLES = Object.freeze(["/usr/bin/node"]);
const EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME = Object.freeze({
  packageName: "ws",
  version: "8.21.0",
  sourcePath: "node_modules/ws",
  targetPath: "/opt/vera/node_modules/ws",
  files: Object.freeze([
    ["lib/buffer-util.js", "8b0a45739132f82e25ea13163780abf547ccfe989267f3eb7abb475beec92da3"],
    ["lib/constants.js", "391e823142b8b370e55a2fd32b022deaf03b8415c56000009674ebc86a0b4f86"],
    ["lib/event-target.js", "c45d3c6e12d170c860c0c3f1a050aa0f864d9806632b609a1e607d675aba128c"],
    ["lib/extension.js", "852564f0f6b460287043803eae732666fb5610f676874354fc89f06aa4e986ed"],
    ["lib/limiter.js", "e0469d4b83f6ba764b15f80e1766b75c136fbff68f048f4c050f0b1c7f065f69"],
    [
      "lib/permessage-deflate.js",
      "02c31796f0132a335d4efe7b7adcebadbb69543a1ce65ae04aaccc3530e27ab9"
    ],
    ["lib/receiver.js", "4879edbf8e48d04d09783cf9c04b5e25f5a448247bb01279438ded2899747220"],
    ["lib/sender.js", "d0791d30c3defd44dcabbddb879a901c757993fea2c00a7ffea01d53b23b4b77"],
    ["lib/stream.js", "a56fcb6e2b152097ee820b6f5410b1f71e59819b45d08d9f8bda588fe39070ec"],
    ["lib/subprotocol.js", "be3f6323d6f549568577dcba9004c1479d95c65a7abb0fe0c582875b9fac0b7c"],
    ["lib/validation.js", "41ce8e83d0d434132e1704895fedb91f6703a701b42d91c80954ab29b2845593"],
    ["lib/websocket-server.js", "29029a4d346800c792300df153df2007e9805d9d7b67b0883f9730b64f25b1c8"],
    ["lib/websocket.js", "48fdb0f54c1f8ce580d3cfa2908fe7d96fe18f06f9d82306950441cb09b5db26"],
    ["package.json", "584ce6e7516587ba249dc910b0c04e2753f6b3f451fc3a5bc324f7735bdacc71"],
    ["wrapper.mjs", "fe154662301fd558f935f9c217fccbe7a7dac02ff39e648a000589403ff27c7f"]
  ])
});

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameRepair(actual, expected) {
  return (
    isObject(actual) &&
    actual.name === expected.name &&
    actual.path === expected.path &&
    actual.fromVersion === expected.fromVersion &&
    actual.toVersion === expected.toVersion &&
    actual.tarball === expected.tarball &&
    actual.integrity === expected.integrity &&
    sameStringArray(actual.dependencyNames, expected.dependencyNames)
  );
}

function sameEnrollmentWebSocketRuntime(actual) {
  return (
    isObject(actual) &&
    actual.packageName === EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.packageName &&
    actual.version === EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.version &&
    actual.sourcePath === EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.sourcePath &&
    actual.targetPath === EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.targetPath &&
    Array.isArray(actual.files) &&
    actual.files.length === EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.files.length &&
    actual.files.every((file, index) => {
      const expected = EXPECTED_ENROLLMENT_WEBSOCKET_RUNTIME.files[index];
      return isObject(file) && file.path === expected[0] && file.sha256 === expected[1];
    })
  );
}

export function findRuntimeLockViolations(lock) {
  const violations = [];
  if (!isObject(lock) || lock.schemaVersion !== "1") {
    violations.push("Gateway runtime lock schemaVersion must be exactly 1.");
    return violations;
  }
  if (
    !isObject(lock.openclaw) ||
    lock.openclaw.version !== "2026.7.1" ||
    lock.openclaw.sourceCommit !== "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4" ||
    lock.openclaw.image !== OPENCLAW_IMAGE
  ) {
    violations.push("Gateway runtime lock must pin the reviewed OpenClaw 2026.7.1 image.");
  }
  if (
    !isObject(lock.finalRuntime) ||
    lock.finalRuntime.imageIndex !== CHAINGUARD_INDEX ||
    lock.finalRuntime.linuxAmd64Image !== CHAINGUARD_AMD64 ||
    lock.finalRuntime.observedNodeVersion !== "26.7.0"
  ) {
    violations.push("Gateway runtime lock must pin the reviewed Chainguard amd64 Node image.");
  }
  if (lock.finalRuntime?.uid !== 1000 || lock.finalRuntime?.gid !== 1000) {
    violations.push("Final Gateway runtime UID/GID must remain 1000:1000.");
  }
  if (
    !sameStringArray(lock.finalRuntime?.entrypoint, [
      "/usr/bin/node",
      "/opt/vera/bin/remote-extension-supervisor.mjs"
    ])
  ) {
    violations.push("Final Gateway runtime entrypoint must use the fixed Node supervisor.");
  }
  if (!sameEnrollmentWebSocketRuntime(lock.enrollmentWebSocketRuntime)) {
    violations.push("Gateway enrollment WebSocket runtime must match the exact locked ws files.");
  }
  if (
    !isObject(lock.scanner) ||
    lock.scanner.name !== "trivy" ||
    lock.scanner.version !== "0.72.0" ||
    !sameStringArray(lock.scanner.severities, ["CRITICAL", "HIGH"]) ||
    lock.scanner.ignoreUnfixed !== false
  ) {
    violations.push(
      "Gateway runtime scanner must include fixed and unfixed CRITICAL/HIGH findings."
    );
  }
  if (!Array.isArray(lock.repairs) || lock.repairs.length !== APPROVED_REPAIRS.length) {
    violations.push("Runtime repair lock must contain exactly the eight approved packages.");
  } else if (!lock.repairs.every((repair, index) => sameRepair(repair, APPROVED_REPAIRS[index]))) {
    violations.push("Runtime repair lock contains an unapproved package identity or integrity.");
  }
  if (!sameStringArray(lock.forbiddenFinalPaths, FORBIDDEN_FINAL_PATHS)) {
    violations.push("Runtime repair lock must forbid package managers and a final-image shell.");
  }
  if (!sameStringArray(lock.allowedFinalExecutables, ALLOWED_FINAL_EXECUTABLES)) {
    violations.push("Runtime repair lock must allow only the Node executable in the final image.");
  }
  return violations;
}

function sortedDependencyNames(manifest) {
  if (!isObject(manifest.dependencies)) return [];
  return Object.keys(manifest.dependencies).sort();
}

export function verifyPackageManifest({ manifest, repair, phase }) {
  const violations = [];
  if (!isObject(manifest) || manifest.name !== repair.name) {
    violations.push("Runtime repair package name does not match the runtime lock.");
  }
  const expectedVersion = phase === "source" ? repair.fromVersion : repair.toVersion;
  if (!isObject(manifest) || manifest.version !== expectedVersion) {
    violations.push(
      phase === "source"
        ? "Source package version does not match the runtime lock."
        : "Replacement package version does not match the runtime lock."
    );
  }
  if (
    phase === "replacement" &&
    !sameStringArray(sortedDependencyNames(manifest), [...repair.dependencyNames].sort())
  ) {
    violations.push("Replacement package dependency names do not match the runtime lock.");
  }
  return violations;
}

export function verifyIntegrity(bytes, integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    throw new Error("Only sha512 npm integrity is accepted.");
  }
  const observed = createHash("sha512").update(bytes).digest("base64");
  if (observed !== integrity.slice("sha512-".length)) {
    throw new Error("Runtime repair tarball integrity mismatch.");
  }
}

export function resolveRepairTarget(appRoot, packagePath) {
  if (isAbsolute(packagePath)) {
    throw new Error("Runtime repair path must remain below the application root.");
  }
  const target = resolve(appRoot, packagePath);
  const relation = relative(appRoot, target);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Runtime repair path must remain below the application root.");
  }
  return target;
}

function safeRelativeFile(root, relativePath) {
  if (typeof relativePath !== "string" || isAbsolute(relativePath)) {
    throw new Error("Locked runtime file must remain below its package root.");
  }
  const path = resolve(root, relativePath);
  const relation = relative(root, path);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Locked runtime file must remain below its package root.");
  }
  return path;
}

export function retainEnrollmentWebSocketRuntime({ appRoot, runtimeRoot, runtime }) {
  if (!isObject(runtime) || !Array.isArray(runtime.files)) {
    throw new Error("Gateway enrollment WebSocket runtime lock is missing.");
  }
  const sourceLink = resolveRepairTarget(appRoot, runtime.sourcePath);
  const sourceRoot = realpathSync(sourceLink);
  const sourceRelation = relative(realpathSync(appRoot), sourceRoot);
  if (sourceRelation.startsWith("..") || isAbsolute(sourceRelation)) {
    throw new Error("Enrollment WebSocket runtime source escaped the application root.");
  }
  const manifest = readJson(join(sourceRoot, "package.json"));
  if (manifest.name !== runtime.packageName || manifest.version !== runtime.version) {
    throw new Error("Enrollment WebSocket runtime package identity does not match the lock.");
  }
  const relativeTarget = relative("/opt/vera", runtime.targetPath);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget) || relativeTarget === "") {
    throw new Error("Enrollment WebSocket runtime target escaped the fixed image boundary.");
  }
  const target = resolve(runtimeRoot, relativeTarget);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  const staged = mkdtempSync(join(parent, ".ws-runtime-"));
  try {
    for (const file of runtime.files) {
      if (!isObject(file) || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
        throw new Error("Enrollment WebSocket runtime file lock is invalid.");
      }
      const source = safeRelativeFile(sourceRoot, file.path);
      const sourceStat = lstatSync(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error("Enrollment WebSocket runtime source must contain regular files only.");
      }
      const bytes = readFileSync(source);
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error("Enrollment WebSocket runtime file hash mismatch.");
      }
      const destination = safeRelativeFile(staged, file.path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
      copyFileSync(source, destination);
      chmodSync(destination, 0o444);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
    chmodSync(target, 0o555);
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(target, entry.name), 0o555);
    }
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
  return { fileCount: runtime.files.length };
}

function verifyNoSymlinks(directory) {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error("Replacement package archive must not contain symbolic links.");
      }
      if (stat.isDirectory()) pending.push(path);
    }
  }
}

async function extractTarball({ archivePath, destination }) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const result = spawnSync(
    "/usr/bin/tar",
    ["-xzf", archivePath, "-C", destination, "--strip-components=1"],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
  );
  if (result.error || result.status !== 0) {
    throw new Error("Runtime repair tarball extraction failed.");
  }
  verifyNoSymlinks(destination);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function sanitizeRuntimeDependencies({
  appRoot = APP_ROOT,
  runtimeRoot = "/opt/vera",
  lock,
  fetchImplementation = fetch,
  extractImplementation = extractTarball,
  integrityImplementation = verifyIntegrity,
  retainImplementation = retainEnrollmentWebSocketRuntime
}) {
  const lockViolations = findRuntimeLockViolations(lock);
  if (lockViolations.length > 0) throw new Error(lockViolations.join("\n"));

  for (const repair of lock.repairs) {
    const target = resolveRepairTarget(appRoot, repair.path);
    const sourceViolations = verifyPackageManifest({
      manifest: readJson(join(target, "package.json")),
      repair,
      phase: "source"
    });
    if (sourceViolations.length > 0) throw new Error(sourceViolations.join("\n"));

    const response = await fetchImplementation(repair.tarball, { redirect: "error" });
    if (!response.ok || (response.url && response.url !== repair.tarball)) {
      throw new Error("Runtime repair tarball download failed closed.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error("Runtime repair tarball size is outside the approved bound.");
    }
    integrityImplementation(bytes, repair.integrity);

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-runtime-repair-"));
    const archivePath = join(temporaryDirectory, "package.tgz");
    const extractedPath = join(temporaryDirectory, "package");
    try {
      writeFileSync(archivePath, bytes, { flag: "wx", mode: 0o600 });
      await extractImplementation({
        archivePath,
        destination: extractedPath,
        repair
      });
      const replacementViolations = verifyPackageManifest({
        manifest: readJson(join(extractedPath, "package.json")),
        repair,
        phase: "replacement"
      });
      if (replacementViolations.length > 0) {
        throw new Error(replacementViolations.join("\n"));
      }
      rmSync(target, { recursive: true, force: false });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(extractedPath, target);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  retainImplementation({
    appRoot,
    runtimeRoot,
    runtime: lock.enrollmentWebSocketRuntime
  });

  return { status: "repaired", packageCount: lock.repairs.length };
}

async function main() {
  const lock = readJson(LOCK_PATH);
  const result = await sanitizeRuntimeDependencies({ appRoot: APP_ROOT, lock });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await main();
}
