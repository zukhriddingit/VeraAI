import { type SourcePolicyManifest } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  INITIAL_LOCAL_MANIFESTS,
  SourcePolicyRegistry,
  type SourcePolicyRequest
} from "./index.ts";

const manualRequest = {
  connectorId: "manual.capture.v1",
  capability: "manual.capture",
  execution: "manual",
  operation: "capture.user_supplied",
  hasUserSession: false,
  hasApproval: false,
  network: null
} as const satisfies SourcePolicyRequest;

function withManualManifest(
  changes: Partial<SourcePolicyManifest>
): readonly SourcePolicyManifest[] {
  const manual = INITIAL_LOCAL_MANIFESTS.find(
    (manifest) => manifest.connectorId === "manual.capture.v1"
  );
  if (!manual) throw new Error("Manual manifest fixture is missing.");
  return [{ ...manual, ...changes }];
}

describe("SourcePolicyRegistry", () => {
  it("authorizes only the exact fixture and manual local operations", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);

    expect(registry.evaluate(manualRequest)).toEqual({
      allowed: true,
      reason: "authorized",
      connectorId: "manual.capture.v1",
      capability: "manual.capture",
      manifestVersion: 1
    });
    expect(
      registry.evaluate({
        connectorId: "fixture.feed.v1",
        capability: "fixture.read",
        execution: "manual",
        operation: "fixture.read_sanitized",
        hasUserSession: false,
        hasApproval: false,
        network: null
      })
    ).toMatchObject({ allowed: true, reason: "authorized" });
  });

  it("denies a missing manifest", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    expect(
      registry.evaluate({ ...manualRequest, connectorId: "missing.connector.v1" })
    ).toMatchObject({ allowed: false, reason: "unregistered_connector", manifestVersion: null });
  });

  it("turns malformed and duplicate registration into fail-closed policy errors", () => {
    const malformed = new SourcePolicyRegistry([
      { connectorId: "manual.capture.v1" } as SourcePolicyManifest
    ]);
    expect(() => malformed.evaluate(manualRequest)).not.toThrow();
    expect(malformed.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "policy_error"
    });
    expect(malformed.listManifests()).toEqual([]);

    const duplicate = new SourcePolicyRegistry([
      INITIAL_LOCAL_MANIFESTS[0]!,
      INITIAL_LOCAL_MANIFESTS[0]!
    ]);
    expect(duplicate.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "policy_error"
    });
  });

  it("denies disabled manifests and both kill switches", () => {
    const disabled = new SourcePolicyRegistry(withManualManifest({ enabled: false }));
    expect(disabled.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "connector_disabled"
    });

    const globalKilled = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS, {
      activeKillSwitches: new Set(["integrations.disabled"])
    });
    expect(globalKilled.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "global_kill_switch_active"
    });

    const connectorKilled = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS, {
      activeKillSwitches: new Set(["connectors.manual.capture.v1.disabled"])
    });
    expect(connectorKilled.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "connector_kill_switch_active"
    });
  });

  it("denies capability, execution, and operation mismatches", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    expect(registry.evaluate({ ...manualRequest, capability: "fixture.read" })).toMatchObject({
      allowed: false,
      reason: "capability_not_allowed"
    });
    expect(registry.evaluate({ ...manualRequest, execution: "scheduled" })).toMatchObject({
      allowed: false,
      reason: "execution_not_allowed"
    });
    expect(registry.evaluate({ ...manualRequest, operation: "capture.fetch_url" })).toMatchObject({
      allowed: false,
      reason: "operation_not_allowed"
    });
  });

  it("denies unexpected network data for no-network connectors", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    expect(
      registry.evaluate({
        ...manualRequest,
        network: {
          origin: "https://housing.example/",
          domain: "housing.example",
          httpMethod: "GET"
        }
      })
    ).toMatchObject({ allowed: false, reason: "network_not_allowed" });

    expect(
      registry.evaluate({
        ...manualRequest,
        network: {
          origin: "https://housing.example/",
          domain: "housing.example",
          httpMethod: "GET",
          redirect: true
        }
      } as unknown as SourcePolicyRequest)
    ).toMatchObject({ allowed: false, reason: "policy_error" });
  });

  it("denies missing required session and approval state", () => {
    const restricted = new SourcePolicyRegistry(
      withManualManifest({ requiresUserSession: true, requiresApproval: true })
    );
    expect(restricted.evaluate(manualRequest)).toMatchObject({
      allowed: false,
      reason: "user_session_required"
    });
    expect(restricted.evaluate({ ...manualRequest, hasUserSession: true })).toMatchObject({
      allowed: false,
      reason: "approval_required"
    });
  });

  it("turns unknown capabilities and malformed requests into typed denials", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    const unknownCapability = {
      ...manualRequest,
      capability: "browser.arbitrary_fetch"
    } as unknown as SourcePolicyRequest;
    expect(() => registry.evaluate(unknownCapability)).not.toThrow();
    expect(registry.evaluate(unknownCapability)).toEqual({
      allowed: false,
      reason: "policy_error",
      connectorId: "manual.capture.v1",
      capability: null,
      manifestVersion: null
    });

    expect(
      registry.evaluate({ ...manualRequest, unexpected: true } as unknown as SourcePolicyRequest)
    ).toMatchObject({ allowed: false, reason: "policy_error" });
    expect(
      registry.evaluate({ ...manualRequest, connectorId: "   " } as SourcePolicyRequest)
    ).toEqual({
      allowed: false,
      reason: "policy_error",
      connectorId: null,
      capability: "manual.capture",
      manifestVersion: null
    });
  });

  it("selects the latest version while rejecting duplicate connector-version pairs", () => {
    const manual = INITIAL_LOCAL_MANIFESTS.find(
      (manifest) => manifest.connectorId === "manual.capture.v1"
    );
    if (!manual) throw new Error("Manual manifest fixture is missing.");
    const registry = new SourcePolicyRegistry([
      manual,
      { ...manual, version: 2, notes: "Second reviewed policy version." }
    ]);
    expect(registry.getManifest(manual.connectorId)?.version).toBe(2);
    expect(registry.evaluate(manualRequest)).toMatchObject({
      allowed: true,
      manifestVersion: 2
    });
  });

  it("returns immutable manifests so connectors cannot broaden policy", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    const manifest = registry.getManifest("manual.capture.v1");
    expect(manifest).not.toBeNull();
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest?.capabilities)).toBe(true);
    expect(() =>
      (manifest?.capabilities as SourcePolicyManifest["capabilities"]).push("browser.capture")
    ).toThrow();
    expect(registry.evaluate(manualRequest)).toMatchObject({ allowed: true });
  });

  it("classifies known domains and requires a manual entry for every unknown domain", () => {
    const registry = new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS);
    expect(registry.classifyBrowserDomain("www.zillow.com")).toEqual({
      hostname: "www.zillow.com",
      source: "zillow",
      matchedDomain: "zillow.com",
      browserAccess: "policy_entry_present"
    });
    expect(registry.classifyBrowserDomain("LISTINGS.APARTMENTS.COM.")).toMatchObject({
      source: "apartments_com",
      matchedDomain: "apartments.com",
      browserAccess: "policy_entry_present"
    });
    expect(registry.classifyBrowserDomain("housing.example")).toEqual({
      hostname: "housing.example",
      source: "other",
      matchedDomain: null,
      browserAccess: "manual_policy_required"
    });
    expect(registry.classifyBrowserDomain("localhost")).toMatchObject({
      source: "other",
      browserAccess: "manual_policy_required"
    });
    expect(registry.classifyBrowserDomain("notzillow.com")).toMatchObject({
      source: "other",
      browserAccess: "manual_policy_required"
    });
  });
});

describe("initial local manifests", () => {
  it("grant one local capability and no network fields", () => {
    expect(INITIAL_LOCAL_MANIFESTS.map((manifest) => manifest.connectorId)).toEqual([
      "fixture.feed.v1",
      "manual.capture.v1"
    ]);
    for (const manifest of INITIAL_LOCAL_MANIFESTS) {
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(manifest.enabled).toBe(true);
      expect(manifest.execution).toBe("manual");
      expect(manifest.capabilities).toHaveLength(1);
      expect(manifest.allowedOperations).toHaveLength(1);
      expect(manifest.allowedDomains).toEqual([]);
      expect(manifest.allowedOrigins).toEqual([]);
      expect(manifest.allowedHttpMethods).toEqual([]);
      expect(manifest.requiresUserSession).toBe(false);
      expect(manifest.requiresApproval).toBe(false);
      expect(manifest.maxConcurrency).toBe(1);
    }
  });
});
