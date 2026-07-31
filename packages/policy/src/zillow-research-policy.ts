import {
  ZILLOW_RESEARCH_MAX_DETAIL_PAGES,
  ZILLOW_RESEARCH_MAX_DURATION_MS,
  ZILLOW_RESEARCH_MAX_EXPANSIONS,
  ZILLOW_RESEARCH_MAX_RESULTS,
  ZillowResearchCheckpointRequestSchema,
  ZillowResearchCheckpointResponseSchema,
  type ZillowResearchCheckpointRequest,
  type ZillowResearchCheckpointResponse
} from "@vera/domain";

import { ZILLOW_RENTAL_RESEARCH_MANIFEST } from "./manifests.ts";
import { SourcePolicyRegistry } from "./registry.ts";

export interface ZillowResearchRuntimeAuthorization {
  readonly founderAuthorized: boolean;
  readonly sourceEnabled: boolean;
  readonly userTriggered: boolean;
  readonly browserKillSwitchActive: boolean;
  readonly runActive: boolean;
  readonly cancelled: boolean;
  readonly hasUserSession: boolean;
  readonly hasApproval: boolean;
}

export interface EvaluateZillowResearchActionInput {
  readonly checkpoint: ZillowResearchCheckpointRequest;
  readonly runtime: ZillowResearchRuntimeAuthorization;
  readonly checkedAt: string;
}

function decision(
  allowed: boolean,
  reason: ZillowResearchCheckpointResponse["reason"],
  checkedAt: string
): ZillowResearchCheckpointResponse {
  return ZillowResearchCheckpointResponseSchema.parse({ allowed, reason, checkedAt });
}

export function evaluateZillowResearchAction(
  input: EvaluateZillowResearchActionInput
): ZillowResearchCheckpointResponse {
  const checkpoint = ZillowResearchCheckpointRequestSchema.parse(input.checkpoint);
  const denied = (reason: Exclude<ZillowResearchCheckpointResponse["reason"], "allowed">) =>
    decision(false, reason, input.checkedAt);

  if (!input.runtime.founderAuthorized) return denied("founder_denied");
  if (!input.runtime.sourceEnabled) return denied("source_disabled");
  if (input.runtime.browserKillSwitchActive) return denied("browser_kill_switch_active");
  if (input.runtime.cancelled) return denied("cancelled");
  if (!input.runtime.runActive) return denied("run_not_active");
  if (!input.runtime.userTriggered) return denied("user_trigger_required");
  if (checkpoint.sharedTabCount !== 1) return denied("single_shared_tab_required");
  if (
    checkpoint.startingTabReference.kind !== checkpoint.activeTabReference.kind ||
    checkpoint.startingTabReference.value !== checkpoint.activeTabReference.value
  ) {
    return denied("shared_tab_mismatch");
  }
  if (checkpoint.hostname !== "www.zillow.com") return denied("hostname_not_allowed");

  const exceedsFixedLimits =
    checkpoint.elapsedMilliseconds >= ZILLOW_RESEARCH_MAX_DURATION_MS ||
    checkpoint.resultCardsObserved > ZILLOW_RESEARCH_MAX_RESULTS ||
    checkpoint.detailPagesOpened > ZILLOW_RESEARCH_MAX_DETAIL_PAGES ||
    checkpoint.resultPageExpansions > ZILLOW_RESEARCH_MAX_EXPANSIONS ||
    (checkpoint.action === "open_observed_listing" &&
      checkpoint.detailPagesOpened >= ZILLOW_RESEARCH_MAX_DETAIL_PAGES) ||
    (checkpoint.action === "scroll_bounded" &&
      checkpoint.resultPageExpansions >= ZILLOW_RESEARCH_MAX_EXPANSIONS);
  if (exceedsFixedLimits) return denied("run_limit_exceeded");

  const activatedManifest = {
    ...ZILLOW_RENTAL_RESEARCH_MANIFEST,
    enabled: true
  } as const;
  const policy = new SourcePolicyRegistry([activatedManifest]).evaluate({
    connectorId: activatedManifest.connectorId,
    acquisitionMode: "local_browser",
    capability: "browser.capture",
    execution: "manual",
    operation: "zillow.rental_research.v1",
    hasUserSession: input.runtime.hasUserSession,
    hasApproval: input.runtime.hasApproval,
    network: {
      origin: "https://www.zillow.com/",
      domain: checkpoint.hostname,
      httpMethod: "GET"
    }
  });
  if (!policy.allowed) return denied("source_policy_denied");

  return decision(true, "allowed", input.checkedAt);
}
