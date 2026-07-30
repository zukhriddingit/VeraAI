import { isIPv4 } from "node:net";

import type {
  DigitalOceanLoadBalancer,
  DigitalOceanResponseObservation
} from "./digitalocean-api.ts";
import { DigitalOceanTransportError, normalizeDigitalOceanInstant } from "./digitalocean-api.ts";
import type {
  ResourceCleanupState,
  ResourceCreatedInput,
  ResourceJournalEntry
} from "./resource-journal.ts";

export type ManagedLoadBalancerAcknowledgementClass =
  | "documented_create"
  | "create_acknowledged_nonstandard"
  | "transport_reconciled"
  | "reconciled_before_create"
  | "resumed_from_journal";

export interface ManagedLoadBalancerJournal {
  find(kind: "load_balancer", name: string): ResourceJournalEntry[];
  recordCreated(entry: ResourceCreatedInput): Promise<void>;
  updateStatus(kind: "load_balancer", id: string, status: string): Promise<void>;
  markCleanup(
    kind: "load_balancer",
    id: string,
    cleanupState: Exclude<ResourceCleanupState, "active">
  ): Promise<void>;
}

export interface ManagedLoadBalancerClient {
  createManagedLoadBalancer(input: {
    name: string;
    region: string;
    dropletId: number;
    certificateId: string;
  }): Promise<DigitalOceanResponseObservation>;
  listManagedLoadBalancers(): Promise<DigitalOceanLoadBalancer[]>;
  getManagedLoadBalancer(
    id: string,
    acceptNotFound?: boolean
  ): Promise<DigitalOceanLoadBalancer | null>;
  deleteLoadBalancer(id: string): Promise<void>;
}

export interface EnsureManagedLoadBalancerInput {
  client: ManagedLoadBalancerClient;
  journal: ManagedLoadBalancerJournal;
  name: string;
  region: string;
  dropletId: number;
  certificateId: string;
  runStartedAtUtc: string;
  runEndsAtUtc: string;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  createDnsRecordAfterReadback?: (loadBalancer: DigitalOceanLoadBalancer) => Promise<void>;
}

export interface ManagedLoadBalancerResult {
  actualCreateStatus: number | null;
  acknowledgementClass: ManagedLoadBalancerAcknowledgementClass;
  loadBalancerId: string;
  finalStatus: "active";
  publicIpv4: string;
  reconciliationOccurred: boolean;
}

