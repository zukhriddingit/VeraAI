import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DIGITALOCEAN_DROPLET_IMAGE,
  DIGITALOCEAN_DROPLET_SIZE,
  DIGITALOCEAN_REGION,
  GATEWAY_IMAGE,
  GATEWAY_SOURCE_REVISION,
  GATEWAY_TOKEN_PLACEHOLDER,
  PAIRING_SEED_PLACEHOLDER
} from "../infra/digitalocean/browser-gateway/config.ts";

export interface DigitalOceanBrowserGatewayFixture {
  cloudInit: string;
  intent: unknown;
  readme: string;
  renderer: string;
  creator: string;
  cleanup: string;
  api: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function occurrenceCount(source: string, value: string): number {
  return source.split(value).length - 1;
}

export function findDigitalOceanBrowserGatewayViolations(
  input: DigitalOceanBrowserGatewayFixture
): string[] {
  const violations: string[] = [];
  const intent = object(input.intent);
  const droplet = object(intent?.droplet);
  const firewall = object(intent?.firewall);
  const gateway = object(intent?.gateway);
  const deferred = object(intent?.deferredUntilBackendLocalHealthPasses);

  if (
    intent?.schemaVersion !== 1 ||
    intent.provider !== "digitalocean" ||
    intent.releaseProfile !== "founder_browser_experimental" ||
    intent.region !== DIGITALOCEAN_REGION ||
    droplet?.count !== 1 ||
    droplet.image !== DIGITALOCEAN_DROPLET_IMAGE ||
    droplet.size !== DIGITALOCEAN_DROPLET_SIZE ||
    droplet.dropletAgent !== true ||
    droplet.temporaryKeyOnlySsh !== true
  ) {
    violations.push("DigitalOcean intent must declare one diagnostics-first Droplet.");
  }
  if (
    !Array.isArray(firewall?.initialInboundRules) ||
    firewall.initialInboundRules.length !== 1 ||
    object(firewall.initialInboundRules[0])?.ports !== "22" ||
    JSON.stringify(firewall.initialInboundRules).includes("0.0.0.0/0") ||
    !Array.isArray(firewall.inboundApplicationRules) ||
    firewall.inboundApplicationRules.length !== 0
  ) {
    violations.push("Public SSH must be impossible outside the exact temporary operator IPv4.");
  }
  if (
    gateway?.image !== GATEWAY_IMAGE ||
    gateway.sourceRevision !== GATEWAY_SOURCE_REVISION ||
    gateway.runtimeIdentity !== "1000:1000" ||
    gateway.containerCount !== 1 ||
    gateway.hostBinding !== "vpc_only" ||
    gateway.hostPort !== 18789
  ) {
    violations.push("Gateway image must be immutable and VPC-bound as UID/GID 1000:1000.");
  }
  if (
    deferred?.loadBalancer !== true ||
    deferred.dnsRecord !== true ||
    deferred.tlsCertificate !== true ||
    deferred.publicWss !== true ||
    deferred.chromePairing !== true
  ) {
    violations.push("Public ingress and Chrome pairing must be deferred until backend acceptance.");
  }

  if (
    occurrenceCount(input.cloudInit, GATEWAY_IMAGE) !== 1 ||
    occurrenceCount(input.cloudInit, GATEWAY_SOURCE_REVISION) !== 1 ||
    /vera-openclaw-gateway:[A-Za-z0-9_.-]+/u.test(input.cloudInit)
  ) {
    violations.push("Gateway image must be immutable.");
  }
  if (
    occurrenceCount(input.cloudInit, GATEWAY_TOKEN_PLACEHOLDER) !== 1 ||
    occurrenceCount(input.cloudInit, PAIRING_SEED_PLACEHOLDER) !== 1 ||
    /(?:gateway_token|pairing_seed)="[0-9a-f]{64}"/u.test(input.cloudInit)
  ) {
    violations.push("Cloud-init must contain only the two reviewed secret placeholders.");
  }
  if (/\b(?:nginx|caddy|traefik|lego|certbot)\b/iu.test(input.cloudInit)) {
    violations.push("Custom TLS edge software is forbidden.");
  }
  if (
    input.cloudInit.includes("0.0.0.0/0") ||
    input.cloudInit.includes("::/0") ||
    /-p\s+(?:22|80|443|18789):/u.test(input.cloudInit) ||
    !input.cloudInit.includes('-p "${vpc_ipv4}:${backend_port}:${backend_port}"')
  ) {
    violations.push("Cloud-init must publish the Gateway only on the VPC address.");
  }
  for (const required of [
    "PasswordAuthentication no",
    "PermitRootLogin prohibit-password",
    "vera-browser-gateway-bootstrap.service",
    "After=network-online.target docker.service",
    "TimeoutStartSec=900",
    "trap fail_closed ERR",
    'current_stage="immutable_image_pull"',
    "--user 1000:1000",
    "--read-only",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    "--restart unless-stopped",
    '--mount "type=bind,src=${state_directory},dst=/data"',
    "timeout 240s docker pull",
    "security audit --deep --json",
    "backendLocalReady: true",
    "publicEndpointReady: false",
    "wssAcceptanceStarted: false"
  ]) {
    if (!input.cloudInit.includes(required)) {
      violations.push(`Cloud-init is missing required invariant: ${required}.`);
    }
  }
  if (
    !input.cloudInit.includes('readonly internal_listener_wait_seconds="90"') ||
    !input.cloudInit.includes(
      "internal_listener_deadline=$((SECONDS + internal_listener_wait_seconds))"
    ) ||
    !input.cloudInit.includes("while (( SECONDS < internal_listener_deadline )); do") ||
    !input.cloudInit.includes("internal_listeners_ready=1") ||
    !input.cloudInit.includes('[[ "${internal_listeners_ready}" == "1" ]]')
  ) {
    violations.push("Internal listener readiness must use a bounded polling gate.");
  }

  if (
    !input.renderer.includes("readCredentialPair") ||
    !input.renderer.includes("O_EXCL") ||
    !input.renderer.includes("O_NOFOLLOW") ||
    !input.renderer.includes("rendered_cloud_init=ready") ||
    input.renderer.includes("gatewayToken}\\n") ||
    input.renderer.includes("pairingSeed}\\n")
  ) {
    violations.push("Cloud-init renderer must keep secret inputs private and fail closed.");
  }
  const createOrder = [
    "await input.client.createTag(",
    "await input.client.createFirewall(",
    "await input.client.createSshKey(",
    "await input.client.createDroplet("
  ].map((marker) => input.creator.indexOf(marker));
  if (
    createOrder.some((index) => index < 0) ||
    !createOrder.every((index, position) => position === 0 || index > createOrder[position - 1]!) ||
    !input.creator.includes("CREATE_CONFIRMATION") ||
    !input.creator.includes("waitForActiveDroplet")
  ) {
    violations.push("Create lifecycle must attach the tag firewall before creating one Droplet.");
  }
  const cleanupOrder = [
    "() => client.deleteLoadBalancer(",
    "() => client.deleteDomainRecord(",
    "() => client.deleteCertificate(",
    "() => client.deleteDroplet(",
    "() => client.deleteFirewall(",
    "() => client.deleteSshKey(",
    "() => client.deleteTag("
  ].map((marker) => input.cleanup.indexOf(marker));
  if (
    cleanupOrder.some((index) => index < 0) ||
    !cleanupOrder.every((index, position) => position === 0 || index > cleanupOrder[position - 1]!)
  ) {
    violations.push("Cleanup must remove disposable resources in dependency order.");
  }
  if (
    !input.api.includes("with_droplet_agent: true") ||
    !input.api.includes("sources: { addresses: [`${input.operatorIpv4}/32`] }") ||
    input.api.includes('addresses: ["0.0.0.0/0"]')
  ) {
    violations.push("Provider requests must enable the console agent and exact-/32 SSH only.");
  }

  for (const phrase of [
    "backend-local acceptance",
    "remove the temporary SSH rule",
    "DigitalOcean-managed Let's Encrypt",
    "openclaw-extension-relay",
    "Paired and one example.com tab shared.",
    "no_shared_tab",
    "founder_browser_experimental=no_go",
    "Milestone 13B"
  ]) {
    if (!input.readme.includes(phrase)) {
      violations.push(`DigitalOcean runbook must include ${phrase}.`);
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const directory = resolve("infra/digitalocean/browser-gateway");
  const read = (name: string): string => readFileSync(resolve(directory, name), "utf8");
  const violations = findDigitalOceanBrowserGatewayViolations({
    cloudInit: read("cloud-init.template.yaml"),
    intent: JSON.parse(read("infrastructure-intent.json")) as unknown,
    readme: read("README.md"),
    renderer: read("render-cloud-init.ts"),
    creator: read("create-diagnostics-stack.ts"),
    cleanup: read("cleanup-stack.ts"),
    api: read("digitalocean-api.ts")
  });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "DigitalOcean browser Gateway assets preserve private bootstrap and ingress gates.\n"
  );
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
