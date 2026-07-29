import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupJournal, cleanupStack } from "./cleanup-stack.ts";
import { createDiagnosticsStack } from "./create-diagnostics-stack.ts";
import type { CreateStackClient } from "./create-diagnostics-stack.ts";
import { openResourceJournal } from "./resource-journal.ts";
import type { DigitalOceanResourceKind, ResourceCreatedInput } from "./resource-journal.ts";

const temporaryDirectories: string[] = [];

async function privateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vera-do-lifecycle-"));
  await chmod(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

async function lifecycleJournal(directory: string, events: string[]) {
  const journal = await openResourceJournal({
    path: join(directory, "resources.json"),
    runId: "20260729-10",
    now: () => new Date("2026-07-29T12:00:00.000Z")
  });
  return {
    snapshot: () => journal.snapshot(),
    async recordCreated(entry: ResourceCreatedInput): Promise<void> {
      events.push(`journal_${entry.kind}`);
      await journal.recordCreated(entry);
    },
    async markCleanup(
      kind: DigitalOceanResourceKind,
      id: string,
      cleanupState: "delete_pending" | "deleted" | "delete_failed"
    ): Promise<void> {
      events.push(`journal_cleanup:${kind}:${cleanupState}`);
      await journal.markCleanup(kind, id, cleanupState);
    }
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

function client(events: string[], failAt?: string): CreateStackClient {
  const event = async (name: string): Promise<void> => {
    events.push(name);
    if (name === failAt) throw new Error(`${name}_failed`);
  };
  return {
    async createTag() {
      await event("create_tag");
    },
    async createFirewall() {
      await event("create_firewall");
      return { id: "firewall-id" };
    },
    async createSshKey() {
      await event("create_ssh_key");
      return { id: 11 };
    },
    async createDroplet() {
      await event("create_droplet");
      return { id: 12, name: "vera", status: "new", networks: { v4: [] } };
    },
    async getDroplet() {
      return null;
    },
    async deleteLoadBalancer() {
      await event("delete_load_balancer");
    },
    async deleteDomainRecord() {
      await event("delete_domain_record");
    },
    async deleteCertificate() {
      await event("delete_certificate");
    },
    async deleteDroplet() {
      await event("delete_droplet");
    },
    async deleteFirewall() {
      await event("delete_firewall");
    },
    async deleteSshKey() {
      await event("delete_ssh_key");
    },
    async deleteTag() {
      await event("delete_tag");
    }
  };
}

const activeDroplet = {
  id: 12,
  name: "vera",
  status: "active",
  networks: {
    v4: [
      { ip_address: "203.0.113.7", type: "public" as const, version: 4 as const },
      { ip_address: "10.1.0.2", type: "private" as const, version: 4 as const }
    ]
  }
};

describe("DigitalOcean diagnostics stack lifecycle", () => {
  it("creates firewall-before-Droplet and writes only private state", async () => {
    const events: string[] = [];
    const directory = await privateDirectory();
    const journal = await lifecycleJournal(directory, events);
    const manifest = await createDiagnosticsStack({
      client: client(events),
      journal,
      suffix: "20260729-10",
      operatorIpv4: "203.0.113.9",
      publicKey: `ssh-ed25519 ${"A".repeat(48)} vera-test`,
      cloudInit: "#cloud-config\n",
      manifestPath: join(directory, "manifest.json"),
      now: () => new Date("2026-07-29T12:00:00Z"),
      waitForActive: vi.fn(async () => {
        events.push("poll_droplet");
        return activeDroplet;
      })
    });
    expect(events).toEqual([
      "create_tag",
      "journal_tag",
      "create_firewall",
      "journal_firewall",
      "create_ssh_key",
      "journal_ssh_key",
      "create_droplet",
      "journal_droplet",
      "poll_droplet"
    ]);
    expect(JSON.stringify(manifest)).not.toContain("Authorization");
    expect(manifest.resourceIds).toMatchObject({
      droplet: 12,
      firewall: "firewall-id",
      sshKey: 11
    });
  });

  it("rolls back a partial create in reverse dependency order", async () => {
    const events: string[] = [];
    const directory = await privateDirectory();
    const journal = await lifecycleJournal(directory, events);
    await expect(
      createDiagnosticsStack({
        client: client(events, "create_droplet"),
        journal,
        suffix: "20260729-10",
        operatorIpv4: "203.0.113.9",
        publicKey: `ssh-ed25519 ${"A".repeat(48)} vera-test`,
        cloudInit: "#cloud-config\n",
        manifestPath: join(directory, "manifest.json")
      })
    ).rejects.toThrow("create_droplet_failed");
    expect(events).toEqual([
      "create_tag",
      "journal_tag",
      "create_firewall",
      "journal_firewall",
      "create_ssh_key",
      "journal_ssh_key",
      "create_droplet",
      "journal_cleanup:firewall:delete_pending",
      "delete_firewall",
      "journal_cleanup:firewall:deleted",
      "journal_cleanup:ssh_key:delete_pending",
      "delete_ssh_key",
      "journal_cleanup:ssh_key:deleted",
      "journal_cleanup:tag:delete_pending",
      "delete_tag",
      "journal_cleanup:tag:deleted"
    ]);
  });

  it("cleans a restarted journal in dependency order and persists every result", async () => {
    const directory = await privateDirectory();
    const journal = await openResourceJournal({
      path: join(directory, "resources.json"),
      runId: "20260729-10",
      now: () => new Date("2026-07-29T12:00:00.000Z")
    });
    const kinds: DigitalOceanResourceKind[] = [
      "dns_zone",
      "certificate",
      "droplet",
      "firewall",
      "tag",
      "ssh_key",
      "load_balancer",
      "dns_record"
    ];
    for (const [index, kind] of kinds.entries()) {
      await journal.recordCreated({
        kind,
        name: `resource-${kind}`,
        id: `resource-${index + 1}`,
        status: "created",
        createdAtUtc: "2026-07-29T12:00:00.000Z"
      });
    }
    const restarted = await openResourceJournal({
      path: join(directory, "resources.json"),
      runId: "20260729-10"
    });
    const deletions: string[] = [];
    const summary = await cleanupJournal({
      journal: restarted,
      actions: {
        async deleteResource(entry) {
          deletions.push(entry.kind);
        },
        async resourceAbsent() {
          return true;
        }
      }
    });

    expect(deletions).toEqual([
      "load_balancer",
      "dns_record",
      "certificate",
      "droplet",
      "firewall",
      "ssh_key",
      "tag",
      "dns_zone"
    ]);
    expect(summary.cleanupComplete).toBe(true);
    expect(restarted.snapshot().resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ cleanupState: "deleted" })])
    );
    expect(restarted.snapshot().resources.every((entry) => entry.cleanupState === "deleted")).toBe(
      true
    );
  });

  it("continues journal cleanup after a provider failure", async () => {
    const directory = await privateDirectory();
    const journal = await openResourceJournal({
      path: join(directory, "resources.json"),
      runId: "20260729-10"
    });
    for (const kind of ["droplet", "firewall", "ssh_key", "tag"] as const) {
      await journal.recordCreated({
        kind,
        name: `resource-${kind}`,
        id: `resource-${kind}`,
        status: "created",
        createdAtUtc: "2026-07-29T12:00:00.000Z"
      });
    }
    const deletions: string[] = [];
    await expect(
      cleanupJournal({
        journal,
        actions: {
          async deleteResource(entry) {
            deletions.push(entry.kind);
            if (entry.kind === "firewall") throw new Error("private failure");
          },
          async resourceAbsent() {
            return true;
          }
        }
      })
    ).rejects.toThrow("journal_cleanup_incomplete:firewall");
    expect(deletions).toEqual(["droplet", "firewall", "ssh_key", "tag"]);
    expect(
      journal.snapshot().resources.find((entry) => entry.kind === "firewall")?.cleanupState
    ).toBe("delete_failed");
  });

  it("cleans all optional resources in dependency order", async () => {
    const events: string[] = [];
    const summary = await cleanupStack({
      client: client(events),
      manifest: {
        schemaVersion: 1,
        createdAtUtc: "2026-07-29T12:00:00Z",
        region: "nyc1",
        names: {
          droplet: "vera-droplet",
          firewall: "vera-firewall",
          tag: "vera-tag",
          sshKey: "vera-key"
        },
        resourceIds: {
          droplet: 1,
          firewall: "firewall-id",
          sshKey: 2,
          loadBalancer: "lb-id",
          certificate: "certificate-id",
          domainRecord: 3
        },
        domain: "browser-staging.example.test",
        publicIpv4: null,
        privateIpv4: null,
        cleanupRequired: true
      }
    });
    expect(events).toEqual([
      "delete_load_balancer",
      "delete_domain_record",
      "delete_certificate",
      "delete_droplet",
      "delete_firewall",
      "delete_ssh_key",
      "delete_tag"
    ]);
    expect(summary.cleanupComplete).toBe(true);
  });

  it("continues cleanup after one provider failure and reports only resource-kind codes", async () => {
    const events: string[] = [];
    await expect(
      cleanupStack({
        client: client(events, "delete_firewall"),
        manifest: {
          schemaVersion: 1,
          createdAtUtc: "2026-07-29T12:00:00Z",
          region: "nyc1",
          names: {
            droplet: "vera-droplet",
            firewall: "vera-firewall",
            tag: "vera-tag",
            sshKey: "vera-key"
          },
          resourceIds: {
            droplet: 1,
            firewall: "firewall-id",
            sshKey: 2,
            loadBalancer: null,
            certificate: null,
            domainRecord: null
          },
          domain: null,
          publicIpv4: null,
          privateIpv4: null,
          cleanupRequired: true
        }
      })
    ).rejects.toThrow("cleanup_incomplete:firewall");
    expect(events).toEqual(["delete_droplet", "delete_firewall", "delete_ssh_key", "delete_tag"]);
  });
});
