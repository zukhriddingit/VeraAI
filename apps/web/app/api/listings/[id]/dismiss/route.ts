import { randomUUID } from "node:crypto";

import { RepositoryNotFoundError } from "@vera/db";
import {
  DismissListingRequestSchema,
  InvalidListingTransitionError,
  ListingActionErrorResponseSchema
} from "@vera/domain";

import { dismissListing } from "../../../../../lib/listing-presentation";
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
    const parsed = DismissListingRequestSchema.safeParse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    if (!parsed.success) {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "malformed_request",
          message: "Dismiss request is malformed."
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
    return Response.json(
      await dismissListing(listingId, {
        userId: session.userId,
        repositoryProvider: session.repositoryProvider,
        now: () => new Date(),
        createId: randomUUID
      }),
      { status: 200, headers }
    );
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
        { code: "malformed_request", message: "Dismiss request is malformed." },
        { status: error.status, headers }
      );
    }
    const notFound = error instanceof RepositoryNotFoundError;
    const invalid = error instanceof InvalidListingTransitionError;
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: notFound ? "not_found" : invalid ? "invalid_transition" : "database_unavailable",
        message: notFound
          ? "Listing not found."
          : invalid
            ? "This listing can no longer be dismissed from its current state."
            : "Dismiss state is unavailable."
      }),
      { status: notFound ? 404 : invalid ? 409 : 503, headers }
    );
  }
}
