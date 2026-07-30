import type {
  DigitalOceanCertificate,
  DigitalOceanResponseObservation
} from "./digitalocean-api.ts";
import { DigitalOceanTransportError, normalizeDigitalOceanInstant } from "./digitalocean-api.ts";
import type {
  ResourceCleanupState,
  ResourceCreatedInput,
  ResourceJournalEntry
} from "./resource-journal.ts";

export type ManagedCertificateAcknowledgementClass =
  | "documented_create"
  | "create_acknowledged_nonstandard"
  | "transport_reconciled"
  | "reconciled_before_create"
  | "resumed_from_journal";

export interface ManagedCertificateJournal {
  find(kind: "certificate", name: string): ResourceJournalEntry[];
  recordCreated(entry: ResourceCreatedInput): Promise<void>;
  updateStatus(kind: "certificate", id: string, status: string): Promise<void>;
  markCleanup(
    kind: "certificate",
    id: string,
    cleanupState: Exclude<ResourceCleanupState, "active">
  ): Promise<void>;
}

export interface ManagedCertificateClient {
  createManagedCertificate(input: {
    name: string;
    dnsNames: string[];
  }): Promise<DigitalOceanResponseObservation>;
  listManagedCertificates(name?: string): Promise<DigitalOceanCertificate[]>;
  getManagedCertificate(
    id: string,
    acceptNotFound?: boolean
  ): Promise<DigitalOceanCertificate | null>;
  deleteCertificate(id: string): Promise<void>;
}

