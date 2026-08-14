import { ActivityEventSchema, RevokeBrowserGatewayAssignmentRequestSchema } from "@vera/domain";
import { sha256Text } from "@vera/db";

import { getBrowserGatewayOnboardingStatus } from "../../../../../../../lib/browser-gateway-onboarding-service.ts";
import { getHostedApplication } from "../../../../../../../lib/server/application.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function POST(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    RevokeBrowserGatewayAssignmentRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 1_024 })
    );
    if (!application.browserGatewayAssignments) throw new Error("assignment repository missing");
    const revokedAt = new Date().toISOString();
    const revoked = await application.browserGatewayAssignments.revokeForUser({
      userId: session.userId,
      revokedAt
    });
    if (revoked) {
      const activityId = crypto.randomUUID();
      await session.repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: activityId,
          correlationId: activityId,
          causationId: null,
          actor: "user",
          action: "browser.assignment_revoked",
          targetType: "browser_gateway_assignment",
          targetId: revoked.id,
          policyDecision: "authorized",
          approvalId: null,
          payloadHash: sha256Text(
            `browser-assignment-revocation:v1:${session.userId}:${revoked.id}`
          ),
          outcome: "succeeded",
          errorCategory: null,
          metadata: { serverAccessRevoked: true, extensionUnpairStillRequired: true },
          occurredAt: revokedAt
        })
      );
    }
    const status = await getBrowserGatewayOnboardingStatus({
      userId: session.userId,
      assignments: application.browserGatewayAssignments,
      runtimeResolver: application.browserGatewayRuntime,
      repositories: session.repositories
    });
    return Response.json(status, { status: 200, headers });
  } catch (error: unknown) {
    const status =
      error instanceof AuthenticationRequiredError
        ? 401
        : error instanceof CrossOriginMutationError
          ? 403
          : error instanceof MutationRequestError ||
              (error instanceof Error && error.name === "ZodError")
            ? error instanceof MutationRequestError
              ? error.status
              : 400
            : 503;
    return Response.json(
      {
        code:
          status === 401
            ? "unauthorized"
            : status === 403
              ? "cross_origin_request"
              : status === 503
                ? "unavailable"
                : "invalid_request",
        message: "Browser Connector access was not changed."
      },
      { status, headers }
    );
  }
}
