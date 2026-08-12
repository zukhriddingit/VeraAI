import { EnrichmentRequestSchema, ListingActionErrorResponseSchema } from "@vera/domain";

import {
  createListingEnrichmentDependencies,
  requestCanonicalListingEnrichment
} from "../../../../../lib/listing-enrichment-service";
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
    const input = EnrichmentRequestSchema.safeParse(
      await readBoundedJson(request, { maxBytes: 4_096 })
    );
    if (!input.success) {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "malformed_request",
          message: "Detail refresh request is malformed."
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
    const result = await requestCanonicalListingEnrichment(
      listingId,
      "user_refresh",
      createListingEnrichmentDependencies(session),
      input.data.force
    );
    return Response.json(result, { status: 202, headers });
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
        { code: "malformed_request", message: "Detail refresh request is malformed." },
        { status: error.status, headers }
      );
    }
    if (error instanceof Error && error.message === "listing_not_found") {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "not_found",
          message: "Listing not found."
        }),
        { status: 404, headers }
      );
    }
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Listing detail enrichment is unavailable."
      }),
      { status: 503, headers }
    );
  }
}
