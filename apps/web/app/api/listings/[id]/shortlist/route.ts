import { randomUUID } from "node:crypto";

import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import {
  InvalidListingTransitionError,
  ListingActionErrorResponseSchema,
  ShortlistRequestSchema
} from "@vera/domain";

import { setListingShortlist } from "../../../../../lib/listing-presentation";
import { parseRouteEntityId } from "../../../../../lib/route-entity-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    const input: unknown = await request.json();
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
    connection = openExistingDatabase();
    const result = setListingShortlist(listingId, parsed.data.shortlisted, {
      repositories: createSqliteRepositories(connection),
      now: () => new Date(),
      createId: randomUUID
    });
    return Response.json(result, { status: 200, headers });
  } catch (error: unknown) {
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
  } finally {
    connection?.close();
  }
}
