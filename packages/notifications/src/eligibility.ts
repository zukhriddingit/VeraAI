import type { NotificationPreference } from "@vera/domain";

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 } as const;

export type NotificationEligibilityReason =
  | "eligible"
  | "notifications_disabled"
  | "hard_constraint"
  | "below_threshold"
  | "stale"
  | "risk_ceiling"
  | "duplicate";

export function evaluateNotificationEligibility(input: {
  readonly preference: NotificationPreference;
  readonly score: number;
  readonly observedAt: string;
  readonly now: Date;
  readonly hardConstraintsPassed: boolean;
  readonly highestRisk: "none" | "low" | "medium" | "high";
  readonly alreadyDelivered: boolean;
  readonly killSwitchActive: boolean;
}): { readonly eligible: boolean; readonly reason: NotificationEligibilityReason } {
  if (!input.preference.enabled || input.killSwitchActive) {
    return { eligible: false, reason: "notifications_disabled" };
  }
  if (!input.hardConstraintsPassed) return { eligible: false, reason: "hard_constraint" };
  if (input.score < input.preference.scoreThreshold)
    return { eligible: false, reason: "below_threshold" };
  if (
    input.now.getTime() - Date.parse(input.observedAt) >
    input.preference.freshnessMinutes * 60_000
  ) {
    return { eligible: false, reason: "stale" };
  }
  if (RISK_ORDER[input.highestRisk] > RISK_ORDER[input.preference.riskCeiling]) {
    return { eligible: false, reason: "risk_ceiling" };
  }
  if (input.alreadyDelivered) return { eligible: false, reason: "duplicate" };
  return { eligible: true, reason: "eligible" };
}
