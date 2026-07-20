import { randomUUID } from "node:crypto";

import {
  createSqliteRepositories,
  openExistingDatabase,
  RepositoryNotFoundError
} from "@vera/db/runtime";
import {
  DismissListingRequestSchema,
  InvalidListingTransitionError,
  ListingActionErrorResponseSchema
} from "@vera/domain";

import { dismissListing } from "../../../../../lib/listing-presentation";
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
    const parsed = DismissListingRequestSchema.safeParse((await request.json()) as unknown);
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
    connection = openExistingDatabase();
    return Response.json(
      dismissListing(listingId, {
        repositories: createSqliteRepositories(connection),
        now: () => new Date(),
        createId: randomUUID
      }),
      { status: 200, headers }
    );
  } catch (error: unknown) {
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
  } finally {
    connection?.close();
  }
}
