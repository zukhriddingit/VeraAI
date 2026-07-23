import {
  BrowserNodeStatusSchema,
  BrowserProfileIdSchema,
  SafeBrowserUrlSchema,
  type BrowserNodeStatus,
  type BrowserProfileId
} from "@vera/domain";
import { z } from "zod";

import { ZILLOW_CURRENT_TAB_MANIFEST } from "./manifests.ts";
import { SourcePolicyRegistry } from "./registry.ts";

const ZillowTrackingQueryKeySchema = z.enum([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fromhomepage"
]);

const ZillowListingPathPattern = /^\/homedetails\/(?:[^/?#]+\/)*[1-9][0-9]*_zpid\/?$/u;

export const ZillowCurrentTabUrlErrorCodeSchema = z.enum([
  "invalid_url",
  "https_required",
  "hostname_not_allowed",
  "listing_path_not_allowed",
  "query_parameter_not_allowed",
  "active_url_mismatch"
]);

export class ZillowCurrentTabUrlError extends Error {
  constructor(readonly code: z.infer<typeof ZillowCurrentTabUrlErrorCodeSchema>) {
    super(`Zillow current-tab URL rejected: ${code}.`);
    this.name = "ZillowCurrentTabUrlError";
  }
}

export function canonicalizeZillowListingUrl(input: string): string {
  const safe = SafeBrowserUrlSchema.safeParse(input);
  if (!safe.success) throw new ZillowCurrentTabUrlError("invalid_url");

  const match = safe.data.match(/^([a-z]+):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/iu);
  if (!match) throw new ZillowCurrentTabUrlError("invalid_url");
  const protocol = match[1]?.toLowerCase();
  const hostname = match[2]?.toLowerCase();
  const pathname = match[3] || "/";
  const query = match[4] ?? "";

  if (protocol !== "https") throw new ZillowCurrentTabUrlError("https_required");
  if (hostname !== "www.zillow.com") {
    throw new ZillowCurrentTabUrlError("hostname_not_allowed");
  }
  if (!ZillowListingPathPattern.test(pathname)) {
    throw new ZillowCurrentTabUrlError("listing_path_not_allowed");
  }

  for (const parameter of query === "" ? [] : query.split("&")) {
    const key = decodeURIComponent(parameter.split("=", 1)[0] ?? "").toLowerCase();
    if (!ZillowTrackingQueryKeySchema.safeParse(key).success) {
      throw new ZillowCurrentTabUrlError("query_parameter_not_allowed");
    }
  }

  const canonicalPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `https://www.zillow.com${canonicalPath}`;
}

export function requireMatchingZillowCurrentTabUrl(expectedUrl: string, activeUrl: string): string {
  const expectedCanonical = canonicalizeZillowListingUrl(expectedUrl);
  const activeCanonical = canonicalizeZillowListingUrl(activeUrl);
  if (expectedCanonical !== activeCanonical) {
    throw new ZillowCurrentTabUrlError("active_url_mismatch");
  }
  return expectedCanonical;
}

export const BrowserCaptureControlStateSchema = z
  .object({
    systemBrowserDisabled: z.boolean(),
    userBrowserEnabled: z.boolean(),
    zillowSourceEnabled: z.boolean(),
    nodeDisabled: z.boolean(),
    profileDisabled: z.boolean()
  })
  .strict();

export const CurrentTabPolicyDenialReasonSchema = z.enum([
  "system_browser_kill_switch_active",
  "user_browser_kill_switch_active",
  "source_kill_switch_active",
  "node_disabled",
  "profile_disabled",
  "node_not_owned",
  "profile_not_selected",
  "profile_not_allowlisted",
  "source_policy_denied"
]);

export const CurrentTabPolicyDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      connectorId: z.literal("zillow.current-tab.v1"),
      canonicalUrl: SafeBrowserUrlSchema,
      profileId: BrowserProfileIdSchema,
      manifestVersion: z.literal(1)
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      reason: CurrentTabPolicyDenialReasonSchema
    })
    .strict()
]);

export interface EvaluateCurrentTabCapturePolicyInput {
  readonly expectedUrl: string;
  readonly profileId: BrowserProfileId;
  readonly node: BrowserNodeStatus | null;
  readonly controls: z.infer<typeof BrowserCaptureControlStateSchema>;
  readonly hasUserSession: boolean;
  readonly hasApproval: boolean;
}

function denied(reason: z.infer<typeof CurrentTabPolicyDenialReasonSchema>) {
  return CurrentTabPolicyDecisionSchema.parse({ allowed: false, reason });
}

export function evaluateCurrentTabCapturePolicy(
  input: EvaluateCurrentTabCapturePolicyInput
): z.infer<typeof CurrentTabPolicyDecisionSchema> {
  const controls = BrowserCaptureControlStateSchema.parse(input.controls);
  const profileId = BrowserProfileIdSchema.parse(input.profileId);
  const canonicalUrl = canonicalizeZillowListingUrl(input.expectedUrl);

  if (controls.systemBrowserDisabled) return denied("system_browser_kill_switch_active");
  if (!controls.userBrowserEnabled) return denied("user_browser_kill_switch_active");
  if (!controls.zillowSourceEnabled) return denied("source_kill_switch_active");
  if (controls.nodeDisabled) return denied("node_disabled");
  if (controls.profileDisabled) return denied("profile_disabled");
  if (input.node === null) return denied("node_not_owned");

  const node = BrowserNodeStatusSchema.parse(input.node);
  if (node.selectedProfileId !== profileId) return denied("profile_not_selected");
  if (!node.allowedProfileIds.includes(profileId)) return denied("profile_not_allowlisted");

  // Personal activation may flip only this manifest's disabled-by-default bit. All
  // capabilities, operations, origin, method, session, and approval checks still run
  // through the generic fail-closed registry.
  const activatedManifest = {
    ...ZILLOW_CURRENT_TAB_MANIFEST,
    enabled: true
  } as const;
  const registry = new SourcePolicyRegistry([activatedManifest]);
  const decision = registry.evaluate({
    connectorId: activatedManifest.connectorId,
    acquisitionMode: "local_browser",
    capability: "browser.capture",
    execution: "manual",
    operation: "capture.current_tab",
    hasUserSession: input.hasUserSession,
    hasApproval: input.hasApproval,
    network: {
      origin: "https://www.zillow.com/",
      domain: "www.zillow.com",
      httpMethod: "GET"
    }
  });
  if (!decision.allowed) return denied("source_policy_denied");

  return CurrentTabPolicyDecisionSchema.parse({
    allowed: true,
    connectorId: activatedManifest.connectorId,
    canonicalUrl,
    profileId,
    manifestVersion: activatedManifest.version
  });
}

export type BrowserCaptureControlState = z.infer<typeof BrowserCaptureControlStateSchema>;
export type CurrentTabPolicyDenialReason = z.infer<typeof CurrentTabPolicyDenialReasonSchema>;
export type CurrentTabPolicyDecision = z.infer<typeof CurrentTabPolicyDecisionSchema>;
