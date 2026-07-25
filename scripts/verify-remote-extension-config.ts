import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";

export const REMOTE_EXTENSION_OPENCLAW_VERSION = "2026.7.1";
export const REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE =
  "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c";
export const REMOTE_EXTENSION_GATEWAY_IMAGE =
  /^ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:[a-f0-9]{64}$/u;
export const REMOTE_EXTENSION_SOURCE_COMMIT = /^[a-f0-9]{40}$/u;
export const REMOTE_EXTENSION_TOOL = "vera_read_shared_tab_snapshot";

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, ...path: string[]): JsonObject | null {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return null;
    current = (current as JsonObject)[key];
  }
  return typeof current === "object" && current !== null && !Array.isArray(current)
    ? (current as JsonObject)
    : null;
}

function stringArrayAt(value: unknown, ...path: string[]): string[] | null {
  const parent = objectAt(value, ...path.slice(0, -1));
  const found = parent?.[path.at(-1) ?? ""];
  return Array.isArray(found) && found.every((entry) => typeof entry === "string") ? found : null;
}

function exact(values: readonly string[] | null, expected: readonly string[]): boolean {
  return (
    values !== null &&
    values.length === expected.length &&
    values.every((value, index) => value === expected[index])
  );
}

export function findRemoteExtensionConfigViolations(input: {
  readonly config: unknown;
  readonly pluginManifest: unknown;
  readonly pluginPackage: unknown;
  readonly imageManifest: unknown;
  readonly pluginSource: string;
  readonly auditDeviceSource: string;
  readonly dockerfile: string;
}): string[] {
  const violations: string[] = [];
  const {
    config,
    pluginManifest,
    pluginPackage,
    imageManifest,
    pluginSource,
    auditDeviceSource,
    dockerfile
  } = input;

  if (objectAt(config, "meta")?.lastTouchedVersion !== REMOTE_EXTENSION_OPENCLAW_VERSION) {
    violations.push("Remote extension config must declare OpenClaw 2026.7.1.");
  }
  if (
    objectAt(imageManifest)?.openclawVersion !== REMOTE_EXTENSION_OPENCLAW_VERSION ||
    objectAt(imageManifest)?.baseImage !== REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE ||
    !(
      (objectAt(imageManifest)?.publicationState === "pending" &&
        objectAt(imageManifest)?.image === null &&
        objectAt(imageManifest)?.sourceCommit === undefined) ||
      (objectAt(imageManifest)?.publicationState === "published" &&
        typeof objectAt(imageManifest)?.image === "string" &&
        REMOTE_EXTENSION_GATEWAY_IMAGE.test(String(objectAt(imageManifest)?.image)) &&
        !String(objectAt(imageManifest)?.image).endsWith(`:${"0".repeat(64)}`) &&
        typeof objectAt(imageManifest)?.sourceCommit === "string" &&
        REMOTE_EXTENSION_SOURCE_COMMIT.test(String(objectAt(imageManifest)?.sourceCommit)))
    ) ||
    objectAt(imageManifest)?.releaseProfile !== "founder_browser_experimental" ||
    objectAt(imageManifest)?.deployableBeforeLiveProxyAcceptance !== false
  ) {
    violations.push(
      "Remote extension image manifest must pin the reviewed release and stay blocked."
    );
  }
  if (
    !dockerfile.includes(`FROM ${REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE}`) ||
    !dockerfile.includes("ARG VERA_SOURCE_COMMIT") ||
    !dockerfile.includes('org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}"') ||
    !dockerfile.includes("--chmod=0600") ||
    !dockerfile.includes("--chmod=0500") ||
    !dockerfile.includes("seed-security-audit-device.mjs") ||
    !dockerfile.includes("OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json") ||
    !dockerfile.includes("OPENCLAW_STATE_DIR=/data/.openclaw") ||
    !dockerfile.includes("USER node")
  ) {
    violations.push(
      "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
    );
  }
  if (
    !auditDeviceSource.includes('Object.freeze(["operator.read"])') ||
    auditDeviceSource.includes("operator.write") ||
    auditDeviceSource.includes("operator.admin") ||
    !auditDeviceSource.includes("mode: 0o600") ||
    !auditDeviceSource.includes('operation === "remove"') ||
    /token\s*[:,)]\s*["'`]?/u.test(
      auditDeviceSource.match(/process\.stdout\.write\([\s\S]*$/u)?.[0] ?? ""
    )
  ) {
    violations.push(
      "Security-audit device bootstrap must be read-only, private, removable, and token-redacting."
    );
  }

  const browser = objectAt(config, "browser");
  const chrome = objectAt(browser, "profiles", "chrome");
  if (
    browser?.enabled !== true ||
    browser.evaluateEnabled !== false ||
    browser.defaultProfile !== "chrome" ||
    chrome?.driver !== "extension"
  ) {
    violations.push(
      "Remote browser must use one fixed extension profile with evaluation disabled."
    );
  }
  if (Object.keys(objectAt(browser, "profiles") ?? {}).join(",") !== "chrome") {
    violations.push("Remote extension config must declare only the chrome profile.");
  }

  const plugins = objectAt(config, "plugins");
  if (
    plugins?.enabled !== true ||
    plugins.bundledDiscovery !== "allowlist" ||
    !exact(stringArrayAt(plugins, "allow"), ["browser", "vera-read-shared-tab"]) ||
    !exact(stringArrayAt(plugins, "load", "paths"), ["/opt/vera/plugins/vera-read-shared-tab"]) ||
    objectAt(plugins, "entries", "browser")?.enabled !== true ||
    objectAt(plugins, "entries", "vera-read-shared-tab")?.enabled !== true
  ) {
    violations.push("Only the browser and Vera snapshot plugins may be enabled.");
  }
  const browserHooks = objectAt(plugins, "entries", "browser", "hooks");
  if (
    browserHooks?.allowPromptInjection !== false ||
    browserHooks.allowConversationAccess !== false
  ) {
    violations.push("The browser plugin must not receive prompt or conversation hooks.");
  }

  const tools = objectAt(config, "tools");
  if (
    !exact(stringArrayAt(tools, "allow"), [REMOTE_EXTENSION_TOOL]) ||
    !stringArrayAt(tools, "deny")?.includes("browser") ||
    !stringArrayAt(tools, "deny")?.includes("gateway") ||
    !stringArrayAt(tools, "deny")?.includes("exec") ||
    !stringArrayAt(tools, "deny")?.includes("message")
  ) {
    violations.push("The model may receive only Vera's snapshot tool.");
  }

  const gateway = objectAt(config, "gateway");
  if (
    gateway?.mode !== "local" ||
    gateway.bind !== "lan" ||
    objectAt(gateway, "controlUi")?.enabled !== false ||
    objectAt(gateway, "terminal")?.enabled !== false
  ) {
    violations.push("Control UI and terminal must remain disabled on the dedicated Gateway.");
  }
  if (
    objectAt(gateway, "auth")?.mode !== "token" ||
    objectAt(gateway, "auth")?.token !== "${OPENCLAW_GATEWAY_TOKEN}"
  ) {
    violations.push("The dedicated Gateway must use the server-only token placeholder.");
  }
  if (
    objectAt(gateway, "nodes", "browser")?.mode !== "off" ||
    !exact(stringArrayAt(gateway, "nodes", "allowCommands"), []) ||
    !stringArrayAt(gateway, "nodes", "denyCommands")?.includes("browser.proxy")
  ) {
    violations.push("Remote extension topology must not route through an OpenClaw node.");
  }
  if (
    objectAt(gateway, "http", "endpoints", "chatCompletions")?.enabled !== false ||
    objectAt(gateway, "http", "endpoints", "responses")?.enabled !== false
  ) {
    violations.push("Gateway model HTTP endpoints must remain disabled.");
  }

  if (
    objectAt(pluginManifest)?.id !== "vera-read-shared-tab" ||
    !exact(stringArrayAt(pluginManifest, "contracts", "tools"), [REMOTE_EXTENSION_TOOL]) ||
    objectAt(pluginManifest, "configSchema")?.additionalProperties !== false
  ) {
    violations.push("Snapshot plugin manifest must expose exactly one closed-input tool.");
  }
  if (
    objectAt(pluginPackage, "peerDependencies")?.openclaw !== REMOTE_EXTENSION_OPENCLAW_VERSION ||
    !exact(stringArrayAt(pluginPackage, "openclaw", "extensions"), ["./index.mjs"])
  ) {
    violations.push("Snapshot plugin package must target only OpenClaw 2026.7.1.");
  }

  if (!/name:\s*"vera_read_shared_tab_snapshot"/u.test(pluginSource)) {
    violations.push("Snapshot plugin tool name is missing.");
  }
  if (!/additionalProperties:\s*false/u.test(pluginSource)) {
    violations.push("Snapshot plugin input must reject arbitrary fields.");
  }
  if (!/method:\s*"GET"/u.test(pluginSource)) {
    violations.push("Snapshot plugin must issue explicit GET requests.");
  }
  if (/method:\s*"(?:POST|PUT|PATCH|DELETE)"/u.test(pluginSource)) {
    violations.push("Snapshot plugin contains a mutating browser-control method.");
  }
  if (
    /\/(?:navigate|open|focus|close|act|click|type|fill|press|drag|upload|download|dialog|pdf|screenshot)(?:[/?`"'])/iu.test(
      pluginSource
    )
  ) {
    violations.push("Snapshot plugin contains a forbidden browser-control route.");
  }
  if (
    !/`\/tabs\?profile=\$\{BROWSER_PROFILE\}`/u.test(pluginSource) ||
    !/`\/snapshot\?\$\{query\.toString\(\)\}`/u.test(pluginSource)
  ) {
    violations.push("Snapshot plugin must use only the fixed tabs and snapshot routes.");
  }
  if (/MARITIME_(?:API_KEY|OPENCLAW_AGENT_ID)/u.test(pluginSource)) {
    violations.push("Snapshot plugin must not reuse the RentCast live-search Maritime identity.");
  }

  return violations;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function verifyRemoteExtensionConfig(root = resolve(import.meta.dirname, "..")): void {
  const directory = resolve(root, "infra/maritime/openclaw");
  const violations = findRemoteExtensionConfigViolations({
    config: JSON5.parse(
      readFileSync(resolve(directory, "remote-extension.openclaw.json5"), "utf8")
    ),
    pluginManifest: readJson(resolve(directory, "vera-read-shared-tab/openclaw.plugin.json")),
    pluginPackage: readJson(resolve(directory, "vera-read-shared-tab/package.json")),
    imageManifest: readJson(resolve(directory, "remote-extension-image.json")),
    pluginSource: readFileSync(resolve(directory, "vera-read-shared-tab/index.mjs"), "utf8"),
    auditDeviceSource: readFileSync(resolve(directory, "seed-security-audit-device.mjs"), "utf8"),
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8")
  });
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyRemoteExtensionConfig();
  process.stdout.write("Remote extension configuration boundaries verified.\n");
}
