import {
  BrowserResearchCheckpointRequestSchema,
  BrowserResearchCheckpointResponseSchema,
  type BrowserResearchCheckpointRequest,
  type BrowserResearchCheckpointResponse
} from "@vera/domain";

import {
  APARTMENTS_RENTAL_RESEARCH_MANIFEST,
  CRAIGSLIST_RENTAL_RESEARCH_MANIFEST,
  FACEBOOK_MARKETPLACE_RENTAL_RESEARCH_MANIFEST,
  GENERIC_HOUSING_RESEARCH_MANIFEST,
  OFFCAMPUS_PARTNERS_RENTAL_RESEARCH_MANIFEST,
  ZILLOW_GENERIC_BROWSER_RESEARCH_MANIFEST
} from "./manifests.ts";
import { SourcePolicyRegistry } from "./registry.ts";

export interface BrowserResearchRuntimeAuthorization {
  readonly founderAuthorized: boolean;
  readonly sourceEnabled: boolean;
  readonly userTriggered: boolean;
  readonly browserKillSwitchActive: boolean;
  readonly runActive: boolean;
  readonly cancelled: boolean;
  readonly hasUserSession: boolean;
  readonly hasApproval: boolean;
  readonly planSignatureValid: boolean;
}

function decision(
  allowed: boolean,
  reason: BrowserResearchCheckpointResponse["reason"],
  checkedAt: string
): BrowserResearchCheckpointResponse {
  return BrowserResearchCheckpointResponseSchema.parse({ allowed, reason, checkedAt });
}

function manifestFor(source: BrowserResearchCheckpointRequest["plan"]["source"]) {
  if (source === "apartments_com") return APARTMENTS_RENTAL_RESEARCH_MANIFEST;
  if (source === "facebook_marketplace") {
    return FACEBOOK_MARKETPLACE_RENTAL_RESEARCH_MANIFEST;
  }
  if (source === "bu_off_campus") return OFFCAMPUS_PARTNERS_RENTAL_RESEARCH_MANIFEST;
  if (source === "custom_website") return GENERIC_HOUSING_RESEARCH_MANIFEST;
  if (source === "craigslist") return CRAIGSLIST_RENTAL_RESEARCH_MANIFEST;
  return ZILLOW_GENERIC_BROWSER_RESEARCH_MANIFEST;
}

export function evaluateBrowserResearchAction(input: {
  readonly checkpoint: BrowserResearchCheckpointRequest;
  readonly runtime: BrowserResearchRuntimeAuthorization;
  readonly checkedAt: string;
}): BrowserResearchCheckpointResponse {
  const checkpoint = BrowserResearchCheckpointRequestSchema.parse(input.checkpoint);
  const denied = (reason: Exclude<BrowserResearchCheckpointResponse["reason"], "allowed">) =>
    decision(false, reason, input.checkedAt);

  if (!input.runtime.founderAuthorized) return denied("founder_denied");
  if (!input.runtime.sourceEnabled) return denied("source_disabled");
  if (input.runtime.browserKillSwitchActive) return denied("browser_kill_switch_active");
  if (input.runtime.cancelled) return denied("cancelled");
  if (!input.runtime.runActive) return denied("run_not_active");
  if (!input.runtime.userTriggered) return denied("user_trigger_required");
  if (!input.runtime.planSignatureValid) return denied("plan_signature_invalid");
  if (Date.parse(checkpoint.plan.expiresAt) <= Date.parse(checkpoint.requestedAt)) {
    return denied("plan_expired");
  }
  if (checkpoint.sharedTabCount !== 1) return denied("single_shared_tab_required");
  if (
    checkpoint.plan.startingTabReference.kind !== checkpoint.activeTabReference.kind ||
    checkpoint.plan.startingTabReference.value !== checkpoint.activeTabReference.value
  ) {
    return denied("shared_tab_mismatch");
  }
  if (!checkpoint.plan.allowedHostnames.includes(checkpoint.hostname)) {
    return denied("hostname_not_allowed");
  }
  if (!checkpoint.plan.enabledSafeActionTypes.includes(checkpoint.action)) {
    return denied("action_not_enabled");
  }
  if (
    checkpoint.elapsedMilliseconds >= checkpoint.plan.maxDurationMilliseconds ||
    checkpoint.resultCardsObserved > checkpoint.plan.maxResults ||
    checkpoint.detailPagesOpened > checkpoint.plan.maxDetailPages ||
    checkpoint.actionsUsed >= checkpoint.plan.maxActions ||
    (checkpoint.action === "open_observed_listing" &&
      checkpoint.detailPagesOpened >= checkpoint.plan.maxDetailPages)
  ) {
    return denied("run_limit_exceeded");
  }

  const baseManifest = manifestFor(checkpoint.plan.source);
  const manifest = {
    ...baseManifest,
    enabled: true,
    ...(checkpoint.plan.sourceConfiguration === undefined ||
    checkpoint.plan.sourceConfiguration === null
      ? {}
      : {
          allowedDomains: [checkpoint.plan.sourceConfiguration.allowedDomain],
          allowedOrigins: [`https://${checkpoint.plan.sourceConfiguration.allowedDomain}/`],
          allowedHttpMethods: ["GET" as const]
        })
  } as const;
  const policy = new SourcePolicyRegistry([manifest]).evaluate({
    connectorId: manifest.connectorId,
    acquisitionMode: "local_browser",
    capability: "browser.capture",
    execution: "manual",
    operation: manifest.allowedOperations[0]!,
    hasUserSession: input.runtime.hasUserSession,
    hasApproval: input.runtime.hasApproval,
    network: {
      origin: `https://${checkpoint.hostname}/`,
      domain: checkpoint.hostname,
      httpMethod: "GET"
    }
  });
  if (!policy.allowed) return denied("source_policy_denied");

  return decision(true, "allowed", input.checkedAt);
}
