import { GmailAuthorizationRequestSchema, GmailAuthorizationResponseSchema } from "@vera/domain";

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

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };
const failure = (code: string, message: string, status: number) =>
  Response.json({ code, message }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    if (application.gmailOAuth === null) {
      return failure("integration_unconfigured", "Gmail integration is not configured.", 409);
    }
    const input = GmailAuthorizationRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    const result = GmailAuthorizationResponseSchema.parse(
      await application.gmailOAuth.createAuthorization({
        userId: context.userId,
        returnTo: input.returnTo
      })
    );
    return Response.json(result, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return failure("unauthorized", "Authentication required.", 401);
    if (error instanceof CrossOriginMutationError)
      return failure("cross_origin_request", "Request origin is not allowed.", 403);
    if (error instanceof MutationRequestError)
      return failure("invalid_request", "Invalid request.", error.status);
    if (error instanceof GoogleIntegrationOAuthError)
      return failure(error.code, "Gmail authorization could not start.", error.httpStatus);
    return failure("invalid_request", "Invalid request.", 400);
  }
}
