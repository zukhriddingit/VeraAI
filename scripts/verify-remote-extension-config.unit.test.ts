import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import JSON5 from "json5";

import {
  REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE,
  findRemoteExtensionConfigViolations
} from "./verify-remote-extension-config.ts";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "infra/maritime/openclaw");
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(resolve(directory, path), "utf8")) as unknown;

function fixture() {
  return {
    config: JSON5.parse(
      readFileSync(resolve(directory, "remote-extension.openclaw.json5"), "utf8")
    ) as unknown,
    pluginManifest: readJson("vera-read-shared-tab/openclaw.plugin.json"),
    pluginPackage: readJson("vera-read-shared-tab/package.json"),
    zillowPluginManifest: readJson("vera-zillow-rental-research/openclaw.plugin.json"),
    zillowPluginPackage: readJson("vera-zillow-rental-research/package.json"),
    browserResearchPluginManifest: readJson("vera-browser-research/openclaw.plugin.json"),
    browserResearchPluginPackage: readJson("vera-browser-research/package.json"),
    imageManifest: readJson("remote-extension-image.json"),
    acceptedRollbackManifest: readJson("remote-extension-image.m13a-accepted.json"),
    candidateManifest: readJson("remote-extension-image.m13b-candidate.json"),
    pluginSource: readFileSync(resolve(directory, "vera-read-shared-tab/index.mjs"), "utf8"),
    zillowPluginSource: readFileSync(
      resolve(directory, "vera-zillow-rental-research/index.mjs"),
      "utf8"
    ),
    zillowContractSource: readFileSync(
      resolve(directory, "vera-zillow-rental-research/contract.mjs"),
      "utf8"
    ),
    zillowSnapshotSource: readFileSync(
      resolve(directory, "vera-zillow-rental-research/zillow-snapshot.mjs"),
      "utf8"
    ),
    browserResearchPluginSource: readFileSync(
      resolve(directory, "vera-browser-research/index.mjs"),
      "utf8"
    ),
    browserResearchContractSource: readFileSync(
      resolve(directory, "vera-browser-research/contract.mjs"),
      "utf8"
    ),
    browserResearchSnapshotSource: readFileSync(
      resolve(directory, "vera-browser-research/source-snapshot.mjs"),
      "utf8"
    ),
    auditDeviceSource: readFileSync(resolve(directory, "seed-security-audit-device.mjs"), "utf8"),
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8"),
    supervisorSource: readFileSync(resolve(directory, "remote-extension-supervisor.mjs"), "utf8"),
    diagnosticSource: readFileSync(
      resolve(root, "infra/maritime/diagnostics/websocket-diagnostic-server.mjs"),
      "utf8"
    ),
    routeFilterSource: readFileSync(
      resolve(directory, "remote-extension-route-filter.mjs"),
      "utf8"
    ),
    enrollmentSource: readFileSync(resolve(directory, "remote-extension-enrollment.mjs"), "utf8")
  };
}

