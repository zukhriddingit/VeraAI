import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const NODE_IMAGE =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";
const OPENCLAW_VERSION = "2026.6.33";

interface WorkerPackageLike {
  readonly dependencies?: Readonly<Record<string, string>>;
}

export function findWorkerImageViolations(input: {
  readonly dockerfile: string;
  readonly workerBuild?: string;
  readonly workerPackage: WorkerPackageLike;
  readonly lockfile: string;
  readonly workspace?: string;
}): string[] {
  const violations: string[] = [];
  const fromLines = input.dockerfile.match(/^FROM\s+\S+/gmu) ?? [];

  if (fromLines.length !== 2 || fromLines.some((line) => line !== `FROM ${NODE_IMAGE}`)) {
    violations.push("Every worker stage must use the exact immutable Node image digest.");
  }
  if (/\bnpm\s+(?:install|i)\s+(?:--global|-g)\b/iu.test(input.dockerfile)) {
    violations.push("The runtime image must not perform a global OpenClaw installation.");
  }
  if (/(?:^|[/:@])latest(?:\s|$)/imu.test(input.dockerfile)) {
    violations.push("The worker image must not use a mutable latest reference.");
  }
  if (!/^USER\s+vera\s*$/mu.test(input.dockerfile)) {
    violations.push("The worker runtime must use the non-root vera user.");
  }
  if (
    !/^HEALTHCHECK\b/mu.test(input.dockerfile) ||
    !/127\.0\.0\.1:8080\/health/u.test(input.dockerfile)
  ) {
    violations.push("The worker image must retain its bounded local healthcheck.");
  }
  if (
    !input.dockerfile.includes(
      "VERA_OPENCLAW_EXECUTABLE=/workspace/apps/worker/node_modules/.bin/openclaw"
    )
  ) {
    violations.push("The worker must execute the lockfile-installed OpenClaw binary.");
  }
  if (input.workerPackage.dependencies?.openclaw !== OPENCLAW_VERSION) {
    violations.push(`@vera/worker must depend on exact openclaw ${OPENCLAW_VERSION}.`);
  }
  if (input.workerPackage.dependencies?.pg !== "8.22.0") {
    violations.push(
      "@vera/worker must ship the exact pg runtime externalized from its ESM bundle."
    );
  }
  if (input.workerPackage.dependencies?.sharp !== "0.35.3") {
    violations.push(
      "@vera/worker must ship the exact sharp runtime externalized from its ESM bundle."
    );
  }
  if (
    !new RegExp(`\\bopenclaw@${OPENCLAW_VERSION.replaceAll(".", "\\.")}\\b`, "u").test(
      input.lockfile
    )
  ) {
    violations.push(`The lockfile must resolve exact openclaw ${OPENCLAW_VERSION}.`);
  }
  if (input.workspace !== undefined && !/^\s{2}openclaw:\s+false\s*$/mu.test(input.workspace)) {
    violations.push("OpenClaw install-time lifecycle scripts must be explicitly disabled.");
  }
  if (
    !/pnpm --filter @vera\/worker deploy --legacy --prod \/opt\/vera-worker/u.test(input.dockerfile)
  ) {
    violations.push(
      "The runtime image must be assembled from a production-only worker deployment."
    );
  }
  if (
    !input.dockerfile.includes(
      "find /opt/vera-worker/node_modules -type l -lname '*better-sqlite3*' -delete"
    ) ||
    !input.dockerfile.includes("rm -rf /opt/vera-worker/node_modules/.pnpm/better-sqlite3@12.11.1")
  ) {
    violations.push("The hosted worker image must remove demo-only SQLite peer artifacts.");
  }
  if (/COPY --from=build[^\n]*\/workspace\/node_modules/u.test(input.dockerfile)) {
    violations.push("The runtime image must not copy the build workspace dependency tree.");
  }
  if (
    input.workerBuild !== undefined &&
    !/external:\s*\["better-sqlite3",\s*"pg",\s*"pino",\s*"sharp"\]/u.test(input.workerBuild)
  ) {
    violations.push(
      "The ESM worker bundle must keep native and CommonJS runtime packages external."
    );
  }
  if (
    input.workerBuild !== undefined &&
    !input.workerBuild.includes("__veraCreateRequire(import.meta.url)")
  ) {
    violations.push(
      "The ESM worker bundle must provide Node createRequire for bundled CommonJS libraries."
    );
  }

  return violations;
}

async function main(): Promise<void> {
  const [dockerfile, workerBuild, workerPackageText, lockfile, workspace] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../apps/worker/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../apps/worker/package.json", import.meta.url), "utf8"),
    readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
    readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8")
  ]);
  const violations = findWorkerImageViolations({
    dockerfile,
    workerBuild,
    workerPackage: JSON.parse(workerPackageText) as WorkerPackageLike,
    lockfile,
    workspace
  });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Worker image supply-chain boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
