import { describe, expect, it } from "vitest";

import {
  BrowserGatewayAssignmentSchema,
  BrowserGatewaySecretReferenceSchema
} from "./browser-gateway-assignment.ts";

const assignment = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  nodeId: "vera-browser-node-tester-a",
  maritimeAgentId: "vera-browser-gateway-tester-a",
  gatewayOrigin: "https://browser-a.verahousing.app",
  checkpointOrigin: "https://app.verahousing.app",
  secretReference: "TESTER_A_202608",
  relayCredentialDigest: "a".repeat(64),
  checkpointCredentialDigest: "b".repeat(64),
  status: "active",
  createdAt: "2026-08-13T18:00:00.000Z",
  activatedAt: "2026-08-13T18:05:00.000Z",
  revokedAt: null
} as const;

describe("browser Gateway assignment", () => {
  it("accepts non-secret owner routing", () => {
    expect(BrowserGatewayAssignmentSchema.parse(assignment).status).toBe("active");
  });

  it("rejects raw or unsafe secret references", () => {
    expect(() =>
      BrowserGatewaySecretReferenceSchema.parse("wss://gateway/#token".repeat(4))
    ).toThrow();
    expect(() => BrowserGatewaySecretReferenceSchema.parse("TESTER_A_202608")).not.toThrow();
  });

  it("requires exact HTTPS origins and status-consistent timestamps", () => {
    expect(() =>
      BrowserGatewayAssignmentSchema.parse({
        ...assignment,
        gatewayOrigin: "https://browser-a.verahousing.app/path"
      })
    ).toThrow();
    expect(() =>
      BrowserGatewayAssignmentSchema.parse({ ...assignment, activatedAt: null })
    ).toThrow();
  });
});
