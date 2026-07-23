import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const adapter = read("packages/connectors/src/openclaw-browser-execution.ts");
const runner = read("packages/connectors/src/openclaw-cli.ts");
const connectorPackage = read("packages/connectors/package.json");
const worker = read("apps/worker/src/acquisition-worker.ts");
const demo = read("packages/db/src/demo/index.ts");
const routes = [
  "apps/web/app/api/integrations/browser-agent/status/route.ts",
  "apps/web/app/api/integrations/browser-agent/controls/route.ts",
  "apps/web/app/api/integrations/browser-agent/captures/route.ts"
]
  .map(read)
  .join("\n");

const failures: string[] = [];
function requireText(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) failures.push(message);
}
function rejectText(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) failures.push(message);
}

requireText(
  adapter,
  /OPENCLAW_TESTED_VERSION\s*=\s*"2026\.6\.33"/u,
  "OpenClaw must remain pinned to the reviewed patched 2026.6.33 release."
);
rejectText(
  connectorPackage,
  /"openclaw"\s*:/u,
  "OpenClaw must remain outside the connector library; only the server-side worker may ship it."
);
requireText(
  adapter,
  /"browser\.proxy"/u,
  "The adapter must use the native browser.proxy node capability."
);
requireText(
  adapter,
  /path:\s*"\/tabs"/u,
  "The adapter must inspect the current tab through /tabs."
);
requireText(adapter, /path:\s*"\/snapshot"/u, "The adapter must capture through /snapshot.");
requireText(
  adapter,
  /method:\s*"GET",\s*path:\s*"\/tabs"/u,
  "The tab request must remain an exact GET /tabs operation."
);
requireText(
  adapter,
  /method:\s*"GET",\s*path:\s*"\/snapshot"/u,
  "The snapshot request must remain an exact GET /snapshot operation."
);
rejectText(
  adapter,
  /method:\s*"(?:POST|PUT|PATCH|DELETE)"/u,
  "The adapter contains a mutating HTTP proxy method."
);
rejectText(
  adapter,
  /path:\s*"\/(?:navigate|open|click|type|evaluate|cookies?|storage|upload|download)/iu,
  "The current-tab adapter contains a forbidden browser operation."
);
rejectText(worker, /\.navigate\s*\(/u, "The acquisition worker must never navigate.");
rejectText(
  worker,
  /\.(?:send|apply|pay|compose|contact)\s*\(/iu,
  "The acquisition worker contains a forbidden side-effect call."
);
rejectText(
  routes,
  /(?:gatewayToken|OPENCLAW_GATEWAY_TOKEN|cookie|password|authorizationCode)/u,
  "A browser-agent route references secret browser material."
);
rejectText(
  demo,
  /OpenClawBrowserExecutionProvider|OPENCLAW_GATEWAY/u,
  "The deterministic demo must not compose the real OpenClaw provider."
);
requireText(runner, /shell:\s*false/u, "OpenClaw process execution must never use a shell.");

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Browser security boundaries verified.\n");
}
