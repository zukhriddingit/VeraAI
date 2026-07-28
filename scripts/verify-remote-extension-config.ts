import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";

export const REMOTE_EXTENSION_OPENCLAW_VERSION = "2026.7.1";
export const REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE =
  "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c";
export const REMOTE_EXTENSION_RUNTIME_BASE_IMAGE =
  "cgr.dev/chainguard/node@sha256:454b9dd79f2ce42a1e275b5d91a3c0287ed0c5ecb356bb90f3470752a4519f09";
export const REMOTE_EXTENSION_PUBLISHED_RUNTIME_BASE_IMAGE =
  "cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f";
export const REMOTE_EXTENSION_RELEASE_INDEX =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec";
export const REMOTE_EXTENSION_RUNTIME_MANIFEST =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8";
export const REMOTE_EXTENSION_SOURCE_COMMIT = "01bc0adc02808dbaf01089d1464ee8db5fe90593";
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

function exactObjectKeys(value: JsonObject | null, expected: readonly string[]): boolean {
  if (value === null) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
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
  readonly supervisorSource: string;
  readonly diagnosticSource: string;
  readonly routeFilterSource: string;
}): string[] {
  const violations: string[] = [];
  const {
    config,
    pluginManifest,
    pluginPackage,
    imageManifest,
    pluginSource,
    auditDeviceSource,
    dockerfile,
    supervisorSource,
    diagnosticSource,
    routeFilterSource
  } = input;

  if (objectAt(config, "meta")?.lastTouchedVersion !== REMOTE_EXTENSION_OPENCLAW_VERSION) {
    violations.push("Remote extension config must declare OpenClaw 2026.7.1.");
  }
  if (
    !exactObjectKeys(objectAt(imageManifest), [
      "schemaVersion",
      "openclawVersion",
      "baseImage",
      "runtimeBaseImage",
      "runtimeLock",
      "publicationState",
      "releaseIndex",
      "runtimeManifest",
      "sourceCommit",
      "runtimeSelectionState",
      "releaseProfile",
      "synthetic",
      "deployableBeforeLiveProxyAcceptance"
    ]) ||
    objectAt(imageManifest)?.schemaVersion !== "2" ||
    objectAt(imageManifest)?.openclawVersion !== REMOTE_EXTENSION_OPENCLAW_VERSION ||
    objectAt(imageManifest)?.baseImage !== REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE ||
    objectAt(imageManifest)?.runtimeBaseImage !== REMOTE_EXTENSION_PUBLISHED_RUNTIME_BASE_IMAGE ||
    objectAt(imageManifest)?.runtimeLock !==
      "infra/maritime/openclaw/remote-extension-runtime-lock.json" ||
    objectAt(imageManifest)?.publicationState !== "published" ||
    objectAt(imageManifest)?.releaseIndex !== REMOTE_EXTENSION_RELEASE_INDEX ||
    objectAt(imageManifest)?.runtimeManifest !== REMOTE_EXTENSION_RUNTIME_MANIFEST ||
    objectAt(imageManifest)?.releaseIndex === objectAt(imageManifest)?.runtimeManifest ||
    objectAt(imageManifest)?.sourceCommit !== REMOTE_EXTENSION_SOURCE_COMMIT ||
    objectAt(imageManifest)?.runtimeSelectionState !== "diagnostic_pending" ||
    objectAt(imageManifest)?.releaseProfile !== "founder_browser_experimental" ||
    objectAt(imageManifest)?.synthetic !== false ||
    objectAt(imageManifest)?.deployableBeforeLiveProxyAcceptance !== false
  ) {
    violations.push(
      "Remote extension image manifest must pin the reviewed release and stay blocked."
    );
  }
  if (
    !dockerfile.includes(`FROM ${REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE} AS openclaw-runtime`) ||
    !dockerfile.includes(`FROM ${REMOTE_EXTENSION_RUNTIME_BASE_IMAGE} AS final`) ||
    !dockerfile.includes("ARG VERA_SOURCE_COMMIT") ||
    !dockerfile.includes('org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}"') ||
    !dockerfile.includes("--chmod=0600") ||
    !dockerfile.includes("--chmod=0500") ||
    !dockerfile.includes("seed-security-audit-device.mjs") ||
    !dockerfile.includes("--chmod=0555") ||
    !dockerfile.includes("remote-extension-supervisor.mjs") ||
    !dockerfile.includes("remote-extension-route-filter.mjs") ||
    !dockerfile.includes("OPENCLAW_CONFIG_PATH=/opt/vera/config/openclaw.json") ||
    !dockerfile.includes("OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1") ||
    !dockerfile.includes("OPENCLAW_STATE_DIR=/data/.openclaw") ||
    !dockerfile.includes("EXPOSE 18789") ||
    !dockerfile.includes("USER 1000:1000") ||
    !dockerfile.includes(
      'ENTRYPOINT ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]'
    )
  ) {
    violations.push(
      "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
    );
  }
  if (
    !dockerfile.includes("USER 0:0\nWORKDIR /usr/local/bin\nWORKDIR /app") ||
    !dockerfile.includes("ENV PATH=/usr/bin") ||
    !dockerfile.includes("USER 1000:1000")
  ) {
    violations.push(
      "Hardened Gateway image must preserve the provider-compatible filesystem and constrained runtime."
    );
  }
  if (
    [
      "fs.rmSync('/sbin',{force:true}); ",
      "fs.rmSync('/usr/sbin',{force:true}); ",
      "fs.mkdirSync('/usr/sbin',{mode:0o755}); ",
      "fs.chownSync('/usr/sbin',0,0); ",
      "fs.chmodSync('/usr/sbin',0o755); ",
      "fs.symlinkSync('usr/sbin','/sbin'); "
    ].some((operation) => !dockerfile.includes(operation)) ||
    /(?:COPY|ADD)[^\n]*(?:\/sbin|\/usr\/sbin)/iu.test(dockerfile) ||
    dockerfile.includes("maritime-init")
  ) {
    violations.push(
      "Hardened Gateway image must preserve Maritime's empty provider-init filesystem boundary."
    );
  }
  if (
    !supervisorSource.includes('const STATE_DIRECTORY = "/data/.openclaw"') ||
    !supervisorSource.includes(
      'const ROUTE_FILTER = "/opt/vera/bin/remote-extension-route-filter.mjs"'
    ) ||
    !supervisorSource.includes(
      'Object.freeze([ROUTE_FILTER, "node", "openclaw.mjs", "gateway"])'
    ) ||
    !supervisorSource.includes("uid !== 1000 || gid !== 1000") ||
    !supervisorSource.includes("if (entryStat.isSymbolicLink()) {") ||
    !supervisorSource.includes("chmodSync(directory, 0o700)") ||
    !supervisorSource.includes("chmodSync(file, 0o600)") ||
    !supervisorSource.includes("process.umask(0o077)") ||
    !supervisorSource.includes("processImplementation.execPath") ||
    !supervisorSource.includes("GATEWAY_ARGUMENTS") ||
    supervisorSource.includes("eval(") ||
    /\bexec(?:File)?\s*\(/u.test(supervisorSource) ||
    supervisorSource.includes("shell: true") ||
    supervisorSource.includes("process.argv.slice")
  ) {
    violations.push(
      "Gateway supervisor must constrain state repair and spawn only the fixed route-filter child."
    );
  }
  if (
    !supervisorSource.includes(
      'EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME = "OPENCLAW_EXTENSION_PAIRING_SEED"'
    ) ||
    !supervisorSource.includes(
      'EXTENSION_PAIRING_SECRET_FILENAME = "browser-extension-relay.secret"'
    ) ||
    !supervisorSource.includes("const EXTENSION_PAIRING_SEED_PATTERN = /^[0-9a-f]{64}$/u;") ||
    !supervisorSource.includes("constants.O_EXCL") ||
    (supervisorSource.match(/constants\.O_NOFOLLOW/gu)?.length ?? 0) !== 2 ||
    !supervisorSource.includes("fchmodSync(descriptor, 0o600)") ||
    !supervisorSource.includes("timingSafeEqual(leftBytes, rightBytes)") ||
    !supervisorSource.includes(
      "delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];"
    ) ||
    !supervisorSource.includes("const childEnvironment = { ...processImplementation.env };") ||
    !supervisorSource.includes(
      "delete childEnvironment[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];"
    ) ||
    !supervisorSource.includes(
      "pairingInstallerImplementation({\n      stateDirectory: STATE_DIRECTORY,\n      seed: pairingSeed\n    });"
    ) ||
    !supervisorSource.includes("pairingSeed = undefined;") ||
    !supervisorSource.includes("env: childEnvironment") ||
    /(?:console\.(?:log|error|warn)|process\.(?:stdout|stderr)\.write)\s*\([\s\S]{0,200}\bpairingSeed\b/iu.test(
      supervisorSource
    )
  ) {
    violations.push(
      "Gateway supervisor must atomically bootstrap and isolate the extension pairing credential."
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
  if (gateway?.mode !== "local" || gateway.port !== 18_790 || gateway.bind !== "loopback") {
    violations.push("The internal OpenClaw Gateway must remain loopback-only on port 18790.");
  }
  if (
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
  if (!pluginSource.includes('const BROWSER_CONTROL_ORIGIN = "http://127.0.0.1:18792"')) {
    violations.push(
      "Snapshot plugin must use the browser-control port derived from internal Gateway port 18790."
    );
  }
  if (/MARITIME_(?:API_KEY|OPENCLAW_AGENT_ID)/u.test(pluginSource)) {
    violations.push("Snapshot plugin must not reuse the RentCast live-search Maritime identity.");
  }

  if (
    /console\.log\(\s*(?:req|request)\.headers\s*\)/u.test(diagnosticSource) ||
    /(?:console\.log|process\.stdout\.write|writeObservation)\s*\([\s\S]{0,200}(?:req|request)\.headers\[['"]sec-websocket-protocol['"]\]/iu.test(
      diagnosticSource
    ) ||
    /(?:console\.log|process\.stdout\.write|writeObservation)\s*\([\s\S]{0,200}(?:parsed\.search|(?:req|request)\.url)/u.test(
      diagnosticSource
    ) ||
    !diagnosticSource.includes("maxPayload: options.maxPayloadBytes") ||
    !diagnosticSource.includes("options.maxPayloadBytes > 65_536") ||
    /allowedOriginSchemes\.includes\(\s*["']\*["']\s*\)/u.test(diagnosticSource) ||
    !diagnosticSource.includes("parsed.pathname === options.acceptedPath") ||
    !diagnosticSource.includes('parsed.search === ""')
  ) {
    violations.push(
      "WebSocket diagnostic must enforce an exact path, closed Origins, bounded payloads, and secret-safe observations."
    );
  }

  if (
    !routeFilterSource.includes('const EXTENSION_ROUTE = "/browser/extension"') ||
    !routeFilterSource.includes('const PUBLIC_GATEWAY_HOST = "0.0.0.0"') ||
    !routeFilterSource.includes("const PUBLIC_GATEWAY_PORT = 18789") ||
    !routeFilterSource.includes('const INTERNAL_GATEWAY_HOST = "127.0.0.1"') ||
    !routeFilterSource.includes("const INTERNAL_GATEWAY_PORT = 18790") ||
    !routeFilterSource.includes("request.url !== EXTENSION_ROUTE") ||
    !routeFilterSource.includes("request.rawHeaders") ||
    !routeFilterSource.includes("SOCKET_TIMEOUT_MILLISECONDS = 40_000") ||
    !routeFilterSource.includes('command !== "node"') ||
    !routeFilterSource.includes('args[0] !== "openclaw.mjs"') ||
    !routeFilterSource.includes('args[1] !== "gateway"') ||
    /(?:console\.log|process\.stdout\.write)\s*\([\s\S]{0,200}(?:request\.(?:url|headers|rawHeaders)|sec-websocket-protocol)/iu.test(
      routeFilterSource
    ) ||
    /request\.url\.(?:startsWith|includes|endsWith)\(/u.test(routeFilterSource)
  ) {
    violations.push(
      "Public Gateway ingress must expose only the exact extension route and preserve its upgrade bytes."
    );
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
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8"),
    supervisorSource: readFileSync(resolve(directory, "remote-extension-supervisor.mjs"), "utf8"),
    diagnosticSource: readFileSync(
      resolve(root, "infra/maritime/diagnostics/websocket-diagnostic-server.mjs"),
      "utf8"
    ),
    routeFilterSource: readFileSync(resolve(directory, "remote-extension-route-filter.mjs"), "utf8")
  });
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyRemoteExtensionConfig();
  process.stdout.write("Remote extension configuration boundaries verified.\n");
}
