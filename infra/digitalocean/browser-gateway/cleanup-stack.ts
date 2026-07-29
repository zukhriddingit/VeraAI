import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertPrivateStackManifest,
  readMode0600File,
  requireDigitalOceanToken
} from "./config.ts";
import type { PrivateStackManifest } from "./config.ts";
import { DigitalOceanClient } from "./digitalocean-api.ts";
import type {
  DigitalOceanResourceKind,
  ResourceJournalEntry,
  ResourceJournalSnapshot
} from "./resource-journal.ts";
import { openResourceJournal } from "./resource-journal.ts";

export interface CleanupClient {
  deleteLoadBalancer(id: string): Promise<void>;
  deleteDomainRecord(domain: string, recordId: number): Promise<void>;
  deleteCertificate(id: string): Promise<void>;
  deleteDroplet(id: number): Promise<void>;
  deleteFirewall(id: string): Promise<void>;
  deleteSshKey(id: number): Promise<void>;
  deleteTag(name: string): Promise<void>;
}

export interface CleanupSummary {
  loadBalancerAbsent: boolean;
  domainRecordAbsent: boolean;
  certificateAbsent: boolean;
  dropletAbsent: boolean;
  firewallAbsent: boolean;
  sshKeyAbsent: boolean;
  tagAbsent: boolean;
  cleanupComplete: boolean;
}

export type JournalCleanupSummary = Record<DigitalOceanResourceKind, boolean> & {
  cleanupComplete: boolean;
};

export interface JournalCleanupActions {
  deleteResource(entry: ResourceJournalEntry): Promise<void>;
  resourceAbsent(entry: ResourceJournalEntry): Promise<boolean>;
}

export interface JournalCleanupState {
  snapshot(): ResourceJournalSnapshot;
  markCleanup(
    kind: DigitalOceanResourceKind,
    id: string,
    cleanupState: "delete_pending" | "deleted" | "delete_failed"
  ): Promise<void>;
}

const JOURNAL_CLEANUP_ORDER: readonly DigitalOceanResourceKind[] = [
  "load_balancer",
  "dns_record",
  "certificate",
  "droplet",
  "firewall",
  "ssh_key",
  "tag",
  "dns_zone"
];

export async function cleanupJournal(input: {
  journal: JournalCleanupState;
  actions: JournalCleanupActions;
}): Promise<JournalCleanupSummary> {
  const failures = new Set<DigitalOceanResourceKind>();
  for (const kind of JOURNAL_CLEANUP_ORDER) {
    const entries = input.journal
      .snapshot()
      .resources.filter((entry) => entry.kind === kind && entry.cleanupState !== "deleted");
    for (const entry of entries) {
      try {
        await input.journal.markCleanup(kind, entry.id, "delete_pending");
        await input.actions.deleteResource(entry);
        if (!(await input.actions.resourceAbsent(entry))) {
          throw new Error("journal_cleanup_absence_unverified");
        }
        await input.journal.markCleanup(kind, entry.id, "deleted");
      } catch {
        failures.add(kind);
        await input.journal.markCleanup(kind, entry.id, "delete_failed").catch(() => undefined);
      }
    }
  }

  const finalSnapshot = input.journal.snapshot();
  const summary = Object.fromEntries(
    JOURNAL_CLEANUP_ORDER.map((kind) => [
      kind,
      finalSnapshot.resources
        .filter((entry) => entry.kind === kind)
        .every((entry) => entry.cleanupState === "deleted")
    ])
  ) as Record<DigitalOceanResourceKind, boolean>;
  const result: JournalCleanupSummary = {
    ...summary,
    cleanupComplete: Object.values(summary).every(Boolean)
  };
  if (failures.size > 0 || !result.cleanupComplete) {
    const failedKinds = JOURNAL_CLEANUP_ORDER.filter(
      (kind) => failures.has(kind) || !summary[kind]
    );
    throw new Error(`journal_cleanup_incomplete:${failedKinds.join(",")}`);
  }
  return result;
}

