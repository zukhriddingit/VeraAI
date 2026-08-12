import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ENRICHMENT_SAFE_ACTIONS,
  SAFE_ACTIONS,
  SOURCE_POLICY,
  validateResearchPlan
} from "./contract.mjs";

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

function enrichmentPlan(
  targetListingUrl = "https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/"
) {
  const base = plan();
  const { signature: _signature, ...payload } = base;
  const enrichmentPayload = {
    ...payload,
    mode: "enrichment",
    targetListingUrl,
    maxResults: 1,
    maxDetailPages: 1,
    maxActions: 10,
    enabledSafeActionTypes: [...ENRICHMENT_SAFE_ACTIONS]
  };
  return {
    ...enrichmentPayload,
    signature: createHmac("sha256", key).update(canonical(enrichmentPayload)).digest("hex")
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

  it("accepts one exact same-source enrichment target and rejects widened targets", () => {
    expect(validateResearchPlan(enrichmentPlan(), key)).toMatchObject({
      mode: "enrichment",
      maxResults: 1,
      maxDetailPages: 1,
      maxActions: 10
    });
    for (const target of [
      "https://www.apartments.com/boston-ma/",
      "https://www.apartments.com.evil.test/the-longwood/r7nkvh2/",
      "https://www.apartments.com/the-longwood/r7nkvh2/#contact",
      "https://user:secret@www.apartments.com/the-longwood/r7nkvh2/"
    ]) {
      expect(() => validateResearchPlan(enrichmentPlan(target), key)).toThrow();
    }
  });
});
