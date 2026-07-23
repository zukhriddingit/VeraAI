import { getHostedApplication } from "../../../../../lib/server/application.ts";
import { GoogleIntegrationOAuthError } from "../../../../../lib/server/google-integration-oauth.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError
} from "../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

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
    if (application.calendar.oauth === null) {
      return errorResponse(
        context.demoMode ? "google_disconnected" : "integration_unconfigured",
        "Google Calendar integration is unavailable.",
        409
      );
    }
    await application.calendar.oauth.disconnect({ userId: context.userId });
    return Response.json(
      { status: "disconnected", message: "Google Calendar disconnected." },
      { status: 200, headers: responseHeaders }
    );
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return errorResponse("cross_origin_request", "Request origin is not allowed.", 403);
    }
    if (error instanceof GoogleIntegrationOAuthError) {
      return errorResponse(
        error.code,
        error.code === "provider_revocation_unconfirmed"
          ? "Google Calendar was disconnected from Vera, but Google revocation could not be confirmed. Revoke Vera in your Google Account permissions."
          : "Google Calendar could not be disconnected.",
        error.httpStatus
      );
    }
    return errorResponse("disconnect_failed", "Google Calendar could not be disconnected.", 503);
  }
}