export interface ManagedLoadBalancerCleanupResult {
  loadBalancerAbsent: boolean;
  loadBalancerId: string | null;
  reconciled: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

function instant(value: string, code: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(code);
  return timestamp;
}

function assertIdentity(
  loadBalancer: DigitalOceanLoadBalancer,
  input: {
    name: string;
    region: string;
    dropletId: number;
    certificateId: string;
    runStartedAtUtc: string;
    runEndsAtUtc: string;
    expectedId?: string;
  }
): void {
  const createdAt = instant(loadBalancer.createdAtUtc, "managed_load_balancer_identity_mismatch");
  const runStartedAt = instant(input.runStartedAtUtc, "managed_load_balancer_run_window_rejected");
  const runEndsAt = instant(input.runEndsAtUtc, "managed_load_balancer_run_window_rejected");
  const forwardingRule = loadBalancer.forwardingRules[0];
  const exactForwardingRule =
    loadBalancer.forwardingRules.length === 1 &&
    forwardingRule?.entryProtocol === "https" &&
    forwardingRule.entryPort === 443 &&
    forwardingRule.targetProtocol === "http" &&
    forwardingRule.targetPort === 18789 &&
    forwardingRule.certificateId === input.certificateId &&
    forwardingRule.tlsPassthrough === false;
  const healthCheck = loadBalancer.healthCheck;
  const exactHealthCheck =
    healthCheck.protocol === "tcp" &&
    healthCheck.port === 18789 &&
    healthCheck.checkIntervalSeconds === 10 &&
    healthCheck.responseTimeoutSeconds === 5 &&
    healthCheck.unhealthyThreshold === 3 &&
    healthCheck.healthyThreshold === 5;
  if (
    runEndsAt < runStartedAt ||
    loadBalancer.name !== input.name ||
    loadBalancer.region !== input.region ||
    loadBalancer.type !== "REGIONAL" ||
    loadBalancer.network !== "EXTERNAL" ||
    loadBalancer.networkStack !== "IPV4" ||
    loadBalancer.dropletIds.length !== 1 ||
    loadBalancer.dropletIds[0] !== input.dropletId ||
    !exactForwardingRule ||
    !exactHealthCheck ||
    loadBalancer.redirectHttpToHttps ||
    loadBalancer.enableProxyProtocol ||
    createdAt < runStartedAt ||
    createdAt > runEndsAt ||
    (input.expectedId !== undefined && loadBalancer.id !== input.expectedId)
  ) {
    throw new Error("managed_load_balancer_identity_mismatch");
  }
}

function returnedIdentity(
  observation: DigitalOceanResponseObservation
): { id: string; status: string; createdAtUtc: string | null } | null {
  if (
    typeof observation.parsedBody !== "object" ||
    observation.parsedBody === null ||
    Array.isArray(observation.parsedBody)
  ) {
    return null;
  }
  const raw = (observation.parsedBody as Record<string, unknown>).load_balancer;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const loadBalancer = raw as Record<string, unknown>;
  if (typeof loadBalancer.id !== "string" || !UUID.test(loadBalancer.id)) {
    return null;
  }
  return {
    id: loadBalancer.id,
    status: typeof loadBalancer.status === "string" ? loadBalancer.status : "creation_acknowledged",
    createdAtUtc:
      loadBalancer.created_at === undefined
        ? null
        : normalizeDigitalOceanInstant(loadBalancer.created_at, "load_balancer_response_rejected")
  };
}

async function exactReconciliation(input: {
  client: ManagedLoadBalancerClient;
  name: string;
  region: string;
  dropletId: number;
  certificateId: string;
  runStartedAtUtc: string;
  runEndsAtUtc: string;
}): Promise<DigitalOceanLoadBalancer | null> {
  const listed = await input.client.listManagedLoadBalancers();
  const exactName = listed.filter((loadBalancer) => loadBalancer.name === input.name);
  if (exactName.length > 1) {
    throw new Error("managed_load_balancer_multiple_matches");
  }
  const loadBalancer = exactName[0];
  if (loadBalancer === undefined) return null;
  assertIdentity(loadBalancer, input);
  return loadBalancer;
}

async function persistLoadBalancer(
  journal: ManagedLoadBalancerJournal,
  loadBalancer: {
    id: string;
    name: string;
    status: string;
    createdAtUtc: string;
  }
): Promise<void> {
  await journal.recordCreated({
    kind: "load_balancer",
    name: loadBalancer.name,
    id: loadBalancer.id,
    status: loadBalancer.status,
    createdAtUtc: loadBalancer.createdAtUtc
  });
}

async function pollActive(input: {
  client: ManagedLoadBalancerClient;
  journal: ManagedLoadBalancerJournal;
  loadBalancerId: string;
  name: string;
  region: string;
  dropletId: number;
  certificateId: string;
  runStartedAtUtc: string;
  runEndsAtUtc: string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<DigitalOceanLoadBalancer> {
  const deadline = input.now().getTime() + input.timeoutMs;
  while (true) {
    const loadBalancer = await input.client.getManagedLoadBalancer(input.loadBalancerId);
    if (loadBalancer === null) {
      throw new Error("managed_load_balancer_disappeared");
    }
    assertIdentity(loadBalancer, {
      ...input,
      expectedId: input.loadBalancerId
    });
    await input.journal.updateStatus("load_balancer", input.loadBalancerId, loadBalancer.status);
    if (loadBalancer.status === "active") {
      if (!isIPv4(loadBalancer.ip)) {
        throw new Error("managed_load_balancer_public_ipv4_missing");
      }
      return loadBalancer;
    }
    if (loadBalancer.status === "errored") {
      throw new Error("managed_load_balancer_error");
    }
    if (loadBalancer.status !== "new") {
      throw new Error("managed_load_balancer_state_rejected");
    }
    const remaining = deadline - input.now().getTime();
    if (remaining <= 0) {
      throw new Error("managed_load_balancer_activation_timeout");
    }
    const jitter = 0.8 + Math.min(1, Math.max(0, input.random())) * 0.4;
    const wait = Math.min(remaining, Math.max(1, Math.round(input.pollIntervalMs * jitter)));
    await input.sleep(wait);
  }
}

export async function ensureManagedLoadBalancer(
  input: EnsureManagedLoadBalancerInput
): Promise<ManagedLoadBalancerResult> {
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
    .find("load_balancer", input.name)
    .filter((entry) => entry.cleanupState !== "deleted");
  if (journaled.length > 1) {
    throw new Error("managed_load_balancer_multiple_matches");
  }

  let loadBalancerId: string;
  let actualCreateStatus: number | null = null;
  let acknowledgementClass: ManagedLoadBalancerAcknowledgementClass;
  let reconciliationOccurred = false;
  const existingEntry = journaled[0];
  if (existingEntry !== undefined) {
    loadBalancerId = existingEntry.id;
    acknowledgementClass = "resumed_from_journal";
  } else {
    const preexisting = await exactReconciliation(input);
    if (preexisting !== null) {
      await persistLoadBalancer(input.journal, {
        id: preexisting.id,
        name: input.name,
        status: preexisting.status,
        createdAtUtc: preexisting.createdAtUtc
      });
      loadBalancerId = preexisting.id;
      acknowledgementClass = "reconciled_before_create";
      reconciliationOccurred = true;
    } else {
      let observation: DigitalOceanResponseObservation;
      try {
        observation = await input.client.createManagedLoadBalancer({
          name: input.name,
          region: input.region,
          dropletId: input.dropletId,
          certificateId: input.certificateId
        });
      } catch (error) {
        if (!(error instanceof DigitalOceanTransportError)) throw error;
        const reconciled = await exactReconciliation(input);
        if (reconciled === null) {
          throw new Error("managed_load_balancer_transport_unresolved");
        }
        await persistLoadBalancer(input.journal, {
          id: reconciled.id,
          name: input.name,
          status: reconciled.status,
          createdAtUtc: reconciled.createdAtUtc
        });
        loadBalancerId = reconciled.id;
        acknowledgementClass = "transport_reconciled";
        reconciliationOccurred = true;
        const active = await pollActive({
          ...input,
          loadBalancerId,
          now,
          sleep,
          random,
          timeoutMs,
          pollIntervalMs
        });
        await input.createDnsRecordAfterReadback?.(active);
        return {
          actualCreateStatus,
          acknowledgementClass,
          loadBalancerId,
          finalStatus: "active",
          publicIpv4: active.ip,
          reconciliationOccurred
        };
      }
      actualCreateStatus = observation.status;
      acknowledgementClass =
        observation.status === 202 ? "documented_create" : "create_acknowledged_nonstandard";
      const returned = returnedIdentity(observation);
      if (returned !== null) {
        await persistLoadBalancer(input.journal, {
          id: returned.id,
          name: input.name,
          status: returned.status,
          createdAtUtc: returned.createdAtUtc ?? now().toISOString()
        });
        loadBalancerId = returned.id;
      } else {
        const reconciled = await exactReconciliation(input);
        if (reconciled === null) {
          throw new Error("managed_load_balancer_identity_missing");
        }
        await persistLoadBalancer(input.journal, {
          id: reconciled.id,
          name: input.name,
          status: reconciled.status,
          createdAtUtc: reconciled.createdAtUtc
        });
        loadBalancerId = reconciled.id;
        reconciliationOccurred = true;
      }
    }
  }

  const active = await pollActive({
    ...input,
    loadBalancerId,
    now,
    sleep,
    random,
    timeoutMs,
    pollIntervalMs
  });
  await input.createDnsRecordAfterReadback?.(active);
  return {
    actualCreateStatus,
    acknowledgementClass,
    loadBalancerId,
    finalStatus: "active",
    publicIpv4: active.ip,
    reconciliationOccurred
  };
}

export async function cleanupManagedLoadBalancer(input: {
  client: ManagedLoadBalancerClient;
  journal: ManagedLoadBalancerJournal;
  name: string;
  region: string;
  dropletId: number;
  certificateId: string;
  runStartedAtUtc: string;
  runEndsAtUtc: string;
}): Promise<ManagedLoadBalancerCleanupResult> {
  const journaled = input.journal
    .find("load_balancer", input.name)
    .filter((entry) => entry.cleanupState !== "deleted");
  if (journaled.length > 1) {
    throw new Error("managed_load_balancer_multiple_matches");
  }
  let entry = journaled[0];
  let reconciled = false;
  if (entry === undefined) {
    const loadBalancer = await exactReconciliation(input);
    if (loadBalancer === null) {
      return {
        loadBalancerAbsent: true,
        loadBalancerId: null,
        reconciled: false
      };
    }
    await persistLoadBalancer(input.journal, {
      id: loadBalancer.id,
      name: input.name,
      status: loadBalancer.status,
      createdAtUtc: loadBalancer.createdAtUtc
    });
    entry = input.journal.find("load_balancer", input.name)[0];
    if (entry === undefined) {
      throw new Error("managed_load_balancer_journal_write_missing");
    }
    reconciled = true;
  }

  try {
    await input.journal.markCleanup("load_balancer", entry.id, "delete_pending");
    await input.client.deleteLoadBalancer(entry.id);
    const readback = await input.client.getManagedLoadBalancer(entry.id, true);
    if (readback !== null) {
      throw new Error("managed_load_balancer_delete_unverified");
    }
    await input.journal.markCleanup("load_balancer", entry.id, "deleted");
  } catch (error) {
    await input.journal
      .markCleanup("load_balancer", entry.id, "delete_failed")
      .catch(() => undefined);
    throw error;
  }
  return {
    loadBalancerAbsent: true,
    loadBalancerId: entry.id,
    reconciled
  };
}
