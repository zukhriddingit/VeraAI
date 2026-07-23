import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const dockerfile = read("Dockerfile");
const packageJson = JSON.parse(read("package.json"));
const connectorPackage = JSON.parse(read("packages/connectors/package.json"));
const environment = read("infra/maritime/ENVIRONMENT.md");
const openclaw = read("infra/maritime/OPENCLAW.md");
const runbook = read("infra/maritime/README.md");
const combined = [dockerfile, environment, openclaw, runbook].join("\n");
const failures = [];
const runTypeScriptGate = (label, script, args = []) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) failures.push(`${label} failed.`);
};
const requireText = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};
const rejectText = (value, pattern, message) => {
  if (pattern.test(value)) failures.push(message);
};

requireText(
  dockerfile,
  /FROM node:24\.13\.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f/u,
  "Worker image must pin the reviewed Node 24.13.0 digest."
);
requireText(dockerfile, /USER vera/u, "Worker image must run as a non-root user.");
requireText(dockerfile, /\/health/u, "Worker image must configure liveness.");
requireText(
  openclaw,
  /ghcr\.io\/openclaw\/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee/u,
  "Gateway runbook must pin the reviewed OpenClaw image digest."
);
requireText(
  runbook,
  /maritime deploy vera-worker --source docker/u,
  "Worker deployment command is missing."
);
requireText(
  runbook,
  /maritime triggers list vera-worker/u,
  "Trigger validation command is missing."
);
for (const name of [
  "DATABASE_URL",
  "MARITIME_API_KEY",
  "VERA_CREDENTIAL_KEYS_JSON",
  "OPENCLAW_GATEWAY_TOKEN"
]) {
  requireText(
    environment,
    new RegExp(`\\b${name}\\b`, "u"),
    `Environment manifest is missing ${name}.`
  );
}
if (connectorPackage.dependencies?.["maritime-sdk"] !== "0.5.0")
  failures.push("maritime-sdk must remain pinned to 0.5.0.");
if (packageJson.scripts?.["maritime:validate"] !== "node infra/maritime/validate.mjs")
  failures.push("Root maritime:validate script is missing.");
rejectText(
  combined,
  /ghcr\.io\/openclaw\/openclaw:(?:latest|2026\.5\.28)/u,
  "Deployment assets cannot use latest or the vulnerable historical OpenClaw image."
);
rejectText(
  combined,
  /(?:MARITIME_API_KEY|OPENCLAW_GATEWAY_TOKEN|VERA_VAPID_PRIVATE_KEY)\s*=\s*\S+/u,
  "Deployment documentation cannot contain secret values."
);
rejectText(
  combined,
  /messages\.send|drafts\.send|gmail\.modify/iu,
  "Deployment assets cannot introduce Gmail send or modify capability."
);

runTypeScriptGate("Worker image boundary validation", "scripts/verify-worker-image-boundaries.ts");
runTypeScriptGate("OpenClaw configuration validation", "scripts/verify-openclaw-config.ts");
runTypeScriptGate(
  "Release deployment documentation validation",
  "scripts/verify-release-documentation.ts"
);

const releaseManifestPath = process.env.VERA_RELEASE_MANIFEST_PATH?.trim();
if (releaseManifestPath) {
  runTypeScriptGate("Immutable release evidence validation", "scripts/verify-release-manifest.ts", [
    releaseManifestPath
  ]);
} else {
  process.stdout.write(
    "live release evidence not supplied; local validation does not establish deploy readiness.\n"
  );
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    releaseManifestPath
      ? "Maritime local assets and supplied immutable release evidence validated without network access; live inventory and staging evidence are still required.\n"
      : "Maritime local assets validated without network access; deployment readiness was not established.\n"
  );
}
