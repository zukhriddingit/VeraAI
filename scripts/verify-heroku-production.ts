import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface HerokuProductionManifest {
  readonly version?: string;
  readonly app?: string;
  readonly productDomain?: string;
  readonly marketingDomain?: string;
  readonly processes?: {
    readonly web?: {
      readonly dockerfile?: string;
      readonly quantity?: number;
      readonly dynoSize?: string;
      readonly readinessPath?: string;
    };
    readonly worker?: {
      readonly dockerfile?: string;
      readonly quantity?: number;
      readonly dynoSize?: string;
      readonly readinessPath?: string;
    };
  };
  readonly database?: {
    readonly provider?: string;
    readonly plan?: string;
    readonly attachment?: string;
    readonly sameRegion?: boolean;
    readonly storageBytes?: number;
    readonly connectionLimit?: number;
    readonly poolMaxPerProcess?: number;
  };
  readonly billing?: {
    readonly maximumMonthlyUsd?: number;
    readonly automaticUpgrade?: boolean;
  };
  readonly release?: {
    readonly processTypes?: readonly string[];
    readonly sourceRevisionLabel?: string;
    readonly automaticDeploy?: boolean;
  };
  readonly openclaw?: {
    readonly deploymentAction?: string;
    readonly gatewayImageChange?: boolean;
  };
}

function applicationImageJob(workflow: string): string {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s{0,2}app_images:\s*$/u.test(line));
  if (start < 0) return "";
  const indentation = /^\s*/u.exec(lines[start]!)?.[0] ?? "";
  const nextJob = new RegExp(`^${indentation}[a-zA-Z0-9_]+:\\s*$`, "u");
  const relativeEnd = lines.slice(start + 1).findIndex((line) => nextJob.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start, end).join("\n");
}

export function findHerokuProductionViolations(input: {
  readonly manifest: HerokuProductionManifest;
  readonly webDockerfile: string;
  readonly workerDockerfile: string;
  readonly workflow: string;
}): string[] {
  const violations: string[] = [];
  const { manifest } = input;

  if (manifest.version !== "vera-heroku-production.v1") {
    violations.push("Heroku manifest version is invalid.");
  }
  if (manifest.app !== "vera-housing-app") {
    violations.push("Heroku production app identity is invalid.");
  }
  if (
    manifest.productDomain !== "app.verahousing.app" ||
    manifest.marketingDomain !== "verahousing.app"
  ) {
    violations.push("Production product and marketing domains are invalid.");
  }
  if (
    manifest.processes?.web?.dockerfile !== "Dockerfile.web" ||
    manifest.processes.web.quantity !== 1 ||
    manifest.processes.web.dynoSize !== "eco" ||
    manifest.processes.web.readinessPath !== "/api/ready" ||
    manifest.processes?.worker?.dockerfile !== "Dockerfile" ||
    manifest.processes.worker.quantity !== 1 ||
    manifest.processes.worker.dynoSize !== "eco" ||
    manifest.processes.worker.readinessPath !== "/health"
  ) {
    violations.push(
      "Heroku must run exactly one Eco web and one Eco worker with reviewed readiness paths."
    );
  }
  if (
    manifest.database?.provider !== "heroku-postgresql" ||
    manifest.database.plan !== "essential-0" ||
    manifest.database.attachment !== "VERA_GREEN_DATABASE" ||
    manifest.database.sameRegion !== true ||
    manifest.database.storageBytes !== 1_000_000_000 ||
    manifest.database.connectionLimit !== 20 ||
    manifest.database.poolMaxPerProcess !== 3
  ) {
    violations.push("Heroku production database policy is invalid.");
  }
  if (manifest.billing?.maximumMonthlyUsd !== 10 || manifest.billing.automaticUpgrade !== false) {
    violations.push("Heroku production billing must remain capped at $10 without auto-upgrade.");
  }
  if (
    JSON.stringify(manifest.release?.processTypes) !== JSON.stringify(["web", "worker"]) ||
    manifest.release?.sourceRevisionLabel !== "org.opencontainers.image.revision" ||
    manifest.release.automaticDeploy !== false
  ) {
    violations.push("Heroku releases must pair web and worker under operator control.");
  }
  if (
    manifest.openclaw?.deploymentAction !== "none" ||
    manifest.openclaw.gatewayImageChange !== false
  ) {
    violations.push("The Heroku release must not mutate OpenClaw.");
  }
  if (
    !input.webDockerfile.includes("/api/ready") ||
    !/^USER\s+vera\s*$/mu.test(input.webDockerfile)
  ) {
    violations.push("Heroku web image must retain non-root readiness.");
  }
  if (
    !input.workerDockerfile.includes("127.0.0.1:8080/health") ||
    !/^USER\s+vera\s*$/mu.test(input.workerDockerfile)
  ) {
    violations.push("Heroku worker image must retain non-root health checks.");
  }

  const appJob = applicationImageJob(input.workflow);
  if (
    !appJob.includes("Build Heroku web image") ||
    !/^\s*file:\s+Dockerfile\.web\s*$/mu.test(appJob) ||
    !appJob.includes("Build Heroku worker image") ||
    !/^\s*file:\s+Dockerfile\s*$/mu.test(appJob) ||
    (appJob.match(/org\.opencontainers\.image\.revision=/gu) ?? []).length !== 2
  ) {
    violations.push("CI must build the Heroku web and worker images from one source revision.");
  }
  if (/^\s*push:\s+true\s*$/mu.test(appJob)) {
    violations.push("Application-image CI must verify without publishing.");
  }
  if (/openclaw|gateway|remote-extension/iu.test(appJob)) {
    violations.push("Heroku application-image CI must not build OpenClaw or the Gateway.");
  }
  return violations;
}

async function main(): Promise<void> {
  const [manifestText, webDockerfile, workerDockerfile, workflow] = await Promise.all([
    readFile(new URL("../infra/heroku/production-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile.web", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  ]);
  const violations = findHerokuProductionViolations({
    manifest: JSON.parse(manifestText) as HerokuProductionManifest,
    webDockerfile,
    workerDockerfile,
    workflow
  });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Heroku production boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
