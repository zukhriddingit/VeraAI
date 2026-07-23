import { z } from "zod";

import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import { GoogleIntegrationOAuthError } from "../../../../../../lib/server/google-integration-oauth.ts";
import {
  assertTrustedCallbackOrigin,
  CrossOriginMutationError,
  trustedPublicOrigin
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
const SuccessQuerySchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    code: z.string().min(1).max(4_096)
  })
  .strict();
const DeniedQuerySchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    error: z.literal("access_denied")
  })
  .strict();

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers: responseHeaders });
}

function uniqueQuery(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(result, key)) throw new Error("Duplicate callback query parameter.");
    result[key] = value;
  }
  return result;
}

function settingsRedirect(origin: string, state: string): Response {
  const location = new URL(`/settings/integrations?calendar=${state}`, origin);
  return new Response(null, {
    status: 303,
    headers: { "Cache-Control": "no-store, max-age=0", Location: location.href }
  });
}

export async function GET(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    assertTrustedCallbackOrigin(request);
    const context = await requireVeraSession(request.headers, application);
    if (application.calendar.oauth === null) {
      return errorResponse(
        context.demoMode ? "google_disconnected" : "integration_unconfigured",
        "Google Calendar integration is unavailable.",
        409
      );
    }
    const url = new URL(request.url);
    const query = uniqueQuery(url);
    const denied = DeniedQuerySchema.safeParse(query);
    if (denied.success) {
      await application.calendar.oauth.handleDeniedCallback({
        userId: context.userId,
        state: denied.data.state
      });
      return settingsRedirect(trustedPublicOrigin(request), "denied");
    }
    const success = SuccessQuerySchema.parse(query);
    const connection = await application.calendar.oauth.handleCallback({
      userId: context.userId,
      state: success.state,
      code: success.code
    });
    return settingsRedirect(
      trustedPublicOrigin(request),
      connection.status === "connected" ? "connected" : connection.status
    );
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return errorResponse("invalid_callback", "Invalid Google authorization callback.", 400);
    }
    if (error instanceof GoogleIntegrationOAuthError) {
      return errorResponse(
        error.code,
        "Google Calendar authorization failed safely.",
        error.httpStatus
      );
    }
    return errorResponse("invalid_callback", "Invalid Google authorization callback.", 400);
  }
}
