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

/**
 * Founder-only current-tab capture. The manifest is intentionally disabled at rest;
 * the browser policy evaluator requires a separate persisted user/source activation
 * and cannot use that activation to widen this manifest's capability surface.
 */
export const ZILLOW_CURRENT_TAB_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "zillow.current-tab.v1",
    displayName: "Zillow current-tab capture (experimental)",
    version: 1,
    source: "zillow",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["capture.current_tab"],
    allowedDomains: ["www.zillow.com"],
    allowedOrigins: ["https://www.zillow.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.zillow.current-tab.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-21",
    decisionRecord: "docs/superpowers/specs/2026-07-21-openclaw-current-tab-capture-design.md",
    notes:
      "Unsupported founder experiment. Reads only an already-open exact listing tab; no navigation, discovery, messaging, forms, applications, or schedules.",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z"
  })
);

/**
 * Calendar write access is deliberately narrower than the provider scope: Vera may
 * create only one user-approved tentative hold through the reviewed Google API.
 */
export const GOOGLE_CALENDAR_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "google.calendar.v1",
    displayName: "Google Calendar tentative holds",
    version: 1,
    source: "other",
    acquisitionMode: "official_api",
    policyState: "user_triggered_only",
    enabled: true,
    execution: "manual",
    capabilities: ["calendar.hold.create"],
    allowedOperations: ["calendar.hold.create_tentative"],
    allowedDomains: ["www.googleapis.com"],
    allowedOrigins: ["https://www.googleapis.com/"],
    allowedHttpMethods: ["POST"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.google.calendar.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-21",
    decisionRecord: "docs/DECISIONS/0003-approved-drafts-and-calendar-holds.md",
    notes:
      "Allows only an exact, payload-approved tentative private event with no attendees, conference data, or notifications.",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z"
  })
);

/**
 * Scheduled alert ingestion is limited to a user-enabled Gmail readonly grant and
 * code-owned sender/subject or Vera-label filters. It has no mailbox mutation or send surface.
 */
export const GOOGLE_GMAIL_ALERT_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "google.gmail.listing-alerts.v1",
    displayName: "Gmail listing alerts",
    version: 1,
    source: "other",
    acquisitionMode: "email_alert",
    policyState: "approved",
    enabled: true,
    execution: "scheduled",
    capabilities: ["gmail.alert.read"],
    allowedOperations: ["gmail.alert.read_configured"],
    allowedDomains: ["gmail.googleapis.com"],
    allowedOrigins: ["https://gmail.googleapis.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: false,
    minimumIntervalSeconds: 300,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.google.gmail.listing-alerts.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-22",
    decisionRecord: "docs/DECISIONS/0011-maritime-production-execution.md",
    notes:
      "Reads only configured listing-alert matches through gmail.readonly. No send, draft, modify, label, delete, or forwarding operation exists.",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z"
  })
);

export const INITIAL_LOCAL_MANIFESTS = Object.freeze([
  fixtureManifest,
  manualCaptureManifest,
  GOOGLE_GMAIL_ALERT_MANIFEST,
  GOOGLE_CALENDAR_MANIFEST,
  ZILLOW_CURRENT_TAB_MANIFEST
]) satisfies readonly SourcePolicyManifest[];
