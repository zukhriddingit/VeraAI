import {
  AcquisitionModeSchema,
  SourceCapabilitySchema,
  SourceDomainSchema,
  SourceExecutionSchema,
  SourceHttpMethodSchema,
  SourceOriginSchema,
  SourcePolicyManifestSchema,
  type ListingSourceLabel,
  type SourceCapability,
  type SourcePolicyManifest
} from "@vera/domain";
import { z } from "zod";

export const SourcePolicyNetworkRequestSchema = z
  .object({
    origin: SourceOriginSchema,
    domain: SourceDomainSchema,
    httpMethod: SourceHttpMethodSchema
  })
  .strict();

export const SourcePolicyRequestSchema = z
  .object({
    connectorId: z.string().trim().min(1).max(120),
    acquisitionMode: AcquisitionModeSchema,
    capability: SourceCapabilitySchema,
    execution: SourceExecutionSchema,
    operation: z.string().trim().min(1).max(160),
    hasUserSession: z.boolean(),
    hasApproval: z.boolean(),
    network: SourcePolicyNetworkRequestSchema.nullable()
  })
  .strict();

export const SourcePolicyDenialReasonSchema = z.enum([
  "policy_error",
  "unregistered_connector",
  "acquisition_mode_mismatch",
  "policy_state_disabled",
  "policy_state_disallows_execution",
  "global_kill_switch_active",
  "connector_kill_switch_active",
  "connector_disabled",
  "capability_not_allowed",
  "execution_not_allowed",
  "operation_not_allowed",
  "network_not_allowed",
  "network_required",
  "origin_not_allowed",
  "domain_not_allowed",
  "method_not_allowed",
  "user_session_required",
  "approval_required"
]);

export const SourcePolicyAllowedDecisionSchema = z
  .object({
    allowed: z.literal(true),
    reason: z.literal("authorized"),
    connectorId: z.string().trim().min(1).max(120),
    capability: SourceCapabilitySchema,
    manifestVersion: z.number().int().positive()
  })
  .strict();

export const SourcePolicyDeniedDecisionSchema = z
  .object({
    allowed: z.literal(false),
    reason: SourcePolicyDenialReasonSchema,
    connectorId: z.string().trim().min(1).max(120).nullable(),
    capability: SourceCapabilitySchema.nullable(),
    manifestVersion: z.number().int().positive().nullable()
  })
  .strict();

export const SourcePolicyDecisionSchema = z.discriminatedUnion("allowed", [
  SourcePolicyAllowedDecisionSchema,
  SourcePolicyDeniedDecisionSchema
]);

export const BrowserAccessClassificationSchema = z.enum([
  "policy_entry_present",
  "manual_policy_required"
]);

export const BrowserDomainDecisionSchema = z
  .object({
    hostname: z.string().trim().min(1).max(253),
    source: z.enum(["zillow", "facebook_marketplace", "craigslist", "apartments_com", "other"]),
    matchedDomain: SourceDomainSchema.nullable(),
    browserAccess: BrowserAccessClassificationSchema
  })
  .strict();

export type SourcePolicyNetworkRequest = z.infer<typeof SourcePolicyNetworkRequestSchema>;
export type SourcePolicyRequest = z.infer<typeof SourcePolicyRequestSchema>;
export type SourcePolicyDenialReason = z.infer<typeof SourcePolicyDenialReasonSchema>;
export type SourcePolicyDecision = z.infer<typeof SourcePolicyDecisionSchema>;
export type BrowserAccessClassification = z.infer<typeof BrowserAccessClassificationSchema>;
export type BrowserDomainDecision = z.infer<typeof BrowserDomainDecisionSchema>;

export interface SourcePolicyRegistryOptions {
  readonly activeKillSwitches?: ReadonlySet<string>;
}

const KNOWN_BROWSER_DOMAINS = [
  { domain: "zillow.com", source: "zillow" },
  { domain: "facebook.com", source: "facebook_marketplace" },
  { domain: "craigslist.org", source: "craigslist" },
  { domain: "apartments.com", source: "apartments_com" }
] as const satisfies readonly { domain: string; source: Exclude<ListingSourceLabel, "other"> }[];

function freezeManifest(manifest: SourcePolicyManifest): SourcePolicyManifest {
  Object.freeze(manifest.capabilities);
  Object.freeze(manifest.allowedOperations);
  Object.freeze(manifest.allowedDomains);
  Object.freeze(manifest.allowedOrigins);
  Object.freeze(manifest.allowedHttpMethods);
  Object.freeze(manifest.redactionRules);
  return Object.freeze(manifest);
}

function safeConnectorId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("connectorId" in input)) return null;
  const value = input.connectorId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

function safeCapability(input: unknown): SourceCapability | null {
  if (typeof input !== "object" || input === null || !("capability" in input)) return null;
  const parsed = SourceCapabilitySchema.safeParse(input.capability);
  return parsed.success ? parsed.data : null;
}

export class SourcePolicyRegistry {
  readonly #manifests: readonly SourcePolicyManifest[];
  readonly #manifestsByConnector: ReadonlyMap<string, SourcePolicyManifest>;
  readonly #activeKillSwitches: ReadonlySet<string>;
  readonly #registryValid: boolean;

