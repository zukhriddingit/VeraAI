import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSON5 from "json5";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPENCLAW_VERSION = "2026.6.33";
const BROWSER_PLUGIN_ID = "browser";
const BROWSER_COMMAND = "browser.proxy";
const BROWSER_PROFILE = "vera-zillow";

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

function isExact(values: readonly string[] | null, expected: readonly string[]): boolean {
  return (
    values !== null &&
    values.length === expected.length &&
    values.every((v, i) => v === expected[i])
  );
}

export function findOpenClawConfigViolations(input: {
  readonly gateway: unknown;
  readonly node: unknown;
}): string[] {
  const violations: string[] = [];
  const gateway = input.gateway;
  const node = input.node;

  for (const [name, config] of [
    ["gateway", gateway],
    ["node", node]
  ] as const) {
    if (objectAt(config, "meta")?.lastTouchedVersion !== OPENCLAW_VERSION) {
      violations.push(`${name} config must declare tested OpenClaw ${OPENCLAW_VERSION}.`);
    }
    const update = objectAt(config, "update");
    if (
      update?.channel !== "extended-stable" ||
      update.checkOnStart !== false ||
      objectAt(update, "auto")?.enabled !== false
    ) {
      violations.push(`${name} config must pin the extended-stable channel with updates disabled.`);
    }
    const plugins = objectAt(config, "plugins");
    if (
      plugins?.bundledDiscovery !== "allowlist" ||
      !isExact(stringArrayAt(plugins, "deny"), []) ||
      !isExact(stringArrayAt(plugins, "load", "paths"), []) ||
      objectAt(plugins, "slots")?.memory !== "none"
    ) {
      violations.push(
        `${name} config must use a closed bundled-plugin inventory with no custom paths.`
      );
    }
  }

  const gatewayPlugins = objectAt(gateway, "plugins");
  if (gatewayPlugins?.enabled !== false || !isExact(stringArrayAt(gatewayPlugins, "allow"), [])) {
    violations.push("Gateway plugins must remain disabled for direct node.invoke routing.");
  }
  const nodePlugins = objectAt(node, "plugins");
  if (
    nodePlugins?.enabled !== true ||
    !isExact(stringArrayAt(nodePlugins, "allow"), [BROWSER_PLUGIN_ID]) ||
    objectAt(nodePlugins, "entries", BROWSER_PLUGIN_ID)?.enabled !== true
  ) {
    violations.push("Node config must enable only the bundled browser plugin.");
  }
  const nodeHooks = objectAt(nodePlugins, "entries", BROWSER_PLUGIN_ID, "hooks");
  if (nodeHooks?.allowPromptInjection !== false || nodeHooks.allowConversationAccess !== false) {
    violations.push("Node browser plugin must not receive prompt or conversation hooks.");
  }
  const nodeBrowser = objectAt(node, "browser");
  if (nodeBrowser?.enabled !== true || nodeBrowser.evaluateEnabled !== false) {
    violations.push("Node browser control must disable arbitrary page evaluation.");
  }

  const gatewayConfig = objectAt(gateway, "gateway");
  if (
    gatewayConfig?.mode !== "local" ||
    gatewayConfig.bind !== "lan" ||
    objectAt(gatewayConfig, "controlUi")?.enabled !== false
  ) {
    violations.push(
      "Gateway application and control-UI exposure must remain disabled and explicit."
    );
  }
  if (
    objectAt(gatewayConfig, "auth")?.mode !== "token" ||
    objectAt(gatewayConfig, "auth")?.token !== "${OPENCLAW_GATEWAY_TOKEN}"
  ) {
    violations.push("Gateway authentication must use the server-side token placeholder.");
  }
  if (!isExact(stringArrayAt(gatewayConfig, "nodes", "allowCommands"), [BROWSER_COMMAND])) {
    violations.push("The only additional node command may be browser.proxy.");
  }
  if (
    objectAt(gatewayConfig, "nodes", "browser")?.mode !== "manual" ||
    objectAt(gatewayConfig, "nodes", "browser")?.node !== "${VERA_OPENCLAW_NODE_ID}"
  ) {
    violations.push("Browser routing must select one explicit node without automatic routing.");
  }
  if (objectAt(gatewayConfig, "nodes", "pairing")?.autoApproveCidrs === undefined) {
    violations.push("Pairing auto-approval must be configured explicitly as disabled.");
  } else if (!isExact(stringArrayAt(gatewayConfig, "nodes", "pairing", "autoApproveCidrs"), [])) {
    violations.push("Pairing and capability approval must remain manual.");
  }
  if (
    !isExact(stringArrayAt(node, "nodeHost", "browserProxy", "allowProfiles"), [BROWSER_PROFILE])
  ) {
    violations.push(`The local node may proxy only the ${BROWSER_PROFILE} browser profile.`);
  }
  if (objectAt(node, "nodeHost", "browserProxy")?.enabled !== true) {
    violations.push("The local node browser proxy must be enabled explicitly.");
  }

  return violations;
}

