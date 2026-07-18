import { SourcePolicyManifestSchema, type SourcePolicyManifest } from "@vera/domain";

function freezeManifest(manifest: SourcePolicyManifest): SourcePolicyManifest {
  Object.freeze(manifest.capabilities);
  Object.freeze(manifest.allowedOperations);
  Object.freeze(manifest.allowedDomains);
  Object.freeze(manifest.allowedOrigins);
  Object.freeze(manifest.allowedHttpMethods);
  Object.freeze(manifest.redactionRules);
  return Object.freeze(manifest);
}

const timestamps = {
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z"
} as const;

const redactionRules = [
  "raw_content_from_logs",
  "full_urls_from_logs",
  "contact_details_from_logs",
  "credentials_from_logs"
] as const;

const fixtureManifest = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "fixture.feed.v1",
    displayName: "Sanitized fixture feed",
    version: 1,
    source: "other",
    acquisitionMode: "fixture",
    policyState: "approved",
    enabled: true,
    execution: "manual",
    capabilities: ["fixture.read"],
    allowedOperations: ["fixture.read_sanitized"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: false,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.fixture.feed.v1.disabled",
    dataClassification: "synthetic",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-17",
    decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
    notes: "Reads only sanitized local fixture data and performs no network access.",
    ...timestamps
  })
);

const manualCaptureManifest = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "manual.capture.v1",
    displayName: "Manual listing capture",
    version: 1,
    source: "other",
    acquisitionMode: "user_capture",
    policyState: "user_triggered_only",
    enabled: true,
    execution: "manual",
    capabilities: ["manual.capture"],
    allowedOperations: ["capture.user_supplied"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: false,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.manual.capture.v1.disabled",
    dataClassification: "user_supplied",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-17",
    decisionRecord: "docs/DECISIONS/0004-fail-closed-connectors.md",
    notes: "Stores user-supplied text or structured data; provenance URLs are never fetched.",
    ...timestamps
  })
);

export const INITIAL_LOCAL_MANIFESTS = Object.freeze([
  fixtureManifest,
  manualCaptureManifest
]) satisfies readonly SourcePolicyManifest[];
