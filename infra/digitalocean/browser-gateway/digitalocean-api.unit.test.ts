import { describe, expect, it, vi } from "vitest";

import {
  DigitalOceanApiError,
  DigitalOceanClient,
  DigitalOceanProviderError,
  DigitalOceanTransportError,
  waitForActiveDroplet
} from "./digitalocean-api.ts";

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("DigitalOcean API boundary", () => {
  it("returns a bounded allowlisted response observation", async () => {
    const payload = { certificate: { id: "certificate-id", state: "pending" } };
    const body = JSON.stringify(payload);
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(body, {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            Date: "Wed, 29 Jul 2026 16:00:00 GMT",
            "RateLimit-Limit": "5000",
            "RateLimit-Remaining": "4999",
            "RateLimit-Reset": "1785344400",
            "X-Request-Id": "request-opaque",
            Authorization: "Bearer response-secret",
            "Set-Cookie": "private=value"
          }
        })
    );
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    await expect(
      client.observe("POST", "/certificates", {
        name: "vera-m13a-do-cert-20260729-12"
      })
    ).resolves.toEqual({
      status: 202,
      headers: {
        contentType: "application/json",
        date: "Wed, 29 Jul 2026 16:00:00 GMT",
        rateLimitLimit: "5000",
        rateLimitRemaining: "4999",
        rateLimitReset: "1785344400",
        providerRequestId: "request-opaque"
      },
      bodyByteLength: Buffer.byteLength(body),
      bodyTruncated: false,
      parsedBody: payload
    });
    const serialized = JSON.stringify(await client.observe("GET", "/certificates"));
    expect(serialized).not.toContain("response-secret");
    expect(serialized).not.toContain("Set-Cookie");
  });

  it("bounds provider bodies at 64 KiB and never echoes invalid JSON", async () => {
    const largeBody = `not-json:${"x".repeat(70_000)}:private-tail`;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(largeBody, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response("not-json:must-not-escape", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    const large = await client.observe("GET", "/certificates");
    expect(large).toMatchObject({
      bodyByteLength: 65_536,
      bodyTruncated: true,
      parsedBody: null
    });
    expect(JSON.stringify(large)).not.toContain("private-tail");

    const invalid = await client.observe("GET", "/certificates");
    expect(invalid.parsedBody).toBeNull();
    expect(JSON.stringify(invalid)).not.toContain("must-not-escape");
  });

  it.each([
    [401, "digitalocean_authentication_failed"],
    [403, "digitalocean_authorization_failed"],
    [422, "digitalocean_validation_failed"],
    [429, "digitalocean_rate_limit_failed"]
  ])("classifies provider status %i without exposing its body", async (status, code) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(status, { message: "provider-private-body" }));
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    const error = await client
      .observe("POST", "/certificates", {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DigitalOceanProviderError);
    expect(error).toMatchObject({ code, status });
    expect(String(error)).not.toContain("provider-private-body");
  });

  it("classifies timeout and network ambiguity as a transport error", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network secret"));
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    const error = await client
      .observe("POST", "/certificates", {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DigitalOceanTransportError);
    expect(error).toMatchObject({ code: "digitalocean_transport_failed" });
    expect(String(error)).not.toContain("network secret");
  });

  it("uses observed certificate and Load Balancer resource endpoints", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(201, { certificate: { id: "certificate-id" } }))
      .mockResolvedValueOnce(response(202, { load_balancer: { id: "load-balancer-id" } }));
    const client = new DigitalOceanClient(
      "token-with-sufficient-private-length",
      fetchImplementation
    );

    await client.createManagedCertificate({
      name: "vera-m13a-do-cert-20260729-12",
      dnsNames: ["gateway-20260729-12.browser.verahousing.app"]
    });
    await client.createManagedLoadBalancer({
      name: "vera-m13a-do-lb-20260729-12",
      region: "nyc1",
      dropletId: 12,
      certificateId: "00000000-0000-4000-8000-000000000012"
    });

    expect(fetchImplementation.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.digitalocean.com/v2/certificates",
      "https://api.digitalocean.com/v2/load_balancers"
    ]);
    expect(JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body))).toEqual({
      name: "vera-m13a-do-cert-20260729-12",
      type: "lets_encrypt",
      dns_names: ["gateway-20260729-12.browser.verahousing.app"]
    });
    expect(JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body))).toMatchObject({
      name: "vera-m13a-do-lb-20260729-12",
      region: "nyc1",
      droplet_ids: [12],
      redirect_http_to_https: false,
      enable_proxy_protocol: false,
      forwarding_rules: [
        {
          entry_protocol: "https",
          entry_port: 443,
          target_protocol: "http",
          target_port: 18789,
          certificate_id: "00000000-0000-4000-8000-000000000012",
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
  });

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
