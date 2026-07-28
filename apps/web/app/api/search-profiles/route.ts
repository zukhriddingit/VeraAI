import {
  CreateSearchProfileRequestSchema,
  CreateSearchProfileResponseSchema
} from "@vera/domain";

import {
  createSearchProfile,
  SearchProfileServiceError
} from "../../../lib/search-profile-service";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    if (context.demoMode) {
      throw new SearchProfileServiceError("profile_unavailable", 503);
    }
    const input = CreateSearchProfileRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 12_000 })
    );
    const profile = await createSearchProfile(input, {
      userId: context.userId,
      repositoryProvider: context.repositoryProvider
    });
    return Response.json(CreateSearchProfileResponseSchema.parse({ profile }), {
      status: 201,
      headers
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    if (error instanceof CrossOriginMutationError) {
      return Response.json(
        { code: "cross_origin_request", message: "Request origin is not allowed." },
        { status: 403, headers }
      );
    }
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return Response.json(
        { code: "malformed_request", message: "Search profile is invalid." },
        { status: error instanceof MutationRequestError ? error.status : 400, headers }
      );
    }
    if (error instanceof SearchProfileServiceError) {
      return Response.json(
        { code: error.code, message: error.message },
        { status: error.status, headers }
      );
    }
    return Response.json(
      { code: "profile_unavailable", message: "Search profiles are temporarily unavailable." },
      { status: 503, headers }
    );
  }
}