  constructor(
    manifests: readonly SourcePolicyManifest[],
    options: SourcePolicyRegistryOptions = {}
  ) {
    const parsed: SourcePolicyManifest[] = [];
    const identities = new Set<string>();
    let registryValid = true;

    for (const candidate of manifests) {
      const result = SourcePolicyManifestSchema.safeParse(candidate);
      if (!result.success) {
        registryValid = false;
        continue;
      }

      const identity = `${result.data.connectorId}:${result.data.version}`;
      if (identities.has(identity)) {
        registryValid = false;
        continue;
      }
      identities.add(identity);
      parsed.push(freezeManifest(result.data));
    }

    parsed.sort((left, right) =>
      left.connectorId === right.connectorId
        ? right.version - left.version
        : left.connectorId.localeCompare(right.connectorId)
    );

    const latest = new Map<string, SourcePolicyManifest>();
    for (const manifest of parsed) {
      if (!latest.has(manifest.connectorId)) latest.set(manifest.connectorId, manifest);
    }

    this.#manifests = Object.freeze(parsed);
    this.#manifestsByConnector = latest;
    this.#activeKillSwitches = new Set(options.activeKillSwitches ?? []);
    this.#registryValid = registryValid;
  }

  getManifest(connectorId: string): SourcePolicyManifest | null {
    if (!this.#registryValid) return null;
    return this.#manifestsByConnector.get(connectorId) ?? null;
  }

  listManifests(): readonly SourcePolicyManifest[] {
    if (!this.#registryValid) return [];
    return this.#manifests;
  }

  evaluate(requestInput: SourcePolicyRequest): SourcePolicyDecision {
    try {
      const requestResult = SourcePolicyRequestSchema.safeParse(requestInput);
      if (!requestResult.success || !this.#registryValid) {
        return this.#deny("policy_error", requestInput);
      }
      const request = requestResult.data;
      const manifest = this.#manifestsByConnector.get(request.connectorId);
      if (!manifest) return this.#deny("unregistered_connector", request);

      if (manifest.acquisitionMode !== request.acquisitionMode) {
        return this.#deny("acquisition_mode_mismatch", request, manifest);
      }
      if (manifest.policyState === "disabled") {
        return this.#deny("policy_state_disabled", request, manifest);
      }
      if (manifest.policyState === "user_triggered_only" && request.execution !== "manual") {
        return this.#deny("policy_state_disallows_execution", request, manifest);
      }
      if (manifest.policyState === "experimental_personal" && !manifest.enabled) {
        return this.#deny("connector_disabled", request, manifest);
      }

      if (this.#activeKillSwitches.has(manifest.globalKillSwitchKey)) {
        return this.#deny("global_kill_switch_active", request, manifest);
      }
      if (this.#activeKillSwitches.has(manifest.connectorKillSwitchKey)) {
        return this.#deny("connector_kill_switch_active", request, manifest);
      }
      if (!manifest.enabled) return this.#deny("connector_disabled", request, manifest);
      if (!manifest.capabilities.includes(request.capability)) {
        return this.#deny("capability_not_allowed", request, manifest);
      }
      if (manifest.execution !== request.execution) {
        return this.#deny("execution_not_allowed", request, manifest);
      }
      if (!manifest.allowedOperations.includes(request.operation)) {
        return this.#deny("operation_not_allowed", request, manifest);
      }

      const manifestUsesNetwork =
        manifest.allowedDomains.length > 0 ||
        manifest.allowedOrigins.length > 0 ||
        manifest.allowedHttpMethods.length > 0;
      if (request.network === null && manifestUsesNetwork) {
        return this.#deny("network_required", request, manifest);
      }
      if (request.network !== null && !manifestUsesNetwork) {
        return this.#deny("network_not_allowed", request, manifest);
      }
      if (request.network !== null) {
        if (!manifest.allowedOrigins.includes(request.network.origin)) {
          return this.#deny("origin_not_allowed", request, manifest);
        }
        if (!manifest.allowedDomains.includes(request.network.domain)) {
          return this.#deny("domain_not_allowed", request, manifest);
        }
        if (!manifest.allowedHttpMethods.includes(request.network.httpMethod)) {
          return this.#deny("method_not_allowed", request, manifest);
        }
      }
      if (manifest.requiresUserSession && !request.hasUserSession) {
        return this.#deny("user_session_required", request, manifest);
      }
      if (manifest.requiresApproval && !request.hasApproval) {
        return this.#deny("approval_required", request, manifest);
      }

      return SourcePolicyAllowedDecisionSchema.parse({
        allowed: true,
        reason: "authorized",
        connectorId: request.connectorId,
        capability: request.capability,
        manifestVersion: manifest.version
      });
    } catch {
      return this.#deny("policy_error", requestInput);
    }
  }

  classifyBrowserDomain(hostnameInput: string): BrowserDomainDecision {
    const normalized = hostnameInput.trim().toLowerCase().replace(/\.$/u, "");
    const safeHostname = normalized.slice(0, 253) || "invalid";
    const validHostname = SourceDomainSchema.safeParse(normalized).success;
    const match = validHostname
      ? KNOWN_BROWSER_DOMAINS.find(
          ({ domain }) => normalized === domain || normalized.endsWith(`.${domain}`)
        )
      : undefined;

    return BrowserDomainDecisionSchema.parse({
      hostname: safeHostname,
      source: match?.source ?? "other",
      matchedDomain: match?.domain ?? null,
      browserAccess: match ? "policy_entry_present" : "manual_policy_required"
    });
  }

  #deny(
    reason: SourcePolicyDenialReason,
    requestInput: unknown,
    manifest?: SourcePolicyManifest
  ): SourcePolicyDecision {
    return SourcePolicyDeniedDecisionSchema.parse({
      allowed: false,
      reason,
      connectorId: safeConnectorId(requestInput),
      capability: safeCapability(requestInput),
      manifestVersion: manifest?.version ?? null
    });
  }
}
