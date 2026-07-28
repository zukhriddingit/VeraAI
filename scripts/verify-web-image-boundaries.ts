import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const NODE_IMAGE =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";

export function findWebImageBoundaryViolations(input: {
  readonly dockerfile: string;
  readonly railwayConfig: string;
}): string[] {
  const violations: string[] = [];
  const fromLines = input.dockerfile.match(/^FROM\s+\S+/gmu) ?? [];

  if (fromLines.length !== 2 || fromLines.some((line) => line !== `FROM ${NODE_IMAGE}`)) {
    violations.push("Every web-image stage must use the exact immutable Node image digest.");
  }
  if (!input.dockerfile.includes("corepack prepare pnpm@11.14.0 --activate")) {
    violations.push("The web image must use exact pnpm 11.14.0.");
  }
  if (!input.dockerfile.includes("pnpm install --frozen-lockfile")) {
    violations.push("The web image must install only from the frozen lockfile.");
  }
  if (
    !input.dockerfile.includes("pnpm --filter @vera/web build") ||
    !input.dockerfile.includes("pnpm --filter @vera/web deploy --legacy --prod /opt/vera-web")
  ) {
    violations.push("The image must build and package only the production web workspace.");
  }
  if (/@vera\/worker|openclaw|demo-start|VERA_DEMO_MODE/iu.test(input.dockerfile)) {
    violations.push("The Railway web image must not build or start worker, browser, or demo code.");
  }
  if (/COPY\s+[^\n]*\.env/iu.test(input.dockerfile)) {
    violations.push("The web image must not copy environment files.");
  }
  if (!/^USER\s+vera\s*$/mu.test(input.dockerfile)) {
    violations.push("The web runtime must use the non-root vera user.");
  }
  if (!input.dockerfile.includes("/api/ready") || !input.dockerfile.includes("process.env.PORT")) {
    violations.push("The web image must check readiness on its injected runtime port.");
  }
  if (
    !input.dockerfile.includes(
      'CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]'
    )
  ) {
    violations.push("The web image must start only the hosted Next.js process.");
  }

  if (!/^\s*builder\s*=\s*"DOCKERFILE"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must use the Dockerfile builder.");
  }
  if (!/^\s*dockerfilePath\s*=\s*"Dockerfile\.web"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must select Dockerfile.web.");
  }
  if (/^\s*buildCommand\s*=/mu.test(input.railwayConfig)) {
    violations.push("Railway must not override the Dockerfile build command.");
  }
  if (
    !/^\s*startCommand\s*=\s*"node node_modules\/next\/dist\/bin\/next start --hostname 0\.0\.0\.0"\s*$/mu.test(
      input.railwayConfig
    ) ||
    /worker|openclaw|demo/iu.test(input.railwayConfig)
  ) {
    violations.push("Railway must start only the hosted Next.js process.");
  }
  if (!/^\s*healthcheckPath\s*=\s*"\/api\/ready"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must retain /api/ready as the release health gate.");
  }

  return violations;
}

async function main(): Promise<void> {
  const [dockerfile, railwayConfig] = await Promise.all([
    readFile(new URL("../Dockerfile.web", import.meta.url), "utf8"),
    readFile(new URL("../railway.toml", import.meta.url), "utf8")
  ]);
  const violations = findWebImageBoundaryViolations({ dockerfile, railwayConfig });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Railway web image boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