export interface EnsureManagedCertificateInput {
  client: ManagedCertificateClient;
  journal: ManagedCertificateJournal;
  name: string;
  dnsNames: string[];
  runStartedAtUtc: string;
  runEndsAtUtc: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ManagedCertificateResult {
  actualCreateStatus: number | null;
  acknowledgementClass: ManagedCertificateAcknowledgementClass;
  certificateId: string;
  finalState: "verified";
  reconciliationOccurred: boolean;
}

export interface ManagedCertificateCleanupResult {
  certificateAbsent: boolean;
  certificateId: string | null;
  reconciled: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

function exactDnsNames(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function instant(value: string, code: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(code);
  return timestamp;
}

function assertIdentity(
  certificate: DigitalOceanCertificate,
  input: {
    name: string;
    dnsNames: string[];
    runStartedAtUtc: string;
    runEndsAtUtc: string;
    expectedId?: string;
  }
): void {
  const createdAt = instant(certificate.createdAtUtc, "managed_certificate_identity_mismatch");
  const runStartedAt = instant(input.runStartedAtUtc, "managed_certificate_run_window_rejected");
  const runEndsAt = instant(input.runEndsAtUtc, "managed_certificate_run_window_rejected");
  if (
    runEndsAt < runStartedAt ||
    certificate.name !== input.name ||
    certificate.type !== "lets_encrypt" ||
    !exactDnsNames(certificate.dnsNames, input.dnsNames) ||
    createdAt < runStartedAt ||
    createdAt > runEndsAt ||
    (input.expectedId !== undefined && certificate.id !== input.expectedId)
  ) {
    throw new Error("managed_certificate_identity_mismatch");
  }
}

function certificateBody(
  observation: DigitalOceanResponseObservation
): Record<string, unknown> | null {
  if (
    typeof observation.parsedBody !== "object" ||
    observation.parsedBody === null ||
    Array.isArray(observation.parsedBody)
  ) {
    return null;
  }
  const certificate = (observation.parsedBody as Record<string, unknown>).certificate;
  return typeof certificate === "object" && certificate !== null && !Array.isArray(certificate)
    ? (certificate as Record<string, unknown>)
    : null;
}

function returnedIdentity(
  observation: DigitalOceanResponseObservation
): { id: string; status: string; createdAtUtc: string | null } | null {
  const certificate = certificateBody(observation);
  if (certificate === null || typeof certificate.id !== "string") return null;
  if (!UUID.test(certificate.id)) return null;
  return {
    id: certificate.id,
    status: typeof certificate.state === "string" ? certificate.state : "creation_acknowledged",
    createdAtUtc:
      certificate.created_at === undefined
        ? null
        : normalizeDigitalOceanInstant(certificate.created_at, "certificate_response_rejected")
  };
}

async function exactReconciliation(input: {
  client: ManagedCertificateClient;
  name: string;
  dnsNames: string[];
  runStartedAtUtc: string;
  runEndsAtUtc: string;
}): Promise<DigitalOceanCertificate | null> {
  const listed = await input.client.listManagedCertificates(input.name);
  const exactName = listed.filter((certificate) => certificate.name === input.name);
  if (exactName.length > 1) {
    throw new Error("managed_certificate_multiple_matches");
  }
  const certificate = exactName[0];
  if (certificate === undefined) return null;
  assertIdentity(certificate, input);
  return certificate;
}

async function persistCertificate(
  journal: ManagedCertificateJournal,
  certificate: {
    id: string;
    name: string;
    status: string;
    createdAtUtc: string;
  }
): Promise<void> {
  await journal.recordCreated({
    kind: "certificate",
    name: certificate.name,
    id: certificate.id,
    status: certificate.status,
    createdAtUtc: certificate.createdAtUtc
  });
}

async function pollVerified(input: {
  client: ManagedCertificateClient;
  journal: ManagedCertificateJournal;
  certificateId: string;
  name: string;
  dnsNames: string[];
  runStartedAtUtc: string;
  runEndsAtUtc: string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<"verified"> {
  const deadline = input.now().getTime() + input.timeoutMs;
  while (true) {
    const certificate = await input.client.getManagedCertificate(input.certificateId);
    if (certificate === null) throw new Error("managed_certificate_disappeared");
    assertIdentity(certificate, {
      ...input,
      expectedId: input.certificateId
    });
    await input.journal.updateStatus("certificate", input.certificateId, certificate.state);
    if (certificate.state === "verified") return "verified";
    if (certificate.state === "error") {
      throw new Error("managed_certificate_error");
    }
    if (certificate.state !== "pending") {
      throw new Error("managed_certificate_state_rejected");
    }
    const remaining = deadline - input.now().getTime();
    if (remaining <= 0) {
      throw new Error("managed_certificate_verification_timeout");
    }
    const jitter = 0.8 + Math.min(1, Math.max(0, input.random())) * 0.4;
    const wait = Math.min(remaining, Math.max(1, Math.round(input.pollIntervalMs * jitter)));
    await input.sleep(wait);
  }
}

export async function ensureManagedCertificate(
  input: EnsureManagedCertificateInput
): Promise<ManagedCertificateResult> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    (async (milliseconds: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    });
  const random = input.random ?? Math.random;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const journaled = input.journal
    .find("certificate", input.name)
    .filter((entry) => entry.cleanupState !== "deleted");
  if (journaled.length > 1) {
    throw new Error("managed_certificate_multiple_matches");
  }

  let certificateId: string;
  let actualCreateStatus: number | null = null;
  let acknowledgementClass: ManagedCertificateAcknowledgementClass;
  let reconciliationOccurred = false;

  const existingEntry = journaled[0];
  if (existingEntry !== undefined) {
    certificateId = existingEntry.id;
    acknowledgementClass = "resumed_from_journal";
  } else {
    const preexisting = await exactReconciliation(input);
    if (preexisting !== null) {
      await persistCertificate(input.journal, {
        id: preexisting.id,
        name: input.name,
        status: preexisting.state,
        createdAtUtc: preexisting.createdAtUtc
      });
      certificateId = preexisting.id;
      acknowledgementClass = "reconciled_before_create";
      reconciliationOccurred = true;
    } else {
      let observation: DigitalOceanResponseObservation;
      try {
        observation = await input.client.createManagedCertificate({
          name: input.name,
          dnsNames: input.dnsNames
        });
      } catch (error) {
        if (!(error instanceof DigitalOceanTransportError)) throw error;
        const reconciled = await exactReconciliation(input);
        if (reconciled === null) {
          throw new Error("managed_certificate_transport_unresolved");
        }
        await persistCertificate(input.journal, {
          id: reconciled.id,
          name: input.name,
          status: reconciled.state,
          createdAtUtc: reconciled.createdAtUtc
        });
        certificateId = reconciled.id;
        acknowledgementClass = "transport_reconciled";
        reconciliationOccurred = true;
        const finalState = await pollVerified({
          ...input,
          certificateId,
          now,
          sleep,
          random,
          timeoutMs,
          pollIntervalMs
        });
        return {
          actualCreateStatus,
          acknowledgementClass,
          certificateId,
          finalState,
          reconciliationOccurred
        };
      }

      actualCreateStatus = observation.status;
      acknowledgementClass =
        observation.status === 201 ? "documented_create" : "create_acknowledged_nonstandard";
      const returned = returnedIdentity(observation);
      if (returned !== null) {
        await persistCertificate(input.journal, {
          id: returned.id,
          name: input.name,
          status: returned.status,
          createdAtUtc: returned.createdAtUtc ?? now().toISOString()
        });
        certificateId = returned.id;
      } else {
        const reconciled = await exactReconciliation(input);
        if (reconciled === null) {
          throw new Error("managed_certificate_identity_missing");
        }
        await persistCertificate(input.journal, {
          id: reconciled.id,
          name: input.name,
          status: reconciled.state,
          createdAtUtc: reconciled.createdAtUtc
        });
        certificateId = reconciled.id;
        reconciliationOccurred = true;
      }
    }
  }

  const finalState = await pollVerified({
    ...input,
    certificateId,
    now,
    sleep,
    random,
    timeoutMs,
    pollIntervalMs
  });
  return {
    actualCreateStatus,
    acknowledgementClass,
    certificateId,
    finalState,
    reconciliationOccurred
  };
}

export async function cleanupManagedCertificate(input: {
  client: ManagedCertificateClient;
  journal: ManagedCertificateJournal;
  name: string;
  dnsNames: string[];
  runStartedAtUtc: string;
  runEndsAtUtc: string;
}): Promise<ManagedCertificateCleanupResult> {
  const journaled = input.journal
    .find("certificate", input.name)
    .filter((entry) => entry.cleanupState !== "deleted");
  if (journaled.length > 1) {
    throw new Error("managed_certificate_multiple_matches");
  }
  let entry = journaled[0];
  let reconciled = false;
  if (entry === undefined) {
    const certificate = await exactReconciliation(input);
    if (certificate === null) {
      return {
        certificateAbsent: true,
        certificateId: null,
        reconciled: false
      };
    }
    await persistCertificate(input.journal, {
      id: certificate.id,
      name: input.name,
      status: certificate.state,
      createdAtUtc: certificate.createdAtUtc
    });
    entry = input.journal.find("certificate", input.name)[0];
    if (entry === undefined) {
      throw new Error("managed_certificate_journal_write_missing");
    }
    reconciled = true;
  }

  try {
    await input.journal.markCleanup("certificate", entry.id, "delete_pending");
    await input.client.deleteCertificate(entry.id);
    const readback = await input.client.getManagedCertificate(entry.id, true);
    if (readback !== null) {
      throw new Error("managed_certificate_delete_unverified");
    }
    await input.journal.markCleanup("certificate", entry.id, "deleted");
  } catch (error) {
    await input.journal
      .markCleanup("certificate", entry.id, "delete_failed")
      .catch(() => undefined);
    throw error;
  }
  return {
    certificateAbsent: true,
    certificateId: entry.id,
    reconciled
  };
}
