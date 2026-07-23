import { describe, expect, it } from "vitest";
import type { NotificationPreference, VeraUserId } from "@vera/domain";
import { evaluateNotificationEligibility } from "./eligibility.ts";

const preference: NotificationPreference = {
  userId: "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId,
  enabled: true,
  scoreThreshold: 75,
  freshnessMinutes: 120,
  riskCeiling: "medium",
  timezone: "America/New_York",
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  hourlyLimit: 4,
  digestEnabled: true,
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z"
};

const base = {
  preference,
  score: 90,
  observedAt: "2026-07-22T11:30:00.000Z",
  now: new Date("2026-07-22T12:00:00.000Z"),
  hardConstraintsPassed: true,
  highestRisk: "low" as const,
  alreadyDelivered: false,
  killSwitchActive: false
};

describe("notification eligibility", () => {
  it("enforces hard constraints, threshold, duplicate, and risk policy", () => {
    expect(evaluateNotificationEligibility(base)).toEqual({ eligible: true, reason: "eligible" });
    expect(evaluateNotificationEligibility({ ...base, hardConstraintsPassed: false })).toEqual({
      eligible: false,
      reason: "hard_constraint"
    });
    expect(evaluateNotificationEligibility({ ...base, alreadyDelivered: true })).toEqual({
      eligible: false,
      reason: "duplicate"
    });
    expect(evaluateNotificationEligibility({ ...base, highestRisk: "high" })).toEqual({
      eligible: false,
      reason: "risk_ceiling"
    });
  });
});
