import { createHash } from "node:crypto";

import type {
  BrowserGatewayAssignment,
  BrowserConnectorEnrollmentCheckpointRequest,
  VeraUserId
} from "@vera/domain";
import type { BrowserConnectorEnrollmentRepository } from "@vera/db";
import { describe, expect, it, vi } from "vitest";

import {
  consumeBrowserConnectorEnrollment,
  createEnrollmentTicket,
  digestEnrollmentSecret,
  issueBrowserConnectorEnrollment
} from "./browser-connector-enrollment-service.ts";

const userId = "22222222-2222-4222-8222-222222222222" as VeraUserId;
const assignment: BrowserGatewayAssignment = {
  id: "11111111-1111-4111-8111-111111111111",
  userId,
  nodeId: "enrollment-node-a",
  maritimeAgentId: "enrollment-agent-a",
  gatewayOrigin: "https://enrollment-a.verahousing.app",
  checkpointOrigin: "https://app.verahousing.app",
  secretReference: "ENROLL_A_202608",
  relayCredentialDigest: "1".repeat(64),
  checkpointCredentialDigest: "2".repeat(64),
  status: "active",
  createdAt: "2026-08-14T11:00:00.000Z",
  activatedAt: "2026-08-14T11:05:00.000Z",
  revokedAt: null
};

function issuanceFixture() {
  const issue = vi.fn(async (input) => ({
    ...input,
    status: "issued" as const,
    consumedAt: null,
    terminalAt: null,
    terminalReason: null
  }));
  const resolveEnrollmentForUser = vi.fn(async () => assignment);
  return {
    dependencies: {
      userId,
      authorization: { resolveEnrollmentForUser },
      enrollments: { issue } as unknown as BrowserConnectorEnrollmentRepository,
      now: () => new Date("2026-08-14T12:00:00.000Z"),
      randomBytes: (size: number) => new Uint8Array(size).fill(0xaa),
      id: vi
        .fn()
        .mockReturnValueOnce("50000000-0000-4000-8000-000000000001")
        .mockReturnValueOnce("60000000-0000-4000-8000-000000000001")
    },
    issue,
    resolveEnrollmentForUser
  };
}

const checkpoint: BrowserConnectorEnrollmentCheckpointRequest = {
  ticket: "A".repeat(43),
  extensionVersion: "2.2.0",
  protocolVersion: "1",
  installationId: "c".repeat(64),
  requestedAt: "2026-08-14T12:00:10.000Z"
};

describe("browser connector enrollment service", () => {
  it("creates exactly 256 random bits and hashes secrets deterministically", () => {
    const ticket = createEnrollmentTicket((size) => new Uint8Array(size).fill(0xaa));
    expect(ticket).toHaveLength(43);
    expect(Buffer.from(ticket, "base64url")).toHaveLength(32);
    expect(digestEnrollmentSecret(ticket)).toBe(
      createHash("sha256").update(ticket, "utf8").digest("hex")
    );
  });

  it("issues a sixty-second owner-bound ticket while persisting only its digest", async () => {
    const fixture = issuanceFixture();
    const response = await issueBrowserConnectorEnrollment(fixture.dependencies, {
      confirmation: "connect_read_only_browser",
      extensionVersion: "2.2.0",
      protocolVersion: "1",
      installationDigest: "d".repeat(64),
      idempotencyKey: "e".repeat(64)
    });

    expect(response).toEqual({
      protocolVersion: "1",
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expiresAt: "2026-08-14T12:01:00.000Z",
      gatewayOrigin: assignment.gatewayOrigin
    });
    expect(fixture.resolveEnrollmentForUser).toHaveBeenCalledWith(userId);
    expect(fixture.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        assignmentId: assignment.id,
        gatewayOrigin: assignment.gatewayOrigin,
        ticketDigest: digestEnrollmentSecret(response.ticket),
        installationDigest: "d".repeat(64)
      })
    );
    expect(JSON.stringify(fixture.issue.mock.calls)).not.toContain(response.ticket);
  });

  it("maps atomic repository consumption to a secret-free allow decision", async () => {
    const consume = vi.fn(async () => ({
      outcome: "consumed" as const,
      ticket: {
        id: "50000000-0000-4000-8000-000000000001",
        assignmentId: assignment.id,
        userId,
        deviceId: "60000000-0000-4000-8000-000000000001",
        installationDigest: digestEnrollmentSecret(checkpoint.installationId),
        ticketDigest: digestEnrollmentSecret(checkpoint.ticket),
        extensionVersion: "2.2.0" as const,
        protocolVersion: "1" as const,
        gatewayOrigin: assignment.gatewayOrigin,
        idempotencyKey: "e".repeat(64),
        status: "consumed" as const,
        issuedAt: "2026-08-14T12:00:00.000Z",
        expiresAt: "2026-08-14T12:01:00.000Z",
        consumedAt: "2026-08-14T12:00:20.000Z",
        terminalAt: "2026-08-14T12:00:20.000Z",
        terminalReason: null
      }
    }));
    await expect(
      consumeBrowserConnectorEnrollment({
        userId,
        assignment,
        enrollments: { consume } as unknown as BrowserConnectorEnrollmentRepository,
        input: checkpoint,
        now: () => new Date("2026-08-14T12:00:20.000Z")
      })
    ).resolves.toEqual({ allowed: true, assignmentId: assignment.id });
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketDigest: digestEnrollmentSecret(checkpoint.ticket),
        installationDigest: digestEnrollmentSecret(checkpoint.installationId)
      })
    );
  });

  it("preserves typed denial without returning assignment or credential material", async () => {
    const consume = vi.fn(async () => ({ outcome: "ticket_replayed" as const }));
    await expect(
      consumeBrowserConnectorEnrollment({
        userId,
        assignment,
        enrollments: { consume } as unknown as BrowserConnectorEnrollmentRepository,
        input: checkpoint,
        now: () => new Date("2026-08-14T12:00:20.000Z")
      })
    ).resolves.toEqual({ allowed: false, reason: "ticket_replayed" });
  });
});