describe("remote extension configuration verifier", () => {
  it("accepts the dedicated pinned configuration", () => {
    expect(findRemoteExtensionConfigViolations(fixture())).toEqual([]);
    expect(REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE).toContain("@sha256:");
  });

  it("rejects a mutable or unbound Gateway release index", () => {
    const input = fixture();
    (
      input.imageManifest as {
        publicationState: string;
        releaseIndex: string;
      }
    ).publicationState = "published";
    (
      input.imageManifest as {
        publicationState: string;
        releaseIndex: string;
      }
    ).releaseIndex = "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest";
    input.dockerfile = input.dockerfile.replace("ARG VERA_SOURCE_COMMIT", "");
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "Remote extension image manifest must pin the reviewed release and stay blocked.",
        "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
      ])
    );
  });

  it("rejects rollback replacement and mutable candidate publication", () => {
    const input = fixture();
    (input.acceptedRollbackManifest as { image: string }).image =
      "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest";
    const candidate = input.candidateManifest as Record<string, unknown>;
    candidate.publicationState = "published";
    candidate.image = "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest";
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "The accepted Milestone 13A image must remain an immutable rollback artifact.",
        "The Milestone 13B candidate must preserve rollback identity and use one verified immutable publication."
      ])
    );
  });

  it.each([
    ["mixed runtime child", "runtimeManifest", `ghcr.io/other/gateway@sha256:${"a".repeat(64)}`],
    ["missing runtime child", "runtimeManifest", undefined],
    ["approved before acceptance", "deployableBeforeLiveProxyAcceptance", true],
    ["unexpected field", "metadata", "not-allowed"]
  ])("rejects %s", (_label, key, value) => {
    const input = fixture();
    const image = input.imageManifest as Record<string, unknown>;
    if (value === undefined) delete image[key];
    else image[key] = value;
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Remote extension image manifest must pin the reviewed release and stay blocked."
    );
  });

  it("rejects a local-node route and browser tool exposure", () => {
    const input = fixture();
    const config = input.config as {
      gateway: { nodes: { browser: { mode: string } } };
      tools: { allow: string[] };
    };
    config.gateway.nodes.browser.mode = "auto";
    config.tools.allow.push("browser");
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "Remote extension topology must not route through an OpenClaw node.",
        "The model may receive only the three reviewed Vera-owned tools."
      ])
    );
  });

  it("rejects mutating browser-control methods", () => {
    const input = fixture();
    input.pluginSource += '\nfetch("/act", { method: "POST" });\n';
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "Snapshot plugin contains a mutating browser-control method.",
        "Snapshot plugin contains a forbidden browser-control route."
      ])
    );
  });

  it("rejects an unrestricted Zillow browser operation", () => {
    const input = fixture();
    input.zillowPluginSource += '\nfetch("/screenshot", { method: "GET" });\n';
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Zillow plugin must not expose or call forbidden browser, script, file, or generic tool surfaces."
    );
  });

  it("rejects a privileged or token-printing audit device bootstrap", () => {
    const input = fixture();
    input.auditDeviceSource = input.auditDeviceSource
      .replace('Object.freeze(["operator.read"])', 'Object.freeze(["operator.admin"])')
      .replace(
        '{ status: "seeded", role: "operator", scopes: READ_ONLY_SCOPES }',
        '{ status: "seeded", token }'
      );
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "Security-audit device bootstrap must be read-only, private, removable, and token-redacting."
      ])
    );
  });

  it("rejects a supervisor that accepts a provider-overridden root identity", () => {
    const input = fixture();
    input.supervisorSource = input.supervisorSource.replace(
      "uid !== 1000 || gid !== 1000",
      "uid !== 0 || gid !== 0"
    );
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Gateway supervisor must constrain state repair and spawn only the fixed route-filter child."
    );
  });

  it("rejects state preparation that permits symbolic links", () => {
    const input = fixture();
    input.supervisorSource = input.supervisorSource.replace(
      "if (entryStat.isSymbolicLink())",
      "if (false)"
    );
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Gateway supervisor must constrain state repair and spawn only the fixed route-filter child."
    );
  });

  it.each([
    [
      "the dedicated seed environment name",
      (source: string) =>
        source.replace('"OPENCLAW_EXTENSION_PAIRING_SEED"', '"OPENCLAW_GATEWAY_TOKEN"')
    ],
    [
      "the fixed relay filename",
      (source: string) =>
        source.replace('"browser-extension-relay.secret"', '"provider-controlled.secret"')
    ],
    ["exclusive creation", (source: string) => source.replace("constants.O_EXCL", "0")],
    ["symlink-safe opens", (source: string) => source.replaceAll("constants.O_NOFOLLOW", "0")],
    [
      "private file mode",
      (source: string) =>
        source.replace("fchmodSync(descriptor, 0o600)", "fchmodSync(descriptor, 0o644)")
    ],
    [
      "constant-time equality",
      (source: string) => source.replace("timingSafeEqual(leftBytes, rightBytes)", "left === right")
    ],
    [
      "parent-environment deletion",
      (source: string) =>
        source.replace(
          "delete processImplementation.env[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];",
          ""
        )
    ],
    [
      "the strict seed format",
      (source: string) => source.replace("/^[0-9a-f]{64}$/u", "/^[A-Za-z0-9]{32,128}$/u")
    ],
    [
      "the sanitized child environment",
      (source: string) =>
        source.replace(
          "const childEnvironment = { ...processImplementation.env };",
          "const childEnvironment = processImplementation.env;"
        )
    ],
    [
      "child-environment deletion",
      (source: string) =>
        source.replace("delete childEnvironment[EXTENSION_PAIRING_SEED_ENVIRONMENT_NAME];", "")
    ],
    [
      "sanitized child spawn",
      (source: string) => source.replace("env: childEnvironment", "env: processImplementation.env")
    ],
    [
      "the fixed-state installer call",
      (source: string) =>
        source.replace(
          "stateDirectory: STATE_DIRECTORY,\n      seed: pairingSeed",
          "stateDirectory: processImplementation.env.OPENCLAW_STATE_DIR,\n      seed: pairingSeed"
        )
    ],
    [
      "the supervisor-local reference clearing",
      (source: string) => source.replace("pairingSeed = undefined;", "")
    ]
  ])("rejects pairing bootstrap without %s", (_label, mutate) => {
    const input = fixture();
    input.supervisorSource = mutate(input.supervisorSource);
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Gateway supervisor must atomically bootstrap and isolate the extension pairing credential."
    );
  });

  it("rejects pairing-seed logging", () => {
    const input = fixture();
    input.supervisorSource += '\nconsole.log(Buffer.from(pairingSeed).toString("hex"));\n';
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Gateway supervisor must atomically bootstrap and isolate the extension pairing credential."
    );
  });

  it("rejects an image without the fixed Node supervisor entrypoint", () => {
    const input = fixture();
    input.dockerfile = input.dockerfile.replace(
      'ENTRYPOINT ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]',
      ""
    );
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
    );
  });

  it.each([
    ["missing bootstrap directory", "WORKDIR /usr/local/bin\n", ""],
    ["wrong runtime path", "PATH=/usr/bin", "PATH=/usr/local/bin:/usr/bin"],
    ["wrong application workdir", "WORKDIR /app", "WORKDIR /srv"]
  ])("rejects an image with %s", (_label, before, after) => {
    const input = fixture();
    input.dockerfile = input.dockerfile.replace(before, after);
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Hardened Gateway image must preserve the provider-compatible filesystem and constrained runtime."
    );
  });

  it.each([
    ["missing sbin removal", "fs.rmSync('/sbin',{force:true}); ", ""],
    ["missing usr-sbin removal", "fs.rmSync('/usr/sbin',{force:true}); ", ""],
    ["missing usr-sbin creation", "fs.mkdirSync('/usr/sbin',{mode:0o755}); ", ""],
    ["missing usr-sbin ownership", "fs.chownSync('/usr/sbin',0,0); ", ""],
    ["missing usr-sbin mode", "fs.chmodSync('/usr/sbin',0o755); ", ""],
    [
      "wrong sbin target",
      "fs.symlinkSync('usr/sbin','/sbin'); ",
      "fs.symlinkSync('usr/bin','/sbin'); "
    ]
  ])("rejects an image with %s", (_label, before, after) => {
    const input = fixture();
    input.dockerfile = input.dockerfile.replace(before, after);
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Hardened Gateway image must preserve Maritime's empty provider-init filesystem boundary."
    );
  });

  it("rejects an immutable provider init", () => {
    const input = fixture();
    input.dockerfile += "\nCOPY --from=vera-layout /opt/provider-helper /sbin/maritime-init\n";
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Hardened Gateway image must preserve Maritime's empty provider-init filesystem boundary."
    );
  });

  it("rejects an image that leaves the loopback browser-control server unstarted", () => {
    const input = fixture();
    input.dockerfile = input.dockerfile.replace("OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1", "");
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
    );
  });

  it("rejects a publicly bound internal OpenClaw Gateway", () => {
    const input = fixture();
    const gateway = (input.config as { gateway: { port: number; bind: string } }).gateway;
    gateway.port = 18_789;
    gateway.bind = "lan";
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "The internal OpenClaw Gateway must remain loopback-only on port 18790."
    );
  });

  it("rejects a snapshot plugin wired to the pre-filter browser-control port", () => {
    const input = fixture();
    input.pluginSource = input.pluginSource.replace("127.0.0.1:18792", "127.0.0.1:18791");
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Snapshot plugin must use the browser-control port derived from internal Gateway port 18790."
    );
  });

  it("rejects a route filter that uses prefix matching", () => {
    const input = fixture();
    input.routeFilterSource = input.routeFilterSource.replace(
      "request.url !== EXTENSION_ROUTE",
      "!request.url?.startsWith(EXTENSION_ROUTE)"
    );
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Public Gateway ingress must expose only the exact extension route and preserve its upgrade bytes."
    );
  });

  it("rejects enrollment forwarding to OpenClaw before the local handoff", () => {
    const input = fixture();
    input.routeFilterSource = input.routeFilterSource.replace(
      "if (protocols.includes(ENROLLMENT_PROTOCOL)) {",
      'if (protocols.includes("unreviewed-protocol")) {'
    );
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Enrollment upgrades must terminate in the bounded local handoff before OpenClaw relay forwarding."
    );
  });

  it.each([
    [
      "unbounded frames",
      (source: string) => source.replace("maxPayload: MAX_FRAME_BYTES", "maxPayload: Infinity")
    ],
    [
      "credential reads before checkpoint authorization",
      (source: string) =>
        source.replace(
          "const fetchImplementation = dependencies.fetchImplementation ?? fetch;",
          "const leaked = readCredentialImplementation();\n  const fetchImplementation = dependencies.fetchImplementation ?? fetch;"
        )
    ],
    [
      "symlink-following credential reads",
      (source: string) => source.replace("constants.O_NOFOLLOW", "0")
    ],
    ["ticket logging", (source: string) => `${source}\nconsole.log(frame.ticket);\n`]
  ])("rejects browser enrollment with %s", (_label, mutate) => {
    const input = fixture();
    input.enrollmentSource = mutate(input.enrollmentSource);
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "Browser enrollment must be a bounded, checkpoint-first, secret-safe exact-route handoff."
    );
  });

  it.each([
    ["raw request headers", "\nconsole.log(request.headers);\n"],
    ["raw WebSocket protocols", '\nwriteObservation(request.headers["sec-websocket-protocol"]);\n'],
    ["URL query logging", "\nwriteObservation(parsed.search);\n"],
    [
      "unbounded payloads",
      (source: string) =>
        source.replace("maxPayload: options.maxPayloadBytes", "maxPayload: Infinity")
    ],
    ["wildcard Origins", '\nallowedOriginSchemes.includes("*");\n'],
    [
      "prefix path matching",
      (source: string) =>
        source.replace(
          "parsed.pathname === options.acceptedPath",
          "parsed.pathname.startsWith(options.acceptedPath)"
        )
    ]
  ])("rejects diagnostic source with %s", (_label, mutation) => {
    const input = fixture();
    input.diagnosticSource =
      typeof mutation === "function"
        ? mutation(input.diagnosticSource)
        : `${input.diagnosticSource}${mutation}`;
    expect(findRemoteExtensionConfigViolations(input)).toContain(
      "WebSocket diagnostic must enforce an exact path, closed Origins, bounded payloads, and secret-safe observations."
    );
  });
});
