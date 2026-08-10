import {
  CanonicalListingCollectionResponseSchema,
  ListingsUnavailableResponseSchema
} from "@vera/domain";

import { getDemoStatus } from "../../../lib/demo-search-service";
import { AuthenticationRequiredError, requireVeraSession } from "../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function GET(request: Request): Promise<Response> {
  const generatedAt = new Date().toISOString();

  try {
    const observedSinceValue = new URL(request.url).searchParams.get("observedSince");
    const observedSinceTimestamp =
      observedSinceValue === null ? null : Date.parse(observedSinceValue);
    if (observedSinceTimestamp !== null && Number.isNaN(observedSinceTimestamp)) {
      return Response.json(
        { code: "invalid_observed_since", message: "The listing time window is invalid." },
        { status: 400, headers }
      );
    }
    const context = await requireVeraSession(request.headers);
    const repositories = context.repositories;
    const availableListings =
      context.demoMode && (await getDemoStatus(repositories)).status === "not_run"
        ? []
        : await repositories.canonicalListings.listSummaries();
    const listings =
      observedSinceTimestamp === null
        ? availableListings
        : availableListings.filter(
            (listing) => Date.parse(listing.freshestObservedAt) >= observedSinceTimestamp
          );
    const response = CanonicalListingCollectionResponseSchema.parse({
      listings,
      count: listings.length,
      generatedAt
    });

    return Response.json(response, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    const response = ListingsUnavailableResponseSchema.parse({
      code: "database_unavailable",
      message:
        process.env.VERA_DEMO_MODE === "1"
          ? "Demo listing data is unavailable. Run pnpm demo:reset and pnpm demo:seed."
          : "Hosted listing data is unavailable. Check PostgreSQL readiness.",
      generatedAt
    });

    return Response.json(response, { status: 503, headers });
  }
}
