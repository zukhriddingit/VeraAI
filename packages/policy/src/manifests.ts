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
 * Founder-only rental research. The reviewed tool is disabled at rest and can be
 * activated only by the separate per-run founder, kill-switch, consent-tab, and
 * action-budget checks in zillow-research-policy.ts.
 */
export const ZILLOW_RENTAL_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "zillow.browser-research.v1",
    displayName: "Zillow rental research (founder experiment)",
    version: 1,
    source: "zillow",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["zillow.rental_research.v1"],
    allowedDomains: ["www.zillow.com"],
    allowedOrigins: ["https://www.zillow.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.zillow.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-07-30",
    decisionRecord: "docs/superpowers/specs/2026-07-30-bounded-zillow-browser-research-design.md",
    notes:
      "Unsupported founder-only experiment. One explicit user-triggered run may inspect one shared Zillow rental tab through vera_zillow_rental_research_v1; no schedule, background polling, login automation, contact, application, tour, messaging, payment, or file transfer is permitted.",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  })
);

export const APARTMENTS_RENTAL_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "apartments-com.browser-research.v1",
    displayName: "Apartments.com rental research (founder experiment)",
    version: 1,
    source: "apartments_com",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["apartments_com.rental_research.v1"],
    allowedDomains: ["www.apartments.com"],
    allowedOrigins: ["https://www.apartments.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.apartments-com.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-04",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only, user-triggered, disabled-by-default rental research. No login automation, lead forms, contact, tour, application, phone, email, payment, upload, or download actions.",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  })
);

export const ZILLOW_GENERIC_BROWSER_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "zillow.browser-research.v2",
    displayName: "Zillow generic bounded rental research (founder experiment)",
    version: 2,
    source: "zillow",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["zillow.rental_research.v2"],
    allowedDomains: ["www.zillow.com"],
    allowedOrigins: ["https://www.zillow.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.zillow.browser-research.v2.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-04",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only migration of the accepted Zillow workflow to the signed generic bounded browser tool. No unrestricted browser or contact/application action is exposed.",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  })
);

export const FACEBOOK_MARKETPLACE_RENTAL_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "facebook-marketplace.browser-research.v1",
    displayName: "Facebook Marketplace rental research (founder experiment)",
    version: 1,
    source: "facebook_marketplace",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["facebook_marketplace.rental_research.v1"],
    allowedDomains: ["www.facebook.com"],
    allowedOrigins: ["https://www.facebook.com/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.facebook-marketplace.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-04",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only, user-triggered, disabled-by-default Marketplace rental research requiring an existing manual Facebook session. No login, seller-profile, Messenger, contact, application, payment, upload, or download actions.",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z"
  })
);

export const OFFCAMPUS_PARTNERS_RENTAL_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "offcampus-partners.browser-research.v1",
    displayName: "Off Campus Partners rental research (founder experiment)",
    version: 1,
    source: "bu_off_campus",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["offcampus_partners.rental_research.v1"],
    allowedDomains: ["offcampus.bu.edu"],
    allowedOrigins: ["https://offcampus.bu.edu/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.offcampus-partners.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-12",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only, user-triggered read-only research through one signed Off Campus Partners configuration. Manual login and Duo remain user actions; contact, lead, application, email, phone, payment, upload, and download controls are forbidden.",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  })
);

export const GENERIC_HOUSING_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "generic-housing.browser-research.v1",
    displayName: "Generic housing website research (founder experiment)",
    version: 1,
    source: "custom_website",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["generic_housing.rental_research.v1"],
    allowedDomains: [],
    allowedOrigins: [],
    allowedHttpMethods: [],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.generic-housing.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-12",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only, user-triggered research of one user-configured exact public domain. The signed run plan supplies the exact start URL and domain; no forms, generated URLs, arbitrary scripts, selectors, contact, payment, or file transfer are permitted.",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  })
);

export const CRAIGSLIST_RENTAL_RESEARCH_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "craigslist.browser-research.v1",
    displayName: "Craigslist rental research (founder experiment)",
    version: 1,
    source: "craigslist",
    acquisitionMode: "local_browser",
    policyState: "experimental_personal",
    enabled: false,
    execution: "manual",
    capabilities: ["browser.capture"],
    allowedOperations: ["craigslist.rental_research.v1"],
    allowedDomains: ["boston.craigslist.org"],
    allowedOrigins: ["https://boston.craigslist.org/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: true,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "browser.disabled",
    connectorKillSwitchKey: "connectors.craigslist.browser-research.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera founder",
    reviewedAt: "2026-08-12",
    decisionRecord: "AGENTS.md",
    notes:
      "Founder-only, user-triggered, disabled-by-default Craigslist housing research. Reply, relay email, phone, posting, account, contact, payment, upload, and download actions are absent and forbidden.",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
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

/**
 * Founder-triggered live inventory reads. This grants one bounded GET operation
 * against RentCast's rental-listing endpoint; the separate live-mode flag and
 * founder allowlist remain mandatory application-level controls.
 */
export const RENTCAST_RENTAL_MANIFEST = freezeManifest(
  SourcePolicyManifestSchema.parse({
    schemaVersion: 2,
    connectorId: "rentcast.rental-listings.v1",
    displayName: "RentCast long-term rental listings",
    version: 1,
    source: "rentcast",
    acquisitionMode: "official_api",
    policyState: "user_triggered_only",
    enabled: true,
    execution: "manual",
    capabilities: ["structured_feed.read"],
    allowedOperations: ["rentcast.rental_listings.search"],
    allowedDomains: ["api.rentcast.io"],
    allowedOrigins: ["https://api.rentcast.io/"],
    allowedHttpMethods: ["GET"],
    requiresUserSession: true,
    requiresApproval: false,
    minimumIntervalSeconds: null,
    maxConcurrency: 1,
    globalKillSwitchKey: "integrations.disabled",
    connectorKillSwitchKey: "connectors.rentcast.rental-listings.v1.disabled",
    dataClassification: "third_party",
    redactionRules,
    manualBlockerBehavior: "stop_and_request_user_action",
    owner: "Vera maintainers",
    reviewedAt: "2026-07-24",
    decisionRecord: "docs/EOD_LIVE_AGENT_DEMO.md",
    notes:
      "Reads at most ten active long-term rental listings from an explicit founder profile. No owner records, unrelated property records, pagination, contact details, or writes.",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z"
  })
);

export const INITIAL_LOCAL_MANIFESTS = Object.freeze([
  fixtureManifest,
  manualCaptureManifest,
  GOOGLE_GMAIL_ALERT_MANIFEST,
  GOOGLE_CALENDAR_MANIFEST,
  RENTCAST_RENTAL_MANIFEST,
  ZILLOW_CURRENT_TAB_MANIFEST,
  ZILLOW_RENTAL_RESEARCH_MANIFEST,
  ZILLOW_GENERIC_BROWSER_RESEARCH_MANIFEST,
  APARTMENTS_RENTAL_RESEARCH_MANIFEST,
  FACEBOOK_MARKETPLACE_RENTAL_RESEARCH_MANIFEST,
  OFFCAMPUS_PARTNERS_RENTAL_RESEARCH_MANIFEST,
  GENERIC_HOUSING_RESEARCH_MANIFEST,
  CRAIGSLIST_RENTAL_RESEARCH_MANIFEST
]) satisfies readonly SourcePolicyManifest[];
