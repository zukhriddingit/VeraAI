import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const extensionDirectory = resolve("infra/chrome/vera-openclaw-extension");
const manifestPath = resolve(extensionDirectory, "manifest.json");
const releaseLockPath = resolve(extensionDirectory, "release-lock.json");
const runtimeFiles = [
  "background.js",
  "popup.html",
  "popup.js",
  "readiness-bridge.js",
  "modules/prepared-tab.js",
  "modules/relay-core.js"
] as const;

function fail(message: string): never {
  throw new Error(`Vera OpenClaw extension verification failed: ${message}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText) as Record<string, unknown>;
const releaseLock = JSON.parse(readFileSync(releaseLockPath, "utf8")) as {
  schemaVersion?: unknown;
  upstream?: { version?: unknown; manifestSha256?: unknown };
  vera?: { version?: unknown; manifestSha256?: unknown; runtimeSha256?: unknown };
};
const permissions = manifest.permissions;
const expectedPermissions = ["alarms", "debugger", "storage", "tabGroups", "tabs"];
if (
  !Array.isArray(permissions) ||
  JSON.stringify([...permissions].sort()) !== JSON.stringify(expectedPermissions)
) {
  fail("permissions must remain exactly alarms, debugger, storage, tabGroups, and tabs");
}
if ("host_permissions" in manifest || "optional_host_permissions" in manifest) {
  fail("host permissions are forbidden");
}
if ("web_accessible_resources" in manifest || "externally_connectable" in manifest) {
  fail("extension resources and external messaging must remain private");
}

const contentScripts = manifest.content_scripts;
if (!Array.isArray(contentScripts) || contentScripts.length !== 1) {
  fail("exactly one Vera readiness bridge must be declared");
}
const readinessBridge = contentScripts[0] as Record<string, unknown>;
const allowedMatches = [
  "http://127.0.0.1:3000/*",
  "http://localhost:3000/*",
  "https://vera-ai-housing.vercel.app/*",
  "https://verahousing.app/*",
  "https://www.verahousing.app/*"
];
if (
  !Array.isArray(readinessBridge.matches) ||
  JSON.stringify([...readinessBridge.matches].sort()) !== JSON.stringify(allowedMatches)
) {
  fail("the readiness bridge may run only on reviewed Vera application origins");
}
if (JSON.stringify(readinessBridge.js) !== JSON.stringify(["readiness-bridge.js"])) {
  fail("the content script may load only the sanitized readiness bridge");
}

const runtime = runtimeFiles
  .map((file) => `${file}\n${readFileSync(resolve(extensionDirectory, file), "utf8")}`)
  .join("\n");
const forbidden = [
  /\beval\s*\(/u,
  /\bnew\s+Function\b/u,
  /chrome\.scripting/u,
  /executeScript/u,
  /chrome\.(?:cookies|downloads|history|identity|webRequest)/u,
  /document\.cookie/u,
  /\blocalStorage\b/u,
  /\bsessionStorage\b/u,
  /\bXMLHttpRequest\b/u,
  /\bfetch\s*\(/u,
  /console\.(?:debug|info|log|warn|error)/u
];
for (const pattern of forbidden) {
  if (pattern.test(runtime)) fail(`runtime contains forbidden capability pattern ${pattern}`);
}

const preparedUrl = "https://www.zillow.com/homes/for_rent/";
if (runtime.split(preparedUrl).length !== 2) {
  fail("the fixed prepared-tab bootstrap URL must appear exactly once");
}
for (const required of [
  "openclaw-extension-relay",
  "openclaw-extension-token.",
  "browser_extension_conflict",
  "Prepare Vera Search tab",
  "about:blank"
]) {
  if (!runtime.includes(required)) fail(`runtime is missing required boundary ${required}`);
}

const manifestSha256 = sha256(manifestText);
const runtimeSha256 = sha256(runtime);
if (
  releaseLock.schemaVersion !== "1" ||
  releaseLock.upstream?.version !== "2.0.0" ||
  releaseLock.upstream.manifestSha256 !==
    "90dc60974ff7b68b4b487cc7040268d4ce458224beeb8bb715e56f59d23bec23"
) {
  fail("the reviewed official OpenClaw 2.0.0 source identity is not pinned");
}
if (
  releaseLock.vera?.version !== manifest.version ||
  releaseLock.vera.manifestSha256 !== manifestSha256 ||
  releaseLock.vera.runtimeSha256 !== runtimeSha256
) {
  fail("the Vera extension release lock does not match the reviewed runtime");
}
process.stdout.write(
  `${JSON.stringify(
    {
      status: "passed",
      extension: "Vera OpenClaw",
      version: manifest.version,
      manifestSha256,
      runtimeSha256,
      permissions: expectedPermissions,
      preparedUrl,
      readinessBridgeOrigins: allowedMatches.length
    },
    null,
    2
  )}\n`
);
