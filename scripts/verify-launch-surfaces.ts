import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface LaunchSurfaceInput {
  readonly marketing: string;
  readonly demoPage: string;
  readonly demoClient: string;
  readonly demoFixtures?: string;
  readonly allLaunchText: string;
}

const forbiddenDemoRuntime =
  /@vera\/(?:ai|calendar|connectors|db|domain|notifications|policy|scoring)|application-registry|requireVeraSession|better-auth|postgres|drizzle/i;
const liveMarketplaceDomain =
  /(?:zillow\.com|apartments\.com|facebook\.com|craigslist\.org|offcampus\.[a-z0-9.-]+)/i;

export function findLaunchSurfaceViolations(input: LaunchSurfaceInput): string[] {
  const violations: string[] = [];

  if (/vera-production-f19c\.up\.railway\.app/i.test(input.allLaunchText)) {
    violations.push("Obsolete Railway URL is forbidden.");
  }
  if (forbiddenDemoRuntime.test(`${input.demoPage}\n${input.demoClient}`)) {
    violations.push("Public demo must not import application or persistence code.");
  }
  if (/fetch\s*\(|["'`]\/api\//.test(input.demoClient)) {
    violations.push("Public demo must not call an API.");
  }
  if (!/dynamic\s*=\s*["']force-static["']/.test(input.demoPage)) {
    violations.push("Public demo must be forced static.");
  }
  if (input.demoFixtures && liveMarketplaceDomain.test(input.demoFixtures)) {
    violations.push("Public demo fixtures must not retain live marketplace domains.");
  }
  if (!/VERA_DEMO_URL/.test(input.marketing)) {
    violations.push("Marketing must use the canonical demo URL constant.");
  }
  if (!/VERA_BETA_URL/.test(input.marketing)) {
    violations.push("Marketing must use the canonical beta URL constant.");
  }
  if (!/VERA_SIGN_IN_URL/.test(input.marketing)) {
    violations.push("Marketing must use the canonical sign-in URL constant.");
  }

  return violations;
}

function trackedText(directory: string): string {
  if (!existsSync(directory)) return "";
  const parts: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) parts.push(trackedText(path));
    else if ([".css", ".json", ".md", ".ts", ".tsx"].includes(extname(entry))) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join("\n");
}

function run(): void {
  const root = resolve(import.meta.dirname, "..");
  const marketing = trackedText(resolve(root, "apps/marketing"));
  const demoDirectory = resolve(root, "apps/web/app/demo");
  const demoPage = readFileSync(resolve(demoDirectory, "page.tsx"), "utf8");
  const demoClient = readFileSync(resolve(demoDirectory, "public-demo.tsx"), "utf8");
  const demoFixtures = readFileSync(resolve(demoDirectory, "public-demo-fixtures.ts"), "utf8");
  const release = existsSync(resolve(root, "docs/MARKETING_RELEASE.md"))
    ? readFileSync(resolve(root, "docs/MARKETING_RELEASE.md"), "utf8")
    : "";
  const vercel = existsSync(resolve(root, "apps/marketing/vercel.json"))
    ? readFileSync(resolve(root, "apps/marketing/vercel.json"), "utf8")
    : "";
  const violations = findLaunchSurfaceViolations({
    marketing,
    demoPage,
    demoClient,
    demoFixtures,
    allLaunchText: [marketing, trackedText(demoDirectory), release, vercel].join("\n")
  });

  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Launch surface boundaries validated.\n");
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) run();
