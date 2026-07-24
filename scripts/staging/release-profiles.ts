export const RELEASE_PROFILE_IDS = ["founder_core", "founder_browser_experimental"] as const;

export type ReleaseProfileId = (typeof RELEASE_PROFILE_IDS)[number];

export const RELEASE_CAPABILITY_KEYS = [
  "browserCapture",
  "directCapture",
  "gmailAlerts",
  "calendar",
  "webPush",
  "maritimeWorker"
] as const;

export interface ReleaseCapabilities {
  readonly browserCapture: boolean;
  readonly directCapture: true;
  readonly gmailAlerts: true;
  readonly calendar: true;
  readonly webPush: true;
  readonly maritimeWorker: true;
}

export const RELEASE_PHASE_RESULT_STATES = [
  "passed_automated",
  "passed_manual_evidence",
  "blocked_missing_configuration",
  "failed_assertion",
  "failed_provider",
  "not_applicable_with_approved_reason"
] as const;

export type ReleasePhaseResultState = (typeof RELEASE_PHASE_RESULT_STATES)[number];

export const RELEASE_CLASSIFICATIONS = [
  "no_go",
  "conditional_go_founder_only_staging",
  "go_founder_only_core_beta"
] as const;

export type ReleaseClassification = (typeof RELEASE_CLASSIFICATIONS)[number];

export const CONFIGURATION_BLOCKER_KINDS = [
  "external_staging_value",
  "external_credential",
  "external_deployment",
  "operator_execution"
] as const;

export type ConfigurationBlockerKind = (typeof CONFIGURATION_BLOCKER_KINDS)[number];

const CORE_PHASE_IDS = [
  "release_static_readiness",
  "postgresql_snapshot_and_backup",
  "postgresql_restore",
  "migration_and_idempotent_bootstrap",
  "hosted_web_deployment",
  "maritime_worker_dispatch",
  "direct_capture",
  "duplicate_dispatch",
  "replayed_result",
  "worker_restart_recovery",
  "web_push_delivery",
  "web_push_deduplication",
  "quiet_hours",
  "provider_outage",
  "gmail_readonly_verification",
  "calendar_freebusy_and_approved_hold",
  "emergency_disable",
  "worker_image_rollback"
] as const;

const BROWSER_DISABLED_PHASE_IDS = [
  "browser_global_kill_switch_enabled",
  "browser_founder_capability_disabled",
  "browser_source_jobs_rejected_before_dispatch",
  "browser_gateway_not_required",
  "browser_endpoint_not_exposed",
  "browser_monitoring_not_scheduled",
  "browser_activation_not_exposed"
] as const;

const BROWSER_LIVE_PHASE_IDS = [
  "gateway_unauthenticated_request",
  "gateway_wrong_token",
  "founder_positive_current_tab_capture",
  "node_offline",
  "stale_heartbeat",
  "manual_login_2fa_captcha_blocker",
  "kill_switch_after_queueing",
  "worker_crash_after_browser_invocation",
  "gateway_restart"
] as const;

export const RELEASE_PHASE_IDS = [
  ...CORE_PHASE_IDS,
  ...BROWSER_DISABLED_PHASE_IDS,
  ...BROWSER_LIVE_PHASE_IDS
] as const;

export type ReleasePhaseId = (typeof RELEASE_PHASE_IDS)[number];

export interface ReleasePhaseDefinition {
  readonly id: ReleasePhaseId;
  readonly label: string;
  readonly capability:
    "release" | "database" | "hostedWeb" | keyof ReleaseCapabilities | "rollback";
  readonly evidenceMode: "automated_or_manual" | "automated_only";
  readonly configurationBlockerAllowed: boolean;
}

function phase(
  id: ReleasePhaseId,
  label: string,
  capability: ReleasePhaseDefinition["capability"],
  configurationBlockerAllowed: boolean,
  evidenceMode: ReleasePhaseDefinition["evidenceMode"] = "automated_or_manual"
): ReleasePhaseDefinition {
  return { id, label, capability, configurationBlockerAllowed, evidenceMode };
}

