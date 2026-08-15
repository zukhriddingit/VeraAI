import { randomBytes, randomUUID } from "node:crypto";

import { ActivityEventSchema, CreateBrowserConnectorEnrollmentRequestSchema } from "@vera/domain";
import { sha256Text } from "@vera/db";

import {
  BrowserConnectorEnrollmentServiceError,
  issueBrowserConnectorEnrollment
} from "../../../../../../lib/browser-connector-enrollment-service.ts";
import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

function failure(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const input = CreateBrowserConnectorEnrollmentRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 4_096 })
    );
    if (!application.browserConnectorEnrollments || !application.browserGatewayRuntime) {
      return failure("unavailable", "Browser Connector enrollment is unavailable.", 503);
    }
    const response = await issueBrowserConnectorEnrollment(
      {
        userId: session.userId,
        authorization: application.browserGatewayRuntime,
        enrollments: application.browserConnectorEnrollments,
        now: () => new Date(),
        randomBytes,
        id: randomUUID
      },
      input
    );
    const activityId = randomUUID();
    await session.repositories.activityEvents.append(
      ActivityEventSchema.parse({
        id: activityId,
        correlationId: activityId,
        causationId: null,
        actor: "user",
        action: "browser.connector_enrollment_issued",
        targetType: "browser_connector_enrollment",
        targetId: session.userId,
        policyDecision: "authorized",
        approvalId: null,
        payloadHash: sha256Text(
          `browser-connector-enrollment:v1:${session.userId}:${input.installationDigest}:${input.idempotencyKey}`
        ),
        outcome: "succeeded",
        errorCategory: null,
        metadata: {
          extensionVersion: input.extensionVersion,
          protocolVersion: input.protocolVersion,
          expiresAt: response.expiresAt
        },
        occurredAt: new Date().toISOString()
      })
    );
    return Response.json(response, { status: 201, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return failure("unauthorized", "Sign in to connect this browser.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return failure("cross_origin_request", "Browser connection stopped safely.", 403);
    }
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return failure(
        "invalid_request",
        "Browser connection request is invalid.",
        error instanceof MutationRequestError ? error.status : 400
      );
    }
    if (error instanceof BrowserConnectorEnrollmentServiceError) {
      const status = error.code === "rate_limited" ? 429 : 409;
      return failure(error.code, "Browser connection is not available for this device.", status);
    }
    return failure("unavailable", "Browser Connector enrollment is unavailable.", 503);
  }
}
