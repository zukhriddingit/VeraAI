import { describe, expect, it, vi } from "vitest";

import type {
  DigitalOceanCertificate,
  DigitalOceanResponseObservation
} from "./digitalocean-api.ts";
import { DigitalOceanProviderError, DigitalOceanTransportError } from "./digitalocean-api.ts";
import { cleanupManagedCertificate, ensureManagedCertificate } from "./managed-certificate.ts";
import type { ManagedCertificateJournal } from "./managed-certificate.ts";
import type { ResourceCreatedInput, ResourceJournalEntry } from "./resource-journal.ts";

const NAME = "vera-m13a-do-cert-20260729-12";
const DNS_NAME = "gateway-20260729-12.browser.example.test";
const ID = "00000000-0000-4000-8000-000000000012";
const RUN_START = "2026-07-29T16:00:00.000Z";
const RUN_END = "2026-07-29T16:20:00.000Z";

function certificate(
  state: string,
  overrides: Partial<DigitalOceanCertificate> = {}
): DigitalOceanCertificate {
  return {
    id: ID,
    name: NAME,
    dnsNames: [DNS_NAME],
    type: "lets_encrypt",
    state,
    createdAtUtc: "2026-07-29T16:05:00.000Z",
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

class JournalDouble implements ManagedCertificateJournal {
  readonly entries: ResourceJournalEntry[] = [];
  readonly events: string[];

  constructor(events: string[], entries: ResourceJournalEntry[] = []) {
    this.events = events;
    this.entries.push(...entries);
  }

  find(kind: "certificate", name: string): ResourceJournalEntry[] {
    return this.entries.filter((entry) => entry.kind === kind && entry.name === name);
  }

  async recordCreated(entry: ResourceCreatedInput): Promise<void> {
    this.events.push("journal_created");
    this.entries.push({ ...entry, cleanupState: "active" });
  }

  async updateStatus(kind: "certificate", id: string, status: string): Promise<void> {
    this.events.push(`journal_status:${status}`);
    const entry = this.entries.find((candidate) => candidate.kind === kind && candidate.id === id);
    if (entry) entry.status = status;
  }

  async markCleanup(
    kind: "certificate",
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
  list?: () => Promise<DigitalOceanCertificate[]>;
  get?: () => Promise<DigitalOceanCertificate | null>;
  remove?: () => Promise<void>;
}) {
  return {
    createManagedCertificate:
      input.create ?? vi.fn(async () => observation(201, { certificate: certificate("verified") })),
    listManagedCertificates: input.list ?? vi.fn(async () => []),
    getManagedCertificate: input.get ?? vi.fn(async () => certificate("verified")),
    deleteCertificate: input.remove ?? vi.fn(async () => undefined)
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
    dnsNames: [DNS_NAME],
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

describe("managed DigitalOcean certificate", () => {
  it.each([
    [201, "documented_create"],
    [200, "create_acknowledged_nonstandard"],
    [202, "create_acknowledged_nonstandard"]
  ] as const)(
    "persists an ID from HTTP %i before readback",
    async (status, acknowledgementClass) => {
      const events: string[] = [];
      const journal = new JournalDouble(events);
      const client = clientDouble({
        create: vi.fn(async () => {
          events.push("create");
          return observation(status, {
            certificate: certificate("pending")
          });
        }),
        get: vi
          .fn()
          .mockImplementationOnce(async () => {
            events.push("get");
            return certificate("pending");
          })
          .mockImplementationOnce(async () => {
            events.push("get");
            return certificate("verified");
          })
      });

      await expect(ensureManagedCertificate(baseInput(client, journal))).resolves.toMatchObject({
        actualCreateStatus: status,
        acknowledgementClass,
        certificateId: ID,
        finalState: "verified",
        reconciliationOccurred: false
      });
      expect(events.indexOf("journal_created")).toBeLessThan(events.indexOf("get"));
    }
  );

  it("normalizes a whole-second create timestamp before journal persistence", async () => {
    const events: string[] = [];
    const journal = new JournalDouble(events);
    const client = clientDouble({
      create: vi.fn(async () =>
        observation(202, {
          certificate: {
            id: ID,
            state: "pending",
            created_at: "2026-07-29T16:05:00Z"
          }
        })
      ),
      get: vi.fn(async () => {
        events.push("get");
        return certificate("verified");
      })
    });

    await expect(ensureManagedCertificate(baseInput(client, journal))).resolves.toMatchObject({
      actualCreateStatus: 202,
      acknowledgementClass: "create_acknowledged_nonstandard",
      finalState: "verified"
    });
    expect(journal.entries[0]?.createdAtUtc).toBe("2026-07-29T16:05:00.000Z");
    expect(events.indexOf("journal_created")).toBeLessThan(events.indexOf("get"));
  });

  it("rejects a malformed create timestamp before journal persistence", async () => {
    const journal = new JournalDouble([]);
    const get = vi.fn(async () => certificate("verified"));
    const client = clientDouble({
      create: vi.fn(async () =>
        observation(202, {
          certificate: {
            id: ID,
            state: "pending",
            created_at: "2026-02-30T12:00:00Z"
          }
        })
      ),
      get
    });

    await expect(ensureManagedCertificate(baseInput(client, journal))).rejects.toThrow(
      "certificate_response_rejected"
    );
    expect(journal.entries).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("reconciles one exact certificate when an alternate 2xx has no ID", async () => {
    const events: string[] = [];
    const journal = new JournalDouble(events);
    const client = clientDouble({
      create: vi.fn(async () => observation(202, { accepted: true })),
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([certificate("verified")]),
      get: vi.fn(async () => certificate("verified"))
    });

    await expect(ensureManagedCertificate(baseInput(client, journal))).resolves.toMatchObject({
      actualCreateStatus: 202,
      acknowledgementClass: "create_acknowledged_nonstandard",
      certificateId: ID,
      reconciliationOccurred: true
    });
    expect(events).toContain("journal_created");
  });

  it("reconciles after transport ambiguity without creating again", async () => {
    const journal = new JournalDouble([]);
    const create = vi.fn(async () => {
      throw new DigitalOceanTransportError();
    });
    const client = clientDouble({
      create,
      list: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([certificate("verified")])
    });

    await expect(ensureManagedCertificate(baseInput(client, journal))).resolves.toMatchObject({
      actualCreateStatus: null,
      acknowledgementClass: "transport_reconciled",
      reconciliationOccurred: true
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("resumes the exact journaled ID without another create", async () => {
    const entry: ResourceJournalEntry = {
      kind: "certificate",
      name: NAME,
      id: ID,
      status: "pending",
      createdAtUtc: "2026-07-29T16:05:00.000Z",
      cleanupState: "active"
    };
    const journal = new JournalDouble([], [entry]);
    const create = vi.fn(async () => observation(201, { certificate: certificate("verified") }));
    const client = clientDouble({ create });

    await expect(ensureManagedCertificate(baseInput(client, journal))).resolves.toMatchObject({
      actualCreateStatus: null,
      acknowledgementClass: "resumed_from_journal",
      certificateId: ID
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects duplicate exact matches and another run's identity", async () => {
    const duplicateClient = clientDouble({
      list: vi.fn(async () => [
        certificate("verified"),
        certificate("pending", {
          id: "00000000-0000-4000-8000-000000000013"
        })
      ])
    });
    await expect(
      ensureManagedCertificate(baseInput(duplicateClient, new JournalDouble([])))
    ).rejects.toThrow("managed_certificate_multiple_matches");

    const oldClient = clientDouble({
      list: vi.fn(async () => [
        certificate("verified", {
          createdAtUtc: "2026-07-28T16:05:00.000Z"
        })
      ])
    });
    await expect(
      ensureManagedCertificate(baseInput(oldClient, new JournalDouble([])))
    ).rejects.toThrow("managed_certificate_identity_mismatch");
  });

  it("fails closed on provider error, terminal error, and timeout", async () => {
    const providerClient = clientDouble({
      create: vi.fn(async () => {
        throw new DigitalOceanProviderError("digitalocean_validation_failed", 422);
      })
    });
    await expect(
      ensureManagedCertificate(baseInput(providerClient, new JournalDouble([])))
    ).rejects.toMatchObject({
      code: "digitalocean_validation_failed",
      status: 422
    });

    const terminalClient = clientDouble({
      get: vi.fn(async () => certificate("error"))
    });
    await expect(
      ensureManagedCertificate(baseInput(terminalClient, new JournalDouble([])))
    ).rejects.toThrow("managed_certificate_error");

    let time = Date.parse("2026-07-29T16:10:00.000Z");
    const timeoutClient = clientDouble({
      get: vi.fn(async () => certificate("pending"))
    });
    await expect(
      ensureManagedCertificate(
        baseInput(timeoutClient, new JournalDouble([]), {
          now: () => new Date(time),
          sleep: vi.fn(async (milliseconds: number) => {
            time += milliseconds;
          }),
          timeoutMs: 3,
          pollIntervalMs: 2
        })
      )
    ).rejects.toThrow("managed_certificate_verification_timeout");
  });

  it("cleans up only the persisted ID and verifies absence", async () => {
    const entry: ResourceJournalEntry = {
      kind: "certificate",
      name: NAME,
      id: ID,
      status: "verified",
      createdAtUtc: "2026-07-29T16:05:00.000Z",
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
      cleanupManagedCertificate({
        client,
        journal,
        name: NAME,
        dnsNames: [DNS_NAME],
        runStartedAtUtc: RUN_START,
        runEndsAtUtc: RUN_END
      })
    ).resolves.toEqual({
      certificateAbsent: true,
      certificateId: ID,
      reconciled: false
    });
    expect(remove).toHaveBeenCalledWith(ID);
    expect(events).toEqual(["journal_cleanup:delete_pending", "journal_cleanup:deleted"]);
  });
});
