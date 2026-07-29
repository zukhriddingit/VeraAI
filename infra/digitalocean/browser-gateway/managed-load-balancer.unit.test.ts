import { describe, expect, it, vi } from "vitest";

import type {
  DigitalOceanLoadBalancer,
  DigitalOceanResponseObservation
} from "./digitalocean-api.ts";
import { DigitalOceanTransportError } from "./digitalocean-api.ts";
import { cleanupManagedLoadBalancer, ensureManagedLoadBalancer } from "./managed-load-balancer.ts";
import type { ManagedLoadBalancerJournal } from "./managed-load-balancer.ts";
import type { ResourceCreatedInput, ResourceJournalEntry } from "./resource-journal.ts";

const NAME = "vera-m13a-do-lb-20260729-12";
const ID = "00000000-0000-4000-8000-000000000022";
const CERTIFICATE_ID = "00000000-0000-4000-8000-000000000012";
const RUN_START = "2026-07-29T16:00:00.000Z";
const RUN_END = "2026-07-29T16:20:00.000Z";

function loadBalancer(
  status: string,
  overrides: Partial<DigitalOceanLoadBalancer> = {}
): DigitalOceanLoadBalancer {
  return {
    id: ID,
    name: NAME,
    ip: status === "active" ? "203.0.113.12" : "",
    status,
    type: "REGIONAL",
    network: "EXTERNAL",
    networkStack: "IPV4",
    createdAtUtc: "2026-07-29T16:06:00.000Z",
    region: "nyc1",
    dropletIds: [12],
    forwardingRules: [
      {
        entryProtocol: "https",
        entryPort: 443,
        targetProtocol: "http",
        targetPort: 18789,
        certificateId: CERTIFICATE_ID,
        tlsPassthrough: false
      }
    ],
    healthCheck: {
      protocol: "tcp",
      port: 18789,
      checkIntervalSeconds: 10,
      responseTimeoutSeconds: 5,
      unhealthyThreshold: 3,
      healthyThreshold: 5
    },
    redirectHttpToHttps: false,
    enableProxyProtocol: false,
    ...overrides
  };
}

function observation(status: number, body: unknown): DigitalOceanResponseObservation {
  return {
    status,
    headers: {},
    bodyByteLength: Buffer.byteLength(JSON.stringify(body)),
    bodyTruncated: false,
    parsedBody: body
  };
}

class JournalDouble implements ManagedLoadBalancerJournal {
  readonly entries: ResourceJournalEntry[] = [];
  readonly events: string[];

  constructor(events: string[], entries: ResourceJournalEntry[] = []) {
    this.events = events;
    this.entries.push(...entries);
  }

  find(kind: "load_balancer", name: string): ResourceJournalEntry[] {
    return this.entries.filter((entry) => entry.kind === kind && entry.name === name);
  }

  async recordCreated(entry: ResourceCreatedInput): Promise<void> {
    this.events.push("journal_created");
    this.entries.push({ ...entry, cleanupState: "active" });
  }

  async updateStatus(kind: "load_balancer", id: string, status: string): Promise<void> {
    this.events.push(`journal_status:${status}`);
    const entry = this.entries.find((candidate) => candidate.kind === kind && candidate.id === id);
    if (entry) entry.status = status;
  }

  async markCleanup(
    kind: "load_balancer",
    id: string,
    cleanupState: "delete_pending" | "deleted" | "delete_failed"
  ): Promise<void> {
    this.events.push(`journal_cleanup:${cleanupState}`);
    const entry = this.entries.find((candidate) => candidate.kind === kind && candidate.id === id);
    if (entry) entry.cleanupState = cleanupState;
  }
}

function clientDouble(input: {
  create?: () => Promise<DigitalOceanResponseObservation>;
  list?: () => Promise<DigitalOceanLoadBalancer[]>;
  get?: () => Promise<DigitalOceanLoadBalancer | null>;
  remove?: () => Promise<void>;
}) {
  return {
    createManagedLoadBalancer:
      input.create ??
      vi.fn(async () => observation(202, { load_balancer: loadBalancer("active") })),
    listManagedLoadBalancers: input.list ?? vi.fn(async () => []),
    getManagedLoadBalancer: input.get ?? vi.fn(async () => loadBalancer("active")),
    deleteLoadBalancer: input.remove ?? vi.fn(async () => undefined)
  };
}

function baseInput(
  client: ReturnType<typeof clientDouble>,
  journal: JournalDouble,
  overrides: Record<string, unknown> = {}
) {
  return {
    client,
    journal,
    name: NAME,
    region: "nyc1",
    dropletId: 12,
    certificateId: CERTIFICATE_ID,
    runStartedAtUtc: RUN_START,
    runEndsAtUtc: RUN_END,
    now: () => new Date("2026-07-29T16:10:00.000Z"),
    sleep: vi.fn(async () => undefined),
    random: () => 0.5,
    pollIntervalMs: 1,
    timeoutMs: 20,
    ...overrides
  };
}

