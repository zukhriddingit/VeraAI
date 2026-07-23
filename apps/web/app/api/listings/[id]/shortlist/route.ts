import { randomUUID } from "node:crypto";

import {
  InvalidListingTransitionError,
  ListingActionErrorResponseSchema,
  ShortlistRequestSchema
} from "@vera/domain";

import { setListingShortlist } from "../../../../../lib/listing-presentation";
import { parseRouteEntityId } from "../../../../../lib/route-entity-id";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    const input = await readBoundedJson(request, { maxBytes: 16_384 });
    const parsed = ShortlistRequestSchema.safeParse(input);
    if (!parsed.success) {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "malformed_request",
          message: "Shortlist request is malformed."
        }),
        { status: 400, headers }
      );
    }
    const listingId = parseRouteEntityId((await context.params).id);
    if (listingId === null) {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "not_found",
          message: "Listing not found."
        }),
        { status: 404, headers }
      );
    }
    const result = await setListingShortlist(listingId, parsed.data.shortlisted, {
      userId: session.userId,
      repositoryProvider: session.repositoryProvider,
      now: () => new Date(),
      createId: randomUUID
    });
    return Response.json(result, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    if (error instanceof CrossOriginMutationError) {
      return Response.json(
        { code: "malformed_request", message: "Request origin is not allowed." },
        { status: 403, headers }
      );
    }
    if (error instanceof MutationRequestError) {
      return Response.json(
        { code: "malformed_request", message: "Shortlist request is malformed." },
        { status: error.status, headers }
      );
    }
    const invalid = error instanceof InvalidListingTransitionError;
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: invalid ? "invalid_transition" : "database_unavailable",
        message: invalid
          ? "The listing cannot move to that shortlist state."
          : "Shortlist state is unavailable."
      }),
      { status: invalid ? 409 : 503, headers }
    );
  }
}
