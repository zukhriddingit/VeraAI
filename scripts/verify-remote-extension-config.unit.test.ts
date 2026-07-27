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
    imageManifest: readJson("remote-extension-image.json"),
    pluginSource: readFileSync(resolve(directory, "vera-read-shared-tab/index.mjs"), "utf8"),
    auditDeviceSource: readFileSync(resolve(directory, "seed-security-audit-device.mjs"), "utf8"),
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8"),
    supervisorSource: readFileSync(resolve(directory, "remote-extension-supervisor.mjs"), "utf8"),
    diagnosticSource: readFileSync(
      resolve(root, "infra/maritime/diagnostics/websocket-diagnostic-server.mjs"),
      "utf8"
    ),
    routeFilterSource: readFileSync(resolve(directory, "remote-extension-route-filter.mjs"), "utf8")
  };
}

describe("remote extension configuration verifier", () => {
  it("accepts the dedicated pinned configuration", () => {
    expect(findRemoteExtensionConfigViolations(fixture())).toEqual([]);
    expect(REMOTE_EXTENSION_OPENCLAW_BASE_IMAGE).toContain("@sha256:");
  });

  it("rejects a mutable or unbound Gateway image", () => {
    const input = fixture();
    (
      input.imageManifest as {
        publicationState: string;
        image: string | null;
        sourceCommit?: string;
      }
    ).publicationState = "published";
    (
      input.imageManifest as {
        publicationState: string;
        image: string | null;
        sourceCommit?: string;
      }
    ).image = "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest";
    delete (
      input.imageManifest as {
        publicationState: string;
        image: string | null;
        sourceCommit?: string;
      }
    ).sourceCommit;
    input.dockerfile = input.dockerfile.replace("ARG VERA_SOURCE_COMMIT", "");
    expect(findRemoteExtensionConfigViolations(input)).toEqual(
      expect.arrayContaining([
        "Remote extension image manifest must pin the reviewed release and stay blocked.",
        "Hardened Gateway image must pin its base, bind source identity, restrict config permissions, and run as node."
      ])
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
        "The model may receive only Vera's snapshot tool."
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