describe("managed DigitalOcean Load Balancer", () => {
  it.each([
    [202, "documented_create"],
    [200, "create_acknowledged_nonstandard"],
    [201, "create_acknowledged_nonstandard"]
  ] as const)(
    "persists an ID from HTTP %i before readback",
    async (status, acknowledgementClass) => {
      const events: string[] = [];
      const journal = new JournalDouble(events);
      const createDnsRecordAfterReadback = vi.fn(async () => {
        events.push("dns");
      });
      const client = clientDouble({
        create: vi.fn(async () => {
          events.push("create");
          return observation(status, {
            load_balancer: loadBalancer("new")
          });
        }),
        get: vi
          .fn()
          .mockImplementationOnce(async () => {
            events.push("get:new");
            return loadBalancer("new");
          })
          .mockImplementationOnce(async () => {
            events.push("get:active");
            return loadBalancer("active");
          })
      });

      await expect(
        ensureManagedLoadBalancer(baseInput(client, journal, { createDnsRecordAfterReadback }))
      ).resolves.toMatchObject({
        actualCreateStatus: status,
        acknowledgementClass,
        loadBalancerId: ID,
        finalStatus: "active",
        publicIpv4: "203.0.113.12",
        reconciliationOccurred: false
      });
      expect(events.indexOf("journal_created")).toBeLessThan(events.indexOf("get:new"));
      expect(events.indexOf("get:active")).toBeLessThan(events.indexOf("dns"));
    }
  );

  it("reconciles no-ID and transport-ambiguous creates exactly once", async () => {
    const noIdJournal = new JournalDouble([]);
    const noIdClient = clientDouble({
      create: vi.fn(async () => observation(200, { accepted: true })),
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([loadBalancer("active")])
    });
    await expect(
      ensureManagedLoadBalancer(baseInput(noIdClient, noIdJournal))
    ).resolves.toMatchObject({
      actualCreateStatus: 200,
      reconciliationOccurred: true,
      loadBalancerId: ID
    });

    const transportJournal = new JournalDouble([]);
    const create = vi.fn(async () => {
      throw new DigitalOceanTransportError();
    });
    const transportClient = clientDouble({
      create,
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([loadBalancer("active")])
    });
    await expect(
      ensureManagedLoadBalancer(baseInput(transportClient, transportJournal))
    ).resolves.toMatchObject({
      actualCreateStatus: null,
      acknowledgementClass: "transport_reconciled",
      reconciliationOccurred: true
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("resumes a journaled ID without another create", async () => {
    const entry: ResourceJournalEntry = {
      kind: "load_balancer",
      name: NAME,
      id: ID,
      status: "new",
      createdAtUtc: "2026-07-29T16:06:00.000Z",
      cleanupState: "active"
    };
    const create = vi.fn(async () => observation(202, { load_balancer: loadBalancer("active") }));
    const client = clientDouble({ create });

    await expect(
      ensureManagedLoadBalancer(baseInput(client, new JournalDouble([], [entry])))
    ).resolves.toMatchObject({
      acknowledgementClass: "resumed_from_journal",
      loadBalancerId: ID
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { forwardingRules: [], label: "forwarding rule" },
    {
      healthCheck: {
        protocol: "http",
        port: 80,
        checkIntervalSeconds: 10,
        responseTimeoutSeconds: 5,
        unhealthyThreshold: 3,
        healthyThreshold: 5
      },
      label: "health check"
    },
    { redirectHttpToHttps: true, label: "redirect" },
    { enableProxyProtocol: true, label: "PROXY protocol" },
    { dropletIds: [12, 13], label: "extra backend" },
    { network: "INTERNAL", label: "internal network" },
    { type: "GLOBAL", label: "global type" },
    { networkStack: "DUALSTACK", label: "dual stack" }
  ])("rejects an unexpected $label", async (mismatch) => {
    const { label: _label, ...overrides } = mismatch;
    const client = clientDouble({
      get: vi.fn(async () => loadBalancer("active", overrides))
    });
    await expect(
      ensureManagedLoadBalancer(baseInput(client, new JournalDouble([])))
    ).rejects.toThrow("managed_load_balancer_identity_mismatch");
  });

  it("rejects multiple exact-name resources and terminal provider states", async () => {
    const duplicates = clientDouble({
      list: vi.fn(async () => [
        loadBalancer("active"),
        loadBalancer("active", {
          id: "00000000-0000-4000-8000-000000000023"
        })
      ])
    });
    await expect(
      ensureManagedLoadBalancer(baseInput(duplicates, new JournalDouble([])))
    ).rejects.toThrow("managed_load_balancer_multiple_matches");

    const errored = clientDouble({
      get: vi.fn(async () => loadBalancer("errored"))
    });
    await expect(
      ensureManagedLoadBalancer(baseInput(errored, new JournalDouble([])))
    ).rejects.toThrow("managed_load_balancer_error");
  });

  it("cleans up only the persisted ID and verifies absence", async () => {
    const entry: ResourceJournalEntry = {
      kind: "load_balancer",
      name: NAME,
      id: ID,
      status: "active",
      createdAtUtc: "2026-07-29T16:06:00.000Z",
      cleanupState: "active"
    };
    const events: string[] = [];
    const journal = new JournalDouble(events, [entry]);
    const remove = vi.fn(async () => undefined);
    const client = clientDouble({
      remove,
      get: vi.fn(async () => null)
    });

    await expect(
      cleanupManagedLoadBalancer({
        ...baseInput(client, journal)
      })
    ).resolves.toEqual({
      loadBalancerAbsent: true,
      loadBalancerId: ID,
      reconciled: false
    });
    expect(remove).toHaveBeenCalledWith(ID);
    expect(events).toEqual(["journal_cleanup:delete_pending", "journal_cleanup:deleted"]);
  });
});
