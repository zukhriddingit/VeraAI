import { setTimeout as delay } from "node:timers/promises";

import { DIGITALOCEAN_API_BASE_URL } from "./config.ts";

export type FetchImplementation = typeof fetch;

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

type JsonObject = Record<string, unknown>;

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

export class DigitalOceanClient {
  constructor(
    private readonly token: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly baseUrl = DIGITALOCEAN_API_BASE_URL
  ) {}

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
