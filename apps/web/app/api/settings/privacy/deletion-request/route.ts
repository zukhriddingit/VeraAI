import { PrivacyDeletionChallengeRequestSchema } from "@vera/domain";

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

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

function failure(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    PrivacyDeletionChallengeRequestSchema.parse(await readBoundedJson(request, { maxBytes: 512 }));
    if (application.privacyLifecycle === null) {
      return failure("privacy_unavailable", "Account deletion is unavailable.", 503);
    }
    const response = await application.privacyLifecycle.issueDeletionChallenge({
      userId: session.userId,
      now: new Date()
    });
    return Response.json(response, { status: 201, headers });
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
    return failure("privacy_unavailable", "Account deletion is unavailable.", 503);
  }
}
