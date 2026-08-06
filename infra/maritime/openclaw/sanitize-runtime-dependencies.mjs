import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
  "cgr.dev/chainguard/node@sha256:d8d2883b26d4fde4e524d0068cd78abbb23c7c2113a22e67a02cc73a9182552d";
const CHAINGUARD_AMD64 =
  "cgr.dev/chainguard/node@sha256:942c2eee772885f64808bf0fed5e5f842eafe4d6fe7f602b7dba0f26b6eb1b22";
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
  lock,
  fetchImplementation = fetch,
  extractImplementation = extractTarball,
  integrityImplementation = verifyIntegrity
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
