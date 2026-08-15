import { randomUUID } from "node:crypto";

import {
  ActivityEventSchema,
  BrowserConnectorEnrollmentCheckpointRequestSchema
} from "@vera/domain";
import { sha256Text } from "@vera/db";

import {
  consumeBrowserConnectorEnrollment,
  digestEnrollmentSecret
} from "../../../../../../lib/browser-connector-enrollment-service.ts";
import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import {
  BrowserGatewayAuthorizationError,
  type AuthenticatedBrowserEnrollmentCheckpoint,
  type BrowserGatewayRuntimeResolver
} from "../../../../../../lib/server/browser-gateway-runtime-resolver.ts";
import {
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../../lib/server/request-security.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export class EnrollmentCheckpointConfigurationError extends Error {
  constructor() {
    super("Browser Connector enrollment checkpoint is unavailable.");
    this.name = "EnrollmentCheckpointConfigurationError";
  }
}

export function parseEnrollmentCheckpointBearer(authorization: string | null): string {
  if (!authorization?.startsWith("Bearer ")) throw new BrowserGatewayAuthorizationError();
  const token = authorization.slice("Bearer ".length);
  if (!token || token.trim() !== token) throw new BrowserGatewayAuthorizationError();
  return token;
}

export function enrollmentCheckpointRequestOrigin(request: Request): string {
  const supplied = request.headers.get("origin");
  if (supplied === null) throw new CrossOriginMutationError();
  try {
    const parsed = new URL(supplied);
    if (
      parsed.origin !== supplied ||
      parsed.protocol !== "https:" ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new CrossOriginMutationError();
    }
    return parsed.origin;
  } catch (error: unknown) {
    if (error instanceof CrossOriginMutationError) throw error;
    throw new CrossOriginMutationError();
  }
}

export async function requireEnrollmentCheckpoint(
  request: Request,
  resolver: BrowserGatewayRuntimeResolver | null
): Promise<AuthenticatedBrowserEnrollmentCheckpoint> {
  if (!resolver) throw new EnrollmentCheckpointConfigurationError();
  return resolver.authenticateEnrollmentCheckpoint({
    bearerToken: parseEnrollmentCheckpointBearer(request.headers.get("authorization")),
    origin: enrollmentCheckpointRequestOrigin(request)
  });
}

function failure(code: string, status: number): Response {
  return Response.json(
    { code, message: "Browser Connector enrollment stopped safely." },
    { status, headers }
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const resolved = await requireEnrollmentCheckpoint(request, application.browserGatewayRuntime);
    if (!application.browserConnectorEnrollments) {
      throw new EnrollmentCheckpointConfigurationError();
    }
    const input = BrowserConnectorEnrollmentCheckpointRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 4_096 })
    );
    const decision = await consumeBrowserConnectorEnrollment({
      userId: resolved.userId,
      assignment: resolved.assignment,
      enrollments: application.browserConnectorEnrollments,
      input,
      now: () => new Date()
    });
    const activityId = randomUUID();
    await application.repositoryProvider.forUser(resolved.userId).activityEvents.append(
      ActivityEventSchema.parse({
        id: activityId,
        correlationId: activityId,
        causationId: null,
        actor: "connector",
        action: decision.allowed
          ? "browser.connector_enrollment_consumed"
          : "browser.connector_enrollment_denied",
        targetType: "browser_gateway_assignment",
        targetId: resolved.assignment.id,
        policyDecision: decision.allowed ? "authorized" : "denied",
        approvalId: null,
        payloadHash: sha256Text(
          `browser-connector-enrollment-checkpoint:v1:${resolved.assignment.id}:${digestEnrollmentSecret(input.ticket)}`
        ),
        outcome: decision.allowed ? "succeeded" : "denied",
        errorCategory: null,
        metadata: decision.allowed
          ? { protocolVersion: input.protocolVersion, connected: true }
          : { protocolVersion: input.protocolVersion, reason: decision.reason },
        occurredAt: new Date().toISOString()
      })
    );
    return Response.json(decision, { status: 200, headers });
  } catch (error: unknown) {
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return failure(
        "malformed_request",
        error instanceof MutationRequestError ? error.status : 400
      );
    }
    if (error instanceof BrowserGatewayAuthorizationError) {
      return failure("checkpoint_unauthorized", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return failure("cross_origin_request", 403);
    }
    return failure(
      error instanceof EnrollmentCheckpointConfigurationError
        ? "checkpoint_not_configured"
        : "checkpoint_unavailable",
      503
    );
  }
}
