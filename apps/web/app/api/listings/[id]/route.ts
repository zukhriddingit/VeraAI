import { ListingActionErrorResponseSchema } from "@vera/domain";

import { getListingDetail } from "../../../../lib/listing-presentation";
import { parseRouteEntityId } from "../../../../lib/route-entity-id";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
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
