import { setTimeout as delay } from "node:timers/promises";

import { DIGITALOCEAN_API_BASE_URL } from "./config.ts";

export type FetchImplementation = typeof fetch;

export interface DigitalOceanResponseHeaders {
  contentType?: string;
  date?: string;
  rateLimitLimit?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
  providerRequestId?: string;
}

export interface DigitalOceanResponseObservation {
  status: number;
  headers: DigitalOceanResponseHeaders;
  bodyByteLength: number;
  bodyTruncated: boolean;
  parsedBody: unknown | null;
}

export interface DropletNetwork {
  ip_address: string;
  type: "public" | "private";
  version: 4 | 6;
}

export interface DigitalOceanDroplet {
  id: number;
  name: string;
  status: string;
  networks: {
    v4: DropletNetwork[];
  };
}

export interface DigitalOceanFirewall {
  id: string;
  name: string;
  status: string;
}

export interface DigitalOceanSshKey {
  id: number;
  name: string;
}

export interface DigitalOceanCertificate {
  id: string;
  name: string;
  dnsNames: string[];
  type: string;
  state: string;
  createdAtUtc: string;
}

export interface DigitalOceanForwardingRule {
  entryProtocol: string;
  entryPort: number;
  targetProtocol: string;
  targetPort: number;
  certificateId: string;
  tlsPassthrough: boolean;
}

export interface DigitalOceanLoadBalancer {
  id: string;
  name: string;
  ip: string;
  status: string;
  type: string;
  network: string;
  networkStack: string;
  createdAtUtc: string;
  region: string;
  dropletIds: number[];
  forwardingRules: DigitalOceanForwardingRule[];
  healthCheck: {
    protocol: string;
    port: number;
    checkIntervalSeconds: number;
    responseTimeoutSeconds: number;
    unhealthyThreshold: number;
    healthyThreshold: number;
  };
  redirectHttpToHttps: boolean;
  enableProxyProtocol: boolean;
}

type JsonObject = Record<string, unknown>;
type DigitalOceanMethod = "GET" | "POST" | "PUT" | "DELETE";

const MAX_OBSERVED_BODY_BYTES = 65_536;

function object(value: unknown, code: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonObject;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(code);
  return value as number;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function boolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new Error(code);
  return value;
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((entry) => string(entry, code));
}

function integerArray(value: unknown, code: string): number[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((entry) => integer(entry, code));
}

function parseDroplet(value: unknown): DigitalOceanDroplet {
  const candidate = object(value, "droplet_response_rejected");
  const networks = object(candidate.networks, "droplet_response_rejected");
  if (!Array.isArray(networks.v4)) throw new Error("droplet_response_rejected");
  const v4 = networks.v4.map((entry) => {
    const network = object(entry, "droplet_response_rejected");
    const type = string(network.type, "droplet_response_rejected");
    if (type !== "public" && type !== "private") throw new Error("droplet_response_rejected");
    return {
      ip_address: string(network.ip_address, "droplet_response_rejected"),
      type,
      version: 4 as const
    };
  });
  return {
    id: integer(candidate.id, "droplet_response_rejected"),
    name: string(candidate.name, "droplet_response_rejected"),
    status: string(candidate.status, "droplet_response_rejected"),
    networks: { v4 }
  };
}

export class DigitalOceanApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "DigitalOceanApiError";
  }
}

export class DigitalOceanTransportError extends Error {
  readonly code = "digitalocean_transport_failed";

  constructor() {
    super("digitalocean_transport_failed");
    this.name = "DigitalOceanTransportError";
  }
}

export class DigitalOceanProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "DigitalOceanProviderError";
  }
}

function providerErrorCode(status: number): string {
  if (status === 401) return "digitalocean_authentication_failed";
  if (status === 403) return "digitalocean_authorization_failed";
  if (status === 422) return "digitalocean_validation_failed";
  if (status === 429) return "digitalocean_rate_limit_failed";
  return "digitalocean_provider_failed";
}