export async function cleanupStack(input: {
  client: CleanupClient;
  manifest: PrivateStackManifest;
}): Promise<CleanupSummary> {
  const { client, manifest } = input;
  const summary: CleanupSummary = {
    loadBalancerAbsent: manifest.resourceIds.loadBalancer === null,
    domainRecordAbsent: manifest.resourceIds.domainRecord === null,
    certificateAbsent: manifest.resourceIds.certificate === null,
    dropletAbsent: manifest.resourceIds.droplet === null,
    firewallAbsent: manifest.resourceIds.firewall === null,
    sshKeyAbsent: manifest.resourceIds.sshKey === null,
    tagAbsent: false,
    cleanupComplete: false
  };

  const failures: string[] = [];
  const attempt = async (
    name: string,
    action: () => Promise<void>,
    markAbsent: () => void
  ): Promise<void> => {
    try {
      await action();
      markAbsent();
    } catch {
      failures.push(name);
    }
  };

  if (manifest.resourceIds.loadBalancer !== null) {
    const id = manifest.resourceIds.loadBalancer;
    await attempt(
      "load_balancer",
      () => client.deleteLoadBalancer(id),
      () => {
        summary.loadBalancerAbsent = true;
      }
    );
  }
  if (manifest.domain !== null && manifest.resourceIds.domainRecord !== null) {
    const domain = manifest.domain;
    const recordId = manifest.resourceIds.domainRecord;
    await attempt(
      "domain_record",
      () => client.deleteDomainRecord(domain, recordId),
      () => {
        summary.domainRecordAbsent = true;
      }
    );
  }
  if (manifest.resourceIds.certificate !== null) {
    const id = manifest.resourceIds.certificate;
    await attempt(
      "certificate",
      () => client.deleteCertificate(id),
      () => {
        summary.certificateAbsent = true;
      }
    );
  }
  if (manifest.resourceIds.droplet !== null) {
    const id = manifest.resourceIds.droplet;
    await attempt(
      "droplet",
      () => client.deleteDroplet(id),
      () => {
        summary.dropletAbsent = true;
      }
    );
  }
  if (manifest.resourceIds.firewall !== null) {
    const id = manifest.resourceIds.firewall;
    await attempt(
      "firewall",
      () => client.deleteFirewall(id),
      () => {
        summary.firewallAbsent = true;
      }
    );
  }
  if (manifest.resourceIds.sshKey !== null) {
    const id = manifest.resourceIds.sshKey;
    await attempt(
      "ssh_key",
      () => client.deleteSshKey(id),
      () => {
        summary.sshKeyAbsent = true;
      }
    );
  }
  await attempt(
    "tag",
    () => client.deleteTag(manifest.names.tag),
    () => {
      summary.tagAbsent = true;
    }
  );
  summary.cleanupComplete = Object.entries(summary)
    .filter(([key]) => key !== "cleanupComplete")
    .every(([, value]) => value === true);
  if (failures.length > 0) throw new Error(`cleanup_incomplete:${failures.join(",")}`);
  return summary;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) throw new Error(`missing_${name.slice(2)}`);
  return value;
}

function optionalArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) return null;
  return value;
}

async function main(): Promise<void> {
  const token = requireDigitalOceanToken(process.env.VERA_DO_API_TOKEN);
  const client = new DigitalOceanClient(token);
  const journalPath = optionalArgument("--journal");
  if (journalPath !== null) {
    const journal = await openResourceJournal({
      path: resolve(journalPath),
      runId: argument("--suffix")
    });
    const summary = await cleanupJournal({
      journal,
      actions: {
        deleteResource: async (entry) => {
          await client.deleteJournalResource(entry);
        },
        resourceAbsent: async (entry) => await client.journalResourceAbsent(entry)
      }
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }

  const manifestPath = resolve(argument("--manifest"));
  await readMode0600File(manifestPath, "private_stack_manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  assertPrivateStackManifest(manifest);
  const summary = await cleanupStack({ client, manifest });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
