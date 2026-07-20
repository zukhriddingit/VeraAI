import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import { ListingActionErrorResponseSchema } from "@vera/domain";

import { getListingDetail } from "../../../../lib/listing-presentation";
import { parseRouteEntityId } from "../../../../lib/route-entity-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
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
    connection = openExistingDatabase();
    const detail = getListingDetail(createSqliteRepositories(connection), listingId);
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
  } catch {
    return Response.json(
      ListingActionErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Listing evidence is unavailable."
      }),
      { status: 503, headers }
    );
  } finally {
    connection?.close();
  }
}
