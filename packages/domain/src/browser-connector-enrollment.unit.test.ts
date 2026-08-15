import { describe, expect, it } from "vitest";

import {
  BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION,
  BROWSER_CONNECTOR_EXTENSION_VERSION,
  BrowserConnectorEnrollmentCheckpointRequestSchema,
  BrowserConnectorEnrollmentDecisionSchema,
  CreateBrowserConnectorEnrollmentRequestSchema,
  CreateBrowserConnectorEnrollmentResponseSchema
} from "./browser-connector-enrollment.ts";

const requestedAt = "2026-08-14T12:00:00.000Z";

describe("browser connector enrollment contracts", () => {
  it("accepts the exact supported issuance request and response", () => {
    expect(
      CreateBrowserConnectorEnrollmentRequestSchema.parse({
        confirmation: "connect_read_only_browser",
        extensionVersion: BROWSER_CONNECTOR_EXTENSION_VERSION,
        protocolVersion: BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION,
        installationDigest: "a".repeat(64),
        idempotencyKey: "b".repeat(64)
      })
    ).toEqual({
      confirmation: "connect_read_only_browser",
      extensionVersion: "2.2.0",
      protocolVersion: "1",
      installationDigest: "a".repeat(64),
      idempotencyKey: "b".repeat(64)
    });
    expect(
      CreateBrowserConnectorEnrollmentResponseSchema.parse({
        protocolVersion: "1",
        ticket: "A".repeat(43),
        expiresAt: "2026-08-14T12:01:00.000Z",
        gatewayOrigin: "https://gateway-a.verahousing.app"
      })
    ).toMatchObject({ gatewayOrigin: "https://gateway-a.verahousing.app" });
  });

  it("accepts one fixed-size checkpoint request and closed decision", () => {
    expect(
      BrowserConnectorEnrollmentCheckpointRequestSchema.parse({
        ticket: "A".repeat(43),
        extensionVersion: "2.2.0",
        protocolVersion: "1",
        installationId: "c".repeat(64),
        requestedAt
      })
    ).toMatchObject({ requestedAt });
    expect(
      BrowserConnectorEnrollmentDecisionSchema.parse({
        allowed: true,
        assignmentId: "10000000-0000-4000-8000-000000000001"
      })
    ).toMatchObject({ allowed: true });
  });

  it("rejects malformed tickets, origins with paths, and extra secret-shaped fields", () => {
    expect(
      BrowserConnectorEnrollmentCheckpointRequestSchema.safeParse({
        ticket: "short",
        extensionVersion: "2.2.0",
        protocolVersion: "1",
        installationId: "c".repeat(64),
        requestedAt
      }).success
    ).toBe(false);
    expect(
      CreateBrowserConnectorEnrollmentResponseSchema.safeParse({
        protocolVersion: "1",
        ticket: "A".repeat(43),
        expiresAt: "2026-08-14T12:01:00.000Z",
        gatewayOrigin: "https://gateway-a.verahousing.app/path"
      }).success
    ).toBe(false);
    expect(
      BrowserConnectorEnrollmentDecisionSchema.safeParse({
        allowed: false,
        reason: "ticket_invalid",
        relayToken: "must-not-cross-the-checkpoint"
      }).success
    ).toBe(false);
  });
});
