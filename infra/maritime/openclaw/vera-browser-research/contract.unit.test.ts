import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SAFE_ACTIONS, SOURCE_POLICY, validateResearchPlan } from "./contract.mjs";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

const key = "gateway-generic-plan-test-key-000000000000000000000";

function plan() {
  const issuedAt = new Date();
  const payload = {
    version: "1",
    veraRunId: "run-apartments-1",
    source: "apartments_com",
    profile: {
      location: "Boston, MA",
      maximumRentUsd: 3_000,
      minimumBedrooms: 1,
      minimumBathrooms: 1
    },
    maxResults: 10,
    maxDetailPages: 5,
    maxActions: 50,
    maxDurationMilliseconds: 90_000,
    startingTabReference: {
      kind: "single_shared_tab",
      value: "explicitly_shared_zillow_rental_tab"
    },
    allowedHostnames: [...SOURCE_POLICY.apartments_com.hostnames],
    allowedUrlPatterns: [...SOURCE_POLICY.apartments_com.urlPatterns],
    enabledSafeActionTypes: [...SAFE_ACTIONS],
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString()
  };
  return {
    ...payload,
    signature: createHmac("sha256", key).update(canonical(payload)).digest("hex")
  };
}

describe("vera_browser_research_v1 contract", () => {
  it("accepts only the exact signed, reviewed and bounded plan", () => {
    expect(validateResearchPlan(plan(), key)).toMatchObject({
      source: "apartments_com",
      maxResults: 10,
      maxDetailPages: 5,
      maxActions: 50
    });
    expect(() => validateResearchPlan({ ...plan(), signature: "a".repeat(64) }, key)).toThrow(
      "plan_signature_invalid"
    );
    expect(() =>
      validateResearchPlan({ ...plan(), arbitraryUrl: "https://example.com" }, key)
    ).toThrow("invalid_tool_input");
    expect(() => validateResearchPlan({ ...plan(), maxResults: 11 }, key)).toThrow(
      "invalid_tool_input"
    );
  });

  it("contains no unrestricted or forbidden action surface", () => {
    const serialized = JSON.stringify(plan());
    expect(serialized).not.toMatch(
      /javascript|cssSelector|coordinate|contact|apply|tour|message|email|phone|payment|upload|download|shell|filesystem/iu
    );
    for (const action of [
      "evaluate",
      "javascript",
      "contact",
      "apply",
      "tour",
      "message",
      "phone",
      "email",
      "payment",
      "upload",
      "download"
    ]) {
      const unsafe = plan();
      unsafe.enabledSafeActionTypes = [action];
      expect(() => validateResearchPlan(unsafe, key)).toThrow("invalid_tool_input");
    }
  });
});