const phaseDefinitions = [
  phase(
    "release_static_readiness",
    "Release code, policy, schema, and test readiness",
    "release",
    false,
    "automated_only"
  ),
  phase(
    "postgresql_snapshot_and_backup",
    "PostgreSQL snapshot and logical backup",
    "database",
    true
  ),
  phase("postgresql_restore", "PostgreSQL restore rehearsal", "database", true),
  phase(
    "migration_and_idempotent_bootstrap",
    "Migration and idempotent bootstrap",
    "database",
    true
  ),
  phase("hosted_web_deployment", "Hosted web deployment", "hostedWeb", true),
  phase("maritime_worker_dispatch", "Maritime worker dispatch", "maritimeWorker", true),
  phase("direct_capture", "Direct user capture", "directCapture", true),
  phase("duplicate_dispatch", "Worker duplicate dispatch", "maritimeWorker", true),
  phase("replayed_result", "Worker replayed result", "maritimeWorker", true),
  phase("worker_restart_recovery", "Worker restart recovery", "maritimeWorker", true),
  phase("web_push_delivery", "Web Push delivery", "webPush", true),
  phase("web_push_deduplication", "Web Push deduplication", "webPush", true),
  phase("quiet_hours", "Web Push quiet hours", "webPush", true),
  phase("provider_outage", "Provider outage behavior", "webPush", true),
  phase("gmail_readonly_verification", "Gmail read-only verification", "gmailAlerts", true),
  phase(
    "calendar_freebusy_and_approved_hold",
    "Calendar free-busy and approved hold",
    "calendar",
    true
  ),
  phase("emergency_disable", "Emergency disable", "release", true),
  phase("worker_image_rollback", "Worker image rollback", "rollback", true),
  phase(
    "browser_global_kill_switch_enabled",
    "Global browser kill switch enabled",
    "browserCapture",
    true
  ),
  phase(
    "browser_founder_capability_disabled",
    "Founder browser capability disabled",
    "browserCapture",
    true
  ),
  phase(
    "browser_source_jobs_rejected_before_dispatch",
    "Browser SourceJobs rejected before dispatch",
    "browserCapture",
    false,
    "automated_only"
  ),
  phase(
    "browser_gateway_not_required",
    "No OpenClaw gateway required",
    "browserCapture",
    false,
    "automated_only"
  ),
  phase("browser_endpoint_not_exposed", "No browser endpoint exposed", "browserCapture", true),
  phase(
    "browser_monitoring_not_scheduled",
    "No scheduled browser monitoring",
    "browserCapture",
    false,
    "automated_only"
  ),
  phase(
    "browser_activation_not_exposed",
    "Browser activation unavailable through UI and API",
    "browserCapture",
    false,
    "automated_only"
  ),
  phase(
    "gateway_unauthenticated_request",
    "Gateway unauthenticated request",
    "browserCapture",
    true
  ),
  phase("gateway_wrong_token", "Gateway wrong-token request", "browserCapture", true),
  phase(
    "founder_positive_current_tab_capture",
    "Founder positive current-tab capture",
    "browserCapture",
    true
  ),
  phase("node_offline", "Browser node offline deferral", "browserCapture", true),
  phase("stale_heartbeat", "Browser node stale heartbeat", "browserCapture", true),
  phase(
    "manual_login_2fa_captcha_blocker",
    "Login, 2FA, and CAPTCHA manual blockers",
    "browserCapture",
    true
  ),
  phase("kill_switch_after_queueing", "Browser kill switch after queueing", "browserCapture", true),
  phase(
    "worker_crash_after_browser_invocation",
    "Worker crash after browser invocation",
    "browserCapture",
    true
  ),
  phase("gateway_restart", "OpenClaw gateway restart", "browserCapture", true)
] as const satisfies readonly ReleasePhaseDefinition[];

export const RELEASE_PHASES: Readonly<Record<ReleasePhaseId, ReleasePhaseDefinition>> =
  Object.freeze(
    Object.fromEntries(phaseDefinitions.map((definition) => [definition.id, definition]))
  ) as Readonly<Record<ReleasePhaseId, ReleasePhaseDefinition>>;

