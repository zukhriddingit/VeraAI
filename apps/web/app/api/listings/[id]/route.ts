import { ListingActionErrorResponseSchema } from "@vera/domain";

import { getListingDetail } from "../../../../lib/listing-presentation";
import {
  createListingEnrichmentDependencies,
  requestCanonicalListingEnrichment
} from "../../../../lib/listing-enrichment-service";
import { parseRouteEntityId } from "../../../../lib/route-entity-id";
import { getHostedApplication } from "../../../../lib/server/application";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
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
    if (!session.demoMode) {
      await requestCanonicalListingEnrichment(
        listingId,
        "listing_opened",
        createListingEnrichmentDependencies(
          session,
          (await application.browserGatewayRuntime?.resolveForUser(session.userId)) ?? null
        )
      ).catch(() => null);
    }
    const detail = await getListingDetail(session.repositories, listingId);
    if (!detail) {
      return Response.json(
        ListingActionErrorResponseSchema.parse({
          code: "not_found",
          message: "Listing not found."
        }),
        { status: 404, headers }
      );
    }
    return Response.json(detail, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Listing evidence is unavailable."
      }),
      { status: 503, headers }
    );
  }
}