function responseHeaders(headers: Headers): DigitalOceanResponseHeaders {
  const allowlisted: DigitalOceanResponseHeaders = {};
  const assign = (key: keyof DigitalOceanResponseHeaders, ...headerNames: string[]): void => {
    for (const headerName of headerNames) {
      const value = headers.get(headerName);
      if (value !== null) {
        allowlisted[key] = value;
        return;
      }
    }
  };
  assign("contentType", "content-type");
  assign("date", "date");
  assign("rateLimitLimit", "ratelimit-limit");
  assign("rateLimitRemaining", "ratelimit-remaining");
  assign("rateLimitReset", "ratelimit-reset");
  assign("providerRequestId", "x-request-id", "x-digitalocean-request-id");
  return allowlisted;
}

async function boundedResponseBody(
  response: Response
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let captured = 0;
  let truncated = false;
  try {
    while (captured <= MAX_OBSERVED_BODY_BYTES) {
      const result = await reader.read();
      if (result.done) break;
      const remaining = MAX_OBSERVED_BODY_BYTES + 1 - captured;
      const chunk = result.value.subarray(0, remaining);
      chunks.push(chunk);
      captured += chunk.byteLength;
      if (result.value.byteLength > remaining || captured > MAX_OBSERVED_BODY_BYTES) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const boundedLength = Math.min(captured, MAX_OBSERVED_BODY_BYTES);
  const bytes = new Uint8Array(boundedLength);
  let offset = 0;
  for (const chunk of chunks) {
    const included = chunk.subarray(0, Math.max(0, boundedLength - offset));
    bytes.set(included, offset);
    offset += included.byteLength;
    if (offset >= boundedLength) break;
  }
  return { bytes, truncated };
}

function parseObservedJson(bytes: Uint8Array, truncated: boolean): unknown | null {
  if (bytes.byteLength === 0 || truncated) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function parseCertificate(value: unknown): DigitalOceanCertificate {
  const certificate = object(value, "certificate_response_rejected");
  return {
    id: string(certificate.id, "certificate_response_rejected"),
    name: string(certificate.name, "certificate_response_rejected"),
    dnsNames: stringArray(certificate.dns_names, "certificate_response_rejected"),
    type: string(certificate.type, "certificate_response_rejected"),
    state: string(certificate.state, "certificate_response_rejected"),
    createdAtUtc: string(certificate.created_at, "certificate_response_rejected")
  };
}

function parseLoadBalancer(value: unknown): DigitalOceanLoadBalancer {
  const loadBalancer = object(value, "load_balancer_response_rejected");
  const region = object(loadBalancer.region, "load_balancer_response_rejected");
  const healthCheck = object(loadBalancer.health_check, "load_balancer_response_rejected");
  if (!Array.isArray(loadBalancer.forwarding_rules)) {
    throw new Error("load_balancer_response_rejected");
  }
  const forwardingRules = loadBalancer.forwarding_rules.map((value) => {
    const rule = object(value, "load_balancer_response_rejected");
    return {
      entryProtocol: string(rule.entry_protocol, "load_balancer_response_rejected"),
      entryPort: nonNegativeInteger(rule.entry_port, "load_balancer_response_rejected"),
      targetProtocol: string(rule.target_protocol, "load_balancer_response_rejected"),
      targetPort: nonNegativeInteger(rule.target_port, "load_balancer_response_rejected"),
      certificateId: typeof rule.certificate_id === "string" ? rule.certificate_id : "",
      tlsPassthrough: typeof rule.tls_passthrough === "boolean" ? rule.tls_passthrough : false
    };
  });
  return {
    id: string(loadBalancer.id, "load_balancer_response_rejected"),
    name: string(loadBalancer.name, "load_balancer_response_rejected"),
    ip: typeof loadBalancer.ip === "string" ? loadBalancer.ip : "",
    status: string(loadBalancer.status, "load_balancer_response_rejected"),
    type: string(loadBalancer.type, "load_balancer_response_rejected"),
    network: string(loadBalancer.network, "load_balancer_response_rejected"),
    networkStack: string(loadBalancer.network_stack, "load_balancer_response_rejected"),
    createdAtUtc: string(loadBalancer.created_at, "load_balancer_response_rejected"),
    region: string(region.slug, "load_balancer_response_rejected"),
    dropletIds: integerArray(loadBalancer.droplet_ids, "load_balancer_response_rejected"),
    forwardingRules,
    healthCheck: {
      protocol: string(healthCheck.protocol, "load_balancer_response_rejected"),
      port: nonNegativeInteger(healthCheck.port, "load_balancer_response_rejected"),
      checkIntervalSeconds: nonNegativeInteger(
        healthCheck.check_interval_seconds,
        "load_balancer_response_rejected"
      ),
      responseTimeoutSeconds: nonNegativeInteger(
        healthCheck.response_timeout_seconds,
        "load_balancer_response_rejected"
      ),
      unhealthyThreshold: nonNegativeInteger(
        healthCheck.unhealthy_threshold,
        "load_balancer_response_rejected"
      ),
      healthyThreshold: nonNegativeInteger(
        healthCheck.healthy_threshold,
        "load_balancer_response_rejected"
      )
    },
    redirectHttpToHttps: boolean(
      loadBalancer.redirect_http_to_https,
      "load_balancer_response_rejected"
    ),
    enableProxyProtocol: boolean(
      loadBalancer.enable_proxy_protocol,
      "load_balancer_response_rejected"
    )
  };
}

export class DigitalOceanClient {
  constructor(
    private readonly token: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly baseUrl = DIGITALOCEAN_API_BASE_URL
  ) {}

  async observe(
    method: DigitalOceanMethod,
    path: string,
    body?: unknown
  ): Promise<DigitalOceanResponseObservation> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new DigitalOceanTransportError();
    }
    const bounded = await boundedResponseBody(response);
    const observation: DigitalOceanResponseObservation = {
      status: response.status,
      headers: responseHeaders(response.headers),
      bodyByteLength: bounded.bytes.byteLength,
      bodyTruncated: bounded.truncated,
      parsedBody: parseObservedJson(bounded.bytes, bounded.truncated)
    };
    if (!response.ok) {
      throw new DigitalOceanProviderError(providerErrorCode(response.status), response.status);
    }
    return observation;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: {
      body?: unknown;
      acceptNotFound?: boolean;
    } = {}
  ): Promise<unknown | null> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15_000)
    });
    if (options.acceptNotFound === true && response.status === 404) return null;
    if (!response.ok) {
      throw new DigitalOceanApiError(
        `digitalocean_${method.toLowerCase()}_failed`,
        response.status
      );
    }
    if (response.status === 204) return null;
    return (await response.json()) as unknown;
  }

  async createTag(name: string): Promise<void> {
    await this.request("POST", "/tags", { body: { name } });
  }

  async deleteTag(name: string): Promise<void> {
    await this.request("DELETE", `/tags/${encodeURIComponent(name)}`, { acceptNotFound: true });
  }

  async createFirewall(input: {
    name: string;
    tag: string;
    operatorIpv4: string;
  }): Promise<DigitalOceanFirewall> {
    const response = object(
      await this.request("POST", "/firewalls", {
        body: {
          name: input.name,
          inbound_rules: [
            {
              protocol: "tcp",
              ports: "22",
              sources: { addresses: [`${input.operatorIpv4}/32`] }
            }
          ],
          outbound_rules: [
            {
              protocol: "icmp",
              destinations: { addresses: ["0.0.0.0/0", "::/0"] }
            },
            {
              protocol: "tcp",
              ports: "all",
              destinations: { addresses: ["0.0.0.0/0", "::/0"] }
            },
            {
              protocol: "udp",
              ports: "all",
              destinations: { addresses: ["0.0.0.0/0", "::/0"] }
            }
          ],
          droplet_ids: [],
          tags: [input.tag]
        }
      }),
      "firewall_response_rejected"
    );
    const firewall = object(response.firewall, "firewall_response_rejected");
    return {
      id: string(firewall.id, "firewall_response_rejected"),
      name: string(firewall.name, "firewall_response_rejected"),
      status: string(firewall.status, "firewall_response_rejected")
    };
  }

  async updateFirewallForLoadBalancer(input: {
    firewallId: string;
    name: string;
    tag: string;
    loadBalancerId: string;
  }): Promise<void> {
    await this.request("PUT", `/firewalls/${encodeURIComponent(input.firewallId)}`, {
      body: {
        name: input.name,
        inbound_rules: [
          {
            protocol: "tcp",
            ports: "18789",
            sources: { load_balancer_uids: [input.loadBalancerId] }
          }
        ],
        outbound_rules: [
          {
            protocol: "icmp",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          },
          {
            protocol: "tcp",
            ports: "all",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          },
          {
            protocol: "udp",
            ports: "all",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          }
        ],
        droplet_ids: [],
        tags: [input.tag]
      }
    });
  }

  async removeFirewallIngress(input: {
    firewallId: string;
    name: string;
    tag: string;
  }): Promise<void> {
    await this.request("PUT", `/firewalls/${encodeURIComponent(input.firewallId)}`, {
      body: {
        name: input.name,
        inbound_rules: [],
        outbound_rules: [
          {
            protocol: "icmp",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          },
          {
            protocol: "tcp",
            ports: "all",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          },
          {
            protocol: "udp",
            ports: "all",
            destinations: { addresses: ["0.0.0.0/0", "::/0"] }
          }
        ],
        droplet_ids: [],
        tags: [input.tag]
      }
    });
  }

  async deleteFirewall(id: string): Promise<void> {
    await this.request("DELETE", `/firewalls/${encodeURIComponent(id)}`, {
      acceptNotFound: true
    });
  }

  async createSshKey(input: { name: string; publicKey: string }): Promise<DigitalOceanSshKey> {
    const response = object(
      await this.request("POST", "/account/keys", {
        body: { name: input.name, public_key: input.publicKey }
      }),
      "ssh_key_response_rejected"
    );
    const key = object(response.ssh_key, "ssh_key_response_rejected");
    return {
      id: integer(key.id, "ssh_key_response_rejected"),
      name: string(key.name, "ssh_key_response_rejected")
    };
  }

  async deleteSshKey(id: number): Promise<void> {
    await this.request("DELETE", `/account/keys/${id}`, { acceptNotFound: true });
  }

  async createDroplet(input: {
    name: string;
    region: string;
    size: string;
    image: string;
    tag: string;
    sshKeyId: number;
    userData: string;
  }): Promise<DigitalOceanDroplet> {
    const response = object(
      await this.request("POST", "/droplets", {
        body: {
          name: input.name,
          region: input.region,
          size: input.size,
          image: input.image,
          ssh_keys: [input.sshKeyId],
          backups: false,
          ipv6: false,
          monitoring: false,
          tags: [input.tag],
          user_data: input.userData,
          with_droplet_agent: true
        }
      }),
      "droplet_response_rejected"
    );
    return parseDroplet(response.droplet);
  }

  async getDroplet(id: number, acceptNotFound = false): Promise<DigitalOceanDroplet | null> {
    const response = await this.request("GET", `/droplets/${id}`, { acceptNotFound });
    if (response === null) return null;
    return parseDroplet(object(response, "droplet_response_rejected").droplet);
  }

  async deleteDroplet(id: number): Promise<void> {
    await this.request("DELETE", `/droplets/${id}`, { acceptNotFound: true });
  }

  async createManagedCertificate(input: {
    name: string;
    dnsNames: string[];
  }): Promise<DigitalOceanResponseObservation> {
    return await this.observe("POST", "/certificates", {
      name: input.name,
      type: "lets_encrypt",
      dns_names: input.dnsNames
    });
  }

  async listManagedCertificates(name?: string): Promise<DigitalOceanCertificate[]> {
    const query = name === undefined ? "" : `?name=${encodeURIComponent(name)}`;
    const response = object(
      await this.request("GET", `/certificates${query}`),
      "certificate_response_rejected"
    );
    if (!Array.isArray(response.certificates)) {
      throw new Error("certificate_response_rejected");
    }
    return response.certificates.map(parseCertificate);
  }

  async getManagedCertificate(
    id: string,
    acceptNotFound = false
  ): Promise<DigitalOceanCertificate | null> {
    const response = await this.request("GET", `/certificates/${encodeURIComponent(id)}`, {
      acceptNotFound
    });
    if (response === null) return null;
    return parseCertificate(object(response, "certificate_response_rejected").certificate);
  }

  async createManagedLoadBalancer(input: {
    name: string;
    region: string;
    dropletId: number;
    certificateId: string;
  }): Promise<DigitalOceanResponseObservation> {
    return await this.observe("POST", "/load_balancers", {
      name: input.name,
      region: input.region,
      size_unit: 1,
      type: "REGIONAL",
      network: "EXTERNAL",
      network_stack: "IPV4",
      droplet_ids: [input.dropletId],
      redirect_http_to_https: false,
      enable_proxy_protocol: false,
      forwarding_rules: [
        {
          entry_protocol: "https",
          entry_port: 443,
          target_protocol: "http",
          target_port: 18789,
          certificate_id: input.certificateId,
          tls_passthrough: false
        }
      ],
      health_check: {
        protocol: "tcp",
        port: 18789,
        check_interval_seconds: 10,
        response_timeout_seconds: 5,
        unhealthy_threshold: 3,
        healthy_threshold: 5
      }
    });
  }

  async listManagedLoadBalancers(): Promise<DigitalOceanLoadBalancer[]> {
    const response = object(
      await this.request("GET", "/load_balancers?per_page=200"),
      "load_balancer_response_rejected"
    );
    if (!Array.isArray(response.load_balancers)) {
      throw new Error("load_balancer_response_rejected");
    }
    return response.load_balancers.map(parseLoadBalancer);
  }

  async getManagedLoadBalancer(
    id: string,
    acceptNotFound = false
  ): Promise<DigitalOceanLoadBalancer | null> {
    const response = await this.request("GET", `/load_balancers/${encodeURIComponent(id)}`, {
      acceptNotFound
    });
    if (response === null) return null;
    return parseLoadBalancer(object(response, "load_balancer_response_rejected").load_balancer);
  }

  async deleteLoadBalancer(id: string): Promise<void> {
    await this.request("DELETE", `/load_balancers/${encodeURIComponent(id)}`, {
      acceptNotFound: true
    });
  }

  async deleteCertificate(id: string): Promise<void> {
    await this.request("DELETE", `/certificates/${encodeURIComponent(id)}`, {
      acceptNotFound: true
    });
  }

  async deleteDomainRecord(domain: string, recordId: number): Promise<void> {
    await this.request("DELETE", `/domains/${encodeURIComponent(domain)}/records/${recordId}`, {
      acceptNotFound: true
    });
  }
}

export async function waitForActiveDroplet(input: {
  client: Pick<DigitalOceanClient, "getDroplet">;
  dropletId: number;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<DigitalOceanDroplet> {
  const timeoutMs = input.timeoutMs ?? 600_000;
  const intervalMs = input.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const droplet = await input.client.getDroplet(input.dropletId);
    if (droplet?.status === "active") {
      const publicIpv4 = droplet.networks.v4.some((network) => network.type === "public");
      const privateIpv4 = droplet.networks.v4.some((network) => network.type === "private");
      if (publicIpv4 && privateIpv4) return droplet;
    }
    await delay(intervalMs);
  }
  throw new Error("droplet_activation_timeout");
}