const CORE_CAPABILITIES = Object.freeze({
  browserCapture: false,
  directCapture: true,
  gmailAlerts: true,
  calendar: true,
  webPush: true,
  maritimeWorker: true
}) satisfies ReleaseCapabilities;

const BROWSER_CAPABILITIES = Object.freeze({
  ...CORE_CAPABILITIES,
  browserCapture: true
}) satisfies ReleaseCapabilities;

export interface ReleaseProfileDefinition {
  readonly id: ReleaseProfileId;
  readonly capabilities: ReleaseCapabilities;
  readonly requiredPhaseIds: readonly ReleasePhaseId[];
  readonly releaseEligible: boolean;
  readonly releaseEligibilityBlocker: string | null;
}

export const RELEASE_PROFILES: Readonly<Record<ReleaseProfileId, ReleaseProfileDefinition>> =
  Object.freeze({
    founder_core: Object.freeze({
      id: "founder_core",
      capabilities: CORE_CAPABILITIES,
      requiredPhaseIds: Object.freeze([...CORE_PHASE_IDS, ...BROWSER_DISABLED_PHASE_IDS]),
      releaseEligible: true,
      releaseEligibilityBlocker: null
    }),
    founder_browser_experimental: Object.freeze({
      id: "founder_browser_experimental",
      capabilities: BROWSER_CAPABILITIES,
      requiredPhaseIds: Object.freeze([...CORE_PHASE_IDS, ...BROWSER_LIVE_PHASE_IDS]),
      releaseEligible: false,
      releaseEligibilityBlocker: "openclaw_ingress_adr_unresolved"
    })
  });

export function isReleaseProfileId(value: unknown): value is ReleaseProfileId {
  return typeof value === "string" && RELEASE_PROFILE_IDS.includes(value as ReleaseProfileId);
}

export function releaseProfileDefinition(profileId: ReleaseProfileId): ReleaseProfileDefinition {
  return RELEASE_PROFILES[profileId];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function capabilitiesMatchProfile(
  profileId: ReleaseProfileId,
  capabilities: unknown
): capabilities is ReleaseCapabilities {
  if (!isObject(capabilities)) return false;
  const keys = Object.keys(capabilities).sort();
  const expectedKeys = [...RELEASE_CAPABILITY_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  const expected = RELEASE_PROFILES[profileId].capabilities;
  return RELEASE_CAPABILITY_KEYS.every((key) => capabilities[key] === expected[key]);
}

export interface RequiredPhaseState {
  readonly phaseId: ReleasePhaseId;
  readonly resultState: ReleasePhaseResultState;
  readonly configurationBlockerValid?: boolean;
}

export function classifyRequiredPhaseStates(
  profileId: ReleaseProfileId,
  states: readonly RequiredPhaseState[]
): ReleaseClassification {
  const profile = RELEASE_PROFILES[profileId];
  if (!profile.releaseEligible) return "no_go";

  const required = new Set(profile.requiredPhaseIds);
  const observed = new Map<ReleasePhaseId, RequiredPhaseState>();
  for (const state of states) {
    if (!required.has(state.phaseId) || observed.has(state.phaseId)) return "no_go";
    observed.set(state.phaseId, state);
  }
  if (
    observed.size !== required.size ||
    profile.requiredPhaseIds.some((phaseId) => !observed.has(phaseId))
  ) {
    return "no_go";
  }

  let blocked = false;
  for (const phaseId of profile.requiredPhaseIds) {
    const state = observed.get(phaseId);
    if (!state) return "no_go";
    if (
      state.resultState === "passed_automated" ||
      state.resultState === "passed_manual_evidence"
    ) {
      continue;
    }
    if (
      state.resultState === "blocked_missing_configuration" &&
      RELEASE_PHASES[phaseId].configurationBlockerAllowed &&
      state.configurationBlockerValid === true
    ) {
      blocked = true;
      continue;
    }
    return "no_go";
  }
  return blocked ? "conditional_go_founder_only_staging" : "go_founder_only_core_beta";
}
