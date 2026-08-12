import { EnrichmentBatchResponseSchema, ListingActionErrorResponseSchema } from "@vera/domain";

import {
  createListingEnrichmentDependencies,
  queueTopListingsPerSource
} from "../../../../../lib/listing-enrichment-service";
import {
  assertSameOriginMutation,
  CrossOriginMutationError
} from "../../../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    if (session.demoMode) {
      return Response.json(EnrichmentBatchResponseSchema.parse({ queuedCount: 0 }), {
        status: 202,
        headers
      });
    }
    const queuedCount = await queueTopListingsPerSource(
      createListingEnrichmentDependencies(session),
      3
    );
    return Response.json(EnrichmentBatchResponseSchema.parse({ queuedCount }), {
      status: 202,
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
        { code: "malformed_request", message: "Request origin is not allowed." },
        { status: 403, headers }
      );
    }
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Top-listing enrichment is unavailable."
      }),
      { status: 503, headers }
    );
  }
}
