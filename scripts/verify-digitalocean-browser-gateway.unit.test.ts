import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { findDigitalOceanBrowserGatewayViolations } from "./verify-digitalocean-browser-gateway.ts";
import type { DigitalOceanBrowserGatewayFixture } from "./verify-digitalocean-browser-gateway.ts";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "infra/digitalocean/browser-gateway");
const read = (name: string): string => readFileSync(resolve(directory, name), "utf8");

function repositoryFixture(): DigitalOceanBrowserGatewayFixture {
  return {
    cloudInit: read("cloud-init.template.yaml"),
    intent: JSON.parse(read("infrastructure-intent.json")) as unknown,
    readme: read("README.md"),
    renderer: read("render-cloud-init.ts"),
    creator: read("create-diagnostics-stack.ts"),
    cleanup: read("cleanup-stack.ts"),
    api: read("digitalocean-api.ts"),
    resourceJournal: read("resource-journal.ts"),
    managedCertificate: read("managed-certificate.ts"),
    managedLoadBalancer: read("managed-load-balancer.ts")
  };
}

describe("DigitalOcean browser Gateway deployment verifier", () => {
  it("accepts the reviewed deployment assets", () => {
    expect(findDigitalOceanBrowserGatewayViolations(repositoryFixture())).toEqual([]);
  });

  it("rejects public SSH", () => {
    const input = repositoryFixture();
    const intent = input.intent as {
      firewall: { initialInboundRules: Array<{ sources: string[] }> };
    };
    intent.firewall.initialInboundRules[0]!.sources = ["0.0.0.0/0"];
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Public SSH must be impossible outside the exact temporary operator IPv4."
    );
  });

  it("rejects a mutable Gateway image", () => {
    const input = repositoryFixture();
    input.cloudInit = input.cloudInit.replace(
      /ghcr\.io\/zukhriddingit\/vera-openclaw-gateway@sha256:[0-9a-f]{64}/u,
      "ghcr.io/zukhriddingit/vera-openclaw-gateway:latest"
    );
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Gateway image must be immutable."
    );
  });

  it.each(["nginx", "Caddy", "Traefik", "Lego", "Certbot"])(
    "rejects custom TLS edge software: %s",
    (edge) => {
      const input = repositoryFixture();
      input.cloudInit += `\n${edge}\n`;
      expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
        "Custom TLS edge software is forbidden."
      );
    }
  );

  it("rejects a broad host binding", () => {
    const input = repositoryFixture();
    input.cloudInit = input.cloudInit.replace(
      '-p "${vpc_ipv4}:${backend_port}:${backend_port}"',
      '-p "18789:18789"'
    );
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Cloud-init must publish the Gateway only on the VPC address."
    );
  });

  it("rejects public ingress before backend acceptance", () => {
    const input = repositoryFixture();
    (
      input.intent as { deferredUntilBackendLocalHealthPasses: { publicWss: boolean } }
    ).deferredUntilBackendLocalHealthPasses.publicWss = false;
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Public ingress and Chrome pairing must be deferred until backend acceptance."
    );
  });

  it("rejects an immediate one-shot internal listener assertion", () => {
    const input = repositoryFixture();
    input.cloudInit = input.cloudInit.replace(
      "while (( SECONDS < internal_listener_deadline )); do",
      'if timeout 2s docker exec "${container_name}"; then'
    );
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Internal listener readiness must use a bounded polling gate."
    );
  });

  it.each([
    ["await rename(temporaryPath, absolutePath)", "atomic rename"],
    ["await handle.sync()", "file sync"],
    ["await directoryHandle.sync()", "directory sync"]
  ])("rejects a journal without %s", (marker) => {
    const input = repositoryFixture();
    input.resourceJournal = input.resourceJournal.replace(marker, "");
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      `Resource journal is missing required invariant: ${marker}.`
    );
  });

  it("rejects removal of exact certificate reconciliation", () => {
    const input = repositoryFixture();
    input.managedCertificate = input.managedCertificate.replaceAll(
      "exactReconciliation",
      "unsafeReconciliation"
    );
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Managed certificate creation must persist, reconcile exactly, and verify within ten minutes."
    );
  });

  it("rejects DNS creation before exact Load Balancer readback", () => {
    const input = repositoryFixture();
    input.managedLoadBalancer = input.managedLoadBalancer.replaceAll(
      "await input.createDnsRecordAfterReadback?.(active)",
      "await Promise.resolve()"
    );
    expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(
      "Managed Load Balancer creation must persist, reconcile, read back exact ingress, then allow DNS."
    );
  });
});