interface CommandPolicyModule {
  readonly o: (config: unknown, node: unknown) => Set<string>;
  readonly s: (config: unknown, node: unknown) => Set<string>;
}

async function verifyEffectiveCommandPolicy(gateway: unknown): Promise<string[]> {
  const dist = resolve(ROOT, "apps/worker/node_modules/openclaw/dist");
  const candidates = readdirSync(dist).filter((name) =>
    /^node-command-policy-[^.]+\.js$/u.test(name)
  );
  if (candidates.length !== 1)
    return ["Pinned OpenClaw command-policy module was not found uniquely."];
  const policy = (await import(
    pathToFileURL(resolve(dist, candidates[0]!)).href
  )) as CommandPolicyModule;
  const violations: string[] = [];
  const platforms = ["ios", "android", "macos", "windows", "linux", "unknown"] as const;
  for (const platform of platforms) {
    const node = {
      platform,
      deviceFamily: platform === "macos" ? "mac" : platform,
      nodeId: "node-founder-01",
      connId: "connection-01",
      commands: [
        BROWSER_COMMAND,
        "system.run",
        "system.which",
        "screen.snapshot",
        "camera.snap",
        "sms.send"
      ]
    };
    for (const [phase, resolveAllowlist] of [
      ["runtime", policy.o],
      ["pairing", policy.s]
    ] as const) {
      const effective = [...resolveAllowlist(gateway, node)].sort();
      if (!isExact(effective, [BROWSER_COMMAND])) {
        violations.push(
          `Effective ${phase} command policy for ${platform} is ${JSON.stringify(effective)}, expected only browser.proxy.`
        );
      }
    }
  }
  return violations;
}

function validateWithPinnedCli(
  configPath: string,
  expectedPlugins: readonly string[],
  nodeId?: string
): void {
  const stateDir = mkdtempSync(resolve(tmpdir(), "vera-openclaw-validate-"));
  try {
    const executable = resolve(ROOT, "apps/worker/node_modules/.bin/openclaw");
    const options = {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 15_000,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C.UTF-8",
        NO_COLOR: "1",
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_GATEWAY_TOKEN: "0123456789abcdef0123456789abcdef",
        ...(nodeId ? { VERA_OPENCLAW_NODE_ID: nodeId } : {})
      }
    } as const;
    execFileSync(executable, ["config", "validate"], options);
    const pluginOutput = execFileSync(
      executable,
      ["plugins", "list", "--enabled", "--json"],
      options
    );
    const pluginResult = JSON.parse(pluginOutput) as {
      readonly plugins?: readonly { readonly id?: unknown; readonly status?: unknown }[];
    };
    const actual = (pluginResult.plugins ?? [])
      .filter((plugin) => plugin.status === "loaded")
      .map((plugin) => plugin.id)
      .filter((id): id is string => typeof id === "string")
      .sort();
    if (!isExact(actual, [...expectedPlugins].sort())) {
      throw new Error(`Unexpected enabled plugins: ${JSON.stringify(actual)}.`);
    }
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

export async function verifyOpenClawConfigurationFiles(
  gatewayPath = resolve(ROOT, "infra/maritime/openclaw/openclaw.json5"),
  nodePath = resolve(ROOT, "infra/maritime/openclaw/node.openclaw.json5")
): Promise<string[]> {
  const gateway = JSON5.parse(readFileSync(gatewayPath, "utf8")) as unknown;
  const node = JSON5.parse(readFileSync(nodePath, "utf8")) as unknown;
  const violations = [
    ...findOpenClawConfigViolations({ gateway, node }),
    ...(await verifyEffectiveCommandPolicy(gateway))
  ];

  try {
    validateWithPinnedCli(gatewayPath, [], "node-founder-01");
    validateWithPinnedCli(nodePath, [BROWSER_PLUGIN_ID]);
  } catch {
    violations.push("Pinned OpenClaw CLI rejected a Vera configuration.");
  }

  return violations;
}

async function main(): Promise<void> {
  let violations: string[];
  try {
    violations = await verifyOpenClawConfigurationFiles();
  } catch {
    violations = ["OpenClaw configuration files could not be parsed or validated."];
  }

  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("OpenClaw plugin, routing, and effective command boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
