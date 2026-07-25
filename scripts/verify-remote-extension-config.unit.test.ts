import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import JSON5 from "json5";

import {
  REMOTE_EXTENSION_OPENCLAW_IMAGE,
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
    pluginSource: readFileSync(resolve(directory, "vera-read-shared-tab/index.mjs"), "utf8")
  };
}

describe("remote extension configuration verifier", () => {
  it("accepts the dedicated pinned configuration", () => {
    expect(findRemoteExtensionConfigViolations(fixture())).toEqual([]);
    expect(REMOTE_EXTENSION_OPENCLAW_IMAGE).toContain("@sha256:");
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
});
