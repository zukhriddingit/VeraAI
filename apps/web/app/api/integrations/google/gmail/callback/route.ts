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

const SuccessSchema = z
  .object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), code: z.string().min(1).max(4_096) })
  .strict();
const DeniedSchema = z
  .object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), error: z.literal("access_denied") })
  .strict();
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };
const failure = (code: string, message: string, status: number) =>
  Response.json({ code, message }, { status, headers });

function query(url: URL): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(values, key)) throw new Error("Duplicate callback parameter.");
    values[key] = value;
  }
  return values;
}

function redirect(origin: string, state: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: new URL(`/settings/integrations?gmail=${state}`, origin).href
    }
  });
}

export async function GET(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    assertTrustedCallbackOrigin(request);
    const context = await requireVeraSession(request.headers, application);
    if (application.gmailOAuth === null)
      return failure("integration_unconfigured", "Gmail integration is unavailable.", 409);
    const values = query(new URL(request.url));
    const denied = DeniedSchema.safeParse(values);
    if (denied.success) {
      await application.gmailOAuth.handleDeniedCallback({
        userId: context.userId,
        state: denied.data.state
      });
      return redirect(trustedPublicOrigin(request), "denied");
    }
    const success = SuccessSchema.parse(values);
    const connection = await application.gmailOAuth.handleCallback({
      userId: context.userId,
      state: success.state,
      code: success.code
    });
    return redirect(
      trustedPublicOrigin(request),
      connection.grantedScopes.includes("https://www.googleapis.com/auth/gmail.readonly")
        ? "connected"
        : "partial"
    );
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return failure("unauthorized", "Authentication required.", 401);
    if (error instanceof CrossOriginMutationError)
      return failure("invalid_callback", "Invalid Google authorization callback.", 400);
    if (error instanceof GoogleIntegrationOAuthError)
      return failure(error.code, "Gmail authorization failed safely.", error.httpStatus);
    return failure("invalid_callback", "Invalid Google authorization callback.", 400);
  }
}
