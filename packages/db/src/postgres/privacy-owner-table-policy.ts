export const PRIVACY_OWNER_TABLE_POLICY = {
  accounts: "delete_only",
  activity_events: "export",
  approvals: "export",
  availability_checks: "export",
  availability_rule_sets: "export",
  beta_memberships: "project",
  browser_capture_acceptances: "export",
  browser_connector_devices: "project",
  browser_connector_enrollment_tickets: "delete_only",
  browser_gateway_acceptance_runs: "export",
  browser_gateway_assignments: "project",
  browser_nodes: "project",
  browser_profile_controls: "export",
  browser_source_controls: "export",
  browser_user_controls: "export",
  calendar_holds: "export",
  calendar_oauth_states: "delete_only",
  canonical_decision_runs: "export",
  canonical_field_sources: "export",
  canonical_listing_sources: "export",
  canonical_listings: "export",
  contact_workflows: "export",
  decision_corpus_state: "export",
  decision_job_attempts: "export",
  decision_jobs: "export",
  decision_runs: "export",
  duplicate_clusters: "export",
  duplicate_override_revocations: "export",
  duplicate_overrides: "export",
  duplicate_pair_evaluations: "export",
  field_provenance: "export",
  gmail_alert_cursors: "export",
  gmail_alert_external_references: "export",
  gmail_oauth_states: "delete_only",
  integration_connections: "project",
  integration_refresh_leases: "delete_only",
  listing_enrichment_snapshots: "export",
  listing_enrichment_states: "export",
  listing_extractions: "export",
  listing_photos: "export",
  listing_scores: "export",
  listing_source_record_dispositions: "export",
  listing_source_records: "export",
  maritime_dispatches: "project",
  normalization_jobs: "export",
  notification_deliveries: "export",
  notification_digest_items: "export",
  notification_preferences: "export",
  privacy_deletion_challenges: "delete_only",
  production_schedule_runs: "export",
  production_schedules: "export",
  raw_listings: "export",
  risk_signals: "export",
  search_profiles: "export",
  sessions: "delete_only",
  source_job_attempts: "export",
  source_jobs: "export",
  viewings: "export",
  web_push_subscriptions: "project"
} as const satisfies Readonly<Record<string, "export" | "project" | "delete_only">>;

export type PrivacyOwnerTableName = keyof typeof PRIVACY_OWNER_TABLE_POLICY;
export type PrivacyOwnerTableMode = (typeof PRIVACY_OWNER_TABLE_POLICY)[PrivacyOwnerTableName];

export const privacyOwnerTableNames = Object.freeze(
  Object.keys(PRIVACY_OWNER_TABLE_POLICY).sort() as PrivacyOwnerTableName[]
);

export const privacyExportTableNames = Object.freeze(
  privacyOwnerTableNames.filter((table) => PRIVACY_OWNER_TABLE_POLICY[table] !== "delete_only")
);

export const PRIVACY_EXPORT_FORBIDDEN_KEY =
  /password|accessToken|refreshToken|idToken|sessionToken|credential(?:Version|Algorithm|KeyId|Nonce|Ciphertext|AuthenticationTag)?|secretReference|relayCredentialDigest|checkpointCredentialDigest|installationDigest|ticketDigest|stateHash|codeVerifierHash|endpointHash|nonceHash/iu;

export function assertPrivacyExportDataSafe(value: unknown, path = "$privacyExport"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacyExportDataSafe(item, `${path}[${String(index)}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVACY_EXPORT_FORBIDDEN_KEY.test(key)) {
      throw new Error(`Privacy export contains forbidden key ${key} at ${path}.`);
    }
    assertPrivacyExportDataSafe(child, `${path}.${key}`);
  }
}
