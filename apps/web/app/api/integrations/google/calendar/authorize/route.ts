import {
  CalendarCapabilityAuthorizationRequestSchema,
  CalendarCapabilityAuthorizationResponseSchema
} from "@vera/domain";

import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import { GoogleIntegrationOAuthError } from "../../../../../../lib/server/google-integration-oauth.ts";
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

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers: responseHeaders });
}

export async function POST(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const parsed = CalendarCapabilityAuthorizationRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    if (application.calendar.oauth === null) {
      return errorResponse(
        context.demoMode ? "google_disconnected" : "integration_unconfigured",
        context.demoMode
          ? "Google Calendar is disconnected in deterministic demo mode."
          : "Google Calendar integration is not configured.",
        409
      );
    }
    const result = CalendarCapabilityAuthorizationResponseSchema.parse(
      await application.calendar.oauth.createAuthorization({
        userId: context.userId,
        capability: parsed.capability,
        returnTo: parsed.returnTo
      })
    );
    return Response.json(result, { status: 200, headers: responseHeaders });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return errorResponse("cross_origin_request", "Request origin is not allowed.", 403);
    }
    if (error instanceof MutationRequestError) {
      return errorResponse("invalid_request", "Invalid request.", error.status);
    }
    if (error instanceof GoogleIntegrationOAuthError) {
      return errorResponse(
        error.code,
        "Google Calendar authorization could not start.",
        error.httpStatus
      );
    }
    return errorResponse("invalid_request", "Invalid request.", 400);
  }
}
