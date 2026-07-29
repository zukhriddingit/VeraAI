import { chmod, lstat, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openResourceJournal, writeResourceJournalSnapshotAtomic } from "./resource-journal.ts";
import type { DigitalOceanResourceKind, ResourceJournalSnapshot } from "./resource-journal.ts";

const temporaryDirectories: string[] = [];
const fixedInstant = new Date("2026-07-29T20:00:00.000Z");
const fixedNow = (): Date => new Date(fixedInstant);

async function privateDirectory(mode = 0o700): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vera-do-journal-"));
  await chmod(directory, mode);
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function emptySnapshot(): ResourceJournalSnapshot {
  return {
    schemaVersion: 1,
    runId: "20260729-12",
    createdAtUtc: fixedInstant.toISOString(),
    updatedAtUtc: fixedInstant.toISOString(),
    resources: []
  };
}

describe("DigitalOcean private resource journal", () => {
  it("creates a closed mode-0600 journal in a mode-0700 directory", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "resources.json");
    const journal = await openResourceJournal({
      path,
      runId: "20260729-12",
      now: fixedNow
    });

    await journal.recordCreated({
      kind: "certificate",
      name: "vera-m13a-do-cert-20260729-12",
      id: "00000000-0000-4000-8000-000000000012",
      status: "pending",
      createdAtUtc: fixedInstant.toISOString()
    });

    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(path, "utf8")) as ResourceJournalSnapshot;
    expect(stored).toMatchObject({
      schemaVersion: 1,
      runId: "20260729-12",
      resources: [
        {
          kind: "certificate",
          name: "vera-m13a-do-cert-20260729-12",
          id: "00000000-0000-4000-8000-000000000012",
          status: "pending",
          cleanupState: "active"
        }
      ]
    });
    expect(Object.keys(stored).sort()).toEqual(
      ["createdAtUtc", "resources", "runId", "schemaVersion", "updatedAtUtc"].sort()
    );
  });

  it.each([
    "dns_zone",
    "certificate",
    "droplet",
    "firewall",
    "tag",
    "ssh_key",
    "load_balancer",
    "dns_record"
  ] satisfies DigitalOceanResourceKind[])("supports the closed resource kind %s", async (kind) => {
    const directory = await privateDirectory();
    const journal = await openResourceJournal({
      path: join(directory, "resources.json"),
      runId: "20260729-12",
      now: fixedNow
    });

    await journal.recordCreated({
      kind,
      name: `vera-${kind.replaceAll("_", "-")}-20260729-12`,
      id: `${kind}:12`,
      status: "created",
      createdAtUtc: fixedInstant.toISOString()
    });

    expect(journal.find(kind, `vera-${kind.replaceAll("_", "-")}-20260729-12`)).toHaveLength(1);
  });

  it("updates provider and cleanup state through atomic replacements", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "resources.json");
    const journal = await openResourceJournal({
      path,
      runId: "20260729-12",
      now: fixedNow
    });
    await journal.recordCreated({
      kind: "load_balancer",
      name: "vera-m13a-do-lb-20260729-12",
      id: "00000000-0000-4000-8000-000000000013",
      status: "new",
      createdAtUtc: fixedInstant.toISOString()
    });
    await journal.updateStatus("load_balancer", "00000000-0000-4000-8000-000000000013", "active");
    await journal.markCleanup(
      "load_balancer",
      "00000000-0000-4000-8000-000000000013",
      "delete_pending"
    );
    await journal.markCleanup("load_balancer", "00000000-0000-4000-8000-000000000013", "deleted");

    expect(journal.find("load_balancer", "vera-m13a-do-lb-20260729-12")[0]).toMatchObject({
      status: "active",
      cleanupState: "deleted"
    });
    expect((await readdir(directory)).sort()).toEqual(["resources.json"]);
  });

  it("keeps the prior journal intact when an atomic replacement is interrupted", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "resources.json");
    const snapshot = emptySnapshot();
    await writeResourceJournalSnapshotAtomic(path, snapshot);
    const original = await readFile(path, "utf8");

    await expect(
      writeResourceJournalSnapshotAtomic(
        path,
        {
          ...snapshot,
          updatedAtUtc: "2026-07-29T20:00:01.000Z",
          resources: [
            {
              kind: "certificate",
              name: "vera-m13a-do-cert-20260729-12",
              id: "00000000-0000-4000-8000-000000000012",
              status: "pending",
              createdAtUtc: fixedInstant.toISOString(),
              cleanupState: "active"
            }
          ]
        },
        {
          beforeRename: vi.fn().mockRejectedValue(new Error("simulated_interruption"))
        }
      )
    ).rejects.toThrow("simulated_interruption");

    expect(await readFile(path, "utf8")).toBe(original);
    expect((await readdir(directory)).sort()).toEqual(["resources.json"]);
  });

  it("reopens an existing journal and resumes exact entries", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "resources.json");
    const first = await openResourceJournal({
      path,
      runId: "20260729-12",
      now: fixedNow
    });
    await first.recordCreated({
      kind: "certificate",
      name: "vera-m13a-do-cert-20260729-12",
      id: "00000000-0000-4000-8000-000000000012",
      status: "pending",
      createdAtUtc: fixedInstant.toISOString()
    });

    const resumed = await openResourceJournal({
      path,
      runId: "20260729-12",
      now: fixedNow
    });
    expect(resumed.find("certificate", "vera-m13a-do-cert-20260729-12")).toHaveLength(1);
    await resumed.recordCreated({
      kind: "certificate",
      name: "vera-m13a-do-cert-20260729-12",
      id: "00000000-0000-4000-8000-000000000012",
      status: "pending",
      createdAtUtc: fixedInstant.toISOString()
    });
    expect(resumed.snapshot().resources).toHaveLength(1);
  });

  it("rejects a different provider ID for an existing exact resource", async () => {
    const directory = await privateDirectory();
    const journal = await openResourceJournal({
      path: join(directory, "resources.json"),
      runId: "20260729-12",
      now: fixedNow
    });
    await journal.recordCreated({
      kind: "certificate",
      name: "vera-m13a-do-cert-20260729-12",
      id: "00000000-0000-4000-8000-000000000012",
      status: "pending",
      createdAtUtc: fixedInstant.toISOString()
    });

    await expect(
      journal.recordCreated({
        kind: "certificate",
        name: "vera-m13a-do-cert-20260729-12",
        id: "00000000-0000-4000-8000-000000000099",
        status: "pending",
        createdAtUtc: fixedInstant.toISOString()
      })
    ).rejects.toThrow("resource_journal_identity_conflict");
  });

  it("rejects unsafe directory, file, symlink, run ID, and secret-shaped content", async () => {
    const broadDirectory = await privateDirectory(0o755);
    await expect(
      openResourceJournal({
        path: join(broadDirectory, "resources.json"),
        runId: "20260729-12",
        now: fixedNow
      })
    ).rejects.toThrow("resource_journal_directory_mode_rejected");

    const directory = await privateDirectory();
    const broadFile = join(directory, "broad.json");
    await writeFile(broadFile, `${JSON.stringify(emptySnapshot())}\n`, { mode: 0o644 });
    await expect(
      openResourceJournal({ path: broadFile, runId: "20260729-12", now: fixedNow })
    ).rejects.toThrow("resource_journal_file_mode_rejected");

    const target = join(directory, "target.json");
    const linked = join(directory, "linked.json");
    await writeFile(target, `${JSON.stringify(emptySnapshot())}\n`, { mode: 0o600 });
    await symlink(target, linked);
    await expect(
      openResourceJournal({ path: linked, runId: "20260729-12", now: fixedNow })
    ).rejects.toThrow("resource_journal_file_rejected");

    await expect(
      openResourceJournal({
        path: join(directory, "invalid-run.json"),
        runId: "../other-run",
        now: fixedNow
      })
    ).rejects.toThrow("resource_journal_run_id_rejected");

    const journal = await openResourceJournal({
      path: join(directory, "safe.json"),
      runId: "20260729-12",
      now: fixedNow
    });
    await expect(
      journal.recordCreated({
        kind: "tag",
        name: "vera-m13a-do-20260729-12",
        id: `dop_v1_${"a".repeat(64)}`,
        status: "created",
        createdAtUtc: fixedInstant.toISOString()
      })
    ).rejects.toThrow("resource_journal_secret_rejected");
  });

  it("rejects unknown fields and resource kinds when reopening", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "resources.json");
    await writeFile(
      path,
      `${JSON.stringify({
        ...emptySnapshot(),
        resources: [
          {
            kind: "database",
            name: "vera-database-20260729-12",
            id: "12",
            status: "created",
            createdAtUtc: fixedInstant.toISOString(),
            cleanupState: "active",
            authorization: "forbidden"
          }
        ]
      })}\n`,
      { mode: 0o600 }
    );

    await expect(
      openResourceJournal({ path, runId: "20260729-12", now: fixedNow })
    ).rejects.toThrow("resource_journal_rejected");
  });
});
