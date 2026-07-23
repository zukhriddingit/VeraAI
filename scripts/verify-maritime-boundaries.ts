import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const failures: string[] = [];

function requireText(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) failures.push(message);
}

function rejectText(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) failures.push(message);
}

function sourceFiles(directory: string): readonly string[] {
  const absolute = resolve(root, directory);
  const result: string[] = [];
  for (const name of readdirSync(absolute)) {
    if (["node_modules", ".next", "dist"].includes(name)) continue;
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) result.push(...sourceFiles(path.slice(root.length + 1)));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(name))) result.push(path);
  }
  return result;
}

const connectorsPackage = read("packages/connectors/package.json");
const notificationsPackage = read("packages/notifications/package.json");
const runtimeSources = ["apps", "packages", "scripts"]
  .flatMap(sourceFiles)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const clientSources = sourceFiles("apps/web/app")
  .filter((path) => /\.tsx$/u.test(path))
  .map((path) => readFileSync(path, "utf8"))
  .filter((value) => /^\s*["']use client["'];/u.test(value))
  .join("\n");

requireText(
  connectorsPackage,
  /"maritime-sdk"\s*:\s*"0\.5\.0"/u,
  "The production Maritime SDK must remain pinned to 0.5.0."
);
requireText(
  notificationsPackage,
  /"web-push"\s*:\s*"3\.6\.7"/u,
  "The Web Push provider must remain pinned to 3.6.7."
);
rejectText(
  runtimeSources,
  /(?:spawn|exec|execFile)\s*\([^\n]*["'`]maritime/u,
  "Application runtime code must not spawn the Maritime CLI."
);
rejectText(
  clientSources,
  /MARITIME_API_KEY|MARITIME_TOKEN|VERA_VAPID_PRIVATE_KEY|OPENCLAW_GATEWAY_TOKEN/u,
  "A client component references a server-only orchestration secret."
);

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Maritime execution boundaries verified.\n");
}
