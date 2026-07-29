import { describe, expect, it, vi } from "vitest";

import {
  DigitalOceanApiError,
  DigitalOceanClient,
  waitForActiveDroplet
} from "./digitalocean-api.ts";

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("DigitalOcean API boundary", () => {
  it("creates the tag-scoped firewall with exact operator SSH and bounded outbound rules", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      response(202, {
        firewall: { id: "firewall-id", name: "vera-fw", status: "waiting" }
      })
    );
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    await client.createFirewall({
      name: "vera-fw",
      tag: "vera-tag",
      operatorIpv4: "203.0.113.9"
    });

    const request = fetchImplementation.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      inbound_rules: Array<{ sources: { addresses: string[] } }>;
      outbound_rules: unknown[];
      tags: string[];
    };
    expect(body.inbound_rules).toEqual([
      {
        protocol: "tcp",
        ports: "22",
        sources: { addresses: ["203.0.113.9/32"] }
      }
    ]);
    expect(body.outbound_rules).toHaveLength(3);
    expect(body.tags).toEqual(["vera-tag"]);
    expect(String(request?.[1]?.body)).not.toContain("token-with-sufficient-private-length");
  });

  it("creates a diagnostics-first Droplet with the console agent and no optional services", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      response(202, {
        droplet: {
          id: 1,
          name: "vera-gateway",
          status: "new",
          networks: { v4: [] }
        }
      })
    );
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    await client.createDroplet({
      name: "vera-gateway",
      region: "nyc1",
      size: "s-1vcpu-2gb",
      image: "ubuntu-24-04-x64",
      tag: "vera-tag",
      sshKeyId: 7,
      userData: "#cloud-config"
    });

    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      backups: false,
      ipv6: false,
      monitoring: false,
      with_droplet_agent: true
    });
  });

  it("redacts provider bodies and bearer values from errors", async () => {
    const token = "token-that-must-not-appear-in-an-error";
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(403, { message: `denied ${token}` }));
    const client = new DigitalOceanClient(token, fetchImplementation);

    const error = await client.createTag("vera-tag").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DigitalOceanApiError);
    expect(String(error)).toBe("DigitalOceanApiError: digitalocean_post_failed");
    expect(String(error)).not.toContain(token);
  });

  it("treats a missing resource as idempotent deletion success", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response(404));
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );
    await expect(client.deleteDroplet(9)).resolves.toBeUndefined();
  });

  it("waits until both public and private IPv4 networks are active", async () => {
    const getDroplet = vi
      .fn()
      .mockResolvedValueOnce({
        id: 1,
        name: "vera",
        status: "new",
        networks: { v4: [] }
      })
      .mockResolvedValueOnce({
        id: 1,
        name: "vera",
        status: "active",
        networks: {
          v4: [
            { ip_address: "203.0.113.7", type: "public", version: 4 },
            { ip_address: "10.1.0.2", type: "private", version: 4 }
          ]
        }
      });

    await expect(
      waitForActiveDroplet({
        client: { getDroplet },
        dropletId: 1,
        timeoutMs: 100,
        intervalMs: 1
      })
    ).resolves.toMatchObject({ status: "active" });
  });
});
