import { createHash } from "node:crypto";

import {
  BrowserConnectorEnrollmentDecisionSchema,
  CreateBrowserConnectorEnrollmentRequestSchema,
  CreateBrowserConnectorEnrollmentResponseSchema,
  type BrowserConnectorEnrollmentCheckpointRequest,
  type BrowserConnectorEnrollmentDecision,
  type BrowserGatewayAssignment,
  type CreateBrowserConnectorEnrollmentRequest,
  type CreateBrowserConnectorEnrollmentResponse,
  type VeraUserId
} from "@vera/domain";
import {
  BrowserConnectorEnrollmentIssueError,
  type BrowserConnectorEnrollmentRepository
} from "@vera/db";

import type { BrowserGatewayRuntimeResolver } from "./server/browser-gateway-runtime-resolver.ts";

export type BrowserConnectorEnrollmentServiceErrorCode =
  "assignment_unavailable" | "device_conflict" | "rate_limited";

export class BrowserConnectorEnrollmentServiceError extends Error {
  constructor(readonly code: BrowserConnectorEnrollmentServiceErrorCode) {
    super("Browser Connector enrollment stopped safely.");
    this.name = "BrowserConnectorEnrollmentServiceError";
  }
}

export interface BrowserConnectorEnrollmentDependencies {
  readonly userId: VeraUserId;
  readonly authorization: Pick<BrowserGatewayRuntimeResolver, "resolveEnrollmentForUser">;
  readonly enrollments: Pick<BrowserConnectorEnrollmentRepository, "issue">;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly id: () => string;
}

export interface ConsumeBrowserConnectorEnrollmentDependencies {
  readonly userId: VeraUserId;
  readonly assignment: BrowserGatewayAssignment;
  readonly enrollments: Pick<BrowserConnectorEnrollmentRepository, "consume">;
  readonly input: BrowserConnectorEnrollmentCheckpointRequest;
  readonly now: () => Date;
}

export function createEnrollmentTicket(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) throw new Error("Enrollment entropy source returned wrong length.");
  return Buffer.from(bytes).toString("base64url");
}

export function digestEnrollmentSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapIssueError(error: BrowserConnectorEnrollmentIssueError): never {
  throw new BrowserConnectorEnrollmentServiceError(
    error.code === "ticket_active" ? "rate_limited" : error.code
  );
}

export async function issueBrowserConnectorEnrollment(
  dependencies: BrowserConnectorEnrollmentDependencies,
  requestInput: CreateBrowserConnectorEnrollmentRequest
): Promise<CreateBrowserConnectorEnrollmentResponse> {
  const request = CreateBrowserConnectorEnrollmentRequestSchema.parse(requestInput);
  const assignment = await dependencies.authorization.resolveEnrollmentForUser(dependencies.userId);
  if (!assignment) throw new BrowserConnectorEnrollmentServiceError("assignment_unavailable");

  const issuedAt = dependencies.now();
  const ticket = createEnrollmentTicket(dependencies.randomBytes);
  try {
    await dependencies.enrollments.issue({
      id: dependencies.id(),
      deviceId: dependencies.id(),
      userId: dependencies.userId,
      assignmentId: assignment.id,
      installationDigest: request.installationDigest,
      ticketDigest: digestEnrollmentSecret(ticket),
      extensionVersion: request.extensionVersion,
      protocolVersion: request.protocolVersion,
      gatewayOrigin: assignment.gatewayOrigin,
      idempotencyKey: request.idempotencyKey,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString()
    });
  } catch (error: unknown) {
    if (error instanceof BrowserConnectorEnrollmentIssueError) mapIssueError(error);
    throw error;
  }

  return CreateBrowserConnectorEnrollmentResponseSchema.parse({
    protocolVersion: request.protocolVersion,
    ticket,
    expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
    gatewayOrigin: assignment.gatewayOrigin
  });
}

export async function consumeBrowserConnectorEnrollment(
  dependencies: ConsumeBrowserConnectorEnrollmentDependencies
): Promise<BrowserConnectorEnrollmentDecision> {
  const result = await dependencies.enrollments.consume({
    userId: dependencies.userId,
    assignmentId: dependencies.assignment.id,
    ticketDigest: digestEnrollmentSecret(dependencies.input.ticket),
    installationDigest: digestEnrollmentSecret(dependencies.input.installationId),
    extensionVersion: dependencies.input.extensionVersion,
    protocolVersion: dependencies.input.protocolVersion,
    gatewayOrigin: dependencies.assignment.gatewayOrigin,
    consumedAt: dependencies.now().toISOString()
  });
  return BrowserConnectorEnrollmentDecisionSchema.parse(
    result.outcome === "consumed"
      ? { allowed: true, assignmentId: dependencies.assignment.id }
      : { allowed: false, reason: result.outcome }
  );
}
