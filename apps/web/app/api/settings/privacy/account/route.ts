import { PrivacyDeletionRequestSchema, PrivacyDeletionResponseSchema } from "@vera/domain";

import { getHostedApplication } from "../../../../../lib/server/application.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

function failure(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers: responseHeaders });
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const input = PrivacyDeletionRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 1_024 })
    );
    if (application.privacyLifecycle === null || application.auth === null) {
      return failure("privacy_unavailable", "Account deletion is unavailable.", 503);
    }

    const receipt = await application.privacyLifecycle.deleteOwner({
      userId: session.userId,
      challengeToken: input.challengeToken,
      confirmation: input.confirmation,
      now: new Date()
    });
    const signOut = await application.auth.api.signOut({
      headers: request.headers,
      asResponse: true
    });
    const payload = PrivacyDeletionResponseSchema.parse({
      status: "deleted",
      receiptId: receipt.id
    });
    const response = Response.json(payload, { status: 200, headers: responseHeaders });
    for (const cookie of signOut.headers.getSetCookie()) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return failure("unauthorized", "Authentication required.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return failure("cross_origin_request", "Request origin is not allowed.", 403);
    }
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return failure(
        error instanceof MutationRequestError ? error.code : "invalid_request",
        "Account deletion request is invalid.",
        error instanceof MutationRequestError ? error.status : 400
      );
    }
    return failure("deletion_failed", "Account deletion could not be completed.", 503);
  }
}
